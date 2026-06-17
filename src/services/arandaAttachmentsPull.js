import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB } from '../lib/db.js';
import { config } from '../config.js';
import { recordEvent } from '../lib/syncEvents.js';

// Adjuntos Aranda → GLPI. Flujo en dos pasos:
//   (1) discover: para cada caso mapeado, GET /item/{id}/{seg}/{userId}/files
//       → INSERT IGNORE en aranda_inbound_files con status='pending'.
//   (2) propagate: cada 'pending' (o 'failed' <5 tries) se descarga del Url firmado
//       y se sube a GLPI vía POST /Document con multipart.
//
// La nota anti-bucle es que la tabla glpi_attachments se consulta antes de pushear
// — los Document creados por este servicio quedan registrados con glpi_document_id
// y arandaAttachmentsPush los excluye explícitamente.
export class ArandaAttachmentsPullService extends BaseService {
  constructor(opts = {}) {
    super('arandaAttachmentsPull', opts);
    this.processing = new Set();
    this.pollSeconds = Math.max(30, this.pollSeconds * 3);
  }

  async tick() {
    // IMPORTANTE: los Url firmados de Aranda EXPIRAN en minutos. Por eso descubrimiento +
    // descarga + upload se hace en una sola pasada usando el Url RECIÉN obtenido del listing.
    // El campo `url` en BD se guarda sólo como referencia/debug, NO se reusa.
    const [rows] = await getDB().query(
      `SELECT ai.aranda_item_id, ai.ticket_id,
              COALESCE(aii.aranda_segment, CASE WHEN t.type = 2 THEN 4 ELSE 1 END) AS aranda_segment
         FROM aranda_items ai
         JOIN tickets t ON t.id = ai.ticket_id
         LEFT JOIN aranda_inbound_items aii ON aii.aranda_item_id = ai.aranda_item_id
        WHERE ai.status = 'synced'
          AND (t.status IS NULL OR t.status NOT IN (5, 6))
        ORDER BY ai.updated_at DESC
        LIMIT 80`
    );

    const USER = config.ARANDA_AUTHOR_ID;
    for (const row of rows) {
      if (this.stopping) return;
      let files;
      try {
        files = await arandaClient.listItemFiles(row.aranda_item_id, row.aranda_segment, USER);
      } catch (err) {
        const status = err?.response?.status;
        if (status === 404 || status === 400) continue;
        this.log.warn(`listItemFiles item=${row.aranda_item_id} ${err.message}`);
        continue;
      }
      if (!Array.isArray(files) || files.length === 0) continue;

      for (const f of files) {
        if (this.stopping) return;
        const fileId = Number(f?.Id);
        if (!Number.isFinite(fileId) || fileId <= 0) continue;
        if (this.processing.has(fileId)) continue;

        const [[known]] = await getDB().query(
          `SELECT status, tries FROM aranda_inbound_files WHERE aranda_file_id = ? LIMIT 1`,
          [fileId]
        );
        if (known && known.status === 'synced') continue;
        if (known && known.status === 'failed' && known.tries >= 5) continue;

        this.processing.add(fileId);
        try {
          await this.processFile(row, f);
        } catch (err) {
          await getDB().query(
            `INSERT INTO aranda_inbound_files
              (aranda_file_id, aranda_item_id, aranda_segment, glpi_ticket_id, name, size, url, status, tries, last_error)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', 1, ?)
             ON DUPLICATE KEY UPDATE
               status = 'failed',
               tries = tries + 1,
               last_error = VALUES(last_error)`,
            [fileId, row.aranda_item_id, row.aranda_segment, row.ticket_id,
             String(f.Name || `file_${fileId}`).slice(0, 255), Number(f.Size) || null, String(f.Url || ''),
             String(err.message).slice(0, 2000)]
          );
          const glpiBody = err?.response?.data;
          const bodyStr = typeof glpiBody === 'string' ? glpiBody.slice(0, 500) :
                          (glpiBody ? JSON.stringify(glpiBody).slice(0, 500) : null);
          this.log.error(`Pull adjunto file=${fileId} (${f.Name}) status=${err?.response?.status}`, {
            err, aranda_file_id: fileId, glpi_body: bodyStr
          });
        } finally {
          this.processing.delete(fileId);
        }
      }
    }
  }

  async processFile(row, f) {
    const fileId = Number(f.Id);
    const filename = String(f.Name || `file_${fileId}`).slice(0, 255);
    const url = String(f.Url || '');
    if (!url) throw new Error('Url vacío en respuesta de Aranda');
    if (!row.ticket_id) throw new Error('aranda_items.ticket_id null');

    // Descarga AHORA con el Url recién obtenido — antes que expire.
    const { buffer, mime } = await arandaClient.downloadFileFromUrl(url);

    // Upload a GLPI vinculado al ticket.
    const docId = await glpiClient.uploadDocumentToTicket(row.ticket_id, buffer, filename, mime);

    await getDB().query(
      `INSERT INTO aranda_inbound_files
        (aranda_file_id, aranda_item_id, aranda_segment, glpi_ticket_id, glpi_document_id, name, size, url, status, posted_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         status = 'synced',
         glpi_document_id = VALUES(glpi_document_id),
         glpi_ticket_id = VALUES(glpi_ticket_id),
         posted_at = NOW(),
         last_error = NULL`,
      [fileId, row.aranda_item_id, row.aranda_segment, row.ticket_id, docId,
       filename, Number(f.Size) || null, url]
    );

    await recordEvent({
      direction: 'ARANDA_TO_GLPI',
      entityType: 'attachment',
      srcId: fileId,
      dstId: docId
    });

    this.log.info(`Adjunto Aranda file=${fileId} (${filename}) → GLPI Document ${docId} ticket=${row.ticket_id}`, {
      aranda_file_id: fileId, ticket_id: row.ticket_id, document_id: docId,
      direction: 'ARANDA_TO_GLPI'
    });
  }
}
