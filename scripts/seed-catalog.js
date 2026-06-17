#!/usr/bin/env node
// ============================================================
// DEPRECADO — usar `scripts/sync-glpi-from-csv.js` en su lugar.
// Este seed cubre solo 52 mapeos; el sync desde CSV cubre los 77.
// Se mantiene como referencia histórica del mapeo inicial.
// ============================================================
//
// Seed del mapeo de categorías GLPI ↔ Aranda en service_catalog_sync.
// Fuente: CATALOGO.md (sección 3 — mapeo por subcategorías).
//
// Ejecutar:   node scripts/seed-catalog.js
//
// Idempotente: usa INSERT ... ON DUPLICATE KEY UPDATE para refrescar los
// nombres/segments sin perder filas marcadas como 'matched' o 'pending'.

import 'dotenv/config';
import { initDB, getDB, closeDB } from '../src/lib/db.js';
import { config } from '../src/config.js';

// Cada fila: [glpi_id, glpi_name, aranda_id, aranda_segment, aranda_name, responsable_label]
// aranda_segment: 1 = Incidencia (IM), 4 = Requerimiento (RF).
// responsable_label: "Responsable de Gestión Grupo" desde el catálogo funcional.
//   El daemon resuelve label → (GroupId, default_user_id) via aranda_groups.
//   Label = null → daemon usa defaults del .env (es el caso de "Consorcio - Mesa de Servicio N1",
//   que corresponde al grupo del bot mismo: ARANDA_GROUP_ID=14).
const CONSORCIO = 'Consorcio - Mesa de Servicio N1';
const CONSORCIO_N2 = 'Consorcio - Especialista N2';
const DTIC      = 'Ministerio de Hacienda - DTIC';
const DGA       = 'Ministerio de Hacienda - DGA';
const DGADGT    = 'Ministerio de Hacienda - DGA -DGT';
const ADUANAS   = 'Ministerio de Hacienda - Aduanas';

const MAPPING = [
  // --- Problema al modificar la DUA posterior a la aceptación (820)
  [680, 'No permite modificar un campo', 821, 1, 'No permite modificar un campo', CONSORCIO],
  [681, 'Permite modificar un campo, pero no se refleja el ajuste', 822, 1, 'Permite modificar un campo, pero no se refleja el ajuste', CONSORCIO],

  // --- Problemas Asociados a la Selectividad (825)
  [660, 'Problemas técnicos por parte del aforador', 900, 4, 'Problemas técnicos por parte del aforador', CONSORCIO],
  [661, 'Se detecta un problema en la regla o se requiere ajustar la regla.', 901, 4, 'Se detecta un problema en la regla o se requiere ajustar la regla.', CONSORCIO_N2],
  [687, 'Problema Técnico a la hora del crear una regla. (Los usuarios serán la DGR)', 827, 1, 'Problema Técnico a la hora del crear una regla.', CONSORCIO],
  [688, 'No se generó el Levante automático', 829, 1, 'No se generó el Levante automático', CONSORCIO],
  [689, 'No se visualiza el aforador asignado', 830, 1, 'No se visualiza el aforador asignado', CONSORCIO],
  [690, 'Problemas con la notificación recibida por correo', 831, 1, 'Problemas con la notificación recibida por correo', CONSORCIO],
  [691, 'Problemas con las observaciones', 832, 1, 'Problemas con las observaciones', CONSORCIO],
  [692, 'Problemas en el enrutamiento del DUA', 833, 1, 'Problemas en el enrutamiento del DUA', CONSORCIO],
  [693, 'Problemas en la reasignación de DUAs', 834, 1, 'Problemas en la reasignación de DUAs', CONSORCIO],
  [694, 'Dificultades relacionadas al proceso de impugnación sobre el aforo realizado', 826, 1, 'Dificultades relacionadas al proceso de impugnación sobre el aforo realizado', DGADGT],
  [695, 'Problemas asociados a la selección o cargas de trabajo y asignación de aforador', 828, 1, 'Problemas asociados a la selección o cargas de trabajo y asignación de aforador', DGADGT],

  // --- Problemas con Llenado y Aceptación (841)
  [663, 'Consulta sobre llenado de un campo específico', 902, 4, 'Consulta sobre llenado de un campo específico', CONSORCIO],
  [702, 'No existe claridad sobre el error que genera el sistema', 842, 1, 'No existe claridad sobre el error que genera el sistema', CONSORCIO],
  [703, 'El sistema no acepta la declaración o la acepta y no numera.', 843, 1, 'El sistema no acepta la declaración o la acepta y no numera.', CONSORCIO],
  [704, 'El sistema no permite editar el DUA después de haberlo guardado', 844, 1, 'El sistema no permite editar el DUA después de haberlo guardado', CONSORCIO],
  [705, 'Faltan opciones en un combo box', 845, 1, 'Faltan opciones en un combo box', CONSORCIO],

  // --- Problemas de Acceso (846 + escalamiento 911)
  [665, 'Autorización de cuentas de Usuario', 850, 4, 'Autorización de cuentas de Usuario', DGADGT],
  [666, 'Escalabilidad: Restablecimiento de contraseña por olvido o bloqueo', 912, 4, 'Escalabilidad: Restablecimiento de contraseña por olvido o bloqueo', DTIC],
  [667, 'Solicitud y asignación de Perfil de Acceso', 852, 4, 'Solicitud y asignación de Perfil de Acceso', CONSORCIO],
  [676, 'La solicitud Implica Activación Usuario Contingencia - Mesa', 926, 4, 'La solicitud Implica Activación Usuario Contingencia — Mesa valida documento', CONSORCIO],
  [677, 'La solicitud Implica Activación Usuario Contingencia - DGA', 927, 4, 'La solicitud Implica Activación Usuario Contingencia — DGA valorar si corresponde', DGADGT],
  [678, 'La solicitud Implica Activación Usuario Contingencia - DTIC', 928, 4, 'La solicitud Implica Activación Usuario Contingencia — DTIC Notifica al solicitante', DTIC],
  [706, 'No se puede ingresar a Atena (error de autenticación, plataforma no disponible).', 847, 1, 'No se puede ingresar a Atena', CONSORCIO],
  [707, 'Problemas con la asignación de perfiles', 849, 1, 'Problemas con la asignación de perfiles', CONSORCIO],
  [708, 'Problemas con el Perfil asignado', 848, 1, 'Problemas con el Perfil asignado', DGADGT],

  // --- Consulta sobre el Manual de Procedimientos Aduaneros (897)
  [669, 'Consultas sobre el Manual de Procedimientos Aduaneros', 898, 4, 'Consultas sobre el Manual de Procedimientos Aduaneros', CONSORCIO],
  [670, 'Escalamiento manual procedimientos aduaneros / LGA / RLGA', 899, 4, 'Escalamiento manual procedimientos aduaneros', DGADGT],

  // --- Problemas desarrollador API (875)
  [672, 'Consultas sobre documentación del API', 925, 4, 'Consultas sobre documentación del API', CONSORCIO],

  // --- Problemas en Proceso de Tránsito (888)
  [674, 'Imposibilidad de reportar incidencias en carretera', 903, 4, 'Imposibilidad de reportar incidencias en carretera', CONSORCIO],

  // --- Problemas con el cálculo de la Liquidación (835)
  [697, 'Error en el cálculo de la liquidación', 836, 1, 'Error en el cálculo de la liquidación', CONSORCIO],
  [698, 'Se determina que el error esta en ATENA (endopint de API)', 838, 1, 'Se determina que el error esta en ATENA', CONSORCIO],
  [699, 'Escalamiento: Error en tipo de cambio, verificar interoperabilidad con BCCR', 840, 1, 'Escalamiento: Error en tipo de cambio, verificar interoperabilidad con BCCR', CONSORCIO],
  [700, 'Escalamiento: Se evidencia un error en la fórmula o incisos arancelarios sin actualizar', 837, 1, 'Escalamiento: Se evidencia un error en la fórmula o incisos arancelarios', DGADGT],
  [701, 'Se determina que el error esta en el API del cliente que generó el DUA', 839, 1, 'Se determina que el error esta en el API del cliente', DTIC],

  // --- Problemas de Anotación de Salida (853)
  [710, 'El sistema no permite registrar la salida efectiva de la mercancía', 854, 1, 'El sistema no permite registrar la salida efectiva de la mercancía', CONSORCIO],
  [711, 'En segmento Boletín de Liquidación no se genera el link para generar la anotación de salida', 855, 1, 'En segmento Boletín de Liquidación no se genera el link', CONSORCIO],

  // --- Problemas de Asociación de Documentos LPCO (856 + escalamiento 909)
  [713, 'Consultar sobre el tipo de documento LPCO requerido para una operación específica.', 857, 1, 'Consultar sobre el tipo de documento LPCO', CONSORCIO],
  [714, 'Error al intentar adjuntar, vincular o visualizar un documento LPCO.', 858, 1, 'Error al adjuntar / vincular / visualizar LPCO', CONSORCIO],
  [715, 'Escalabilidad: Falla en la conexión de interoperabilidad de ATENA con el organismo emisor del LPCO', 859, 1, 'Escalabilidad: Falla interoperabilidad ATENA-organismo emisor LPCO', CONSORCIO],
  [716, 'Se detectan problemas de validación al asociar un LPCO', 862, 1, 'Se detectan problemas de validación al asociar un LPCO', CONSORCIO],
  [717, 'LPCO aprobado por organismo emisor pero no esta en ATENA', 865, 1, 'LPCO aprobado por organismo emisor pero no esta en ATENA', CONSORCIO],
  [718, 'Problemas al solicitar un permiso en el módulo LPCO', 866, 1, 'Problemas al solicitar un permiso en el módulo LPCO', CONSORCIO],
  [719, 'Problemas en el módulo LPCO al aprobar un permiso', 867, 1, 'Problemas en el módulo LPCO al aprobar un permiso', CONSORCIO],
  [720, 'Problemas en el módulo LPCO con el registro del permiso por parte del ente emisor', 868, 1, 'Problemas en el módulo LPCO con el registro del permiso', CONSORCIO],
  [721, 'Escalabilidad: Se determina problemas en la digitación del permiso aprobado en el módulo LPCO por parte del ente emisor.', 863, 1, 'Escalabilidad: digitación del permiso aprobado', DGADGT],
  [722, 'Escalabilidad: Se detecta que el problema de interoperabilidad esta del lado de las instituciones y no del Consorcio', 860, 1, 'Escalabilidad: interoperabilidad del lado de las instituciones', DGADGT],
  [723, 'Permiso solicitado en el módulo LPCO pendiente de aprobación por autoridad Aduanera', 861, 1, 'Permiso pendiente de aprobación por autoridad Aduanera', DGADGT],
  [724, 'Escalabilidad: Se determina que documento de identidad no esta registrado en ATENA', 864, 1, 'Escalabilidad: documento de identidad no registrado en ATENA', DGADGT],
  [725, 'Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC', 910, 1, 'Escalabilidad: corresponde a DTIC', DTIC],

  // --- Problemas Asociados a la Infraestructura IT (Oculta) (913)
  [685, 'Escalabilidad: Se determina que el problema le corresponde resolverlo a la DTIC a nivel Infraestructura IT', 914, 1, 'Escalabilidad: Infraestructura IT a la DTIC', DTIC]
];

async function main() {
  await initDB(config);
  const pool = getDB();

  let upserts = 0;
  for (const [glpi_id, glpi_name, aranda_id, aranda_seg, aranda_name, responsable] of MAPPING) {
    await pool.query(
      `INSERT INTO service_catalog_sync
        (glpi_category_id, glpi_category_name, aranda_category_id, aranda_segment, aranda_category_name, responsable_label, match_strategy, status)
       VALUES (?, ?, ?, ?, ?, ?, 'manual_seed', 'matched')
       ON DUPLICATE KEY UPDATE
         glpi_category_name   = VALUES(glpi_category_name),
         aranda_segment       = VALUES(aranda_segment),
         aranda_category_name = VALUES(aranda_category_name),
         responsable_label    = VALUES(responsable_label),
         match_strategy       = VALUES(match_strategy),
         status               = 'matched',
         last_error           = NULL`,
      [glpi_id, glpi_name, aranda_id, aranda_seg, aranda_name, responsable ?? null]
    );
    upserts++;
  }

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM service_catalog_sync WHERE status = 'matched'`);
  console.log(JSON.stringify({ ok: true, upserts, total_matched: Number(total) }));

  await closeDB();
}

main().catch(err => {
  console.error('seed-catalog falló:', err);
  process.exit(1);
});
