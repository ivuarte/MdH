#!/usr/bin/env node
// Compara el catálogo GLPI (glpi_categories.csv) contra el Aranda (Libro1.utf8.csv)
// por nombre normalizado. Reporta alineación de grupos y subcategorías. READ-ONLY.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function parseCSV(text) {
  const rows = []; let cur = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else {
      if (c === '"') inQ = true;
      else if (c === ';') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') {} else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}
const norm = (s) => String(s ?? '').replace(/["']/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// --- GLPI: glpi_categories.csv (Nombre Completo con "MDH > grupo > sub")
const glpiRows = parseCSV(fs.readFileSync(path.join(root, 'glpi_categories.csv'), 'utf-8')).slice(1).filter(r => r[0]?.trim());
const glpiGroups = new Set(), glpiSubs = new Map(); // subNameNorm -> {group, full}
for (const r of glpiRows) {
  const parts = r[0].split(' > ').map(s => s.replace(/\s+/g, ' ').trim());
  if (parts.length === 2) glpiGroups.add(norm(parts[1]));
  else if (parts.length === 3) glpiSubs.set(norm(parts[2]), { group: norm(parts[1]), full: parts[2] });
}

// --- Aranda: Libro1.utf8.csv
const arRows = parseCSV(fs.readFileSync(path.join(root, 'Libro1.utf8.csv'), 'utf-8')).slice(1).filter(r => r.length >= 6 && r[0].trim());
const arGroups = new Set(), arSubs = new Map();
for (const r of arRows) {
  arGroups.add(norm(r[1]));
  arSubs.set(norm(r[3]), { group: norm(r[1]), code: r[4].trim(), full: r[3].replace(/\s+/g, ' ').trim() });
}

console.log(`GLPI: ${glpiGroups.size} grupos, ${glpiSubs.size} subs`);
console.log(`Aranda: ${arGroups.size} grupos, ${arSubs.size} subs`);

console.log('\n=== GRUPOS sólo en GLPI (no en Aranda por nombre) ===');
[...glpiGroups].filter(g => !arGroups.has(g)).forEach(g => console.log('  -', g));
console.log('=== GRUPOS sólo en Aranda (no en GLPI por nombre) ===');
[...arGroups].filter(g => !glpiGroups.has(g)).forEach(g => console.log('  -', g));

console.log('\n=== SUBS en Aranda SIN match en GLPI ===');
let nA = 0;
for (const [k, v] of arSubs) if (!glpiSubs.has(k)) { console.log(`  - [${v.code}] ${v.full}`); nA++; }
if (!nA) console.log('  (ninguna — todas las subs Aranda existen en GLPI)');

console.log('\n=== SUBS en GLPI SIN match en Aranda ===');
let nG = 0;
for (const [k, v] of glpiSubs) if (!arSubs.has(k)) { console.log(`  - ${v.full}`); nG++; }
if (!nG) console.log('  (ninguna — todas las subs GLPI existen en Aranda)');

console.log('\n=== SUBS donde el GRUPO padre difiere entre GLPI y Aranda ===');
let nD = 0;
for (const [k, v] of arSubs) { const g = glpiSubs.get(k); if (g && g.group !== v.group) { console.log(`  - [${v.code}] ${v.full}\n      Aranda grupo: ${v.group}\n      GLPI  grupo: ${g.group}`); nD++; } }
if (!nD) console.log('  (ninguna — los padres coinciden)');
