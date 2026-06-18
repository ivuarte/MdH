#!/usr/bin/env node
// Test E2E: ticket 43126 / Aranda 370714. Verifica que glpiAttachmentsSync
// detecte el adjunto del followup, y arandaAttachmentsPush lo suba a Aranda
// via /item/addfile.

import 'dotenv/config';
import { config, validateConfig } from '../src/config.js';
import { initDB, getDB, closeDB } from '../src/lib/db.js';
import { GlpiAttachmentsSyncService } from '../src/services/glpiAttachmentsSync.js';
import { ArandaAttachmentsPushService } from '../src/services/arandaAttachmentsPush.js';
import { arandaClient } from '../src/lib/arandaClient.js';
import { glpiClient } from '../src/lib/glpiClient.js';

const TICKET = 43126;
const ARANDA_ITEM = 370714;
const SEG = 4;

async function main() {
  validateConfig();
  await initDB(config);
  await arandaClient.ensureLogin();
  await glpiClient.ensureSession();

  console.log('=== Estado Aranda 370714 ANTES ===');
  const filesBefore = await arandaClient.listItemFiles(ARANDA_ITEM, SEG, config.ARANDA_AUTHOR_ID);
  console.log(`Aranda tiene ${(filesBefore || []).length} archivos`);
  for (const f of (filesBefore || [])) console.log(`  id=${f.Id} name=${f.Name} size=${f.Size}`);

  console.log('\n=== Estado DB ANTES ===');
  const [gaBefore] = await getDB().query('SELECT * FROM glpi_attachments WHERE ticket_id=?', [TICKET]);
  console.log('glpi_attachments:', JSON.stringify(gaBefore));
  const [aanBefore] = await getDB().query('SELECT * FROM aranda_attachment_notes WHERE ticket_id=?', [TICKET]);
  console.log('aranda_attachment_notes:', JSON.stringify(aanBefore));

  console.log('\n=== TICK glpiAttachmentsSync ===');
  await new GlpiAttachmentsSyncService({ POLL_INTERVAL: 999 }).tick();

  const [gaAfter1] = await getDB().query('SELECT * FROM glpi_attachments WHERE ticket_id=?', [TICKET]);
  console.log('glpi_attachments DESPUÉS:', JSON.stringify(gaAfter1, null, 2));

  if (!gaAfter1.length) {
    console.log('\n❌ glpiAttachmentsSync NO detectó el adjunto. Aborto.');
    await closeDB();
    return;
  }

  console.log('\n=== TICK arandaAttachmentsPush ===');
  await new ArandaAttachmentsPushService({ POLL_INTERVAL: 999 }).tick();

  const [aanAfter] = await getDB().query('SELECT * FROM aranda_attachment_notes WHERE ticket_id=?', [TICKET]);
  console.log('aranda_attachment_notes DESPUÉS:', JSON.stringify(aanAfter, null, 2));

  console.log('\n=== Estado Aranda 370714 DESPUÉS ===');
  const filesAfter = await arandaClient.listItemFiles(ARANDA_ITEM, SEG, config.ARANDA_AUTHOR_ID);
  console.log(`Aranda tiene ${(filesAfter || []).length} archivos`);
  const beforeIds = new Set((filesBefore || []).map(f => f.Id));
  const news = (filesAfter || []).filter(f => !beforeIds.has(f.Id));
  console.log(`Δ = ${(filesAfter || []).length - (filesBefore || []).length}`);
  for (const f of news) console.log(`  NUEVO id=${f.Id} name=${f.Name} size=${f.Size}`);

  console.log('\n=== Anti-eco ===');
  const [aif] = await getDB().query(
    `SELECT aranda_file_id, glpi_document_id, status FROM aranda_inbound_files WHERE glpi_ticket_id=?`,
    [TICKET]
  );
  console.log('aranda_inbound_files:', JSON.stringify(aif, null, 2));

  await closeDB();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
