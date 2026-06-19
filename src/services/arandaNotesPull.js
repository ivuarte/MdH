import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB } from '../lib/db.js';
import { config } from '../config.js';
import { FROM_ARANDA_TAG, normalizeHtml, hasOwnGlpiMarker, NOTE_FROM_GLPI_MARKER, TASK_FROM_GLPI_MARKER } from '../lib/utils.js';
import { recordEvent } from '../lib/syncEvents.js';
import { sha256 } from '../lib/hash.js';
import { readCursor, writeCursor } from '../lib/db.js';

// ASDKAPI v8.6 — el endpoint canónico para el historial de un caso es:
//   GET /item/{itemId}/{segment}/note/list
// Devuelve un array de entries con ActionType. Los relevantes:
//   16 = NOTA (comentario manual)
//   22 = AGREGAR TAREA (tarea añadida al caso)
// El campo Id es siempre 0 — no hay identificador estable, deduplicamos con hash compuesto
// de (itemId + AuthorName + CreationDate + Description).
const ACTION_TYPE_NOTE = 16;
const ACTION_TYPE_TASK = 22;
// Author que usa este sistema cuando inserta notas en Aranda. Comparamos por nombre (string) porque
// el endpoint /note/list no devuelve AuthorId numérico.
const SELF_AUTHOR_NAME_FALLBACK = 'Atena_GLPI';
// Cursor de bootstrap: cuando es 'done', el filtro anti-bucle ya no usa AuthorName, sólo markers.
// Antes de eso, marcamos como 'ignored' todas las entries existentes con author=bot y SIN marker
// (son notas legacy del bot pre-marker, no queremos re-importarlas a GLPI).
const BOOTSTRAP_CURSOR = 'aranda_notes_pull_bootstrap';

function arandaSegmentFromType(type) {
  return Number(type) === 2 ? 4 : 1;
}

// Convierte "/Date(1779480907687-0600)/" a Date ISO. Si falla, devuelve null.
function parseMsDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/\/Date\((\d+)[+-]\d+\)\//);
  if (!m) return null;
  const ms = Number(m[1]);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

// La "Description" en entries tipo TAREA viene como '<span class="font-bold"> - New Task: </span>tarea'.
// Limpiamos el HTML y extraemos el contenido tras 'New Task:'.
function extractTaskText(htmlDesc) {
  const clean = normalizeHtml(htmlDesc, 50000);
  const idx = clean.toLowerCase().indexOf('new task:');
  if (idx >= 0) return clean.slice(idx + 'new task:'.length).trim();
  return clean.trim();
}

// Construye id estable para deduplicación. Mismo formato para notas y tareas.
function stableEntryId(itemId, raw) {
  const author = raw?.AuthorName || '';
  const date = raw?.CreationDate || '';
  const desc = raw?.Description || '';
  return `n:${itemId}:${sha256(`${author}|${date}|${desc}`)}`.slice(0, 128);
}

// Devuelve true si el author del entry es el bot Atena.
// IMPORTANTE: esta cuenta es compartida con humanos en Aranda — no se puede usar como ÚNICO criterio
// de anti-bucle. Se usa en combinación con la presencia (o ausencia) de markers propios.
function isSelfAuthor(authorName) {
  if (!authorName) return false;
  const target = (config.ARANDA_USERNAME || SELF_AUTHOR_NAME_FALLBACK).trim().toLowerCase();
  return String(authorName).trim().toLowerCase() === target;
}

// Lee notas/historial de un caso Aranda y propaga:
//   - ActionType=16 (NOTA) → GLPI ITILFollowup (vía addFollowup), tabla aranda_inbound_notes
//   - ActionType=22 (TAREA) → GLPI TicketTask (vía addTicketTask), tabla aranda_inbound_tasks
// Anti-bucle (post-bootstrap):
//   - Salta entries con marker propio del bot ([Nota GLPI] o [Tarea GLPI]) — son ecos.
//   - Salta entries con marker FROM_ARANDA_TAG (defensivo).
//   - NO filtra por AuthorName solo: la cuenta del bot también la usan humanos en Aranda.
//   - Deduplicación final por aranda_note_id (hash estable) en BD.
// Bootstrap (primera vez):
//   - Marca como 'ignored' todas las entries con author=bot SIN marker (notas legacy pre-marker
//     que el bot insertó y no deberíamos re-importar).
//   - Escribe cursor aranda_notes_pull_bootstrap=done para activar el filtro definitivo.
export class ArandaNotesPullService extends BaseService {
  constructor(opts = {}) {
    super('arandaNotesPull', opts);
    this.processing = new Set();
    this.bootstrapDone = null;  // se resuelve perezosamente en el primer tick
  }

  async ensureBootstrap() {
    if (this.bootstrapDone === true) return;
    const cur = await readCursor(BOOTSTRAP_CURSOR);
    if (cur === 'done') { this.bootstrapDone = true; return; }
    this.log.info('Bootstrap inicial: marcando notas/tareas legacy del bot como ignored');
    await this.runBootstrap();
    await writeCursor(BOOTSTRAP_CURSOR, 'done');
    this.bootstrapDone = true;
    this.log.info('Bootstrap completado');
  }

  // Recorre items mapeados, lista note/list, y registra como ignored las entries
  // con author=bot, SIN marker, Y cuyo contenido coincide con un followup/task GLPI origin=GLPI
  // del mismo ticket (es decir, son ecos legacy de cuando el bot no agregaba marker).
  // Las entries de humanos usando la cuenta del bot QUEDAN sin marcar para procesarse normalmente.
  async runBootstrap() {
    const [items] = await getDB().query(
      `SELECT a.aranda_item_id, a.ticket_id, t.type AS glpi_type
         FROM aranda_items a JOIN tickets t ON t.id=a.ticket_id
        WHERE a.status='synced' AND a.aranda_item_id IS NOT NULL
          AND a.origin = 'GLPI'`
    );
    let ignored = 0, kept = 0;
    for (const it of items) {
      const segment = arandaSegmentFromType(it.glpi_type);
      let entries;
      try {
        entries = await arandaClient.getItemNoteList(it.aranda_item_id, segment);
      } catch { continue; }
      if (!Array.isArray(entries)) continue;

      // Pre-cargar todos los contenidos GLPI origin=GLPI del ticket — followups + tareas.
      // Normalizamos a prefijo de 80 chars en minúsculas para matching tolerante a fechas/firmas.
      const [glpiContents] = await getDB().query(
        `SELECT content FROM ticket_followups WHERE ticket_id=? AND origin='GLPI'
         UNION ALL
         SELECT content FROM ticket_tasks WHERE ticket_id=? AND origin='GLPI'`,
        [it.ticket_id, it.ticket_id]
      );
      const glpiPrefixes = new Set(
        glpiContents.map(r => normalizeHtml(r.content || '', 200).toLowerCase().slice(0, 80)).filter(Boolean)
      );

      for (const raw of entries) {
        const actionType = Number(raw?.ActionType);
        if (actionType !== ACTION_TYPE_NOTE && actionType !== ACTION_TYPE_TASK) continue;
        const desc = String(raw.Description || '').trim();
        if (!desc) continue;
        const cleanLower = normalizeHtml(desc, 300).toLowerCase();
        if (hasOwnGlpiMarker(cleanLower) || cleanLower.startsWith(FROM_ARANDA_TAG.toLowerCase())) continue;
        if (!isSelfAuthor(raw.AuthorName)) continue;
        // Eco real sólo si el contenido coincide con uno de los followups/tareas GLPI del ticket.
        const prefix = cleanLower.slice(0, 80);
        const isEcho = glpiPrefixes.has(prefix);
        if (!isEcho) { kept++; continue; }
        const entryId = stableEntryId(it.aranda_item_id, raw);
        const table = actionType === ACTION_TYPE_NOTE ? 'aranda_inbound_notes' : 'aranda_inbound_tasks';
        const pk = actionType === ACTION_TYPE_NOTE ? 'aranda_note_id' : 'aranda_task_id';
        try {
          await getDB().query(
            `INSERT IGNORE INTO ${table} (${pk}, aranda_item_id, glpi_ticket_id, description, author, status, tries)
             VALUES (?, ?, ?, ?, ?, 'ignored', 0)`,
            [entryId, it.aranda_item_id, it.ticket_id, normalizeHtml(desc, 50000), raw.AuthorName || null]
          );
          ignored++;
        } catch { /* tolerante */ }
      }
    }
    this.log.info(`Bootstrap: ${ignored} ecos legacy marcadas como ignored; ${kept} mantenidas para procesamiento normal`);
  }

  async tick() {
    await this.ensureBootstrap();
    const [items] = await getDB().query(
      `SELECT a.aranda_item_id, a.ticket_id, t.type AS glpi_type
         FROM aranda_items a
         JOIN tickets t ON t.id = a.ticket_id
        WHERE a.aranda_item_id IS NOT NULL
          AND a.status = 'synced'
          AND a.origin = 'GLPI'
        ORDER BY a.updated_at DESC
        LIMIT 200`
    );

    for (const it of items) {
      if (this.stopping) return;
      const { aranda_item_id, ticket_id, glpi_type } = it;
      const segment = arandaSegmentFromType(glpi_type);

      let entries;
      try {
        entries = await arandaClient.getItemNoteList(aranda_item_id, segment);
      } catch (err) {
        const status = err?.response?.status;
        // 404 puntual: el item ya no existe en ese segmento. No es razón para desactivar el servicio entero.
        if (status === 404) {
          // Probar con el segmento alterno una vez — caso de mapping con type GLPI equivocado.
          try {
            const altSeg = segment === 1 ? 4 : 1;
            entries = await arandaClient.getItemNoteList(aranda_item_id, altSeg);
            this.log.info(`note/list: segmento ${segment} dio 404, usando ${altSeg} para item ${aranda_item_id}`, { aranda_item_id, ticket_id });
          } catch (err2) {
            this.log.warn(`note/list 404 incluso con segmento alterno — item inaccesible`, { aranda_item_id, ticket_id, err: err2 });
            continue;
          }
        } else if (status === 403) {
          this.log.warn(`note/list 403 (ACL) — saltando item`, { aranda_item_id, ticket_id });
          continue;
        } else {
          this.log.warn(`note/list error item=${aranda_item_id}`, { err, aranda_item_id, ticket_id });
          continue;
        }
      }
      if (!Array.isArray(entries) || entries.length === 0) continue;

      for (const raw of entries) {
        if (this.stopping) return;
        if (!raw || typeof raw !== 'object') continue;

        const actionType = Number(raw.ActionType);
        if (actionType !== ACTION_TYPE_NOTE && actionType !== ACTION_TYPE_TASK) continue;

        const descRaw = String(raw.Description || '').trim();
        if (!descRaw) continue;

        // Anti-bucle por MARKER (no por author): la cuenta Atena_GLPI es compartida con humanos
        // en Aranda, así que isSelfAuthor sólo descartaría legítimas tareas/notas humanas.
        // El marker [Nota GLPI] / [Tarea GLPI] / [from aranda] sólo lo pone este sistema.
        const cleanCheck = normalizeHtml(descRaw, 300).toLowerCase();
        if (hasOwnGlpiMarker(cleanCheck)) continue;
        if (cleanCheck.startsWith(FROM_ARANDA_TAG.toLowerCase())) continue;

        const entryId = stableEntryId(aranda_item_id, raw);
        if (this.processing.has(entryId)) continue;
        this.processing.add(entryId);

        try {
          if (actionType === ACTION_TYPE_NOTE) {
            await this.handleNote({ ticket_id, aranda_item_id, raw, entryId });
          } else if (actionType === ACTION_TYPE_TASK) {
            await this.handleTask({ ticket_id, aranda_item_id, raw, entryId });
          }
        } catch (err) {
          this.log.error(`pull entry fallo aranda=${aranda_item_id} entry=${entryId}`, {
            err, aranda_item_id, ticket_id, action_type: actionType
          });
        } finally {
          this.processing.delete(entryId);
        }
      }
    }
  }

  async handleNote({ ticket_id, aranda_item_id, raw, entryId }) {
    const description = normalizeHtml(raw.Description || '', 50000);
    const author = raw.AuthorName || null;
    const dateObj = parseMsDate(raw.CreationDate);
    const dateIso = dateObj ? dateObj.toISOString().slice(0, 19).replace('T', ' ') : null;

    const [[exists]] = await getDB().query(
      `SELECT status FROM aranda_inbound_notes WHERE aranda_note_id = ? LIMIT 1`,
      [entryId]
    );
    if (exists && (exists.status === 'synced' || exists.status === 'ignored')) return;
    if (exists && exists.status === 'failed' && Number(exists.tries) >= 5) return;

    try {
      const marker = `${FROM_ARANDA_TAG} ${author ? author + ' — ' : ''}${dateIso || ''}`.trim();
      const content = `${marker}\n\n${description}`;
      const res = await glpiClient.addFollowup(ticket_id, content);
      let newFollowupId = null;
      if (Array.isArray(res)) newFollowupId = Number(res[0]?.id);
      else if (res && typeof res === 'object') newFollowupId = Number(res.id);

      await getDB().query(
        `INSERT INTO aranda_inbound_notes
          (aranda_note_id, aranda_item_id, glpi_ticket_id, glpi_followup_id, description, author, author_id, posted_in_aranda_at, status, tries, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'synced', 1, NOW())
         ON DUPLICATE KEY UPDATE
           glpi_followup_id = VALUES(glpi_followup_id),
           status = 'synced',
           last_error = NULL,
           posted_at = NOW()`,
        [entryId, aranda_item_id, ticket_id, newFollowupId, description, author, dateIso]
      );

      // Insertar también en ticket_followups con origin=ARANDA para que arandaNotesPush NO lo reenvíe.
      if (Number.isFinite(newFollowupId)) {
        await getDB().query(
          `INSERT IGNORE INTO ticket_followups
            (followup_id, ticket_id, user_name, content, date, origin, external_id)
           VALUES (?, ?, ?, ?, ?, 'ARANDA', ?)`,
          [newFollowupId, ticket_id, author, description, dateIso, entryId]
        );
      }

      await recordEvent({
        direction: 'ARANDA_TO_GLPI', entityType: 'note',
        srcId: entryId, dstId: newFollowupId, content: description
      });

      this.log.info(`Nota Aranda → GLPI ticket=${ticket_id} fup=${newFollowupId}`, {
        aranda_item_id, ticket_id, followup_id: newFollowupId, direction: 'ARANDA_TO_GLPI'
      });
    } catch (err) {
      await getDB().query(
        `INSERT INTO aranda_inbound_notes
          (aranda_note_id, aranda_item_id, glpi_ticket_id, description, author, author_id, posted_in_aranda_at, status, tries, last_error)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 'failed', 1, ?)
         ON DUPLICATE KEY UPDATE
           status = 'failed',
           tries = tries + 1,
           last_error = VALUES(last_error)`,
        [entryId, aranda_item_id, ticket_id, description, author, dateIso, String(err.message).slice(0, 2000)]
      );
      throw err;
    }
  }

  async handleTask({ ticket_id, aranda_item_id, raw, entryId }) {
    const description = extractTaskText(raw.Description || '');
    const author = raw.AuthorName || null;
    const dateObj = parseMsDate(raw.CreationDate);
    const dateIso = dateObj ? dateObj.toISOString().slice(0, 19).replace('T', ' ') : null;

    const [[exists]] = await getDB().query(
      `SELECT status FROM aranda_inbound_tasks WHERE aranda_task_id = ? LIMIT 1`,
      [entryId]
    );
    if (exists && (exists.status === 'synced' || exists.status === 'ignored')) return;
    if (exists && exists.status === 'failed' && Number(exists.tries) >= 5) return;

    try {
      const marker = `${FROM_ARANDA_TAG} Tarea Aranda ${author ? '— ' + author : ''} ${dateIso || ''}`.trim();
      const content = `${marker}\n\n${description}`;
      const res = await glpiClient.addTicketTask(ticket_id, content, { state: 1 });
      let newTaskId = null;
      if (Array.isArray(res)) newTaskId = Number(res[0]?.id);
      else if (res && typeof res === 'object') newTaskId = Number(res.id);

      await getDB().query(
        `INSERT INTO aranda_inbound_tasks
          (aranda_task_id, aranda_item_id, glpi_ticket_id, glpi_task_id, description, author, posted_in_aranda_at, status, tries, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', 1, NOW())
         ON DUPLICATE KEY UPDATE
           glpi_task_id = VALUES(glpi_task_id),
           status = 'synced',
           last_error = NULL,
           posted_at = NOW()`,
        [entryId, aranda_item_id, ticket_id, newTaskId, description, author, dateIso]
      );

      // Insertar en ticket_tasks con origin=ARANDA para que glpiTaskSync no las trate como nuevas
      // y arandaTasksPush no las reenvíe a Aranda.
      if (Number.isFinite(newTaskId)) {
        await getDB().query(
          `INSERT IGNORE INTO ticket_tasks
            (task_id, ticket_id, user_name, content, date, state, origin, external_id)
           VALUES (?, ?, ?, ?, ?, ?, 'ARANDA', ?)`,
          [newTaskId, ticket_id, author, description, dateIso, 1, entryId]
        );
      }

      await recordEvent({
        direction: 'ARANDA_TO_GLPI', entityType: 'task',
        srcId: entryId, dstId: newTaskId, content: description
      });

      this.log.info(`Tarea Aranda → GLPI ticket=${ticket_id} task=${newTaskId}`, {
        aranda_item_id, ticket_id, task_id: newTaskId, direction: 'ARANDA_TO_GLPI'
      });
    } catch (err) {
      await getDB().query(
        `INSERT INTO aranda_inbound_tasks
          (aranda_task_id, aranda_item_id, glpi_ticket_id, description, author, posted_in_aranda_at, status, tries, last_error)
         VALUES (?, ?, ?, ?, ?, ?, 'failed', 1, ?)
         ON DUPLICATE KEY UPDATE
           status = 'failed',
           tries = tries + 1,
           last_error = VALUES(last_error)`,
        [entryId, aranda_item_id, ticket_id, description, author, dateIso, String(err.message).slice(0, 2000)]
      );
      throw err;
    }
  }
}
