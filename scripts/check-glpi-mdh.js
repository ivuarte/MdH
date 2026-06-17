// Diagnóstico: estructura real GLPI vs lo que decía CATALOGO.md.
import 'dotenv/config';
import { glpiClient } from '../src/lib/glpiClient.js';
import { config } from '../src/config.js';

async function main() {
  await glpiClient.ensureSession();
  const headers = { 'Session-Token': glpiClient.sessionToken, 'App-Token': config.APP_TOKEN };

  let all = [];
  for (let start = 0; ; start += 100) {
    const r = await glpiClient.http.get('/ITILCategory', { headers, params: { range: `${start}-${start + 99}` } });
    const arr = Array.isArray(r.data) ? r.data : [];
    if (!arr.length) break;
    all = all.concat(arr);
    if (arr.length < 100) break;
  }
  const byId = new Map(all.map(c => [Number(c.id), c]));

  // ¿Quiénes apuntan a 658 como padre?
  const childrenOf658 = all.filter(c => Number(c.itilcategories_id) === 658).map(c => c.id);
  console.log('hijos directos de 658:', childrenOf658.length, childrenOf658.slice(0, 20));

  // Las categorías nivel 1 que CATALOGO.md decía hijas de MDH
  const expectedKids = [659, 662, 664, 668, 671, 673, 679, 682, 683, 684, 696, 709, 712];
  console.log('Categorías "nivel 1 esperadas" — estado real:');
  for (const id of expectedKids) {
    const c = byId.get(id);
    if (!c) { console.log(`  ${id}: NO EXISTE`); continue; }
    console.log(`  ${id} parent=${c.itilcategories_id} level=${c.level} name="${c.name}"`);
  }

  // Algunas subcategorías
  console.log('\nAlgunas subcategorías que el bot mapea:');
  for (const id of [660, 661, 680, 681, 665, 666, 706, 685]) {
    const c = byId.get(id);
    if (!c) { console.log(`  ${id}: NO EXISTE`); continue; }
    console.log(`  ${id} parent=${c.itilcategories_id} level=${c.level} completename="${c.completename}"`);
  }

  // Resumen: cuántas categorías tienen "MDH" en completename
  const mdhCount = all.filter(c => c.completename.includes('MDH')).length;
  console.log(`\nCategorías con "MDH" en completename: ${mdhCount} / ${all.length}`);

  // Categorías que el bot referencia en seed (52 ids GLPI)
  const seedIds = [680,681,660,661,687,688,689,690,691,692,693,694,695,663,702,703,704,705,665,666,667,676,677,678,706,707,708,669,670,672,674,697,698,699,700,701,710,711,713,714,715,716,717,718,719,720,721,722,723,724,725,685];
  let missing = 0, total = 0;
  for (const id of seedIds) { total++; if (!byId.has(id)) missing++; }
  console.log(`\nseed_catalog.js (${total} ids GLPI) — faltantes en GLPI: ${missing}`);
}
main().catch(e => { console.error('ERR', e.response?.data ?? e.message); process.exit(1); });
