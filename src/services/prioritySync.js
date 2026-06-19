import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB } from '../lib/db.js';
import { config } from '../config.js';
import { truthy } from '../lib/utils.js';
import { recordEvent, recentInverseEvent } from '../lib/syncEvents.js';
import {
  glpiUrgencyToAranda, glpiPriorityToAranda,
  arandaUrgencyToGlpi, arandaPriorityToGlpi
} from '../lib/priorityMapping.js';

function arandaSegmentFromGlpiType(type) {
  return Number(type) === 2 ? 4 : 1;
}

// Sincronización bidireccional de urgency y priority entre GLPI y Aranda, en cada tick.
// Funciona como statusSync pero para los campos de prioridad. Anti-eco vía sync_events.
//
// Limitaciones conocidas (ver ARQUITECTURA.md sección Limitaciones):
//   - Aranda Urgency sólo tiene 3 niveles (LOW/HIGH/CRITICAL). Mapeo es lossy: GLPI 3 y 4 colapsan
//     en Aranda HIGH y al volver se mapea a GLPI 3 (no se preserva el valor exacto).
//   - Aranda Impact no es accesible vía API → no se sincroniza el campo impact de GLPI.
//   - El push de Aranda updateItem exige Commentary cuando cambia campos — incluso urgency/priority.
//     Por eso enviamos un Commentary minimalista cuando hacemos update aquí.
export class PrioritySyncService extends BaseService {
  constructor(opts = {}) {
    super('prioritySync', opts);
    this.processingPush = new Set();
    this.processingPull = false;
  }

  async tick() {
    await Promise.all([
      this.pushGlpiToAranda().catch(err => this.log.error('push exception', { err })),
      this.pullArandaToGlpi().catch(err => this.log.error('pull exception', { err }))
    ]);
  }

  // GLPI → Aranda: si la urgency o priority del ticket no coincide con la última pusheada, actualizar.
  async pushGlpiToAranda() {
    // <=> es NULL-safe equality (MariaDB/MySQL). "NOT (a <=> b)" es "a IS DISTINCT FROM b".
    // Excluimos tickets cerrados (status 5,6) — no tiene sentido reajustar prioridad de algo cerrado.
    // Excluimos tickets con last_error permanente (InvalidItemId/UserNotAllowedToEdit) — son
    // casos viejos donde Aranda rechaza el update y no podemos hacer nada al respecto.
    const [rows] = await getDB().query(
      `SELECT t.id AS ticket_id, t.urgency, t.priority, t.type AS glpi_type,
              ai.aranda_item_id,
              aps.last_glpi_urgency, aps.last_glpi_priority
         FROM tickets t
         JOIN aranda_items ai ON ai.ticket_id = t.id
         LEFT JOIN aranda_priority_sync aps ON aps.ticket_id = t.id
        WHERE ai.status = 'synced'
          AND ai.origin = 'GLPI'
          AND (t.status IS NULL OR t.status NOT IN (5,6))
          AND (t.urgency IS NOT NULL OR t.priority IS NOT NULL)
          AND (aps.ticket_id IS NULL
               OR NOT (aps.last_glpi_urgency  <=> t.urgency)
               OR NOT (aps.last_glpi_priority <=> t.priority))
          AND (aps.last_error IS NULL
               OR aps.last_error NOT LIKE 'PERMANENT:%')
        ORDER BY t.id ASC
        LIMIT 50`
    );

    for (const row of rows) {
      if (this.stopping) return;
      const { ticket_id, urgency, priority, glpi_type, aranda_item_id } = row;
      const arandaUrgency  = urgency  != null ? glpiUrgencyToAranda(urgency)   : null;
      const arandaPriority = priority != null ? glpiPriorityToAranda(priority) : null;
      if (arandaUrgency == null && arandaPriority == null) continue;

      // Anti-eco: si Aranda nos empujó la misma prioridad recientemente, no rebotamos.
      if (await recentInverseEvent({
        direction: 'GLPI_TO_ARANDA', entityType: 'priority', srcId: ticket_id, dstId: aranda_item_id
      })) {
        await this.markPushSynced(ticket_id, aranda_item_id, urgency, priority, arandaUrgency, arandaPriority);
        continue;
      }

      if (this.processingPush.has(ticket_id)) continue;
      this.processingPush.add(ticket_id);

      try {
        const segment = arandaSegmentFromGlpiType(glpi_type);
        const fields = [];
        if (arandaUrgency  != null) fields.push({ Field: 'UrgencyId',  Value: arandaUrgency  });
        if (arandaPriority != null) fields.push({ Field: 'PriorityId', Value: arandaPriority });
        fields.push({ Field: 'Commentary', Value: 'Prioridad/urgencia sincronizada desde GLPI' });

        let obj;
        try {
          obj = await arandaClient.updateItem(aranda_item_id, segment, config.ARANDA_AUTHOR_ID, fields);
        } catch (err) {
          const status = err?.response?.status;
          const body = String(err?.response?.data || '');
          const isBusinessError = /TaskPending|UnauthorizedCaseClosure|InvalidCommentary|InvalidState/i.test(body);
          if (!isBusinessError && (status === 404 || status === 400)) {
            const altSegment = segment === 1 ? 4 : 1;
            obj = await arandaClient.updateItem(aranda_item_id, altSegment, config.ARANDA_AUTHOR_ID, fields).catch(() => { throw err; });
          } else { throw err; }
        }
        const ok = truthy(obj.result ?? obj.Result ?? true);
        if (!ok) throw new Error(`Aranda update fallo: ${JSON.stringify(obj)}`);

        await this.markPushSynced(ticket_id, aranda_item_id, urgency, priority, arandaUrgency, arandaPriority);
        await recordEvent({
          direction: 'GLPI_TO_ARANDA', entityType: 'priority',
          srcId: ticket_id, dstId: aranda_item_id, content: `u=${arandaUrgency} p=${arandaPriority}`
        });
        this.log.info(`Prioridad ticket=${ticket_id} → urgency=${arandaUrgency} priority=${arandaPriority}`, {
          ticket_id, aranda_item_id, direction: 'GLPI_TO_ARANDA'
        });
      } catch (err) {
        const status = err?.response?.status;
        const body = String(err?.response?.data || '').slice(0, 200);
        // Errores permanentes: el caso ya no existe en Aranda (404 InvalidItemId), o no podemos
        // editarlo por permisos (403 UserNotAllowedToEdit), o estado destino bloqueado. Marcamos con
        // prefijo "PERMANENT:" para excluir de futuros SELECTs y no martillar.
        const isPermanent =
          /InvalidItemId|UserNotAllowedToEdit|UnauthorizedCaseClosure/i.test(body) ||
          status === 403;
        const errorTag = isPermanent ? 'PERMANENT' : 'RETRY';
        await getDB().query(
          `INSERT INTO aranda_priority_sync (ticket_id, aranda_item_id, last_error)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE last_error = VALUES(last_error), updated_at = NOW()`,
          [ticket_id, aranda_item_id, `${errorTag}: HTTP ${status}: ${body || err.message}`.slice(0, 2000)]
        );
        this.log[isPermanent ? 'info' : 'warn'](`Push prioridad ${errorTag.toLowerCase()} ticket=${ticket_id}`, { ticket_id, status, body });
      } finally {
        this.processingPush.delete(ticket_id);
      }
    }
  }

  async markPushSynced(ticketId, arandaItemId, glpiU, glpiP, arandaU, arandaP) {
    await getDB().query(
      `INSERT INTO aranda_priority_sync
        (ticket_id, aranda_item_id, last_glpi_urgency, last_glpi_priority, last_aranda_urgency, last_aranda_priority, last_push_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         last_glpi_urgency    = VALUES(last_glpi_urgency),
         last_glpi_priority   = VALUES(last_glpi_priority),
         last_aranda_urgency  = VALUES(last_aranda_urgency),
         last_aranda_priority = VALUES(last_aranda_priority),
         last_push_at         = NOW(),
         last_error           = NULL`,
      [ticketId, arandaItemId, glpiU ?? null, glpiP ?? null, arandaU ?? null, arandaP ?? null]
    );
  }

  // Aranda → GLPI: barrido vía /item/list, detecta cambios en urgency/priority y actualiza GLPI.
  async pullArandaToGlpi() {
    if (this.processingPull) return;
    this.processingPull = true;
    try {
      const body = {
        Paging: { Start: 1, End: config.ARANDA_PULL_PAGE_SIZE, Size: 0 },
        Criteria: [
          { FieldName: 'AuthorId', Value: String(config.ARANDA_AUTHOR_ID), LogicOperatorId: 1, ComparisonOperatorId: 5 }
        ],
        WhereCriteria: [],
        Order: { ColumnName: 'RegistrationDate', ModeId: 2 },
        ProjectId: config.ARANDA_PROJECT_ID,
        ViewId: 5
      };
      const res = await arandaClient.listItems(body);
      const data = res?.Data;
      if (!Array.isArray(data) || data.length === 0) return;

      for (const it of data) {
        if (this.stopping) return;
        const arandaItemId = Number(it?.Id);
        const arandaUrgencyId  = Number(it?.UrgencyId);
        const arandaPriorityId = Number(it?.PriorityId);
        if (!Number.isFinite(arandaItemId)) continue;

        const [[mapRow]] = await getDB().query(
          `SELECT ticket_id FROM aranda_items WHERE aranda_item_id = ? AND origin = 'GLPI' LIMIT 1`,
          [arandaItemId]
        );
        if (!mapRow) continue;
        const ticketId = mapRow.ticket_id;

        // -1 en Aranda significa "no establecido" — saltamos.
        const wantUrgency  = arandaUrgencyId  > 0 ? arandaUrgencyToGlpi(arandaUrgencyId)   : null;
        const wantPriority = arandaPriorityId > 0 ? arandaPriorityToGlpi(arandaPriorityId) : null;
        if (wantUrgency == null && wantPriority == null) continue;

        const [[tRow]] = await getDB().query(
          `SELECT urgency, priority FROM tickets WHERE id = ? LIMIT 1`,
          [ticketId]
        );
        if (!tRow) continue;

        // Anti-eco: si GLPI acaba de empujar lo mismo, no aplicamos.
        if (await recentInverseEvent({
          direction: 'ARANDA_TO_GLPI', entityType: 'priority', srcId: arandaItemId, dstId: ticketId
        })) {
          await this.markPullObserved(ticketId, arandaItemId, arandaUrgencyId, arandaPriorityId);
          continue;
        }

        const changes = {};
        if (wantUrgency  != null && Number(tRow.urgency)  !== wantUrgency)  changes.urgency  = wantUrgency;
        if (wantPriority != null && Number(tRow.priority) !== wantPriority) changes.priority = wantPriority;
        if (Object.keys(changes).length === 0) {
          await this.markPullObserved(ticketId, arandaItemId, arandaUrgencyId, arandaPriorityId);
          continue;
        }

        try {
          await glpiClient.updateTicket({ id: ticketId, ...changes });
          // Cache local: glpiTicketSync depende de /Log que rota; mantenemos consistencia local.
          const setClauses = [];
          const args = [];
          if ('urgency'  in changes) { setClauses.push('urgency = ?');  args.push(changes.urgency); }
          if ('priority' in changes) { setClauses.push('priority = ?'); args.push(changes.priority); }
          args.push(ticketId);
          await getDB().query(`UPDATE tickets SET ${setClauses.join(', ')} WHERE id = ?`, args);

          await this.markPullSynced(ticketId, arandaItemId, changes.urgency ?? tRow.urgency, changes.priority ?? tRow.priority, arandaUrgencyId, arandaPriorityId);
          await recordEvent({
            direction: 'ARANDA_TO_GLPI', entityType: 'priority',
            srcId: arandaItemId, dstId: ticketId, content: JSON.stringify(changes)
          });
          this.log.info(`Prioridad aranda=${arandaItemId} → ticket=${ticketId} ${JSON.stringify(changes)}`, {
            ticket_id: ticketId, aranda_item_id: arandaItemId, direction: 'ARANDA_TO_GLPI'
          });
        } catch (err) {
          this.log.warn(`Pull prioridad fallo ticket=${ticketId}`, { ticket_id: ticketId, err });
        }
      }
    } finally {
      this.processingPull = false;
    }
  }

  async markPullSynced(ticketId, arandaItemId, glpiU, glpiP, arandaU, arandaP) {
    await getDB().query(
      `INSERT INTO aranda_priority_sync
        (ticket_id, aranda_item_id, last_glpi_urgency, last_glpi_priority, last_aranda_urgency, last_aranda_priority, last_pull_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         last_glpi_urgency    = VALUES(last_glpi_urgency),
         last_glpi_priority   = VALUES(last_glpi_priority),
         last_aranda_urgency  = VALUES(last_aranda_urgency),
         last_aranda_priority = VALUES(last_aranda_priority),
         last_pull_at         = NOW(),
         last_error           = NULL`,
      [ticketId, arandaItemId, glpiU ?? null, glpiP ?? null, arandaU ?? null, arandaP ?? null]
    );
  }

  // No tocamos last_glpi_*: si el pull no aplicó cambios, el push tampoco debe creer que está sincronizado.
  async markPullObserved(ticketId, arandaItemId, arandaU, arandaP) {
    await getDB().query(
      `INSERT INTO aranda_priority_sync
        (ticket_id, aranda_item_id, last_aranda_urgency, last_aranda_priority, last_pull_at, last_error)
       VALUES (?, ?, ?, ?, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         last_aranda_urgency  = VALUES(last_aranda_urgency),
         last_aranda_priority = VALUES(last_aranda_priority),
         last_pull_at         = NOW(),
         last_error           = NULL`,
      [ticketId, arandaItemId, arandaU ?? null, arandaP ?? null]
    );
  }
}
