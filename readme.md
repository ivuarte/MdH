# MdH v2

Daemon Node.js que sincroniza **bidireccionalmente** GLPI ↔ Aranda ASDK por polling, usando MySQL como capa de persistencia, deduplicación y trazabilidad.

- Arquitectura completa: [`ARQUITECTURA.md`](ARQUITECTURA.md)
- Catálogo de categorías: [`CATALOGO.md`](CATALOGO.md)
- Plan e historial de decisiones: [`PLAN_IMPLEMENTACION.md`](PLAN_IMPLEMENTACION.md)
- Repositorio: <https://github.com/ivuarte/MdH.git>

---

## 1. Requisitos

- Node.js ≥ 20
- MySQL/MariaDB 10.4+ accesible y con base de datos vacía creada
- Acceso de red a la API REST de GLPI (`/apirest.php`) y a Aranda ASDKAPI (`/ASDKAPI/api/v8.6`)
- Credenciales: `APP_TOKEN`, `USER_TOKEN` (GLPI), usuario/clave de Aranda

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
- Si cambias el schema, **agregar un archivo nuevo** en `migrations/` (ej. `012_mi_cambio.sql`). No editar migrations ya aplicadas.
- Si agregas variables de entorno nuevas, **actualiza `.env.example`** en el mismo commit.
- Antes de pushear: `npm start` localmente al menos una vez para confirmar que el daemon arranca y aplica migraciones.

---

## 4. Deploy en otro servidor (controlado desde el repo)

Esta es la receta completa para levantar el daemon en un servidor nuevo y dejarlo **gobernado por el repo de GitHub** (los cambios se aplican con un `git pull` + restart, nunca editando directo en producción).

### 4.1 Preparar el servidor

Como root o con sudo:

```bash
# 1. Node 20 LTS (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# 2. MariaDB/MySQL
apt-get install -y mariadb-server
systemctl enable --now mariadb

# 3. Usuario de servicio (sin shell de login)
useradd -r -m -d /opt/mdh -s /bin/bash mdh
```

Crear la base de datos:

```sql
CREATE DATABASE mdh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mdh'@'localhost' IDENTIFIED BY '<password>';
GRANT ALL PRIVILEGES ON mdh.* TO 'mdh'@'localhost';
FLUSH PRIVILEGES;
```

### 4.2 Clonar el repo

```bash
sudo -u mdh -i
cd /opt/mdh
git clone https://github.com/ivuarte/MdH.git app
cd app
cp .env.example .env
# editar .env con los valores reales del entorno
nano .env
npm ci --omit=dev
npm run migrate
```

Probar manualmente que arranca:

```bash
npm start
# Ctrl+C cuando confirmes que aparecen los logs de los servicios
```

### 4.3 Instalar como servicio systemd

Como root, crear `/etc/systemd/system/mdh.service`:

```ini
[Unit]
Description=MdH v2 — sincronizador GLPI <-> Aranda
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=simple
User=mdh
Group=mdh
WorkingDirectory=/opt/mdh/app
EnvironmentFile=/opt/mdh/app/.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5s
StandardOutput=append:/var/log/mdh/daemon.log
StandardError=append:/var/log/mdh/daemon.err

[Install]
WantedBy=multi-user.target
```

```bash
mkdir -p /var/log/mdh && chown mdh:mdh /var/log/mdh
systemctl daemon-reload
systemctl enable --now mdh
systemctl status mdh
journalctl -u mdh -f       # seguir logs en vivo
```

### 4.4 Actualizar producción desde el repo

El flujo para aplicar un cambio publicado en GitHub:

```bash
sudo -u mdh -i
cd /opt/mdh/app
git pull --ff-only origin main
npm ci --omit=dev                 # solo si cambió package-lock.json
# (las migraciones se aplican solas si RUN_MIGRATIONS_ON_START=true)
# si lo desactivaste: npm run migrate
exit
sudo systemctl restart mdh
sudo journalctl -u mdh -n 100 -f
```

### 4.5 Rollback rápido

```bash
cd /opt/mdh/app
git log --oneline -10              # localizar el commit estable previo
git checkout <sha>                  # detached HEAD a la versión buena
sudo systemctl restart mdh
# cuando se arregle main: git checkout main && git pull && systemctl restart mdh
```

> Migraciones **solo agregan** (nunca editan archivos viejos), así que volver a un commit anterior es seguro siempre que el schema agregado por el commit nuevo sea aditivo.

### 4.6 Auto-deploy opcional (GitHub → servidor)

Si quieres que `push` a `main` despliegue automáticamente, hay dos opciones simples:

**A. Webhook + script tirado por el propio servidor**

1. En el servidor crear `/opt/mdh/deploy.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   cd /opt/mdh/app
   sudo -u mdh git pull --ff-only origin main
   sudo -u mdh npm ci --omit=dev
   systemctl restart mdh
   ```
2. Exponerlo con un webhook secreto (ej. usando [`webhook`](https://github.com/adnanh/webhook) o un mini-Express con verificación de firma `X-Hub-Signature-256`).
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
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd /opt/mdh/app
            git pull --ff-only origin main
            npm ci --omit=dev
            sudo systemctl restart mdh
```

Secrets a configurar en `Settings → Secrets and variables → Actions`:
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (clave privada con acceso al servidor).

---

## 5. Operación día a día

| Acción | Comando |
|---|---|
| Estado del servicio | `systemctl status mdh` |
| Logs en vivo | `journalctl -u mdh -f` |
| Reiniciar | `sudo systemctl restart mdh` |
| Parar | `sudo systemctl stop mdh` |
| Health JSON | `cat /opt/mdh/app/state/health.json` |
| Aplicar migración manualmente | `cd /opt/mdh/app && sudo -u mdh npm run migrate` |
| Backfill / utilidad puntual | `cd /opt/mdh/app && sudo -u mdh node scripts/<nombre>.js` |

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

## 7. Troubleshooting

- **Faltan variables requeridas: …** → completar `.env` y reiniciar.
- **`POLL_INTERVAL muy bajo`** → mínimo 5 segundos.
- **El daemon arranca pero ningún servicio sincroniza** → revisar `SERVICES_ENABLED` y el flag por servicio.
- **GLPI 400 `ERROR_GLPI_ADD`** al postear solución → el ticket ya está resuelto/cerrado; `arandaSolutionPull` cae a Followup automáticamente.
- **Aranda devuelve 401** → el token de sesión rotó; el `arandaClient` re-loguea solo, basta esperar el siguiente tick.
