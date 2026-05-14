export function coerceInt(v, def = null) {
  if (v === null || v === undefined || v === '') return def;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : def;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
  }
  if (typeof v === 'object') {
    if ('id' in v) return coerceInt(v.id, def);
  }
  return def;
}

export function extractName(v) {
  if (!v) return null;
  if (Array.isArray(v)) {
    const first = v.find(x => x && (x.name || x.completename)) || v[0];
    if (!first) return null;
    return first.name || first.completename || null;
  }
  if (typeof v === 'object') return v.name || v.completename || null;
  if (typeof v === 'string') return v;
  return null;
}

export function extractStr(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    return v.name || v.completename || v.realname || v.firstname || v.login || null;
  }
  return null;
}
