#!/usr/bin/env node
// Rellena tickets.itilcategories_id leyendo /Ticket/{id} (sin expand) en GLPI.
// Usar UNA VEZ tras aplicar migrations/007_catalog_sync.sql.

import 'dotenv/config';
import { initDB, getDB, closeDB } from '../src/lib/db.js';
import { config, validateConfig } from '../src/config.js';
import { glpiClient } from '../src/lib/glpiClient.js';

async function main() {
  validateConfig();
  await initDB(config);
  const pool = getDB();

  const [rows] = await pool.query(
    `SELECT id FROM tickets
      WHERE origin = 'GLPI' AND itilcategories_id IS NULL
      ORDER BY id ASC`
  );
  console.log(`tickets a procesar: ${rows.length}`);

  let updated = 0;
  let errors = 0;
  for (const { id } of rows) {
    try {
      const t = await glpiClient.getTicketRaw(id);
      const cat = Number(t?.itilcategories_id);
      if (Number.isFinite(cat) && cat > 0) {
        await pool.query(`UPDATE tickets SET itilcategories_id = ? WHERE id = ?`, [cat, id]);
        updated++;
      }
    } catch (err) {
      errors++;
      console.error(`ticket ${id}: ${err.message}`);
    }
  }

  console.log(JSON.stringify({ ok: true, processed: rows.length, updated, errors }));
  await closeDB();
}

main().catch(err => { console.error(err); process.exit(1); });
