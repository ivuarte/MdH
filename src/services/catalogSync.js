import { BaseService } from '../lib/baseService.js';
import { getDB } from '../lib/db.js';

/**
 * FASE 2 — Sincronización de catálogos de servicio entre GLPI y Aranda.
 *
 * Mapeo conceptual:
 *  - GLPI ITILCategory.id    ↔  Aranda Category.Id
 *  - GLPI ITILCategory.name  ↔  Aranda Category.Name
 *  - Adicional Aranda: Service.Id / Service.Name (línea de servicio padre, sin equivalente directo en GLPI).
 *
 * Estrategia de matching:
 *  1. Por nombre normalizado (case-insensitive, sin acentos, trim, sin duplicar espacios).
 *  2. Si no hay match, registrar como 'unmatched' para revisión manual.
 *  3. Si el operador define un mapeo manual en service_catalog_sync, respetarlo.
 *
 * Estado actual: STUB. No realiza llamadas a APIs ni escribe categorías reales.
 * Solo verifica que la tabla service_catalog_sync exista (la migración ya la creó).
 *
 * Endpoints futuros:
 *  - GLPI: GET /ITILCategory?expand_dropdowns=true&range=0-999
 *  - Aranda: endpoint(s) por confirmar — probablemente /category/list o similar dentro de ASDKAPI.
 */
export class CatalogSyncService extends BaseService {
  constructor(opts = {}) {
    super('catalogSync', opts);
    // Polling más espaciado para catálogos — cambian poco. Usa 10× POLL_INTERVAL.
    this.pollSeconds = Math.max(60, this.pollSeconds * 10);
  }

  async onStart() {
    // Verificación liviana de que la infra está lista; no carga datos.
    await getDB().query(`SELECT 1 FROM service_catalog_sync LIMIT 1`).catch(() => {});
    this.log.info('STUB: catálogos no implementado todavía (Fase 2)');
  }

  async tick() {
    // TODO Fase 2: implementar
    //   1. pullGlpiCategories()  → arreglo {id, name, path}
    //   2. pullArandaCategories() → arreglo {id, name, serviceId, serviceName}
    //   3. matchByName(glpi, aranda) → propone mappings
    //   4. upsertMapping(rows) en service_catalog_sync con status='pending'|'matched'
    //   5. (Opcional) Crear categorías faltantes en la herramienta destino bajo flag.
  }

  // -- métodos stub que se completarán en Fase 2 --

  // eslint-disable-next-line no-unused-vars
  async pullGlpiCategories() {
    // return glpiClient.get('/ITILCategory?expand_dropdowns=true', { range: 'items=0-999' });
    return [];
  }

  // eslint-disable-next-line no-unused-vars
  async pullArandaCategories() {
    // Endpoint exacto a confirmar con Aranda. Ejemplo conceptual:
    // return arandaClient.post('/category/list', { Paging: {...}, ProjectId: config.ARANDA_PROJECT_ID });
    return [];
  }

  // eslint-disable-next-line no-unused-vars
  matchByName(glpiList, arandaList) {
    // Normaliza nombre: lowercase, sin acentos, trim, sin espacios duplicados.
    return [];
  }

  // eslint-disable-next-line no-unused-vars
  async upsertMapping(mappings) {
    // INSERT/UPDATE service_catalog_sync.
  }
}
