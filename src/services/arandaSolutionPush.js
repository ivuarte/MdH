import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { getDB } from '../lib/db.js';
import { config } from '../config.js';
import { truthy } from '../lib/utils.js';
import { recordEvent } from '../lib/syncEvents.js';

function arandaSegmentFromGlpiType(type) {
  return Number(type) === 2 ? 4 : 1;
}

// Propaga ticket_solutions origin=GLPI a Aranda usando /item/update con Commentary.
export class ArandaSolutionPushService extends BaseService {
  constructor(opts = {}) {
    super('arandaSolutionPush', opts);
    this.processing = new Set();
  }

  async tick() {
    const [rows] = await getDB().query(
      `SELECT
         s.solution_id, s.ticket_id, s.content,
         t.type AS glpi_type,
         ai.aranda_item_id,
         COALESCE(asu.tries, 0) AS tries,
         asu.status AS prev_status
       FROM ticket_solutions s
       JOIN tickets t       ON t.id = s.ticket_id
       JOIN aranda_items ai ON ai.ticket_id = s.ticket_id
       LEFT JOIN aranda_solution_updates asu ON asu.solution_id = s.solution_id
       WHERE (asu.solution_id IS NULL OR (asu.status = 'failed' AND asu.tries < 5))
         AND s.origin = 'GLPI'
       ORDER BY s.solution_id ASC
       LIMIT 100`
    );

    for (const row of rows) {
      if (this.stopping) return;
      const { solution_id, ticket_id, content, glpi_type, aranda_item_id, tries } = row;
      if (this.processing.has(solution_id)) continue;
      this.processing.add(solution_id);

      try {
        const segment = arandaSegmentFromGlpiType(glpi_type);
        const fields = [{ Field: 'Commentary', Value: content || '' }];
        let obj;
        try {
          obj = await arandaClient.updateItem(aranda_item_id, segment, config.ARANDA_AUTHOR_ID, fields);
        } catch (err) {
          if (err?.response?.status === 404) {
            const altSegment = segment === 1 ? 4 : 1;
            this.log.warn(`updateItem 404 con segmento=${segment}, reintentando con segmento=${altSegment}`, { ticket_id, aranda_item_id });
            obj = await arandaClient.updateItem(aranda_item_id, altSegment, config.ARANDA_AUTHOR_ID, fields);
          } else {
            throw err;
          }
        }
        const ok = truthy(obj.result ?? obj.Result ?? true);
        if (!ok) throw new Error(`Aranda devolvió fallo: ${JSON.stringify(obj)}`);

        await this.markSynced(ticket_id, aranda_item_id, solution_id);
        await recordEvent({
          direction: 'GLPI_TO_ARANDA',
          entityType: 'solution',
          srcId: solution_id,
          dstId: aranda_item_id,
          content
        });
        this.log.info(`Solución enviada ticket=${ticket_id} sol=${solution_id}`, { ticket_id, solution_id, aranda_item_id, direction: 'GLPI_TO_ARANDA' });
      } catch (err) {
        await this.markFailed(ticket_id, aranda_item_id, solution_id, err.message, tries);
        this.log.error(`Solución fallo ticket=${ticket_id} sol=${solution_id}`, { err, ticket_id, solution_id });
      } finally {
        this.processing.delete(solution_id);
      }
    }
  }

  async markSynced(ticketId, arandaItemId, solutionId) {
    await getDB().query(
      `INSERT INTO aranda_solution_updates
        (solution_id, ticket_id, aranda_item_id, status, tries, last_error, posted_at)
       VALUES (?, ?, ?, 'synced', 1, NULL, NOW())
       ON DUPLICATE KEY UPDATE
         status = 'synced', last_error = NULL, posted_at = NOW()`,
      [solutionId, ticketId, arandaItemId]
    );
  }

  async markFailed(ticketId, arandaItemId, solutionId, errorMsg, tries = 0) {
    await getDB().query(
      `INSERT INTO aranda_solution_updates
        (solution_id, ticket_id, aranda_item_id, status, tries, last_error)
       VALUES (?, ?, ?, 'failed', ?, ?)
       ON DUPLICATE KEY UPDATE
         status = 'failed', tries = tries + 1, last_error = VALUES(last_error)`,
      [solutionId, ticketId, arandaItemId, (Number(tries) || 0) + 1, String(errorMsg).slice(0, 2000)]
    );
  }
}
