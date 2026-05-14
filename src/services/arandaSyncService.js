// src/services/arandaSyncService.js
import axios from 'axios';
import he from 'he';
import { getDB } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

function normalizeText(html, maxLen = null) {
  if (html == null) return '';
  let s = typeof html === 'string' ? html : String(html);
  s = he.decode(s);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>\s*<p>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
  if (maxLen && s.length > maxLen) return s.slice(0, maxLen - 1) + '…';
  return s;
}

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

function pickPossibleId(obj) {
  const keys = ['itemId', 'ItemId', 'id', 'Id', 'RequestId', 'requestId', 'Consecutive', 'consecutive'];
  for (const k of keys) {
    if (obj[k] != null) {
      const n = Number(obj[k]);
      if (Number.isFinite(n)) return n;
      const m = String(obj[k]).match(/(\d+)/);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

// ⬇️ NUEVO: extrae el "composedItemId" (código legible de Aranda)
function pickComposedId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const keys = ['composedItemId', 'ComposedItemId', 'itemCode', 'ItemCode', 'code', 'Code'];
  for (const k of keys) {
    if (obj[k] != null) return String(obj[k]);
  }
  return null;
}

// endpoint según type (1=Incidencia, 2=Requerimiento)
function resolveAddPathByType(type) {
  const t = Number(type);
  if (t === 2) return '/item/add/4';
  if (t === 1) return '/item/add/1';
  logger.warn(`[ArandaSyncService] type desconocido (${type}), usando /item/add/1 por defecto`);
  return '/item/add/1';
}

export class ArandaSyncService {
  constructor(opts = {}) {
    this.name = 'ArandaSyncService';
    this.pollSeconds = Math.max(5, Number(opts.POLL_INTERVAL || 20));
    this.timer = null;
    this.processing = new Set();
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
    await this.ensureSchemaUpToDate(); // ⬅️ migración en caliente
    await this.ensureLogin();
    await this.tick();
    this.timer = setInterval(() => this.tick().catch(e => logger.error(`[${this.name}] tick error:`, e.message)), this.pollSeconds * 1000);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    logger.info(`[${this.name}] Detenido.]`);
  }

  async ensureMetaTables() {
    const pool = getDB();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aranda_items (
        ticket_id INT NOT NULL,
        aranda_item_id BIGINT NULL,
        composed_item_id VARCHAR(128) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'synced',
        last_error TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (ticket_id),
        KEY idx_aranda_item_id (aranda_item_id),
        KEY idx_composed_item_id (composed_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    logger.info('[DB] OK tabla aranda_items');
  }

  // ⬇️ NUEVO: si la tabla ya existía sin la columna nueva, la añadimos
  async ensureSchemaUpToDate() {
    const pool = getDB();
    const [cols] = await pool.query(`SHOW COLUMNS FROM aranda_items LIKE 'composed_item_id'`);
    if (cols.length === 0) {
      await pool.query(`ALTER TABLE aranda_items ADD COLUMN composed_item_id VARCHAR(128) NULL`);
      await pool.query(`CREATE INDEX idx_composed_item_id ON aranda_items (composed_item_id)`);
      logger.info('[DB] Añadida columna composed_item_id e índice.');
    }
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
    if (!ok || !obj.sessionId) {
      throw new Error(`Login Aranda falló: result=${obj.result ?? '??'}`);
    }
    this.sessionId = obj.sessionId;
    logger.info('[Aranda] Sesión iniciada.');
    return this.sessionId;
  }

  authHeaders() {
    if (!this.sessionId) throw new Error('No hay sessionId de Aranda');
    return { Authorization: this.sessionId };
  }

  async tick() {
    const pool = getDB();
    const [rows] = await pool.query(`
      SELECT t.id, t.nombre, t.content, t.type
      FROM tickets t
      LEFT JOIN aranda_items a ON a.ticket_id = t.id
      WHERE a.ticket_id IS NULL
      ORDER BY t.id ASC
      LIMIT 50
    `);

    for (const row of rows) {
      const ticketId = row.id;
      if (this.processing.has(ticketId)) continue;
      this.processing.add(ticketId);
      try {
        await this.createArandaItemFromTicket(row);
      } catch (err) {
        logger.error(`[${this.name}] Ticket ${ticketId} error:`, err.message);
      } finally {
        this.processing.delete(ticketId);
      }
    }
  }

  async createArandaItemFromTicket(ticketRow) {
    await this.ensureLogin();

    const desc = normalizeText(ticketRow.content, 4000);
    const subj = normalizeText(ticketRow.nombre, 255);

    const body = [
      { Field: 'AuthorId',       Value: config.ARANDA_AUTHOR_ID },
      { Field: 'CategoryId',     Value: config.ARANDA_CATEGORY_ID },
      { Field: 'CustomerId',     Value: config.ARANDA_CUSTOMER_ID },
      { Field: 'Description',    Value: desc || '(sin descripción)' },
      { Field: 'GroupId',        Value: config.ARANDA_GROUP_ID },
      { Field: 'ResponsibleId',  Value: (config.ARANDA_RESPONSIBLE_ID ?? config.ARANDA_CUSTOMER_ID) },
      { Field: 'ProjectId',      Value: config.ARANDA_PROJECT_ID },
      { Field: 'RegistryTypeId', Value: config.ARANDA_REGISTRY_TYPE_ID },
      { Field: 'ServiceId',      Value: config.ARANDA_SERVICE_ID },
      { Field: 'Subject',        Value: subj || '(sin asunto)' },
      { Field: 'SlaId',          Value: config.ARANDA_SLA_ID },
      { Field: 'UrgencyId',      Value: config.ARANDA_URGENCY_ID }
    ];
    if (config.ARANDA_COMPANY_ID != null) {
      body.push({ Field: 'CompanyId', Value: config.ARANDA_COMPANY_ID });
    }

    const addPath = resolveAddPathByType(ticketRow.type);
    const tipoTxt = Number(ticketRow.type) === 2 ? 'Requerimiento' : 'Incidencia';
    logger.info(`[SYNC][Aranda] Creando ${tipoTxt} para ticket ${ticketRow.id} -> ${addPath}`);

    try {
      const res = await this.http.post(addPath, body, { headers: this.authHeaders() });
      const obj = fieldsArrayToObject(res.data);
      const ok = truthy(obj.result ?? obj.Result ?? true);
      const arandaId = pickPossibleId(obj);
      const composedId = pickComposedId(obj); // ⬅️ NUEVO

      if (!ok) throw new Error(`Creación en Aranda reportó fallo. Respuesta: ${JSON.stringify(obj)}`);

      await this.markSynced(ticketRow.id, arandaId, composedId);
      logger.info(`[SYNC][Aranda] Ticket ${ticketRow.id} creado en Aranda${arandaId ? ` (id ${arandaId})` : ''}${composedId ? `, composedItemId=${composedId}` : ''}`);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        logger.warn('[Aranda] Token expirado. Reintentando login...');
        this.sessionId = null;
        await this.ensureLogin();
        const res2 = await this.http.post(addPath, body, { headers: this.authHeaders() });
        const obj2 = fieldsArrayToObject(res2.data);
        const ok2 = truthy(obj2.result ?? obj2.Result ?? true);
        const arandaId2 = pickPossibleId(obj2);
        const composedId2 = pickComposedId(obj2);
        if (!ok2) throw new Error(`Creación en Aranda falló tras relogin: ${JSON.stringify(obj2)}`);
        await this.markSynced(ticketRow.id, arandaId2, composedId2);
        logger.info(`[SYNC][Aranda] Ticket ${ticketRow.id} creado en Aranda tras relogin${arandaId2 ? ` (id ${arandaId2})` : ''}${composedId2 ? `, composedItemId=${composedId2}` : ''}`);
        return;
      }

      await this.markFailed(ticketRow.id, err.message);
      throw err;
    }
  }

  async markSynced(ticketId, arandaItemId, composedItemId) {
    const pool = getDB();
    await pool.query(
      `INSERT INTO aranda_items (ticket_id, aranda_item_id, composed_item_id, status, last_error)
       VALUES (?, ?, ?, 'synced', NULL)
       ON DUPLICATE KEY UPDATE
         aranda_item_id   = VALUES(aranda_item_id),
         composed_item_id = VALUES(composed_item_id),
         status           = 'synced',
         last_error       = NULL`,
      [ticketId, arandaItemId ?? null, composedItemId ?? null]
    );
  }

  async markFailed(ticketId, errorMsg) {
    const pool = getDB();
    await pool.query(
      `INSERT INTO aranda_items (ticket_id, aranda_item_id, composed_item_id, status, last_error)
       VALUES (?, NULL, NULL, 'failed', ?)
       ON DUPLICATE KEY UPDATE
         status     = 'failed',
         last_error = VALUES(last_error)`,
      [ticketId, String(errorMsg).slice(0, 2000)]
    );
  }
}
