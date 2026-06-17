// Verificación final del caso 42558 / aranda 368801: comprobar que ambos lados son espejo.
import 'dotenv/config';
import { arandaClient } from '../src/lib/arandaClient.js';
import { glpiClient } from '../src/lib/glpiClient.js';

const TICKET = 42558;
const ARANDA = 368801;
const SEG = 1;

function tsFromMs(s) {
  if (!s || typeof s !== 'string') return s;
  const m = s.match(/\/Date\((\d+)[+-]\d+\)\//);
  return m ? new Date(Number(m[1])).toISOString() : s;
}

async function main() {
  await glpiClient.ensureSession();
  await arandaClient.ensureLogin();

  console.log(`\n=== GLPI ticket ${TICKET} ===`);
  const ticket = await glpiClient.getTicket(TICKET);
  console.log('  name:', ticket.name, 'status:', ticket.status, 'type:', ticket.type);

  const fups = await glpiClient.getTicketFollowups(TICKET);
  console.log(`\n  ITILFollowup (${fups.length}):`);
  for (const f of fups) {
    console.log(`    [${f.date}] id=${f.id} user=${f.users_id}`);
    console.log(`       ${String(f.content).slice(0, 120).replace(/\n/g, ' ↵ ')}`);
  }

  const tasks = await glpiClient.getTicketTasks(TICKET);
  console.log(`\n  TicketTask (${tasks.length}):`);
  for (const t of tasks) {
    console.log(`    [${t.date}] id=${t.id} user=${t.users_id} state=${t.state}`);
    console.log(`       ${String(t.content).slice(0, 120).replace(/\n/g, ' ↵ ')}`);
  }

  console.log(`\n=== ARANDA item ${ARANDA} (segment ${SEG}) ===`);
  const notes = await arandaClient.getItemNoteList(ARANDA, SEG);
  const sorted = [...notes].sort((a, b) => {
    const da = tsFromMs(a.CreationDate);
    const db = tsFromMs(b.CreationDate);
    return da < db ? -1 : 1;
  });
  console.log(`  Entries totales (${notes.length}):`);
  for (const n of sorted) {
    const ts = tsFromMs(n.CreationDate);
    console.log(`    [${ts}] ${n.ActionName} (type=${n.ActionType}) by ${n.AuthorName}`);
    const desc = String(n.Description || '').replace(/<[^>]+>/g, '').replace(/\n/g, ' ↵ ').slice(0, 200);
    if (desc) console.log(`       ${desc}`);
  }

  console.log('\n=== Resumen ===');
  console.log(`GLPI:  ${fups.length} followups + ${tasks.length} tasks`);
  console.log(`ARANDA: ${notes.filter(n => n.ActionType === 16).length} notas + ${notes.filter(n => n.ActionType === 22).length} tareas`);

  // Comparación: GLPI vs Aranda
  const arandaNotes = notes.filter(n => n.ActionType === 16);
  const arandaTasks = notes.filter(n => n.ActionType === 22);
  console.log('\nNotas Aranda creadas por Atena_GLPI (vinieron de followups GLPI):');
  for (const n of arandaNotes.filter(x => x.AuthorName === 'Atena_GLPI')) {
    const ts = tsFromMs(n.CreationDate);
    console.log(`  - [${ts}] ${String(n.Description).slice(0, 100)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
