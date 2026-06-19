# MdH v2

Daemon Node.js que sincroniza **bidireccionalmente** GLPI ↔ Aranda ASDK por polling, usando MySQL como capa de persistencia, deduplicación y trazabilidad.

> **Política GLPI-master:** los casos se crean **solo en GLPI**. Todo caso creado en GLPI se replica en Aranda y a partir de ahí se actualiza en **ambos sentidos** (estados, notas, tareas, soluciones, adjuntos). Un caso creado **en Aranda NO se crea en GLPI** ni se sincroniza. Implementado vía `ARANDA_TICKET_PULL_ENABLED=false` (default) + filtro `aranda_items.origin='GLPI'` en todos los servicios de sync.

- Arquitectura completa: [`ARQUITECTURA.md`](ARQUITECTURA.md)
- Catálogo de categorías: [`CATALOGO.md`](CATALOGO.md)
- Plan e historial de decisiones: [`PLAN_IMPLEMENTACION.md`](PLAN_IMPLEMENTACION.md)
- Repositorio: <https://github.com/ivuarte/MdH.git>

---

## 1. Requisitos

- Node.js ≥ 20
- MySQL/MariaDB 10.4+ accesible y con base de datos vacía creada (en prod: RDS externo, ver §4.2)
- Acceso de red a la API REST de GLPI (`/apirest.php`) y a Aranda ASDKAPI (`/ASDKAPI/api/v8.6`)
- Credenciales: `APP_TOKEN`, `USER_TOKEN` (GLPI), usuario/clave de Aranda
- **Catálogo MDH cargado en la instancia GLPI destino** (árbol `MDH > grupo > subcategoría`). El seed del mapeo (`scripts/seed-catalog-local.js`) cruza por nombre, así que requiere que las categorías ya existan en GLPI. Ver [`CATALOGO.md`](CATALOGO.md).
- **`GLPI_FILTER_USER` correcto** — el nombre del usuario dueño del API token con formato `"nombre (id)"` (ver §8 y `.env.example`).

---

## 2. Ejecutar localmente

```bash
git clone https://github.com/ivuarte/MdH.git
cd MdH
cp .env.example .env       # completar valores reales
npm ci                     # o `npm install` si no hay package-lock.json
npm run migrate            # aplica migrations/*.sql sobre la BD configurada
npm start                  # arranca el daemon
```

Modo desarrollo (verboso, sin formato JSON):

```bash
npm run dev
```

**Logs y reinicio rápido en background** (lo que ya usabas):

```bash
pkill -f 'node src/index' && nohup npm start > /tmp/mdh-run.log 2>&1 &
tail -f /tmp/mdh-run.log
```

Estado vivo del daemon: `state/health.json` (ruta configurable con `HEALTH_FILE`).

---

## 3. Workflow Git — actualizar y controlar desde GitHub

> Todo cambio debe pasar por `main` en GitHub. El servidor de producción **solo** se actualiza haciendo `git pull` desde el repo.

### 3.1 Subir cambios locales al repo

```bash
git status                          # revisar archivos modificados
git diff                            # revisar diff
git add <archivos>                  # o `git add -A` con cuidado
git commit -m "feat: descripción del cambio"
git push origin main
```

### 3.2 Trabajar en una rama (recomendado para cambios grandes)

```bash
git checkout -b feature/mi-cambio
# ...editar, commitear...
git push -u origin feature/mi-cambio
# abrir PR en GitHub, mergear a main cuando esté validado
```

### 3.3 Traer cambios remotos a tu local

```bash
git fetch origin
git pull --rebase origin main
```

### 3.4 Reglas de oro

- **Nunca commitear `.env`** ni `state/` ni `*.log` (ya están en `.gitignore`).
- Si cambias el schema, **agregar un archivo nuevo** en `migrations/` (ej. `0XX_mi_cambio.sql` con el siguiente número libre — al momento de escribir esto el máximo es `013`). No editar migrations ya aplicadas.
- Si agregas variables de entorno nuevas, **actualiza `.env.example`** en el mismo commit.
- Antes de pushear: `npm start` localmente al menos una vez para confirmar que el daemon arranca y aplica migraciones.

---

## 4. Deploy en otro servidor (controlado desde el repo)

Esta receta asume:

- **Usuario** ya existente en el servidor — se reutiliza el que tengas (en los ejemplos: `<usuario>`). No se crea ningún usuario de servicio dedicado.
- **Directorio del proyecto = HOME del usuario** — el repo se clona en `~/MdH` (es decir, `/home/<usuario>/MdH`).
- **MySQL/MariaDB externo** — no se instala motor de base de datos en el servidor del daemon. La base ya existe en otro host y se accede por red (`DB_HOST`, `DB_PORT`).

> Reemplaza `<usuario>` por tu usuario real en todos los comandos. Si el HOME no es `/home/<usuario>`, ajusta los paths absolutos del unit de systemd.

### 4.1 Preparar el servidor

Solo se necesita Node y Git. Como root (o con `sudo`):

```bash
# Node 20 LTS (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
```

Verificar conectividad a la base externa antes de continuar:

```bash
# desde el servidor del daemon, como <usuario>
nc -vz <DB_HOST> <DB_PORT>          # debe decir "succeeded"
# opcional, si tienes cliente mysql instalado:
mysql -h <DB_HOST> -P <DB_PORT> -u <DB_USER> -p -e 'SELECT 1;'

# Ejemplo real de PRODUCCIÓN (RDS externo, puerto NO estándar 5306):
#   mysql -h atena-tickets-prod-mariadb-incidents.<id>.us-east-1.rds.amazonaws.com -P 5306 -u admin -p
```

### 4.2 Crear la base de datos en el servidor externo

Hazlo desde donde administres el motor (un cliente, phpMyAdmin, otra shell):

```sql
CREATE DATABASE mdh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mdh'@'%' IDENTIFIED BY '<password>';
GRANT ALL PRIVILEGES ON mdh.* TO 'mdh'@'%';
FLUSH PRIVILEGES;
```

> Si el motor restringe orígenes, sustituye `'%'` por la IP del servidor del daemon (`'mdh'@'<ip-del-daemon>'`). Asegúrate de que `bind-address` y el firewall del host de la base permitan la conexión entrante.

### 4.3 Clonar el repo en el HOME del usuario

Logueado como el usuario existente (sin `sudo`):

```bash
cd ~                                # /home/<usuario>
git clone https://github.com/ivuarte/MdH.git
cd MdH
cp .env.example .env
nano .env                           # completar valores reales (DB_HOST/PORT al RDS externo, GLPI_FILTER_USER con formato "nombre (id)")
npm ci --omit=dev
npm run migrate                     # corre migrations/*.sql contra la BD externa
node scripts/seed-catalog-local.js  # carga el mapeo de categorías en service_catalog_sync
```

> **Catálogo (paso obligatorio):** `seed-catalog-local.js` cruza por NOMBRE las categorías de la instancia GLPI destino con `Libro1.utf8.csv` (Aranda) y puebla `service_catalog_sync`. Es **agnóstico de IDs** (funciona en local, preprod y prod sin tocar nada) e **idempotente**. Reporta `matched`/`unmatched`; debe dar 77/77. Si da `unmatched`, falta cargar esas categorías en GLPI. **No usar** `sync-glpi-from-csv.js` en prod: está cableado a los IDs de la instancia vieja (658…) y reorganiza el árbol GLPI. Verificar alineación con `node scripts/analyze-catalog-alignment.js`.

Probar manualmente que arranca:

```bash
npm start
# Ctrl+C cuando confirmes los logs de los servicios:
#   "DB conectada", "GLPI sesión iniciada", "Aranda sesión iniciada", y los servicios "Iniciando (poll=...)"
```

### 4.4 Instalar como servicio systemd

Como root, crear `/etc/systemd/system/mdh.service` (sustituye `<usuario>` y el path absoluto al HOME):

```ini
[Unit]
Description=MdH v2 — sincronizador GLPI <-> Aranda
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<usuario>
WorkingDirectory=/home/<usuario>/MdH
EnvironmentFile=/home/<usuario>/MdH/.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5s
# Logs: usa journald (recomendado) o redirige a un archivo dentro del HOME
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

> No se incluye `mariadb.service` en `After=` porque la base es externa. El daemon ya reintenta y tiene circuit breaker; basta con `network-online.target`.

Habilitar y arrancar:

```bash
systemctl daemon-reload
systemctl enable --now mdh
systemctl status mdh
journalctl -u mdh -f                # logs en vivo
```

### 4.5 Actualizar producción desde el repo

Flujo para aplicar un cambio publicado en GitHub (como el usuario existente):

```bash
cd ~/MdH
git pull --ff-only origin main
npm ci --omit=dev                   # solo si cambió package-lock.json
# (las migraciones se aplican solas si RUN_MIGRATIONS_ON_START=true)
# si lo desactivaste: npm run migrate
node scripts/seed-catalog-local.js  # solo si cambió el catálogo (Libro1.utf8.csv o categorías GLPI)
sudo systemctl restart mdh
sudo journalctl -u mdh -n 100 -f
```

### 4.6 Rollback rápido

```bash
cd ~/MdH
git log --oneline -10               # localizar el commit estable previo
git checkout <sha>                  # detached HEAD a la versión buena
sudo systemctl restart mdh
# cuando se arregle main: git checkout main && git pull && sudo systemctl restart mdh
```

> Migraciones **solo agregan** (nunca editan archivos viejos), así que volver a un commit anterior es seguro siempre que el schema agregado por el commit nuevo sea aditivo.

### 4.7 Auto-deploy opcional (GitHub → servidor)

Si quieres que `push` a `main` despliegue automáticamente, hay dos opciones simples:

**A. Webhook + script tirado por el propio servidor**

1. En el servidor, en el HOME del usuario, crear `~/MdH/deploy.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   cd "$HOME/MdH"
   git pull --ff-only origin main
   npm ci --omit=dev
   sudo systemctl restart mdh
   ```
   `chmod +x ~/MdH/deploy.sh`
2. Exponerlo con un webhook secreto (ej. usando [`webhook`](https://github.com/adnanh/webhook) o un mini-Express con verificación de firma `X-Hub-Signature-256`) ejecutándose con el mismo usuario.
3. Configurar el webhook en GitHub → Settings → Webhooks → `Push` events.

**B. GitHub Actions con SSH**

`.github/workflows/deploy.yml`:

```yaml
name: deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}   # el usuario existente del servidor
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd "$HOME/MdH"
            git pull --ff-only origin main
            npm ci --omit=dev
            sudo systemctl restart mdh
```

Secrets a configurar en `Settings → Secrets and variables → Actions`:
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (clave privada cuya pública esté en `~/.ssh/authorized_keys` del usuario en el servidor).

> Para que `sudo systemctl restart mdh` funcione sin contraseña en el deploy, agrega una regla en `/etc/sudoers.d/mdh`:
> ```
> <usuario> ALL=(root) NOPASSWD: /bin/systemctl restart mdh, /bin/systemctl status mdh
> ```

### 4.8 Checklist de puesta en producción

Validar en orden antes de habilitar el servicio:

- [ ] **DB externa alcanzable**: `nc -vz <DB_HOST> <DB_PORT>` → `succeeded` (prod: puerto **5306**).
- [ ] **TLS a la BD**: si la RDS tiene `require_secure_transport=ON` (error `ER_SECURE_TRANSPORT_REQUIRED`), poner **`DB_SSL=true`** en `.env` (opcional `DB_SSL_CA` para verificar el cert).
- [ ] **Base `mdh` creada** y usuario con privilegios (§4.2).
- [ ] **`.env` completo**: GLPI/Aranda URLs + tokens; `DB_*` al RDS; `NODE_ENV=production`.
- [ ] **`GLPI_FILTER_USER` con formato `"nombre (id)"`** del usuario dueño del API token (confírmalo en una entrada de `/Log`). ⚠️ Si está mal, no entra ningún ticket.
- [ ] **`npm run migrate`** sin errores (13 migraciones, hasta `013_inbound_files_source.sql`).
- [ ] **Catálogo cargado en GLPI** (árbol `MDH`) y **`node scripts/seed-catalog-local.js`** reporta **77/77 matched, 0 unmatched**.
- [ ] **`node scripts/analyze-catalog-alignment.js`** → 16 grupos / 77 subs alineados sin huérfanos.
- [ ] **Preflight OK** en `npm start`: `DB conectada` + `GLPI sesión iniciada` + `Aranda sesión iniciada`.
- [ ] **(Recomendado) primer arranque acotado** a lectura: `SERVICES_ENABLED=glpiTicketSync,glpiFollowupSync,glpiSolutionSync,glpiTaskSync`, validar ingesta, luego habilitar todo.
- [ ] **systemd** habilitado (`systemctl enable --now mdh`) y `journalctl -u mdh -f` sin errores recurrentes.
- [ ] **GLPI 11**: si la instancia destino es 11.x, ejecutar antes el protocolo de §7 (probe de `/Log`).

> Lo único que cambia entre preprod y prod es el bloque `DB_*` del `.env` (host RDS + puerto 5306 + credenciales). El código, las migraciones y el catálogo son idénticos.

---

## 5. Operación día a día

Todos los comandos se ejecutan como el usuario dueño del proyecto (`<usuario>`); solo `systemctl` requiere `sudo`.

| Acción | Comando |
|---|---|
| Estado del servicio | `systemctl status mdh` |
| Logs en vivo | `journalctl -u mdh -f` |
| Reiniciar | `sudo systemctl restart mdh` |
| Parar | `sudo systemctl stop mdh` |
| Health JSON | `cat ~/MdH/state/health.json` |
| Aplicar migración manualmente | `cd ~/MdH && npm run migrate` |
| Backfill / utilidad puntual | `cd ~/MdH && node scripts/<nombre>.js` |

Habilitar solo un subconjunto de servicios (en `.env`):

```
SERVICES_ENABLED=arandaTicketPull,glpiTicketSync,arandaSolutionPull
```

---

## 6. Agregar un nuevo servicio de sync

1. Crear `src/services/miNuevoServicio.js` exportando una clase con `start()` / `stop()` (o extendiendo `BaseService` con `tick()`).
2. Registrarlo en `src/index.js`:
   ```js
   manager.register(new MiNuevoServicio({ POLL_INTERVAL: config.POLL_INTERVAL }));
   ```
3. Si necesita tablas nuevas, añadir `migrations/0XX_mi_servicio.sql`.
4. Probar local → commit → push → `git pull && systemctl restart mdh` en producción.

---

## 7. Compatibilidad con GLPI 11 (importante antes del switch a prod)

El daemon se desarrolló y validó contra una instancia GLPI 10 (`glpi.iammtechs.com`). El destino de producción declara `GLPI 11.0.7 Copyright (C) 2015-2026 Teclib' and contributors`. La API legacy `/apirest.php` **sigue soportada** en GLPI 11 (no hay deprecación inmediata), pero hay **un cambio confirmado por la doc oficial** que afecta al daemon:

### 7.1 Riesgo principal — endpoint `/Log` top-level

| Endpoint | GLPI 10 | GLPI 11 (doc actual) |
|---|---|---|
| `GET /Log?order=DESC&range=…` (log global) | Documentado y usado | **No aparece como top-level** en la doc oficial actual |
| `GET /{itemtype}/{id}/Log` (sub-resource) | Existe | Existe |
| `GET /search/Log/…` (búsqueda) | Existe | Existe — la alternativa documentada para descubrimiento global |

Servicios del daemon que dependen de `/Log` top-level:

| Servicio | Uso de `/Log` | Severidad si rompe |
|---|---|---|
| `glpiTicketSync` | Cursor principal `glpi_log_max_id` para descubrir tickets nuevos | 🔴 Alta — sin él no entran tickets nuevos al sistema |
| `glpiFollowupSync` | Cursor + polling directo de followups por ticket | 🟡 Media — el polling directo cubre el caso |
| `glpiSolutionSync` | Cursor + polling directo de soluciones | 🟡 Media — el polling directo cubre el caso |

**Plan de mitigación si `/Log` top-level no responde en GLPI 11.0.7**:
- `glpiTicketSync` pasa a usar `GET /search/Ticket?sort=19&order=DESC` (sort por `date_mod`) o `GET /search/Log` con criterios — ajuste acotado a ese servicio.
- Los demás servicios siguen funcionando porque ya hacen polling directo por ticket.

### 7.2 Endpoints sin cambios documentados (verdes)

Confirmados en la doc oficial del branch `main` de GLPI:

- `GET /initSession` (con `app_token` + `user_token` como query o headers) ✓
- CRUD de cualquier itemtype con `{ input: {...} }` ✓
- `GET /{itemtype}/{id}/{sub_itemtype}` (Document_Item, ITILFollowup, ITILSolution, TicketTask) ✓
- `GET /Document/{id}` (metadata) ✓
- `GET /Document/{id}?alt=media` (binario) ✓
- `POST /Document/` multipart con `uploadManifest` + `filename[0]` ✓

### 7.3 Aranda — no se ve afectado

GLPI 11 no impacta absolutamente nada del lado Aranda. Sigue siendo ASDKAPI v8.6 (misma instancia, mismas convenciones array Field/Value, mismo `/item/addfile`).

### 7.4 Protocolo de validación previa al switch

Antes de cambiar `GLPI_BASE_URL` en `.env` a la instancia 11.0.7:

1. **Apuntar la colección Postman** ([`postman/mdh-endpoints.postman_collection.json`](postman/mdh-endpoints.postman_collection.json)) a la nueva URL editando la variable `GLPI_BASE_URL`. Ejecutar la carpeta entera `GLPI / …`. Todos los requests deben devolver 200 (o 201 en POST).

2. **Correr el probe de compatibilidad** desde el servidor del daemon contra la instancia destino:
   ```bash
   GLPI_BASE_URL=https://<glpi11-host>/apirest.php \
   APP_TOKEN=<token> USER_TOKEN=<token> \
   TICKET_ID=<un-ticket-existente> \
   GLPI_DOCUMENT_ID=<un-doc-existente> \
   node scripts/probe-glpi11-compat.js
   ```
   El script imprime una tabla `endpoint / status / OK|FAIL` con foco especial en `/Log` top-level vs `/search/Log` vs `/search/Ticket`. Si todo da OK, el daemon puede apuntarse sin tocar código.

3. **Si `/Log` top-level da 404** (lo más probable en GLPI 11):
   - El probe ya validó si `/search/Log` y `/search/Ticket?sort=date_mod` funcionan.
   - Adaptar `glpiTicketSync` para usar el endpoint disponible (cambio acotado, ~30 líneas).

4. **Switch en producción**: editar `.env` con el nuevo `GLPI_BASE_URL` + tokens, `sudo systemctl restart mdh`, monitorear `journalctl -u mdh -f` por unos minutos. Si `/Log` global no funciona y no se hizo el fix previo, verás errores `glpiTicketSync getLog status=404` repetidos cada `POLL_INTERVAL`.

> Recomendación: hacer el switch con `SERVICES_ENABLED=glpiTicketSync,glpiFollowupSync,glpiSolutionSync,glpiTaskSync` primero (solo lectura GLPI → DB), validar que los datos siguen entrando, y después habilitar el resto.

---

## 8. Troubleshooting

- **Faltan variables requeridas: …** → completar `.env` y reiniciar.
- **`POLL_INTERVAL muy bajo`** → mínimo 5 segundos.
- **El daemon arranca pero NO entra ningún ticket nuevo de GLPI** → casi siempre es `GLPI_FILTER_USER` mal puesto. `glpiTicketSync` filtra `/Log` por `user_name` y GLPI lo entrega como `"nombre (id)"` (p.ej. `glpi (2)`). Si pusiste solo `glpi`, descarta todo. Revisa una entrada de `/Log` y copia el valor exacto.
- **Un ticket GLPI llega a Aranda con la categoría por defecto (722)** → el catálogo no está sembrado o esa categoría quedó `unmatched`. Correr `node scripts/seed-catalog-local.js` (debe dar 77/77) y `analyze-catalog-alignment.js`.
- **El estado de Aranda no avanza (queda "Registrado") aunque GLPI esté "Asignado"** → `statusSync` ya verifica-después-de-escribir y reintenta; si persiste, revisar `aranda_status_sync.last_error` para ese ticket.
- **Un caso creado en Aranda no aparece en GLPI** → es el **comportamiento esperado** (política GLPI-master). Solo los casos creados en GLPI se sincronizan. Para reactivar la creación inversa (no recomendado): `ARANDA_TICKET_PULL_ENABLED=true`.
- **El daemon arranca pero ningún servicio sincroniza** → revisar `SERVICES_ENABLED` y el flag por servicio.
- **GLPI 400 `ERROR_GLPI_ADD`** al postear solución → el ticket ya está resuelto/cerrado; `arandaSolutionPull` cae a Followup automáticamente.
- **Aranda devuelve 401** → el token de sesión rotó; el `arandaClient` re-loguea solo, basta esperar el siguiente tick.
- **GLPI `/Log` devuelve 404 en producción** → estás contra GLPI 11; ver §7 para la adaptación.
