// src/services/arandaBacklinkService.js
import { glpi, ensureSession, authHeaders, invalidateSession } from '../lib/glpi.js';
import { getDB } from '../lib/db.js';
import { logger } from '../lib/logger.js';

export class ArandaBacklinkService {
  constructor(opts = {}) {
    this.name = 'ArandaBacklinkService';
    this.pollSeconds = Math.max(5, Number(opts.POLL_INTERVAL || 20));
    this.timer = null;
    this.processing = new Set(); // ticket_id en curso
  }

  async start() {
    logger.info(`[${this.name}] Iniciando... (poll=${this.pollSeconds}s)`);
    await this.ensureSchemaUpToDate();
    await ensureSession();
    await this.tick();
    this.timer = setInterval(
      () => this.tick().catch(e => logger.error(`[${this.name}] tick error:`, e.message)),
      this.pollSeconds * 1000
    );
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    logger.info(`[${this.name}] Detenido.`);
  }

  // Añade columnas para llevar control del backlink (si no existen)
  async ensureSchemaUpToDate() {
    const pool = getDB();

    // glpi_backlinked_at
    let [cols] = await pool.query(`SHOW COLUMNS FROM aranda_items LIKE 'glpi_backlinked_at'`);
    if (cols.length === 0) {
      await pool.query(`ALTER TABLE aranda_items ADD COLUMN glpi_backlinked_at TIMESTAMP NULL DEFAULT NULL`);
      logger.info('[DB] Añadida columna aranda_items.glpi_backlinked_at');
    }

    // glpi_backlink_error
    ;[cols] = await pool.query(`SHOW COLUMNS FROM aranda_items LIKE 'glpi_backlink_error'`);
    if (cols.length === 0) {
      await pool.query(`ALTER TABLE aranda_items ADD COLUMN glpi_backlink_error TEXT NULL`);
      logger.info('[DB] Añadida columna aranda_items.glpi_backlink_error');
    }
  }

  async tick() {
    const pool = getDB();
    const [rows] = await pool.query(`
      SELECT a.ticket_id, a.composed_item_id
      FROM aranda_items a
      WHERE a.composed_item_id IS NOT NULL
        AND a.composed_item_id <> ''
        AND a.glpi_backlinked_at IS NULL
      ORDER BY a.ticket_id ASC
      LIMIT 50
    `);

    for (const row of rows) {
      const ticketId = row.ticket_id;
      const code = row.composed_item_id;

      if (this.processing.has(ticketId)) continue;
      this.processing.add(ticketId);

      try {
        await this.addGlpiFollowup(ticketId, code);
        await pool.query(
          `UPDATE aranda_items
             SET glpi_backlinked_at = NOW(),
                 glpi_backlink_error = NULL
           WHERE ticket_id = ?`,
          [ticketId]
        );
        logger.info(`[SYNC][Aranda→GLPI] Followup publicado en ticket ${ticketId}: ${code}`);
      } catch (err) {
        await pool.query(
          `UPDATE aranda_items
             SET glpi_backlink_error = ?
           WHERE ticket_id = ?`,
          [String(err.message).slice(0, 2000), ticketId]
        );
        logger.error(`[ERROR][Aranda→GLPI] ticket ${ticketId}:`, err.message);
      } finally {
        this.processing.delete(ticketId);
      }
    }
  }

  async addGlpiFollowup(ticketId, composedItemId) {
    const content = `caso aranda: ${composedItemId}`;
    try {
      await ensureSession();
      await glpi.post(
        `/ITILFollowup/`,
        { input: { itemtype: 'Ticket', items_id: ticketId, content } },
        { headers: authHeaders() }
      );
    } catch (err) {
      // Si la sesión expiró, reintenta 1 vez
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        invalidateSession();
        await ensureSession();
        await glpi.post(
          `/ITILFollowup/`,
          { input: { itemtype: 'Ticket', items_id: ticketId, content } },
          { headers: authHeaders() }
        );
        return;
      }
      throw err;
    }
  }
}
