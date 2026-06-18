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
nano .env                           # completar valores reales (DB_HOST apunta al motor externo)
npm ci --omit=dev
npm run migrate                     # corre migrations/*.sql contra la BD externa
```

Probar manualmente que arranca:

```bash
npm start
# Ctrl+C cuando confirmes los logs de los servicios
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

## 7. Troubleshooting

- **Faltan variables requeridas: …** → completar `.env` y reiniciar.
- **`POLL_INTERVAL muy bajo`** → mínimo 5 segundos.
- **El daemon arranca pero ningún servicio sincroniza** → revisar `SERVICES_ENABLED` y el flag por servicio.
- **GLPI 400 `ERROR_GLPI_ADD`** al postear solución → el ticket ya está resuelto/cerrado; `arandaSolutionPull` cae a Followup automáticamente.
- **Aranda devuelve 401** → el token de sesión rotó; el `arandaClient` re-loguea solo, basta esperar el siguiente tick.
