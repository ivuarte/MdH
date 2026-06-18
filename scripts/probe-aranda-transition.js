#!/usr/bin/env node
// PROBE: intenta una transición de estado en Aranda y RELEE el estado real para ver
// si la transición se aplicó. Captura la respuesta cruda de /item/update.
// Uso: node scripts/probe-aranda-transition.js <itemId> <segment> <StateId> <ReasonId>
import 'dotenv/config';
import { arandaClient } from '../src/lib/arandaClient.js';
import { config } from '../src/config.js';

const itemId = Number(process.argv[2]);
const segment = Number(process.argv[3] || 1);
const stateId = Number(process.argv[4]);
const reasonId = Number(process.argv[5]);
if (!itemId || !stateId) { console.error('Uso: <itemId> <segment> <StateId> <ReasonId>'); process.exit(1); }

async function readState(id) {
  const res = await arandaClient.listItems({
    Paging: { Start: 1, End: config.ARANDA_PULL_PAGE_SIZE, Size: 0 },
    Criteria: [{ FieldName: 'AuthorId', Value: String(config.ARANDA_AUTHOR_ID), LogicOperatorId: 1, ComparisonOperatorId: 5 }],
    WhereCriteria: [], Order: { ColumnName: 'RegistrationDate', ModeId: 2 },
    ProjectId: config.ARANDA_PROJECT_ID, ViewId: 5
  });
  const it = (res?.Data ?? []).find(x => Number(x.Id) === id);
  return it ? { StateId: it.StateId, StateName: it.StateName ?? it.State } : null;
}

console.log('ANTES:', JSON.stringify(await readState(itemId)));

const fields = [
  { Field: 'StateId', Value: stateId },
  { Field: 'ReasonId', Value: reasonId },
  { Field: 'Commentary', Value: `Probe transición → StateId=${stateId} (${new Date().toISOString()})` }
];
console.log('Enviando updateItem', { itemId, segment, fields });
try {
  const raw = await arandaClient.updateItem(itemId, segment, config.ARANDA_AUTHOR_ID, fields);
  console.log('RESPUESTA cruda:', JSON.stringify(raw));
} catch (e) {
  console.log('ERROR update:', e?.response?.status, String(e?.response?.data || e.message).slice(0, 300));
}

// pequeña espera para que Aranda procese
await new Promise(r => setTimeout(r, 1500));
console.log('DESPUÉS:', JSON.stringify(await readState(itemId)));
process.exit(0);
