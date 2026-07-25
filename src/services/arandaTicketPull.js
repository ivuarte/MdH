import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB, readCursor, writeCursor } from '../lib/db.js';
import { config } from '../config.js';
import { FROM_ARANDA_TAG, normalizeHtml } from '../lib/utils.js';
import { recordEvent } from '../lib/syncEvents.js';
import { arandaUrgencyToGlpi, arandaPriorityToGlpi } from '../lib/priorityMapping.js';

// Mapea estado Aranda → GLPI (estado nuevo en GLPI cuando se crea desde Aranda).
function initialGlpiStatusFromAranda(arandaStateId) {
  const s = Number(arandaStateId);
  if (s === 21 || s === 12) return 5; // Resuelto: 21 en SERVICIO / 12 en INCIDENTE
  if (s === 19) return 4;
  if (s === 20) return 2;
  return 1; // Nuevo
}

// Mapea segmento Aranda → tipo GLPI.
function glpiTypeFromArandaSegment(seg) {
  return Number(seg) === 4 ? 2 : 1;
}

// Trae casos creados en Aranda (no por el bot), los registra en aranda_inbound_items y los propaga como tickets en GLPI.
// Anti-bucle: filtra por AuthorId != ARANDA_AUTHOR_ID y descarta los que ya están en aranda_items.
export class ArandaTicketPullService extends BaseService {
  constructor(opts = {}) {
    super('arandaTicketPull', opts);
    this.processing = new Set();
    this.maxKnownId = 0;     // Cursor: máximo Id de Aranda ya conocido
    this.bootstrapped = false;
  }

  async onStart() {
    this.maxKnownId = Number(await readCursor('aranda_pull_max_id', '0')) || 0;
    this.log.info(`Cursor cargado maxKnownId=${this.maxKnownId}`);
  }

  async tick() {
    await this.discoverNewItems();
    await this.propagatePendingToGlpi();
  }

  // Paso 1: descubrir casos nuevos en Aranda y registrarlos como 'pending'.
  // En el PRIMER tick (bootstrap), marca los items existentes como 'ignored' sin propagarlos.
  // Esto evita re-importar historia completa de Aranda como nuevos tickets GLPI.
  async discoverNewItems() {
    const body = {
      Paging: { Start: 1, End: config.ARANDA_PULL_PAGE_SIZE, Size: 0 },
      Criteria: [],
      WhereCriteria: [],
      Order: { ColumnName: 'RegistrationDate', ModeId: 2 },
      ProjectId: config.ARANDA_PROJECT_ID,
      ViewId: 5
    };

    const res = await arandaClient.listItems(body);
    const data = res?.Data;
    if (!Array.isArray(data) || data.length === 0) return;

    const isBootstrap = !this.bootstrapped && this.maxKnownId === 0;
    if (isBootstrap) {
      this.log.info('Bootstrap: marcando items existentes como ignored para no re-importar historia');
    }

    let newMax = this.maxKnownId;

    for (const it of data) {
      if (this.stopping) return;
      const arandaItemId = Number(it?.Id);
      const authorId = Number(it?.AuthorId ?? it?.RegisterAuthorId ?? 0);
      const stateId = Number(it?.StateId);
      const composed = it?.ComposedId || it?.ComposedItemId || it?.composedItemId || null;
      const subject = it?.Subject || it?.Title || null;
      const description = it?.Description || it?.Detail || null;
      // CaseType es el discriminante real entre Incidencia (1) y Requerimiento (4) en ASDKAPI v8.6.
      // ProjectItemTypeId/ItemTypeId/RegistryTypeId no vienen en /item/list.
      const segment = Number(it?.CaseType || it?.ProjectItemTypeId || it?.ItemTypeId || 1);
      // Urgency/Priority vienen como Id=-1 cuando el caso fue creado por nuestro bot (Atena_GLPI
      // sin esos campos). Para casos humanos vienen valores reales. Capturamos para mapear a GLPI.
      const arandaUrgencyId = Number(it?.UrgencyId);
      const arandaPriorityId = Number(it?.PriorityId);
      // CategoryId: la subcategoría Aranda. Si está mapeada en service_catalog_sync,
      // permitirá fijar itilcategories_id en el ticket GLPI que crearemos abajo.
      const arandaCategoryId = Number(it?.CategoryId);

      if (!Number.isFinite(arandaItemId)) continue;
      if (arandaItemId > newMax) newMax = arandaItemId;

      // Anti-bucle 1: si el caso ya está en aranda_items, ya está mapeado → skip.
      const [[mapped]] = await getDB().query(
        `SELECT 1 FROM aranda_items WHERE aranda_item_id = ? LIMIT 1`,
        [arandaItemId]
      );
      if (mapped) continue;

      // Anti-bucle 2: si fue creado por nuestro bot, no es un caso "real" desde Aranda → skip.
      if (authorId === Number(config.ARANDA_AUTHOR_ID)) continue;

      // En bootstrap, marcar como 'ignored' (no se propagará a GLPI).
      // En operación normal, solo procesar si Id > cursor.
      let status;
      if (isBootstrap) {
        status = 'ignored';
      } else if (arandaItemId <= this.maxKnownId) {
        continue; // Item viejo ya conocido (que no llegó a aranda_items por algún motivo) — saltar.
      } else {
        status = 'pending';
      }

      await getDB().query(
        `INSERT IGNORE INTO aranda_inbound_items
          (aranda_item_id, composed_item_id, aranda_segment, subject, description, aranda_state_id, aranda_author_id, aranda_urgency_id, aranda_priority_id, aranda_category_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [arandaItemId, composed, segment, subject, description, stateId, authorId,
         Number.isFinite(arandaUrgencyId) ? arandaUrgencyId : null,
         Number.isFinite(arandaPriorityId) ? arandaPriorityId : null,
         Number.isFinite(arandaCategoryId) && arandaCategoryId > 0 ? arandaCategoryId : null,
         status]
      );
    }

    if (newMax !== this.maxKnownId) {
      this.maxKnownId = newMax;
      await writeCursor('aranda_pull_max_id', this.maxKnownId);
    }

    if (isBootstrap) this.bootstrapped = true;
  }

  // Paso 2: para cada inbound 'pending' o 'failed' (<5 tries), crear el ticket en GLPI.
  // LEFT JOIN con service_catalog_sync para resolver itilcategories_id desde la categoría Aranda.
  async propagatePendingToGlpi() {
    const [rows] = await getDB().query(
      `SELECT i.aranda_item_id, i.composed_item_id, i.aranda_segment, i.subject, i.description,
              i.aranda_state_id, i.aranda_urgency_id, i.aranda_priority_id, i.aranda_category_id,
              i.tries,
              scs.glpi_category_id AS mapped_glpi_category_id
         FROM aranda_inbound_items i
         LEFT JOIN service_catalog_sync scs
                ON scs.aranda_category_id = i.aranda_category_id
               AND scs.status = 'matched'
        WHERE i.status = 'pending'
           OR (i.status = 'failed' AND i.tries < 5)
        ORDER BY i.detected_at ASC
        LIMIT 25`
    );

    for (const row of rows) {
      if (this.stopping) return;
      if (this.processing.has(row.aranda_item_id)) continue;
      this.processing.add(row.aranda_item_id);

      try {
        const newGlpiTicketId = await this.createGlpiTicket(row);
        await getDB().query(
          `UPDATE aranda_inbound_items
              SET glpi_ticket_id = ?, status = 'synced', posted_at = NOW(), last_error = NULL
            WHERE aranda_item_id = ?`,
          [newGlpiTicketId, row.aranda_item_id]
        );
        // Registramos también el mapping en aranda_items con origin=ARANDA para que los servicios push NO lo reenvíen.
        await getDB().query(
          `INSERT INTO aranda_items
            (ticket_id, aranda_item_id, composed_item_id, origin, status, glpi_backlinked_at)
           VALUES (?, ?, ?, 'ARANDA', 'synced', NOW())
           ON DUPLICATE KEY UPDATE
             aranda_item_id = VALUES(aranda_item_id),
             composed_item_id = VALUES(composed_item_id),
             origin = 'ARANDA',
             status = 'synced'`,
          [newGlpiTicketId, row.aranda_item_id, row.composed_item_id || null]
        );

        await recordEvent({
          direction: 'ARANDA_TO_GLPI',
          entityType: 'ticket',
          srcId: row.aranda_item_id,
          dstId: newGlpiTicketId
        });

        this.log.info(`Aranda ${row.aranda_item_id} → GLPI ticket ${newGlpiTicketId}`, {
          aranda_item_id: row.aranda_item_id, ticket_id: newGlpiTicketId, direction: 'ARANDA_TO_GLPI'
        });
      } catch (err) {
        await getDB().query(
          `UPDATE aranda_inbound_items
              SET status = 'failed', tries = tries + 1, last_error = ?
            WHERE aranda_item_id = ?`,
          [String(err.message).slice(0, 2000), row.aranda_item_id]
        );
        this.log.error(`Pull→GLPI fallo aranda=${row.aranda_item_id}`, { err, aranda_item_id: row.aranda_item_id });
      } finally {
        this.processing.delete(row.aranda_item_id);
      }
    }
  }

  async createGlpiTicket(row) {
    const subj = normalizeHtml(row.subject || '(sin asunto)', 250);
    const desc = normalizeHtml(row.description || '', 50000);
    // El código Aranda (ComposedId) ya NO va en el contenido: se fija en el campo nativo
    // `externalid` del ticket (abajo). Mantenemos el marcador [from aranda] (sin id) como
    // pista humana de origen; el anti-bucle real es origin='ARANDA'.
    const fullContent = `${FROM_ARANDA_TAG}\n\n${desc}`;

    const type = glpiTypeFromArandaSegment(row.aranda_segment);
    const status = initialGlpiStatusFromAranda(row.aranda_state_id);
    // Mapear urgency/priority Aranda → GLPI. Si Aranda no tiene valor válido (-1 o null),
    // GLPI usará su default (típicamente urgency=3, priority=3).
    const urgency = (row.aranda_urgency_id > 0) ? arandaUrgencyToGlpi(row.aranda_urgency_id) : null;
    const priority = (row.aranda_priority_id > 0) ? arandaPriorityToGlpi(row.aranda_priority_id) : null;

    // Categoría: si la subcategoría Aranda está mapeada, fijamos la categoría GLPI correspondiente.
    const itilcategoryId = Number.isFinite(Number(row.mapped_glpi_category_id))
      ? Number(row.mapped_glpi_category_id) : null;

    const input = {
      name: subj,
      content: fullContent,
      type,
      status
    };
    // External ID = código Aranda (ComposedId), p.ej. "IM-370723-1-183378".
    if (row.composed_item_id) input.externalid = row.composed_item_id;
    if (urgency != null) input.urgency = urgency;
    if (priority != null) input.priority = priority;
    if (itilcategoryId != null) input.itilcategories_id = itilcategoryId;
    if (config.INBOUND_GLPI_REQUESTER_ID != null) {
      input._users_id_requester = config.INBOUND_GLPI_REQUESTER_ID;
    }

    const res = await glpiClient.createTicket(input);
    // GLPI devuelve [{id, message}] o {id, ...} dependiendo de la versión.
    let newId = null;
    if (Array.isArray(res)) {
      newId = Number(res[0]?.id);
    } else if (res && typeof res === 'object') {
      newId = Number(res.id);
    }
    if (!Number.isFinite(newId)) {
      throw new Error(`GLPI no devolvió id en createTicket: ${JSON.stringify(res)}`);
    }

    // Insertar también en tabla local tickets para que sea visible para el resto del pipeline
    // con origin=ARANDA — crítico para que arandaTicketPush NO lo reenvíe.
    await getDB().query(
      `INSERT INTO tickets
        (id, origin, nombre, status, type, urgency, priority, content, itilcategories_id)
       VALUES (?, 'ARANDA', ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         origin = 'ARANDA',
         nombre = VALUES(nombre),
         status = VALUES(status),
         type = VALUES(type),
         urgency = COALESCE(VALUES(urgency), urgency),
         priority = COALESCE(VALUES(priority), priority),
         content = COALESCE(VALUES(content), content),
         itilcategories_id = COALESCE(VALUES(itilcategories_id), itilcategories_id)`,
      [newId, subj, status, type, urgency, priority, fullContent, itilcategoryId]
    );

    return newId;
  }
}
