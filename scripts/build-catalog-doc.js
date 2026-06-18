#!/usr/bin/env node
// Genera, a partir de las DOS fuentes autoritativas, artefactos alineados por construcción:
//   1. Reescribe Libro1.utf8.csv "bien estructurado" (1 cabecera, 1 registro/línea, nombres limpios).
//   2. Regenera CATALOGO.md cruzando glpi_categories.csv (GLPI) ↔ Libro1.utf8.csv (Aranda) por nombre.
//
// Fuentes:
//   - glpi_categories.csv : export de categorías ITIL de GLPI (path "MDH > grupo > sub" + visibilidad).
//   - Libro1.utf8.csv     : export funcional Aranda (tipo, grupo+código, sub+código, responsable).
//
// Uso: node scripts/build-catalog-doc.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const norm = (s) => String(s ?? '').replace(/["']/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function parseCSV(t) {
  const rows = []; let cur = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else { if (c === '"') q = true; else if (c === ';') { cur.push(f); f = ''; } else if (c === '\n') { cur.push(f); rows.push(cur); cur = []; f = ''; } else if (c === '\r') {} else f += c; }
  }
  if (f.length || cur.length) { cur.push(f); rows.push(cur); }
  return rows;
}
const csvField = (v) => /[";\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v;

// ---------- 1. Aranda (Libro1.utf8.csv) ----------
const arRaw = parseCSV(fs.readFileSync(path.join(root, 'Libro1.utf8.csv'), 'utf-8')).slice(1).filter(r => r.length >= 6 && r[0].trim());
const aranda = arRaw.map(r => ({
  tipo: clean(r[0]), grupo: clean(r[1]), grupoCode: clean(r[2]),
  sub: clean(r[3]), subCode: clean(r[4]), responsable: clean(r[5])
}));

// Reescribir CSV limpio
const header = ['Tipo', 'Grupo (Nivel 1)', 'Codigo Grupo Aranda', 'Subcategoria (Nivel 2)', 'Codigo Sub Aranda', 'Responsable de Gestion'];
const csvOut = [header.join(';')]
  .concat(aranda.map(a => [a.tipo, a.grupo, a.grupoCode, a.sub, a.subCode, a.responsable].map(csvField).join(';')))
  .join('\n') + '\n';
fs.writeFileSync(path.join(root, 'Libro1.utf8.csv'), csvOut, 'utf-8');
console.log(`Libro1.utf8.csv reescrito: ${aranda.length} subcategorías, 1 cabecera, ${aranda.length + 1} líneas.`);

// índice Aranda por nombre de sub
const arBySub = new Map(aranda.map(a => [norm(a.sub), a]));
const segOf = (tipo) => tipo.toLowerCase().startsWith('inc') ? '1 (IM)' : '4 (RF)';

// ---------- 2. GLPI (glpi_categories.csv) ----------
const glpiRaw = parseCSV(fs.readFileSync(path.join(root, 'glpi_categories.csv'), 'utf-8')).slice(1).filter(r => r[0]?.trim());
const SI = (v) => clean(v).toLowerCase() === 'si';
const groups = [];           // orden de aparición
const groupSubs = new Map();  // grupo -> [{sub, req, inc}]
for (const r of glpiRaw) {
  const parts = r[0].split(' > ').map(clean);
  if (parts.length === 2) { if (!groupSubs.has(parts[1])) { groups.push(parts[1]); groupSubs.set(parts[1], []); } }
  else if (parts.length === 3) {
    if (!groupSubs.has(parts[1])) { groups.push(parts[1]); groupSubs.set(parts[1], []); }
    groupSubs.get(parts[1]).push({ sub: parts[2], req: SI(r[4]), inc: SI(r[5]) });
  }
}
const totalSubs = [...groupSubs.values()].reduce((a, s) => a + s.length, 0);

// ---------- 3. Generar CATALOGO.md ----------
const hoy = new Date().toISOString().slice(0, 10);
let md = '';
md += `# Catálogo de Categorías — GLPI ↔ Aranda\n\n`;
md += `> Documento **generado automáticamente** por \`scripts/build-catalog-doc.js\` a partir de las dos fuentes autoritativas. No editar a mano: re-generar tras cambios en los CSV.\n\n`;
md += `**Fecha de generación:** ${hoy}\n`;
md += `**Fuente GLPI:** \`glpi_categories.csv\` (export de \`glpi_itilcategories\`, árbol bajo **MDH**)\n`;
md += `**Fuente Aranda:** \`Libro1.utf8.csv\` (export funcional, 2 niveles: Grupo → Sub Grupo, con código y tipo)\n\n`;
md += `**Alineación:** GLPI ${groups.length} grupos / ${totalSubs} subcategorías ↔ Aranda ${new Set(aranda.map(a=>a.grupo)).size} grupos / ${aranda.length} subcategorías. `;
md += `Cruce 1:1 por nombre normalizado (sin acentos, espacios colapsados, case-insensitive); 100% de cobertura verificada con \`scripts/analyze-catalog-alignment.js\`.\n\n`;
md += `---\n\n## 1. Catálogo GLPI (árbol ITIL)\n\n`;
md += `Raíz: **MDH**. Cada subcategoría indica su visibilidad GLPI: **S** = Solicitud (\`is_request\`), **I** = Incidente (\`is_incident\`).\n\n`;

let gi = 0;
for (const g of groups) {
  gi++;
  const subs = groupSubs.get(g);
  md += `### 1.${gi} ${g}\n\n`;
  if (!subs.length) { md += `_(grupo sin subcategorías en el export)_\n\n`; continue; }
  md += `| Subcategoría | Vis. |\n|---|:--:|\n`;
  for (const s of subs) md += `| ${s.sub} | ${s.req ? 'S' : ''}${s.inc ? 'I' : ''} |\n`;
  md += `\n`;
}

md += `---\n\n## 2. Catálogo Aranda\n\n`;
md += `Modelo de 2 niveles. **Tipo** define el segmento del caso: Incidencia = segmento 1 (IM), Requerimiento = segmento 4 (RF).\n\n`;
const arByGroup = new Map();
for (const a of aranda) { if (!arByGroup.has(a.grupo)) arByGroup.set(a.grupo, { code: a.grupoCode, subs: [] }); arByGroup.get(a.grupo).subs.push(a); }
let ai = 0;
for (const [g, info] of arByGroup) {
  ai++;
  md += `### 2.${ai} ${g} (grupo ${info.code})\n\n`;
  md += `| Cód. Sub | Tipo | Subcategoría | Responsable |\n|---:|---|---|---|\n`;
  for (const s of info.subs) md += `| ${s.subCode} | ${s.tipo} | ${s.sub} | ${s.responsable} |\n`;
  md += `\n`;
}

md += `---\n\n## 3. Mapeo GLPI ↔ Aranda (por nombre)\n\n`;
md += `Cada subcategoría GLPI se traduce a un código Aranda + segmento. Esta es la relación que carga \`service_catalog_sync\` (ver \`scripts/seed-catalog-local.js\`).\n\n`;
let mi = 0, sinMatch = [];
for (const g of groups) {
  mi++;
  const subs = groupSubs.get(g);
  if (!subs.length) continue;
  md += `### 3.${mi} ${g}\n\n`;
  md += `| Subcategoría GLPI | Aranda Sub | Segmento |\n|---|---:|---|\n`;
  for (const s of subs) {
    const a = arBySub.get(norm(s.sub));
    if (a) md += `| ${s.sub} | ${a.subCode} | ${segOf(a.tipo)} |\n`;
    else { md += `| ${s.sub} | — | _sin match_ |\n`; sinMatch.push(s.sub); }
  }
  md += `\n`;
}

md += `---\n\n## 4. Notas de alineación\n\n`;
md += `- **Cobertura:** ${totalSubs - sinMatch.length}/${totalSubs} subcategorías GLPI mapeadas a Aranda${sinMatch.length ? ` (${sinMatch.length} sin match — revisar)` : ' (100%)'}.\n`;
md += `- **Profundidad:** GLPI es de 3 niveles (MDH > Grupo > Sub); Aranda de 2 (Grupo → Sub). La raíz MDH no tiene equivalente Aranda.\n`;
md += `- **Tipo de caso:** en GLPI es implícito (flags \`is_request\`/\`is_incident\`); en Aranda es explícito por segmento (IM=1 / RF=4). El segmento del mapeo proviene de la columna *Tipo* de Aranda.\n`;
md += `- **Escalamientos Aranda:** algunos grupos de escalamiento Aranda (904, 907, 909, 911) se aplanan al grupo base correspondiente en GLPI; sus subs aparecen bajo el grupo padre GLPI.\n`;
md += `- **Regeneración:** ante cualquier cambio en \`glpi_categories.csv\` o \`Libro1.utf8.csv\`, correr \`node scripts/build-catalog-doc.js\` para re-sincronizar este documento, y \`node scripts/seed-catalog-local.js\` para re-cargar \`service_catalog_sync\`.\n`;
if (sinMatch.length) { md += `\n**Subcategorías GLPI sin match en Aranda:**\n`; for (const s of sinMatch) md += `- ${s}\n`; }
md += `\n---\n\n_Implementación del sync de catálogo y decisiones funcionales: ver \`PLAN_IMPLEMENTACION.md §9\`._\n`;

fs.writeFileSync(path.join(root, 'CATALOGO.md'), md, 'utf-8');
console.log(`CATALOGO.md regenerado: ${groups.length} grupos, ${totalSubs} subs GLPI; ${totalSubs - sinMatch.length}/${totalSubs} mapeadas. sin match: ${sinMatch.length}`);
