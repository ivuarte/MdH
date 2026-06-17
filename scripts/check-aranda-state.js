// Consulta directa a Aranda: estado actual del item RF-369548-1-168601 (aranda_item_id=369548).
import { config, validateConfig } from '../src/config.js';
import { initDB, closeDB } from '../src/lib/db.js';
import { arandaClient } from '../src/lib/arandaClient.js';

validateConfig();
await initDB(config);

const itemId = Number(process.argv[2] || 369548);
const segment = Number(process.argv[3] || 4);

console.log(`Consultando Aranda item=${itemId} segment=${segment}\n`);

try {
  const detail = await arandaClient.getItemDetail(itemId, segment);
  console.log('Detail (campos relevantes):');
  const keys = ['Id', 'CaseType', 'ProjectItemTypeId', 'StateId', 'Status', 'StatusId', 'ReasonId', 'AuthorId', 'AuthorName', 'ComposedId', 'CategoryId', 'ServiceId'];
  if (Array.isArray(detail)) {
    const obj = {};
    for (const it of detail) if (it?.Field) obj[it.Field] = it.Value;
    for (const k of keys) if (k in obj) console.log(`  ${k}: ${JSON.stringify(obj[k])}`);
    console.log('\nTodos los campos:');
    for (const [k, v] of Object.entries(obj)) console.log(`  ${k}: ${JSON.stringify(v).slice(0,120)}`);
  } else if (detail && typeof detail === 'object') {
    for (const k of keys) if (k in detail) console.log(`  ${k}: ${JSON.stringify(detail[k])}`);
  } else {
    console.log(JSON.stringify(detail, null, 2).slice(0, 2000));
  }
} catch (err) {
  console.log(`ERROR ${err?.response?.status}: ${err.message}`);
  if (err?.response?.data) console.log(JSON.stringify(err.response.data).slice(0, 500));
}

await closeDB();
process.exit(0);
