// Explora los campos de impacto/prioridad/urgencia en GLPI y Aranda.
import { config, validateConfig } from '../src/config.js';
import { initDB, closeDB } from '../src/lib/db.js';
import { glpiClient } from '../src/lib/glpiClient.js';
import { arandaClient } from '../src/lib/arandaClient.js';

validateConfig();
await initDB(config);

console.log('=== GLPI: campos urgency/impact/priority de un ticket ===');
try {
  const t = await glpiClient.getTicket(42683);
  const obj = Array.isArray(t) ? t[0] : t;
  const keys = ['id','name','urgency','impact','priority','urgency_name','impact_name','priority_name'];
  for (const k of keys) if (k in obj) console.log(`  ${k}: ${JSON.stringify(obj[k])}`);
} catch (err) {
  console.log(`  ERROR: ${err?.response?.status} ${err.message}`);
}

console.log('\n=== ARANDA: items con valores Urgency/Impact/Priority ===');
try {
  const body = {
    Paging: { Start: 1, End: 5, Size: 0 },
    Criteria: [{ FieldName: 'AuthorId', Value: String(config.ARANDA_AUTHOR_ID), LogicOperatorId: 1, ComparisonOperatorId: 5 }],
    WhereCriteria: [],
    Order: { ColumnName: 'RegistrationDate', ModeId: 2 },
    ProjectId: config.ARANDA_PROJECT_ID,
    ViewId: 5
  };
  const res = await arandaClient.listItems(body);
  const data = res?.Data || [];
  if (data.length === 0) { console.log('  no items'); }
  for (const d of data.slice(0,3)) {
    console.log(`  Item ${d.Id} (${d.ComposedId}):`);
    const keys = ['UrgencyId','UrgencyName','ImpactId','ImpactName','PriorityId','PriorityName','Urgency','Impact','Priority'];
    for (const k of keys) if (k in d) console.log(`    ${k}: ${JSON.stringify(d[k])}`);
  }
}
catch (err) { console.log(`  ERROR: ${err?.response?.status} ${err.message}`); }

console.log('\n=== ARANDA: endpoint /urgency/list ===');
for (const p of ['/urgency/list','/impact/list','/priority/list','/Urgency/list','/Impact/list','/Priority/list']) {
  try {
    const res = await arandaClient.get(p);
    console.log(`  ${p}: ${JSON.stringify(res).slice(0, 300)}`);
  } catch (err) {
    console.log(`  ${p}: ${err?.response?.status}`);
  }
}

await closeDB();
process.exit(0);
