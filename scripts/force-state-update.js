// Prueba directa: POST /item/update para llevar 369548 a StateId=21 (Resuelto).
import { config, validateConfig } from '../src/config.js';
import { initDB, closeDB } from '../src/lib/db.js';
import { arandaClient } from '../src/lib/arandaClient.js';

validateConfig();
await initDB(config);

const itemId = Number(process.argv[2] || 369548);
const segment = Number(process.argv[3] || 4);
const stateId = Number(process.argv[4] || 21);
const reasonId = Number(process.argv[5] || 10);

console.log(`Item ${itemId} seg=${segment} → StateId=${stateId} ReasonId=${reasonId}\n`);

const fields = [
  { Field: 'StateId', Value: stateId },
  { Field: 'ReasonId', Value: reasonId },
  { Field: 'Commentary', Value: 'Test directo: pasar a Resuelto' }
];

try {
  const res = await arandaClient.updateItem(itemId, segment, config.ARANDA_AUTHOR_ID, fields);
  console.log('Respuesta:', JSON.stringify(res, null, 2));
} catch (err) {
  console.log(`ERROR ${err?.response?.status}: ${err.message}`);
  if (err?.response?.data) console.log(JSON.stringify(err.response.data).slice(0, 1000));
}

await closeDB();
process.exit(0);
