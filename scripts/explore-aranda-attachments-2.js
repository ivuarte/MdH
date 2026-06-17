#!/usr/bin/env node
// Refinamiento: probar /files con un caso que tenga adjuntos + sondar POST.

import 'dotenv/config';
import axios from 'axios';
import FormData from 'form_data_fallback';

import { config, validateConfig } from '../src/config.js';
import { arandaClient } from '../src/lib/arandaClient.js';
import { getDB, initDB, closeDB } from '../src/lib/db.js';

async function tryGet(path) {
  const url = `${config.ARANDA_BASE_URL}${path}`;
  try {
    const res = await axios.get(url, {
      headers: { Authorization: arandaClient.sessionId },
      timeout: 15000,
      validateStatus: () => true
    });
    const body = typeof res.data === 'string' ? res.data.slice(0, 300) : JSON.stringify(res.data).slice(0, 300);
    console.log(`GET ${path} → ${res.status} ${body}`);
    return res;
  } catch (e) {
    console.log(`GET ${path} → ERR ${e.message}`);
    return null;
  }
}

async function main() {
  validateConfig();
  await initDB(config);
  await arandaClient.ensureLogin();

  const USER = config.ARANDA_AUTHOR_ID;

  // Buscamos varios items Aranda donde haya posible interacción humana — más probable que tengan adjuntos.
  const [rows] = await getDB().query(
    `SELECT aranda_item_id, aranda_segment
       FROM aranda_inbound_items
      WHERE aranda_segment IS NOT NULL
      ORDER BY detected_at DESC
      LIMIT 8`
  );
  console.log(`Probando ${rows.length} casos para encontrar uno con adjuntos\n`);

  for (const { aranda_item_id, aranda_segment } of rows) {
    const res = await tryGet(`/item/${aranda_item_id}/${aranda_segment}/${USER}/files`);
    if (res?.status === 200 && Array.isArray(res.data) && res.data.length > 0) {
      console.log(`\n*** ENCONTRADO con adjuntos: item=${aranda_item_id} seg=${aranda_segment} ***`);
      console.log(JSON.stringify(res.data, null, 2));
      break;
    }
  }

  console.log(`\n--- sondear POST para upload ---`);
  // POST sin payload — solo para ver si el endpoint existe (espera 400/415 si existe).
  for (const path of [
    `/item/370098/4/${USER}/files`,
    `/item/370098/4/${USER}/file`,
    `/item/370098/4/${USER}/file/add`,
    `/item/370098/4/${USER}/upload`,
    `/file/add/370098/4/${USER}`
  ]) {
    try {
      const r = await axios.post(`${config.ARANDA_BASE_URL}${path}`, {}, {
        headers: { Authorization: arandaClient.sessionId },
        validateStatus: () => true
      });
      const body = typeof r.data === 'string' ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 200);
      console.log(`POST ${path} → ${r.status} ${body}`);
    } catch (e) {
      console.log(`POST ${path} → ERR ${e.message}`);
    }
  }

  await closeDB();
}

main().catch(e => { console.error(e); process.exit(1); });
