import { BaseService } from '../lib/baseService.js';
import { getDB } from '../lib/db.js';

/**
 * Catálogo de categorías GLPI ↔ Aranda.
 *
 * El mapeo (GLPI ITILCategory ↔ Aranda subcategoría + segmento) **ya está implementado**:
 *  - Se carga en la tabla `service_catalog_sync` con `scripts/seed-catalog-local.js`
 *    (cruce por nombre normalizado contra `Libro1.utf8.csv`; idempotente, agnóstico de IDs).
 *  - Lo consumen `arandaTicketPush` (GLPI→Aranda) y `arandaTicketPull` (inverso) vía JOIN.
 *
 * Este servicio NO carga el catálogo (eso es manual/seed, porque cambia poco y Aranda no
 * expone un endpoint de categorías al rol del bot). Su rol es de **monitoreo liviano**:
 * reporta al arrancar cuántos mapeos hay activos y avisa si la tabla está vacía.
 */
export class CatalogSyncService extends BaseService {
  constructor(opts = {}) {
    super('catalogSync', opts);
    // Polling muy espaciado — el catálogo es estático (se siembra con un script). Usa 10× POLL_INTERVAL.
    this.pollSeconds = Math.max(60, this.pollSeconds * 10);
  }

  async tick() {
    // El catálogo no se sincroniza por polling (se siembra con scripts/seed-catalog-local.js).
    // BaseService.start() ejecuta un tick inmediato, así que esto reporta al arrancar y luego
    // re-verifica la cobertura periódicamente por si la tabla se vaciara o recargara.
    await this.reportCoverage();
  }

  async reportCoverage() {
    try {
      const [[row]] = await getDB().query(
        `SELECT COUNT(*) AS total,
                SUM(status = 'matched') AS matched
           FROM service_catalog_sync`
      );
      const total = Number(row?.total || 0);
      const matched = Number(row?.matched || 0);
      if (matched > 0) {
        this.log.info(`Catálogo activo: ${matched} mapeos GLPI↔Aranda cargados (service_catalog_sync, ${total} filas)`);
      } else {
        this.log.warn('Catálogo VACÍO: service_catalog_sync sin mapeos. Ejecuta `node scripts/seed-catalog-local.js` (los tickets caerán al ARANDA_CATEGORY_ID por defecto hasta entonces).');
      }
    } catch (err) {
      this.log.warn('No se pudo verificar la cobertura del catálogo', { err: err?.message });
    }
  }
}
