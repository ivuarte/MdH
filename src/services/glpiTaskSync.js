import { BaseService } from '../lib/baseService.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB } from '../lib/db.js';
import { extractStr, normalizeHtml, hasArandaMarker } from '../lib/utils.js';

// Detecta nuevas TicketTask en GLPI haciendo polling directo por cada ticket mapeado en aranda_items.
// No usamos /Log porque la instancia GLPI tiene rotación muy agresiva (sólo 15 entries totales en /Log
// con range 0-499) y no aparecen entries con itemtype_link='TicketTask' confiables.
//
// Para cada ticket activo con mapping, llama GET /Ticket/{id}/TicketTask y compara contra la tabla
// local ticket_tasks. Las que falten se registran con origin=GLPI para que arandaTasksPush las propague.
// Tareas con marker [from aranda] se marcan como origin=ARANDA (anti-bucle: vinieron de Aranda).
export class GlpiTaskSyncService extends BaseService {
  constructor(opts = {}) {
    super('glpiTaskSync', opts);
    this.processing = new Set();
  }

  async tick() {
    // Procesamos todos los tickets mapeados, ordenando activos primero (status<5) y luego cerrados.
    // No excluimos cerrados porque el operador puede agregar tareas a tickets resueltos/cerrados.
    const [tickets] = await getDB().query(
      `SELECT t.id, ai.aranda_item_id
         FROM tickets t
         JOIN aranda_items ai ON ai.ticket_id = t.id
        WHERE ai.aranda_item_id IS NOT NULL
          AND ai.status = 'synced'
        ORDER BY (t.status IN (5,6)) ASC, t.updated_at DESC
        LIMIT 200`
    );

    for (const t of tickets) {
      if (this.stopping) return;
      const ticketId = Number(t.id);
      if (this.processing.has(ticketId)) continue;
      this.processing.add(ticketId);

      try {
        await this.syncTicketTasks(ticketId);
      } catch (err) {
        this.log.error(`syncTicketTasks ticket=${ticketId} error`, { err, ticket_id: ticketId });
      } finally {
        this.processing.delete(ticketId);
      }
    }
  }

  async syncTicketTasks(ticketId) {
    let tasks;
    try {
      tasks = await glpiClient.getTicketTasks(ticketId);
    } catch (err) {
      if (err?.response?.status === 404) return; // ticket sin tareas o no accesible
      throw err;
    }
    if (!Array.isArray(tasks) || tasks.length === 0) return;

    for (const t of tasks) {
      const taskId = Number(t?.id);
      if (!Number.isFinite(taskId)) continue;

      const [[exists]] = await getDB().query(
        `SELECT origin FROM ticket_tasks WHERE task_id = ? LIMIT 1`,
        [taskId]
      );
      if (exists) continue;

      const userName = extractStr(t.users_id);
      const content = normalizeHtml(t.content, 50000);
      const date = t.date || t.date_creation || null;
      const state = Number.isFinite(Number(t.state)) ? Number(t.state) : null;

      // Si la tarea ya tiene marker [from aranda], es eco — origin=ARANDA.
      const origin = hasArandaMarker(content) ? 'ARANDA' : 'GLPI';

      await getDB().query(
        `INSERT IGNORE INTO ticket_tasks
          (task_id, ticket_id, user_name, content, date, state, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [taskId, ticketId, userName, content, date, state, origin]
      );

      this.log.info(`Task GLPI detectada ticket=${ticketId} task=${taskId} origin=${origin}`, {
        ticket_id: ticketId, task_id: taskId, direction: 'GLPI_TO_DB', origin
      });
    }
  }
}
