#!/usr/bin/env node
// Diagnóstico READ-ONLY: lee el StateId real de los items Aranda creados por el bot,
// usando el MISMO listItems que statusSync.pullArandaToGlpi.
// Uso: node scripts/diag-aranda-state.js
import 'dotenv/config';
import { arandaClient } from '../src/lib/arandaClient.js';
import { config } from '../src/config.js';

const body = {
  Paging: { Start: 1, End: config.ARANDA_PULL_PAGE_SIZE, Size: 0 },
  Criteria: [
    { FieldName: 'AuthorId', Value: String(config.ARANDA_AUTHOR_ID), LogicOperatorId: 1, ComparisonOperatorId: 5 }
  ],
  WhereCriteria: [],
  Order: { ColumnName: 'RegistrationDate', ModeId: 2 },
  ProjectId: config.ARANDA_PROJECT_ID,
  ViewId: 5
};

const res = await arandaClient.listItems(body);
const data = res?.Data ?? [];
console.log(`Items del bot: ${data.length}\n`);
console.log('ItemId    StateId  StateName                  CategoryId  Subject');
for (const it of data.slice(0, 30)) {
  const sn = it.StateName ?? it.State ?? '';
  console.log(
    `${String(it.Id).padEnd(9)} ${String(it.StateId).padEnd(8)} ${String(sn).padEnd(26)} ${String(it.CategoryId ?? '').padEnd(11)} ${String(it.Subject ?? '').slice(0, 40)}`
  );
}
process.exit(0);
