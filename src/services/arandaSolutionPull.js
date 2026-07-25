import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB } from '../lib/db.js';
import { config } from '../config.js';
import { normalizeHtml } from '../lib/utils.js';
import { recordEvent } from '../lib/syncEvents.js';
import { ARANDA_STATES } from '../lib/arandaStates.js';

// Aranda guarda la solución del operador en el campo COMMENTARY cuando el caso
// pasa a Resuelto (StateId=12 en INCIDENTE / 21 en SERVICIO). El note/list expone:
//   ActionType=4 (MODIFICAR ITEM)
//   Description: <span>[STATUS]</span>... New: Resuelto
//   Description: <span>[COMMENTARY]</span>... Old: ... - New: <html>
// Las dos notas comparten CreationDate y AuthorName (misma transacción).
//
// Flujo:
//   1. Para cada item Aranda mapeado en estado Resuelto sin solución sincronizada,
//      leemos note/list y buscamos la transición [STATUS]→Resuelto más reciente.
//   2. En la misma transacción tomamos la nota [COMMENTARY] y extraemos su "New".
//   3. Si el autor es Atena_GLPI (el bot), no hay solución humana — skip.
//   4. POST /ITILSolution a GLPI.
//   5. Registramos en aranda_solution_pulls (tracker) y ticket_solutions (caché global)
//      con solution_id = -aranda_item_id (negativo para no chocar con ids GLPI positivos).

// "Resuelto" tiene StateId distinto por segmento: 12 en INCIDENTE (IM) y 21 en SERVICIO (RF).
// El 21 no existe en incidentes, así que debemos mirar AMBOS para no perder soluciones de IM.
const STATE_RESUELTO_IDS = [ARANDA_STATES[1].Resuelto, ARANDA_STATES[4].Resuelto]; // [12, 21]
const ACTION_TYPE_MODIFY = 4;
const SYNC_BATCH_SIZE = 50;
const MAX_TRIES = 5;
const MIN_SOLUTION_LEN = 5; // descartar commentaries vacíos/triviales

function arandaSegmentFromGlpiType(type) {
  return Number(type) === 2 ? 4 : 1;
}

// Quita el envoltorio <span class="font-bold"> y separadores BR/</span>.
// Deja Old: ... - New: ... limpio en una sola línea.
function stripFontBoldSpans(html) {
  if (!html) return '';
  return String(html)
    .replace(/<span[^>]*class="font-bold"[^>]*>/gi, '')
    .replace(/<\/span>/gi, '')
    .replace(/<\/?br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrae el "New" de una descripción del tipo "[CAMPO] Old: X - New: Y".
// Mantiene el HTML interno del "New" (p/br/strong/etc.) — GLPI ITILSolution.content
// acepta HTML y queremos preservar el formato del operador.
function extractFieldNewValue(description) {
  const cleaned = stripFontBoldSpans(description);
  const idx = cleaned.indexOf(' - New: ');
  if (idx < 0) return null;
  return cleaned.slice(idx + ' - New: '.length).trim();
}

// Detecta si una nota MODIFICAR ITEM es del campo X.
function isFieldNote(description, fieldLabel) {
  return new RegExp(`\\[${fieldLabel}\\]`, 'i').test(description || '');
}

// Encuentra en el note/list la transición de estado a Resuelto más reciente,
// junto con el COMMENTARY correspondiente (mismo CreationDate y AuthorName).
function findResolutionTransition(notes) {
  if (!Array.isArray(notes)) return null;
  // Buscar la nota STATUS New: Resuelto más reciente
  // Las notas vienen orden DESC (más reciente primero) según observamos.
  for (const n of notes) {
    if (Number(n.ActionType) !== ACTION_TYPE_MODIFY) continue;
    if (!isFieldNote(n.Description, 'STATUS')) continue;
    const newVal = extractFieldNewValue(n.Description);
    if (!newVal) continue;
    // Aranda usa "Resuelto" en español. Caso-insensitive por seguridad.
    if (!/resuelto/i.test(newVal)) continue;
    // Encontrar el COMMENTARY de la misma transacción.
    const commentary = notes.find(m =>
      Number(m.ActionType) === ACTION_TYPE_MODIFY &&
      m.CreationDate === n.CreationDate &&
      m.AuthorName === n.AuthorName &&
      isFieldNote(m.Description, 'COMMENTARY')
    );
    return {
      statusNote: n,
      commentaryNote: commentary || null,
      author: n.AuthorName,
      creationDate: n.CreationDate
    };
  }
  return null;
}

function isBotAuthor(authorName) {
  if (!authorName) return false;
  const target = (config.ARANDA_USERNAME || 'Atena_GLPI').trim().toLowerCase();
  return String(authorName).trim().toLowerCase() === target;
}

// Lee soluciones del campo Commentary en Aranda y las propaga como ITILSolution a GLPI.
export class ArandaSolutionPullService extends BaseService {
  constructor(opts = {}) {
    super('arandaSolutionPull', opts);
    this.processing = new Set();
  }

  async tick() {
    // Items mapeados que Aranda dejó en Resuelto y aún no tenemos su solución copiada a GLPI
    // (o el intento previo falló y nos queda retry).
    const [rows] = await getDB().query(
      `SELECT ai.aranda_item_id, ai.ticket_id, t.type AS glpi_type,
              COALESCE(asp.tries, 0) AS tries,
              asp.status AS prev_status
         FROM aranda_items ai
         JOIN tickets t ON t.id = ai.ticket_id
         JOIN aranda_status_sync ass ON ass.ticket_id = ai.ticket_id
         LEFT JOIN aranda_solution_pulls asp ON asp.aranda_item_id = ai.aranda_item_id
        WHERE ass.last_aranda_stateid IN (?, ?)
          AND ai.status = 'synced'
          AND ai.origin = 'GLPI'
          AND (asp.aranda_item_id IS NULL
               OR (asp.status = 'failed' AND asp.tries < ?))
        ORDER BY ai.ticket_id ASC
        LIMIT ?`,
      [STATE_RESUELTO_IDS[0], STATE_RESUELTO_IDS[1], MAX_TRIES, SYNC_BATCH_SIZE]
    );

    for (const row of rows) {
      if (this.stopping) return;
      const { aranda_item_id, ticket_id, glpi_type, tries } = row;
      if (this.processing.has(aranda_item_id)) continue;
      this.processing.add(aranda_item_id);

      try {
        await this.processOne({ aranda_item_id, ticket_id, glpi_type, tries });
      } catch (err) {
        await this.markFailed(aranda_item_id, ticket_id, err.message, tries);
        this.log.error(`Solución pull fallo ticket=${ticket_id} aranda=${aranda_item_id}`, {
          err, ticket_id, aranda_item_id
        });
      } finally {
        this.processing.delete(aranda_item_id);
      }
    }
  }

  async processOne({ aranda_item_id, ticket_id, glpi_type, tries }) {
    const segment = arandaSegmentFromGlpiType(glpi_type);

    let notes;
    try {
      notes = await arandaClient.getItemNoteList(aranda_item_id, segment);
    } catch (err) {
      if (err?.response?.status === 404) {
        const altSegment = segment === 1 ? 4 : 1;
        this.log.warn(`note/list 404 segmento=${segment}, reintentando ${altSegment}`, { ticket_id, aranda_item_id });
        notes = await arandaClient.getItemNoteList(aranda_item_id, altSegment);
      } else {
        throw err;
      }
    }

    const transition = findResolutionTransition(notes);
    if (!transition) {
      // Estado dice Resuelto pero no encontramos la nota — puede ser que el item ya
      // estuviera Resuelto antes del primer poll. Marcar 'skipped' para no reintentar
      // cada tick.
      await this.markSkipped(aranda_item_id, ticket_id, 'sin transición STATUS→Resuelto en note/list');
      return;
    }

    if (isBotAuthor(transition.author)) {
      // La resolución la hizo el bot Atena_GLPI propagando GLPI→Aranda. No es solución
      // humana en Aranda — nada que propagar de vuelta.
      await this.markSkipped(aranda_item_id, ticket_id, `transición hecha por bot (${transition.author})`);
      return;
    }

    if (!transition.commentaryNote) {
      await this.markSkipped(aranda_item_id, ticket_id, 'sin nota [COMMENTARY] en la misma transacción');
      return;
    }

    const commentaryNew = extractFieldNewValue(transition.commentaryNote.Description);
    if (!commentaryNew) {
      await this.markSkipped(aranda_item_id, ticket_id, '[COMMENTARY] sin valor New parseable');
      return;
    }

    // Texto plano para validación de longitud mínima; el content que enviamos a GLPI
    // mantiene el HTML para preservar formato del operador.
    const plain = normalizeHtml(commentaryNew);
    if (plain.length < MIN_SOLUTION_LEN) {
      await this.markSkipped(aranda_item_id, ticket_id, `[COMMENTARY] trivial (${plain.length} chars)`);
      return;
    }

    // Idempotencia adicional: si ya hay un ticket_solutions origin=ARANDA con el mismo
    // solution_id sintético, no recreamos.
    const solutionId = -Math.abs(Number(aranda_item_id));
    const [[existing]] = await getDB().query(
      `SELECT 1 FROM ticket_solutions WHERE solution_id = ? LIMIT 1`,
      [solutionId]
    );
    if (existing) {
      await this.markSynced({ aranda_item_id, ticket_id, glpi_solution_id: null,
                              creationDate: transition.creationDate, author: transition.author });
      return;
    }

    // GLPI rechaza POST /ITILSolution con "ERROR_GLPI_ADD: El tema ya está resuelto"
    // cuando el ticket está en status 5/6 (Resuelto/Cerrado). Esto pasa cuando statusSync
    // ya propagó Aranda→Resuelto antes de que esta tirada llegue a procesar la solución.
    // Fallback: ITILFollowup con prefijo claro para que la solución igual quede visible
    // en el ticket GLPI.
    const [[tRow]] = await getDB().query(`SELECT status FROM tickets WHERE id = ? LIMIT 1`, [ticket_id]);
    const currentStatus = tRow ? Number(tRow.status) : null;
    const ticketResolvedOrClosed = currentStatus === 5 || currentStatus === 6;

    const content = commentaryNew;
    let glpiSolutionId = null;
    let postedAs = 'solution';

    if (!ticketResolvedOrClosed) {
      const created = await glpiClient.addSolution(ticket_id, content);
      glpiSolutionId = Number(created?.id ?? created?.input?.id ?? null);
    } else {
      // Ticket ya resuelto/cerrado en GLPI — caer a ITILFollowup con prefijo.
      const followupContent =
        `<p><strong>[Solución Aranda] — autor: ${transition.author || 'desconocido'}</strong></p>\n${content}`;
      const created = await glpiClient.addFollowup(ticket_id, followupContent);
      glpiSolutionId = Number(created?.id ?? created?.input?.id ?? null);
      postedAs = 'followup_fallback';
      this.log.warn(`Ticket ${ticket_id} ya en status=${currentStatus}; solución posteada como ITILFollowup`, {
        ticket_id, aranda_item_id, current_status: currentStatus
      });
    }

    await getDB().query(
      `INSERT IGNORE INTO ticket_solutions
        (solution_id, ticket_id, user_name, content, date_creation, origin)
       VALUES (?, ?, ?, ?, NOW(), 'ARANDA')`,
      [solutionId, ticket_id, transition.author || null, content]
    );

    await this.markSynced({
      aranda_item_id, ticket_id,
      glpi_solution_id: Number.isFinite(glpiSolutionId) ? glpiSolutionId : null,
      creationDate: transition.creationDate, author: transition.author,
      postedAs
    });

    await recordEvent({
      direction: 'ARANDA_TO_GLPI',
      entityType: 'solution',
      srcId: aranda_item_id,
      dstId: ticket_id,
      content
    });

    this.log.info(`Solución pull aranda=${aranda_item_id} → ticket=${ticket_id} via=${postedAs} glpi_id=${glpiSolutionId}`, {
      ticket_id, aranda_item_id, glpi_solution_id: glpiSolutionId, posted_as: postedAs, direction: 'ARANDA_TO_GLPI'
    });
  }

  async markSynced({ aranda_item_id, ticket_id, glpi_solution_id, creationDate, author, postedAs = 'solution' }) {
    const status = postedAs === 'followup_fallback' ? 'synced_as_followup' : 'synced';
    await getDB().query(
      `INSERT INTO aranda_solution_pulls
        (aranda_item_id, ticket_id, glpi_solution_id, source_creation_date, source_author,
         status, tries, last_error, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NOW())
       ON DUPLICATE KEY UPDATE
         glpi_solution_id = VALUES(glpi_solution_id),
         source_creation_date = VALUES(source_creation_date),
         source_author = VALUES(source_author),
         status = VALUES(status), last_error = NULL, posted_at = NOW()`,
      [aranda_item_id, ticket_id, glpi_solution_id, creationDate || null, author || null, status]
    );
  }

  // 'skipped' = nada que hacer aquí (no es un error, no reintentar). Lo guardamos para
  // que el WHERE del tick no vuelva a seleccionar este item.
  async markSkipped(aranda_item_id, ticket_id, reason) {
    await getDB().query(
      `INSERT INTO aranda_solution_pulls
        (aranda_item_id, ticket_id, status, tries, last_error, posted_at)
       VALUES (?, ?, 'skipped', 0, ?, NOW())
       ON DUPLICATE KEY UPDATE
         status = 'skipped', last_error = VALUES(last_error), posted_at = NOW()`,
      [aranda_item_id, ticket_id, String(reason).slice(0, 2000)]
    );
  }

  async markFailed(aranda_item_id, ticket_id, errorMsg, tries = 0) {
    await getDB().query(
      `INSERT INTO aranda_solution_pulls
        (aranda_item_id, ticket_id, status, tries, last_error)
       VALUES (?, ?, 'failed', ?, ?)
       ON DUPLICATE KEY UPDATE
         status = 'failed', tries = tries + 1, last_error = VALUES(last_error)`,
      [aranda_item_id, ticket_id, (Number(tries) || 0) + 1, String(errorMsg).slice(0, 2000)]
    );
  }
}
