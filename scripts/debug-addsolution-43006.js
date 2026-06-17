#!/usr/bin/env node
// Debug: llamar /ITILSolution con axios crudo para ver el body de la respuesta 400.

import 'dotenv/config';
import axios from 'axios';
import { config, validateConfig } from '../src/config.js';
import { glpiClient } from '../src/lib/glpiClient.js';

async function main() {
  validateConfig();
  await glpiClient.ensureSession();

  const TICKET_ID = 43006;
  const content = '<p>Prioridad/urgencia sincronizada desde GLPI</p><p>NOTA DE PRUEBA: COMENTARIO DE SOLUCIÓN</p>';

  const r = await axios.post(
    `${config.GLPI_BASE_URL}/ITILSolution/`,
    { input: { itemtype: 'Ticket', items_id: TICKET_ID, content } },
    {
      headers: {
        'Content-Type': 'application/json',
        'Session-Token': glpiClient.sessionToken,
        'App-Token': config.APP_TOKEN
      },
      validateStatus: () => true
    }
  );

  console.log('status:', r.status);
  console.log('headers:', JSON.stringify(r.headers, null, 2));
  console.log('body:', typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
