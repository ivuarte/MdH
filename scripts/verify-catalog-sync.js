import 'dotenv/config';
import { initDB, getDB, closeDB } from '../src/lib/db.js';
import { config } from '../src/config.js';
import { glpiClient } from '../src/lib/glpiClient.js';

await initDB(config);
const pool = getDB();
const [counts] = await pool.query(`SELECT COUNT(*) total FROM service_catalog_sync WHERE status='matched'`);
const [bySegment] = await pool.query(`SELECT aranda_segment, COUNT(*) n FROM service_catalog_sync WHERE status='matched' GROUP BY aranda_segment`);
const [byStrat] = await pool.query(`SELECT match_strategy, COUNT(*) n FROM service_catalog_sync WHERE status='matched' GROUP BY match_strategy`);
const [newSubs] = await pool.query(`SELECT aranda_category_id, glpi_category_id, aranda_segment, responsable_label FROM service_catalog_sync WHERE aranda_category_id IN (824,870,871,872,873,874,876,877,880,882,883,885,886,887,889,890,891,892,893,894,895,896,905,906,908) ORDER BY aranda_category_id`);
console.log('Total matched:', counts[0].total);
console.log('Por segment:', bySegment);
console.log('Por strategy:', byStrat);
console.log('25 nuevos subs:');
console.table(newSubs);

await glpiClient.ensureSession();
const headers = { 'Session-Token': glpiClient.sessionToken, 'App-Token': config.APP_TOKEN };
let all = [];
for (let s = 0; ; s += 100) {
  const rr = await glpiClient.http.get('/ITILCategory', { headers, params: { range: `${s}-${s+99}` } });
  const arr = Array.isArray(rr.data) ? rr.data : [];
  if (!arr.length) break;
  all = all.concat(arr);
  if (arr.length < 100) break;
}
const directKids = all.filter(c => Number(c.itilcategories_id) === 658);
console.log(`\nHijos directos de MDH (658): ${directKids.length}`);
for (const c of directKids) {
  const grandkids = all.filter(g => Number(g.itilcategories_id) === Number(c.id)).length;
  console.log(`  ${c.id} ${c.name} [${grandkids} subs]`);
}
await closeDB();
