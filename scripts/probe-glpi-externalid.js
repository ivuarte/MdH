#!/usr/bin/env node
// PROBE: confirma que GLPI acepta y devuelve el campo `externalid` del Ticket vía API.
// Uso: node scripts/probe-glpi-externalid.js <ticketId> <externalId>
import 'dotenv/config';
import { glpiClient } from '../src/lib/glpiClient.js';

const ticketId = Number(process.argv[2]);
const externalId = process.argv[3];
if (!ticketId || !externalId) { console.error('Uso: <ticketId> <externalId>'); process.exit(1); }

const before = await glpiClient.getTicketRaw(ticketId);
console.log('ANTES  externalid =', JSON.stringify(before?.externalid));

const res = await glpiClient.updateTicket({ id: ticketId, externalid: externalId });
console.log('updateTicket →', JSON.stringify(res));

const after = await glpiClient.getTicketRaw(ticketId);
console.log('DESPUÉS externalid =', JSON.stringify(after?.externalid));
process.exit(0);
