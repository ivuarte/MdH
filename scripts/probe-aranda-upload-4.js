#!/usr/bin/env node
// Probe 4: validar si la nota con Files/Attachments inline realmente
// adjuntó el archivo al item, o si fueron campos ignorados.
// También probar variantes de field name: Files, Attachments, attachments, files.

import 'dotenv/config';
import axios from 'axios';
import { config, validateConfig } from '../src/config.js';
import { arandaClient } from '../src/lib/arandaClient.js';

const USER = config.ARANDA_AUTHOR_ID;
const ITEM = 370262;
const SEG  = 4;

async function postNote(body) {
  const r = await axios.post(
    `${config.ARANDA_BASE_URL}/item/${ITEM}/${SEG}/note`,
    body,
    {
      headers: { Authorization: arandaClient.sessionId, 'Content-Type': 'application/json' },
      validateStatus: () => true
    }
  );
  return r;
}

async function listFiles() {
  const r = await axios.get(
    `${config.ARANDA_BASE_URL}/item/${ITEM}/${SEG}/${USER}/files`,
    { headers: { Authorization: arandaClient.sessionId }, validateStatus: () => true }
  );
  return r.data;
}

async function listNotes() {
  const r = await axios.get(
    `${config.ARANDA_BASE_URL}/item/${ITEM}/${SEG}/note/list`,
    { headers: { Authorization: arandaClient.sessionId }, validateStatus: () => true }
  );
  return r.data;
}

async function main() {
  validateConfig();
  arandaClient.sessionId = null;
  await arandaClient.ensureLogin();

  console.log('--- baseline ---');
  const baseFiles = await listFiles();
  const baseNotes = await listNotes();
  console.log(`files antes: ${baseFiles?.length ?? '?'}; notas antes: ${baseNotes?.length ?? '?'}`);

  const probeId = `probe-${Date.now()}`;
  const fileName = `${probeId}.txt`;
  const content = Buffer.from(`probe content ${probeId}`).toString('base64');

  console.log(`\n--- Posting note with Files=[{Name, Content, ContentType}] (probeId=${probeId}) ---`);
  let r = await postNote({
    Description: `${probeId} Files variant`,
    IsPrivate: false,
    Files: [{ Name: fileName, Content: content, ContentType: 'text/plain' }]
  });
  console.log(`status=${r.status} body=${JSON.stringify(r.data).slice(0,300)}`);

  console.log(`\n--- Posting note with Attachments=[{Name, Data}] (probeId=${probeId}-2) ---`);
  const probe2 = `${probeId}-2`;
  r = await postNote({
    Description: `${probe2} Attachments variant`,
    IsPrivate: false,
    Attachments: [{ Name: `${probe2}.txt`, Data: Buffer.from('hello2').toString('base64') }]
  });
  console.log(`status=${r.status} body=${JSON.stringify(r.data).slice(0,300)}`);

  console.log(`\n--- Posting note with files=[{name, content, mime}] lowercase ---`);
  const probe3 = `${probeId}-3`;
  r = await postNote({
    Description: `${probe3} lowercase files`,
    IsPrivate: false,
    files: [{ name: `${probe3}.txt`, content: Buffer.from('hello3').toString('base64'), mime: 'text/plain' }]
  });
  console.log(`status=${r.status} body=${JSON.stringify(r.data).slice(0,300)}`);

  // Esperar y rechequear
  await new Promise(r => setTimeout(r, 1500));
  console.log('\n--- después ---');
  const afterFiles = await listFiles();
  const afterNotes = await listNotes();
  console.log(`files después: ${afterFiles?.length ?? '?'}; notas después: ${afterNotes?.length ?? '?'}`);
  if (afterFiles?.length > baseFiles?.length) {
    console.log('\n*** FILES nuevos detectados ***');
    console.log(JSON.stringify(afterFiles.slice(0, 5), null, 2));
  }
  // Mostrar las últimas notas para ver si quedaron registradas
  if (Array.isArray(afterNotes) && afterNotes.length) {
    const last = afterNotes.slice(-3);
    console.log('\nÚltimas notas (resumen):');
    for (const n of last) {
      console.log(`  ${n.CreationDate} | ${n.ActionType} | ${(n.Description ?? '').slice(0,80)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
