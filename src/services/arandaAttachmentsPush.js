import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { getDB } from '../lib/db.js';
import { recordEvent } from '../lib/syncEvents.js';

// WORKAROUND para la limitación 15 (Aranda no expone POST de adjuntos al rol Atena_GLPI).
// Cuando GLPI tiene un adjunto nuevo, publicamos UNA NOTA en Aranda anunciando el archivo:
//   [Adjunto GLPI] CÉDULA.pdf (385 KB) — consultar en el ticket GLPI #42883
// El operador en Aranda ve el aviso y accede al archivo real en GLPI.
function arandaSegmentFromGlpiType(type) {
  return Number(type) === 2 ? 4 : 1;
}

function humanSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class ArandaAttachmentsPushService extends BaseService {
  constructor(opts = {}) {
    super('arandaAttachmentsPush', opts);
    this.processing = new Set();
  }

  async tick() {
    // Seleccionar adjuntos GLPI cuyo ticket tiene mapping Aranda y aún no se anunciaron.
    const [rows] = await getDB().query(
      `SELECT ga.document_id, ga.ticket_id, ga.name, ga.size,
              ai.aranda_item_id, t.type AS glpi_type
         FROM glpi_attachments ga
         JOIN tickets t ON t.id = ga.ticket_id
         JOIN aranda_items ai ON ai.ticket_id = ga.ticket_id AND ai.status = 'synced'
         LEFT JOIN aranda_attachment_notes aan ON aan.document_id = ga.document_id
        WHERE t.origin = 'GLPI'
          AND (aan.document_id IS NULL OR (aan.status = 'failed' AND aan.tries < 5))
        ORDER BY ga.detected_at ASC
        LIMIT 25`
    );

    for (const row of rows) {
      if (this.stopping) return;
      if (this.processing.has(row.document_id)) continue;
      this.processing.add(row.document_id);
      try {
        await this.announceInAranda(row);
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
        this.log.error(`Push adjunto-nota doc=${row.document_id}`, { err, document_id: row.document_id });
      } finally {
        this.processing.delete(row.document_id);
      }
    }
  }

  async announceInAranda(row) {
    const segment = arandaSegmentFromGlpiType(row.glpi_type);
    const sizeStr = humanSize(row.size);
    const sizePart = sizeStr ? ` (${sizeStr})` : '';
    const description =
      `[Adjunto GLPI] ${row.name}${sizePart}\n` +
      `El usuario adjuntó un archivo en el ticket GLPI #${row.ticket_id}. ` +
      `Consultar el archivo directamente en el ticket de GLPI (Aranda no permite recibir adjuntos automáticos).`;

    const obj = await arandaClient.addNote(row.aranda_item_id, segment, { description, isPrivate: false });
    // addNote es idempotente desde el lado nuestro: el tracker garantiza UNA sola nota por adjunto.
    if (obj && obj.result === 'false') {
      throw new Error(`Aranda rechazó nota: ${JSON.stringify(obj).slice(0, 200)}`);
    }

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

    this.log.info(`Adjunto GLPI doc=${row.document_id} anunciado en Aranda item=${row.aranda_item_id}`, {
      ticket_id: row.ticket_id, aranda_item_id: row.aranda_item_id, document_id: row.document_id,
      direction: 'GLPI_TO_ARANDA'
    });
  }
}
