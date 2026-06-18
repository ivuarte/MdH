import { BaseService } from '../lib/baseService.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB } from '../lib/db.js';

// Detecta adjuntos GLPI por polling directo. Cuatro fuentes en GLPI 10+ timeline:
//   (a) GET /Ticket/{id}/Document_Item            → adjuntos al ticket "raíz"
//   (b) GET /ITILFollowup/{fid}/Document_Item     → adjuntos a un comentario (lo que la
//                                                    UI moderna hace al subir archivos
//                                                    en una respuesta)
//   (c) GET /ITILSolution/{sid}/Document_Item     → adjuntos al comentario de solución
//                                                    (al resolver el ticket)
//   (d) GET /TicketTask/{tid}/Document_Item       → adjuntos a una tarea
// Las cuatro se dedupean por documents_id; el archivo queda asociado al ticket padre
// independiente de a qué entidad de la timeline esté enlazado.
//
// arandaAttachmentsPush lo procesa después y sube el binario a Aranda.
export class GlpiAttachmentsSyncService extends BaseService {
  constructor(opts = {}) {
    super('glpiAttachmentsSync', opts);
    this.pollSeconds = Math.max(30, this.pollSeconds * 3);
  }

  async tick() {
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
        await this.scanTicket(ticketId);
      } catch (err) {
        this.log.error(`scanTicket ticket=${ticketId} ${err.message}`, { err, ticket_id: ticketId });
      }
    }
  }

  async scanTicket(ticketId) {
    const seen = new Set();
    const found = [];  // { documentId, sourceType, sourceId }

    const addDocs = (docs, sourceType, sourceId) => {
      for (const d of (Array.isArray(docs) ? docs : [])) {
        const docId = Number(d?.documents_id);
        if (!Number.isFinite(docId) || docId <= 0 || seen.has(docId)) continue;
        seen.add(docId);
        found.push({ documentId: docId, sourceType, sourceId });
      }
    };

    // (a) Document_Item del Ticket directo.
    const directDocs = await glpiClient.getTicketDocuments(ticketId);
    addDocs(directDocs, 'Ticket', ticketId);

    // (b-d) Document_Item de cada entidad-hija reciente. Limitamos por entidad para
    // mantener el costo de la API acotado (50 tickets/tick × hasta 30 GET = dentro
    // del rate limit GLPI=10/s con margen).
    const childSources = [
      { table: 'ticket_followups', column: 'followup_id', endpoint: 'ITILFollowup', orderBy: 'COALESCE(date, created_at)',          limit: 10 },
      { table: 'ticket_solutions', column: 'solution_id', endpoint: 'ITILSolution', orderBy: 'COALESCE(date_creation, created_at)', limit: 5  },
      { table: 'ticket_tasks',     column: 'task_id',     endpoint: 'TicketTask',   orderBy: 'COALESCE(date, created_at)',          limit: 10 }
    ];

    for (const src of childSources) {
      const [rows] = await getDB().query(
        // ID > 0 excluye los placeholders negativos de arandaSolutionPull (id = -aranda_item_id)
        `SELECT ${src.column} AS id FROM ${src.table}
          WHERE ticket_id = ? AND ${src.column} > 0
          ORDER BY ${src.orderBy} DESC
          LIMIT ${src.limit}`,
        [ticketId]
      );
      for (const { id } of rows) {
        let docs;
        try {
          docs = await glpiClient.get(`/${src.endpoint}/${id}/Document_Item`);
        } catch (err) {
          // 404 puede pasar si la entidad fue borrada entre nuestra BD y GLPI; lo ignoramos.
          if (err?.response?.status !== 404) {
            this.log.warn(`/${src.endpoint}/${id}/Document_Item fallo: ${err.message}`,
              { ticket_id: ticketId, source_type: src.endpoint, source_id: id });
          }
          continue;
        }
        addDocs(docs, src.endpoint, id);
      }
    }

    for (const { documentId, sourceType, sourceId } of found) {
      // Anti-bucle: solo filtrar Documents creados por el bot al PULLEAR de Aranda
      // (source='pull'). Los rows source='push' son trackers de anti-eco hacia el pull,
      // NO indican que el Document GLPI sea del bot — fue un upload humano.
      const [[fromAranda]] = await getDB().query(
        `SELECT 1 FROM aranda_inbound_files
          WHERE glpi_document_id = ? AND source = 'pull' LIMIT 1`,
        [documentId]
      );
      if (fromAranda) continue;

      // PK compuesta (document_id, ticket_id): GLPI puede compartir un mismo Document
      // entre varios tickets (dedupe interna por sha1), pero el tracker es por par.
      const [[known]] = await getDB().query(
        `SELECT 1 FROM glpi_attachments WHERE document_id = ? AND ticket_id = ? LIMIT 1`,
        [documentId, ticketId]
      );
      if (known) continue;

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
      const viaTag = sourceType === 'Ticket' ? '' : ` (via ${sourceType}=${sourceId})`;
      this.log.info(`Adjunto GLPI detectado ticket=${ticketId} doc=${documentId} name=${name}${viaTag}`, {
        ticket_id: ticketId, document_id: documentId, source_type: sourceType, source_id: sourceId,
        direction: 'GLPI_TO_DB'
      });
    }
  }
}
