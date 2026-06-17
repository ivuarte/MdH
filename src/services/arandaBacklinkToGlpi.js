import { BaseService } from '../lib/baseService.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB } from '../lib/db.js';
import { FROM_ARANDA_TAG } from '../lib/utils.js';

// Una vez que un ticket GLPI fue creado en Aranda, deja un followup en GLPI con el código Aranda.
// Solo aplica a mappings origin=GLPI (los origin=ARANDA ya tienen el código en su contenido inicial).
export class ArandaBacklinkToGlpiService extends BaseService {
  constructor(opts = {}) {
    super('arandaBacklinkToGlpi', opts);
    this.processing = new Set();
  }

  async tick() {
    const [rows] = await getDB().query(
      `SELECT ticket_id, composed_item_id
         FROM aranda_items
        WHERE composed_item_id IS NOT NULL
          AND composed_item_id <> ''
          AND glpi_backlinked_at IS NULL
          AND origin = 'GLPI'
        ORDER BY ticket_id ASC
        LIMIT 50`
    );

    for (const row of rows) {
      if (this.stopping) return;
      if (this.processing.has(row.ticket_id)) continue;
      this.processing.add(row.ticket_id);

      try {
        const content = `${FROM_ARANDA_TAG} caso aranda: ${row.composed_item_id}`;
        await glpiClient.addFollowup(row.ticket_id, content);
        await getDB().query(
          `UPDATE aranda_items
             SET glpi_backlinked_at = NOW(),
                 glpi_backlink_error = NULL
           WHERE ticket_id = ?`,
          [row.ticket_id]
        );
        this.log.info(`Backlink publicado ticket=${row.ticket_id} code=${row.composed_item_id}`, { ticket_id: row.ticket_id, direction: 'ARANDA_TO_GLPI' });
      } catch (err) {
        await getDB().query(
          `UPDATE aranda_items SET glpi_backlink_error = ? WHERE ticket_id = ?`,
          [String(err.message).slice(0, 2000), row.ticket_id]
        );
        this.log.error(`Backlink falló ticket=${row.ticket_id}`, { err, ticket_id: row.ticket_id });
      } finally {
        this.processing.delete(row.ticket_id);
      }
    }
  }
}
