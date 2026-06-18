#!/usr/bin/env node
// Probe del endpoint documentado /item/addfile (doc oficial v1.9).
// Ejecuta E1 (file0 + lowercase), E2 (CamelCase), E3 (field "file" sin 0)
// y mide el Δ de archivos en el item antes/después de cada llamada.

import 'dotenv/config';
import axios from 'axios';
import FormData from 'form-data';
import { config, validateConfig } from '../src/config.js';
import { arandaClient } from '../src/lib/arandaClient.js';

const USER = config.ARANDA_AUTHOR_ID;
const ITEM = 370262;
const SEG  = 4;

async function listFiles() {
  const r = await axios.get(
    `${config.ARANDA_BASE_URL}/item/${ITEM}/${SEG}/${USER}/files`,
    { headers: { Authorization: arandaClient.sessionId }, validateStatus: () => true, timeout: 15000 }
  );
  return { status: r.status, files: Array.isArray(r.data) ? r.data : [] };
}

function buildForm(fileKey, content, filename) {
  const fd = new FormData();
  fd.append(fileKey, Buffer.from(content), { filename, contentType: 'text/plain' });
  fd.append('itemId',   String(ITEM));
  fd.append('itemType', String(SEG));
  fd.append('userId',   String(USER));
  return fd;
}

async function tryUpload(label, url, fileKey, marker) {
  const filename = `probe-${marker}.txt`;
  const fd = buildForm(fileKey, `addfile probe ${marker} @ ${new Date().toISOString()}`, filename);
  const r = await axios.post(url, fd, {
    headers: { Authorization: arandaClient.sessionId, ...fd.getHeaders() },
    validateStatus: () => true,
    timeout: 30000,
    maxRedirects: 0,
    maxBodyLength: Infinity, maxContentLength: Infinity
  });
  const allow = r.headers?.allow ?? r.headers?.Allow ?? '';
  const body = typeof r.data === 'string'
    ? r.data.replace(/<!DOCTYPE[\s\S]*?>/i, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
    : JSON.stringify(r.data).slice(0, 200);
  console.log(`\n${label}`);
  console.log(`  POST ${url.replace(config.ARANDA_BASE_URL, '')}  fileField="${fileKey}"  filename="${filename}"`);
  console.log(`  → ${r.status}  Allow="${allow || '(none)'}"  body=${body}`);
  return { status: r.status, body: r.data, filename };
}

async function main() {
  validateConfig();
  arandaClient.sessionId = null;
  await arandaClient.ensureLogin();
  console.log(`session: ${arandaClient.sessionId.slice(0, 12)}...`);
  console.log(`probe item=${ITEM} seg=${SEG} user=${USER}\n`);

  const before = await listFiles();
  console.log(`BASELINE: GET /files → status=${before.status}  count=${before.files.length}`);
  if (before.files.length) {
    console.log('  files actuales:');
    for (const f of before.files) console.log(`    id=${f.Id} name=${f.Name} size=${f.Size}`);
  }

  // E1: doc oficial exacta
  const e1 = await tryUpload(
    '=== E1 — POST /item/addfile  (file0 + lowercase path) ===',
    `${config.ARANDA_BASE_URL}/item/addfile`,
    'file0', 'E1'
  );

  // E2: CamelCase
  const e2 = await tryUpload(
    '=== E2 — POST /item/AddFile (CamelCase) ===',
    `${config.ARANDA_BASE_URL}/item/AddFile`,
    'file0', 'E2'
  );

  // E3: file (sin 0)
  const e3 = await tryUpload(
    '=== E3 — POST /item/addfile (field "file" sin cero) ===',
    `${config.ARANDA_BASE_URL}/item/addfile`,
    'file', 'E3'
  );

  // Verificar side-effects
  await new Promise(res => setTimeout(res, 1500));
  const after = await listFiles();
  console.log(`\nAFTER:    GET /files → status=${after.status}  count=${after.files.length}  Δ=${after.files.length - before.files.length}`);
  const beforeIds = new Set(before.files.map(f => f.Id));
  const newOnes = after.files.filter(f => !beforeIds.has(f.Id));
  if (newOnes.length) {
    console.log('  NUEVOS archivos:');
    for (const f of newOnes) console.log(`    id=${f.Id} name=${f.Name} size=${f.Size}`);
  } else {
    console.log('  ningún archivo nuevo apareció.');
  }

  console.log('\n--- veredicto ---');
  for (const [label, r] of [['E1', e1], ['E2', e2], ['E3', e3]]) {
    const newForThis = newOnes.find(f => String(f.Name).includes(r.filename) || String(f.Name).includes(r.filename.replace('.txt','')));
    const ok = newForThis ? 'SUBIÓ' : 'NO subió';
    console.log(`${label}: HTTP ${r.status}  →  ${ok}`);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
