import axios from 'axios';
import { logger } from './logger.js';
import { config } from '../config.js';

export const glpi = axios.create({
  baseURL: config.GLPI_BASE_URL,
  timeout: 30000,
  headers: {
    'App-Token': config.APP_TOKEN,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  },
  validateStatus: s => s >= 200 && s < 300
});

let sessionToken = config.SESSION_TOKEN || null;

export async function ensureSession() {
  if (sessionToken) return sessionToken;
  if (!config.USER_TOKEN) {
    throw new Error('Falta USER_TOKEN para iniciar sesión en GLPI');
  }
  const { data } = await glpi.post(
    `/initSession?app_token=${encodeURIComponent(config.APP_TOKEN)}&user_token=${encodeURIComponent(config.USER_TOKEN)}`
  );
  sessionToken = data?.session_token;
  if (!sessionToken) throw new Error('No se obtuvo session_token de GLPI');
  logger.info('[GLPI] Sesión iniciada.');
  return sessionToken;
}

export function authHeaders() {
  if (!sessionToken) throw new Error('No hay Session-Token aún.');
  return {
    'Session-Token': sessionToken,
    'App-Token': config.APP_TOKEN,
    'Accept': 'application/json'
  };
}

export function invalidateSession() {
  sessionToken = null;
}
