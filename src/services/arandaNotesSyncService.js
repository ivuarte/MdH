// src/services/arandaNotesSyncService.js

/*
aprovecha la siguiente db donde se van agregando las notas: select * from ticket_followups;
cada que se agregue un registro valide el ticket_id de glpi lo busque por ticket_id en la 
tabla: select * from aranda_items;
que fueron los que ya se crearon en aranda y de alli obtenga el aranda_item_id para usarlo en el endpoint de la nota https://mesadeserviciostic.hacienda.go.cr/ASDKAPI/api/v8.6/item/351986/4/note en este caso seria 351986 por ultimo valide la tabla select type from tickets where id=42170 ; +------+ | type | +------+ | 1 | +------+ con el id de glpi y si es 1, en aranda el parametro antes de note use 1que es incidente y si en glpi es 2 en aranda use 4 que es requerimiento
*/
import axios from 'axios';
import { getDB } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

// util respuesta Aranda [{Field,Value}, ...] -> objeto
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
// mapea type de GLPI → segmento de Aranda para notas
function arandaNoteTypeSegment(glpiType) {
  const t = Number(glpiType);
  if (t === 2) return 4; // requerimiento en Aranda
  return 1;              // incidencia por defecto
}

export class ArandaNotesSyncService {
  constructor(opts = {}) {
    this.name = 'ArandaNotesSyncService';
    this.pollSeconds = Math.max(5, Number(opts.POLL_INTERVAL || 20));
    this.timer = null;
    this.processing = new Set(); // followup_ids en curso

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
    this.timer = setInterval(() => this.tick().catch(e => logger.error(`[${this.name}] tick error:`, e.message)), this.pollSeconds * 1000);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    logger.info(`[${this.name}] Detenido.`);
  }

  async ensureMetaTables() {
    const pool = getDB();
    // tabla para marcar followups enviados a Aranda
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aranda_followup_notes (
        followup_id BIGINT NOT NULL,
        ticket_id INT NOT NULL,
        aranda_item_id BIGINT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'synced', -- synced | failed
        tries INT NOT NULL DEFAULT 0,
        last_error TEXT NULL,
        posted_at TIMESTAMP NULL DEFAULT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (followup_id),
        KEY idx_ticket_id (ticket_id),
        KEY idx_aranda_item_id (aranda_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    logger.info('[DB] OK tabla aranda_followup_notes');
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
    logger.info('[Aranda] Sesión iniciada (notes).');
    return this.sessionId;
  }

  authHeaders() {
    if (!this.sessionId) throw new Error('No hay sessionId de Aranda');
    return { Authorization: this.sessionId }; // sin 'Bearer'
  }

  /**
   * Selecciona followups de GLPI aún no enviados a Aranda.
   * - Se salta los que contengan "caso aranda:" para evitar bucle.
   * - Reintenta los que tengan status='failed' (contries<5 por ejemplo).
   */
  async tick() {
    const pool = getDB();
    const [rows] = await pool.query(`
      SELECT
        f.followup_id,
        f.ticket_id,
        f.content,
        t.type AS glpi_type,
        ai.aranda_item_id,
        COALESCE(an.tries, 0) AS tries,
        an.status AS prev_status
      FROM ticket_followups f
      JOIN tickets t        ON t.id = f.ticket_id
      JOIN aranda_items ai  ON ai.ticket_id = f.ticket_id
      LEFT JOIN aranda_followup_notes an ON an.followup_id = f.followup_id
      WHERE
        -- nunca enviado
        an.followup_id IS NULL
        -- o falló antes (reintentar hasta 5 veces)
        OR (an.status = 'failed' AND an.tries < 5)
      ORDER BY f.followup_id ASC
      LIMIT 100
    `);

    for (const row of rows) {
      const { followup_id, ticket_id, content, glpi_type, aranda_item_id, tries } = row;

      // evita loop por nuestra propia “backlink” a GLPI
      if (typeof content === 'string' && /^caso\s+aranda\s*:/i.test(content)) {
        // lo marcamos como synced para no seguirlo intentando
        await this.markSynced(ticket_id, aranda_item_id, followup_id);
        continue;
      }

      if (this.processing.has(followup_id)) continue;
      this.processing.add(followup_id);

      try {
        await this.ensureLogin();
        await this.sendNote(aranda_item_id, glpi_type, content);
        await this.markSynced(ticket_id, aranda_item_id, followup_id);
        logger.info(`[SYNC][GLPI→Aranda] Nota enviada (ticket ${ticket_id}, followup ${followup_id})`);
      } catch (err) {
        await this.markFailed(ticket_id, aranda_item_id, followup_id, err.message, tries);
        logger.error(`[ERROR][GLPI→Aranda] ticket ${ticket_id}, followup ${followup_id}:`, err.message);
      } finally {
        this.processing.delete(followup_id);
      }
    }
  }

  async sendNote(arandaItemId, glpiType, content) {
    const segment = arandaNoteTypeSegment(glpiType); // 1 o 4
    const url = `/item/${arandaItemId}/${segment}/note`;
    const body = {
      Description: content || '',
      IsPrivate: false
    };

    try {
      const res = await this.http.post(url, body, { headers: this.authHeaders() });
      const obj = fieldsArrayToObject(res.data);
      const ok = truthy(obj.result ?? obj.Result ?? true);
      if (!ok) throw new Error(`Aranda devolvió fallo al crear nota: ${JSON.stringify(obj)}`);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        // re-login + reintento 1 vez
        this.sessionId = null;
        await this.ensureLogin();
        const res2 = await this.http.post(url, body, { headers: this.authHeaders() });
        const obj2 = fieldsArrayToObject(res2.data);
        const ok2 = truthy(obj2.result ?? obj2.Result ?? true);
        if (!ok2) throw new Error(`Aranda devolvió fallo tras relogin: ${JSON.stringify(obj2)}`);
        return;
      }
      throw err;
    }
  }

  async markSynced(ticketId, arandaItemId, followupId) {
    const pool = getDB();
    await pool.query(
      `INSERT INTO aranda_followup_notes (followup_id, ticket_id, aranda_item_id, status, tries, last_error, posted_at)
       VALUES (?, ?, ?, 'synced', 1, NULL, NOW())
       ON DUPLICATE KEY UPDATE
         status     = 'synced',
         last_error = NULL,
         posted_at  = NOW()`,
      [followupId, ticketId, arandaItemId]
    );
  }

  async markFailed(ticketId, arandaItemId, followupId, errorMsg, tries = 0) {
    const pool = getDB();
    await pool.query(
      `INSERT INTO aranda_followup_notes (followup_id, ticket_id, aranda_item_id, status, tries, last_error)
       VALUES (?, ?, ?, 'failed', ?, ?)
       ON DUPLICATE KEY UPDATE
         status     = 'failed',
         tries      = tries + 1,
         last_error = VALUES(last_error)`,
      [followupId, ticketId, arandaItemId, (Number(tries) || 0) + 1, String(errorMsg).slice(0, 2000)]
    );
  }
}
