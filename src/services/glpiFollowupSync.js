import { BaseService } from '../lib/baseService.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB, readCursor, writeCursor } from '../lib/db.js';
import { extractStr, normalizeHtml, parseNumericId, hasArandaMarker } from '../lib/utils.js';

function formatBlock({ user, content, date }) {
  return [
    '****************************',
    `user: ${user || ''}`.trim(),
    `seguimiento: ${content || ''}`.trim(),
    `fecha: ${date || ''}`.trim(),
    '****************************'
  ].join('\n');
}

// Detecta followups GLPI por dos caminos:
//   1) /Log (cursor) — captura inmediato cuando hay entries recientes; cubre tickets no mapeados.
//   2) Polling directo por ticket mapeado (GET /Ticket/{id}/ITILFollowup) — fallback robusto cuando el
//      /Log de GLPI tiene rotación agresiva (esta instancia sólo retiene ~15 entries históricos).
//
// Cada followup se inserta en ticket_followups con origin=GLPI (o ARANDA si contenido tiene marker
// [from aranda]); arandaNotesPush filtra los de origin=ARANDA y los que tienen marker para evitar bucle.
export class GlpiFollowupSyncService extends BaseService {
  constructor(opts = {}) {
    super('glpiFollowupSync', opts);
    this.filterUser = opts.GLPI_FILTER_USER || null;
    this.lastSeenLogId = 0;
    this.processing = new Set();
  }

  async onStart() {
    this.lastSeenLogId = Number(await readCursor('glpi_followup_log_cursor', '0')) || 0;
    this.log.info(`Cursor lastSeenLogId=${this.lastSeenLogId}`);
  }

  async tick() {
    // Paso 1: ingest via /Log (rápido para tickets recién creados).
    await this.ingestFromLog().catch(err => this.log.error('ingestFromLog error', { err }));
    // Paso 2: polling directo por ticket mapeado (cubre el caso de /Log rotado).
    await this.pollMappedTickets().catch(err => this.log.error('pollMappedTickets error', { err }));
  }

  async ingestFromLog() {
    const logs = await glpiClient.getLog();
    if (!Array.isArray(logs) || logs.length === 0) return;

    const filtered = logs
      .filter(l =>
        l?.itemtype === 'Ticket' &&
        l?.itemtype_link === 'ITILFollowup' &&
        typeof l?.items_id === 'number' &&
        (this.filterUser ? l?.user_name === this.filterUser : true)
      )
      .sort((a, b) => a.id - b.id);

    for (const log of filtered) {
      if (this.stopping) return;
      if (log.id <= this.lastSeenLogId) continue;

      const ticketId = log.items_id;
      const followupId = parseNumericId(log.new_value);
      if (!Number.isFinite(followupId)) {
        this.log.warn(`followupId inválido log=${log.id} new_value=${log.new_value}`);
        this.lastSeenLogId = Math.max(this.lastSeenLogId, log.id);
        await writeCursor('glpi_followup_log_cursor', this.lastSeenLogId);
        continue;
      }
      await this.maybeIngestFollowup({ ticketId, followupId, logId: log.id });
    }
  }

  // Polling directo: para cada ticket mapeado (aranda_items.synced), trae sus followups y procesa los nuevos.
  // Limitado a tickets activos (status != cerrado/resuelto) para no recorrer historia entera cada minuto.
  async pollMappedTickets() {
    const [tickets] = await getDB().query(
      `SELECT t.id
         FROM tickets t
         JOIN aranda_items ai ON ai.ticket_id = t.id
        WHERE ai.aranda_item_id IS NOT NULL
          AND ai.status = 'synced'
          AND (t.status IS NULL OR t.status NOT IN (5,6))
        ORDER BY t.updated_at DESC
        LIMIT 200`
    );

    for (const t of tickets) {
      if (this.stopping) return;
      const ticketId = Number(t.id);
      let fups;
      try {
        fups = await glpiClient.getTicketFollowups(ticketId);
      } catch (err) {
        if (err?.response?.status === 404) continue;
        this.log.warn(`getTicketFollowups ${ticketId} error`, { err, ticket_id: ticketId });
        continue;
      }
      if (!Array.isArray(fups) || fups.length === 0) continue;

      for (const f of fups) {
        if (this.stopping) return;
        const followupId = Number(f?.id);
        if (!Number.isFinite(followupId)) continue;
        await this.maybeIngestFollowup({ ticketId, followupId, prefetched: f });
      }
    }
  }

  async maybeIngestFollowup({ ticketId, followupId, logId = null, prefetched = null }) {
    if (this.processing.has(followupId)) return;
    this.processing.add(followupId);
    try {
      if (await this.isProcessed(followupId)) {
        if (logId != null) {
          this.lastSeenLogId = Math.max(this.lastSeenLogId, logId);
          await writeCursor('glpi_followup_log_cursor', this.lastSeenLogId);
        }
        return;
      }

      let f = prefetched;
      if (!f) {
        const list = await glpiClient.getTicketFollowups(ticketId);
        f = Array.isArray(list) ? list.find(x => Number(x?.id) === followupId) : null;
      }
      if (!f) {
        this.log.warn(`Followup ${followupId} no encontrado en Ticket ${ticketId} (latencia GLPI)`);
        return;
      }

      const userName = extractStr(f.users_id);
      const content = normalizeHtml(f.content);
      const date = f.date || f.date_creation || null;

      // Si viene con marker [from aranda] o legacy "caso aranda:", es eco — origin=ARANDA.
      const origin = hasArandaMarker(content) ? 'ARANDA' : 'GLPI';

      await this.appendBlock(ticketId, formatBlock({ user: userName, content, date }));
      await this.markProcessed({ followupId, ticketId, userName, content, date, origin });

      this.log.info(`Followup ${followupId} agregado a ticket ${ticketId} origin=${origin}`, {
        ticket_id: ticketId, followup_id: followupId, direction: 'GLPI_TO_DB', origin
      });

      if (logId != null) {
        this.lastSeenLogId = Math.max(this.lastSeenLogId, logId);
        await writeCursor('glpi_followup_log_cursor', this.lastSeenLogId);
      }
    } catch (err) {
      this.log.error(`Followup ${followupId} ticket ${ticketId} error`, { err, ticket_id: ticketId, followup_id: followupId });
    } finally {
      this.processing.delete(followupId);
    }
  }

  async isProcessed(followupId) {
    const [rows] = await getDB().query(
      `SELECT 1 FROM ticket_followups WHERE followup_id = ? LIMIT 1`,
      [followupId]
    );
    return rows.length > 0;
  }

  // Append atómico en SQL para evitar condiciones de carrera con otros servicios.
  async appendBlock(ticketId, block) {
    await getDB().query(
      `UPDATE tickets
         SET ITILFollowup = CASE
           WHEN ITILFollowup IS NULL OR ITILFollowup = '' THEN CONCAT(?, '\n')
           ELSE CONCAT(ITILFollowup,
                       CASE WHEN RIGHT(ITILFollowup, 1) = '\n' THEN '' ELSE '\n' END,
                       ?, '\n')
         END
       WHERE id = ?`,
      [block, block, ticketId]
    );
  }

  async markProcessed({ followupId, ticketId, userName, content, date, origin = 'GLPI' }) {
    await getDB().query(
      `INSERT IGNORE INTO ticket_followups
        (followup_id, ticket_id, user_name, content, date, origin)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [followupId, ticketId, userName || null, content || null, date || null, origin]
    );
  }
}
