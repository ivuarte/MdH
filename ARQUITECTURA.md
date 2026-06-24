# MdH v2 — Arquitectura del Sistema

## Propósito

Daemon de sincronización **bidireccional** entre **GLPI** (gestor de tickets IT) y **Aranda ASDK** (mesa de servicios). Mantiene ambas plataformas como un espejo: tickets, comentarios, tareas, soluciones y estados se replican en ambas direcciones por polling periódico, usando MySQL como capa de persistencia, deduplicación y trazabilidad.

Implementación versión producción (v2.0.0): 18 servicios polleres, anti-bucle multi-capa, circuit breaker, rate limiting, reintentos exponenciales, logging JSON estructurado, migraciones SQL versionadas, health check, cursores persistidos. Incluye sincronización de catálogo (categorías GLPI ↔ subcategorías Aranda + segmento), adjuntos **binarios reales en ambos sentidos** vía `POST /item/addfile` (doc oficial ASDKAPI v1.9, validado en v8.6 el 2026-06-17) y `arandaSolutionPull` para soluciones humanas Aranda → GLPI.

---

## Big Picture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            GLPI API REST                                  │
│             (https://glpi.iammtechs.com/apirest.php)                     │
│      Auth: App-Token + User-Token → Session-Token (renovable)            │
└─────────────────────┬────────────────────────────────────┬───────────────┘
                      │ pull (cada 20s)                    │ push
                      ▼                                    ▲
       ┌──────────────────────────────────────────────────────────────────┐
       │                  src/index.js — Orquestador                       │
       │  validateConfig → initDB → runMigrations → preflightChecks       │
       │  → ServiceManager.startAll(18 servicios) → SIGINT/SIGTERM        │
       └──────────────────────────┬────────────────────────────────────────┘
                                  │
       ┌──────────────────────────┴────────────────────────────────────────┐
       │                          MySQL  (esquema "mdh")                    │
       │                                                                    │
       │  Núcleo:                                                           │
       │    tickets · ticket_followups · ticket_solutions · ticket_tasks    │
       │  Mapping:                                                          │
       │    aranda_items (origin GLPI|ARANDA)                               │
       │  Trackers de propagación (GLPI → Aranda):                          │
       │    aranda_followup_notes · aranda_solution_updates                 │
       │    aranda_task_notes · aranda_status_sync                          │
       │  Inbound (Aranda → GLPI):                                          │
       │    aranda_inbound_items · aranda_inbound_notes ·                   │
       │    aranda_inbound_tasks                                            │
       │  Trazabilidad / anti-eco:                                          │
       │    sync_events · sync_cursors                                      │
       │  Catálogo de categorías (77 mapeos GLPI↔Aranda):                   │
       │    service_catalog_sync                                            │
       │  Versionado:                                                       │
       │    _schema_version                                                 │
       └──────────────────────────┬────────────────────────────────────────┘
                                  │
                      ▼                                    ▲
                      │ pull (cada 20s)                    │ push
┌─────────────────────┴────────────────────────────────────┴───────────────┐
│                           Aranda ASDK API REST                            │
│      (https://mesadeserviciostic.hacienda.go.cr/ASDKAPI/api/v8.6)       │
│            Auth: POST /user/login → sessionId (renovable)                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Estructura de Archivos

```
MdH_v2/
├── src/
│   ├── index.js                          # Orquestador: preflight + ServiceManager + shutdown
│   ├── config.js                         # Config tipada con defaults + validateConfig + isServiceEnabled
│   ├── lib/
│   │   ├── db.js                         # Pool MySQL + withTransaction + readCursor / writeCursor
│   │   ├── logger.js                     # Logger JSON estructurado con child(defaults)
│   │   ├── glpiClient.js                 # Cliente GLPI singleton (retry+breaker+RL+relogin)
│   │   ├── arandaClient.js               # Cliente Aranda singleton (retry+breaker+RL+relogin)
│   │   ├── retry.js                      # withRetry() exponencial + jitter + nonRetryStatuses
│   │   ├── circuitBreaker.js             # CircuitBreaker (CLOSED / OPEN / HALF_OPEN)
│   │   ├── rateLimiter.js                # Token bucket por API
│   │   ├── syncEvents.js                 # recordEvent + recentInverseEvent (anti-eco)
│   │   ├── health.js                     # Writer asíncrono de state/health.json
│   │   ├── migrator.js                   # Aplica migrations/*.sql en orden, _schema_version
│   │   ├── hash.js                       # sha256 para ids estables
│   │   ├── utils.js                      # normalizeHtml, fieldsArrayToObject, FROM_ARANDA_TAG, etc.
│   │   └── baseService.js                # Clase base: tick no-reentrante, start/stop, health hooks
│   └── services/                          # 18 servicios polleres
│       ├── glpiTicketSync.js             # [1]  GLPI /Log → tickets (origin=GLPI)
│       ├── glpiFollowupSync.js           # [2]  Followups GLPI → ticket_followups
│       ├── glpiSolutionSync.js           # [3]  Soluciones GLPI → ticket_solutions
│       ├── glpiTaskSync.js               # [4]  TicketTask GLPI → ticket_tasks (polling directo)
│       ├── arandaTicketPush.js           # [5]  tickets(origin=GLPI) sin mapping → /item/add
│       ├── arandaBacklinkToGlpi.js       # [6]  aranda_items sin backlink → fija externalid (ComposedId) en el ticket GLPI
│       ├── arandaNotesPush.js            # [7]  ticket_followups → notas Aranda
│       ├── arandaTasksPush.js            # [8]  ticket_tasks → notas Aranda con [Tarea GLPI]
│       ├── arandaSolutionPush.js         # [9]  ticket_solutions(GLPI) → Commentary Aranda
│       ├── arandaTicketPull.js           # [10] Aranda → tickets (origin=ARANDA) + crea en GLPI
│       ├── arandaNotesPull.js            # [11] note/list de Aranda → ITILFollowup + TicketTask GLPI
│       ├── arandaSolutionPull.js         # [11b] Commentary de resolución Aranda → ITILSolution (o Followup fallback) GLPI
│       ├── statusSync.js                 # [12] Estados GLPI ↔ Aranda (PUSH+PULL en Promise.all)
│       ├── prioritySync.js               # [13] Urgencia + prioridad GLPI ↔ Aranda
│       ├── catalogSync.js                # [14] Catálogo de categorías GLPI ↔ Aranda
│       ├── glpiAttachmentsSync.js        # [15] /Document_Item → glpi_attachments
│       ├── arandaAttachmentsPush.js      # [16] Workaround: notas anunciando adjunto GLPI
│       └── arandaAttachmentsPull.js      # [17] /files Aranda → POST /Document a GLPI
├── migrations/
│   ├── 001_initial.sql                   # Núcleo: tickets, followups, solutions, items, status, cursors
│   ├── 002_aranda_inbound_and_events.sql # inbound_items, inbound_notes, sync_events
│   ├── 003_phase2_catalog.sql            # service_catalog_sync (Fase 2)
│   ├── 004_align_legacy_schema.sql       # Corrige instalaciones que vienen del MVP
│   ├── 005_tasks_sync.sql                # ticket_tasks, aranda_task_notes, aranda_inbound_tasks
│   ├── 006_priority_urgency.sql          # tickets.urgency/impact/priority + aranda_priority_sync
│   ├── 007_catalog_sync.sql              # tickets.itilcategories_id + scs.aranda_segment + aii.aranda_category_id
│   ├── 008_attachments.sql               # glpi_attachments + aranda_attachment_notes + aranda_inbound_files
│   ├── 009_groups_assignment.sql         # aranda_groups + service_catalog_sync.responsable_label
│   ├── 010_aranda_solution_pulls.sql     # tracker idempotente para arandaSolutionPull
│   ├── 011_widen_solution_pulls_status.sql # status VARCHAR(16)→(32) para 'synced_as_followup'
│   ├── 012_attachments_composite_pk.sql  # PK compuesta (document_id, ticket_id) — GLPI deduplica Documents por sha1
│   └── 013_inbound_files_source.sql      # aranda_inbound_files.source ENUM('pull','push') para anti-eco direccional
├── scripts/                               # Utilidades operacionales
│   ├── explore-aranda-states.js          # Descubre estados y permisos Aranda vía API
│   ├── verify-42558.js                   # Validación E2E (caso de prueba 1)
│   ├── verify-42586.js                   # Validación E2E (caso de prueba 2)
│   └── test-glpi-to-aranda.js            # Crea followup en GLPI con stamp único
├── state/
│   └── health.json                       # Estado de cada servicio (escrito en runtime)
├── .env                                   # Credenciales y configuración
├── package.json                           # ESM, deps: axios + dotenv + he + mysql2
├── ARQUITECTURA.md                        # Este documento
└── PLAN_IMPLEMENTACION.md                 # Plan original + decisiones tomadas
```

---

## Los 14 Servicios

### Ingesta GLPI → MySQL (4)

| # | Servicio | Lee de GLPI | Escribe en MySQL | Notas |
|---|----------|-------------|------------------|-------|
| 1 | `glpiTicketSync` | `GET /Log` + `GET /Ticket/{id}` | `tickets` (UPSERT, origin=GLPI) | Cursor `glpi_log_max_id` en `sync_cursors` |
| 2 | `glpiFollowupSync` | `GET /Log` + polling directo `GET /Ticket/{id}/ITILFollowup` | `ticket_followups`, append en `tickets.ITILFollowup` | Polling directo necesario: `/Log` rota cada ~15 entradas |
| 3 | `glpiSolutionSync` | `GET /Log` + `GET /Ticket/{id}/ITILSolution` | `ticket_solutions`, append atómico en `tickets.ITILSolution` | Maneja 2 patrones de log (itemtype Ticket o ITILSolution) |
| 4 | `glpiTaskSync` | `GET /Ticket/{id}/TicketTask` por cada ticket mapeado | `ticket_tasks` | Polling directo (TicketTask no aparece confiable en `/Log`) |

### Propagación MySQL → Aranda (5) — solo tickets `origin='GLPI'`

| # | Servicio | Lee de MySQL | Escribe en Aranda | Tabla destino |
|---|----------|--------------|-------------------|---------------|
| 5 | `arandaTicketPush` | `tickets` sin mapping o `status='failed'` | `POST /item/add/{segment}` | `aranda_items` |
| 6 | `arandaBacklinkToGlpi` | `aranda_items` con `glpi_backlinked_at IS NULL` | `PUT /Ticket` fijando `externalid` = ComposedId Aranda (NO followup) | `aranda_items.glpi_backlinked_at` |
| 7 | `arandaNotesPush` | `ticket_followups origin=GLPI` no enviados | `POST /item/{id}/{seg}/note` | `aranda_followup_notes` |
| 8 | `arandaTasksPush` | `ticket_tasks origin=GLPI` no enviados | `POST /item/{id}/{seg}/note` con prefijo `[Tarea GLPI]` | `aranda_task_notes` |
| 9 | `arandaSolutionPush` | `ticket_solutions origin=GLPI` no enviados, con ticket `status IN (5,6)` | `POST /item/update` con **StateId=21 (Resuelto) + ReasonId=10 + Commentary=solución** → cae en el apartado "Solución" de Aranda (no hay campo dedicado) | `aranda_solution_updates` |

### Pull Aranda → MySQL → GLPI

> **Política GLPI-master:** la sincronización ocurre **solo** para casos creados en GLPI
> (`aranda_items.origin='GLPI'`). Un caso creado en Aranda no se crea en GLPI ni se sincroniza.
> Por eso `arandaTicketPull` está **deshabilitado por defecto** y los pull de actualización
> (11, 11b, estados, prioridad, adjuntos) filtran `origin='GLPI'`.

| # | Servicio | Lee de Aranda | Escribe en GLPI | Tabla destino |
|---|----------|---------------|-----------------|---------------|
| 10 | `arandaTicketPull` ⛔ **deshabilitado** (`ARANDA_TICKET_PULL_ENABLED=false`) | `POST /item/list` (filtrado por author ≠ bot y no en `aranda_items`) | `POST /Ticket` (origin=ARANDA) con `externalid` = ComposedId Aranda | `aranda_inbound_items`, `tickets`, `aranda_items` |
| 11 | `arandaNotesPull` | `GET /item/{id}/{seg}/note/list` por cada item mapeado | `addFollowup` (ActionType=16 NOTA) o `addTicketTask` (ActionType=22 TAREA) | `aranda_inbound_notes`, `aranda_inbound_tasks`, `ticket_followups`, `ticket_tasks` |
| 11b | `arandaSolutionPull` | `note/list` filtrado a transición `[STATUS]→Resuelto` + `[COMMENTARY]` del mismo timestamp (autor ≠ bot) | `POST /ITILSolution` si GLPI < 5; si ≥ 5 cae a `POST /ITILFollowup` con prefijo `[Solución Aranda]` | `aranda_solution_pulls`, `ticket_solutions` (origin=ARANDA, `solution_id = -aranda_item_id`) |

### Estado bidireccional (1)

| # | Servicio | Dirección | Lógica |
|---|----------|-----------|--------|
| 12 | `statusSync` | PUSH (GLPI→Aranda) | `tickets` con status cambiado → `POST /item/update` con StateId+ReasonId+Commentary |
| 12 | `statusSync` | PULL (Aranda→GLPI) | `POST /item/list` filtrado → `PUT /Ticket` si status difiere y no degrada |

### Urgencia / Prioridad bidireccional (1)

| # | Servicio | Dirección | Lógica |
|---|----------|-----------|--------|
| 13 | `prioritySync` | PUSH (GLPI→Aranda) | Cambio en `tickets.urgency` o `tickets.priority` → `POST /item/update` con UrgencyId+PriorityId+Commentary |
| 13 | `prioritySync` | PULL (Aranda→GLPI) | `POST /item/list` detecta UrgencyId/PriorityId cambiado → `PUT /Ticket` con campos mapeados |

PUSH y PULL en ambos servicios se ejecutan en `Promise.all` en cada tick. Anti-eco vía `sync_events` con ventana `ANTI_ECHO_WINDOW_SECONDS` (default 60s).

### Catálogo de categorías (1)

| # | Servicio | Dirección | Lógica |
|---|----------|-----------|--------|
| 14 | `catalogSync` | Monitoreo del catálogo (no carga datos) | Reporta al arrancar cuántos mapeos hay en `service_catalog_sync` y avisa si está vacía. El catálogo (77 mapeos) **ya está implementado**: se carga con `scripts/seed-catalog-local.js` y lo consumen `arandaTicketPush`/`arandaTicketPull` por JOIN para traducir `glpi_itilcategories_id` ↔ (`aranda_category_id`, `aranda_segment`). |

### Adjuntos (3)

Bidireccional con binario real desde 2026-06-17 (ver Limitación 15, resuelta).

| # | Servicio | Dirección | Lógica |
|---|----------|-----------|--------|
| 15 | `glpiAttachmentsSync` | GLPI → DB | Polea **4 fuentes Document_Item** en GLPI 10+ timeline por cada ticket mapeado: `/Ticket/{id}/Document_Item` (raíz) + `/ITILFollowup/{fid}/Document_Item` (10 últimos comentarios) + `/ITILSolution/{sid}/Document_Item` (5 últimas soluciones) + `/TicketTask/{tid}/Document_Item` (10 últimas tareas). Dedupea por `documents_id`. Inserta en `glpi_attachments` (PK compuesta `(document_id, ticket_id)`). Filtra documentos creados por el bot al PULLEAR de Aranda consultando `aranda_inbound_files WHERE source='pull'`. |
| 16 | `arandaAttachmentsPush` | GLPI → Aranda (real) | Por cada `(document_id, ticket_id)` pendiente en `glpi_attachments`: `GET /Document/{id}?alt=media` (binario) + `POST /item/addfile` multipart con `file0`/`itemId`/`itemType`/`userId` (doc oficial v1.9). Tras subir, hace listing del item Aranda y registra el `aranda_file_id` recién creado en `aranda_inbound_files` con `source='push'`, `status='synced'`, `glpi_document_id=<doc original>` para anti-eco del pull. Tracker: `aranda_attachment_notes` (PK compuesta). |
| 17 | `arandaAttachmentsPull` | Aranda → GLPI (real) | `GET /item/{id}/{seg}/{userId}/files` → descarga binaria desde `Url` firmado → `POST /Document` multipart a GLPI. **Crítico**: el `Url` expira en segundos, por eso descubrimiento + descarga + upload se ejecuta en una sola pasada. Inserta en `aranda_inbound_files` con `source='pull'` (default). |

---

## Modelo de Datos MySQL

### Núcleo
```
tickets                                  ticket_followups
─────────────────────────                ─────────────────────────
id              INT PK                   followup_id  BIGINT PK
origin          ENUM(GLPI,ARANDA)        ticket_id    INT
nombre          VARCHAR(255)             user_name    VARCHAR
date_creation   DATETIME                 content      TEXT
closedate       DATETIME                 date         DATETIME
solvedate       DATETIME                 origin       ENUM(GLPI,ARANDA)
status          INT                      external_id  VARCHAR(128)
type            INT                      created_at   TIMESTAMP
users_id_recipient VARCHAR
content         LONGTEXT                 ticket_solutions
itilcategory_name VARCHAR                ─────────────────────────
ITILFollowup    LONGTEXT  ← append       solution_id  BIGINT PK
ITILSolution    LONGTEXT  ← append       ticket_id    INT
created_at      TIMESTAMP                user_name    VARCHAR
updated_at      TIMESTAMP                content      TEXT
KEY idx_status, idx_origin               date_creation DATETIME
                                         origin       ENUM(GLPI,ARANDA)
ticket_tasks                             created_at   TIMESTAMP
─────────────────────────
task_id         BIGINT PK
ticket_id       INT
user_name       VARCHAR
content         TEXT
date            DATETIME
state           INT
origin          ENUM(GLPI,ARANDA)
external_id     VARCHAR(128)
created_at      TIMESTAMP
```

### Mapping
```
aranda_items
─────────────────────────────
ticket_id           INT PK
aranda_item_id      BIGINT UNIQUE
composed_item_id    VARCHAR(128)    -- p.ej. "RF-369472-1-168565"
origin              ENUM(GLPI,ARANDA)
status              VARCHAR(32)     -- 'synced' | 'failed'
last_error          TEXT
glpi_backlinked_at  TIMESTAMP
glpi_backlink_error TEXT
created_at / updated_at TIMESTAMP
```

### Trackers de propagación
```
aranda_followup_notes        aranda_solution_updates       aranda_task_notes
─────────────────────────    ─────────────────────────     ─────────────────────────
followup_id BIGINT PK        solution_id BIGINT PK         task_id     BIGINT PK
ticket_id   INT              ticket_id   INT               ticket_id   INT
aranda_item_id BIGINT        aranda_item_id BIGINT         aranda_item_id BIGINT
status      VARCHAR(16)      status      VARCHAR(16)       status      VARCHAR(16)
tries       INT              tries       INT               tries       INT
last_error  TEXT             last_error  TEXT              last_error  TEXT
posted_at   TIMESTAMP        posted_at   TIMESTAMP         posted_at   TIMESTAMP
updated_at  TIMESTAMP        updated_at  TIMESTAMP         updated_at  TIMESTAMP

aranda_status_sync
─────────────────────────────
ticket_id           INT PK
aranda_item_id      BIGINT
last_glpi_status    INT
last_aranda_stateid INT
last_push_at        TIMESTAMP
last_pull_at        TIMESTAMP
last_error          TEXT
updated_at          TIMESTAMP
```

### Inbound (Aranda → GLPI)
```
aranda_inbound_items                    aranda_inbound_notes
─────────────────────────────           ─────────────────────────────
aranda_item_id    BIGINT PK             aranda_note_id    VARCHAR(128) PK  -- hash estable
composed_item_id  VARCHAR(128)          aranda_item_id    BIGINT
glpi_ticket_id    INT                   glpi_ticket_id    INT
aranda_segment    TINYINT               glpi_followup_id  BIGINT
subject           VARCHAR(500)          description       TEXT
description       LONGTEXT              author            VARCHAR
aranda_state_id   INT                   author_id         BIGINT
aranda_author_id  BIGINT                posted_in_aranda_at DATETIME
status            VARCHAR(16)           status            VARCHAR(16)
tries             INT                   tries             INT
last_error        TEXT                  last_error        TEXT
detected_at       TIMESTAMP             detected_at       TIMESTAMP
posted_at         TIMESTAMP             posted_at         TIMESTAMP

aranda_inbound_tasks
─────────────────────────────
aranda_task_id    VARCHAR(128) PK  -- hash de (item+author+date+desc), porque Aranda devuelve Id=0
aranda_item_id    BIGINT
glpi_ticket_id    INT
glpi_task_id      BIGINT
description       TEXT
author / author_id
posted_in_aranda_at DATETIME
status / tries / last_error
detected_at / posted_at
```

### Trazabilidad / anti-eco
```
sync_events                              sync_cursors
─────────────────────────────            ─────────────────────────
id              BIGINT PK AUTO_INC       cursor_name   VARCHAR(128) PK
direction       ENUM(GLPI_TO_ARANDA,     cursor_value  VARCHAR(255)
                     ARANDA_TO_GLPI)     updated_at    TIMESTAMP
entity_type     ENUM(ticket,note,
                     solution,status,    -- Cursores en uso:
                     task)               --   glpi_log_max_id
entity_id_src   VARCHAR(128)             --   aranda_pull_max_id
entity_id_dst   VARCHAR(128)             --   (otros agregados por cada poller)
content_hash    CHAR(64)
ts              TIMESTAMP
KEY (direction, entity_type, src), (hash), (ts)
```

### Catálogo de categorías + asignación de grupo
```
service_catalog_sync                     aranda_groups
─────────────────────────────────────    ─────────────────────────────
id                  INT PK AUTO_INC      id                  INT PK    -- código del grupo Aranda
glpi_category_id    INT UNIQUE           name                VARCHAR(255)
glpi_category_name  VARCHAR(500)         responsable_label   VARCHAR(128)  -- etiqueta del catálogo
aranda_category_id  INT UNIQUE           default_user_id     INT       -- ResponsibleId Aranda
aranda_segment      TINYINT              default_user_name   VARCHAR(255)
aranda_category_name VARCHAR(500)        is_default_for_label TINYINT(1) -- preferido del bloque
responsable_label   VARCHAR(128)         notes               VARCHAR(500)
aranda_service_id   INT                  created_at / updated_at
aranda_service_name VARCHAR(500)
match_strategy      VARCHAR(32)
status              VARCHAR(16)
last_error          TEXT
created_at / updated_at
```
Seed (recomendado, cualquier instancia): `scripts/seed-catalog-local.js` — cruza por NOMBRE las categorías de la instancia GLPI destino con `Libro1.utf8.csv` y puebla los 77 mapeos. Es agnóstico de IDs e idempotente, y **no modifica** el árbol GLPI. Más `scripts/seed-groups.js` (22 grupos).
JOIN típico al pushear ticket:
`tickets.itilcategories_id` → `service_catalog_sync.responsable_label` → `aranda_groups (is_default_for_label=1)` → `GroupId` + `ResponsibleId`.
Verificación: `scripts/analyze-catalog-alignment.js` (GLPI ↔ Aranda) y `scripts/verify-catalog-sync.js` (cobertura en BD). Regenerar `CATALOGO.md`: `scripts/build-catalog-doc.js`.
> ⚠️ Legacy: `scripts/sync-glpi-from-csv.js` está cableado a los IDs de la instancia vieja (MDH=658) y **reorganiza** el árbol GLPI. NO usar en una instancia nueva (preprod/prod) — usar `seed-catalog-local.js`.

### Adjuntos
```
glpi_attachments                         aranda_attachment_notes
─────────────────────────────            ─────────────────────────────
document_id  INT  ┐                       document_id    INT  ┐
ticket_id    INT  ┴ PK compuesta          ticket_id      INT  ┴ PK compuesta
name         VARCHAR(255)                 aranda_item_id BIGINT
size         BIGINT                       status         VARCHAR(16)
mime         VARCHAR(128)                 tries          INT
detected_at  DATETIME                     last_error     TEXT
                                          posted_at      DATETIME
                                          updated_at     TIMESTAMP

aranda_inbound_files
─────────────────────────────
aranda_file_id   INT PK
aranda_item_id   BIGINT
aranda_segment   TINYINT
glpi_ticket_id   INT
glpi_document_id INT          -- el id del Document creado/origen en GLPI
name             VARCHAR(255)
size             BIGINT
url              TEXT          -- referencia/debug; NO se reusa (token expira)
status           VARCHAR(16)
source           ENUM('pull','push')  -- direccion del registro:
                                      --   'pull' = bot descargó Aranda→creó Document GLPI
                                      --   'push' = bot subió Document GLPI→Aranda (anti-eco para el pull)
tries            INT
last_error       TEXT
detected_at / posted_at
```
**PK compuesta `(document_id, ticket_id)`**: GLPI deduplica `Document` internamente por sha1; el mismo archivo subido a dos tickets distintos comparte el id de `Document` pero crea dos `Document_Item` con `items_id` distintos. La PK compuesta permite trackear cada par (Document, ticket) como una unidad de propagación independiente.

### Versionado
```
_schema_version (version PK, applied_at, description)
```

---

## Mapeo de Estados — descubierto vía Aranda `/state/list` y `/state/{id}/reasons`

> **Diccionario único:** todo el mapeo de estados vive en **`src/lib/arandaStates.js`** (StateId por
> segmento, ReasonId obligatorio y la equivalencia con GLPI). `statusSync.js` solo lo consume. La
> resolución es **segment-aware**: el StateId siempre se elige/valida según el segmento del caso
> (IM=1 / RF=4), de modo que **un INCIDENTE nunca recibe un ID de SERVICIO ni viceversa**
> (p.ej. Pendiente = 65 en IM pero 66 en RF; un 65 sobre un caso RF se ignora).

**Aranda usa DOS sets de StateId según `CaseType`** (lección clave del diagnóstico):

| GLPI status | Descripción GLPI | CaseType=1 (IM/segment=1) | CaseType=4 (RF/segment=4) | Reason | Commentary obligatorio |
|-------------|------------------|---------------------------|---------------------------|--------|------------------------|
| 1 | Nuevo            | — (no se propaga)         | — (no se propaga)         | —      | — |
| 2 / 3 | En curso     | StateId=8 (En Curso)      | StateId=20 (Proceso)      | 7      | sí |
| 4 | En espera        | StateId=10                | StateId=19                | 69 / 8 | sí |
| 5 | Resuelto         | StateId=21                | StateId=21                | 10     | sí |
| 6 | Cerrado          | StateId=21 *(ver nota)*   | StateId=21 *(ver nota)*   | 10     | sí |

**Nota crítica:** el rol `Atena_GLPI` NO tiene permiso para cerrar casos en Aranda (StateId 11 IM / 29 RF devuelven `403 UnauthorizedCaseClosure`). GLPI Cerrado se mapea a Aranda Resuelto; el cierre formal queda como acción humana en Aranda.

#### Catálogo COMPLETO de StateId Aranda (homologado)

Los IDs **difieren entre INCIDENTE (IM, seg 1) y SERVICIO (RF, seg 4)**. SERVICIO tiene un ciclo de vida más rico (análisis/desarrollo/pruebas/RFC):

| Estado | INCIDENTE (IM) | SERVICIO (RF) |
|--------|:--------------:|:-------------:|
| Registrado | — | 13 |
| Asignado | 7 | 16 |
| Asignado RFC | — | 22 |
| En Curso | 8 | — |
| Proceso | 20 | 20 |
| Análisis | — | 23 |
| Desarrollo | — | 25 |
| Pruebas | — | 26 |
| Post Implementación | — | 28 |
| Pago Firma Digital | — | 70 |
| En Espera | 10 | 19 |
| En Espera RFC | — | 24 |
| Pendiente | 65 | 66 |
| Resuelto | 21, 12 | 21 |
| Resuelto RFC | — | 27 |
| Cerrado | 11 | 29 |
| Solicitud de Anulado | 59 | 17 |
| Anulado | 9 | 60 |
| Anulado RFC | — | 30 |

> El **push** GLPI→Aranda sólo usa los StateId de la tabla de arriba (Proceso/En Espera/Resuelto), porque GLPI no genera los estados ricos. El **pull** Aranda→GLPI sí reconoce el set completo.

**Inverso Aranda → GLPI** (con regla "no degradar"):

| Aranda StateId | GLPI status | Notas |
|----------------|-------------|-------|
| 11, 29 | 6 (Cerrado) | — |
| 9, 60, 30 (Anulado / Anulado RFC) | 6 (Cerrado) | GLPI no tiene "cancelado"; un caso anulado termina → se cierra el ticket |
| 21, 12, 27 | 5 (Resuelto) | incluye Resuelto IM alterno (12) y Resuelto RFC (27) |
| 10, 19, 24, 65, 66 | 4 (En espera) | En Espera (IM/RF), En Espera RFC, Pendiente (IM/RF) |
| 7, 16, 22, 8, 20, 23, 25, 26, 28, 70 | 2 (En curso asignada) | Asignado, Asignado RFC, En Curso, Proceso, Análisis, Desarrollo, Pruebas, Post Impl., Pago Firma Digital. No degradar si GLPI ya está en 5 o 6 |
| 13 (Registrado) | — (ignorado) | equivaldría a GLPI 1 (Nuevo); no degradamos a 1 |
| 59, 17 (Solicitud de Anulado) | — (ignorado) | estado pendiente, no final; no se cierra GLPI por una solicitud aún no aprobada |

**Por qué GLPI 1 (Nuevo) no se propaga**: el pull reverso de Aranda 20 (Proceso) lo llevaría a 2 (En curso), creando un loop con el push. Esperamos a que GLPI avance a 2/3 antes de tocar Aranda.

---

## Mapeo de Urgencia y Prioridad

**Descubierto vía `/urgency/list` y `/priority/list` de Aranda.**

### Catálogos disponibles

| Aranda Urgency | Id | Aranda Priority | Id |
|----------------|----|-----------------|----|
| LOW            | 2  | LOW             | 1  |
| HIGH           | 3  | MEDIUM          | 2  |
| CRITICAL       | 4  | HIGH            | 3  |
|                |    | CRITICAL        | 4  |

GLPI usa escala 1..5 para `urgency`, `impact` y `priority` (1=Muy bajo, 5=Muy alto).

### Mapeo Urgency GLPI → Aranda (`glpiUrgencyToAranda`)

| GLPI urgency | Descripción GLPI | Aranda UrgencyId | Aranda Name |
|--------------|------------------|------------------|-------------|
| 1, 2         | Muy bajo / Bajo  | 2                | LOW         |
| 3, 4         | Mediano / Alto   | 3                | HIGH        |
| 5            | Muy alto         | 4                | CRITICAL    |

**Mapeo lossy**: Aranda Urgency sólo tiene 3 niveles, así que GLPI 3 y 4 colapsan en HIGH. El inverso usa el centro del rango colapsado.

### Mapeo Priority GLPI → Aranda (`glpiPriorityToAranda`)

| GLPI priority | Descripción GLPI | Aranda PriorityId | Aranda Name |
|---------------|------------------|-------------------|-------------|
| 1, 2          | Muy bajo / Bajo  | 1                 | LOW         |
| 3             | Mediano          | 2                 | MEDIUM      |
| 4             | Alto             | 3                 | HIGH        |
| 5             | Muy alto         | 4                 | CRITICAL    |

**Mapeo sin pérdida**: ambos sistemas tienen LOW/MEDIUM/HIGH/CRITICAL alineados.

### Inverso Aranda → GLPI

| Aranda Urgency | GLPI urgency | Aranda Priority | GLPI priority |
|----------------|--------------|-----------------|---------------|
| 2 LOW          | 2 (Bajo)     | 1 LOW           | 2 (Bajo)      |
| 3 HIGH         | 3 (Mediano)  | 2 MEDIUM        | 3 (Mediano)   |
| 4 CRITICAL     | 5 (Muy alto) | 3 HIGH          | 4 (Alto)      |
|                |              | 4 CRITICAL      | 5 (Muy alto)  |

Implementación en `src/lib/priorityMapping.js`. Se aplica en:
- `arandaTicketPush`: al crear caso en Aranda envía `UrgencyId`/`PriorityId` mapeados.
- `arandaTicketPull`: al crear ticket en GLPI setea `urgency`/`priority` mapeados.
- `prioritySync`: mantiene ambos lados alineados en tiempo real ante cambios posteriores.

---

## Mapeo de Tipo de Ticket

| GLPI type | Descripción   | Aranda segment | Endpoint    |
|-----------|---------------|----------------|-------------|
| 1         | Incidencia    | 1 (CaseType IM)| `/item/add/1`, `/item/update/{id}/1/{userId}` |
| 2         | Requerimiento | 4 (CaseType RF)| `/item/add/4`, `/item/update/{id}/4/{userId}` |

Fallback: si una operación devuelve 404 con el segmento mapeado, se reintenta con el segmento opuesto (defensa ante CaseType incorrecto en items origin=ARANDA).

---

## Anti-Bucle: 3 capas

### Capa 1 — Columna `origin`

Cada tabla con replicación tiene `origin ENUM('GLPI','ARANDA')`:
- `arandaTicketPush` solo procesa `tickets WHERE origin='GLPI'`.
- `arandaTicketPull` solo crea filas con `origin='ARANDA'`.
- `arandaNotesPush` solo procesa `ticket_followups WHERE origin='GLPI'`.
- `arandaNotesPull` inserta en `ticket_followups` y `ticket_tasks` con `origin='ARANDA'`.

### Capa 2 — Filtros por autor + marca en contenido

- `arandaNotesPull` salta entries cuyo `AuthorName == ARANDA_USERNAME` (es el propio bot).
- `arandaTicketPull` filtra `AuthorId != ARANDA_AUTHOR_ID` en `/item/list`.
- Followups creados por el daemon en GLPI llevan prefijo `[from aranda]` (constante `FROM_ARANDA_TAG`); `arandaNotesPush` los salta.
- Backlinks legados con prefijo `caso aranda:` siguen filtrándose por compatibilidad.

### Capa 3 — `sync_events` con ventana temporal

Cada propagación llama `recordEvent({direction, entityType, srcId, dstId, contentHash})`. Antes de aplicar un cambio inverso, `recentInverseEvent()` consulta si el mismo `(entity_type, entity_id)` fue propagado en la otra dirección dentro de `ANTI_ECHO_WINDOW_SECONDS` (default 60). Si sí, se omite.

Usado activamente en `statusSync` para los cambios de estado (ping-pong era el riesgo más alto).

---

## Endpoints API Descubiertos (importante)

### GLPI
- `GET /Log?order=DESC` (mayúscula obligatoria; `/log` daba 400). **Limitación**: esta instancia rota cada ~15 entradas y el `user_name` siempre es el dueño del API token. Por eso varios servicios hacen polling directo por ticket en lugar de depender de `/Log`.
- `GET /Ticket/{id}?expand_dropdowns=true`
- `GET /Ticket/{id}/ITILFollowup`, `POST /ITILFollowup`
- `GET /Ticket/{id}/ITILSolution`
- `GET /Ticket/{id}/TicketTask`, `POST /TicketTask`
- `PUT /Ticket` con `{input: {id, status}}`
- Auth: `POST /initSession?app_token=...&user_token=...` → `session_token` para header `Session-Token`.

### Aranda ASDK v8.6
- `POST /user/login` con `{Username, Password}` → respuesta `[{Field:'sessionId', Value:'...'}, ...]`. El sessionId va en header `Authorization`.
- `POST /item/add/{segment}` con array `[{Field, Value}, ...]`
- `POST /item/update/{itemId}/{segment}/{userId}` — **exige `Commentary` al cambiar estado** (sin él: `400 InvalidCommentary`).
- `POST /item/{itemId}/{segment}/note` para agregar nota.
- `GET /item/{itemId}/{segment}/note/list` — **endpoint canónico del historial**. Devuelve entries con `ActionType`:
  - `16` = NOTA manual
  - `22` = AGREGAR TAREA
  - Campo `Id` siempre 0 → deduplicación con `sha256(item+author+date+desc)`.
- `POST /item/list` con `{Paging, Criteria, WhereCriteria, Order, ProjectId, ViewId}` — devuelve `{Data: [{Id, StateId, CaseType, ComposedId, ...}]}`.
- Aranda NO expone API CRUD separada para tareas con permisos de `Atena_GLPI`. Tareas GLPI se propagan como notas con prefijo `[Tarea GLPI]`.

---

## Infraestructura `src/lib/`

| Módulo | Responsabilidad |
|--------|-----------------|
| `db.js` | Pool MySQL singleton (connectionLimit=10), `withTransaction()`, `readCursor()` / `writeCursor()` para persistir cursores en `sync_cursors`. |
| `logger.js` | Logger JSON estructurado: `{ts, level, service, direction, ticket_id, aranda_item_id, msg, err}`. Soporta `child(defaults)` por servicio. |
| `glpiClient.js` | Singleton GLPI. Sesión auto-renovada, integra `withRetry` + `CircuitBreaker` + `RateLimiter`. Métodos: `ensureSession`, `getLog`, `getTicket`, `updateTicket`, `addFollowup`, `getTicketTasks`, `addTicketTask`. 401 → invalida sesión + reintenta una vez dentro de `request()`. |
| `arandaClient.js` | Singleton Aranda. Sesión auto-renovada, mismo stack que GLPI. Métodos: `ensureLogin`, `addItem`, `updateItem`, `addItemNote`, `getItemNoteList`, `listItems`. |
| `retry.js` | `withRetry(fn, {maxAttempts, baseMs, maxMs, nonRetryStatuses})` — exponencial con jitter. Por defecto no reintenta 400/404/422. |
| `circuitBreaker.js` | Estados CLOSED / OPEN / HALF_OPEN. Abre tras `CIRCUIT_THRESHOLD=5` fallos consecutivos. Después de `CIRCUIT_RESET_MS=60000` pasa a HALF_OPEN. No cuenta 4xx no-retriables como falla de salud. |
| `rateLimiter.js` | Token bucket (`GLPI_RATE_LIMIT=10/s`, `ARANDA_RATE_LIMIT=5/s` configurable). |
| `syncEvents.js` | `recordEvent` + `recentInverseEvent` consultando `sync_events` con ventana temporal. |
| `health.js` | Writer asíncrono de `state/health.json` con `{service, lastTickAt, lastError, breakers: {glpi, aranda}}`. |
| `migrator.js` | Aplica `migrations/*.sql` en orden numérico. Registra cada migración en `_schema_version`. Parser tolerante a comentarios `--`. Idempotente. |
| `hash.js` | `sha256(str)` para construir ids estables (anti-dedupe en `aranda_inbound_*`). |
| `utils.js` | Parsers GLPI (`coerceInt`, `extractName`), `fieldsArrayToObject` para respuestas Aranda, `normalizeHtml` (decode entities + strip tags), constantes `FROM_ARANDA_TAG`, `LEGACY_BACKLINK_PREFIX`. |
| `baseService.js` | Clase base de cada servicio. `start()` arranca `setInterval` con `runTick()` no-reentrante (saltea si el tick anterior aún corre). `stop()` espera hasta 5s al tick activo. Hooks de health. |

---

## Flujo Completo de un Ticket Nuevo

### Caso: GLPI origina

```
Usuario crea ticket en GLPI #42558 (type=2 Requerimiento)
    │
    ▼  glpiTicketSync (siguiente tick)
GLPI GET /Log + GET /Ticket/42558
MySQL: INSERT tickets (id=42558, origin='GLPI', status=1, type=2, ...)
    │
    ▼  arandaTicketPush
SELECT tickets WHERE origin='GLPI' AND id NOT IN (SELECT ticket_id FROM aranda_items)
POST Aranda /item/add/4 → {itemId: 368801, composedItemId: "RF-368801-1-168151"}
MySQL: INSERT aranda_items (42558, 368801, "RF-368801-...", origin='GLPI', status='synced')
    │
    ▼  arandaBacklinkToGlpi
GLPI PUT /Ticket {id: 42558, externalid: "RF-368801-1-168151"}
MySQL: UPDATE aranda_items SET glpi_backlinked_at = NOW()
    │
    ▼  flujos continuos (en paralelo)
glpiFollowupSync     → comentarios GLPI    → ticket_followups (origin=GLPI)
arandaNotesPush      → ticket_followups    → POST /item/368801/4/note
glpiTaskSync         → TicketTasks GLPI    → ticket_tasks (origin=GLPI)
arandaTasksPush      → ticket_tasks        → POST /item/368801/4/note con [Tarea GLPI]
glpiSolutionSync     → solución GLPI       → ticket_solutions
arandaSolutionPush   → ticket_solutions    → POST /item/update con Commentary
statusSync (PUSH)    → cambios estado GLPI → POST /item/update con StateId+ReasonId+Commentary
```

### Caso: Aranda origina  ⛔ DESHABILITADO (política GLPI-master)

> Por política, un caso creado en Aranda **NO** se crea en GLPI ni se sincroniza.
> El flujo de abajo solo aplica si se reactiva `ARANDA_TICKET_PULL_ENABLED=true` (no recomendado).

```
Usuario crea caso RF-369999 en Aranda (AuthorId ≠ ARANDA_AUTHOR_ID)
    │
    ▼  arandaTicketPull  (deshabilitado por defecto)
POST /item/list con filtro AuthorId != bot
Detecta item 370000 no presente en aranda_items
POST GLPI /Ticket (externalid="IM-370000-1-xxxxx") → ticket #42999
MySQL: INSERT aranda_inbound_items (370000, status=synced, glpi_ticket_id=42999)
       INSERT tickets (42999, origin='ARANDA', ...)
       INSERT aranda_items (42999, 370000, origin='ARANDA', status='synced')
       → externalid del ticket GLPI = ComposedId Aranda (marcador [from aranda] sin id en el cuerpo)
    │
    ▼  flujos continuos
arandaNotesPull
  → GET /item/370000/4/note/list
  → ActionType=16 NOTA + AuthorName ≠ bot
     → GLPI addFollowup con prefijo [from aranda]
     → INSERT aranda_inbound_notes
     → INSERT ticket_followups (origin=ARANDA) (para que arandaNotesPush NO lo reenvíe)
  → ActionType=22 TAREA + AuthorName ≠ bot
     → GLPI addTicketTask
     → INSERT aranda_inbound_tasks
     → INSERT ticket_tasks (origin=ARANDA)

statusSync (PULL)
  → POST /item/list, detecta StateId cambiado
  → Mapeo a GLPI status (no degradar si current=5 o 6)
  → PUT /Ticket {input: {id: 42999, status: ...}}
  → UPDATE tickets SET status (importante: cache local porque /Log no lo capta)
  → recordEvent ARANDA_TO_GLPI

arandaSolutionPull (cuando StateId=21 Resuelto persiste)
  → GET /item/{id}/{seg}/note/list
  → busca transición [STATUS]→Resuelto + [COMMENTARY] del mismo CreationDate/AuthorName
  → si autor = bot Atena_GLPI → skip (lo movió el sync, no es solución humana)
  → si GLPI status < 5: POST /ITILSolution con el Commentary.New
  → si GLPI status ≥ 5: POST /ITILFollowup con prefijo [Solución Aranda] (GLPI rechaza
                          ITILSolution con "ERROR_GLPI_ADD: El tema ya está resuelto"
                          una vez status=5/6)
  → INSERT aranda_solution_pulls (idempotente, una solución por aranda_item_id)
  → INSERT ticket_solutions (solution_id = -aranda_item_id, origin='ARANDA')
  → recordEvent ARANDA_TO_GLPI entityType=solution

arandaTicketPush
  → SELECT WHERE origin='GLPI' → NO toma 42999 ✓ (origin=ARANDA)
```

---

## Patrones Clave

**Cursor persistido en BD**: cada servicio lee/escribe en `sync_cursors` (`glpi_log_max_id`, `aranda_pull_max_id`, etc.). Tras un reinicio, reanuda exactamente donde quedó.

**Bootstrap silencioso**: en el primer arranque, `arandaTicketPull` marca todos los items existentes como `ignored` para no inundar GLPI con la historia entera de Aranda.

**Append atómico SQL**: `tickets.ITILFollowup` y `tickets.ITILSolution` se actualizan con `CONCAT` en el `UPDATE` para evitar race conditions entre el sincronizador y otros procesos.

**Idempotencia universal**: todas las escrituras usan `INSERT ... ON DUPLICATE KEY UPDATE` con PK natural. Reejecutar cualquier ciclo es seguro.

**Fallback de segmento**: si una operación Aranda devuelve 404 con el segmento esperado, se reintenta con el opuesto antes de marcar como error (defensa ante `CaseType` mal asignado).

**Anti-degradación de estados**: el pull NO baja un ticket GLPI desde 5/6 a estados inferiores. El operador puede mover libremente entre 2 (En curso) y 4 (En espera), pero una vez Resuelto/Cerrado no se reabre desde Aranda.

**Health asíncrono**: cada servicio reporta su último tick exitoso/fallido a `health.json`. Los breakers se snapshotean cada 60s.

**Shutdown graceful**: SIGINT/SIGTERM detiene `setInterval`, espera 5s al tick activo, cierra el pool MySQL, exit 0.

---

## Configuración (`.env`)

```ini
# === GLPI ===
GLPI_BASE_URL=https://glpi.iammtechs.com/apirest.php
APP_TOKEN=...
USER_TOKEN=...
GLPI_FILTER_USER=controles (1628)
GLPI_TIMEOUT_MS=30000
GLPI_RATE_LIMIT=10

# === MySQL ===
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASS=root
DB_NAME=mdh
DB_POOL_LIMIT=10

# === Sincronización ===
POLL_INTERVAL=20                    # Segundos entre ticks de cada servicio (min 5)
RUN_MIGRATIONS_ON_START=true
SERVICES_ENABLED=                   # CSV o vacío para todos

# === Reintentos / Circuit breaker ===
RETRY_MAX_ATTEMPTS=5
RETRY_BASE_MS=1000
RETRY_MAX_MS=30000
CIRCUIT_THRESHOLD=5
CIRCUIT_RESET_MS=60000

# === Aranda ===
ARANDA_BASE_URL=https://mesadeserviciostic.hacienda.go.cr/ASDKAPI/api/v8.6
ARANDA_USERNAME=Atena_GLPI
ARANDA_PASSWORD=...
ARANDA_TIMEOUT_MS=30000
ARANDA_RATE_LIMIT=5
ARANDA_AUTHOR_ID=2314762            # Para filtros anti-bucle y firmar updates
ARANDA_CATEGORY_ID=722
ARANDA_CUSTOMER_ID=5081
ARANDA_GROUP_ID=14
ARANDA_PROJECT_ID=1
ARANDA_REGISTRY_TYPE_ID=6
ARANDA_SERVICE_ID=551
ARANDA_SLA_ID=913
ARANDA_URGENCY_ID=3
ARANDA_COMPANY_ID=
ARANDA_RESPONSIBLE_ID=
ARANDA_DEFAULT_GLPI_TYPE_FROM_SEGMENT=2  # Default type=2 (RF) para tickets pulled de Aranda

# === Inbound (Aranda → GLPI) ===
ARANDA_PULL_PAGE_SIZE=50
INBOUND_GLPI_REQUESTER_ID=          # ID del usuario GLPI bajo el cual se crean tickets origen=ARANDA

# === Anti-eco ===
ANTI_ECHO_WINDOW_SECONDS=60

# === Health / logs ===
LOG_LEVEL=info
LOG_FORMAT=json
HEALTH_FILE=state/health.json
```

---

## Dependencias npm

| Paquete  | Uso |
|----------|-----|
| `axios`  | Cliente HTTP base para ambos clientes (GLPI y Aranda) |
| `dotenv` | Carga `.env` |
| `he`     | Decodifica entidades HTML en contenidos de ticket |
| `mysql2` | Cliente MySQL con `Promise` y pool |

Sin TypeScript, sin frameworks web. ESM puro (`"type": "module"`).

---

## Comandos

```bash
npm start          # producción
npm run dev        # NODE_ENV=development LOG_LEVEL=debug
npm run migrate    # aplica migraciones y sale
```

### Operacional
```bash
# Reiniciar daemon
pkill -f 'node src/index' && nohup npm start > /tmp/mdh-run.log 2>&1 &

# Validar un caso
node scripts/verify-42586.js

# Inspeccionar estados Aranda
node scripts/explore-aranda-states.js

# Probar flujo GLPI → Aranda E2E
node scripts/test-glpi-to-aranda.js
```

---

## Garantías Operacionales

- **Espejo bidireccional verificado**: tickets, comentarios, tareas y estados en ambas direcciones.
- **Sin pérdida de datos**: la BD actúa como buffer; si una API está caída, los registros quedan pendientes y se reintentán.
- **Sin duplicados**: PK natural en todas las tablas de mapping; `INSERT ... ON DUPLICATE KEY UPDATE` en todas las escrituras.
- **Sin ciclos infinitos**: anti-bucle multi-capa (`origin` + autor/marker + `sync_events`).
- **Reanudable tras reinicio**: cursores en BD; el sistema no pierde posición.
- **Robusto ante caídas**: reintentos exponenciales, circuit breaker independiente por API.
- **Auditoría completa**: `sync_events` registra cada propagación con dirección, entidad y hash.
- **Visibilidad**: `state/health.json` actualizado por cada servicio; logs JSON parseables.

---

## Limitaciones Conocidas

Sección crítica para operadores y desarrolladores. Estas limitaciones vienen de la API de Aranda y/o los permisos del rol `Atena_GLPI`. El sistema las maneja correctamente pero no las puede eliminar — son del entorno.

### 1. Cuenta `Atena_GLPI` es compartida con humanos

**Problema**: el bot usa las credenciales `Atena_GLPI` para escribir en Aranda. Esa misma cuenta puede ser usada por operadores humanos para hacer cambios manuales en la UI de Aranda. La API no permite distinguir bot vs humano por usuario.

**Mitigación**: anti-bucle por **marcador** en el contenido, no por author. El bot antepone marcadores propios:
- `[Nota GLPI]` en notas pusheadas (`arandaNotesPush`).
- `[Tarea GLPI]` en tareas pusheadas (`arandaTasksPush`).
- `[from aranda]` en followups creados desde la dirección Aranda→GLPI.

Notas/tareas del humano usando la cuenta del bot **NO llevan marcador** → se procesan normalmente como originadas en Aranda y se propagan a GLPI.

**Solución recomendada**: usar una cuenta distinta para el bot y dejar `Atena_GLPI` exclusivamente para automatización.

### 2. Aranda no expone CRUD de tareas con permisos del bot

**Problema**: probados 6 endpoints (`/task`, `/casetask`, `/item/{id}/{seg}/task`, etc.) — todos dan 404 o 405. El rol `Atena_GLPI` no puede crear ni cerrar tareas reales en Aranda.

**Mitigación**: las tareas GLPI (`TicketTask`) se propagan a Aranda como **notas** con prefijo `[Tarea GLPI]`. El operador las ve en la pestaña Notas/Comentarios del caso Aranda, no en la pestaña Tareas.

**Consecuencia**: la asimetría se nota en el flujo inverso — las tareas humanas creadas directamente en Aranda (ActionType=22 reales) sí se propagan a GLPI como `TicketTask` reales. Pero al revés, GLPI→Aranda, no.

### 3. Rol `Atena_GLPI` no puede cerrar casos en Aranda

**Problema**: `POST /item/update` con StateId 11 (Cerrado IM) o 29 (Cerrado RF) devuelve `403 UnauthorizedCaseClosure`.

**Mitigación**: GLPI status 6 (Cerrado) se mapea a Aranda StateId 21 (Resuelto) en lugar de Cerrado. El cierre formal del caso en Aranda queda como acción humana que el operador hace al final. Documentado en el Commentary que el bot envía: "Caso cerrado en GLPI (queda pendiente el cierre formal por el operador en Aranda)".

### 4. Aranda requiere todas las tareas cerradas antes de Resuelto/Cerrado

**Problema**: si un caso Aranda tiene tareas reales pendientes (ActionType=22 abiertas), `POST /item/update` con StateId=21 (Resuelto) devuelve `400 TaskPending`. Y el bot no puede cerrar tareas Aranda (limitación 2).

**Mitigación**: `statusSync` detecta `TaskPending`, NO marca como synced, registra el error claro:
```
TaskPending: Aranda exige cerrar tareas pendientes antes de transicionar a StateId=X.
Cierra las tareas en Aranda o cancélalas — el sistema reintentará automáticamente.
```
El siguiente tick reintenta, así que apenas el operador cierra las tareas manualmente en Aranda, el estado se sincroniza solo.

### 5. Aranda exige `Commentary` en cada `POST /item/update`

**Problema**: cualquier update sin el campo `Commentary` devuelve `400 InvalidCommentary`, incluyendo cambios de estado, urgency, priority.

**Mitigación**: todos los servicios que llaman `updateItem` (statusSync, prioritySync) incluyen un `Commentary` descriptivo automáticamente.

### 6. Aranda Urgency tiene sólo 3 niveles (mapeo lossy)

**Problema**: `/urgency/list` devuelve sólo `LOW(2)`, `HIGH(3)`, `CRITICAL(4)` — no hay MEDIUM.

**Mitigación**: GLPI urgency 3 (Mediano) y 4 (Alto) colapsan en Aranda HIGH. Inverso: HIGH → GLPI 3. **El valor exacto no se preserva** en un round-trip si el original GLPI era 4. El operador debe asumir que las urgencias importantes se redondean al alza.

### 7. Aranda Impact NO es accesible

**Problema**: `/impact/list` devuelve `404`. Aranda calcula `ImpactName` internamente o no es editable vía API con este rol.

**Mitigación**: el campo `tickets.impact` de GLPI se persiste en la BD del bot pero **no se sincroniza a Aranda**. Sólo se mantiene como referencia local. Aranda mostrará el impact que él mismo calcule (típicamente derivado de urgency × priority).

### 8. GLPI `/Log` rota agresivamente (~15 entries)

**Problema**: esta instancia de GLPI conserva sólo las últimas ~15 entradas en `/Log`. Además, el campo `user_name` siempre es el dueño del API token (no el usuario humano que hizo el cambio), así que el filtro `user_name = GLPI_FILTER_USER` no captura cambios de operadores reales si se usan diferentes API tokens.

**Mitigación**: `glpiFollowupSync` y `glpiTaskSync` hacen **polling directo por ticket** sobre todos los tickets mapeados, en vez de depender de `/Log`. Más caro en términos de requests, pero confiable.

### 9. Endpoint `GET /item/{id}/{seg}` da 404 frecuentemente

**Problema**: el endpoint de detalle de un item por id+segmento no es confiable — devuelve 404 incluso con valores correctos.

**Mitigación**: en lugar de `getItemDetail`, los servicios usan `POST /item/list` con filtros (es el que sí funciona) y procesan el resultado. `arandaNotesPull` sí usa `/item/{id}/{seg}/note/list` que es un endpoint diferente y sí responde.

### 10. Aranda `/item/list` filtrado por `FieldName: 'Id'` es errático

**Problema**: pasar `Criteria: [{FieldName:'Id', Value:'X', ComparisonOperatorId:1}]` no devuelve el item esperado — devuelve los primeros N items sin filtrar correctamente.

**Mitigación**: hacer barrido general (filtrado por `AuthorId` u otro criterio amplio) y filtrar el resultado en código por `Id`.

### 11. Aranda invalida sesión al loguear en paralelo

**Problema**: cada `POST /user/login` invalida sesiones previas con la misma credencial. Si dos procesos (daemon + script de exploración) están corriendo simultáneamente con `Atena_GLPI`, ambos se invalidan mutuamente y todo da 401.

**Mitigación**: ejecutar scripts de exploración con el daemon detenido. El daemon en sí mismo tiene un único cliente Aranda (`arandaClient` singleton) que comparte sesión entre todos sus servicios — no se auto-invalida.

### 12. `Id` de entries en `/note/list` siempre es 0

**Problema**: el campo `Id` de cada entry en el historial de un item siempre viene como 0, no es un identificador estable.

**Mitigación**: deduplicación por hash compuesto `sha256(itemId + AuthorName + CreationDate + Description)`, almacenado como PK `aranda_note_id` / `aranda_task_id` en `aranda_inbound_*`.

### 13. Estados Aranda usan dos sets de IDs según `CaseType`

**Problema**: para Incidencias (CaseType=1, segment=1) y Requerimientos (CaseType=4, segment=4) los `StateId` son diferentes:
- IM: En Espera=10, Cerrado=11
- RF: En Espera=19, Cerrado=29
- Comunes a ambos: Proceso=20, Resuelto=21

**Mitigación**: `mapGlpiToAranda(status, type)` recibe ambos parámetros y devuelve el mapeo correcto. Hay fallback automático al segmento opuesto ante 404 (cuando el `type` GLPI quedó desalineado con `CaseType` real).

### 14. `ARANDA_SERVICE_ID` y `ARANDA_SLA_ID` siguen siendo globales

**Problema**: `ARANDA_SERVICE_ID`, `ARANDA_SLA_ID` siguen fijos en `.env`. Todo ticket creado en Aranda desde GLPI usa la misma línea de servicio y SLA.

**Mitigación actual**:
- **Categoría + segmento** se resuelven dinámicamente vía `service_catalog_sync` (77 mapeos — todo el catálogo Aranda cubierto).
- **`GroupId` y `ResponsibleId`** se resuelven vía `service_catalog_sync.responsable_label` → `aranda_groups (is_default_for_label=1)`. Si la categoría apunta a "Consorcio - Mesa de Servicio N1" (36 de 52), cae al `ARANDA_GROUP_ID` del `.env` (el grupo del bot mismo). El resto resuelve al grupo del Ministerio correspondiente (DTIC, DGA, DGT, Aduanas).
- **`ServiceId` / `SlaId`** siguen siendo globales. Cuando Aranda exponga `/service/list` con permisos del bot, se podrá extender el seed para resolverlos también.

**Ambigüedades resueltas con "primero del bloque"** (re-correr `seed-groups.js` para ajustar):
- DGA-DGT → grupo 63 (DGT - Procesos Aduaneros) como default.
- Aduanas → grupo 67 (Jefe Sección Técnica Caldera) como default.
- DTIC → grupo 0 (Grupo clasificación tickets DTIC) — ambos grupos DTIC comparten id=0/N-A en el catálogo fuente.

### 15. ~~Aranda NO acepta POST de adjuntos al rol `Atena_GLPI`~~ — **RESUELTO 2026-06-17**

**Estado**: bidireccional con binario real en ambos sentidos.

**Lo que se creía** (entre 2026-06-11 y 2026-06-17): los probes barrieron >40 endpoints alternos para upload (`/item/{id}/{seg}/{userId}/files`, handlers `.ashx`, `/item/{id}/{seg}/note` con `Files` inline, etc.) — todos 404 / 405 / 200-silently-ignored. Conclusión provisional: API no implementa upload.

**Lo que faltaba probar**: la doc oficial v1.9 documenta `POST /item/addfile` (recurso top-level, multipart con `file0`+`itemId`+`itemType`+`userId`). Ese endpoint **no estaba** en el patrón de los probes (que buscaban variantes anidadas bajo `/item/{id}/...` o RPC tipo `/file/upload`). Re-probado contra el servidor v8.6 con `scripts/probe-aranda-addfile.js` (2026-06-17): los 3 variantes E1/E2/E3 devolvieron `200 [{"FileName":"…","Result":true}]` y el listing posterior confirmó `Δ archivos = +3`.

**Implementación final**:

| Servicio | Dirección | Lógica |
|---|---|---|
| `arandaAttachmentsPull` | Aranda → GLPI | `GET /item/{id}/{seg}/{userId}/files` + descarga del `Url` firmado + `POST /Document` multipart en GLPI. El `Url` expira en minutos, por eso listing+download+upload va en una pasada. Registra row con `source='pull'`. |
| `arandaAttachmentsPush` | GLPI → Aranda | `GET /Document/{id}?alt=media` (binario) + `POST /item/addfile` multipart con `file0`/`itemId`/`itemType`/`userId`. Tracker `aranda_attachment_notes` con PK compuesta `(document_id, ticket_id)`. |
| Anti-eco | bidireccional | Tras `addfile` exitoso, `arandaAttachmentsPush` hace listing y registra el `aranda_file_id` recién creado en `aranda_inbound_files` con `source='push'`, `status='synced'`, `glpi_document_id=<doc original>`. El pull lo skipea (ya está marcado synced). El sync inverso `glpiAttachmentsSync` filtra solo rows `source='pull'` (los `source='push'` no son del bot al pullear — fueron uploads humanos en GLPI). |

**Métodos relevantes**:
- `glpiClient.downloadDocumentBinary(id)` — `GET /Document/{id}?alt=media` con `responseType:'arraybuffer'`, devuelve `{buffer, mime, size}`.
- `arandaClient.addFileToItem(itemId, segment, userId, {filename, buffer, mime})` — multipart con `file0`. Verifica `Result:true` en la respuesta antes de devolver.

**Polling de 4 fuentes Document_Item en GLPI 10+** (descubierto al notar que un archivo subido en un comentario quedaba enlazado al `ITILFollowup`, NO al `Ticket`): `glpiAttachmentsSync.scanTicket()` consulta las 4 entidades de timeline y dedupea por `documents_id`. Para cada `child` (followup/solution/task), limita a los más recientes (10/5/10) por costo de API.

**Trampas que se evitaron**:
- El field obligatorio se llama **`file0`** (con cero), no `file`. La doc V1.9 lo especifica así pero en la práctica v8.6 acepta cualquier nombre — el match es por el `filename` del multipart, no por el `key`. Para alinearse con la doc usamos `file0`.
- El header `Content-Type` por defecto del singleton `arandaClient` es `application/json`. Para multipart hay que sobrescribir con `form.getHeaders()` (`form-data` npm). Si no, IIS devuelve 400 `FailureReadingRequestData`.
- **GLPI deduplica `Document` por sha1**: el mismo archivo subido a dos tickets distintos comparte el `documents_id`. Originalmente la PK de `glpi_attachments` y `aranda_attachment_notes` era solo `document_id`, lo que hacía invisible el segundo ticket. Migración 012 cambia a PK compuesta `(document_id, ticket_id)`. JOIN del push usa ambas columnas.
- **Anti-eco direccional**: `aranda_inbound_files` se usa para dos cosas opuestas (registro de inbound real + anti-eco del push). Migración 013 añade columna `source ENUM('pull','push')`. El filtro de `glpiAttachmentsSync` solo skipea `source='pull'`.

**Colección Postman**: `postman/aranda-upload-probes.postman_collection.json` (probes E1/E2/E3 con la doc oficial; A*/B*/C*/D* mantienen la historia exhaustiva del barrido inicial para evitar reabrir hipótesis ya descartadas).

### 16. GLPI `/Document` requiere `Content-Type: multipart/form-data` con boundary

**Problema**: el cliente axios singleton tiene `Content-Type: application/json` como header default. Al subir un archivo con FormData ese header sobrescribe el multipart correcto, y GLPI responde `400 ERROR_BAD_ARRAY` ("el parámetro de entrada debe ser un arreglo de objetos").

**Mitigación**: `glpiClient.uploadDocumentToTicket` pasa explícitamente `Content-Type: undefined` para que axios+FormData generen el `multipart/form-data; boundary=...` correcto.

---

## Catálogo de categorías (implementado)

### Estado actual

- Documento fuente: `Libro1.utf8.csv` (export funcional Aranda, 77 subcategorías; auxiliarmente `CATALOGO.md`).
- Sync: `scripts/sync-glpi-from-csv.js` carga 77 entradas en `service_catalog_sync` con `match_strategy='csv_seed'` y `status='matched'`. El mismo script reorganiza GLPI: mueve los 13 grupos preexistentes bajo MDH (658), crea 4 grupos nuevos (Pago 727, Rectificación 728, Firma 729, Levante 730) y las 25 subs faltantes. Idempotente.
- Migración: `007_catalog_sync.sql` añade:
  - `tickets.itilcategories_id INT UNSIGNED NULL` — la categoría real (numérica) del ticket GLPI.
  - `service_catalog_sync.aranda_segment TINYINT` — 1=IM, 4=RF; necesario porque la misma subcategoría puede vivir en ambos segmentos.
  - `aranda_inbound_items.aranda_category_id INT` — la subcategoría con la que llegó el caso desde Aranda.
- `glpiClient.getTicketRaw(id)` — variante de `getTicket` sin `expand_dropdowns`; devuelve `itilcategories_id` numérico (no el `completename`).
- `glpiTicketSync` usa `Promise.all([getTicket, getTicketRaw])` y guarda ambos: `itilcategory_name` (texto) y `itilcategories_id` (id). Normaliza 0 → NULL.
- `arandaTicketPush` hace LEFT JOIN con `service_catalog_sync`; cuando hay match, sobrescribe `CategoryId` y `segment` por los mapeados. Sin match → defaults del `.env`.
- `arandaTicketPull` captura `CategoryId` de cada item Aranda, lo persiste en `aranda_inbound_items.aranda_category_id`, y al crear el ticket GLPI hace JOIN inverso para fijar `itilcategories_id`.
- Backfill: `scripts/backfill-category.js` recorre tickets existentes y rellena `itilcategories_id` desde `/Ticket/{id}` raw.

### Pendientes funcionales para extender el catálogo

Documentados en CATALOGO.md sección 5.3:
- GLPI 682/683 (`Problemas al Guardar / Almacenar`) aparecen como duplicados textuales.
- Grupos sólo-Aranda sin equivalente GLPI: Pago (869/904), Rectificación (879), Firma Digital (881/907), Levante (884).
- Aranda divide grupos "base + escalamiento" (904/907/909/911/913) que GLPI no modela como hijos separados.
- Subcategorías Aranda de Tránsito (9) vs GLPI (1).
- Aranda 876, 877 (API auth/integración) sin equivalente GLPI.

Cuando funcional resuelva las decisiones, se actualiza `scripts/seed-catalog.js` y se re-ejecuta — es idempotente.
