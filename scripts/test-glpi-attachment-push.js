#!/usr/bin/env node
// Test E2E del nuevo arandaAttachmentsPush con upload binario real.
// Reabre el tracker del doc 17183 (test.txt en GLPI 42883 / Aranda 370098),
// corre un tick del servicio y verifica que el archivo aparezca en Aranda.

import 'dotenv/config';
import { config, validateConfig } from '../src/config.js';
import { initDB, getDB, closeDB } from '../src/lib/db.js';
import { ArandaAttachmentsPushService } from '../src/services/arandaAttachmentsPush.js';
import { arandaClient } from '../src/lib/arandaClient.js';
import { glpiClient } from '../src/lib/glpiClient.js';

const DOC_ID = 17183;          // test.txt (chico) — buen candidato para test
const ITEM = 370098;
const SEG = 4;

async function listAranda() {
  const r = await arandaClient.listItemFiles(ITEM, SEG, config.ARANDA_AUTHOR_ID);
  return Array.isArray(r) ? r : [];
}

async function main() {
  validateConfig();
  await initDB(config);
  await arandaClient.ensureLogin();
  await glpiClient.ensureSession();

  console.log('=== ANTES ===');
  const before = await listAranda();
  console.log(`Aranda item ${ITEM} tiene ${before.length} archivos`);
  for (const f of before) console.log(`  id=${f.Id} name=${f.Name} size=${f.Size}`);

  // Reabrir el tracker del doc
  await getDB().query(`DELETE FROM aranda_attachment_notes WHERE document_id=?`, [DOC_ID]);
  console.log(`\nTracker reabierto: doc ${DOC_ID} vuelve a 'pendiente'.`);

  // Tick
  console.log('\n=== TICK ===');
  const svc = new ArandaAttachmentsPushService({ POLL_INTERVAL: 999 });
  await svc.tick();

  // Verificar
  console.log('\n=== DESPUÉS ===');
  const after = await listAranda();
  console.log(`Aranda item ${ITEM} tiene ${after.length} archivos`);
  const beforeIds = new Set(before.map(f => f.Id));
  const news = after.filter(f => !beforeIds.has(f.Id));
  console.log(`Δ = ${after.length - before.length}`);
  for (const f of news) console.log(`  NUEVO id=${f.Id} name=${f.Name} size=${f.Size}`);

  const [tr] = await getDB().query(`SELECT * FROM aranda_attachment_notes WHERE document_id=?`, [DOC_ID]);
  console.log('\nTracker post-tick:', JSON.stringify(tr, null, 2));

  // Verificar anti-eco
  const [aif] = await getDB().query(
    `SELECT aranda_file_id, glpi_document_id, status FROM aranda_inbound_files WHERE glpi_document_id=?`,
    [DOC_ID]
  );
  console.log('Anti-eco aranda_inbound_files para doc=' + DOC_ID + ':', JSON.stringify(aif));

  await closeDB();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
