#!/usr/bin/env node
// Probe 3: dos avenidas no agotadas tras "full permisos":
//   (A) Crear una nota con campo Files/Attachments en el body (algunos
//       ASDKAPI permiten attachment en línea con la nota).
//   (B) Handlers .ashx paralelos al ASDKAPI (Aranda File System Web Service).
//   (C) Repetir POST /files con login-as-user (el daemon usa una cuenta admin
//       pero el "userId" en el path es config.ARANDA_AUTHOR_ID — chequear
//       que esa cuenta tenga sesión propia válida con los nuevos permisos).

import 'dotenv/config';
import axios from 'axios';
import FormData from 'form-data';
import { config, validateConfig } from '../src/config.js';
import { arandaClient } from '../src/lib/arandaClient.js';

const USER = config.ARANDA_AUTHOR_ID;
const ITEM = 370262;
const SEG  = 4;

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
    const body = typeof r.data === 'string' ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 200);
    const allow = r.headers?.allow ?? r.headers?.Allow ?? '';
    console.log(`${method.padEnd(5)} ${url.replace(/^https:\/\/[^/]+/,'').padEnd(70)} → ${r.status} ${allow ? `Allow=${allow} ` : ''}${body.replace(/\s+/g,' ').slice(0,160)}`);
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

  const BASE = config.ARANDA_BASE_URL; // .../ASDKAPI/api/v8.6
  const HOST = BASE.replace(/\/ASDKAPI\/api\/v[\d.]+\/?$/i, '');

  console.log('=== (A) Attachment in-line en /note ===');
  const noteWithFiles = {
    Description: 'probe attachment in-line',
    IsPrivate: false,
    Files: [{ Name: 'probe.txt', Content: Buffer.from('hello').toString('base64'), ContentType: 'text/plain' }]
  };
  await probe('POST', `${BASE}/item/${ITEM}/${SEG}/note`, {
    data: noteWithFiles,
    headers: { 'Content-Type': 'application/json' }
  });
  const noteWithAtt = {
    Description: 'probe',
    Attachments: [{ Name: 'probe.txt', Data: Buffer.from('hello').toString('base64') }]
  };
  await probe('POST', `${BASE}/item/${ITEM}/${SEG}/note`, {
    data: noteWithAtt,
    headers: { 'Content-Type': 'application/json' }
  });

  console.log('\n=== (B) Handlers .ashx en /afs y /afsws ===');
  for (const path of [
    '/afs/handlers/UploadHandler.ashx',
    '/afs/handlers/FileUpload.ashx',
    '/afs/handlers/AddFile.ashx',
    '/afs/handlers/SaveFile.ashx',
    '/afs/handlers/UploadFile.ashx',
    '/afs/UploadHandler.ashx',
    '/afs/Upload.ashx',
    '/afs/AFSUpload.ashx',
    '/afsws/UploadHandler.ashx',
    '/afsws/Upload.ashx',
    '/afsws/handlers/UploadHandler.ashx',
  ]) {
    const fd = new FormData();
    fd.append('file', Buffer.from('probe ashx upload'), { filename: 'probe.txt', contentType: 'text/plain' });
    fd.append('token', arandaClient.sessionId);
    fd.append('itemId', String(ITEM));
    fd.append('segment', String(SEG));
    await probe('POST', `${HOST}${path}`, { data: fd, headers: fd.getHeaders() });
  }

  console.log('\n=== (C) Otros patrones REST que pueden aparecer con permisos nuevos ===');
  for (const [method, path, ctype, payload] of [
    // PUT a /files con multipart
    ['PUT', `${BASE}/item/${ITEM}/${SEG}/${USER}/files`, 'multipart', null],
    // POST /file (singular) + multipart
    ['POST', `${BASE}/item/${ITEM}/${SEG}/${USER}/file`, 'multipart', null],
    // POST con userId al final, no en medio
    ['POST', `${BASE}/item/${ITEM}/${SEG}/files/${USER}`, 'multipart', null],
    // POST sin userId
    ['POST', `${BASE}/item/${ITEM}/${SEG}/files`, 'multipart', null],
    // POST /file/add con body
    ['POST', `${BASE}/file/add/${ITEM}/${SEG}`, 'multipart', null],
    ['POST', `${BASE}/file/add/${ITEM}/${SEG}/${USER}`, 'multipart', null],
    // Patrones tipo SOAP-action
    ['POST', `${BASE}/file/save`, 'json', { itemId: ITEM, segment: SEG, userId: USER, name: 'x.txt', content: Buffer.from('x').toString('base64') }],
  ]) {
    let data, headers = {};
    if (ctype === 'multipart') {
      const fd = new FormData();
      fd.append('file', Buffer.from('probe content'), { filename: 'probe.txt', contentType: 'text/plain' });
      data = fd; headers = fd.getHeaders();
    } else {
      data = payload; headers = { 'Content-Type': 'application/json' };
    }
    await probe(method, path, { data, headers });
  }

  console.log('\n=== (D) Verificar Allow header con OPTIONS preciso ===');
  for (const path of [
    `${BASE}/item/${ITEM}/${SEG}/${USER}/files`,
    `${BASE}/item/${ITEM}/${SEG}/note`,
    `${BASE}/file`,
  ]) {
    const r = await axios.options(path, {
      headers: { Authorization: arandaClient.sessionId },
      validateStatus: () => true
    });
    const allow = r.headers?.allow ?? r.headers?.Allow ?? '(missing)';
    const access = r.headers?.['access-control-allow-methods'] ?? '(missing)';
    console.log(`OPTIONS ${path.replace(BASE,'')} → ${r.status}  Allow=${allow}  AC-Allow-Methods=${access}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
