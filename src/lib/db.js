import mysql from 'mysql2/promise';
import { logger } from './logger.js';

let pool = null;

export async function initDB(cfg) {
  pool = await mysql.createPool({
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    user: cfg.DB_USER,
    password: cfg.DB_PASS,
    database: cfg.DB_NAME,
    connectionLimit: 10
  });
  await pool.query('SELECT 1');
  logger.info('[DB] Conectado a', cfg.DB_NAME);
  return pool;
}

export function getDB() {
  if (!pool) throw new Error('DB pool no inicializado');
  return pool;
}

export async function closeDB() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('[DB] Pool cerrado');
  }
}
