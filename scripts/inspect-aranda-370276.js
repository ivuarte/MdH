#!/usr/bin/env node
// Inspect Aranda item 370276 (mapped to GLPI ticket 43006).
// Goal: encontrar dónde quedó la solución que el operador agregó.

import 'dotenv/config';
import { config, validateConfig } from '../src/config.js';
import { arandaClient } from '../src/lib/arandaClient.js';

const ITEM = 370276;
const SEG  = 4;

async function main() {
  validateConfig();
  await arandaClient.ensureLogin();

  console.log('=== /item/note/list ===');
  const notes = await arandaClient.getItemNoteList(ITEM, SEG);
  console.log(`total notas: ${notes?.length ?? '?'}`);
  if (Array.isArray(notes)) {
    for (const n of notes) {
      const desc = (n.Description || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      console.log(`  ${n.CreationDate} | ActionType=${n.ActionType} (${n.ActionName}) | ${desc.slice(0, 120)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
