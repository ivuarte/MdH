import { BaseService } from '../lib/baseService.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB } from '../lib/db.js';

// Polling directo: por cada ticket mapeado en aranda_items, consulta /Document_Item
// y registra los documentos nuevos en glpi_attachments. NO los sube a Aranda (eso lo
// hace arandaAttachmentsPush, que es el workaround "publicar nota con anuncio").
//
// /Log no es confiable para Document_Item (igual que tareas) — polling directo.
export class GlpiAttachmentsSyncService extends BaseService {
  constructor(opts = {}) {
    super('glpiAttachmentsSync', opts);
    // Adjuntos no cambian con la frecuencia de los followups — usamos 3× POLL_INTERVAL.
    this.pollSeconds = Math.max(30, this.pollSeconds * 3);
  }

  async tick() {
    // Sólo tickets origin=GLPI con mapping en Aranda. Aranda→GLPI usa otro tracker.
    const [tickets] = await getDB().query(
      `SELECT t.id
         FROM tickets t
         JOIN aranda_items ai ON ai.ticket_id = t.id
        WHERE t.origin = 'GLPI'
          AND ai.status = 'synced'
          AND (t.status IS NULL OR t.status NOT IN (5, 6))
        ORDER BY t.id DESC
        LIMIT 50`
    );

    for (const { id: ticketId } of tickets) {
      if (this.stopping) return;
      try {
        const docs = await glpiClient.getTicketDocuments(ticketId);
        if (!Array.isArray(docs) || docs.length === 0) continue;

        for (const d of docs) {
          const documentId = Number(d?.documents_id);
          if (!Number.isFinite(documentId) || documentId <= 0) continue;

          // Marker anti-bucle: documentos creados por el bot al hacer pull de Aranda
          // tienen un comentario específico — los identificamos vía aranda_inbound_files.
          const [[fromAranda]] = await getDB().query(
            `SELECT 1 FROM aranda_inbound_files WHERE glpi_document_id = ? LIMIT 1`,
            [documentId]
          );
          if (fromAranda) continue;

          // ¿Ya conocido?
          const [[known]] = await getDB().query(
            `SELECT 1 FROM glpi_attachments WHERE document_id = ? LIMIT 1`,
            [documentId]
          );
          if (known) continue;

          // Hidratamos metadata del documento.
          let name = `document_${documentId}`;
          let size = null;
          let mime = null;
          try {
            const meta = await glpiClient.getDocument(documentId);
            name = meta?.filename || meta?.name || name;
            size = Number(meta?.filesize) || null;
            mime = meta?.mime || null;
          } catch (e) {
            this.log.warn(`Document ${documentId} sin metadata (${e.message})`);
          }

          await getDB().query(
            `INSERT IGNORE INTO glpi_attachments (document_id, ticket_id, name, size, mime)
             VALUES (?, ?, ?, ?, ?)`,
            [documentId, ticketId, String(name).slice(0, 255), size, mime ? String(mime).slice(0, 128) : null]
          );
          this.log.info(`Adjunto GLPI detectado ticket=${ticketId} doc=${documentId} name=${name}`, {
            ticket_id: ticketId, document_id: documentId, direction: 'GLPI_TO_DB'
          });
        }
      } catch (err) {
        this.log.error(`getTicketDocuments ticket=${ticketId} ${err.message}`, { err, ticket_id: ticketId });
      }
    }
  }
}
