import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { getDB } from '../lib/db.js';
import { truthy, hasArandaMarker, NOTE_FROM_GLPI_MARKER } from '../lib/utils.js';
import { recordEvent } from '../lib/syncEvents.js';

function arandaSegmentFromGlpiType(type) {
  return Number(type) === 2 ? 4 : 1;
}

// Propaga ticket_followups (origin=GLPI) a Aranda como notas.
// Anti-bucle: salta los que tengan marcador FROM_ARANDA_TAG o "caso aranda:" — fueron creados por arandaBacklinkToGlpi o por arandaNotesPull.
export class ArandaNotesPushService extends BaseService {
  constructor(opts = {}) {
    super('arandaNotesPush', opts);
    this.processing = new Set();
  }

  async tick() {
    const [rows] = await getDB().query(
      `SELECT
         f.followup_id, f.ticket_id, f.content, f.origin,
         t.type AS glpi_type,
         ai.aranda_item_id,
         COALESCE(an.tries, 0) AS tries,
         an.status AS prev_status
       FROM ticket_followups f
       JOIN tickets t       ON t.id = f.ticket_id
       JOIN aranda_items ai ON ai.ticket_id = f.ticket_id
       LEFT JOIN aranda_followup_notes an ON an.followup_id = f.followup_id
       WHERE (an.followup_id IS NULL OR (an.status = 'failed' AND an.tries < 5))
         AND f.origin = 'GLPI'
       ORDER BY f.followup_id ASC
       LIMIT 100`
    );

    for (const row of rows) {
      if (this.stopping) return;
      const { followup_id, ticket_id, content, glpi_type, aranda_item_id, tries } = row;

      // Anti-bucle: followups con marker fueron creados por este sistema replicando desde Aranda.
      if (hasArandaMarker(content)) {
        await this.markSynced(ticket_id, aranda_item_id, followup_id);
        continue;
      }

      if (this.processing.has(followup_id)) continue;
      this.processing.add(followup_id);

      try {
        const segment = arandaSegmentFromGlpiType(glpi_type);
        // Marker [Nota GLPI] al inicio: arandaNotesPull lo usa para distinguir notas que insertó el bot
        // de las que insertó un humano usando la misma cuenta Aranda (Atena_GLPI). Sin esto, todo lo que
        // hace esa cuenta cae en anti-bucle y nunca llega a GLPI.
        const body = `${NOTE_FROM_GLPI_MARKER}\n\n${content || ''}`.trim();
        let obj;
        try {
          obj = await arandaClient.addNote(aranda_item_id, segment, { description: body });
        } catch (err) {
          if (err?.response?.status === 404) {
            const altSegment = segment === 1 ? 4 : 1;
            this.log.warn(`addNote 404 con segmento=${segment}, reintentando con segmento=${altSegment}`, { ticket_id, aranda_item_id });
            obj = await arandaClient.addNote(aranda_item_id, altSegment, { description: body });
          } else {
            throw err;
          }
        }
        const ok = truthy(obj.result ?? obj.Result ?? true);
        if (!ok) throw new Error(`Aranda devolvió fallo: ${JSON.stringify(obj)}`);

        await this.markSynced(ticket_id, aranda_item_id, followup_id);
        await recordEvent({
          direction: 'GLPI_TO_ARANDA',
          entityType: 'note',
          srcId: followup_id,
          dstId: aranda_item_id,
          content
        });
        this.log.info(`Nota enviada ticket=${ticket_id} fup=${followup_id}`, { ticket_id, followup_id, aranda_item_id, direction: 'GLPI_TO_ARANDA' });
      } catch (err) {
        await this.markFailed(ticket_id, aranda_item_id, followup_id, err.message, tries);
        this.log.error(`Nota fallo ticket=${ticket_id} fup=${followup_id}`, { err, ticket_id, followup_id });
      } finally {
        this.processing.delete(followup_id);
      }
    }
  }

  async markSynced(ticketId, arandaItemId, followupId) {
    await getDB().query(
      `INSERT INTO aranda_followup_notes
        (followup_id, ticket_id, aranda_item_id, status, tries, last_error, posted_at)
       VALUES (?, ?, ?, 'synced', 1, NULL, NOW())
       ON DUPLICATE KEY UPDATE
         status = 'synced', last_error = NULL, posted_at = NOW()`,
      [followupId, ticketId, arandaItemId]
    );
  }

  async markFailed(ticketId, arandaItemId, followupId, errorMsg, tries = 0) {
    await getDB().query(
      `INSERT INTO aranda_followup_notes
        (followup_id, ticket_id, aranda_item_id, status, tries, last_error)
       VALUES (?, ?, ?, 'failed', ?, ?)
       ON DUPLICATE KEY UPDATE
         status = 'failed', tries = tries + 1, last_error = VALUES(last_error)`,
      [followupId, ticketId, arandaItemId, (Number(tries) || 0) + 1, String(errorMsg).slice(0, 2000)]
    );
  }
}
