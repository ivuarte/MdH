import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { glpiClient } from '../lib/glpiClient.js';
import { config } from '../config.js';
import { getDB } from '../lib/db.js';
import { recordEvent } from '../lib/syncEvents.js';

// Sube binarios desde GLPI hacia Aranda usando el endpoint documentado v1.9:
//   POST /item/addfile  multipart con file0 + itemId + itemType + userId
// (descubierto 2026-06-17 — la "Limitación 15" se levanta).
// Tracker idempotente: aranda_attachment_notes (mismo nombre legacy; ahora status='synced'
// significa "binario subido", no "anunciado por nota").
//
// Anti-eco contra arandaAttachmentsPull: tras el upload, hacemos listing del item y
// registramos el aranda_file_id recién creado en aranda_inbound_files con status='synced'
// y glpi_document_id apuntando al Document original — así el pull lo skipea.
function arandaSegmentFromGlpiType(type) {
  return Number(type) === 2 ? 4 : 1;
}

export class ArandaAttachmentsPushService extends BaseService {
  constructor(opts = {}) {
    super('arandaAttachmentsPush', opts);
    this.processing = new Set();
  }

  async tick() {
    // JOIN por (document_id, ticket_id) — el tracker es por par, ya que GLPI puede
    // reutilizar el mismo Document en varios tickets (dedupe sha1).
    const [rows] = await getDB().query(
      `SELECT ga.document_id, ga.ticket_id, ga.name, ga.size, ga.mime,
              ai.aranda_item_id, t.type AS glpi_type
         FROM glpi_attachments ga
         JOIN tickets t ON t.id = ga.ticket_id
         JOIN aranda_items ai ON ai.ticket_id = ga.ticket_id AND ai.status = 'synced'
         LEFT JOIN aranda_attachment_notes aan
                ON aan.document_id = ga.document_id AND aan.ticket_id = ga.ticket_id
        WHERE t.origin = 'GLPI'
          AND (aan.document_id IS NULL OR (aan.status = 'failed' AND aan.tries < 5))
        ORDER BY ga.detected_at ASC
        LIMIT 25`
    );

    for (const row of rows) {
      if (this.stopping) return;
      const key = `${row.document_id}:${row.ticket_id}`;
      if (this.processing.has(key)) continue;
      this.processing.add(key);
      try {
        await this.pushToAranda(row);
      } catch (err) {
        await getDB().query(
          `INSERT INTO aranda_attachment_notes (document_id, ticket_id, aranda_item_id, status, tries, last_error)
           VALUES (?, ?, ?, 'failed', 1, ?)
           ON DUPLICATE KEY UPDATE
             status = 'failed',
             tries = tries + 1,
             last_error = VALUES(last_error)`,
          [row.document_id, row.ticket_id, row.aranda_item_id, String(err.message).slice(0, 2000)]
        );
        this.log.error(`Push adjunto doc=${row.document_id} ticket=${row.ticket_id}`, { err, document_id: row.document_id, ticket_id: row.ticket_id });
      } finally {
        this.processing.delete(key);
      }
    }
  }

  async pushToAranda(row) {
    const segment = arandaSegmentFromGlpiType(row.glpi_type);
    const userId = config.ARANDA_AUTHOR_ID;
    const filename = String(row.name || `glpi-doc-${row.document_id}`).slice(0, 200);
    const mime = row.mime || 'application/octet-stream';

    const { buffer, mime: actualMime, size } = await glpiClient.downloadDocumentBinary(row.document_id);
    if (!buffer || !buffer.length) {
      throw new Error(`GLPI Document ${row.document_id} bajó vacío`);
    }

    await arandaClient.addFileToItem(row.aranda_item_id, segment, userId, {
      filename, buffer, mime: actualMime || mime
    });

    await getDB().query(
      `INSERT INTO aranda_attachment_notes (document_id, ticket_id, aranda_item_id, status, tries, posted_at, last_error)
       VALUES (?, ?, ?, 'synced', 1, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         status = 'synced',
         posted_at = NOW(),
         last_error = NULL`,
      [row.document_id, row.ticket_id, row.aranda_item_id]
    );

    await recordEvent({
      direction: 'GLPI_TO_ARANDA',
      entityType: 'attachment',
      srcId: row.document_id,
      dstId: row.aranda_item_id
    });

    // Anti-eco: localizar el aranda_file_id recién creado y registrarlo como ya sincronizado.
    try {
      const files = await arandaClient.listItemFiles(row.aranda_item_id, segment, userId);
      const arr = Array.isArray(files) ? files : [];
      const candidates = arr.filter(f => String(f.Name) === filename);
      const newest = candidates.sort((a, b) => Number(b.Id) - Number(a.Id))[0];
      if (newest && Number.isFinite(Number(newest.Id))) {
        await getDB().query(
          `INSERT IGNORE INTO aranda_inbound_files
            (aranda_file_id, aranda_item_id, aranda_segment, glpi_ticket_id, glpi_document_id,
             name, size, url, status, source, posted_at, last_error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', 'push', NOW(), NULL)`,
          [Number(newest.Id), row.aranda_item_id, segment, row.ticket_id, row.document_id,
           filename, Number(newest.Size) || size || null, String(newest.Url || '').slice(0, 2000)]
        );
      }
    } catch (err) {
      this.log.warn(`Anti-eco listing falló doc=${row.document_id} item=${row.aranda_item_id}: ${err.message}`,
        { document_id: row.document_id, aranda_item_id: row.aranda_item_id });
    }

    this.log.info(`Adjunto GLPI doc=${row.document_id} (${filename}) subido a Aranda item=${row.aranda_item_id}`, {
      ticket_id: row.ticket_id, aranda_item_id: row.aranda_item_id, document_id: row.document_id,
      direction: 'GLPI_TO_ARANDA', size
    });
  }
}
