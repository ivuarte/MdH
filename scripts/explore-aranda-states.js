// Explora estados de items Aranda para descubrir los StateId disponibles.
// Imprime el detalle completo del item (todos sus campos) y la lista de notas/eventos
// para deducir qué StateId corresponde a cada estado lógico (Proceso, En espera, Resuelto, Cerrado).
import 'dotenv/config';
import { arandaClient } from '../src/lib/arandaClient.js';

const ITEMS = [
  { id: 369472, seg: 1, hint: '42586 (esperado: resuelto/cerrado en GLPI status=6)' },
  { id: 368801, seg: 1, hint: '42558 (referencia previa)' }
];

function tsFromMs(s) {
  if (!s || typeof s !== 'string') return s;
  const m = s.match(/\/Date\((\d+)[+-]\d+\)\//);
  return m ? new Date(Number(m[1])).toISOString() : s;
}

async function describe(itemId, seg, hint) {
  console.log(`\n========== Item ${itemId} seg=${seg} (${hint}) ==========`);
  let detail;
  try {
    detail = await arandaClient.getItemDetail(itemId, seg);
  } catch (e) {
    console.log(`  getItemDetail ERROR seg=${seg}: ${e.message}`);
    const altSeg = seg === 1 ? 4 : 1;
    try {
      detail = await arandaClient.getItemDetail(itemId, altSeg);
      seg = altSeg;
    } catch (e2) {
      console.log(`  Tambien fallo seg=${altSeg}: ${e2.message}`);
      return;
    }
  }

  // detail puede ser un array de {Field, Value} o un objeto plano
  const flat = {};
  if (Array.isArray(detail)) {
    for (const f of detail) flat[f.Field || f.field] = f.Value ?? f.value;
  } else if (typeof detail === 'object' && detail !== null) {
    Object.assign(flat, detail);
  }

  console.log('  Campos relevantes:');
  for (const k of Object.keys(flat).sort()) {
    const v = flat[k];
    if (v == null) continue;
    if (/State|Status|Reason|Closed|Stage/i.test(k)) {
      console.log(`    ${k}: ${JSON.stringify(v)}`);
    }
  }

  // historial: cambios de estado tienen ActionType=4 con descripción tipo "Estado: X => Y"
  try {
    const notes = await arandaClient.getItemNoteList(itemId, seg);
    const stateChanges = notes.filter(n =>
      /estado|state/i.test(String(n.Description || '')) || n.ActionType === 4
    );
    console.log(`\n  Cambios de estado / modificaciones (${stateChanges.length}):`);
    for (const n of stateChanges) {
      const ts = tsFromMs(n.CreationDate);
      const desc = String(n.Description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 250);
      console.log(`    [${ts}] type=${n.ActionType} ${n.ActionName} by ${n.AuthorName}`);
      if (desc) console.log(`       ${desc}`);
    }
  } catch (e) {
    console.log(`  getItemNoteList ERROR: ${e.message}`);
  }
}

async function tryListStates() {
  console.log('\n========== Intentar endpoints de catálogo de estados ==========');
  // Endpoints comunes en Aranda — probemos varios
  const paths = [
    '/state/list',
    '/state/list/1',
    '/states',
    '/projectstate/list/1',
    '/project/1/states',
    '/itemtype/state/list/1',
    '/itemstate/list/1',
    '/case/state/list',
    '/state'
  ];
  for (const p of paths) {
    try {
      const res = await arandaClient.get(p);
      console.log(`  ${p}: OK`);
      console.log('    ', JSON.stringify(res).slice(0, 800));
    } catch (e) {
      const s = e?.response?.status;
      console.log(`  ${p}: ${s || 'ERR'} ${e.message?.slice(0, 80)}`);
    }
  }
}

async function main() {
  await arandaClient.ensureLogin();
  for (const it of ITEMS) {
    await describe(it.id, it.seg, it.hint);
  }
  await tryListStates();
}

main().catch(e => { console.error(e); process.exit(1); });
