#!/usr/bin/env node
// Seed de aranda_groups con los códigos provistos por funcional.
// Para etiquetas con múltiples grupos candidatos, MARCAMOS uno como is_default_for_label=1
// (el primero de la lista — documentado en las notas). El daemon usará el default cuando la
// categoría no apunte a un grupo específico.
//
// Ambigüedades resueltas con "primero del bloque":
//   - "Ministerio de Hacienda - DGA -DGT" → id=63 (DGT - Procesos Aduaneros)
//   - "Ministerio de Hacienda - Aduanas"  → id=67 (Jefe Sección Técnica Aduana Caldera)
//   - "Ministerio de Hacienda - DTIC"     → id=0  (Grupo clasificación tickets DTIC)
//   - "Ministerio de Hacienda - DGA"      → id=60 (Grupo clasificación tickets DGA)
//
// Si se descubre un mejor default, basta con re-correr este seed con el flag is_default
// movido a otra fila. El seed es idempotente.

import 'dotenv/config';
import { initDB, getDB, closeDB } from '../src/lib/db.js';
import { config } from '../src/config.js';

// [id, name, responsable_label, default_user_id, default_user_name, is_default_for_label, notes]
// VALIDAR (string) → null en user_id; el daemon caerá al default del .env.
const GROUPS = [
  // DTIC — ambos grupos usan código 0 según la tabla original (probable typo en fuente).
  //   Mantengo la fila con id=0 y comentario; si la fuente tiene IDs distintos, ajustar manualmente.
  [0,  'Grupo clasificación tickets DTIC',  'Ministerio de Hacienda - DTIC', 0, 'Randall Hernández Solano', 1, 'Default DTIC. Mismo id que "Administrador Mesa Soporte DTIC" — fuente lista ambos como 0/N-A.'],

  // DGA
  [60, 'Grupo clasificación tickets DGA',   'Ministerio de Hacienda - DGA', 2540639, 'Ana Cecilia Barquero Salas', 1, 'Default DGA.'],
  [61, 'Administrador Mesa Soporte DGA',    'Ministerio de Hacienda - DGA', 2540639, 'Ana Cecilia Barquero Salas', 0, null],
  [62, 'Equipo Interoperabilidad',          'Ministerio de Hacienda - DGA', 2540640, 'Seldyi Maria Canales Vanegas', 0, 'Alterno: 2540641 Sindy Alvarez, 2540642 Walter Allen Jones.'],

  // DGA -DGT (3 grupos)
  [63, 'DGT - Procesos Aduaneros',          'Ministerio de Hacienda - DGA -DGT', 2540643, 'Lilliana Ureña Solís', 1, 'Default DGT.'],
  [64, 'DGT-Técnica Aduanera',              'Ministerio de Hacienda - DGA -DGT', 2540662, 'Minor Pamillo Agüero', 0, null],
  [65, 'DGT-Estadística y Registro',        'Ministerio de Hacienda - DGA -DGT', 2540675, 'Carlos Eduardo Villalobos Solis', 0, null],

  // DGA -DGR
  [66, 'DGR - Análisis de Riesgo',          'Ministerio de Hacienda - DGA -DGR', 2540688, 'Anabelle Masis Araya', 1, 'Default DGR.'],

  // Aduanas — Jefe Sección Técnica
  [67, 'Jefe Sección Técnica Aduana Caldera',     'Ministerio de Hacienda - Aduanas', 2540697, 'Roberto Soto Soto', 1, 'Default Aduanas (primer grupo Caldera).'],
  [68, 'Jefe Sección Técnica Aduana Limón',       'Ministerio de Hacienda - Aduanas', 2540698, 'Adrian Perez Edwards', 0, null],
  [69, 'Jefe Sección Técnica Aduana La Anexión',  'Ministerio de Hacienda - Aduanas', 2540699, 'Anthony Soto Guzmán', 0, null],
  [70, 'Jefe Sección Técnica Aduana Santamaría',  'Ministerio de Hacienda - Aduanas', 2540700, 'Liana Berrocal Rodriguez', 0, null],

  // Aduanas — Sección Técnica Aprobación LPCO
  [72, 'Sección Técnica - Aprobación LPCO Aduana Caldera',    'Ministerio de Hacienda - Aduanas', null,    'Jorge Luis Zamora Alvarado', 0, 'User id pendiente de validar (VALIDAR en fuente).'],
  [73, 'Sección Técnica - Aprobación LPCO Aduana Limón',      'Ministerio de Hacienda - Aduanas', 2540727, 'Jannida Fiorella Diaz Jimenez', 0, null],
  [74, 'Sección Técnica - Aprobación LPCO Aduana La Anexión', 'Ministerio de Hacienda - Aduanas', 2540734, 'Warren Chavarría Barrantes', 0, null],
  [75, 'Sección Técnica - Aprobación LPCO Aduana Santamaría', 'Ministerio de Hacienda - Aduanas', 2540810, 'Kenner Alberto Arrieta Zamora', 0, null],
  [76, 'Sección Técnica - Aprobación LPCO Aduana Central',    'Ministerio de Hacienda - Aduanas', 2540742, 'Fabiola Vanessa Vargas Hernandez', 0, null],

  // Aduanas — Sección Depósito
  [77, 'Sección Depósito Aduana Caldera',     'Ministerio de Hacienda - Aduanas', 2540748, 'Gaudy Nacira Castillo Ugalde', 0, null],
  [78, 'Sección Depósito Aduana Limón',       'Ministerio de Hacienda - Aduanas', 2540749, 'Juan Ramon Arias Calvo', 0, null],
  [79, 'Sección Depósito Aduana La Anexión',  'Ministerio de Hacienda - Aduanas', null,    'Anthony Soto Guzmán', 0, 'User id pendiente de validar (VALIDAR en fuente).'],
  [80, 'Sección Depósito Aduana Santamaría',  'Ministerio de Hacienda - Aduanas', 2540775, 'Clareth Nathalia Arias Fernández', 0, null],
  [81, 'Sección Depósito Aduana Central',     'Ministerio de Hacienda - Aduanas', 2540776, 'Jonatan Alfaro Chaves', 0, null]
];

async function main() {
  await initDB(config);
  const pool = getDB();

  for (const [id, name, label, uid, uname, isDefault, notes] of GROUPS) {
    await pool.query(
      `INSERT INTO aranda_groups (id, name, responsable_label, default_user_id, default_user_name, is_default_for_label, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name                 = VALUES(name),
         responsable_label    = VALUES(responsable_label),
         default_user_id      = VALUES(default_user_id),
         default_user_name    = VALUES(default_user_name),
         is_default_for_label = VALUES(is_default_for_label),
         notes                = VALUES(notes)`,
      [id, name, label, uid, uname, isDefault, notes]
    );
  }

  const [[{ total }]]     = await pool.query(`SELECT COUNT(*) AS total FROM aranda_groups`);
  const [[{ defaults }]]  = await pool.query(`SELECT COUNT(*) AS defaults FROM aranda_groups WHERE is_default_for_label = 1`);
  console.log(JSON.stringify({ ok: true, upserted: GROUPS.length, total_groups: Number(total), defaults_per_label: Number(defaults) }));

  await closeDB();
}

main().catch(err => { console.error(err); process.exit(1); });
