// Consulta el estado del item via /item/list filtrando por Id, ya que /item/{id}/{seg} da 404.
import { config, validateConfig } from '../src/config.js';
import { initDB, closeDB } from '../src/lib/db.js';
import { arandaClient } from '../src/lib/arandaClient.js';

validateConfig();
await initDB(config);

const itemId = Number(process.argv[2] || 369548);
console.log(`Buscando item ${itemId} via /item/list\n`);

try {
  // Barrido general filtrado por AuthorId del bot (mismo filtro que statusSync.pullArandaToGlpi)
  {
    const body2 = {
      Paging: { Start: 1, End: 500, Size: 0 },
      Criteria: [
        { FieldName: 'AuthorId', Value: String(config.ARANDA_AUTHOR_ID), LogicOperatorId: 1, ComparisonOperatorId: 5 }
      ],
      WhereCriteria: [],
      Order: { ColumnName: 'RegistrationDate', ModeId: 2 },
      ProjectId: config.ARANDA_PROJECT_ID,
      ViewId: 5
    };
    const res2 = await arandaClient.listItems(body2);
    const match = (res2?.Data || []).find(d => Number(d?.Id) === itemId);
    if (match) {
      console.log(`Item ${itemId} encontrado:`);
      const keys = ['Id', 'ComposedId', 'CaseType', 'StateId', 'StatusId', 'Status', 'AuthorName', 'CustomerName'];
      for (const k of keys) if (k in match) console.log(`  ${k}: ${JSON.stringify(match[k])}`);
    } else {
      console.log(`Item ${itemId} NO encontrado en ${(res2?.Data || []).length} resultados`);
      // Mostrar los primeros 5 Ids para diagnóstico
      const ids = (res2?.Data || []).slice(0, 5).map(d => `${d.Id} (${d.ComposedId})`);
      console.log(`Primeros 5 ids: ${ids.join(', ')}`);
    }
  }
} catch (err) {
  console.log(`ERROR ${err?.response?.status}: ${err.message}`);
}

await closeDB();
process.exit(0);
