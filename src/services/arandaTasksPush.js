import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { getDB } from '../lib/db.js';
import { truthy, hasArandaMarker, TASK_FROM_GLPI_MARKER } from '../lib/utils.js';
import { recordEvent } from '../lib/syncEvents.js';

function arandaSegmentFromGlpiType(type) {
  return Number(type) === 2 ? 4 : 1;
}

// Propaga ticket_tasks origin=GLPI a Aranda como NOTAS con prefijo [Tarea GLPI].
// Razón: la API ASDKAPI v8.6 disponible para Atena_GLPI no expone un endpoint CRUD para tareas
// (/task/list devuelve [] siempre, /casetask requiere otros permisos). La representación
// equivalente más cercana es una nota etiquetada como tarea.
// Anti-bucle:
//   - Sólo se procesan origin='GLPI' (las origin='ARANDA' las creó el pull, no reenviar).
//   - Si el contenido ya tiene marker [from aranda] → es eco, marcar como synced y skip.
export class ArandaTasksPushService extends BaseService {
  constructor(opts = {}) {
    super('arandaTasksPush', opts);
    this.processing = new Set();
  }

  async tick() {
    const [rows] = await getDB().query(
      `SELECT
         tk.task_id, tk.ticket_id, tk.content, tk.origin, tk.user_name, tk.date,
         t.type AS glpi_type,
         ai.aranda_item_id,
         COALESCE(an.tries, 0) AS tries
       FROM ticket_tasks tk
       JOIN tickets t       ON t.id = tk.ticket_id
       JOIN aranda_items ai ON ai.ticket_id = tk.ticket_id
       LEFT JOIN aranda_task_notes an ON an.task_id = tk.task_id
       WHERE (an.task_id IS NULL OR (an.status = 'failed' AND an.tries < 5))
         AND tk.origin = 'GLPI'
         AND ai.origin = 'GLPI'
       ORDER BY tk.task_id ASC
       LIMIT 100`
    );

    for (const row of rows) {
      if (this.stopping) return;
      const { task_id, ticket_id, content, glpi_type, aranda_item_id, user_name, tries } = row;

      // Doble check anti-bucle: si el contenido empieza con marker, fue creado por arandaNotesPull (eco).
      if (hasArandaMarker(content)) {
        await this.markSynced(ticket_id, aranda_item_id, task_id);
        continue;
      }

      if (this.processing.has(task_id)) continue;
      this.processing.add(task_id);

      try {
        const segment = arandaSegmentFromGlpiType(glpi_type);
        const userTag = user_name ? `${user_name} — ` : '';
        // Normaliza la fecha (Date | string) a 'YYYY-MM-DD HH:mm:ss' para que el operador la lea bien en Aranda.
        let dateStr = '';
        if (row.date) {
          const d = row.date instanceof Date ? row.date : new Date(row.date);
          dateStr = Number.isNaN(d.getTime()) ? String(row.date) : d.toISOString().slice(0, 19).replace('T', ' ');
        }
        const body = `${TASK_FROM_GLPI_MARKER} ${userTag}${dateStr}\n\n${content || ''}`.trim();

        let obj;
        try {
          obj = await arandaClient.addNote(aranda_item_id, segment, { description: body });
        } catch (err) {
          if (err?.response?.status === 404) {
            const altSegment = segment === 1 ? 4 : 1;
            this.log.warn(`addNote (task) 404 con segmento=${segment}, reintentando con segmento=${altSegment}`, { ticket_id, aranda_item_id });
            obj = await arandaClient.addNote(aranda_item_id, altSegment, { description: body });
          } else {
            throw err;
          }
        }
        const ok = truthy(obj.result ?? obj.Result ?? true);
        if (!ok) throw new Error(`Aranda devolvió fallo: ${JSON.stringify(obj)}`);

        await this.markSynced(ticket_id, aranda_item_id, task_id);
        await recordEvent({
          direction: 'GLPI_TO_ARANDA', entityType: 'task',
          srcId: task_id, dstId: aranda_item_id, content
        });
        this.log.info(`Tarea enviada ticket=${ticket_id} task=${task_id} → aranda=${aranda_item_id}`, {
          ticket_id, task_id, aranda_item_id, direction: 'GLPI_TO_ARANDA'
        });
      } catch (err) {
        await this.markFailed(ticket_id, aranda_item_id, task_id, err.message, tries);
        this.log.error(`Tarea fallo ticket=${ticket_id} task=${task_id}`, { err, ticket_id, task_id });
      } finally {
        this.processing.delete(task_id);
      }
    }
  }

  async markSynced(ticketId, arandaItemId, taskId) {
    await getDB().query(
      `INSERT INTO aranda_task_notes
        (task_id, ticket_id, aranda_item_id, status, tries, last_error, posted_at)
       VALUES (?, ?, ?, 'synced', 1, NULL, NOW())
       ON DUPLICATE KEY UPDATE
         status = 'synced', last_error = NULL, posted_at = NOW()`,
      [taskId, ticketId, arandaItemId]
    );
  }

  async markFailed(ticketId, arandaItemId, taskId, errorMsg, tries = 0) {
    await getDB().query(
      `INSERT INTO aranda_task_notes
        (task_id, ticket_id, aranda_item_id, status, tries, last_error)
       VALUES (?, ?, ?, 'failed', ?, ?)
       ON DUPLICATE KEY UPDATE
         status = 'failed', tries = tries + 1, last_error = VALUES(last_error)`,
      [taskId, ticketId, arandaItemId, (Number(tries) || 0) + 1, String(errorMsg).slice(0, 2000)]
    );
  }
}
