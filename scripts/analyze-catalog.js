#!/usr/bin/env node
// Analiza Libro1.utf8.csv (fuente funcional Aranda) contra:
//   1. service_catalog_sync (BD del bot)
//   2. GLPI ITILCategory bajo "MDH" (id 658)
//
// Reporta:
//   - filas CSV sin mapping en seed (subcategorías Aranda que no se sincronizan)
//   - filas seed sin row CSV (huérfanos en el bot)
//   - subcategorías Aranda sin equivalente GLPI (faltan crearse)
//   - duplicados, inconsistencias de tipo (Inc/Req vs IM/RF)

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
const MDH_ROOT_ID = 658; // categoría raíz "MDH" en GLPI

// CSV parser tolerante a comillas, saltos de línea internos y separador ';'.
function parseCSV(text) {
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ';') { cur.push(field); field = ''; }
      else if (c === '\n') {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = '';
      } else if (c === '\r') {
        // ignore
      } else {
        field += c;
      }
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

function normWS(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

async function loadAranda() {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCSV(raw);
  // primera fila lógica = header multi-línea ya parseado, descartamos.
  const data = rows.slice(1).filter(r => r.length >= 6 && r[0].trim().length);
  const items = data.map(r => ({
    tipo: normWS(r[0]),                  // Incidencia | Requerimiento
    grupoNombre: normWS(r[1]),           // p.ej. "Problemas Asociados a la Selectividad"
    grupoCodigo: Number(normWS(r[2])),   // 820, 825, ...
    subNombre: normWS(r[3]),
    subCodigo: Number(normWS(r[4])),     // 821, 827, ...
    responsable: normWS(r[5])
  }));
  return items;
}

async function loadSeed() {
  const pool = getDB();
  const [rows] = await pool.query(
    `SELECT glpi_category_id, glpi_category_name, aranda_category_id, aranda_segment, aranda_category_name, responsable_label
       FROM service_catalog_sync
      WHERE status = 'matched'
      ORDER BY aranda_category_id`
  );
  return rows;
}

async function loadGlpiTree() {
  await glpiClient.ensureSession();
  // GET range hasta agotar — instancia chica, basta 5000.
  const all = [];
  const STEP = 200;
  for (let start = 0; ; start += STEP) {
    const res = await glpiClient.http.get('/ITILCategory', {
      params: { range: `${start}-${start + STEP - 1}`, expand_dropdowns: false },
      headers: { 'Session-Token': glpiClient.sessionToken, 'App-Token': config.APP_TOKEN }
    });
    const chunk = Array.isArray(res.data) ? res.data : [];
    if (!chunk.length) break;
    all.push(...chunk);
    if (chunk.length < STEP) break;
  }
  return all;
}

function gatherDescendants(all, rootId) {
  // BFS de descendientes de rootId vía itilcategories_id (padre).
  const childrenByParent = new Map();
  for (const c of all) {
    const p = Number(c.itilcategories_id ?? 0);
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p).push(c);
  }
  const out = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    const kids = childrenByParent.get(id) || [];
    for (const k of kids) {
      out.push(k);
      stack.push(Number(k.id));
    }
  }
  return out;
}

async function main() {
  await initDB(config);

  const aranda = await loadAranda();
  const seed = await loadSeed();
  const allGlpi = await loadGlpiTree();
  const mdhDescendants = gatherDescendants(allGlpi, MDH_ROOT_ID);

  // Index por código Aranda
  const seedByArandaId = new Map(seed.map(r => [Number(r.aranda_category_id), r]));
  const arandaById = new Map(aranda.map(r => [r.subCodigo, r]));

  // Index GLPI por nombre normalizado para fuzzy lookup
  const glpiByName = new Map();
  for (const c of mdhDescendants) {
    const key = normWS(c.name).toLowerCase();
    if (!glpiByName.has(key)) glpiByName.set(key, []);
    glpiByName.get(key).push(c);
  }

  // --- 1. CSV sin mapeo en seed
  const csvMissingInSeed = aranda.filter(r => !seedByArandaId.has(r.subCodigo));
  // --- 2. Seed sin CSV
  const seedMissingInCsv = seed.filter(r => !arandaById.has(Number(r.aranda_category_id)));
  // --- 3. Inconsistencias Inc/Req vs seg=1/4
  const typeMismatch = [];
  for (const r of aranda) {
    const s = seedByArandaId.get(r.subCodigo);
    if (!s) continue;
    const csvSeg = r.tipo.toLowerCase().startsWith('inc') ? 1 : 4;
    if (Number(s.aranda_segment) !== csvSeg) typeMismatch.push({ aranda_id: r.subCodigo, csv: r.tipo, seed_seg: s.aranda_segment, csv_seg: csvSeg, name: r.subNombre });
  }
  // --- 4. CSV sin equivalente GLPI (busca por nombre del subgrupo en árbol MDH)
  const noGlpiMatch = [];
  for (const r of aranda) {
    const key = normWS(r.subNombre).toLowerCase();
    if (!glpiByName.has(key)) noGlpiMatch.push(r);
  }
  // --- 5. Grupos CSV nivel 1 presentes en MDH?
  const csvGroups = new Map();
  for (const r of aranda) {
    if (!csvGroups.has(r.grupoCodigo)) csvGroups.set(r.grupoCodigo, r.grupoNombre);
  }
  const missingGroups = [];
  for (const [code, name] of csvGroups.entries()) {
    const key = normWS(name).toLowerCase();
    if (!glpiByName.has(key)) missingGroups.push({ code, name });
  }

  const report = {
    sizes: {
      aranda_csv_rows: aranda.length,
      seed_rows: seed.length,
      glpi_categories_total: allGlpi.length,
      glpi_under_mdh: mdhDescendants.length
    },
    csv_missing_in_seed: csvMissingInSeed.map(r => ({ aranda_id: r.subCodigo, tipo: r.tipo, name: r.subNombre, group: `${r.grupoCodigo} ${r.grupoNombre}`, responsable: r.responsable })),
    seed_missing_in_csv: seedMissingInCsv.map(r => ({ aranda_id: r.aranda_category_id, name: r.aranda_category_name })),
    type_mismatch: typeMismatch,
    aranda_groups_missing_in_glpi: missingGroups,
    aranda_subs_missing_in_glpi_by_name: noGlpiMatch.map(r => ({ aranda_id: r.subCodigo, name: r.subNombre, group: `${r.grupoCodigo} ${r.grupoNombre}` }))
  };

  console.log(JSON.stringify(report, null, 2));
  await closeDB();
}

main().catch(err => { console.error(err); process.exit(1); });
