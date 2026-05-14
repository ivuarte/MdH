import he from 'he';
import { glpi, ensureSession, authHeaders, invalidateSession } from '../lib/glpi.js';
import { getDB } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { coerceInt, extractName, extractStr } from '../lib/utils.js';

export class TicketSyncService {
  constructor(opts) {
    this.name = 'TicketSyncService';
    this.pollSeconds = Math.max(5, Number(opts.POLL_INTERVAL || 20));
    this.filterUser = opts.GLPI_FILTER_USER;
    this.timer = null;
    this.lastSeenLogId = 0;
    this.processingTickets = new Set();
  }

  async start() {
    logger.info(`[${this.name}] Iniciando... (poll=${this.pollSeconds}s, filtroUsuario="${this.filterUser}")`);
    await ensureSession();
    await this.tick(); // primer barrido inmediato
    this.timer = setInterval(() => this.tick().catch(e => logger.error(`[${this.name}] tick error:`, e.message)), this.pollSeconds * 1000);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    logger.info(`[${this.name}] Detenido.`);
  }

  async tick() {
    const headers = { ...authHeaders(), Range: 'items=0-99' };
    const url = `/log?order=DESC`;
    const res = await glpi.get(url, { headers });
    const logs = Array.isArray(res.data) ? res.data : [];

    const filtered = logs
      .filter(l =>
        l?.itemtype === 'Ticket' &&
        l?.user_name === this.filterUser &&
        typeof l?.items_id === 'number'
      )
      .sort((a, b) => a.id - b.id);

    for (const log of filtered) {
      if (log.id <= this.lastSeenLogId) continue;
      this.lastSeenLogId = Math.max(this.lastSeenLogId, log.id);

      const ticketId = log.items_id;
      if (this.processingTickets.has(ticketId)) continue;
      this.processingTickets.add(ticketId);

      try {
        await ensureSession(); // por si expiró en medio
        const tRes = await glpi.get(`/Ticket/${ticketId}?expand_dropdowns=true`, { headers: authHeaders() });
        const t = tRes.data || {};

        const mapped = {
          id: coerceInt(t.id, null),
          nombre: t.name ?? '',
          date_creation: t.date ?? null,
          closedate: t.closedate ?? null,
          solvedate: t.solvedate ?? null,
          status: coerceInt(t.status, 0),
          type: coerceInt(t.type, 0),
          users_id_recipient: extractStr(t.users_id_recipient),
          content: t.content ? (typeof t.content === 'string' ? he.decode(t.content) : t.content) : null,
          itilcategory_name: t.itilcategories_id ? (typeof t.itilcategories_id === 'string' ? he.decode(t.itilcategories_id) : t.itilcategories_id) : null,
          //itilcategory_name: extractName(t.itilcategories_id), //directo
          ITILFollowup: null,   // reservado para futuras integraciones
          ITILSolution: null
        };

        await this.upsertTicket(mapped);
        logger.info(`[SYNC] Ticket ${ticketId} insertado/actualizado`);
      } catch (err) {
        if (err?.response?.status === 401 || err?.response?.status === 403) {
          logger.warn('[GLPI] Sesión expirada. Reintentando login...');
          invalidateSession();
        } else {
          logger.error(`[ERROR] Log ${log.id} / ticket ${ticketId}:`, err.message);
        }
      } finally {
        this.processingTickets.delete(ticketId);
      }
    }
  }

  async upsertTicket(t) {
    const pool = getDB();
    const sql = `
      INSERT INTO tickets
        (id, nombre, date_creation, closedate, solvedate, status, type, users_id_recipient, content, itilcategory_name, ITILFollowup, ITILSolution)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        nombre = VALUES(nombre),
        date_creation = VALUES(date_creation),
        closedate = VALUES(closedate),
        solvedate = VALUES(solvedate),
        status = VALUES(status),
        type = VALUES(type),
        users_id_recipient = VALUES(users_id_recipient),
        content = VALUES(content),
        itilcategory_name = VALUES(itilcategory_name),
        ITILFollowup = COALESCE(VALUES(ITILFollowup), ITILFollowup),
        ITILSolution = COALESCE(VALUES(ITILSolution), ITILSolution);
    `;
    const params = [
      t.id,
      t.nombre,
      t.date_creation,
      t.closedate,
      t.solvedate,
      t.status,
      t.type,
      t.users_id_recipient,
      t.content,
      t.itilcategory_name,
      t.ITILFollowup,
      t.ITILSolution
    ];
    await pool.query(sql, params);
  }
}
