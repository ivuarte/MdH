#!/usr/bin/env node
// Seed LOCAL-SAFE de service_catalog_sync.
//
// A diferencia de scripts/sync-glpi-from-csv.js (que está cableado a los IDs de
// PRODUCCIÓN — MDH=658, grupos 659.. — y REORGANIZA el árbol GLPI), este script:
//   - NO modifica GLPI (cero POST/PUT). El árbol local ya está organizado bajo "MdH".
//   - Resuelve glpi_category_id por COINCIDENCIA DE NOMBRE contra el GLPI configurado
//     en .env, así funciona con cualquier instancia (local, staging, prod) sin IDs fijos.
//
// Cruce: para cada subcategoría del CSV (Libro1.utf8.csv) busca la categoría GLPI hoja
// cuyo nombre normalizado == subNombre y cuyo grupo padre == grupoNombre. Si el nombre
// es único en todo el árbol, acepta el match aunque el padre no calce (fallback).
//
// Ejecutar dry-run:  node scripts/seed-catalog-local.js --dry-run
// Ejecutar real:     node scripts/seed-catalog-local.js

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDB, getDB, closeDB } from '../src/lib/db.js';
import { config } from '../src/config.js';
import { glpiClient } from '../src/lib/glpiClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', 'Libro1.utf8.csv');
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

// Normaliza para comparar nombres: quita comillas (incl. los '' '' que mete GLPI),
// acentos, colapsa espacios y pasa a minúsculas.
const norm = (s) => String(s ?? '')
  .replace(/["']/g, '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

async function glpiGET(p, params = {}) {
  await glpiClient.ensureSession();
  const headers = { 'Session-Token': glpiClient.sessionToken, 'App-Token': config.APP_TOKEN };
  return (await glpiClient.http.get(p, { params, headers })).data;
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

async function main() {
  console.log(`[${DRY_RUN ? 'DRY-RUN' : 'LIVE'}] Seed local de service_catalog_sync`);

  await initDB(config);
  const pool = getDB();

  // 1. CSV → filas {tipo, grupoNombre, grupoCode, subNombre, subCode, responsable}
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const csvRows = parseCSV(raw).slice(1)
    .filter(r => r.length >= 6 && r[0].trim())
    .map(r => ({
      tipo: r[0].replace(/\s+/g, ' ').trim(),
      grupoNombre: r[1].replace(/\s+/g, ' ').trim(),
      grupoCode: Number(r[2].trim()),
      subNombre: r[3].replace(/\s+/g, ' ').trim(),
      subCode: Number(r[4].trim()),
      responsable: r[5].replace(/\s+/g, ' ').trim()
    }));
  console.log(`CSV → ${csvRows.length} subcategorías`);

  // 2. Árbol GLPI (instancia del .env)
  const allGlpi = await loadAllGlpiCategories();
  const byId = new Map(allGlpi.map(c => [Number(c.id), c]));
  console.log(`GLPI (${config.GLPI_BASE_URL}) → ${allGlpi.length} categorías`);

  // Índices de búsqueda
  const byParentAndName = new Map(); // `${normParent}|${normName}` -> cat
  const byName = new Map();          // normName -> [cats]
  for (const c of allGlpi) {
    const parent = byId.get(Number(c.itilcategories_id));
    const parentName = parent ? norm(parent.name) : '';
    const nName = norm(c.name);
    const pk = `${parentName}|${nName}`;
    if (!byParentAndName.has(pk)) byParentAndName.set(pk, c);
    if (!byName.has(nName)) byName.set(nName, []);
    byName.get(nName).push(c);
  }

  const pathOf = (c) => {
    const parts = [];
    let cur = c, guard = 0;
    while (cur && guard++ < 10) { parts.unshift(cur.name); cur = byId.get(Number(cur.itilcategories_id)); }
    return parts.join(' > ');
  };

  // 3. Resolver cada fila CSV → categoría GLPI
  const matched = [];
  const unmatched = [];
  for (const r of csvRows) {
    const nSub = norm(r.subNombre);
    const nGrp = norm(r.grupoNombre);

    let cat = byParentAndName.get(`${nGrp}|${nSub}`); // match preciso (padre+nombre)
    let strategy = 'name+parent';

    if (!cat) {
      const cands = byName.get(nSub) || [];
      if (cands.length === 1) { cat = cands[0]; strategy = 'name_unique'; }
      else if (cands.length > 1) {
        // ambiguo: preferir la hoja más profunda
        cat = cands.slice().sort((a, b) => pathOf(b).length - pathOf(a).length)[0];
        strategy = 'name_ambiguous_deepest';
      }
    }

    if (!cat) {
      // Prefijo dentro del mismo grupo padre: el CSV suele traer texto extra
      // entre paréntesis ("(Ej: …)", "(Usuario: …)") que GLPI recortó. Acotado al
      // grupo para evitar falsos positivos; exige nombre GLPI ≥ 10 chars.
      const sameGroup = allGlpi.filter(c => {
        const parent = byId.get(Number(c.itilcategories_id));
        return parent && norm(parent.name) === nGrp;
      });
      const prefixHits = sameGroup
        .map(c => ({ c, n: norm(c.name) }))
        .filter(({ n }) => n.length >= 10 && (nSub.startsWith(n) || n.startsWith(nSub)))
        .sort((a, b) => b.n.length - a.n.length);
      if (prefixHits.length) { cat = prefixHits[0].c; strategy = 'name_prefix_in_group'; }
    }

    if (cat) {
      matched.push({
        glpi_id: Number(cat.id),
        glpi_name: cat.name,
        glpi_path: pathOf(cat),
        aranda_id: r.subCode,
        segment: r.tipo.toLowerCase().startsWith('inc') ? 1 : 4,
        aranda_name: r.subNombre,
        responsable: r.responsable,
        strategy
      });
    } else {
      unmatched.push({ aranda_id: r.subCode, sub: r.subNombre, grupo: r.grupoNombre });
    }
  }

  // 4. UPSERT (idempotente por aranda_category_id / glpi_category_id UNIQUE)
  let upserts = 0;
  if (!DRY_RUN) {
    for (const m of matched) {
      await pool.query(
        `INSERT INTO service_catalog_sync
           (glpi_category_id, glpi_category_name, glpi_category_path,
            aranda_category_id, aranda_segment, aranda_category_name,
            responsable_label, match_strategy, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'matched')
         ON DUPLICATE KEY UPDATE
           glpi_category_name   = VALUES(glpi_category_name),
           glpi_category_path   = VALUES(glpi_category_path),
           aranda_segment       = VALUES(aranda_segment),
           aranda_category_name = VALUES(aranda_category_name),
           responsable_label    = VALUES(responsable_label),
           match_strategy       = VALUES(match_strategy),
           status               = 'matched',
           last_error           = NULL`,
        [m.glpi_id, m.glpi_name, m.glpi_path, m.aranda_id, m.segment, m.aranda_name, m.responsable, m.strategy]
      );
      upserts++;
    }
  }

  // 5. Reporte
  const byStrat = matched.reduce((a, m) => (a[m.strategy] = (a[m.strategy] || 0) + 1, a), {});
  console.log('\n=== RESUMEN ===');
  console.log(JSON.stringify({
    dry_run: DRY_RUN,
    csv_rows: csvRows.length,
    matched: matched.length,
    unmatched: unmatched.length,
    by_strategy: byStrat,
    db_upserts: upserts
  }, null, 2));

  if (unmatched.length) {
    console.log('\n--- SIN MATCH (revisar nombre en GLPI) ---');
    for (const u of unmatched) console.log(`  Aranda ${u.aranda_id} [${u.grupo}] → "${u.sub}"`);
  }

  await closeDB();
}

main().catch(err => { console.error('FATAL:', err.response?.data ?? err); process.exit(1); });
