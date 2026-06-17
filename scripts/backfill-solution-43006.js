#!/usr/bin/env node
// Backfill manual: corre un tick del nuevo arandaSolutionPull para procesar el
// ticket 43006 (Aranda item 370276) que ya está en Resuelto.

import 'dotenv/config';
import { config, validateConfig } from '../src/config.js';
import { initDB, getDB, closeDB } from '../src/lib/db.js';
import { ArandaSolutionPullService } from '../src/services/arandaSolutionPull.js';
import { arandaClient } from '../src/lib/arandaClient.js';
import { glpiClient } from '../src/lib/glpiClient.js';

async function main() {
  validateConfig();
  await initDB(config);
  await arandaClient.ensureLogin();
  await glpiClient.ensureSession();

  console.log('--- estado antes ---');
  const db = getDB();
  const [[t0]] = await db.query('SELECT id, status, ITILSolution FROM tickets WHERE id=43006');
  console.log('ticket:', JSON.stringify(t0));
  const [s0] = await db.query("SELECT solution_id, ticket_id, user_name, origin, LEFT(content,80) preview FROM ticket_solutions WHERE ticket_id=43006");
  console.log('ticket_solutions:', JSON.stringify(s0));
  const [p0] = await db.query('SELECT * FROM aranda_solution_pulls WHERE ticket_id=43006');
  console.log('aranda_solution_pulls:', JSON.stringify(p0));

  console.log('\n--- corriendo tick ---');
  const svc = new ArandaSolutionPullService({ POLL_INTERVAL: 999 });
  await svc.tick();

  console.log('\n--- estado después ---');
  const [[t1]] = await db.query('SELECT id, status, ITILSolution FROM tickets WHERE id=43006');
  console.log('ticket:', JSON.stringify(t1));
  const [s1] = await db.query("SELECT solution_id, ticket_id, user_name, origin, LEFT(content,200) preview FROM ticket_solutions WHERE ticket_id=43006");
  console.log('ticket_solutions:', JSON.stringify(s1, null, 2));
  const [p1] = await db.query('SELECT * FROM aranda_solution_pulls WHERE ticket_id=43006');
  console.log('aranda_solution_pulls:', JSON.stringify(p1, null, 2));

  // Verificar en GLPI directamente
  console.log('\n--- /Ticket/43006/ITILSolution (GLPI) ---');
  try {
    const sols = await glpiClient.getTicketSolutions(43006);
    console.log(`total: ${sols?.length ?? '?'}`);
    if (Array.isArray(sols)) {
      for (const s of sols) {
        console.log(`  id=${s.id} date=${s.date_creation}`);
        console.log(`  content: ${String(s.content).slice(0, 300)}`);
      }
    }
  } catch (err) {
    console.log('error consultando GLPI solutions:', err.message);
  }

  await closeDB();
}

main().catch(e => { console.error(e); process.exit(1); });
