import { BaseService } from '../lib/baseService.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB, readCursor, writeCursor } from '../lib/db.js';
import { coerceInt, extractStr, normalizeHtml } from '../lib/utils.js';

// Detecta tickets nuevos en GLPI vía /log y los inserta en la tabla tickets (origin=GLPI).
// Tickets que ya existen con origin=ARANDA NO se sobreescriben en su columna origin — son los traídos desde Aranda.
export class GlpiTicketSyncService extends BaseService {
  constructor(opts = {}) {
    super('glpiTicketSync', opts);
    this.filterUser = opts.GLPI_FILTER_USER;
    this.lastSeenLogId = 0;
    this.processing = new Set();
  }

  async onStart() {
    this.lastSeenLogId = Number(await readCursor('glpi_ticket_log_cursor', '0')) || 0;
    this.log.info(`Cursor cargado lastSeenLogId=${this.lastSeenLogId}`);
  }

  async tick() {
    const logs = await glpiClient.getLog();
    if (!Array.isArray(logs) || logs.length === 0) return;

    const filtered = logs
      .filter(l =>
        l?.itemtype === 'Ticket' &&
        l?.user_name === this.filterUser &&
        typeof l?.items_id === 'number'
      )
      .sort((a, b) => a.id - b.id);

    for (const log of filtered) {
      if (this.stopping) return;
      if (log.id <= this.lastSeenLogId) continue;

      const ticketId = log.items_id;
      if (this.processing.has(ticketId)) continue;
      this.processing.add(ticketId);

      try {
        // Doble call: con expand para obtener el nombre legible de la categoría,
        // y raw para el id numérico (necesario para el mapeo con Aranda).
        const [t, traw] = await Promise.all([
          glpiClient.getTicket(ticketId),
          glpiClient.getTicketRaw(ticketId)
        ]);
        const mapped = this.mapTicket(t, traw);
        if (mapped.id == null) {
          this.log.warn(`Ticket ${ticketId} sin id en respuesta GLPI`);
        } else {
          await this.upsertTicket(mapped);
          this.log.info(`Ticket ${mapped.id} upsert`, { ticket_id: mapped.id, direction: 'GLPI_TO_DB' });
        }

        this.lastSeenLogId = Math.max(this.lastSeenLogId, log.id);
        await writeCursor('glpi_ticket_log_cursor', this.lastSeenLogId);
      } catch (err) {
        this.log.error(`Ticket ${ticketId} error`, { err, ticket_id: ticketId });
      } finally {
        this.processing.delete(ticketId);
      }
    }
  }

  mapTicket(t, traw = null) {
    // t  : respuesta con expand_dropdowns=true → itilcategories_id es un string (completename).
    // traw: respuesta sin expand → itilcategories_id es un INT (el id real).
    const rawCat = coerceInt(traw?.itilcategories_id, null);
    return {
      id: coerceInt(t?.id, null),
      nombre: t?.name ?? '',
      date_creation: t?.date ?? null,
      closedate: t?.closedate ?? null,
      solvedate: t?.solvedate ?? null,
      status: coerceInt(t?.status, 0),
      type: coerceInt(t?.type, 0),
      urgency: coerceInt(t?.urgency, null),
      impact: coerceInt(t?.impact, null),
      priority: coerceInt(t?.priority, null),
      users_id_recipient: extractStr(t?.users_id_recipient),
      content: t?.content ? normalizeHtml(t.content) : null,
      itilcategory_name: typeof t?.itilcategories_id === 'string' ? t.itilcategories_id : null,
      // 0 = "Sin categoría" en GLPI; lo normalizamos a NULL para que el JOIN con
      // service_catalog_sync no enmascare tickets sin mapeo.
      itilcategories_id: rawCat && rawCat > 0 ? rawCat : null
    };
  }

  // UPSERT que respeta origin: si el ticket ya existe (creado desde Aranda),
  // no cambia su origin a 'GLPI'. Los demás campos sí se refrescan.
  async upsertTicket(t) {
    const pool = getDB();
    await pool.query(
      `INSERT INTO tickets
        (id, origin, nombre, date_creation, closedate, solvedate, status, type, urgency, impact, priority, users_id_recipient, content, itilcategory_name, itilcategories_id)
       VALUES (?, 'GLPI', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        nombre = VALUES(nombre),
        date_creation = COALESCE(VALUES(date_creation), date_creation),
        closedate = VALUES(closedate),
        solvedate = VALUES(solvedate),
        status = VALUES(status),
        type = VALUES(type),
        urgency = VALUES(urgency),
        impact = VALUES(impact),
        priority = VALUES(priority),
        users_id_recipient = COALESCE(VALUES(users_id_recipient), users_id_recipient),
        content = COALESCE(VALUES(content), content),
        itilcategory_name = COALESCE(VALUES(itilcategory_name), itilcategory_name),
        itilcategories_id = COALESCE(VALUES(itilcategories_id), itilcategories_id)`,
      [t.id, t.nombre, t.date_creation, t.closedate, t.solvedate, t.status, t.type, t.urgency, t.impact, t.priority, t.users_id_recipient, t.content, t.itilcategory_name, t.itilcategories_id]
    );
  }
}
