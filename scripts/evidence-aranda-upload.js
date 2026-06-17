#!/usr/bin/env node
// Evidencia consolidada de los intentos de upload contra Aranda ASDKAPI v8.6.
// Re-ejecuta los métodos relevantes con sesión fresca y produce un reporte
// línea-por-línea: request method+path, status, Allow header, snippet del body.

import 'dotenv/config';
import axios from 'axios';
import FormData from 'form-data';
import { config, validateConfig } from '../src/config.js';
import { arandaClient } from '../src/lib/arandaClient.js';

const USER = config.ARANDA_AUTHOR_ID;
const ITEM = 370262;
const SEG  = 4;

const results = [];

function snippet(data) {
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  return (s || '').replace(/<!DOCTYPE[\s\S]*?>/i, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
}

async function run(label, method, url, opts = {}) {
  try {
    const r = await axios.request({
      method, url,
      headers: { Authorization: arandaClient.sessionId, ...opts.headers },
      data: opts.data,
      validateStatus: () => true,
      timeout: 20000,
      maxRedirects: 0
    });
    const allow = r.headers?.allow ?? r.headers?.Allow ?? '';
    results.push({
      label, method, url: url.replace(/^https:\/\/[^/]+/, ''),
      ctype: opts.headers?.['Content-Type'] || (opts.headers?.['content-type']) || (opts.data instanceof FormData ? 'multipart/form-data' : '-'),
      status: r.status,
      allow: allow || '-',
      body: snippet(r.data)
    });
  } catch (e) {
    results.push({ label, method, url, status: 'ERR', allow: '-', body: e.message });
  }
}

async function listFilesCount() {
  const r = await axios.get(
    `${config.ARANDA_BASE_URL}/item/${ITEM}/${SEG}/${USER}/files`,
    { headers: { Authorization: arandaClient.sessionId }, validateStatus: () => true }
  );
  return Array.isArray(r.data) ? r.data.length : -1;
}
async function listNotesCount() {
  const r = await axios.get(
    `${config.ARANDA_BASE_URL}/item/${ITEM}/${SEG}/note/list`,
    { headers: { Authorization: arandaClient.sessionId }, validateStatus: () => true }
  );
  return Array.isArray(r.data) ? r.data.length : -1;
}

async function main() {
  validateConfig();
  arandaClient.sessionId = null;
  await arandaClient.ensureLogin();

  const BASE = config.ARANDA_BASE_URL;
  const HOST = BASE.replace(/\/ASDKAPI\/api\/v[\d.]+\/?$/i, '');

  console.log(`# Evidencia de probes de upload Aranda — ${new Date().toISOString()}`);
  console.log(`baseURL: ${BASE}`);
  console.log(`item probe: ${ITEM} seg ${SEG} user ${USER}`);
  console.log(`session: ${arandaClient.sessionId.slice(0,12)}...`);

  // BASELINE
  const baseFiles = await listFilesCount();
  const baseNotes = await listNotesCount();
  console.log(`\nbaseline → archivos en item: ${baseFiles}  notas: ${baseNotes}\n`);

  const newFD = () => {
    const fd = new FormData();
    fd.append('file', Buffer.from('evidence probe'), { filename: 'probe.txt', contentType: 'text/plain' });
    return fd;
  };

  // (1) POST /files multipart
  let fd = newFD();
  await run('A1 POST /files multipart',         'POST', `${BASE}/item/${ITEM}/${SEG}/${USER}/files`,
    { data: fd, headers: fd.getHeaders() });

  // (2) PUT /files multipart
  fd = newFD();
  await run('A2 PUT  /files multipart',         'PUT',  `${BASE}/item/${ITEM}/${SEG}/${USER}/files`,
    { data: fd, headers: fd.getHeaders() });

  // (3) POST /files JSON-base64
  await run('A3 POST /files json-base64',       'POST', `${BASE}/item/${ITEM}/${SEG}/${USER}/files`,
    { data: { name:'probe.txt', content: Buffer.from('x').toString('base64'), contentType:'text/plain' },
      headers: { 'Content-Type': 'application/json' } });

  // (4) POST /file (singular) multipart
  fd = newFD();
  await run('A4 POST /file singular',           'POST', `${BASE}/item/${ITEM}/${SEG}/${USER}/file`,
    { data: fd, headers: fd.getHeaders() });

  // (5) POST /item/file/{id}/{seg}
  fd = newFD();
  await run('A5 POST /item/file/{id}/{seg}',    'POST', `${BASE}/item/file/${ITEM}/${SEG}`,
    { data: fd, headers: fd.getHeaders() });

  // (6) POST /file/upload, /file/add
  fd = newFD();
  await run('A6 POST /file/upload',             'POST', `${BASE}/file/upload`,
    { data: fd, headers: fd.getHeaders() });
  fd = newFD();
  await run('A7 POST /file/add',                'POST', `${BASE}/file/add`,
    { data: fd, headers: fd.getHeaders() });
  fd = newFD();
  await run('A8 POST /Attachment/Add',          'POST', `${BASE}/Attachment/Add`,
    { data: fd, headers: fd.getHeaders() });

  // (B) AFSHandler.ashx
  fd = newFD();
  fd.append('token', arandaClient.sessionId);
  fd.append('itemId', String(ITEM));
  fd.append('segment', String(SEG));
  await run('B1 POST AFSHandler.ashx?token=...','POST', `${HOST}/afs/handlers/AFSHandler.ashx?token=${arandaClient.sessionId}`,
    { data: fd, headers: fd.getHeaders() });
  fd = newFD();
  await run('B2 POST UploadHandler.ashx',       'POST', `${HOST}/afs/handlers/UploadHandler.ashx`,
    { data: fd, headers: fd.getHeaders() });
  fd = newFD();
  await run('B3 POST FileUpload.ashx',          'POST', `${HOST}/afs/handlers/FileUpload.ashx`,
    { data: fd, headers: fd.getHeaders() });

  // (C) Note con attachment inline — efecto colateral
  await run('C1 POST /note Files=[...]',        'POST', `${BASE}/item/${ITEM}/${SEG}/note`,
    { data: { Description:'evidence probe Files', IsPrivate:false,
              Files:[{ Name:'probe.txt', Content: Buffer.from('hi').toString('base64'), ContentType:'text/plain' }] },
      headers: { 'Content-Type':'application/json' } });
  await run('C2 POST /note Attachments=[...]',  'POST', `${BASE}/item/${ITEM}/${SEG}/note`,
    { data: { Description:'evidence probe Attachments', IsPrivate:false,
              Attachments:[{ Name:'probe.txt', Data: Buffer.from('hi').toString('base64') }] },
      headers: { 'Content-Type':'application/json' } });
  await run('C3 POST /note files=[...]',        'POST', `${BASE}/item/${ITEM}/${SEG}/note`,
    { data: { Description:'evidence probe files lower', IsPrivate:false,
              files:[{ name:'probe.txt', content: Buffer.from('hi').toString('base64'), mime:'text/plain' }] },
      headers: { 'Content-Type':'application/json' } });

  // (D) OPTIONS
  await run('D1 OPTIONS /files',                'OPTIONS', `${BASE}/item/${ITEM}/${SEG}/${USER}/files`);
  await run('D2 OPTIONS /note',                 'OPTIONS', `${BASE}/item/${ITEM}/${SEG}/note`);

  // === Reporte ===
  console.log('Etiqueta'.padEnd(30) + 'Mét  ' + 'Path'.padEnd(48) + 'Status ' + 'Allow         ' + 'Body (snippet)');
  console.log('-'.repeat(160));
  for (const r of results) {
    console.log(
      r.label.padEnd(30) +
      r.method.padEnd(5) +
      r.url.padEnd(48) +
      String(r.status).padEnd(7) +
      String(r.allow).padEnd(14) +
      (r.body || '').slice(0, 60)
    );
  }

  // Verificar efectos colaterales
  await new Promise(res => setTimeout(res, 1500));
  const afterFiles = await listFilesCount();
  const afterNotes = await listNotesCount();
  console.log('\n--- efectos colaterales ---');
  console.log(`archivos: antes=${baseFiles}  después=${afterFiles}  Δ=${afterFiles - baseFiles}  ← ¿quedó algún archivo adjuntado?`);
  console.log(`notas:    antes=${baseNotes}  después=${afterNotes}  Δ=${afterNotes - baseNotes}  ← ¿se crearon las 3 notas C1/C2/C3?`);
}

main().catch(e => { console.error(e); process.exit(1); });
