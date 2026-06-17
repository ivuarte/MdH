#!/usr/bin/env node
// Sonda de endpoints de adjuntos en Aranda ASDKAPI v8.6.
// Prueba varios candidatos contra un caso conocido para identificar el correcto.
// Ejecutar con el daemon detenido (Aranda invalida sesiones en logins paralelos).

import 'dotenv/config';
import axios from 'axios';
import { config, validateConfig } from '../src/config.js';
import { arandaClient } from '../src/lib/arandaClient.js';

const ITEM = Number(process.argv[2] || 370098);
const SEG  = Number(process.argv[3] || 4);

async function tryGet(path) {
  const url = `${config.ARANDA_BASE_URL}${path}`;
  try {
    const res = await axios.get(url, {
      headers: { Authorization: arandaClient.sessionId },
      timeout: 10000,
      validateStatus: () => true
    });
    const body = typeof res.data === 'string' ? res.data.slice(0, 200) : JSON.stringify(res.data).slice(0, 200);
    console.log(`GET ${path} → ${res.status} ${body}`);
    return { status: res.status, data: res.data };
  } catch (e) {
    console.log(`GET ${path} → ERR ${e.message}`);
    return null;
  }
}

async function main() {
  validateConfig();
  await arandaClient.ensureLogin();
  console.log(`Probando endpoints de adjuntos para item=${ITEM} seg=${SEG}\n`);

  // Endpoints candidatos basados en patrones comunes de ASDKAPI
  await tryGet(`/item/${ITEM}/${SEG}/file/list`);
  await tryGet(`/item/${ITEM}/${SEG}/files`);
  await tryGet(`/item/${ITEM}/${SEG}/attachment/list`);
  await tryGet(`/item/${ITEM}/${SEG}/attachments`);
  await tryGet(`/item/${ITEM}/${SEG}/document/list`);
  await tryGet(`/item/${ITEM}/${SEG}/file`);
  await tryGet(`/item/${ITEM}/${SEG}/upload`);
  await tryGet(`/file/list?itemId=${ITEM}&segment=${SEG}`);
  await tryGet(`/itemfile/${ITEM}/${SEG}`);
  await tryGet(`/attachment/list?itemId=${ITEM}`);
  await tryGet(`/file/item/${ITEM}/${SEG}`);

  // Segunda ronda: incluir userId en la ruta (los 400 InvalidUserId sugieren que el userId
  // forma parte de la URL — mismo patrón que /item/update/{id}/{seg}/{userId}).
  const USER = config.ARANDA_AUTHOR_ID;
  console.log(`\n--- con userId=${USER} en path ---`);
  await tryGet(`/item/${ITEM}/${SEG}/files/${USER}`);
  await tryGet(`/item/${ITEM}/${SEG}/${USER}/files`);
  await tryGet(`/item/${ITEM}/${SEG}/file/${USER}`);
  await tryGet(`/item/${ITEM}/${SEG}/${USER}/file/list`);
  await tryGet(`/item/${ITEM}/${SEG}/attachment/${USER}`);
  await tryGet(`/item/${ITEM}/${SEG}/${USER}/attachments`);
  await tryGet(`/item/${ITEM}/${SEG}/${USER}/attachment/list`);
}

main().catch(e => { console.error(e); process.exit(1); });
