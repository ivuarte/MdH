#!/usr/bin/env node
// Reorganiza GLPI ITILCategory para que TODO el catálogo MDH cuelgue de "MDH" (id 658) y
// crea las categorías faltantes según Libro1.utf8.csv (fuente funcional Aranda).
//
// Política de mapeo (definida por el usuario):
//   1. Mover los 13 grupos existentes bajo MDH (658)
//   2. Mantener duplicado 682/683 sin tocar — el sub nuevo cae bajo 682
//   3. Aplanar escalamientos Aranda: subs de 904/907/909/911 cuelgan del grupo base GLPI
//      (911→664, 909→712, 913→684 ya existe, 904→nuevo Pago, 907→nuevo Firma)
//
// Pasos:
//   1. Mover los 13 grupos bajo 658 (PUT itilcategories_id=658). Idempotente.
//   2. Crear/Reusar 4 grupos nuevos bajo 658: 869, 879, 881, 884
//   3. Para cada subcat del CSV: reusar GLPI id si está en service_catalog_sync, sino
//      buscar por (nombre, padre) en GLPI, sino POST.
//   4. UPSERT en service_catalog_sync todas las filas (77 ahora).
//   5. Reportar resumen.
//
// Ejecutar:  node scripts/sync-glpi-from-csv.js
// Repetible: el script es idempotente; re-correr no duplica.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDB, getDB, closeDB } from '../src/lib/db.js';
import { config } from '../src/config.js';
import { glpiClient } from '../src/lib/glpiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CSV_PATH = path.join(__dirname, '..', 'Libro1.utf8.csv');
const MDH_ROOT_ID = 658;

const DRY_RUN = process.argv.includes('--dry-run');

// ---- CSV parser tolerante a comillas, saltos internos y separador ;
function parseCSV(text) {
  const rows = [];
  let cur = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ';') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') {} else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---- Mapas: Aranda grupo code → GLPI parent id
// Los conocidos existentes (verificados con node scripts/check-glpi-mdh.js):
const GROUP_TO_GLPI_EXISTING = {
  820: 679,  // Problema al modificar la DUA posterior a la aceptación
  823: 682,  // Problemas al Guardar / Almacenar (mantenemos 682, dup 683 sin tocar)
  825: 659,  // Problemas Asociados a la Selectividad
  835: 696,  // Problemas con el cálculo de la Liquidación
  841: 662,  // Problemas con Llenado y Aceptación
  846: 664,  // Problemas de Acceso
  853: 709,  // Problemas de Anotación de Salida
  856: 712,  // Problemas de Asociación de Documentos LPCO
  875: 671,  // Problemas desarrollador API
  888: 673,  // Problemas en Proceso de Tránsito
  897: 668,  // Consulta sobre el Manual de Procedimientos Aduaneros
  913: 684,  // Problemas Asociados a la Infraestructura IT (Oculta)
};

// Escalamientos aplanados al grupo base GLPI
const ESCAL_FLATTEN = {
  904: '869_NEW',  // Pago (escal.) → mismo grupo nuevo Pago
  907: '881_NEW',  // Firma (escal.) → mismo grupo nuevo Firma
  909: 712,        // LPCO (escal.) → 712 LPCO
  911: 664,        // Acceso (escal.) → 664 Acceso
};

// Grupos nuevos a crear bajo MDH (658). Aranda code → name.
const NEW_GROUPS = {
  869: 'Problemas de Pago',
  879: 'Problemas en el proceso de rectificación',
  881: 'Problemas en la Firma Digital',
  884: 'Problemas en Proceso de Levante'
};

// Los 13 grupos a mover bajo MDH
const GROUPS_TO_MOVE = [659, 662, 664, 668, 671, 673, 679, 682, 683, 684, 696, 709, 712];

// ---- HTTP helper
async function glpiGET(path, params = {}) {
  await glpiClient.ensureSession();
  const headers = { 'Session-Token': glpiClient.sessionToken, 'App-Token': config.APP_TOKEN };
  return (await glpiClient.http.get(path, { params, headers })).data;
}
async function glpiPOST(path, body) {
  if (DRY_RUN) { console.log(`[DRY] POST ${path} ${JSON.stringify(body).slice(0, 200)}`); return { id: -1 }; }
  await glpiClient.ensureSession();
  const headers = { 'Session-Token': glpiClient.sessionToken, 'App-Token': config.APP_TOKEN };
  return (await glpiClient.http.post(path, body, { headers })).data;
}
async function glpiPUT(path, body) {
  if (DRY_RUN) { console.log(`[DRY] PUT ${path} ${JSON.stringify(body)}`); return [{}]; }
  await glpiClient.ensureSession();
  const headers = { 'Session-Token': glpiClient.sessionToken, 'App-Token': config.APP_TOKEN };
  return (await glpiClient.http.put(path, body, { headers })).data;
}

async function loadAllGlpiCategories() {
  let all = [];
  for (let start = 0; ; start += 100) {
    const r = await glpiGET('/ITILCategory', { range: `${start}-${start + 99}` });
    const arr = Array.isArray(r) ? r : [];
    if (!arr.length) break;
    all = all.concat(arr);
    if (arr.length < 100) break;
  }
  return all;
}

async function createCategory(name, parentId) {
  const body = {
    input: {
      name,
      itilcategories_id: parentId,
      is_incident: 1,
      is_request: 1,
      is_problem: 1,
      is_change: 1,
      is_helpdeskvisible: 1
    }
  };
  const res = await glpiPOST('/ITILCategory', body);
  return res.id ?? res[0]?.id ?? null;
}

async function main() {
  console.log(`[${DRY_RUN ? 'DRY-RUN' : 'LIVE'}] Iniciando sync GLPI ↔ CSV`);

  await initDB(config);
  const pool = getDB();

  // 1. Cargar CSV
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCSV(raw).slice(1).filter(r => r.length >= 6 && r[0].trim());
  const csvRows = rows.map(r => ({
    tipo: norm(r[0]),
    grupoNombre: norm(r[1]),
    grupoCode: Number(norm(r[2])),
    subNombre: norm(r[3]),
    subCode: Number(norm(r[4])),
    responsable: norm(r[5])
  }));
  console.log(`CSV → ${csvRows.length} subcategorías`);

  // 2. Cargar service_catalog_sync existente (52 mappings)
  const [seedRows] = await pool.query(
    `SELECT aranda_category_id, glpi_category_id FROM service_catalog_sync WHERE status = 'matched'`
  );
  const arandaToGlpi = new Map(seedRows.map(r => [Number(r.aranda_category_id), Number(r.glpi_category_id)]));
  console.log(`Seed actual → ${arandaToGlpi.size} mappings conocidos`);

  // 3. Cargar árbol GLPI
  const allGlpi = await loadAllGlpiCategories();
  const glpiById = new Map(allGlpi.map(c => [Number(c.id), c]));
  console.log(`GLPI → ${allGlpi.length} categorías totales`);

  // Index por (parent, normalized_name) para resolver duplicados al crear
  const glpiByKey = new Map();
  for (const c of allGlpi) {
    const key = `${Number(c.itilcategories_id)}|${norm(c.name).toLowerCase()}`;
    if (!glpiByKey.has(key)) glpiByKey.set(key, c);
  }

  // 4. Paso 1: mover los 13 grupos bajo MDH (658)
  const movedReport = [];
  for (const gid of GROUPS_TO_MOVE) {
    const c = glpiById.get(gid);
    if (!c) { console.warn(`  grupo ${gid} NO existe — skip`); continue; }
    if (Number(c.itilcategories_id) === MDH_ROOT_ID) {
      movedReport.push({ id: gid, name: c.name, action: 'already_under_mdh' });
      continue;
    }
    await glpiPUT(`/ITILCategory/${gid}`, { input: { id: gid, itilcategories_id: MDH_ROOT_ID } });
    movedReport.push({ id: gid, name: c.name, action: 'moved' });
    c.itilcategories_id = MDH_ROOT_ID;
  }
  console.log(`Movidos bajo MDH: ${movedReport.filter(m => m.action === 'moved').length}/${GROUPS_TO_MOVE.length}`);

  // 5. Paso 2: crear (o reusar) los 4 grupos nuevos bajo MDH
  const newGroupGlpiIds = {};
  for (const [arandaCode, name] of Object.entries(NEW_GROUPS)) {
    const key = `${MDH_ROOT_ID}|${name.toLowerCase()}`;
    let existing = glpiByKey.get(key);
    if (existing) {
      newGroupGlpiIds[arandaCode] = Number(existing.id);
      console.log(`  grupo nuevo ${arandaCode} "${name}" — reusado glpi_id=${existing.id}`);
    } else {
      const newId = await createCategory(name, MDH_ROOT_ID);
      newGroupGlpiIds[arandaCode] = newId;
      console.log(`  grupo nuevo ${arandaCode} "${name}" — creado glpi_id=${newId}`);
      if (!DRY_RUN && newId) {
        // refrescar índice para subs que usarán este padre
        glpiByKey.set(key, { id: newId, name, itilcategories_id: MDH_ROOT_ID });
        glpiById.set(Number(newId), { id: newId, name, itilcategories_id: MDH_ROOT_ID });
      }
    }
  }

  // 6. Paso 3: resolver parent GLPI por cada fila CSV
  function resolveParentGlpiId(arandaGroupCode) {
    if (GROUP_TO_GLPI_EXISTING[arandaGroupCode] != null) return GROUP_TO_GLPI_EXISTING[arandaGroupCode];
    if (ESCAL_FLATTEN[arandaGroupCode] != null) {
      const v = ESCAL_FLATTEN[arandaGroupCode];
      if (typeof v === 'string' && v.endsWith('_NEW')) {
        const code = v.replace('_NEW', '');
        return newGroupGlpiIds[code];
      }
      return v;
    }
    if (NEW_GROUPS[arandaGroupCode] != null) return newGroupGlpiIds[arandaGroupCode];
    throw new Error(`Grupo Aranda ${arandaGroupCode} sin mapeo`);
  }

  // 7. Paso 4: crear o reusar subcategorías
  const subActions = []; // { aranda_id, glpi_id, action }
  for (const r of csvRows) {
    const parentId = resolveParentGlpiId(r.grupoCode);
    if (!parentId) {
      subActions.push({ aranda_id: r.subCode, glpi_id: null, action: 'skip_parent_missing' });
      continue;
    }

    // ¿Ya hay mapping conocido del seed?
    if (arandaToGlpi.has(r.subCode)) {
      const gid = arandaToGlpi.get(r.subCode);
      // Si el parent actual difiere del esperado por nuestra política, lo movemos.
      const cur = glpiById.get(gid);
      if (cur && Number(cur.itilcategories_id) !== parentId) {
        await glpiPUT(`/ITILCategory/${gid}`, { input: { id: gid, itilcategories_id: parentId } });
        cur.itilcategories_id = parentId;
        subActions.push({ aranda_id: r.subCode, glpi_id: gid, action: 'reparented' });
      } else {
        subActions.push({ aranda_id: r.subCode, glpi_id: gid, action: 'reused_from_seed' });
      }
      continue;
    }

    // ¿Existe en GLPI por (parent, nombre)?
    const key = `${parentId}|${r.subNombre.toLowerCase()}`;
    const existing = glpiByKey.get(key);
    if (existing) {
      subActions.push({ aranda_id: r.subCode, glpi_id: Number(existing.id), action: 'reused_by_name' });
      continue;
    }

    // POST nuevo
    const newId = await createCategory(r.subNombre, parentId);
    subActions.push({ aranda_id: r.subCode, glpi_id: newId, action: 'created' });
    if (!DRY_RUN && newId) {
      glpiByKey.set(key, { id: newId, name: r.subNombre, itilcategories_id: parentId });
    }
  }

  // 8. UPSERT en service_catalog_sync los 77 mappings
  let dbUpserts = 0;
  if (!DRY_RUN) {
    for (const r of csvRows) {
      const sa = subActions.find(s => s.aranda_id === r.subCode);
      if (!sa || !sa.glpi_id) continue;
      const seg = r.tipo.toLowerCase().startsWith('inc') ? 1 : 4;
      await pool.query(
        `INSERT INTO service_catalog_sync
          (glpi_category_id, glpi_category_name, aranda_category_id, aranda_segment, aranda_category_name, responsable_label, match_strategy, status)
         VALUES (?, ?, ?, ?, ?, ?, 'csv_seed', 'matched')
         ON DUPLICATE KEY UPDATE
           glpi_category_name   = VALUES(glpi_category_name),
           aranda_segment       = VALUES(aranda_segment),
           aranda_category_name = VALUES(aranda_category_name),
           responsable_label    = VALUES(responsable_label),
           match_strategy       = VALUES(match_strategy),
           status               = 'matched',
           last_error           = NULL`,
        [sa.glpi_id, r.subNombre, r.subCode, seg, r.subNombre, r.responsable]
      );
      dbUpserts++;
    }
  }

  // 9. Reporte
  const byAction = subActions.reduce((acc, s) => (acc[s.action] = (acc[s.action] || 0) + 1, acc), {});
  console.log('\n=== RESUMEN ===');
  console.log(JSON.stringify({
    dry_run: DRY_RUN,
    groups_moved_under_mdh: movedReport.filter(m => m.action === 'moved').length,
    groups_already_under_mdh: movedReport.filter(m => m.action === 'already_under_mdh').length,
    new_groups_created: Object.keys(newGroupGlpiIds).length,
    new_group_ids: newGroupGlpiIds,
    subs_by_action: byAction,
    db_upserts: dbUpserts,
    total_csv_rows: csvRows.length
  }, null, 2));

  await closeDB();
}

main().catch(err => { console.error('FATAL:', err.response?.data ?? err); process.exit(1); });
