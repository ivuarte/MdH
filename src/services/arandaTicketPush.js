import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { getDB } from '../lib/db.js';
import { config } from '../config.js';
import { normalizeHtml, truthy } from '../lib/utils.js';
import { recordEvent } from '../lib/syncEvents.js';
import { glpiUrgencyToAranda, glpiPriorityToAranda } from '../lib/priorityMapping.js';

function arandaSegmentFromGlpiType(type) {
  return Number(type) === 2 ? 4 : 1;
}

function pickPossibleId(obj) {
  const keys = ['itemId', 'ItemId', 'id', 'Id', 'RequestId', 'requestId', 'Consecutive', 'consecutive'];
  for (const k of keys) {
    if (obj[k] != null) {
      const n = Number(obj[k]);
      if (Number.isFinite(n)) return n;
      const m = String(obj[k]).match(/(\d+)/);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

function pickComposedId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of ['composedItemId', 'ComposedItemId', 'itemCode', 'ItemCode', 'code', 'Code']) {
    if (obj[k] != null) return String(obj[k]);
  }
  return null;
}

// Propaga tickets origin=GLPI sin mapping en aranda_items hacia Aranda.
// IMPORTANTE: tickets con origin=ARANDA NUNCA se propagan — vinieron de allá ya.
export class ArandaTicketPushService extends BaseService {
  constructor(opts = {}) {
    super('arandaTicketPush', opts);
    this.processing = new Set();
  }

  async tick() {
    // Selecciona tickets origin=GLPI que NO están en aranda_items
    // O están con status='failed' (para reintentos automáticos sin necesidad de purga manual).
    // LEFT JOIN con service_catalog_sync para resolver categoría/segmento, y a partir del
    // responsable_label cruzamos con aranda_groups (el grupo marcado is_default_for_label=1)
    // para obtener GroupId y ResponsibleId reales.
    const [rows] = await getDB().query(
      `SELECT t.id, t.nombre, t.content, t.type, t.urgency, t.priority,
              t.itilcategories_id,
              scs.aranda_category_id AS mapped_category_id,
              scs.aranda_segment     AS mapped_segment,
              scs.responsable_label  AS mapped_label,
              ag.id                  AS mapped_group_id,
              ag.default_user_id     AS mapped_user_id
         FROM tickets t
         LEFT JOIN aranda_items a ON a.ticket_id = t.id
         LEFT JOIN service_catalog_sync scs
                ON scs.glpi_category_id = t.itilcategories_id
               AND scs.status = 'matched'
         LEFT JOIN aranda_groups ag
                ON ag.responsable_label = scs.responsable_label
               AND ag.is_default_for_label = 1
               AND ag.id > 0                       -- 0 = placeholder, no es un id real Aranda
               AND ag.default_user_id IS NOT NULL  -- VALIDAR sin id real
               AND ag.default_user_id > 0
        WHERE t.origin = 'GLPI'
          AND (a.ticket_id IS NULL OR a.status = 'failed')
        ORDER BY t.id ASC
        LIMIT 50`
    );

    for (const row of rows) {
      if (this.stopping) return;
      if (this.processing.has(row.id)) continue;
      this.processing.add(row.id);
      try {
        await this.createInAranda(row);
      } catch (err) {
        this.log.error(`Ticket ${row.id} fallo creando en Aranda`, { err, ticket_id: row.id });
        await this.markFailed(row.id, err.message);
      } finally {
        this.processing.delete(row.id);
      }
    }
  }

  async createInAranda(row) {
    const desc = normalizeHtml(row.content, 4000);
    const subj = normalizeHtml(row.nombre, 255);

    // Mapeo de categoría: si la categoría GLPI tiene mapping en service_catalog_sync,
    // usamos su aranda_category_id + aranda_segment. Si no hay mapeo, caen los defaults del .env.
    const categoryId = row.mapped_category_id ?? config.ARANDA_CATEGORY_ID;
    const segmentFromType = arandaSegmentFromGlpiType(row.type);
    const segment = Number(row.mapped_segment) || segmentFromType;

    // El catálogo Aranda define el segmento de cada subcategoría — si el type GLPI
    // contradice al catálogo, el catálogo gana (la categoría solo existe en su segmento).
    if (row.mapped_segment && Number(row.mapped_segment) !== segmentFromType) {
      this.log.warn(
        `Ticket ${row.id}: type GLPI=${row.type} (${segmentFromType === 1 ? 'INC' : 'RF'}) ` +
        `pero categoría ${row.itilcategories_id} mapea a seg=${row.mapped_segment} (${row.mapped_segment === 1 ? 'INC' : 'RF'}). ` +
        `Se respeta el segmento del catálogo Aranda — la subcategoría solo existe ahí.`,
        { ticket_id: row.id, glpi_type: row.type, mapped_segment: row.mapped_segment }
      );
    }

    // Mapeo de grupo/responsable: si el responsable_label resuelve a un aranda_group con
    // is_default_for_label=1, usamos su id+user_id. Si no, defaults del .env.
    // "Consorcio - Mesa de Servicio N1" intencionalmente NO está en aranda_groups → cae al default.
    const groupId = row.mapped_group_id ?? config.ARANDA_GROUP_ID;
    const responsibleId =
      row.mapped_user_id ??
      config.ARANDA_RESPONSIBLE_ID ??
      config.ARANDA_CUSTOMER_ID;

    // Mapear urgency/priority GLPI → Aranda. Si GLPI no tiene valor, usar el default de .env.
    const urgencyId = (row.urgency != null ? glpiUrgencyToAranda(row.urgency) : null) ?? config.ARANDA_URGENCY_ID;
    const priorityId = row.priority != null ? glpiPriorityToAranda(row.priority) : null;

    const body = [
      { Field: 'AuthorId',       Value: config.ARANDA_AUTHOR_ID },
      { Field: 'CategoryId',     Value: categoryId },
      { Field: 'CustomerId',     Value: config.ARANDA_CUSTOMER_ID },
      { Field: 'Description',    Value: desc || '(sin descripción)' },
      { Field: 'GroupId',        Value: groupId },
      { Field: 'ResponsibleId',  Value: responsibleId },
      { Field: 'ProjectId',      Value: config.ARANDA_PROJECT_ID },
      { Field: 'RegistryTypeId', Value: config.ARANDA_REGISTRY_TYPE_ID },
      { Field: 'ServiceId',      Value: config.ARANDA_SERVICE_ID },
      { Field: 'Subject',        Value: subj || '(sin asunto)' },
      { Field: 'SlaId',          Value: config.ARANDA_SLA_ID },
      { Field: 'UrgencyId',      Value: urgencyId }
    ];
    if (priorityId != null) {
      body.push({ Field: 'PriorityId', Value: priorityId });
    }
    if (config.ARANDA_COMPANY_ID != null) {
      body.push({ Field: 'CompanyId', Value: config.ARANDA_COMPANY_ID });
    }

    this.log.info(
      `Creando en Aranda ticket=${row.id} seg=${segment} cat=${categoryId}` +
      `${row.mapped_category_id ? ' (cat mapped)' : ' (cat default)'} ` +
      `group=${groupId}${row.mapped_group_id ? ` (label="${row.mapped_label}")` : ' (group default)'} ` +
      `responsible=${responsibleId}`,
      {
        ticket_id: row.id, direction: 'GLPI_TO_ARANDA',
        glpi_category: row.itilcategories_id, aranda_category: categoryId, aranda_segment: segment,
        aranda_group: groupId, aranda_responsible: responsibleId, responsable_label: row.mapped_label
      }
    );
    const obj = await arandaClient.addItem(segment, body);
    const ok = truthy(obj.result ?? obj.Result ?? true);
    if (!ok) throw new Error(`Aranda devolvió fallo: ${JSON.stringify(obj)}`);

    const arandaId = pickPossibleId(obj);
    const composedId = pickComposedId(obj);

    await this.markSynced(row.id, arandaId, composedId);
    await recordEvent({
      direction: 'GLPI_TO_ARANDA',
      entityType: 'ticket',
      srcId: row.id,
      dstId: arandaId
    });

    this.log.info(`Ticket ${row.id} → Aranda id=${arandaId} code=${composedId}`, { ticket_id: row.id, aranda_item_id: arandaId, direction: 'GLPI_TO_ARANDA' });
  }

  async markSynced(ticketId, arandaItemId, composedItemId) {
    await getDB().query(
      `INSERT INTO aranda_items
        (ticket_id, aranda_item_id, composed_item_id, origin, status, last_error)
       VALUES (?, ?, ?, 'GLPI', 'synced', NULL)
       ON DUPLICATE KEY UPDATE
         aranda_item_id   = VALUES(aranda_item_id),
         composed_item_id = VALUES(composed_item_id),
         status           = 'synced',
         last_error       = NULL`,
      [ticketId, arandaItemId ?? null, composedItemId ?? null]
    );
  }

  async markFailed(ticketId, errorMsg) {
    await getDB().query(
      `INSERT INTO aranda_items
        (ticket_id, aranda_item_id, composed_item_id, origin, status, last_error)
       VALUES (?, NULL, NULL, 'GLPI', 'failed', ?)
       ON DUPLICATE KEY UPDATE
         status     = 'failed',
         last_error = VALUES(last_error)`,
      [ticketId, String(errorMsg).slice(0, 2000)]
    );
  }
}
