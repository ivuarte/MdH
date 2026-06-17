// Backfill: lee urgency/impact/priority de GLPI para todos los tickets mapeados activos
// y los guarda en la tabla tickets. Útil después de aplicar la migración 006 o cuando
// se quiere refrescar el cache local sin esperar a que /Log capture cambios.
import { config, validateConfig } from '../src/config.js';
import { initDB, getDB, closeDB } from '../src/lib/db.js';
import { glpiClient } from '../src/lib/glpiClient.js';

validateConfig();
await initDB(config);

const [tickets] = await getDB().query(
  `SELECT t.id FROM tickets t JOIN aranda_items ai ON ai.ticket_id=t.id
    WHERE ai.status='synced'
      AND (t.urgency IS NULL OR t.impact IS NULL OR t.priority IS NULL)
    ORDER BY t.id DESC LIMIT 200`
);
console.log(`Backfill de ${tickets.length} tickets...\n`);

let ok = 0, err = 0;
for (const t of tickets) {
  try {
    const got = await glpiClient.getTicket(t.id);
    const obj = Array.isArray(got) ? got[0] : got;
    const u = Number(obj?.urgency)  || null;
    const i = Number(obj?.impact)   || null;
    const p = Number(obj?.priority) || null;
    await getDB().query(
      `UPDATE tickets SET urgency=?, impact=?, priority=? WHERE id=?`,
      [u, i, p, t.id]
    );
    ok++;
    if (ok % 20 === 0) console.log(`  ${ok}/${tickets.length} (último ticket=${t.id} urg=${u} imp=${i} pri=${p})`);
  } catch (e) {
    err++;
  }
}
console.log(`\nListo: ${ok} actualizados, ${err} errores.`);

await closeDB();
process.exit(0);
