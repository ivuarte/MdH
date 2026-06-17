import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDB } from './db.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

async function ensureVersionTable() {
  await getDB().query(`
    CREATE TABLE IF NOT EXISTS _schema_version (
      version INT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      description VARCHAR(500)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function appliedVersions() {
  const [rows] = await getDB().query(`SELECT version FROM _schema_version`);
  return new Set(rows.map(r => Number(r.version)));
}

function parseFilename(name) {
  // Formato: NNN_descripcion.sql
  const m = name.match(/^(\d+)_(.+)\.sql$/i);
  if (!m) return null;
  return { version: Number(m[1]), description: m[2].replace(/_/g, ' ') };
}

function stripLineComments(s) {
  // Quita comentarios línea a línea (-- ...) preservando el resto del statement.
  return s
    .split('\n')
    .map(line => line.replace(/^\s*--.*$/, ''))
    .join('\n')
    .trim();
}

function splitStatements(sql) {
  // Divide por ';' al final de línea respetando bloques DELIMITER no soportados (mantenemos SQL simple).
  return sql
    .split(/;\s*\n/g)
    .map(stripLineComments)
    .filter(s => s.length > 0);
}

export async function runMigrations() {
  await ensureVersionTable();
  const applied = await appliedVersions();

  let files;
  try {
    files = (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort();
  } catch (err) {
    logger.warn('No hay carpeta de migraciones', { service: 'migrator', err });
    return;
  }

  for (const file of files) {
    const meta = parseFilename(file);
    if (!meta) {
      logger.warn(`Migración con nombre inválido (ignorada): ${file}`, { service: 'migrator' });
      continue;
    }
    if (applied.has(meta.version)) continue;

    const fullPath = path.join(MIGRATIONS_DIR, file);
    const sql = await readFile(fullPath, 'utf8');
    const stmts = splitStatements(sql);

    logger.info(`Aplicando migración ${file}`, { service: 'migrator', version: meta.version });
    const conn = await getDB().getConnection();
    try {
      await conn.beginTransaction();
      for (const stmt of stmts) {
        await conn.query(stmt);
      }
      await conn.query(
        `INSERT INTO _schema_version (version, description) VALUES (?, ?)`,
        [meta.version, meta.description.slice(0, 500)]
      );
      await conn.commit();
      logger.info(`Migración ${file} aplicada`, { service: 'migrator', version: meta.version });
    } catch (err) {
      try { await conn.rollback(); } catch { /* ignore */ }
      logger.error(`Migración ${file} falló`, { service: 'migrator', err });
      throw err;
    } finally {
      conn.release();
    }
  }
}
