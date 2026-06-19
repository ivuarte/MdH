# MdH v2 — Plan de Implementación + Decisiones Tomadas

> Documento vivo. Refleja el plan original, qué se construyó realmente, los descubrimientos hechos durante la implementación, y qué queda pendiente para Fase 2.

---

## 1. Estado del Sistema

**Versión actual: 2.0.0 — Producción**

| Componente | Estado |
|------------|--------|
| 17 servicios polleres | ✅ implementados |
| 5 migraciones SQL | ✅ aplicadas |
| Anti-bucle multi-capa | ✅ funcionando |
| Bidireccionalidad completa (tickets, notas, tareas, estados) | ✅ verificada en producción |
| Circuit breaker + reintentos exponenciales + rate limit | ✅ |
| Logging JSON + health check + cursores persistidos | ✅ |
| Urgencia/prioridad bidireccional con mapeo lossy documentado | ✅ |
| **Catálogo de categorías GLPI ↔ subcategorías Aranda + segmento** | ✅ (77 mapeos — cobertura completa Aranda, árbol GLPI reorganizado bajo MDH) |
| **Adjuntos Aranda → GLPI (binario real)** | ✅ |
| **Adjuntos GLPI → Aranda (workaround: nota anunciando)** | ✅ |

Casos validados E2E: GLPI **42558** ↔ Aranda **368801**, GLPI **42586** ↔ Aranda **RF-369472-1-168565**.

---

## 2. Análisis de Gaps Original (MVP → Producción)

### 2.1 Funcionalidad

| Capacidad | MVP | Producción |
|-----------|-----|------------|
| GLPI → Aranda crear ticket | ✅ | ✅ |
| GLPI → Aranda followups | ✅ | ✅ |
| GLPI → Aranda solución | ✅ | ✅ |
| GLPI → Aranda estado | ✅ | ✅ |
| **Aranda → GLPI crear ticket** | ❌ | ✅ |
| **Aranda → GLPI notas** | ❌ | ✅ |
| Aranda → GLPI estado | ✅ | ✅ refinado |
| **GLPI ↔ Aranda TAREAS** | ❌ | ✅ (no estaba en el plan original) |
| Marca `origin` por entidad | ❌ | ✅ |
| Anti-bucle multi-capa | parcial | ✅ |
| Idempotencia robusta | parcial | ✅ |
| Reintentos exponenciales | ❌ (1 retry) | ✅ |
| Circuit breaker | ❌ | ✅ |
| Rate limiting | ❌ | ✅ |
| Logging estructurado JSON | ❌ | ✅ |
| Migraciones versionadas | ❌ | ✅ |
| Health check | ❌ | ✅ |
| Cursores persistidos | ❌ | ✅ |
| Catálogo de categorías (mapeo GLPI↔Aranda) | ❌ | ✅ (77 mapeos en `service_catalog_sync`; servicio `catalogSync` = monitoreo) |

### 2.2 Problemas técnicos resueltos del MVP

1. **`CREATE TABLE` disperso en cada servicio** → centralizado en `migrations/*.sql` con `_schema_version`.
2. **`lastSeenLogId` en memoria** → persistido en `sync_cursors`.
3. **3 clientes Axios para Aranda** → un único `arandaClient.js` singleton.
4. **Logger primitivo** → JSON estructurado con `child(defaults)` por servicio.
5. **Reintentos solo en 401/403, 1 pasada** → `withRetry` exponencial 5 intentos + jitter.
6. **Sin idempotencia explícita** → `INSERT ... ON DUPLICATE KEY UPDATE` universal + PK natural.
7. **Anti-bucle débil (sólo texto)** → 3 capas: `origin` + autor/marker + `sync_events`.
8. **Sin Aranda → GLPI para tickets** → `arandaTicketPull` + `arandaNotesPull` agregados.
9. **Estado no reanudable** → cursores en BD; el sistema arranca limpio donde quedó.
10. **Sin validación al inicio** → `validateConfig` + `preflightChecks` (GLPI + Aranda + DB).

---

## 3. Arquitectura Final (lo que se construyó)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       src/index.js (orquestador)                          │
│  validateConfig → initDB → runMigrations → preflightChecks                │
│  → ServiceManager.startAll(13) → SIGINT/SIGTERM (graceful 5s)             │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
┌─────────────────────────────┴────────────────────────────────────────────┐
│                     lib/                                                  │
│  config.js (tipado + validate)  logger.js (JSON + child)  db.js (pool +   │
│  withTransaction + cursores)  glpiClient.js  arandaClient.js              │
│  retry.js  circuitBreaker.js  rateLimiter.js  syncEvents.js  hash.js      │
│  health.js  migrator.js  utils.js  baseService.js                         │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │
┌─────────────────────────────┴────────────────────────────────────────────┐
│                     services/  (13 polleres)                              │
│                                                                           │
│  GLPI → MySQL  (4)                                                        │
│    glpiTicketSync · glpiFollowupSync · glpiSolutionSync · glpiTaskSync   │
│                                                                           │
│  MySQL → Aranda  (5) — solo origin=GLPI                                  │
│    arandaTicketPush · arandaBacklinkToGlpi · arandaNotesPush ·           │
│    arandaTasksPush · arandaSolutionPush                                  │
│                                                                           │
│  Aranda → MySQL → GLPI  (2) — agregados respecto al MVP                  │
│    arandaTicketPull · arandaNotesPull                                    │
│                                                                           │
│  Estados bidireccional  (1)                                              │
│    statusSync (PUSH+PULL en Promise.all + anti-eco)                       │
│                                                                           │
│  Monitoreo del catálogo  (1)                                              │
│    catalogSync (reporta cobertura de service_catalog_sync; no carga datos)│
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Decisión importante: 13 servicios, no 11 (como decía el plan original)

Durante la implementación se descubrió que **GLPI distingue ITILFollowup (comentarios) de TicketTask (tareas)** y son entidades separadas con endpoints distintos. El plan original solo contemplaba followups. Se agregaron 2 servicios nuevos:

- `glpiTaskSync` — detecta `TicketTask` por polling directo (no aparece confiable en `/Log`).
- `arandaTasksPush` — propaga tareas GLPI a Aranda como notas con prefijo `[Tarea GLPI]`.

Y se extendió `arandaNotesPull` para distinguir entries Aranda `ActionType=16` (NOTA → GLPI followup) de `ActionType=22` (TAREA → GLPI TicketTask).

### 3.2 Cliente compartido por API

Un solo `glpiClient.js` y un solo `arandaClient.js`, cada uno singleton, con:
- Login auto-renovado ante 401
- `withRetry` integrado (5 intentos, exponencial + jitter, no reintenta 400/404/422)
- `CircuitBreaker` independiente (abre tras 5 fallos consecutivos, HALF_OPEN tras 60s)
- `RateLimiter` token bucket (GLPI=10/s, Aranda=5/s)

### 3.3 Anti-bucle final (3 capas)

| Capa | Implementación |
|------|---------------|
| 1. Origen | `tickets.origin`, `aranda_items.origin`, `ticket_followups.origin`, `ticket_tasks.origin`, `ticket_solutions.origin`. Cada push filtra por `origin='GLPI'`, cada pull marca `origin='ARANDA'`. |
| 2. Autor + marcador | Filtro `AuthorName != ARANDA_USERNAME` en `arandaNotesPull`; `AuthorId != ARANDA_AUTHOR_ID` en `arandaTicketPull`. Followups del bot llevan `FROM_ARANDA_TAG` o `caso aranda:` (legacy) y se filtran en push. |
| 3. `sync_events` | Cada propagación registra evento con `direction + entity_type + src + dst + content_hash + ts`. Antes de aplicar el inverso, `recentInverseEvent()` consulta ventana temporal (`ANTI_ECHO_WINDOW_SECONDS=60`). |

### 3.4 Idempotencia

Patrón universal:
1. `SELECT` para ver si ya existe el mapping.
2. Si no, `POST` a la API destino.
3. `INSERT ... ON DUPLICATE KEY UPDATE` por PK natural (followup_id, task_id, solution_id, ticket_id, etc.).
4. Si el paso 2 se cae después del POST pero antes del INSERT, el siguiente tick detecta que ya existe (consultando ids estables o el mapping inverso).

Para entries Aranda sin id estable (notas/tareas), se usa hash `sha256(item+author+date+desc)` como id deduplicador en `aranda_inbound_*`.

---

## 4. Esquema de Base de Datos (final aplicado)

### Migraciones aplicadas

| # | Archivo | Contenido |
|---|---------|-----------|
| 001 | `001_initial.sql` | Núcleo: tickets, ticket_followups, ticket_solutions, aranda_items, aranda_followup_notes, aranda_solution_updates, aranda_status_sync, sync_cursors — todas con `origin` |
| 002 | `002_aranda_inbound_and_events.sql` | aranda_inbound_items, aranda_inbound_notes, sync_events |
| 003 | `003_phase2_catalog.sql` | service_catalog_sync (Fase 2, vacía) |
| 004 | `004_align_legacy_schema.sql` | Idempotente; agrega `origin`/`created_at`/`updated_at` a tablas que vienen del MVP con `ADD COLUMN IF NOT EXISTS` (MariaDB) |
| 005 | `005_tasks_sync.sql` | ticket_tasks, aranda_task_notes, aranda_inbound_tasks + extiende `sync_events.entity_type` con `'task'` |

Esquema completo documentado en [ARQUITECTURA.md](./ARQUITECTURA.md#modelo-de-datos-mysql).

---

## 5. Estrategia Bidireccional Implementada

### 5.1 GLPI → Aranda (refinado)

1. `glpiTicketSync`: lee `/Log` + `/Ticket/{id}`, UPSERT en `tickets` con `origin='GLPI'`.
2. `arandaTicketPush`: `WHERE origin='GLPI' AND NOT EXISTS mapping`, POST a Aranda, INSERT mapping con `origin='GLPI'`.
3. `arandaBacklinkToGlpi`: `WHERE glpi_backlinked_at IS NULL`, `PUT /Ticket` fijando `externalid` = ComposedId Aranda (ya no crea followup/comentario).
4. `arandaNotesPush`: `ticket_followups WHERE origin='GLPI' AND content NOT LIKE '[from aranda]%'`, POST nota en Aranda.
5. `arandaTasksPush`: `ticket_tasks WHERE origin='GLPI'`, POST nota con prefijo `[Tarea GLPI]`.
6. `arandaSolutionPush`: `ticket_solutions WHERE origin='GLPI'` y el ticket está resuelto/cerrado (`status IN (5,6)`) → `POST /item/update` con **StateId=21 (Resuelto) + ReasonId=10 + Commentary=texto de la solución**. Aranda no tiene campo de solución dedicado: el apartado "Solución" se alimenta del Commentary de la transición a Resuelto. (Antes mandaba un Commentary suelto → aparecía como nota común.) `statusSync` también usa el texto de la solución como Commentary al empujar StateId=21. Los adjuntos de la solución (ITILSolution Document_Item) los sube `glpiAttachmentsSync` + `arandaAttachmentsPush`.

### 5.2 Aranda → GLPI (solo actualizaciones de casos originados en GLPI)

> **Política GLPI-master (vigente):** los casos se crean **únicamente en GLPI**. Un caso creado en
> Aranda **NO** debe crear un ticket en GLPI, y **no se sincroniza en absoluto**. La sincronización
> (en ambos sentidos) ocurre **solo** para casos cuyo mapping en `aranda_items` tiene `origin='GLPI'`.
>
> - `arandaTicketPull` (creación inversa Aranda→GLPI) está **DESHABILITADO por defecto**
>   (`ARANDA_TICKET_PULL_ENABLED=false`); no se registra en `index.js`.
> - **Todos** los servicios de sync (push y pull) filtran por `aranda_items.origin='GLPI'`, de modo
>   que aunque existieran mappings `origin='ARANDA'` (datos legacy), no se tocan.
> - Las actualizaciones Aranda→GLPI (notas, estados, soluciones, adjuntos, prioridad) **sí** fluyen
>   para los casos originados en GLPI — esa es la parte bidireccional.

1. `arandaTicketPull` *(deshabilitado por defecto — solo si `ARANDA_TICKET_PULL_ENABLED=true`)*: `POST /item/list` filtrando `AuthorId != ARANDA_AUTHOR_ID`; los items no presentes en `aranda_items` se procesan.
   - Bootstrap silencioso: la primera vez marca todos los items existentes como `ignored` para no inundar GLPI.
   - Cursor `aranda_pull_max_id` para procesamiento incremental.
   - Crea ticket en GLPI con `origin='ARANDA'`, registra mapping en `aranda_items` y `aranda_inbound_items`.
2. `arandaNotesPull`: `GET /item/{id}/{seg}/note/list` por cada mapping activo.
   - `ActionType=16` (NOTA) → `addFollowup` GLPI, INSERT en `aranda_inbound_notes` + `ticket_followups (origin='ARANDA')`.
   - `ActionType=22` (TAREA) → `addTicketTask` GLPI, INSERT en `aranda_inbound_tasks` + `ticket_tasks (origin='ARANDA')`.
   - Filtra entries del propio bot (`AuthorName == ARANDA_USERNAME`).
   - Dedupe por hash `sha256(item+author+date+desc)` porque Aranda devuelve `Id=0` siempre.

### 5.3 Estados (bidireccional + anti-eco)

`statusSync.tick()`:
```javascript
await Promise.all([this.pushGlpiToAranda(), this.pullArandaToGlpi()]);
```

- Mapeo correcto por `CaseType` (diferente para IM vs RF) — ver tabla en [ARQUITECTURA.md](./ARQUITECTURA.md#mapeo-de-estados).
- `Commentary` obligatorio en cada update.
- Fallback de segmento ante 404 (defensa contra type GLPI ≠ CaseType Aranda).
- Anti-degradación: no rebaja GLPI desde 5/6.
- Anti-eco: si propagamos GLPI→Aranda hace <60s, no aplicamos el eco Aranda→GLPI.
- 403/404/400 permanentes → marca como visto para no reintentar infinito.

---

## 6. Descubrimientos Críticos Durante la Implementación

Estos no estaban en el plan original; fueron lecciones del diagnóstico de errores reales.

### 6.1 GLPI `/Log` rota cada ~15 entradas

La instancia GLPI usada tiene rotación muy agresiva del log. Además, `user_name` en `/Log` siempre es el dueño del API token (`zabbix`), no el humano que hizo el cambio. Conclusión:
- `glpiFollowupSync` y `glpiTaskSync` hacen **polling directo por ticket mapeado** además de `/Log`.
- No se puede confiar en `/Log` como única fuente de eventos.

### 6.2 Endpoint correcto en GLPI es `/Log` con L mayúscula

Inicialmente probamos `/log` → 400. La instancia usa case-sensitive: debe ser `/Log`.

### 6.3 Aranda usa dos sets de StateId según CaseType

Lección descubierta vía `scripts/explore-aranda-states.js`:
- **CaseType=1 (IM, segment=1)**: En Espera=10, Cerrado=11
- **CaseType=4 (RF, segment=4)**: En Espera=19, Cerrado=29
- Proceso=20, Resuelto=21 son comunes a ambos.

El plan original mapeaba plano. Se reescribió `mapGlpiToAranda(status, type)` para considerar el tipo.

### 6.4 Rol Atena_GLPI NO tiene permiso para cerrar casos en Aranda

StateId 11 (cierre IM) y 29 (cierre RF) devuelven `403 UnauthorizedCaseClosure`. Decisión:
- GLPI 6 (Cerrado) se mapea a Aranda 21 (Resuelto).
- El cierre formal queda como acción humana en Aranda.
- Documentado en el Commentary que se envía: "queda pendiente el cierre formal por el operador en Aranda".

### 6.5 Aranda exige Commentary al cambiar estado

`POST /item/update` sin `Commentary` devuelve `400 InvalidCommentary`. Se agregó como campo obligatorio en `statusSync`.

### 6.6 Endpoint Aranda real para historial es `/item/{id}/{seg}/note/list`

El plan original sugería `/item/{id}/{seg}` o nombres como `notes`/`history`/`tracking`. El correcto fue `note/list`. Devuelve entries con `ActionType` enumerado:
- `16` = NOTA manual
- `22` = AGREGAR TAREA

Campo `Id` siempre 0 → dedupe por hash.

### 6.7 Aranda no expone API CRUD separada para tareas (con permisos del bot)

Decisión: tareas GLPI se propagan a Aranda como notas con prefijo `[Tarea GLPI]`. Funcionalmente equivalente para el operador.

### 6.8 GLPI 1 (Nuevo) no se debe propagar a Aranda

Si lo propagamos, Aranda 20 (Proceso) hace pull a GLPI 2 (En curso) y creamos un loop redundante con el push. Esperamos a que GLPI avance a 2/3 antes de tocar Aranda.

### 6.9 El pull reverso degradaba GLPI

Bug detectado: si GLPI estaba en 6 (Cerrado) y Aranda aún reportaba 20 (Proceso), el pull bajaba GLPI a 2. Fix: regla "no degradar desde 5/6".

### 6.10 Hay que actualizar `tickets.status` local cuando el pull modifica GLPI

Como `glpiTicketSync` depende de `/Log` (que rota agresivamente), no captura todos los updates. Si el pull cambia GLPI pero no actualiza la fila local, el siguiente tick vuelve a empujar el mismo cambio. Fix: `UPDATE tickets SET status = ?` en cuanto el pull modifica GLPI.

---

## 7. Orden de Implementación (cronología real)

1. **Infraestructura base** — `logger`, `retry`, `circuitBreaker`, `rateLimiter`, `db`, `migrator`, `health`, `hash`, `utils`, `baseService`.
2. **Clientes únicos** — `glpiClient`, `arandaClient` con todo lo anterior integrado.
3. **Migración 001 a 003** — schema base + inbound + Fase 2 stub.
4. **Servicios GLPI → MySQL** — refactor de los 3 originales con cursor persistido y `origin`.
5. **Servicios MySQL → Aranda** — refactor de los 4 originales con filtros por `origin`.
6. **Servicios Aranda → MySQL → GLPI** — los 2 nuevos (`arandaTicketPull`, `arandaNotesPull`).
7. **`statusSync`** — refactor con anti-eco vía `sync_events`.
8. **`catalogSync`** — stub Fase 2.
9. **`index.js`** — preflight + ServiceManager + shutdown.
10. **Diagnóstico en producción** — descubrió GLPI `/Log` mayúscula, sesión 401, parser SQL, columnas legacy faltantes (migración 004), bootstrap inundación.
11. **TAREAS no estaban en el plan** — diagnóstico de caso 42558 reveló que ITILTask es entidad distinta de ITILFollowup. Agregados `glpiTaskSync`, `arandaTasksPush`, migración 005, extensión de `arandaNotesPull`.
12. **Mapeo de estados** — diagnóstico de caso 42586 reveló mapeo plano incorrecto. Se exploraron estados Aranda vía API, se descubrieron permisos del rol, se reescribió `statusSync`.

---

## 8. Criterios de Aceptación

- [x] Schema versionado con migraciones aplicadas en orden
- [x] Los 13 servicios arrancan y reportan estado en `state/health.json`
- [x] Reintentos exponenciales (5 intentos, base 1s, factor 2, jitter)
- [x] Circuit breaker abre tras 5 fallos consecutivos por API independiente
- [x] Rate limit configurable por API (GLPI=10/s, Aranda=5/s)
- [x] Logs JSON con campos `ts, level, service, direction, ticket_id, aranda_item_id, msg, err`
- [x] Ticket creado en GLPI → aparece en Aranda (caso 42558)
- [x] Ticket creado en Aranda (autor real) → aparece en GLPI con marca `[from aranda]`
- [x] Followup GLPI → Nota Aranda
- [x] Nota Aranda (autor real) → ITILFollowup GLPI
- [x] **Tarea GLPI → Nota `[Tarea GLPI]` en Aranda** (agregado vs plan original)
- [x] **Tarea Aranda → TicketTask GLPI** (agregado vs plan original)
- [x] Solución GLPI → Commentary Aranda
- [x] Cambio estado GLPI → Aranda con StateId/ReasonId/Commentary correctos por CaseType
- [x] Cambio estado Aranda → GLPI con anti-degradación + anti-eco
- [x] Reinicio del proceso reanuda donde quedó (cursores persistidos)
- [x] Idempotencia: ejecutar el mismo ciclo dos veces no duplica
- [x] Validación al inicio: conectividad GLPI + Aranda + MySQL
- [x] Shutdown graceful en <5s

---

## 9. Catálogo de categorías (implementado)

### Decisiones tomadas

- **Fuente del mapeo**: documento manual revisado (`CATALOGO.md`) en lugar de descubrir vía API. Aranda no expone `/category/list` con permisos del bot (confirmado: 404), así que la única vía es el seed.
- **Granularidad**: subcategoría GLPI ↔ subcategoría Aranda + segmento. NO se mapea `ServiceId` ni `GroupId` (siguen siendo defaults del `.env`) porque Aranda no expone esos catálogos.
- **Estrategia**: `manual_seed` con `status='matched'`. Carga idempotente vía `INSERT ... ON DUPLICATE KEY UPDATE`.
- **Política de inconsistencia**: las categorías Aranda huérfanas (Pago, Rectificación, Firma Digital, Levante, Tránsito detallado) se documentan en `CATALOGO.md §5.3` como pendientes funcionales. El daemon NO crea categorías faltantes — sólo mapea las existentes.
- **Inverso (Aranda → GLPI)**: la misma tabla se consulta al revés con JOIN sobre `aranda_category_id`.

### Implementación

| Archivo | Rol |
|---|---|
| `migrations/007_catalog_sync.sql` | Añade `tickets.itilcategories_id`, `service_catalog_sync.aranda_segment`, `aranda_inbound_items.aranda_category_id` |
| `Libro1.utf8.csv` | Fuente funcional Aranda — 77 subcategorías con tipo, grupo, sub, responsable |
| `scripts/sync-glpi-from-csv.js` | Reorganiza GLPI bajo MDH (id 658), crea grupos/subs faltantes, UPSERT en `service_catalog_sync`. Idempotente |
| `scripts/seed-catalog.js` | (Deprecado) seed inicial con 52 mapeos — superseded por `sync-glpi-from-csv.js` |
| `scripts/analyze-catalog.js` | Diff CSV ↔ BD ↔ GLPI — útil para validar antes/después |
| `scripts/verify-catalog-sync.js` | Reporta cobertura final |
| `scripts/backfill-category.js` | Rellena `itilcategories_id` de tickets preexistentes vía `GET /Ticket/{id}` raw |
| `src/lib/glpiClient.getTicketRaw(id)` | Variante sin `expand_dropdowns` → categoría como número, no como `completename` |
| `src/services/glpiTicketSync.js` | `Promise.all` de las dos llamadas, guarda `itilcategory_name` (texto) y `itilcategories_id` (id), normaliza `0 → NULL` |
| `src/services/arandaTicketPush.js` | LEFT JOIN con `service_catalog_sync`, sobrescribe `CategoryId` y `segment` si hay match |
| `src/services/arandaTicketPull.js` | Captura `CategoryId` de Aranda, LEFT JOIN inverso para fijar `itilcategories_id` |
| `src/services/catalogSync.js` | Monitoreo: reporta nº de mapeos en `service_catalog_sync` al arrancar y avisa si está vacía. NO carga el catálogo (eso lo hace `seed-catalog-local.js`). |

### Pendientes funcionales (no bloquean operación)

- Mapeo de `ServiceId`/`SlaId` cuando Aranda exponga esos catálogos al rol del bot.
- Resolución de duplicados/huérfanos documentados en CATALOGO.md §5.3.

### 9.1 Grupo Resolutor + Responsable (implementado, septiembre 2026 *ajusta a fecha real*)

- Cada subcategoría Aranda tiene una etiqueta "Responsable de Gestión Grupo" (p.ej. "Ministerio de Hacienda - DTIC").
- `migrations/009_groups_assignment.sql` añade tabla `aranda_groups (id, name, responsable_label, default_user_id, default_user_name, is_default_for_label)` y columna `service_catalog_sync.responsable_label`.
- `scripts/seed-groups.js` carga 22 grupos del Ministerio con su usuario por defecto. Para etiquetas con varios candidatos (DGA-DGT con 3, Aduanas con 14), se marca uno como `is_default_for_label=1`.
- `arandaTicketPush` extiende su JOIN: resuelve label → group_id+user_id y los envía como `GroupId` y `ResponsibleId` al crear el caso. Las categorías del Consorcio (36 de 52) intencionalmente no están en `aranda_groups` → caen al `ARANDA_GROUP_ID` del `.env` (el grupo del bot).

**Decisiones de ambigüedad** (documentadas en `seed-groups.js`):
| Label | Grupo elegido como default | Razón |
|---|---|---|
| DGA-DGT | 63 (Procesos Aduaneros) | Primer grupo del bloque |
| Aduanas | 67 (Jefe Sec. Técnica Caldera) | Primer grupo del bloque |
| DTIC | 0 (Clasificación tickets DTIC) | Único id real del bloque |
| DGA | 60 (Clasificación tickets DGA) | Grupo de entrada |

Para ajustar, mover `is_default_for_label=1` a otra fila en `seed-groups.js` y re-ejecutar.

---

## 10. Adjuntos (implementado con asimetría)

### Decisión tomada

Aranda **NO acepta POST de archivos** con el rol `Atena_GLPI` (limitación 15 documentada). Por eso:
- **Aranda → GLPI**: implementación REAL — descarga binaria del `Url` firmado + upload multipart a GLPI.
- **GLPI → Aranda**: WORKAROUND — nota Aranda anunciando el adjunto con nombre/tamaño/referencia al ticket GLPI.

### Hallazgos críticos durante la implementación

1. **`Url` firmado de Aranda expira en segundos** — el primer test devolvió 200, el segundo del mismo `Url` devolvió 500. Mitigación: el servicio descubre + descarga + sube en UNA pasada, no almacena el `Url` para usar después.
2. **`axios` con `Content-Type: application/json` default** rompe FormData multipart — GLPI devuelve `400 ERROR_BAD_ARRAY`. Mitigación: en `glpiClient.uploadDocumentToTicket` pasar `Content-Type: undefined` para que axios + FormData generen el `multipart/form-data; boundary=...` correcto.
3. **GLPI exige estructura específica** en `uploadManifest`: `{"input": {"name", "_filename":[name], "itemtype":"Ticket", "items_id":<id>}}` + parte `filename[0]` con el binario.
4. **Anti-bucle**: documentos creados por `arandaAttachmentsPull` quedan en `aranda_inbound_files.glpi_document_id`; `glpiAttachmentsSync` los excluye del tracking → no se vuelven a anunciar a Aranda.

### Implementación

| Archivo | Rol |
|---|---|
| `migrations/008_attachments.sql` | `glpi_attachments`, `aranda_attachment_notes`, `aranda_inbound_files` + extiende `sync_events.entity_type` con `'attachment'` |
| `src/lib/glpiClient.uploadDocumentToTicket()` | Multipart upload con FormData global (Node 20+) |
| `src/lib/glpiClient.getTicketDocuments()` / `getDocument()` | Lecturas |
| `src/lib/arandaClient.listItemFiles()` | `GET /item/{id}/{seg}/{userId}/files` |
| `src/lib/arandaClient.downloadFileFromUrl()` | Descarga binaria con `responseType: 'arraybuffer'` |
| `src/services/glpiAttachmentsSync.js` | [15] Detecta nuevos docs en GLPI vía polling directo |
| `src/services/arandaAttachmentsPush.js` | [16] Workaround: nota `[Adjunto GLPI] X (Y KB)` |
| `src/services/arandaAttachmentsPull.js` | [17] Descarga + upload a GLPI en una sola pasada |

### Validación

Primera ejecución tras implementar: 49 adjuntos subidos exitosamente a GLPI (de ~53 detectados); los 4 fallos restantes son por binarios vacíos en el endpoint Aranda (transitorios — el sistema reintenta hasta 5 veces).

---

## 10. Próximos Pasos Sugeridos

### Corto plazo
- [ ] Monitoreo externo: configurar alertas sobre `state/health.json` (ej. systemd timer + script que grep "lastError").
- [ ] Métricas: agregar contadores simples (`tickets_pushed`, `tickets_pulled`, `errors_by_api`) escritos al health.
- [ ] Logrotate: configurar para `/tmp/mdh-run.log` (o mover a `/var/log/mdh/`).
- [ ] Systemd unit: convertir el `nohup npm start` en un servicio gestionado.

### Mediano plazo
- [ ] Resolver pendientes funcionales del catálogo (CATALOGO.md §5.3): duplicados GLPI, grupos huérfanos Aranda, escalamientos.
- [ ] Cuando se habilite, mapear también `ServiceId` y `GroupId` Aranda en el seed del catálogo.
- [ ] Negociar con el equipo Aranda elevar permisos del rol `Atena_GLPI` para POST de adjuntos — eliminar la limitación 15.
- [ ] UI de operador (read-only) que muestre estado de mappings, adjuntos pendientes y permita re-encolar fallidos.

### Largo plazo
- [ ] Sincronización de usuarios/grupos entre GLPI y Aranda (cuando se requiera).
- [ ] Webhook receiver opcional: además de polling, aceptar webhooks de GLPI para reducir latencia.
- [ ] Migración a Redis como cola de retry (alternativa a las tablas tracker con `tries`).
