import { getDB } from './db.js';
import { config } from '../config.js';
import { sha256 } from './hash.js';

// Registra que una operación de sincronización ocurrió, para detectar ecos en el sentido inverso.
export async function recordEvent({ direction, entityType, srcId, dstId = null, content = null }) {
  const hash = content != null ? sha256(content) : null;
  await getDB().query(
    `INSERT INTO sync_events (direction, entity_type, entity_id_src, entity_id_dst, content_hash)
     VALUES (?, ?, ?, ?, ?)`,
    [direction, entityType, String(srcId), dstId != null ? String(dstId) : null, hash]
  );
}

// True si recientemente propagamos algo equivalente en la dirección opuesta — útil para evitar reaplicar el mismo cambio que acabamos de empujar.
export async function recentInverseEvent({ direction, entityType, srcId = null, dstId = null, contentHash = null, windowSeconds = null }) {
  const window = Number.isFinite(windowSeconds) ? windowSeconds : config.ANTI_ECHO_WINDOW_SECONDS;
  const inverse = direction === 'GLPI_TO_ARANDA' ? 'ARANDA_TO_GLPI' : 'GLPI_TO_ARANDA';

  const conds = ['direction = ?', 'entity_type = ?', 'ts > (NOW() - INTERVAL ? SECOND)'];
  const params = [inverse, entityType, window];

  if (srcId != null) {
    conds.push('(entity_id_src = ? OR entity_id_dst = ?)');
    params.push(String(srcId), String(srcId));
  }
  if (dstId != null) {
    conds.push('(entity_id_src = ? OR entity_id_dst = ?)');
    params.push(String(dstId), String(dstId));
  }
  if (contentHash) {
    conds.push('content_hash = ?');
    params.push(contentHash);
  }

  const [rows] = await getDB().query(
    `SELECT 1 FROM sync_events WHERE ${conds.join(' AND ')} LIMIT 1`,
    params
  );
  return rows.length > 0;
}
