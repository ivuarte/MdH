import { BaseService } from '../lib/baseService.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB, readCursor, writeCursor } from '../lib/db.js';
import { extractStr, normalizeHtml, parseNumericId } from '../lib/utils.js';

function formatBlock({ user, content, date }) {
  return [
    '****************************',
    `user: ${user || ''}`.trim(),
    `solucion: ${content || ''}`.trim(),
    `fecha: ${date || ''}`.trim(),
    '****************************'
  ].join('\n');
}

function parseTicketIdFromLinks(links) {
  if (!Array.isArray(links)) return null;
  for (const lk of links) {
    const href = lk?.href || '';
    const m = href.match(/\/Ticket\/(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

// Detecta soluciones nuevas en GLPI vía /log y las apila en tickets.ITILSolution + ticket_solutions.
export class GlpiSolutionSyncService extends BaseService {
  constructor(opts = {}) {
    super('glpiSolutionSync', opts);
    this.filterUser = opts.GLPI_FILTER_USER || null;
    this.lastSeenLogId = 0;
    this.processing = new Set();
  }

  async onStart() {
    this.lastSeenLogId = Number(await readCursor('glpi_solution_log_cursor', '0')) || 0;
    this.log.info(`Cursor lastSeenLogId=${this.lastSeenLogId}`);
  }

  async tick() {
    const logs = await glpiClient.getLog();
    if (!Array.isArray(logs) || logs.length === 0) return;

    const filtered = logs
      .filter(l => {
        const a = l?.itemtype === 'Ticket' && l?.itemtype_link === 'ITILSolution';
        const b = l?.itemtype === 'ITILSolution';
        const userOK = this.filterUser ? l?.user_name === this.filterUser : true;
        return (a || b) && userOK;
      })
      .sort((a, b) => a.id - b.id);

    for (const log of filtered) {
      if (this.stopping) return;
      if (log.id <= this.lastSeenLogId) continue;

      let ticketId = null;
      let solutionId = null;

      if (log.itemtype === 'Ticket') {
        ticketId = Number(log.items_id);
        solutionId = parseNumericId(log.new_value);
      } else {
        solutionId = Number(log.items_id);
        try {
          const sol = await glpiClient.get(`/ITILSolution/${solutionId}?expand_dropdowns=true`);
          ticketId = parseTicketIdFromLinks(sol?.links);
        } catch (err) {
          this.log.warn(`No se pudo resolver ticketId desde ITILSolution/${solutionId}`, { err });
        }
      }

      if (!Number.isFinite(solutionId) || !Number.isFinite(ticketId)) {
        this.log.warn(`solution/ticket no resueltos en log ${log.id}`);
        this.lastSeenLogId = Math.max(this.lastSeenLogId, log.id);
        await writeCursor('glpi_solution_log_cursor', this.lastSeenLogId);
        continue;
      }

      if (this.processing.has(solutionId)) continue;
      this.processing.add(solutionId);

      try {
        if (await this.isProcessed(solutionId)) {
          this.lastSeenLogId = Math.max(this.lastSeenLogId, log.id);
          await writeCursor('glpi_solution_log_cursor', this.lastSeenLogId);
          continue;
        }

        const list = await glpiClient.getTicketSolutions(ticketId);
        const sol = Array.isArray(list) ? list.find(x => Number(x?.id) === solutionId) : null;
        if (!sol) {
          this.log.warn(`Solution ${solutionId} no en Ticket ${ticketId} (latencia)`);
          continue;
        }

        const userName = extractStr(sol.users_id);
        const content = normalizeHtml(sol.content);
        const date = sol.date_creation || sol.date_mod || null;

        await this.appendBlock(ticketId, formatBlock({ user: userName, content, date }));
        await this.markProcessed({ solutionId, ticketId, userName, content, date });

        this.log.info(`Solution ${solutionId} agregada a ticket ${ticketId}`, { ticket_id: ticketId, solution_id: solutionId, direction: 'GLPI_TO_DB' });

        this.lastSeenLogId = Math.max(this.lastSeenLogId, log.id);
        await writeCursor('glpi_solution_log_cursor', this.lastSeenLogId);
      } catch (err) {
        this.log.error(`Solution ${solutionId} ticket ${ticketId} error`, { err, ticket_id: ticketId, solution_id: solutionId });
      } finally {
        this.processing.delete(solutionId);
      }
    }
  }

  async isProcessed(solutionId) {
    const [rows] = await getDB().query(
      `SELECT 1 FROM ticket_solutions WHERE solution_id = ? LIMIT 1`,
      [solutionId]
    );
    return rows.length > 0;
  }

  async appendBlock(ticketId, block) {
    await getDB().query(
      `UPDATE tickets
         SET ITILSolution = CASE
           WHEN ITILSolution IS NULL OR ITILSolution = '' THEN CONCAT(?, '\n')
           ELSE CONCAT(ITILSolution,
                       CASE WHEN RIGHT(ITILSolution, 1) = '\n' THEN '' ELSE '\n' END,
                       ?, '\n')
         END
       WHERE id = ?`,
      [block, block, ticketId]
    );
  }

  async markProcessed({ solutionId, ticketId, userName, content, date }) {
    await getDB().query(
      `INSERT IGNORE INTO ticket_solutions
        (solution_id, ticket_id, user_name, content, date_creation, origin)
       VALUES (?, ?, ?, ?, ?, 'GLPI')`,
      [solutionId, ticketId, userName || null, content || null, date || null]
    );
  }
}
