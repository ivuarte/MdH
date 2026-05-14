// src/services/solutionSyncService.js
import he from 'he';
import { glpi, ensureSession, authHeaders, invalidateSession } from '../lib/glpi.js';
import { getDB } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { extractStr } from '../lib/utils.js';

function normalizeContent(v) {
  if (v == null) return '';
  let s = typeof v === 'string' ? v : String(v);
  s = he.decode(s);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>\s*<p>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  return s.trim();
}

// Mismo formato de bloque, cambiando la etiqueta a "solucion" para distinguir
function formatBlock({ user, content, date }) {
  const lines = [
    '****************************',
    `user: ${user || ''}`.trim(),
    `solucion: ${content || ''}`.trim(),
    `fecha: ${date || ''}`.trim(),
    '****************************'
  ];
  return lines.join('\n');
}

function parseNumericId(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/(\d+)/);
    return m ? Number(m[1]) : NaN;
  }
  return NaN;
}

function parseTicketIdFromLinks(links) {
  if (!Array.isArray(links)) return null;
  for (const lk of links) {
    const href = lk?.href || '';
    const m = href.match(/\/Ticket\/(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

export class ITILSolutionSyncService {
  constructor(opts) {
    this.name = 'ITILSolutionSyncService';
    this.pollSeconds = Math.max(5, Number(opts.POLL_INTERVAL || 20));
    this.filterUser = opts.GLPI_FILTER_USER || null;
    this.timer = null;
    this.lastSeenLogId = 0;
    this.processing = new Set(); // solution_id en curso
  }

  async start() {
    logger.info(`[${this.name}] Iniciando... (poll=${this.pollSeconds}s${this.filterUser ? `, filtroUsuario="${this.filterUser}"` : ''})`);
    await this.ensureMetaTables();
    await ensureSession();
    await this.tick();
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
      CREATE TABLE IF NOT EXISTS ticket_solutions (
        solution_id BIGINT NOT NULL,
        ticket_id INT NOT NULL,
        user_name VARCHAR(255),
        content TEXT,
        date_creation DATETIME,
        PRIMARY KEY (solution_id),
        KEY idx_ticket_id (ticket_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    logger.info('[DB] OK tabla ticket_solutions');
  }

  async tick() {
    const headers = { ...authHeaders(), Range: 'items=0-99' };
    const url = `/log?order=DESC`;
    const res = await glpi.get(url, { headers });
    const logs = Array.isArray(res.data) ? res.data : [];

    // Soporta ambos patrones de logs:
    //  a) itemtype === 'Ticket' && itemtype_link === 'ITILSolution'  (items_id = ticketId, new_value = "41483 (41483)")
    //  b) itemtype === 'ITILSolution'                                (items_id = solutionId, links -> Ticket/{ticketId})
    const filtered = logs
      .filter(l => {
        const a = l?.itemtype === 'Ticket' && l?.itemtype_link === 'ITILSolution';
        const b = l?.itemtype === 'ITILSolution';
        const userOK = this.filterUser ? l?.user_name === this.filterUser : true;
        return (a || b) && userOK;
      })
      .sort((a, b) => a.id - b.id);

    for (const log of filtered) {
      if (log.id <= this.lastSeenLogId) continue;
      this.lastSeenLogId = Math.max(this.lastSeenLogId, log.id);

      let ticketId = null;
      let solutionId = null;

      if (log.itemtype === 'Ticket') {
        ticketId = Number(log.items_id);
        solutionId = parseNumericId(log.new_value);
      } else { // itemtype === 'ITILSolution'
        solutionId = Number(log.items_id);
        // Intentar obtener ticketId desde el propio recurso de ITILSolution
        try {
          await ensureSession();
          const sRes = await glpi.get(`/ITILSolution/${solutionId}?expand_dropdowns=true`, { headers: authHeaders() });
          ticketId = parseTicketIdFromLinks(sRes.data?.links);
          // si no se logra por links, intentará más abajo por la lista del ticket (pero sin ticketId no se puede)
        } catch (e) {
          logger.warn(`[${this.name}] No se pudo resolver ticketId desde ITILSolution/${solutionId}:`, e.message);
        }
      }

      if (!Number.isFinite(solutionId)) {
        logger.warn(`[${this.name}] solutionId inválido en log ${log.id}`);
        continue;
      }
      if (!Number.isFinite(ticketId)) {
        logger.warn(`[${this.name}] ticketId no resuelto para solution ${solutionId} (log ${log.id}). Se omite.`);
        continue;
      }

      if (this.processing.has(solutionId)) continue;
      this.processing.add(solutionId);

      try {
        // dedupe
        if (await this.isSolutionAlreadyProcessed(solutionId)) {
          continue;
        }

        await ensureSession();
        // Traer todas las soluciones del ticket y localizar la correspondiente
        const listRes = await glpi.get(`/Ticket/${ticketId}/ITILSolution?expand_dropdowns=true`, { headers: authHeaders() });
        const list = Array.isArray(listRes.data) ? listRes.data : [];
        const sol = list.find(x => Number(x?.id) === solutionId);
        if (!sol) {
          logger.warn(`[${this.name}] ITILSolution ${solutionId} no hallada en Ticket ${ticketId} (latencia posible).`);
          continue;
        }

        const userName = extractStr(sol.users_id);  // con expand_dropdowns suele venir string "controles"
        const content = normalizeContent(sol.content);
        const date = sol.date_creation || sol.date_mod || '';

        const block = formatBlock({ user: userName, content, date });
        await this.appendSolutionBlock(ticketId, block);
        await this.markProcessed({ solutionId, ticketId, userName, content, date });

        logger.info(`[SYNC][Solution] Ticket ${ticketId} + solution ${solutionId} agregado`);
      } catch (err) {
        if (err?.response?.status === 401 || err?.response?.status === 403) {
          logger.warn('[GLPI] Sesión expirada. Reintentando login...');
          invalidateSession();
        } else {
          logger.error(`[ERROR][Solution] log ${log.id} / ticket ${ticketId} / solution ${solutionId}:`, err.message);
        }
      } finally {
        this.processing.delete(solutionId);
      }
    }
  }

  async isSolutionAlreadyProcessed(solutionId) {
    const pool = getDB();
    const [rows] = await pool.query(`SELECT 1 FROM ticket_solutions WHERE solution_id = ? LIMIT 1`, [solutionId]);
    return rows.length > 0;
  }

  // Append atómico en la columna ITILSolution (sin SELECT previo)
  async appendSolutionBlock(ticketId, block) {
    const pool = getDB();
    await pool.query(
      `
      UPDATE tickets
      SET ITILSolution =
        CASE
          WHEN ITILSolution IS NULL OR ITILSolution = ''
            THEN CONCAT(?, '\n')
          ELSE CONCAT(
            ITILSolution,
            CASE WHEN RIGHT(ITILSolution, 1) = '\n' THEN '' ELSE '\n' END,
            ?, '\n'
          )
        END
      WHERE id = ?
      `,
      [block, block, ticketId]
    );
  }

  async markProcessed({ solutionId, ticketId, userName, content, date }) {
    const pool = getDB();
    await pool.query(
      `INSERT IGNORE INTO ticket_solutions (solution_id, ticket_id, user_name, content, date_creation) VALUES (?, ?, ?, ?, ?)`,
      [solutionId, ticketId, userName || null, content || null, date || null]
    );
  }
}
