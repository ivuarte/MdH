// src/services/arandaSolutionsSyncService.js
import axios from 'axios';
import { getDB } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

// Convierte respuesta tipo [{Field,Value}, ...] a objeto
function fieldsArrayToObject(arr) {
  const out = {};
  if (Array.isArray(arr)) {
    for (const it of arr) if (it && it.Field != null) out[it.Field] = it.Value;
  } else if (arr && typeof arr === 'object') return arr;
  return out;
}
function truthy(v) {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'ok' || s === 'success';
}
// Mapea GLPI type → segmento Aranda (1 = Incidencia, 4 = Requerimiento)
function arandaSegmentFromGlpiType(glpiType) {
  const t = Number(glpiType);
  return t === 2 ? 4 : 1;
}

export class ArandaSolutionsSyncService {
  constructor(opts = {}) {
    this.name = 'ArandaSolutionsSyncService';
    this.pollSeconds = Math.max(5, Number(opts.POLL_INTERVAL || 20));
    this.timer = null;
    this.processing = new Set(); // solution_ids en curso

    this.http = axios.create({
      baseURL: config.ARANDA_BASE_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: s => s >= 200 && s < 300
    });
    this.sessionId = null;
  }

  async start() {
    logger.info(`[${this.name}] Iniciando... (poll=${this.pollSeconds}s)`);
    await this.ensureMetaTables();
    await this.ensureLogin();
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

  async ensureMetaTables() {
    const pool = getDB();
    // Dedupe/estado de envíos de soluciones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aranda_solution_updates (
        solution_id   BIGINT NOT NULL,
        ticket_id     INT NOT NULL,
        aranda_item_id BIGINT NOT NULL,
        status        VARCHAR(16) NOT NULL DEFAULT 'synced', -- synced | failed
        tries         INT NOT NULL DEFAULT 0,
        last_error    TEXT NULL,
        posted_at     TIMESTAMP NULL DEFAULT NULL,
        updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (solution_id),
        KEY idx_ticket_id (ticket_id),
        KEY idx_aranda_item_id (aranda_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    logger.info('[DB] OK tabla aranda_solution_updates');
  }

  async ensureLogin() {
    if (this.sessionId) return this.sessionId;
    const payload = [
      { Field: 'username', Value: config.ARANDA_USERNAME },
      { Field: 'password', Value: config.ARANDA_PASSWORD }
    ];
    const res = await this.http.post('/user/login', payload);
    const obj = fieldsArrayToObject(res.data);
    const ok = truthy(obj.result);
    if (!ok || !obj.sessionId) throw new Error(`Login Aranda falló: result=${obj.result ?? '??'}`);
    this.sessionId = obj.sessionId;
    logger.info('[Aranda] Sesión iniciada (solutions).');
    return this.sessionId;
  }

  authHeaders() {
    if (!this.sessionId) throw new Error('No hay sessionId de Aranda');
    return { Authorization: this.sessionId }; // sin 'Bearer'
  }

  /**
   * Busca soluciones nuevas (o fallidas con reintentos <5) y las envía a Aranda.
   */
  async tick() {
    const pool = getDB();
    const [rows] = await pool.query(`
      SELECT
        s.solution_id,
        s.ticket_id,
        s.content,
        t.type AS glpi_type,
        ai.aranda_item_id,
        COALESCE(asu.tries, 0) AS tries,
        asu.status AS prev_status
      FROM ticket_solutions s
      JOIN tickets t       ON t.id = s.ticket_id
      JOIN aranda_items ai ON ai.ticket_id = s.ticket_id
      LEFT JOIN aranda_solution_updates asu ON asu.solution_id = s.solution_id
      WHERE
        asu.solution_id IS NULL                 -- nunca enviado
        OR (asu.status = 'failed' AND asu.tries < 5)  -- reintentos
      ORDER BY s.solution_id ASC
      LIMIT 100
    `);

    for (const row of rows) {
      const { solution_id, ticket_id, content, glpi_type, aranda_item_id, tries } = row;

      if (this.processing.has(solution_id)) continue;
      this.processing.add(solution_id);

      try {
        await this.ensureLogin();
        await this.sendSolution(aranda_item_id, glpi_type, content);
        await this.markSynced(ticket_id, aranda_item_id, solution_id);
        logger.info(`[SYNC][GLPI→Aranda] Solución enviada (ticket ${ticket_id}, solution ${solution_id})`);
      } catch (err) {
        await this.markFailed(ticket_id, aranda_item_id, solution_id, err.message, tries);
        logger.error(`[ERROR][GLPI→Aranda] ticket ${ticket_id}, solution ${solution_id}:`, err.message);
      } finally {
        this.processing.delete(solution_id);
      }
    }
  }

  async sendSolution(arandaItemId, glpiType, content) {
    const segment = arandaSegmentFromGlpiType(glpiType); // 1 o 4
    const userId = Number(config.ARANDA_AUTHOR_ID);      // 2314762 (fijo)
    const url = `/item/update/${arandaItemId}/${segment}/${userId}`;
    const body = [
      { Field: 'Commentary', Value: content || '' }      // SOLUCIÓN
    ];

    try {
      const res = await this.http.post(url, body, { headers: this.authHeaders() });
      const obj = fieldsArrayToObject(res.data);
      const ok = truthy(obj.result ?? obj.Result ?? true);
      if (!ok) throw new Error(`Aranda devolvió fallo al actualizar solución: ${JSON.stringify(obj)}`);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        // re-login + reintento 1 vez
        this.sessionId = null;
        await this.ensureLogin();
        const res2 = await this.http.post(url, body, { headers: this.authHeaders() });
        const obj2 = fieldsArrayToObject(res2.data);
        const ok2 = truthy(obj2.result ?? obj2.Result ?? true);
        if (!ok2) throw new Error(`Aranda devolvió fallo tras relogin (solution): ${JSON.stringify(obj2)}`);
        return;
      }
      throw err;
    }
  }

  async markSynced(ticketId, arandaItemId, solutionId) {
    const pool = getDB();
    await pool.query(
      `INSERT INTO aranda_solution_updates (solution_id, ticket_id, aranda_item_id, status, tries, last_error, posted_at)
       VALUES (?, ?, ?, 'synced', 1, NULL, NOW())
       ON DUPLICATE KEY UPDATE
         status     = 'synced',
         last_error = NULL,
         posted_at  = NOW()`,
      [solutionId, ticketId, arandaItemId]
    );
  }

  async markFailed(ticketId, arandaItemId, solutionId, errorMsg, tries = 0) {
    const pool = getDB();
    await pool.query(
      `INSERT INTO aranda_solution_updates (solution_id, ticket_id, aranda_item_id, status, tries, last_error)
       VALUES (?, ?, ?, 'failed', ?, ?)
       ON DUPLICATE KEY UPDATE
         status     = 'failed',
         tries      = tries + 1,
         last_error = VALUES(last_error)`,
      [solutionId, ticketId, arandaItemId, (Number(tries) || 0) + 1, String(errorMsg).slice(0, 2000)]
    );
  }
}
