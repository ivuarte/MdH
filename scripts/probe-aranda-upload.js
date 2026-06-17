#!/usr/bin/env node
// Última sonda: inspeccionar respuesta GET para descubrir hint de upload URL,
// y reintentar con sesión recién emitida (por si la permisología nueva exige relogin).

import 'dotenv/config';
import axios from 'axios';
import { config, validateConfig } from '../src/config.js';
import { arandaClient } from '../src/lib/arandaClient.js';
import { initDB, getDB, closeDB } from '../src/lib/db.js';

const USER = config.ARANDA_AUTHOR_ID;

async function main() {
  validateConfig();
  await initDB(config);

  // Forzar relogin para asegurar que tomamos permisos nuevos.
  arandaClient.sessionId = null;
  await arandaClient.ensureLogin();
  console.log(`session fresca: ${arandaClient.sessionId.slice(0, 24)}...\n`);

  // Buscar un item que tenga archivos para inspeccionar el esquema completo
  const [rows] = await getDB().query(
    `SELECT aranda_item_id, aranda_segment FROM aranda_inbound_items
     WHERE aranda_segment IS NOT NULL ORDER BY detected_at DESC LIMIT 20`
  );

  let sample = null;
  for (const { aranda_item_id, aranda_segment } of rows) {
    const r = await axios.get(
      `${config.ARANDA_BASE_URL}/item/${aranda_item_id}/${aranda_segment}/${USER}/files`,
      { headers: { Authorization: arandaClient.sessionId }, validateStatus: () => true, timeout: 15000 }
    );
    if (r.status === 200 && Array.isArray(r.data) && r.data.length) {
      sample = { item: aranda_item_id, seg: aranda_segment, data: r.data };
      break;
    }
  }

  if (sample) {
    console.log(`Sample con archivos: item=${sample.item} seg=${sample.seg}`);
    console.log('Schema:', Object.keys(sample.data[0]));
    console.log('Primer file:', JSON.stringify(sample.data[0], null, 2).slice(0, 500));
  } else {
    console.log('Sin items con archivos en la muestra.');
  }

  // Re-probar el endpoint principal con la sesión fresca
  console.log('\n=== Re-probar POST con sesión fresca ===');
  const itemId = sample?.item ?? 370263;
  const seg = sample?.seg ?? 4;
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('test upload')], { type: 'text/plain' }), 'probe.txt');
  const r = await axios.post(
    `${config.ARANDA_BASE_URL}/item/${itemId}/${seg}/${USER}/files`,
    fd,
    { headers: { Authorization: arandaClient.sessionId, 'Content-Type': undefined }, validateStatus: () => true }
  );
  const body = typeof r.data === 'string' ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 200);
  const allow = r.headers?.allow ?? r.headers?.Allow ?? '(no Allow header)';
  console.log(`POST → ${r.status}  Allow="${allow}"  body=${body}`);

  await closeDB();
}

main().catch(e => { console.error(e); process.exit(1); });
