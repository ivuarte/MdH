import { config, validateConfig, isServiceEnabled } from './config.js';
import { initDB, closeDB } from './lib/db.js';
import { runMigrations } from './lib/migrator.js';
import { logger } from './lib/logger.js';
import { glpiClient } from './lib/glpiClient.js';
import { arandaClient } from './lib/arandaClient.js';
import { health } from './lib/health.js';

import { GlpiTicketSyncService }     from './services/glpiTicketSync.js';
import { GlpiFollowupSyncService }   from './services/glpiFollowupSync.js';
import { GlpiSolutionSyncService }   from './services/glpiSolutionSync.js';
import { GlpiTaskSyncService }       from './services/glpiTaskSync.js';
import { ArandaTicketPushService }   from './services/arandaTicketPush.js';
import { ArandaBacklinkToGlpiService } from './services/arandaBacklinkToGlpi.js';
import { ArandaNotesPushService }    from './services/arandaNotesPush.js';
import { ArandaTasksPushService }    from './services/arandaTasksPush.js';
import { ArandaSolutionPushService } from './services/arandaSolutionPush.js';
import { ArandaTicketPullService }   from './services/arandaTicketPull.js';
import { ArandaNotesPullService }    from './services/arandaNotesPull.js';
import { ArandaSolutionPullService } from './services/arandaSolutionPull.js';
import { StatusSyncService }         from './services/statusSync.js';
import { PrioritySyncService }       from './services/prioritySync.js';
import { CatalogSyncService }        from './services/catalogSync.js';
import { GlpiAttachmentsSyncService }    from './services/glpiAttachmentsSync.js';
import { ArandaAttachmentsPushService }  from './services/arandaAttachmentsPush.js';
import { ArandaAttachmentsPullService }  from './services/arandaAttachmentsPull.js';

class ServiceManager {
  constructor() {
    this.services = [];
  }
  register(svc) {
    if (!isServiceEnabled(svc.name)) {
      logger.info(`Servicio deshabilitado por SERVICES_ENABLED: ${svc.name}`, { service: 'manager' });
      return this;
    }
    this.services.push(svc);
    return this;
  }
  async startAll() {
    for (const s of this.services) {
      await s.start();
    }
  }
  async stopAll() {
    // Stop en paralelo — cada servicio tiene su propio timeout interno.
    await Promise.all(this.services.map(s => s.stop().catch(err => logger.error(`stop ${s.name} fallo`, { err }))));
  }
}

// Preflight: probar conectividad real con cada dependencia antes de arrancar los polleres.
async function preflightChecks() {
  logger.info('Preflight: probando GLPI', { service: 'preflight' });
  await glpiClient.ensureSession();

  logger.info('Preflight: probando Aranda', { service: 'preflight' });
  await arandaClient.ensureLogin();
}

async function main() {
  try {
    validateConfig();
    logger.info(`Iniciando MdH v2 env=${config.env} poll=${config.POLL_INTERVAL}s`, { service: 'main' });

    await initDB(config);

    if (config.RUN_MIGRATIONS_ON_START) {
      await runMigrations();
    }

    await preflightChecks();

    const manager = new ServiceManager();

    // Ingesta GLPI → MySQL
    manager.register(new GlpiTicketSyncService({
      POLL_INTERVAL: config.POLL_INTERVAL,
      GLPI_FILTER_USER: config.GLPI_FILTER_USER
    }));
    manager.register(new GlpiFollowupSyncService({
      POLL_INTERVAL: config.POLL_INTERVAL,
      GLPI_FILTER_USER: config.GLPI_FILTER_USER
    }));
    manager.register(new GlpiSolutionSyncService({
      POLL_INTERVAL: config.POLL_INTERVAL,
      GLPI_FILTER_USER: config.GLPI_FILTER_USER
    }));
    // glpiTaskSync hace polling directo por ticket — no depende de /Log (que rota muy rápido en esta instancia).
    manager.register(new GlpiTaskSyncService({ POLL_INTERVAL: config.POLL_INTERVAL }));

    // Propagación MySQL → Aranda (origin=GLPI)
    manager.register(new ArandaTicketPushService({ POLL_INTERVAL: config.POLL_INTERVAL }));
    manager.register(new ArandaBacklinkToGlpiService({ POLL_INTERVAL: config.POLL_INTERVAL }));
    manager.register(new ArandaNotesPushService({ POLL_INTERVAL: config.POLL_INTERVAL }));
    manager.register(new ArandaTasksPushService({ POLL_INTERVAL: config.POLL_INTERVAL }));
    manager.register(new ArandaSolutionPushService({ POLL_INTERVAL: config.POLL_INTERVAL }));

    // Aranda → GLPI
    // Política GLPI-master: los casos creados en Aranda NO se crean en GLPI.
    // arandaTicketPull (creación inversa de tickets) está deshabilitado por defecto.
    if (config.ARANDA_TICKET_PULL_ENABLED) {
      manager.register(new ArandaTicketPullService({ POLL_INTERVAL: config.POLL_INTERVAL }));
    } else {
      logger.info('arandaTicketPull DESHABILITADO — política GLPI-master: los casos creados en Aranda no se crean en GLPI (solo se sincronizan los originados en GLPI)', { service: 'manager' });
    }
    // Estos pull SÍ siguen activos: actualizan en GLPI los casos ORIGINADOS EN GLPI
    // (operan sobre aranda_items; un caso Aranda nunca llega aquí porque no se crea su mapping).
    manager.register(new ArandaNotesPullService({ POLL_INTERVAL: config.POLL_INTERVAL }));
    manager.register(new ArandaSolutionPullService({ POLL_INTERVAL: config.POLL_INTERVAL }));

    // Estados bidireccionales
    manager.register(new StatusSyncService({ POLL_INTERVAL: config.POLL_INTERVAL }));

    // Urgencia / prioridad bidireccional
    manager.register(new PrioritySyncService({ POLL_INTERVAL: config.POLL_INTERVAL }));

    // Adjuntos (asimétrico — ver limitación 15)
    manager.register(new GlpiAttachmentsSyncService({ POLL_INTERVAL: config.POLL_INTERVAL }));
    manager.register(new ArandaAttachmentsPushService({ POLL_INTERVAL: config.POLL_INTERVAL }));
    manager.register(new ArandaAttachmentsPullService({ POLL_INTERVAL: config.POLL_INTERVAL }));

    // Catálogo (mapeo de categorías GLPI ↔ Aranda)
    manager.register(new CatalogSyncService({ POLL_INTERVAL: config.POLL_INTERVAL }));

    await manager.startAll();

    // Marca de salud global cada minuto (registra estado de los breakers también).
    setInterval(() => {
      health.setBreaker(glpiClient.breaker.snapshot());
      health.setBreaker(arandaClient.breaker.snapshot());
    }, 60000).unref();

    const shutdown = async (signal) => {
      logger.info(`Señal ${signal} recibida — cerrando`, { service: 'main' });
      try {
        await manager.stopAll();
        await closeDB();
        logger.info('Apagado limpio', { service: 'main' });
        process.exit(0);
      } catch (err) {
        logger.error('Apagado con error', { err, service: 'main' });
        process.exit(1);
      }
    };
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // No nos queremos morir por un unhandledRejection en un poller suelto.
    process.on('unhandledRejection', (reason) => {
      logger.error('unhandledRejection', { err: reason, service: 'main' });
    });
    process.on('uncaughtException', (err) => {
      logger.error('uncaughtException', { err, service: 'main' });
    });

  } catch (err) {
    logger.error('Fallo fatal en arranque', { err, service: 'main' });
    process.exit(1);
  }
}

main();
