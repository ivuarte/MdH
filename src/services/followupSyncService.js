// src/services/followupSyncService.js
import he from 'he';
import { glpi, ensureSession, authHeaders, invalidateSession } from '../lib/glpi.js';
import { getDB } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { extractStr } from '../lib/utils.js';

function normalizeContent(v) {
  if (v == null) return '';
  let s = typeof v === 'string' ? v : String(v);
  s = he.decode(s);                                   // &#60;p&#62; -> <p>
  s = s.replace(/<br\s*\/?>/gi, '\n');                // <br> -> \n
  s = s.replace(/<\/p>\s*<p>/gi, '\n');               // </p><p> -> \n
  s = s.replace(/<[^>]+>/g, '');                      // quita etiquetas HTML
  return s.trim();
}

function formatBlock({ user, content, date }) {
  const lines = [
    '****************************',
    `user: ${user || ''}`.trim(),
    `seguimiento: ${content || ''}`.trim(),
    `fecha: ${date || ''}`.trim(),
    '****************************'
  ];
  return lines.join('\n');
}

export class ITILFollowupSyncService {
  constructor(opts) {
    this.name = 'ITILFollowupSyncService';
    this.pollSeconds = Math.max(5, Number(opts.POLL_INTERVAL || 20));
    this.filterUser = opts.GLPI_FILTER_USER || null;          // si quieres filtrar por usuario
    this.timer = null;
    this.lastSeenLogId = 0;
    this.processing = new Set();                              // followup_id en curso
  }

  async start() {
    logger.info(`[${this.name}] Iniciando... (poll=${this.pollSeconds}s${this.filterUser ? `, filtroUsuario="${this.filterUser}"` : ''})`);
    await this.ensureMetaTables();                            // crea tabla para dedupe
    await ensureSession();
    await this.tick();                                        // primer barrido inmediato
    this.timer = setInterval(() => this.tick().catch(e => logger.error(`[${this.name}] tick error:`, e.message)), this.pollSeconds * 1000);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    logger.info(`[${this.name}] Detenido.`);
  }

  async ensureMetaTables() {
    const pool = getDB();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_followups (
        followup_id BIGINT NOT NULL,
        ticket_id INT NOT NULL,
        user_name VARCHAR(255),
        content TEXT,
        date DATETIME,
        PRIMARY KEY (followup_id),
        KEY idx_ticket_id (ticket_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    logger.info('[DB] OK tabla ticket_followups');
  }

  async tick() {
    const headers = { ...authHeaders(), Range: 'items=0-99' };
    const url = `/log?order=DESC`;
    const res = await glpi.get(url, { headers });
    const logs = Array.isArray(res.data) ? res.data : [];

    // Solo logs que apunten a followups
    const filtered = logs
      .filter(l =>
        l?.itemtype === 'Ticket' &&
        l?.itemtype_link === 'ITILFollowup' &&
        typeof l?.items_id === 'number' &&
        (this.filterUser ? l?.user_name === this.filterUser : true)
      )
      .sort((a, b) => a.id - b.id);

    for (const log of filtered) {
      if (log.id <= this.lastSeenLogId) continue;
      this.lastSeenLogId = Math.max(this.lastSeenLogId, log.id);

      const ticketId = log.items_id;
      
      function parseFollowupId(v) {
          if (typeof v === 'number') return v;
          if (typeof v === 'string') {
            const m = v.match(/(\d+)/); // captura el primer número que aparezca
            return m ? Number(m[1]) : NaN;
          }
          return NaN;
        }
        
        const followupId = parseFollowupId(log.new_value);
        if (!Number.isFinite(followupId)) {
          logger.warn(`[${this.name}] followupId inválido en log ${log.id}: ${log.new_value}`);
          continue;
        }



      if (this.processing.has(followupId)) continue;
      this.processing.add(followupId);

      try {
        // dedupe por tabla auxiliar
        if (await this.isFollowupAlreadyProcessed(followupId)) {
          continue;
        }

        await ensureSession();
        // Trae el listado y localiza el followup por ID
        const fRes = await glpi.get(`/Ticket/${ticketId}/ITILFollowup/?expand_dropdowns=true`, { headers: authHeaders() });
        const list = Array.isArray(fRes.data) ? fRes.data : [];
        const f = list.find(x => Number(x?.id) === followupId);
        if (!f) {
          logger.warn(`[${this.name}] Followup ${followupId} no hallado en Ticket ${ticketId} (puede haber latencia).`);
          continue;
        }

        const userName = extractStr(f.users_id);     // con expand_dropdowns viene nombre/login
        const content = normalizeContent(f.content);
        const date = f.date || f.date_creation || '';

        // Formatea bloque
        const block = formatBlock({ user: userName, content, date });

        // Append en la columna ITILFollowup del ticket
        await this.appendFollowupBlock(ticketId, block);

        // Marca como procesado (tabla auxiliar)
        await this.markProcessed({ followupId, ticketId, userName, content, date });

        logger.info(`[SYNC][Followup] Ticket ${ticketId} + followup ${followupId} agregado`);
      } catch (err) {
        if (err?.response?.status === 401 || err?.response?.status === 403) {
          logger.warn('[GLPI] Sesión expirada. Reintentando login...');
          invalidateSession();
        } else {
          logger.error(`[ERROR][Followup] log ${log.id} / ticket ${ticketId} / followup ${followupId}:`, err.message);
        }
      } finally {
        this.processing.delete(followupId);
      }
    }
  }

  async isFollowupAlreadyProcessed(followupId) {
    const pool = getDB();
    const [rows] = await pool.query(`SELECT 1 FROM ticket_followups WHERE followup_id = ? LIMIT 1`, [followupId]);
    return rows.length > 0;
  }

  async appendFollowupBlock(ticketId, block) {
    const pool = getDB();
    const [rows] = await pool.query(`SELECT ITILFollowup FROM tickets WHERE id = ? LIMIT 1`, [ticketId]);
    const prev = rows?.[0]?.ITILFollowup || '';
    const needsNL = prev && !prev.endsWith('\n') ? '\n' : '';
    const next = prev ? `${prev}${needsNL}${block}\n` : `${block}\n`;
    await pool.query(`UPDATE tickets SET ITILFollowup = ? WHERE id = ?`, [next, ticketId]);
  }

  async markProcessed({ followupId, ticketId, userName, content, date }) {
    const pool = getDB();
    await pool.query(
      `INSERT IGNORE INTO ticket_followups (followup_id, ticket_id, user_name, content, date) VALUES (?, ?, ?, ?, ?)`,
      [followupId, ticketId, userName || null, content || null, date || null]
    );
  }
}
