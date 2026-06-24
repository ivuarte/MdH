// =============================================================================
// Diccionario ÚNICO de estados Aranda — fuente de verdad del mapeo de estados.
// =============================================================================
//
// Aranda usa DOS conjuntos de StateId DISTINTOS según el segmento del caso.
// NUNCA se deben mezclar: un caso INCIDENTE jamás debe recibir un StateId de
// SERVICIO ni al revés (p.ej. "Pendiente" es 65 en IM pero 66 en RF).
//
//   IM = INCIDENTE  → segmento 1
//   RF = SERVICIO   → segmento 4  (requerimiento)
//
// Catálogo homologado (IDs oficiales provistos por el equipo Aranda):
//
//   INCIDENTE (seg 1)                    SERVICIO (seg 4)
//   ----------------------------------   --------------------------------------
//   9   Anulado                          23  Analisis
//   7   Asignado                         60  Anulado
//   11  Cerrado                          30  Anulado RFC
//   8   En Curso                         16  Asignado
//   10  En Espera                        22  Asignado RFC
//   65  Pendiente                        29  Cerrado
//   20  Proceso                          25  Desarrollo
//   21  Resuelto                         19  En Espera
//   12  Resuelto (alterno)               24  En Espera RFC
//   59  Solicitud de Anulado             70  Pago Firma Digital
//                                        66  Pendiente
//                                        28  Post Implementacion
//                                        20  Proceso
//                                        26  Pruebas
//                                        13  Registrado
//                                        21  Resuelto
//                                        27  Resuelto RFC
//                                        17  Solicitud de Anulado
//
// Sólo Proceso (20) y Resuelto (21) comparten ID entre ambos segmentos.
// =============================================================================

export const ARANDA_SEGMENT = { IM: 1, RF: 4 };

// StateId por segmento. Claves semánticas estables (independientes del segmento).
export const ARANDA_STATES = {
  1: {  // INCIDENTE (IM)
    Anulado: 9,
    Asignado: 7,
    Cerrado: 11,
    EnCurso: 8,
    EnEspera: 10,
    Pendiente: 65,
    Proceso: 20,
    Resuelto: 21,
    ResueltoAlt: 12,
    SolicitudAnulado: 59
  },
  4: {  // SERVICIO / requerimiento (RF)
    Analisis: 23,
    Anulado: 60,
    AnuladoRFC: 30,
    Asignado: 16,
    AsignadoRFC: 22,
    Cerrado: 29,
    Desarrollo: 25,
    EnEspera: 19,
    EnEsperaRFC: 24,
    PagoFirmaDigital: 70,
    Pendiente: 66,
    PostImplementacion: 28,
    Proceso: 20,
    Pruebas: 26,
    Registrado: 13,
    Resuelto: 21,
    ResueltoRFC: 27,
    SolicitudAnulado: 17
  }
};

// ReasonId obligatorio por (segmento, StateId). Aranda exige ReasonId + Commentary
// al transicionar de estado (sin uno u otro devuelve 400 InvalidState/InvalidCommentary).
// Sólo se listan los reasons de las transiciones que el PUSH realmente ejecuta.
export const ARANDA_STATE_REASONS = {
  1: {  // IM
    8: 7,    // En Curso       → "Especialista atiende el Caso" (reasons válidos: 7, 9, 90)
    20: 7,   // Proceso        → "Especialista atiende el Caso"
    10: 69,  // En Espera      → "Se pone en Espera el caso"
    21: 10,  // Resuelto       → "Especialista resuelve el caso"
    11: 12   // Cerrado        → "El usuario aprueba solución del caso y se cierra"
  },
  4: {  // RF
    20: 7,   // Proceso        → "Especialista atiende el Caso"
    19: 8,   // En Espera      → "En Espera de información"
    21: 10,  // Resuelto       → "Especialista resuelve el caso"
    29: 29   // Cerrado        → "El cliente aprueba solución del caso"
  }
};

// Equivalencia semántica StateId Aranda → status GLPI (1..6), por NOMBRE de estado
// (no por ID), de modo que aplica consistentemente a ambos segmentos:
//   GLPI: 1 Nuevo · 2 En curso asignada · 3 En curso planificada · 4 En espera · 5 Resuelto · 6 Cerrado
//
//   null  → se ignora (no se toca GLPI). Aplica a:
//     - Registrado: equivaldría a GLPI 1 (Nuevo); no degradamos a 1.
//     - SolicitudAnulado: estado PENDIENTE (aún no aprobado) → no cerramos GLPI por una
//       solicitud que podría rechazarse.
const STATE_TO_GLPI = {
  // → 6 Cerrado
  Cerrado: 6,
  Anulado: 6,            // un caso anulado termina → cierra el ticket GLPI
  AnuladoRFC: 6,
  // → 5 Resuelto
  Resuelto: 5,
  ResueltoAlt: 5,
  ResueltoRFC: 5,
  // → 4 En espera
  EnEspera: 4,
  EnEsperaRFC: 4,
  Pendiente: 4,
  // → 2 En curso asignada
  Asignado: 2,
  AsignadoRFC: 2,
  EnCurso: 2,
  Proceso: 2,
  Analisis: 2,
  Desarrollo: 2,
  Pruebas: 2,
  PostImplementacion: 2,
  PagoFirmaDigital: 2,
  // ignorados
  Registrado: null,
  SolicitudAnulado: null
};

// Índice inverso { segmento: { stateId: glpiStatus|null } }, construido desde el diccionario.
// Garantiza que cada StateId se interpreta SÓLO dentro de su segmento.
const REVERSE_BY_SEGMENT = (() => {
  const out = { 1: {}, 4: {} };
  for (const seg of [1, 4]) {
    for (const [name, stateId] of Object.entries(ARANDA_STATES[seg])) {
      out[seg][stateId] = STATE_TO_GLPI[name] ?? null;
    }
  }
  return out;
})();

// Índice global (sin segmento) como fallback defensivo: sólo se usa si el segmento del
// item Aranda no está disponible. Como casi todos los IDs son únicos entre IM/RF, es
// suficiente para no perder estados; los compartidos (20/21) coinciden en ambos.
const REVERSE_GLOBAL = { ...REVERSE_BY_SEGMENT[1], ...REVERSE_BY_SEGMENT[4] };

/**
 * StateId correcto para un segmento dado por nombre semántico de estado.
 * @returns {number|undefined}
 */
export function arandaStateId(segment, name) {
  return ARANDA_STATES[Number(segment)]?.[name];
}

/**
 * ReasonId obligatorio para (segmento, StateId). undefined si no aplica.
 */
export function arandaReason(segment, stateId) {
  return ARANDA_STATE_REASONS[Number(segment)]?.[Number(stateId)];
}

/**
 * Mapea un StateId Aranda → status GLPI, VALIDANDO contra el segmento del caso.
 * Si se pasa `segment`, sólo se acepta el StateId si pertenece a ese segmento
 * (evita que un ID de IM contamine un caso RF y viceversa). Sin segmento, usa el
 * índice global como fallback.
 * @param {number} stateId
 * @param {number} [segment]  1 (IM) | 4 (RF)
 * @returns {number|null}  status GLPI (1..6) o null si se ignora / desconocido
 */
export function arandaStateToGlpi(stateId, segment) {
  const sid = Number(stateId);
  const seg = Number(segment);
  if (seg === 1 || seg === 4) {
    // Sólo consideramos el StateId si está definido para ESE segmento.
    if (Object.prototype.hasOwnProperty.call(REVERSE_BY_SEGMENT[seg], sid)) {
      return REVERSE_BY_SEGMENT[seg][sid];
    }
    return null;  // StateId ajeno al segmento del caso → no aplicar
  }
  return Object.prototype.hasOwnProperty.call(REVERSE_GLOBAL, sid) ? REVERSE_GLOBAL[sid] : null;
}

// segmento Aranda desde el tipo GLPI: 1=incidente → seg 1, 2=requerimiento → seg 4.
export function arandaSegmentFromGlpiType(type) {
  return Number(type) === 2 ? ARANDA_SEGMENT.RF : ARANDA_SEGMENT.IM;
}
