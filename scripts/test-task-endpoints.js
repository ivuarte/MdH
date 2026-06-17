// Explora si existen endpoints de Aranda para crear tareas reales (no como notas).
import { config, validateConfig } from '../src/config.js';
import { initDB, closeDB } from '../src/lib/db.js';
import { arandaClient } from '../src/lib/arandaClient.js';

validateConfig();
await initDB(config);

const itemId = 369548;
const segment = 4;
const userId = config.ARANDA_AUTHOR_ID;

const attempts = [
  { method: 'POST', path: `/item/${itemId}/${segment}/task`, body: { Description: 'TEST tarea via /task', Title: 'Test' } },
  { method: 'POST', path: `/casetask`, body: [{Field:'ItemId', Value: itemId},{Field:'CaseType', Value: segment},{Field:'Description', Value: 'TEST'}] },
  { method: 'POST', path: `/item/${itemId}/${segment}/casetask`, body: { Description: 'TEST' } },
  { method: 'GET',  path: `/item/${itemId}/${segment}/task/list`, body: null },
  { method: 'GET',  path: `/casetask/list`, body: null },
  { method: 'POST', path: `/item/${itemId}/${segment}/action/22`, body: { Description: 'TEST tarea via action 22' } },
];

for (const a of attempts) {
  try {
    const res = a.body ? await arandaClient.post(a.path, a.body) : await arandaClient.get(a.path);
    console.log(`${a.method} ${a.path} → OK`);
    console.log(`  body resp: ${JSON.stringify(res).slice(0, 200)}`);
  } catch (err) {
    console.log(`${a.method} ${a.path} → ${err?.response?.status} ${String(err?.response?.data || err.message).slice(0, 100)}`);
  }
}

await closeDB();
process.exit(0);
