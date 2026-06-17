#!/usr/bin/env node
// Probe 2: tras grant de "full permisos". Estrategias nuevas:
//  - POST a AFSHandler.ashx con multipart usando session como token
//  - Probar verbos POST/PUT con Content-Type explícito en /files
//  - Probar paths legacy de ASDKAPI: /AddFile, /UploadFile, /file/upload
//  - Probar con header X-Token (algunos ASDKAPI lo usan en vez de Authorization)

import 'dotenv/config';
import axios from 'axios';
import FormData from 'form-data';
import { config, validateConfig } from '../src/config.js';
import { arandaClient } from '../src/lib/arandaClient.js';

const USER = config.ARANDA_AUTHOR_ID;
const ITEM = 370262;
const SEG  = 4;

function buildForm() {
  const fd = new FormData();
  fd.append('file', Buffer.from('test upload probe2'), { filename: 'probe2.txt', contentType: 'text/plain' });
  return fd;
}

async function probe(method, url, opts = {}) {
  try {
    const r = await axios.request({
      method, url,
      headers: { Authorization: arandaClient.sessionId, ...opts.headers },
      data: opts.data,
      validateStatus: () => true,
      timeout: 20000,
      maxRedirects: 0
    });
    const body = typeof r.data === 'string' ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 160);
    const allow = r.headers?.allow ?? r.headers?.Allow ?? '';
    console.log(`${method.padEnd(5)} ${url.replace(config.ARANDA_BASE_URL, '').padEnd(60)} → ${r.status}  ${allow ? `Allow=${allow}  ` : ''}${body.replace(/\s+/g,' ').slice(0,120)}`);
    return r;
  } catch (e) {
    console.log(`${method.padEnd(5)} ${url} → ERR ${e.message}`);
    return null;
  }
}

async function main() {
  validateConfig();
  arandaClient.sessionId = null;
  await arandaClient.ensureLogin();
  console.log(`session: ${arandaClient.sessionId.slice(0, 12)}...\n`);

  const BASE = config.ARANDA_BASE_URL;
  // Aranda lives at /ASDKAPI; AFS handler is at host root /afs/handlers/
  const HOST_ROOT = BASE.replace(/\/ASDKAPI\/?$/i, '');

  console.log('=== 1) AFSHandler.ashx (host root) ===');
  const fd1 = buildForm();
  await probe('POST', `${HOST_ROOT}/afs/handlers/AFSHandler.ashx?token=${arandaClient.sessionId}`,
    { data: fd1, headers: fd1.getHeaders() });
  const fd2 = buildForm();
  await probe('POST', `${HOST_ROOT}/afs/handlers/AFSHandler.ashx?op=upload&token=${arandaClient.sessionId}&itemId=${ITEM}&segment=${SEG}`,
    { data: fd2, headers: fd2.getHeaders() });
  await probe('GET',  `${HOST_ROOT}/afs/handlers/AFSHandler.ashx?op=info&token=${arandaClient.sessionId}`);
  // Algunos AFS expose meta on GET sin params
  await probe('GET',  `${HOST_ROOT}/afs/handlers/AFSHandler.ashx`);
  await probe('OPTIONS', `${HOST_ROOT}/afs/handlers/AFSHandler.ashx`);

  console.log('\n=== 2) POST/PUT a /files con headers variantes ===');
  const fd3 = buildForm();
  await probe('POST', `${BASE}/item/${ITEM}/${SEG}/${USER}/files`,
    { data: fd3, headers: { ...fd3.getHeaders(), 'X-Token': arandaClient.sessionId } });
  const fd4 = buildForm();
  await probe('PUT', `${BASE}/item/${ITEM}/${SEG}/${USER}/files`,
    { data: fd4, headers: fd4.getHeaders() });

  console.log('\n=== 3) Paths legacy ASDKAPI ===');
  const variants = [
    `/file/upload`, `/file/add`, `/UploadFile`, `/AddFile`, `/file/new`,
    `/files/upload`, `/files/add`, `/files/${ITEM}/${SEG}/${USER}`,
    `/file/${ITEM}/${SEG}/${USER}`,
    `/item/file/${ITEM}/${SEG}/${USER}`,
    `/item/file/add/${ITEM}/${SEG}/${USER}`,
    `/item/${ITEM}/${SEG}/${USER}/file/upload`,
    `/item/${ITEM}/${SEG}/${USER}/file/add`,
    `/item/file/${ITEM}/${SEG}`,
    `/file/Item/${ITEM}/${SEG}`,
    `/itemfile`,
    `/Attachment/Add`,
    `/AddAttachment`,
    `/UploadAttachment`,
  ];
  for (const p of variants) {
    const fd = buildForm();
    await probe('POST', `${BASE}${p}`, { data: fd, headers: fd.getHeaders() });
  }

  console.log('\n=== 4) JSON-base64 contra /files (algunos ASDKAPI usan eso) ===');
  await probe('POST', `${BASE}/item/${ITEM}/${SEG}/${USER}/files`, {
    data: { name: 'probe.txt', content: Buffer.from('hello').toString('base64'), contentType: 'text/plain' },
    headers: { 'Content-Type': 'application/json' }
  });
  await probe('POST', `${BASE}/item/${ITEM}/${SEG}/${USER}/file`, {
    data: { name: 'probe.txt', content: Buffer.from('hello').toString('base64'), contentType: 'text/plain' },
    headers: { 'Content-Type': 'application/json' }
  });
  await probe('POST', `${BASE}/file`, {
    data: { name: 'probe.txt', content: Buffer.from('hello').toString('base64'), itemId: ITEM, segment: SEG, userId: USER },
    headers: { 'Content-Type': 'application/json' }
  });

  console.log('\n=== 5) OPTIONS sobre /files para listar verbos permitidos ===');
  await probe('OPTIONS', `${BASE}/item/${ITEM}/${SEG}/${USER}/files`);
  await probe('OPTIONS', `${BASE}/file`);
  await probe('OPTIONS', `${BASE}/files`);
}

main().catch(e => { console.error(e); process.exit(1); });
