import he from 'he';

export function coerceInt(v, def = null) {
  if (v == null || v === '') return def;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : def;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
  }
  if (typeof v === 'object' && 'id' in v) return coerceInt(v.id, def);
  return def;
}

export function extractStr(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    return v.name || v.completename || v.realname || v.firstname || v.login || null;
  }
  return null;
}

export function extractName(v) {
  if (!v) return null;
  if (Array.isArray(v)) {
    const first = v.find(x => x && (x.name || x.completename)) || v[0];
    return first ? (first.name || first.completename || null) : null;
  }
  if (typeof v === 'object') return v.name || v.completename || null;
  if (typeof v === 'string') return v;
  return null;
}

export function normalizeHtml(v, maxLen = null) {
  if (v == null) return '';
  let s = typeof v === 'string' ? v : String(v);
  s = he.decode(s);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>\s*<p>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
  if (maxLen && s.length > maxLen) return s.slice(0, maxLen - 1) + '…';
  return s;
}

export function parseNumericId(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/(\d+)/);
    return m ? Number(m[1]) : NaN;
  }
  return NaN;
}

// Convierte respuesta Aranda [{Field,Value}, ...] → objeto plano.
export function fieldsArrayToObject(arr) {
  const out = {};
  if (Array.isArray(arr)) {
    for (const it of arr) if (it && it.Field != null) out[it.Field] = it.Value;
  } else if (arr && typeof arr === 'object') return arr;
  return out;
}

export function truthy(v) {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'ok' || s === 'success';
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Tag marker insertado en GLPI cuando un ticket/followup viene de Aranda — base del anti-bucle.
export const FROM_ARANDA_TAG = '[from aranda]';
// Tag legacy del MVP. Sigue siendo válido y se mantiene para retrocompatibilidad.
export const LEGACY_BACKLINK_PREFIX = 'caso aranda:';

// Markers que el bot ANTEPONE al contenido cuando inserta en Aranda. Son la única forma confiable
// de distinguir nuestras propias inserciones de las que hace un humano usando la misma cuenta del bot
// (Atena_GLPI es compartida). El filtro anti-bucle de arandaNotesPull se basa en estos markers.
export const NOTE_FROM_GLPI_MARKER = '[Nota GLPI]';
export const TASK_FROM_GLPI_MARKER = '[Tarea GLPI]';

export function hasArandaMarker(text) {
  if (!text) return false;
  const t = String(text).trim().toLowerCase();
  return t.startsWith(FROM_ARANDA_TAG.toLowerCase()) || t.startsWith(LEGACY_BACKLINK_PREFIX);
}

// True si el contenido viene de una inserción que hizo el propio bot en Aranda.
// Usado por arandaNotesPull para descartar ecos sin depender del AuthorName (que puede ser
// la misma cuenta que un humano use manualmente).
export function hasOwnGlpiMarker(text) {
  if (!text) return false;
  const t = String(text).trim().toLowerCase();
  return t.startsWith(NOTE_FROM_GLPI_MARKER.toLowerCase()) || t.startsWith(TASK_FROM_GLPI_MARKER.toLowerCase());
}
