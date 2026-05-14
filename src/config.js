import 'dotenv/config';

function int(v, def) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  env: process.env.NODE_ENV || 'production',

  // GLPI
  GLPI_BASE_URL: process.env.GLPI_BASE_URL,
  APP_TOKEN: process.env.APP_TOKEN,
  USER_TOKEN: process.env.USER_TOKEN,
  SESSION_TOKEN: process.env.SESSION_TOKEN || null,

  // DB
  DB_HOST: process.env.DB_HOST || '127.0.0.1',
  DB_PORT: int(process.env.DB_PORT, 3306),
  DB_USER: process.env.DB_USER || 'root',
  DB_PASS: process.env.DB_PASS || 'root',
  DB_NAME: process.env.DB_NAME || 'mdh',

  // Tickets service
  POLL_INTERVAL: int(process.env.POLL_INTERVAL, 20),  // seconds
  GLPI_FILTER_USER: process.env.GLPI_FILTER_USER || 'controles (1628)',

    // --- Aranda ---
  ARANDA_BASE_URL: process.env.ARANDA_BASE_URL || 'https://mesadeserviciostic.hacienda.go.cr/ASDKAPI/api/v8.6',
  ARANDA_USERNAME: process.env.ARANDA_USERNAME || 'Atena_GLPI',
  ARANDA_PASSWORD: process.env.ARANDA_PASSWORD || 'At3N46Lp1',

  // Campos fijos requeridos por Aranda (puedes cambiarlos por .env)
  ARANDA_AUTHOR_ID: Number.parseInt(process.env.ARANDA_AUTHOR_ID ?? '2314762', 10),
  ARANDA_CATEGORY_ID: Number.parseInt(process.env.ARANDA_CATEGORY_ID ?? '722', 10),
  ARANDA_CUSTOMER_ID: Number.parseInt(process.env.ARANDA_CUSTOMER_ID ?? '5081', 10),
  ARANDA_GROUP_ID: Number.parseInt(process.env.ARANDA_GROUP_ID ?? '14', 10),
  ARANDA_PROJECT_ID: Number.parseInt(process.env.ARANDA_PROJECT_ID ?? '1', 10),
  ARANDA_REGISTRY_TYPE_ID: Number.parseInt(process.env.ARANDA_REGISTRY_TYPE_ID ?? '6', 10),
  ARANDA_SERVICE_ID: Number.parseInt(process.env.ARANDA_SERVICE_ID ?? '551', 10),
  ARANDA_SLA_ID: Number.parseInt(process.env.ARANDA_SLA_ID ?? '913', 10),
  ARANDA_URGENCY_ID: Number.parseInt(process.env.ARANDA_URGENCY_ID ?? '3', 10),
  // Opcional:
  ARANDA_COMPANY_ID: process.env.ARANDA_COMPANY_ID ? Number.parseInt(process.env.ARANDA_COMPANY_ID, 10) : null,
  ARANDA_RESPONSIBLE_ID: process.env.ARANDA_RESPONSIBLE_ID ? Number.parseInt(process.env.ARANDA_RESPONSIBLE_ID, 10) : null


};

export function validateConfig() {
  const missing = [];
  if (!config.GLPI_BASE_URL) missing.push('GLPI_BASE_URL');
  if (!config.APP_TOKEN) missing.push('APP_TOKEN');
  if (missing.length) {
    throw new Error(`Faltan variables requeridas: ${missing.join(', ')}`);
  }
}
