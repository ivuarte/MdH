import { config, validateConfig } from './config.js';
import { initDB, closeDB } from './lib/db.js';
import { logger } from './lib/logger.js';
import { TicketSyncService } from './services/ticketSyncService.js';
import { ITILFollowupSyncService } from './services/followupSyncService.js';
import { ITILSolutionSyncService } from './services/solutionSyncService.js';
import { ArandaSyncService } from './services/arandaSyncService.js';
import { ArandaBacklinkService } from './services/arandaBacklinkService.js';
import { ArandaNotesSyncService } from './services/arandaNotesSyncService.js';
import { ArandaSolutionsSyncService } from './services/arandaSolutionsSyncService.js';
import { StatusSyncService } from './services/statusSyncService.js';


class ServiceManager {
  constructor() {
    this.services = [];
  }
  register(svc) {
    this.services.push(svc);
    return this;
  }
  async startAll() {
    for (const s of this.services) {
      await s.start();
    }
  }
  async stopAll() {
    for (const s of this.services) {
      await s.stop();
    }
  }
}

async function main() {
  try {
    validateConfig();
    await initDB(config);

    const manager = new ServiceManager();

    // SERVICIO TICKETS CREATED
    const ticketService = new TicketSyncService({
      POLL_INTERVAL: config.POLL_INTERVAL,
      GLPI_FILTER_USER: config.GLPI_FILTER_USER
    });
    manager.register(ticketService);

    // SERVICIO FOLLOWUPS
    const followupService = new ITILFollowupSyncService({
      POLL_INTERVAL: config.POLL_INTERVAL,
      GLPI_FILTER_USER: config.GLPI_FILTER_USER   // o pon null si quieres TODOS los usuarios
    });
    manager.register(followupService);

    // SERVICIO solution
    const solutionService = new ITILSolutionSyncService({
      POLL_INTERVAL: config.POLL_INTERVAL,
      GLPI_FILTER_USER: config.GLPI_FILTER_USER   // o null si no quieres filtrar por usuario
    });
    manager.register(solutionService);

    // SERVICIO CREAR EN ARANDA
    manager.register(new ArandaSyncService({
      POLL_INTERVAL: config.POLL_INTERVAL
    }));

    //servicio para agg el caso de aranda en glpi como comment
    manager.register(new ArandaBacklinkService({
      POLL_INTERVAL: config.POLL_INTERVAL
    }));

    //servicio para agregar follows de glpi a aranda
    manager.register(new ArandaNotesSyncService({
      POLL_INTERVAL: config.POLL_INTERVAL
    }));

    //servicio para agregar solucion de glpi a aranda
    manager.register(new ArandaSolutionsSyncService({
      POLL_INTERVAL: config.POLL_INTERVAL
    }));

    //SERVICIO PARA SINCRONIZAR LOS ESTADOS DE CASOS
    manager.register(new StatusSyncService({
      POLL_INTERVAL: config.POLL_INTERVAL
    }));






    await manager.startAll();

    // Señales para apagado limpio
    const shutdown = async (signal) => {
      logger.info(`\nRecibida señal ${signal}. Cerrando...`);
      await manager.stopAll();
      await closeDB();
      process.exit(0);
    };
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Fallo fatal:', err.message);
    process.exit(1);
  }
}

main();
