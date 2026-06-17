// Inspecciona note/list de los 30 items Aranda más recientes y reporta:
//  - Entries con ActionType=22 (tareas)
//  - Si ya están en aranda_inbound_tasks (=sincronizadas) o no
import { config, validateConfig } from '../src/config.js';
import { initDB, getDB, closeDB } from '../src/lib/db.js';
import { arandaClient } from '../src/lib/arandaClient.js';
import { sha256 } from '../src/lib/hash.js';

validateConfig();
await initDB(config);

const [items] = await getDB().query(
  `SELECT a.aranda_item_id, a.ticket_id, a.composed_item_id, t.type AS glpi_type, t.status AS glpi_status
     FROM aranda_items a JOIN tickets t ON t.id=a.ticket_id
    WHERE a.status='synced' AND a.aranda_item_id IS NOT NULL
    ORDER BY a.updated_at DESC LIMIT 200`
);

console.log(`Inspeccionando ${items.length} items Aranda más recientes...\n`);

let totalTasks = 0, syncedTasks = 0, pendingTasks = 0;
const pending = [];

for (const it of items) {
  const seg = Number(it.glpi_type) === 2 ? 4 : 1;
  let entries;
  try {
    entries = await arandaClient.getItemNoteList(it.aranda_item_id, seg);
  } catch (err) {
    if (err?.response?.status !== 404) {
      console.log(`  ${it.composed_item_id}: error ${err?.response?.status || err.message}`);
    }
    continue;
  }
  if (!Array.isArray(entries)) continue;

  const tasks = entries.filter(e => Number(e?.ActionType) === 22);
  if (tasks.length === 0) continue;

  for (const t of tasks) {
    totalTasks++;
    const entryId = `n:${it.aranda_item_id}:${sha256(`${t.AuthorName||''}|${t.CreationDate||''}|${t.Description||''}`)}`.slice(0, 128);
    const [[exists]] = await getDB().query(
      `SELECT status FROM aranda_inbound_tasks WHERE aranda_task_id=? LIMIT 1`, [entryId]
    );
    const isSelfAuthor = String(t.AuthorName||'').trim().toLowerCase() === String(config.ARANDA_USERNAME||'').trim().toLowerCase();
    // Log de TODAS las tareas para diagnóstico
    console.log(`  ${it.composed_item_id} aranda=${it.aranda_item_id} glpi=${it.ticket_id}: author='${t.AuthorName}' date='${t.CreationDate}' status=${exists?.status||'none'} self=${isSelfAuthor} desc='${String(t.Description||'').replace(/<[^>]+>/g,' ').slice(0,80).trim()}'`);
    if (exists?.status === 'synced') { syncedTasks++; }
    else if (isSelfAuthor) { /* anti-bucle propio */ }
    else {
      pendingTasks++;
      pending.push({
        composed: it.composed_item_id, aranda_id: it.aranda_item_id, glpi_ticket: it.ticket_id, glpi_status: it.glpi_status,
        author: t.AuthorName, date: t.CreationDate,
        desc: String(t.Description||'').slice(0, 150).replace(/<[^>]+>/g,' ').trim(),
        existsStatus: exists?.status || 'none', entryId
      });
    }
  }
}

console.log(`\nResumen: total=${totalTasks} sincronizadas=${syncedTasks} pendientes=${pendingTasks}\n`);
if (pending.length) {
  console.log('=== TAREAS PENDIENTES (autor != bot, NO en aranda_inbound_tasks) ===');
  for (const p of pending) console.log(JSON.stringify(p, null, 2));
}

await closeDB();
process.exit(0);
