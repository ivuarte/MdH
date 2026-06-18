# Postman — Endpoints GLPI + Aranda usados por el daemon

Colección reproducible de **todos los endpoints REST** que el daemon MdH v2 consume en producción. Permite probar cada llamada de forma aislada en Postman antes de tocar código.

- Archivo importable: [`mdh-endpoints.postman_collection.json`](./mdh-endpoints.postman_collection.json)
- Doc oficial Aranda ASDK API (v1.9 documentada / v8.6 desplegada): [`asdk-api.pdf`](./asdk-api.pdf)
- Spec interna del daemon: [`../ARQUITECTURA.md`](../ARQUITECTURA.md) §"Endpoints API Descubiertos"

---

## 1. Setup

1. **Importar** la colección en Postman (`File → Import → mdh-endpoints.postman_collection.json`).
2. Editar las variables de colección con los valores reales del entorno (ver tabla §2).
3. **Para llamadas autenticadas**, ejecutar primero los logins (el test script auto-guarda el token):
   - `GLPI / 00 - Auth → 00.1 GET /initSession`
   - `Aranda / 00 - Auth → 00.1 POST /user/login`
4. Ya podés correr cualquier request del resto de carpetas.

> ⚠️ Aranda invalida la sesión si abres dos logins en paralelo con la misma credencial (Limitación 11 de ARQUITECTURA.md). Para probar desde Postman conviene **parar el daemon** (`pkill -f 'node src/index'`) o usar una cuenta dedicada distinta de la del daemon.

---

## 2. Variables de colección

### GLPI
| Variable | Para qué |
|---|---|
| `GLPI_BASE_URL` | `https://glpi.iammtechs.com/apirest.php` |
| `APP_TOKEN`, `USER_TOKEN` | Credenciales del API de GLPI (`.env`) |
| `TICKET_ID` | Ticket de prueba (p.ej. `43126`) |
| `GLPI_FOLLOWUP_ID` | Id de followup para probar /Document_Item |
| `GLPI_SOLUTION_ID` | Id de solución para probar /Document_Item |
| `GLPI_TASK_ID` | Id de tarea para probar /Document_Item |
| `GLPI_DOCUMENT_ID` | Id de Document para metadata/descarga |
| `glpi_session_token` | **Auto** — lo setea `/initSession` |

### Aranda
| Variable | Para qué |
|---|---|
| `ARANDA_BASE_URL` | `https://mesadeserviciostic.hacienda.go.cr/ASDKAPI/api/v8.6` |
| `ARANDA_USERNAME`, `ARANDA_PASSWORD` | Cuenta `Atena_GLPI` |
| `ARANDA_ITEM` | Item de prueba (p.ej. `370716`) |
| `SEG` | Segmento: `1`=IM (Incidencia), `4`=RF (Requerimiento) |
| `USER_ID` | `ARANDA_AUTHOR_ID` (p.ej. `2314762`) |
| `STATE_ID`, `ARANDA_PROJECT_ID` | Para los catálogos / item/update |
| `aranda_session_id` | **Auto** — lo setea `/user/login` |

---

## 3. Estructura de la colección

Cada carpeta agrupa los endpoints que el daemon usa, con un body de ejemplo realista y descripción de qué servicio interno lo consume.

### GLPI

| Carpeta | Endpoints | Servicio del daemon |
|---|---|---|
| **00 - Auth** | `GET /initSession`, `GET /killSession` | `glpiClient.ensureSession()` |
| **Tickets** | `GET /Log`, `GET /Ticket/{id}`, `GET /Ticket/{id}?expand_dropdowns=true`, `POST /Ticket`, `PUT /Ticket` | `glpiTicketSync`, `arandaTicketPull`, `statusSync` |
| **Timeline** | `GET/POST /ITILFollowup`, `GET/POST /ITILSolution`, `GET/POST /TicketTask` | `glpiFollowupSync`, `glpiSolutionSync`, `glpiTaskSync`, `arandaBacklinkToGlpi`, `arandaNotesPull`, `arandaSolutionPull` |
| **Documents (Attachments)** | `GET /{Ticket\|ITILFollowup\|ITILSolution\|TicketTask}/{id}/Document_Item`, `GET /Document/{id}`, `GET /Document/{id}?alt=media`, `POST /Document/` multipart | `glpiAttachmentsSync`, `arandaAttachmentsPush`, `arandaAttachmentsPull` |

### Aranda ASDKAPI v8.6

| Carpeta | Endpoints | Servicio del daemon |
|---|---|---|
| **00 - Auth** | `POST /user/login` (array `[{Field,Value}]`) | `arandaClient.ensureLogin()` |
| **Items** | `POST /item/list`, `POST /item/add/{SEG}`, `POST /item/update/{ITEM}/{SEG}/{USER}`, `GET /item/{ITEM}/{SEG}` | `arandaTicketPush`, `arandaTicketPull`, `statusSync`, `prioritySync`, `arandaSolutionPush` |
| **Notes (timeline)** | `POST /item/{ITEM}/{SEG}/note`, `GET /item/{ITEM}/{SEG}/note/list` | `arandaNotesPush`, `arandaTasksPush`, `arandaNotesPull`, `arandaSolutionPull` |
| **Files (Attachments)** | `GET /item/{ITEM}/{SEG}/{USER}/files`, `POST /item/addfile` multipart | `arandaAttachmentsPull`, `arandaAttachmentsPush` |
| **Catálogos** | `GET /state/list`, `GET /state/{id}/reasons`, `GET /urgency/list`, `GET /priority/list` | Descubrimiento (no llamados en runtime, base de los mapeos en `src/lib/priorityMapping.js` y `statusSync.js`) |

---

## 4. Convenciones críticas de ASDKAPI v8.6

ASDKAPI viene de un stack ASMX/SOAP heredado. Tiene **dos shapes distintos de body** según el endpoint; mezclarlos da errores 400 confusos:

| Endpoint | Body |
|---|---|
| `POST /user/login` | **Array `[{Field, Value}, …]`** (lowercase `username`/`password`) |
| `POST /item/add/{seg}` | Array `[{Field, Value}, …]` |
| `POST /item/update/{id}/{seg}/{user}` | Array `[{Field, Value}, …]` — exige campo `Commentary` |
| `POST /item/{id}/{seg}/note` | **Objeto plano** `{ Description, IsPrivate }` |
| `POST /item/list` | Objeto plano `{ Paging, Criteria, WhereCriteria, Order, ProjectId, ViewId }` |
| `POST /item/addfile` | **multipart/form-data** con `file0` + `itemId` + `itemType` + `userId` |

**Regla mental**: operaciones que escriben *sobre el ítem* (la "tabla") usan array Field/Value; operaciones de alto nivel (notas, listados) usan JSON plano. La respuesta de los endpoints Field/Value **también** viene como array Field/Value — por eso los tests scripts hacen `data.find(x => x.Field === 'sessionId')`.

Si un POST que esperabas que funcionara devuelve `400 InvalidXxx`, lo primero a chequear es **el shape del body**.

---

## 5. Trampas conocidas

| Endpoint | Trampa | Mitigación |
|---|---|---|
| `GET /log` (GLPI minúscula) | Devuelve 400 | Usar `/Log` con L mayúscula (Limitación 8.2 de PLAN_IMPLEMENTACION.md) |
| `POST /ITILSolution` con ticket en status≥5 | `400 ERROR_GLPI_ADD: El tema ya está resuelto` | `arandaSolutionPull` cae a `POST /ITILFollowup` con prefijo `[Solución Aranda]` |
| `POST /Document/` con `Content-Type: application/json` | `400 ERROR_BAD_ARRAY` (rompe el multipart) | En Postman: NO setear Content-Type manualmente. En código: pasar `Content-Type: undefined` para que axios+FormData generen el boundary |
| `POST /item/addfile` con `Content-Type: application/json` | `400 FailureReadingRequestData` | Idem: dejar que el cliente arme el multipart |
| `POST /item/update/…` sin `Commentary` | `400 InvalidCommentary` | Siempre incluir Commentary (el daemon lo hace) |
| `POST /item/update/…` con StateId 11 (IM) o 29 (RF) | `403 UnauthorizedCaseClosure` | El rol `Atena_GLPI` no puede cerrar — GLPI Cerrado mapea a Aranda Resuelto (21) (Limitación 3) |
| `POST /item/list` con `Criteria: [{FieldName:'Id', Value:N}]` | Devuelve los primeros N items sin filtrar por Id | Filtrar en cliente después del barrido (Limitación 10) |
| `GET /item/{id}/{seg}` | 404 frecuente incluso con valores correctos | Usar `/item/list` con criterios amplios (Limitación 9) |
| Dos logins paralelos con la misma credencial Aranda | Se invalidan mutuamente → todo da 401 | Parar el daemon antes de probar desde Postman (Limitación 11) |
| `POST /item/{id}/{seg}/note` con campo `Files`/`Attachments` inline | 200 OK pero el archivo se ignora silenciosamente | NO existe upload inline — usar `POST /item/addfile` por separado |

---

## 6. Cómo se descubrió `POST /item/addfile`

En junio 2026 estuvimos por semanas creyendo que ASDKAPI v8.6 no tenía endpoint de upload (>40 probes alternativos: `/item/{id}/{seg}/{user}/files` POST/PUT/multipart/JSON, handlers `.ashx`, inline en `/note`, etc.). Todos devolvían 404, 405 `Allow: GET` o 200 sin efecto.

La pista decisiva fue revisar la doc oficial (`postman/asdk-api.pdf`) que documenta **`POST /item/addfile`** como recurso top-level con multipart `file0`+`itemId`+`itemType`+`userId`. Ese path **no estaba** en el patrón de los probes (que buscaban variantes anidadas bajo `/item/{id}/…` o RPC tipo `/file/upload`). Validado en v8.6 con 3 variantes (E1/E2/E3 — `file0` vs `file`, lowercase vs CamelCase): los tres devolvieron `200 [{"Result":true}]` y `Δ archivos = +1` en el listing posterior.

Esto resolvió la **Limitación 15** de `ARQUITECTURA.md` (que decía "Aranda NO acepta POST de adjuntos al rol Atena_GLPI"). Hoy el flujo bidireccional GLPI ↔ Aranda es binario real en ambos sentidos.

---

## 7. Re-validación desde código

Sin pasar por Postman, el daemon valida todos estos endpoints en cada tick. Para probar uno aislado con código:

```bash
cd ~/lab/MdH_v2
# Login + un endpoint puntual
node -e "
import('dotenv/config').then(async () => {
  const { config, validateConfig } = await import('./src/config.js');
  validateConfig();
  const { arandaClient } = await import('./src/lib/arandaClient.js');
  await arandaClient.ensureLogin();
  // Ejemplo: listar archivos de un item
  const r = await arandaClient.listItemFiles(370716, 4, config.ARANDA_AUTHOR_ID);
  console.log(JSON.stringify(r, null, 2));
});
"
```

Para baterías más grandes mirar `scripts/probe-aranda-*.js` y `scripts/test-glpi-attachment-push.js`.
