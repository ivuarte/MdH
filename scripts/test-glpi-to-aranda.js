// Test E2E: añade un followup en GLPI 42558 directamente vía API y espera a que el daemon lo propague a Aranda.
// Marca el contenido con un identificador único para encontrarlo después.
import 'dotenv/config';
import { glpiClient } from '../src/lib/glpiClient.js';

const TICKET = 42558;
const STAMP = `e2e-${Date.now()}`;
const CONTENT = `<p>Prueba E2E ${STAMP}: este followup debe aparecer en Aranda como nota.</p>`;

async function main() {
  await glpiClient.ensureSession();
  console.log(`Creando followup en GLPI ${TICKET} con stamp=${STAMP}`);
  const res = await glpiClient.addFollowup(TICKET, CONTENT);
  console.log('Resultado:', JSON.stringify(res));
  let fupId = null;
  if (Array.isArray(res)) fupId = res[0]?.id;
  else if (res && typeof res === 'object') fupId = res.id;
  console.log(`Followup creado: id=${fupId}, stamp=${STAMP}`);
  console.log(`\nPara verificar manualmente:`);
  console.log(`  grep "${STAMP}" /tmp/mdh-run.log`);
  console.log(`  o consulta /item/368801/1/note/list en Aranda y busca "${STAMP}"`);
}

main().catch(e => { console.error(e); process.exit(1); });
