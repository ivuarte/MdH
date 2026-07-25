import { BaseService } from '../lib/baseService.js';
import { arandaClient } from '../lib/arandaClient.js';
import { glpiClient } from '../lib/glpiClient.js';
import { getDB } from '../lib/db.js';
import { config } from '../config.js';
import { truthy } from '../lib/utils.js';
import { recordEvent, recentInverseEvent } from '../lib/syncEvents.js';
import {
  ARANDA_SEGMENT, arandaStateId, arandaReason, arandaStateToGlpi, arandaSegmentFromGlpiType
} from '../lib/arandaStates.js';

// El diccionario completo de estados (IDs por segmento, reasons y la equivalencia con GLPI)
// vive en lib/arandaStates.js — fuente ÚNICA de verdad. Aquí sólo se define la equivalencia
// GLPI status → estado semántico Aranda; el StateId/ReasonId concreto los resuelve el
// diccionario SEGÚN EL SEGMENTO, garantizando que un INCIDENTE nunca reciba un ID de SERVICIO.
//
// GLPI statuses: 1=Nuevo, 2=En curso asignada, 3=En curso planificada, 4=En espera, 5=Resuelto, 6=Cerrado.
// El endpoint /item/update/{id}/{seg}/{user} exige Commentary al cambiar de estado (400 InvalidCommentary si falta).
function mapGlpiToAranda(glpiStatus, glpiType) {
  const s = Number(glpiStatus);
  const seg = arandaSegmentFromGlpiType(glpiType);  // 1 (IM) | 4 (RF)

  // Resuelve { StateId, ReasonId, Commentary } para un estado semántico en el segmento del caso.
  const build = (stateName, commentary) => {
    const StateId = arandaStateId(seg, stateName);
    if (StateId == null) return null;  // el segmento no tiene ese estado
    return { StateId, ReasonId: arandaReason(seg, StateId), Commentary: commentary };
  };

  // GLPI 1 (Nuevo) NO se propaga: el pull mapearía Proceso (20) → GLPI 2, creando loop con el push;
  // y si ya hay item en Aranda, alguien está trabajando. Esperamos a que GLPI avance a 2/3.
  if (s === 1) return null;
  // 2/3 → En curso. INCIDENTE usa "En Curso" (StateId 8); SERVICIO no tiene ese estado,
  // así que cae a "Proceso" (StateId 20). El diccionario resuelve el ID por segmento.
  if (s === 2 || s === 3) {
    const stateName = seg === ARANDA_SEGMENT.IM ? 'EnCurso' : 'Proceso';
    return build(stateName, 'Caso en proceso (sincronizado desde GLPI)');
  }
  // 4 → En Espera (IM=10 / RF=19, resuelto por segmento)
  if (s === 4) return build('EnEspera', 'En espera (sincronizado desde GLPI)');
  // 5 → Resuelto (IM=12 / RF=21, resuelto por segmento — el 21 no existe en incidentes)
  if (s === 5) return build('Resuelto', 'Caso resuelto (sincronizado desde GLPI)');
  // 6 → Cerrado: el rol Atena_GLPI NO puede cerrar en Aranda (403 UnauthorizedCaseClosure).
  //   Mapeamos GLPI Cerrado → Aranda Resuelto (IM=12 / RF=21) para que el operador vea que terminó y cierre.
  if (s === 6) return build('Resuelto', 'Caso cerrado en GLPI (queda pendiente el cierre formal por el operador en Aranda)');
  return null;
}

// Inverso Aranda → GLPI, VALIDADO por segmento: un StateId sólo se interpreta si pertenece
// al segmento del caso (IM=1 / RF=4). Toda la tabla de equivalencias vive en el diccionario.
function mapArandaToGlpi(stateId, segment) {
  return arandaStateToGlpi(stateId, segment);
}

// Sincronización bidireccional de estados. Ejecuta PUSH y PULL en paralelo en cada tick.
// Anti-eco vía sync_events: si propagamos un cambio hace <ANTI_ECHO_WINDOW_SECONDS no aplicamos su eco inverso.
export class StatusSyncService extends BaseService {
  constructor(opts = {}) {
    super('statusSync', opts);
    this.processingPush = new Set();
    this.processingPull = false;
  }

  async tick() {
    await Promise.all([
      this.pushGlpiToAranda().catch(err => this.log.error('push exception', { err })),
      this.pullArandaToGlpi().catch(err => this.log.error('pull exception', { err }))
    ]);
  }

  // GLPI → Aranda
  async pushGlpiToAranda() {
    // Procesamos TODOS los status 1..6. Si último estado empujado == actual, el WHERE lo salta.
    const [rows] = await getDB().query(
      `SELECT t.id AS ticket_id, t.status AS glpi_status, t.type AS glpi_type,
              ai.aranda_item_id, ass.last_glpi_status
         FROM tickets t
         JOIN aranda_items ai ON ai.ticket_id = t.id
         LEFT JOIN aranda_status_sync ass ON ass.ticket_id = t.id
        WHERE t.status IN (2,3,4,5,6)
          AND ai.status = 'synced'
          AND ai.origin = 'GLPI'
          AND (ass.ticket_id IS NULL OR ass.last_glpi_status IS NULL OR ass.last_glpi_status <> t.status)
        ORDER BY t.id ASC
        LIMIT 100`
    );

    for (const row of rows) {
      if (this.stopping) return;
      const { ticket_id, glpi_status, glpi_type, aranda_item_id } = row;
      const mapped = mapGlpiToAranda(glpi_status, glpi_type);
      if (!mapped) continue;

      // Si vamos a resolver (StateId de "Resuelto" según el segmento: 12 IM / 21 RF) y el ticket
      // GLPI tiene una solución, usamos su texto como Commentary → así queda en el apartado
      // "Solución" de Aranda (no como genérico).
      const resueltoStateId = arandaStateId(arandaSegmentFromGlpiType(glpi_type), 'Resuelto');
      if (mapped.StateId === resueltoStateId) {
        const [[sol]] = await getDB().query(
          `SELECT content FROM ticket_solutions
            WHERE ticket_id = ? AND origin = 'GLPI' AND content IS NOT NULL AND content <> ''
            ORDER BY solution_id DESC LIMIT 1`,
          [ticket_id]
        );
        if (sol?.content) mapped.Commentary = sol.content;
      }

      // Anti-eco: si Aranda ya nos empujó este mismo estado recientemente, no hagamos un ping-pong.
      if (await recentInverseEvent({
        direction: 'GLPI_TO_ARANDA', entityType: 'status', srcId: ticket_id, dstId: aranda_item_id
      })) {
        await this.markPushSynced(ticket_id, aranda_item_id, glpi_status, mapped.StateId);
        continue;
      }

      if (this.processingPush.has(ticket_id)) continue;
      this.processingPush.add(ticket_id);

      try {
        const segment = arandaSegmentFromGlpiType(glpi_type);
        const fields = [
          { Field: 'StateId',    Value: mapped.StateId },
          { Field: 'ReasonId',   Value: mapped.ReasonId },
          { Field: 'Commentary', Value: mapped.Commentary || '' }
        ];
        let obj;
        try {
          obj = await arandaClient.updateItem(aranda_item_id, segment, config.ARANDA_AUTHOR_ID, fields);
        } catch (err) {
          const status = err?.response?.status;
          const body = String(err?.response?.data || '');
          // Errores de NEGOCIO no son problema de segmento — no reintentar con el alterno.
          const isBusinessError = /TaskPending|UnauthorizedCaseClosure|InvalidCommentary|InvalidState/i.test(body);
          // Fallback de segmento: sólo cuando es 404 (item no existe en ese segmento) o
          // 400 con body genérico (ej. "Request Error" HTML) que sugiere mapping equivocado.
          if (!isBusinessError && (status === 404 || status === 400)) {
            const altSegment = segment === 1 ? 4 : 1;
            this.log.warn(`Push status: ${status} con segmento=${segment}, reintentando con segmento=${altSegment}`, { ticket_id, aranda_item_id });
            try {
              obj = await arandaClient.updateItem(aranda_item_id, altSegment, config.ARANDA_AUTHOR_ID, fields);
            } catch (err2) {
              throw err;  // propagar el error original
            }
          } else {
            throw err;
          }
        }
        const ok = truthy(obj.result ?? obj.Result ?? true);
        if (!ok) throw new Error(`Aranda update fallo: ${JSON.stringify(obj)}`);

        // Verificar-después-de-escribir: Aranda puede devolver result=True sin aplicar la
        // transición (p.ej. caso recién creado / workflow no listo). Releemos el estado real;
        // si no coincide con el objetivo, NO marcamos synced para que el próximo tick reintente.
        const actualState = await this.readArandaState(aranda_item_id);
        if (actualState != null && actualState !== mapped.StateId) {
          await getDB().query(
            `INSERT INTO aranda_status_sync (ticket_id, aranda_item_id, last_error)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE last_error = VALUES(last_error), updated_at = NOW()`,
            [ticket_id, aranda_item_id, `Aranda devolvió result=True pero StateId real=${actualState} ≠ objetivo ${mapped.StateId}. Reintentando en próximos ticks.`]
          );
          this.log.warn(`Push no aplicado ticket=${ticket_id}: Aranda quedó en StateId=${actualState}, esperado ${mapped.StateId}. Reintentará.`, {
            ticket_id, aranda_item_id, actual_state: actualState, target_state: mapped.StateId, direction: 'GLPI_TO_ARANDA'
          });
          continue;
        }

        await this.markPushSynced(ticket_id, aranda_item_id, glpi_status, mapped.StateId);
        await recordEvent({
          direction: 'GLPI_TO_ARANDA', entityType: 'status', srcId: ticket_id, dstId: aranda_item_id,
          content: `state=${mapped.StateId}`
        });
        this.log.info(`Estado ticket=${ticket_id} glpi=${glpi_status} → StateId=${mapped.StateId} (verificado)`, {
          ticket_id, aranda_item_id, direction: 'GLPI_TO_ARANDA'
        });
      } catch (err) {
        const status = err?.response?.status;
        // El body de Aranda es texto plano con códigos: "TaskPending", "UnauthorizedCaseClosure", etc.
        const body = String(err?.response?.data || '').slice(0, 500);
        const isTaskPending = /TaskPending/i.test(body);
        const isUnauthClosure = /UnauthorizedCaseClosure/i.test(body);
        const isUserNotAllowed = /UserNotAllowedToEdit/i.test(body);

        // 403 UnauthorizedCaseClosure: el rol Atena_GLPI no puede cerrar. Permanente — marcar synced.
        // 403 UserNotAllowedToEdit: Aranda restringe el caso al bot (transferido, escalado, etc.).
        //   Permanente para ESE estado destino — marcar synced para no repetir cada tick.
        // 404: item no existe en ese segmento (incluso con fallback) → permanente, marcar synced.
        // 400 TaskPending: TEMPORAL. Aranda exige cerrar tareas antes de transicionar a Resuelto/Cerrado.
        //   NO marcar synced — esto debe reintentarse cuando las tareas pendientes se cierren.
        if (status === 403 && (isUnauthClosure || isUserNotAllowed)) {
          const reason = isUnauthClosure ? 'UnauthorizedCaseClosure' : 'UserNotAllowedToEdit';
          this.log.warn(`Push: 403 ${reason} ticket=${ticket_id} — marcando visto (permanente para este estado)`, { ticket_id, aranda_item_id });
          try { await this.markPushSynced(ticket_id, aranda_item_id, glpi_status, mapped.StateId); } catch { /* ignore */ }
        } else if (status === 404) {
          this.log.warn(`Push: 404 (item inaccesible) ticket=${ticket_id} aranda=${aranda_item_id} — marcando visto`, { ticket_id, aranda_item_id });
          try { await this.markPushSynced(ticket_id, aranda_item_id, glpi_status, mapped.StateId); } catch { /* ignore */ }
        } else if (status === 400 && isTaskPending) {
          // Reintentar en próximos ticks. Sólo registrar el error en last_error sin tocar last_glpi_status,
          // para que la condición ass.last_glpi_status <> t.status del WHERE siga siendo true.
          await getDB().query(
            `INSERT INTO aranda_status_sync (ticket_id, aranda_item_id, last_error)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE last_error = VALUES(last_error), updated_at = NOW()`,
            [ticket_id, aranda_item_id, `TaskPending: Aranda exige cerrar tareas pendientes antes de transicionar a StateId=${mapped.StateId}. Cierra las tareas en Aranda o cancélalas — el sistema reintentará automáticamente.`]
          );
          this.log.warn(`Push: TaskPending — Aranda tiene tareas pendientes, no permite transicionar ticket=${ticket_id} → StateId=${mapped.StateId}. Reintentará cuando las tareas se cierren.`, {
            ticket_id, aranda_item_id, target_state: mapped.StateId, direction: 'GLPI_TO_ARANDA'
          });
        } else {
          await getDB().query(
            `INSERT INTO aranda_status_sync (ticket_id, aranda_item_id, last_error)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE last_error = VALUES(last_error), updated_at = NOW()`,
            [ticket_id, aranda_item_id, `HTTP ${status}: ${body || err.message}`.slice(0, 2000)]
          );
          this.log.error(`Push estado ticket=${ticket_id}`, { err, ticket_id, status, body: body.slice(0, 200) });
        }
      } finally {
        this.processingPush.delete(ticket_id);
      }
    }
  }

  async markPushSynced(ticketId, arandaItemId, glpiStatus, arandaStateId) {
    await getDB().query(
      `INSERT INTO aranda_status_sync
        (ticket_id, aranda_item_id, last_glpi_status, last_aranda_stateid, last_push_at, last_error)
       VALUES (?, ?, ?, ?, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         last_glpi_status   = VALUES(last_glpi_status),
         last_aranda_stateid= VALUES(last_aranda_stateid),
         last_push_at       = NOW(),
         last_error         = NULL`,
      [ticketId, arandaItemId, glpiStatus, arandaStateId]
    );
  }

  // Relee el StateId real de un item Aranda vía /item/list (mismo endpoint que el pull).
  // Devuelve el StateId (number) o null si no se pudo verificar (item fuera de la página).
  async readArandaState(arandaItemId) {
    try {
      const res = await arandaClient.listItems({
        Paging: { Start: 1, End: config.ARANDA_PULL_PAGE_SIZE, Size: 0 },
        Criteria: [{ FieldName: 'AuthorId', Value: String(config.ARANDA_AUTHOR_ID), LogicOperatorId: 1, ComparisonOperatorId: 5 }],
        WhereCriteria: [],
        Order: { ColumnName: 'RegistrationDate', ModeId: 2 },
        ProjectId: config.ARANDA_PROJECT_ID,
        ViewId: 5
      });
      const it = (res?.Data ?? []).find(x => Number(x.Id) === Number(arandaItemId));
      const sid = it ? Number(it.StateId) : null;
      return Number.isFinite(sid) ? sid : null;
    } catch (err) {
      // Si la verificación falla, no bloqueamos el flujo: devolvemos null (no verificable).
      this.log.warn(`No se pudo releer estado Aranda item=${arandaItemId}`, { err: err?.message });
      return null;
    }
  }

  // Aranda → GLPI
  async pullArandaToGlpi() {
    if (this.processingPull) return;
    this.processingPull = true;
    try {
      const body = {
        Paging: { Start: 1, End: config.ARANDA_PULL_PAGE_SIZE, Size: 0 },
        Criteria: [
          { FieldName: 'AuthorId', Value: String(config.ARANDA_AUTHOR_ID), LogicOperatorId: 1, ComparisonOperatorId: 5 }
        ],
        WhereCriteria: [],
        Order: { ColumnName: 'RegistrationDate', ModeId: 2 },
        ProjectId: config.ARANDA_PROJECT_ID,
        ViewId: 5
      };

      const res = await arandaClient.listItems(body);
      const data = res?.Data;
      if (!Array.isArray(data) || data.length === 0) return;

      for (const it of data) {
        if (this.stopping) return;
        const arandaItemId = Number(it?.Id);
        const arandaStateId = Number(it?.StateId);
        if (!Number.isFinite(arandaItemId) || !Number.isFinite(arandaStateId)) continue;

        // Resolvemos primero el ticket GLPI mapeado para conocer el SEGMENTO del caso
        // (IM=1 / RF=4) y validar el StateId Aranda contra ese segmento: así un ID de
        // INCIDENTE nunca se interpreta como uno de SERVICIO (p.ej. Pendiente 65 vs 66).
        const [[mapRow]] = await getDB().query(
          `SELECT ticket_id FROM aranda_items WHERE aranda_item_id = ? AND origin = 'GLPI' LIMIT 1`,
          [arandaItemId]
        );
        if (!mapRow) continue;

        const ticketId = mapRow.ticket_id;
        const [[tRow]] = await getDB().query(
          `SELECT status, type FROM tickets WHERE id = ? LIMIT 1`,
          [ticketId]
        );
        const current = tRow ? Number(tRow.status) : null;
        const segment = arandaSegmentFromGlpiType(tRow?.type);

        const proposedGlpiStatus = mapArandaToGlpi(arandaStateId, segment);
        if (proposedGlpiStatus == null) continue;

        // "No degradar": si Aranda viene con un estado menos avanzado que el actual de GLPI,
        // no rebajamos. Esto evita que cuando el operador cierra en GLPI y aún no se ha empujado
        // a Aranda, el pull reverso revierta el cierre porque Aranda sigue en Proceso/Resuelto.
        //
        // Orden de avance: 1 (Nuevo) < 2 (En curso) < 4 (En espera) < 5 (Resuelto) < 6 (Cerrado).
        // En espera (4) NO es un retroceso desde Proceso (2) — el usuario puede mover libremente
        // entre 2 y 4 en cualquier dirección. Sólo bloqueamos retroceder desde 5/6.
        let glpiStatus = proposedGlpiStatus;
        let suppressed = false;
        if (current === 6 && proposedGlpiStatus !== 6) {
          // Ya cerrado; no reabrir desde Aranda (excepto si Aranda también cerró).
          glpiStatus = current;
          suppressed = true;
        } else if (current === 5 && proposedGlpiStatus !== 5 && proposedGlpiStatus !== 6) {
          // Resuelto; sólo permitir avanzar a Cerrado (6), no volver a Proceso/Espera.
          glpiStatus = current;
          suppressed = true;
        }

        // Si no hay nada que cambiar en GLPI (estados ya coinciden, o decidimos no degradar),
        // sólo registramos que vimos Aranda — NO tocamos last_glpi_status para no confundir al push.
        if (current === glpiStatus) {
          await this.markPullObserved(ticketId, arandaItemId, arandaStateId);
          if (suppressed) {
            this.log.info(`Pull suprimido (no degradar) aranda=${arandaItemId} StateId=${arandaStateId} ticket=${ticketId} (current=${current})`, {
              ticket_id: ticketId, aranda_item_id: arandaItemId
            });
          }
          continue;
        }

        // Anti-eco: si GLPI acaba de empujar a Aranda, no apliquemos el mismo cambio de vuelta.
        if (await recentInverseEvent({
          direction: 'ARANDA_TO_GLPI', entityType: 'status', srcId: arandaItemId, dstId: ticketId
        })) {
          await this.markPullObserved(ticketId, arandaItemId, arandaStateId);
          continue;
        }

        await glpiClient.updateTicket({ id: ticketId, status: glpiStatus });
        // Importante: actualizar también el cache local de tickets.status. Si no, el siguiente tick
        // verá la BD desactualizada y volverá a "empujar" el mismo update — glpiTicketSync depende
        // de /Log para detectar cambios y /Log no captura todos los updates en esta instancia GLPI.
        await getDB().query(`UPDATE tickets SET status = ? WHERE id = ?`, [glpiStatus, ticketId]);
        await this.markPullSynced(ticketId, arandaItemId, glpiStatus, arandaStateId);
        await recordEvent({
          direction: 'ARANDA_TO_GLPI', entityType: 'status', srcId: arandaItemId, dstId: ticketId,
          content: `state=${glpiStatus}`
        });

        this.log.info(`Estado aranda=${arandaItemId} StateId=${arandaStateId} → ticket=${ticketId} status=${glpiStatus}`, {
          ticket_id: ticketId, aranda_item_id: arandaItemId, direction: 'ARANDA_TO_GLPI'
        });
      }
    } finally {
      this.processingPull = false;
    }
  }

  async markPullSynced(ticketId, arandaItemId, glpiStatus, arandaStateId) {
    await getDB().query(
      `INSERT INTO aranda_status_sync
        (ticket_id, aranda_item_id, last_glpi_status, last_aranda_stateid, last_pull_at, last_error)
       VALUES (?, ?, ?, ?, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         last_glpi_status    = VALUES(last_glpi_status),
         last_aranda_stateid = VALUES(last_aranda_stateid),
         last_pull_at        = NOW(),
         last_error          = NULL`,
      [ticketId, arandaItemId, glpiStatus, arandaStateId]
    );
  }

  // markPullObserved: registramos que vimos Aranda pero NO tocamos last_glpi_status
  // (porque el pull no aplicó cambios a GLPI). Esto evita que el push se "engañe" pensando
  // que el ticket ya está sincronizado cuando en realidad sigue pendiente de empujar.
  async markPullObserved(ticketId, arandaItemId, arandaStateId) {
    await getDB().query(
      `INSERT INTO aranda_status_sync
        (ticket_id, aranda_item_id, last_aranda_stateid, last_pull_at, last_error)
       VALUES (?, ?, ?, NOW(), NULL)
       ON DUPLICATE KEY UPDATE
         last_aranda_stateid = VALUES(last_aranda_stateid),
         last_pull_at        = NOW(),
         last_error          = NULL`,
      [ticketId, arandaItemId, arandaStateId]
    );
  }
}
