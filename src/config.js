import 'dotenv/config';

function asInt(v, def) {
  if (v == null || v === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function asBool(v, def = false) {
  if (v == null) return def;
  const s = String(v).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return def;
}

function asStr(v, def = null) {
  if (v == null || v === '') return def;
  return String(v);
}

export const config = {
  env: process.env.NODE_ENV || 'production',
  logLevel: asStr(process.env.LOG_LEVEL, 'info'),
  logFormat: asStr(process.env.LOG_FORMAT, 'json'),

  // GLPI
  GLPI_BASE_URL: asStr(process.env.GLPI_BASE_URL),
  APP_TOKEN: asStr(process.env.APP_TOKEN),
  USER_TOKEN: asStr(process.env.USER_TOKEN),
  SESSION_TOKEN: asStr(process.env.SESSION_TOKEN),
  GLPI_FILTER_USER: asStr(process.env.GLPI_FILTER_USER, 'controles (1628)'),
  GLPI_TIMEOUT_MS: asInt(process.env.GLPI_TIMEOUT_MS, 30000),
  GLPI_RATE_LIMIT: asInt(process.env.GLPI_RATE_LIMIT, 10),

  // MySQL
  DB_HOST: asStr(process.env.DB_HOST, '127.0.0.1'),
  DB_PORT: asInt(process.env.DB_PORT, 3306),
  DB_USER: asStr(process.env.DB_USER, 'root'),
  DB_PASS: asStr(process.env.DB_PASS, 'root'),
  DB_NAME: asStr(process.env.DB_NAME, 'mdh'),
  DB_POOL_LIMIT: asInt(process.env.DB_POOL_LIMIT, 10),

  // Sincronización
  POLL_INTERVAL: asInt(process.env.POLL_INTERVAL, 20),

  // Reintentos / Circuit breaker
  RETRY_MAX_ATTEMPTS: asInt(process.env.RETRY_MAX_ATTEMPTS, 5),
  RETRY_BASE_MS: asInt(process.env.RETRY_BASE_MS, 1000),
  RETRY_MAX_MS: asInt(process.env.RETRY_MAX_MS, 30000),
  CIRCUIT_THRESHOLD: asInt(process.env.CIRCUIT_THRESHOLD, 5),
  CIRCUIT_RESET_MS: asInt(process.env.CIRCUIT_RESET_MS, 60000),

  // Aranda
  ARANDA_BASE_URL: asStr(process.env.ARANDA_BASE_URL, 'https://mesadeserviciostic.hacienda.go.cr/ASDKAPI/api/v8.6'),
  ARANDA_USERNAME: asStr(process.env.ARANDA_USERNAME),
  ARANDA_PASSWORD: asStr(process.env.ARANDA_PASSWORD),
  ARANDA_TIMEOUT_MS: asInt(process.env.ARANDA_TIMEOUT_MS, 30000),
  ARANDA_RATE_LIMIT: asInt(process.env.ARANDA_RATE_LIMIT, 5),
  ARANDA_AUTHOR_ID: asInt(process.env.ARANDA_AUTHOR_ID, 2314762),
  ARANDA_CATEGORY_ID: asInt(process.env.ARANDA_CATEGORY_ID, 722),
  ARANDA_CUSTOMER_ID: asInt(process.env.ARANDA_CUSTOMER_ID, 5081),
  ARANDA_GROUP_ID: asInt(process.env.ARANDA_GROUP_ID, 14),
  ARANDA_PROJECT_ID: asInt(process.env.ARANDA_PROJECT_ID, 1),
  ARANDA_REGISTRY_TYPE_ID: asInt(process.env.ARANDA_REGISTRY_TYPE_ID, 6),
  ARANDA_SERVICE_ID: asInt(process.env.ARANDA_SERVICE_ID, 551),
  ARANDA_SLA_ID: asInt(process.env.ARANDA_SLA_ID, 913),
  ARANDA_URGENCY_ID: asInt(process.env.ARANDA_URGENCY_ID, 3),
  ARANDA_COMPANY_ID: asInt(process.env.ARANDA_COMPANY_ID, null),
  ARANDA_RESPONSIBLE_ID: asInt(process.env.ARANDA_RESPONSIBLE_ID, null),
  ARANDA_DEFAULT_GLPI_TYPE_FROM_SEGMENT: asInt(process.env.ARANDA_DEFAULT_GLPI_TYPE_FROM_SEGMENT, 2),

  // Inbound (Aranda → GLPI)
  ARANDA_PULL_PAGE_SIZE: asInt(process.env.ARANDA_PULL_PAGE_SIZE, 50),
  INBOUND_GLPI_REQUESTER_ID: asInt(process.env.INBOUND_GLPI_REQUESTER_ID, null),

  // Anti-eco
  ANTI_ECHO_WINDOW_SECONDS: asInt(process.env.ANTI_ECHO_WINDOW_SECONDS, 60),

  // Health
  HEALTH_FILE: asStr(process.env.HEALTH_FILE, 'state/health.json'),

  // Servicios habilitados (CSV) — vacío significa todos
  SERVICES_ENABLED: asStr(process.env.SERVICES_ENABLED, ''),

  // Migraciones automáticas al iniciar
  RUN_MIGRATIONS_ON_START: asBool(process.env.RUN_MIGRATIONS_ON_START, true)
};

export function validateConfig() {
  const required = [
    ['GLPI_BASE_URL', config.GLPI_BASE_URL],
    ['APP_TOKEN', config.APP_TOKEN],
    ['USER_TOKEN', config.USER_TOKEN],
    ['DB_HOST', config.DB_HOST],
    ['DB_USER', config.DB_USER],
    ['DB_NAME', config.DB_NAME],
    ['ARANDA_BASE_URL', config.ARANDA_BASE_URL],
    ['ARANDA_USERNAME', config.ARANDA_USERNAME],
    ['ARANDA_PASSWORD', config.ARANDA_PASSWORD],
    ['ARANDA_AUTHOR_ID', config.ARANDA_AUTHOR_ID]
  ];
  const missing = required.filter(([, v]) => v == null || v === '').map(([k]) => k);
  if (missing.length) {
    throw new Error(`Faltan variables requeridas: ${missing.join(', ')}`);
  }
  if (config.POLL_INTERVAL < 5) {
    throw new Error(`POLL_INTERVAL muy bajo (${config.POLL_INTERVAL}s). Mínimo 5s.`);
  }
}

export function isServiceEnabled(name) {
  const csv = (config.SERVICES_ENABLED || '').trim();
  if (!csv) return true;
  return csv.split(',').map(s => s.trim()).includes(name);
}
