// src/services/statusSyncService.js
import axios from 'axios';
import { getDB } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { glpi, ensureSession, authHeaders, invalidateSession } from '../lib/glpi.js';

// Util Aranda: respuesta [{Field,Value}, ...] -> objeto
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

// Segmento Aranda por tipo de GLPI (1=Incidencia, 2=Requerimiento)
function arandaSegmentFromGlpiType(glpiType) {
  return Number(glpiType) === 2 ? 4 : 1;
}

// Mapeos GLPI -> Aranda (solo los requeridos)
function mapGlpiToAranda(state) {
  const s = Number(state);
  // 2 o 3 -> Proceso(20), Reason 7
  if (s === 2 || s === 3) return { StateId: 20, ReasonId: 7 };
  // 4 -> Resuelto(19), Reason 8
  if (s === 4) return { StateId: 19, ReasonId: 8 };
  // 5 -> Cerrado(21), Reason 10
  if (s === 5) return { StateId: 21, ReasonId: 10 };
  return null; // otros: sin acción
}

// Mapeos Aranda -> GLPI
function mapArandaToGlpi(stateId) {
  const s = Number(stateId);
  if (s === 21) return 5; // Cerrado
  if (s === 19) return 4; // Resuelto
  if (s === 20) return 2; // En proceso
  return null;
}

export class StatusSyncService {
  constructor(opts = {}) {
    this.name = 'StatusSyncService';
    this.pollSeconds = Math.max(5, Number(opts.POLL_INTERVAL || 20));
    this.timer = null;
    this.processingPush = new Set(); // ticket_ids GLPI->Aranda
    this.processingPull = false;     // bandera única para pull

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
    await this.ensureSchema();
    await this.ensureLogin();
    await ensureSession();
    await this.tick(); // primer barrido
    this.timer = setInterval(() => this.tick().catch(e => logger.error(`[${this.name}] tick error:`, e.message)),
                             this.pollSeconds * 1000);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    logger.info(`[${this.name}] Detenido.`);
  }

  async ensureSchema() {
    const pool = getDB();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aranda_status_sync (
        ticket_id INT NOT NULL,
        aranda_item_id BIGINT NOT NULL,
        last_glpi_status INT NULL,
        last_aranda_stateid INT NULL,
        last_push_at TIMESTAMP NULL DEFAULT NULL,
        last_pull_at TIMESTAMP NULL DEFAULT NULL,
        last_error TEXT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (ticket_id),
        KEY idx_aranda_item_id (aranda_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    logger.info('[DB] OK tabla aranda_status_sync');
  }

  // --- Aranda auth ---
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
    logger.info('[Aranda] Sesión iniciada (status).');
    return this.sessionId;
  }
  authHeaders() {
    if (!this.sessionId) throw new Error('No hay sessionId de Aranda');
    return { Authorization: this.sessionId };
  }

  async tick() {
    await Promise.all([
      this.pushGlpiToAranda().catch(e => logger.error(`[${this.name}] push error:`, e.message)),
      this.pullArandaToGlpi().catch(e => logger.error(`[${this.name}] pull error:`, e.message))
    ]);
  }

  // ---------------- GLPI -> Aranda ----------------
  async pushGlpiToAranda() {
    const pool = getDB();
    const [rows] = await pool.query(`
      SELECT
        t.id           AS ticket_id,
        t.status       AS glpi_status,
        t.type         AS glpi_type,
        ai.aranda_item_id,
        ass.last_glpi_status
      FROM tickets t
      JOIN aranda_items ai ON ai.ticket_id = t.id
      LEFT JOIN aranda_status_sync ass ON ass.ticket_id = t.id
      WHERE t.status IN (2,3,4,5)
        AND (ass.ticket_id IS NULL OR ass.last_glpi_status IS NULL OR ass.last_glpi_status <> t.status)
      ORDER BY t.id ASC
      LIMIT 100
    `);

    for (const row of rows) {
      const { ticket_id, glpi_status, glpi_type, aranda_item_id } = row;
      if (this.processingPush.has(ticket_id)) continue;
      const mapped = mapGlpiToAranda(glpi_status);
      if (!mapped) continue;

      this.processingPush.add(ticket_id);
      try {
        await this.ensureLogin();

        const segment = arandaSegmentFromGlpiType(glpi_type);
        const url = `/item/update/${aranda_item_id}/${segment}/${config.ARANDA_AUTHOR_ID}`;
        const body = [
          { Field: 'StateId',  Value: mapped.StateId },
          { Field: 'ReasonId', Value: mapped.ReasonId }
        ];

        try {
          const res = await this.http.post(url, body, { headers: this.authHeaders() });
          const obj = fieldsArrayToObject(res.data);
          const ok = truthy(obj.result ?? obj.Result ?? true);
          if (!ok) throw new Error(`Aranda devolvió fallo en update: ${JSON.stringify(obj)}`);
        } catch (err) {
          const st = err?.response?.status;
          if (st === 401 || st === 403) {
            this.sessionId = null;
            await this.ensureLogin();
            const res2 = await this.http.post(url, body, { headers: this.authHeaders() });
            const obj2 = fieldsArrayToObject(res2.data);
            const ok2 = truthy(obj2.result ?? obj2.Result ?? true);
            if (!ok2) throw new Error(`Aranda update falló tras relogin: ${JSON.stringify(obj2)}`);
          } else {
            throw err;
          }
        }

        await pool.query(
          `INSERT INTO aranda_status_sync (ticket_id, aranda_item_id, last_glpi_status, last_aranda_stateid, last_push_at, last_error)
           VALUES (?, ?, ?, ?, NOW(), NULL)
           ON DUPLICATE KEY UPDATE
             last_glpi_status   = VALUES(last_glpi_status),
             last_aranda_stateid= VALUES(last_aranda_stateid),
             last_push_at       = NOW(),
             last_error         = NULL`,
          [ticket_id, aranda_item_id, glpi_status, mapped.StateId]
        );
        logger.info(`[SYNC][GLPI→Aranda] Ticket ${ticket_id} -> StateId=${mapped.StateId}, ReasonId=${mapped.ReasonId}`);
      } catch (e) {
        await pool.query(
          `INSERT INTO aranda_status_sync (ticket_id, aranda_item_id, last_error)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE last_error = VALUES(last_error)`,
          [row.ticket_id, row.aranda_item_id, String(e.message).slice(0, 2000)]
        );
        logger.error(`[ERROR][GLPI→Aranda] ticket ${row.ticket_id}:`, e.message);
      } finally {
        this.processingPush.delete(ticket_id);
      }
    }
  }

  // ---------------- Aranda -> GLPI ----------------
  async pullArandaToGlpi() {
    if (this.processingPull) return;
    this.processingPull = true;

    try {
      await this.ensureLogin();

      // Body de /item/list (lo que pasaste)
      const body = {
        Paging: { Start: 1, End: 50, Size: 0 },
        Criteria: [
          { FieldName: 'AuthorId', Value: String(config.ARANDA_AUTHOR_ID), LogicOperatorId: 1, ComparisonOperatorId: 5 }
        ],
        WhereCriteria: [],
        Order: { ColumnName: 'RegistrationDate', ModeId: 2 },
        ProjectId: config.ARANDA_PROJECT_ID,
        ViewId: 5
      };

      const res = await this.http.post('/item/list', body, { headers: this.authHeaders() });
      const data = res?.data?.Data;
      if (!Array.isArray(data) || data.length === 0) return;

      const pool = getDB();
      for (const it of data) {
        const arandaItemId = it?.Id;
        const arandaStateId = it?.StateId;
        if (!Number.isFinite(Number(arandaItemId)) || !Number.isFinite(Number(arandaStateId))) continue;

        // Mapear a GLPI
        const glpiStatus = mapArandaToGlpi(arandaStateId);
        if (glpiStatus == null) continue;

        // Buscar ticket GLPI por mapeo
        const [[mapRow]] = await pool.query(
          `SELECT ticket_id FROM aranda_items WHERE aranda_item_id = ? LIMIT 1`,
          [arandaItemId]
        );
        if (!mapRow) continue;

        const ticketId = mapRow.ticket_id;

        // Leer status actual DB para evitar llamadas innecesarias
        const [[tRow]] = await pool.query(`SELECT status FROM tickets WHERE id = ? LIMIT 1`, [ticketId]);
        const current = tRow ? Number(tRow.status) : null;

        if (current === glpiStatus) {
          // ya estamos alineados; actualiza espejo y sigue
          await pool.query(
            `INSERT INTO aranda_status_sync (ticket_id, aranda_item_id, last_glpi_status, last_aranda_stateid, last_pull_at, last_error)
             VALUES (?, ?, ?, ?, NOW(), NULL)
             ON DUPLICATE KEY UPDATE
               last_glpi_status    = VALUES(last_glpi_status),
               last_aranda_stateid = VALUES(last_aranda_stateid),
               last_pull_at        = NOW(),
               last_error          = NULL`,
            [ticketId, arandaItemId, glpiStatus, arandaStateId]
          );
          continue;
        }

        // Actualizar GLPI
        try {
          await ensureSession();
          await glpi.put(
            `/Ticket`,
            { input: { id: ticketId, status: glpiStatus } },
            { headers: authHeaders() }
          );
        } catch (err) {
          const st = err?.response?.status;
          if (st === 401 || st === 403) {
            invalidateSession();
            await ensureSession();
            await glpi.put(
              `/Ticket`,
              { input: { id: ticketId, status: glpiStatus } },
              { headers: authHeaders() }
            );
          } else {
            throw err;
          }
        }

        // Actualiza espejo
        await pool.query(
          `INSERT INTO aranda_status_sync (ticket_id, aranda_item_id, last_glpi_status, last_aranda_stateid, last_pull_at, last_error)
           VALUES (?, ?, ?, ?, NOW(), NULL)
           ON DUPLICATE KEY UPDATE
             last_glpi_status    = VALUES(last_glpi_status),
             last_aranda_stateid = VALUES(last_aranda_stateid),
             last_pull_at        = NOW(),
             last_error          = NULL`,
          [ticketId, arandaItemId, glpiStatus, arandaStateId]
        );

        logger.info(`[SYNC][Aranda→GLPI] Ticket ${ticketId} <- StateId=${arandaStateId} (GLPI status=${glpiStatus})`);
      }
    } catch (e) {
      logger.error(`[${this.name}] pull exception:`, e.message);
    } finally {
      this.processingPull = false;
    }
  }
}
