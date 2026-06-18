#!/usr/bin/env node
// Prueba de compatibilidad: corre todos los endpoints GLPI que el daemon usa
// contra una instancia destino (típicamente la nueva GLPI 11.0.7 de producción).
// Sirve para descubrir incompatibilidades ANTES de apuntar el daemon allí.
//
// Uso:
//   GLPI_BASE_URL=https://glpi-pro.example.com/apirest.php \
//   APP_TOKEN=xxx USER_TOKEN=yyy \
//   TICKET_ID=42558 \
//   node scripts/probe-glpi11-compat.js
//
// Las credenciales se pueden tomar del .env (mismo formato que el daemon).

import 'dotenv/config';
import axios from 'axios';
import { config, validateConfig } from '../src/config.js';

const TICKET_ID = Number(process.env.TICKET_ID || 0) || null;

const results = [];

function pad(s, n) { return String(s).padEnd(n); }

async function probe(label, opts) {
  const url = config.GLPI_BASE_URL + opts.path + (opts.query || '');
  try {
    const r = await axios.request({
      method: opts.method,
      url,
      headers: {
        'Content-Type': 'application/json',
        'App-Token': config.APP_TOKEN,
        ...(opts.session ? { 'Session-Token': opts.session } : {}),
        ...(opts.range ? { Range: opts.range } : {}),
        ...(opts.headers || {})
      },
      data: opts.data,
      validateStatus: () => true,
      timeout: 15000
    });
    const status = r.status;
    const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    const verdict = status >= 200 && status < 300 ? 'OK' : 'FAIL';
    results.push({ label, method: opts.method, path: opts.path + (opts.query || ''), status, verdict, body: body.slice(0, 100) });
    return r;
  } catch (e) {
    results.push({ label, method: opts.method, path: opts.path + (opts.query || ''), status: 'ERR', verdict: 'FAIL', body: e.message.slice(0, 100) });
    return null;
  }
}

async function main() {
  validateConfig();
  if (!config.APP_TOKEN || !config.USER_TOKEN || !config.GLPI_BASE_URL) {
    console.error('Faltan GLPI_BASE_URL / APP_TOKEN / USER_TOKEN');
    process.exit(1);
  }

  console.log(`# probe-glpi11-compat`);
  console.log(`base: ${config.GLPI_BASE_URL}`);
  console.log(`ticket de prueba: ${TICKET_ID || '(no se pasaron pruebas dependientes de ticket)'}\n`);

  // 1) Auth
  let session = null;
  const init = await probe('initSession (query app+user_token)', {
    method: 'GET',
    path: '/initSession',
    query: `?app_token=${encodeURIComponent(config.APP_TOKEN)}&user_token=${encodeURIComponent(config.USER_TOKEN)}`
  });
  if (init && init.status === 200) {
    session = init.data?.session_token;
    if (!session) {
      console.error('initSession 200 sin session_token. Abortando.');
      process.exit(1);
    }
  } else {
    console.error('initSession falló. Abortando — sin sesión no podemos seguir.');
    printReport();
    process.exit(1);
  }

  // 2) /Log top-level (riesgo principal en GLPI 11)
  await probe('LEGACY /Log top-level (order=DESC)', {
    method: 'GET', path: '/Log', query: '?order=DESC', session, range: 'items=0-9'
  });

  // 2b) /search/Log — alternativa documentada para GLPI 11
  await probe('NUEVO  /search/Log', {
    method: 'GET', path: '/search/Log', query: '?order=DESC&range=0-9', session
  });

  // 2c) /search/Ticket por date_mod — workaround si /Log no funciona
  await probe('NUEVO  /search/Ticket (orden por date_mod)', {
    method: 'GET',
    path: '/search/Ticket',
    query: '?sort=19&order=DESC&range=0-4',  // 19 = date_mod en la searchoption estándar
    session
  });

  // 3) CRUD Ticket
  if (TICKET_ID) {
    await probe('GET /Ticket/{id}',                       { method: 'GET',  path: `/Ticket/${TICKET_ID}`, session });
    await probe('GET /Ticket/{id}?expand_dropdowns=true', { method: 'GET',  path: `/Ticket/${TICKET_ID}`, query: '?expand_dropdowns=true', session });
    await probe('GET /Ticket/{id}/ITILFollowup',          { method: 'GET',  path: `/Ticket/${TICKET_ID}/ITILFollowup`, session });
    await probe('GET /Ticket/{id}/ITILSolution',          { method: 'GET',  path: `/Ticket/${TICKET_ID}/ITILSolution`, session });
    await probe('GET /Ticket/{id}/TicketTask',            { method: 'GET',  path: `/Ticket/${TICKET_ID}/TicketTask`, session });
    await probe('GET /Ticket/{id}/Document_Item',         { method: 'GET',  path: `/Ticket/${TICKET_ID}/Document_Item`, session });
    await probe('GET /Ticket/{id}/Log (subresource)',     { method: 'GET',  path: `/Ticket/${TICKET_ID}/Log`, session, range: 'items=0-9' });
  }

  // 4) Document
  const ALT_DOC_ID = Number(process.env.GLPI_DOCUMENT_ID || 0);
  if (ALT_DOC_ID) {
    await probe('GET /Document/{id}',           { method: 'GET', path: `/Document/${ALT_DOC_ID}`, session });
    await probe('GET /Document/{id}?alt=media', { method: 'GET', path: `/Document/${ALT_DOC_ID}`, query: '?alt=media', session, headers: { Accept: 'application/octet-stream' } });
  } else {
    console.log('(GLPI_DOCUMENT_ID no seteado — saltando /Document/{id})');
  }

  // 5) High-Level API v2 — chequear si está disponible (informativo)
  await probe('(info) /v2 root (HL API v2)', { method: 'GET', path: '/v2', session });

  // killSession
  await probe('killSession', { method: 'GET', path: '/killSession', session });

  printReport();
}

function printReport() {
  console.log('\n=== Reporte ===');
  console.log(pad('label', 50) + pad('method', 8) + pad('status', 8) + 'verdict');
  console.log('-'.repeat(78));
  for (const r of results) {
    console.log(pad(r.label.slice(0, 49), 50) + pad(r.method, 8) + pad(r.status, 8) + r.verdict);
  }
  console.log('');

  const fails = results.filter(r => r.verdict === 'FAIL');
  if (fails.length === 0) {
    console.log('TODO OK — el daemon debería funcionar tal cual contra esta instancia.');
  } else {
    console.log(`FALLOS (${fails.length}):`);
    for (const r of fails) {
      console.log(`  [${r.method}] ${r.path}`);
      console.log(`     status=${r.status}  body=${r.body}`);
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
