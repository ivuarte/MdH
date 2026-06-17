import mysql from 'mysql2/promise';
import { logger } from './logger.js';

let pool = null;

export async function initDB(cfg) {
  pool = mysql.createPool({
    host: cfg.DB_HOST,
    port: cfg.DB_PORT,
    user: cfg.DB_USER,
    password: cfg.DB_PASS,
    database: cfg.DB_NAME,
    connectionLimit: cfg.DB_POOL_LIMIT,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    timezone: 'Z',
    dateStrings: false,
    multipleStatements: false
  });
  await pool.query('SELECT 1');
  logger.info('DB conectada', { service: 'db', db: cfg.DB_NAME, host: cfg.DB_HOST });
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
    logger.info('DB pool cerrado', { service: 'db' });
  }
}

// Helper para ejecutar dentro de una transacción.
export async function withTransaction(fn) {
  const conn = await getDB().getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

// Cursores persistidos en BD para reanudar tras reinicio.
export async function readCursor(name, defaultValue = '0') {
  const [rows] = await getDB().query(
    `SELECT cursor_value FROM sync_cursors WHERE cursor_name = ? LIMIT 1`,
    [name]
  );
  return rows.length ? rows[0].cursor_value : defaultValue;
}

export async function writeCursor(name, value) {
  await getDB().query(
    `INSERT INTO sync_cursors (cursor_name, cursor_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE cursor_value = VALUES(cursor_value)`,
    [name, String(value)]
  );
}
