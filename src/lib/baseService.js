import { logger } from './logger.js';
import { health } from './health.js';
import { config } from '../config.js';

// Servicio polling base. Subclases implementan tick() y opcionalmente onStart().
export class BaseService {
  constructor(name, opts = {}) {
    this.name = name;
    this.pollSeconds = Math.max(5, Number(opts.POLL_INTERVAL || config.POLL_INTERVAL || 20));
    this.timer = null;
    this.stopping = false;
    this.tickInFlight = false;
    this.log = logger.child({ service: this.name });
  }

  async start() {
    this.log.info(`Iniciando (poll=${this.pollSeconds}s)`);
    health.serviceStarted(this.name);
    if (typeof this.onStart === 'function') {
      await this.onStart();
    }
    await this.runTick();
    this.timer = setInterval(() => this.runTick(), this.pollSeconds * 1000);
  }

  async runTick() {
    // Evita ticks superpuestos si el anterior tarda más que el intervalo.
    if (this.tickInFlight || this.stopping) return;
    this.tickInFlight = true;
    try {
      await this.tick();
      health.tickOk(this.name);
    } catch (err) {
      this.log.error('tick error', { err });
      health.tickErr(this.name, err);
    } finally {
      this.tickInFlight = false;
    }
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Espera a que termine el tick en curso, máx 5s.
    const deadline = Date.now() + 5000;
    while (this.tickInFlight && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
    this.log.info('Detenido');
  }
}
