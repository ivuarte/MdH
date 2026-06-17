// Verificación final del caso 42586 / aranda 369472:
// - Estado GLPI vs estado Aranda deben corresponder según el mapeo (GLPI 6 → Aranda 21 por permisos).
// - Tarea "prueba TAS DESDE GLPI" debe estar como nota [Tarea GLPI] en Aranda.
// - Notas / followups deben estar espejados.
import 'dotenv/config';
import { arandaClient } from '../src/lib/arandaClient.js';
import { glpiClient } from '../src/lib/glpiClient.js';

const TICKET = 42586;
const ARANDA = 369472;
const SEG = 4; // requerimiento (CaseType=4)

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
  console.log('  name:', ticket.name);
  console.log('  status:', ticket.status, '(1=Nuevo, 2=En curso, 3=Planif., 4=Espera, 5=Resuelto, 6=Cerrado)');
  console.log('  type:', ticket.type, '(1=Incidente, 2=Requerimiento)');

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

  // Estado actual vía listItems (porque getItemDetail suele dar 404 con Atena_GLPI)
  const body = {
    Paging: { Start: 1, End: 50, Size: 0 },
    Criteria: [{ FieldName: 'AuthorId', Value: '2314762', LogicOperatorId: 1, ComparisonOperatorId: 5 }],
    WhereCriteria: [],
    Order: { ColumnName: 'RegistrationDate', ModeId: 2 },
    ProjectId: 1,
    ViewId: 5
  };
  const list = await arandaClient.listItems(body);
  const item = (list.Data || []).find(d => Number(d.Id) === ARANDA);
  if (item) {
    console.log('  StateId:', item.StateId, '(' + item.StateName + ')');
    console.log('  ReasonId:', item.ReasonId, '(' + item.ReasonName + ')');
    console.log('  IsClosed:', item.IsClosed);
    console.log('  CaseType:', item.CaseType, '(1=IM, 4=RF)');
    console.log('  ComposedId:', item.ComposedId);
  } else {
    console.log('  (item no aparece en listItems para AuthorId=2314762)');
  }

  const notes = await arandaClient.getItemNoteList(ARANDA, SEG);
  const sorted = [...notes].sort((a, b) => {
    const da = tsFromMs(a.CreationDate);
    const db = tsFromMs(b.CreationDate);
    return da < db ? -1 : 1;
  });
  console.log(`\n  Entries totales (${notes.length}):`);
  for (const n of sorted) {
    const ts = tsFromMs(n.CreationDate);
    console.log(`    [${ts}] ${n.ActionName} (type=${n.ActionType}) by ${n.AuthorName}`);
    const desc = String(n.Description || '').replace(/<[^>]+>/g, '').replace(/\n/g, ' ↵ ').slice(0, 200);
    if (desc) console.log(`       ${desc}`);
  }

  console.log('\n=== Resumen ===');
  console.log(`GLPI:   status=${ticket.status} | ${fups.length} followups | ${tasks.length} tasks`);
  if (item) console.log(`ARANDA: StateId=${item.StateId} (${item.StateName})`);
  const arandaNotes = notes.filter(n => n.ActionType === 16);
  const arandaTasks = notes.filter(n => n.ActionType === 22);
  console.log(`ARANDA: ${arandaNotes.length} notas + ${arandaTasks.length} tareas (entries)`);

  // Validación
  console.log('\n=== Validación ===');
  const expectedAranda = ticket.status === 6 || ticket.status === '6' ? 21 : null;
  if (expectedAranda && item) {
    if (Number(item.StateId) === expectedAranda) {
      console.log(`  [OK] Mapeo de estado GLPI ${ticket.status} → Aranda ${item.StateId} (Resuelto)`);
      console.log(`       Nota: GLPI 6 (Cerrado) se mapea a Aranda 21 porque Atena_GLPI no tiene permiso para Cerrar formalmente (403 UnauthorizedCaseClosure).`);
    } else {
      console.log(`  [FAIL] Esperado Aranda StateId=${expectedAranda}, actual=${item.StateId}`);
    }
  }
  // Tareas
  const taskMatched = arandaNotes.find(n => /\[Tarea GLPI\]/.test(String(n.Description||'')));
  if (taskMatched) {
    console.log(`  [OK] Tarea GLPI presente como nota en Aranda: ${String(taskMatched.Description).replace(/<[^>]+>/g,'').slice(0,80)}`);
  } else {
    console.log(`  [FAIL] No se encontró la tarea [Tarea GLPI] en las notas de Aranda`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
