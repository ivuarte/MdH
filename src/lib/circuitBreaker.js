import { config } from '../config.js';
import { logger } from './logger.js';

const STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

export class CircuitBreaker {
  constructor(name, opts = {}) {
    this.name = name;
    this.threshold = opts.threshold ?? config.CIRCUIT_THRESHOLD;
    this.resetMs = opts.resetMs ?? config.CIRCUIT_RESET_MS;
    this.state = STATES.CLOSED;
    this.failures = 0;
    this.openedAt = 0;
  }

  async exec(fn) {
    if (this.state === STATES.OPEN) {
      if (Date.now() - this.openedAt >= this.resetMs) {
        this.state = STATES.HALF_OPEN;
        logger.warn(`circuit ${this.name} HALF_OPEN — probing`, { service: 'circuit' });
      } else {
        const err = new Error(`Circuit ${this.name} OPEN`);
        err.code = 'CIRCUIT_OPEN';
        throw err;
      }
    }
    try {
      const out = await fn();
      this.onSuccess();
      return out;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  onSuccess() {
    if (this.state === STATES.HALF_OPEN) {
      logger.info(`circuit ${this.name} CLOSED`, { service: 'circuit' });
    }
    this.failures = 0;
    this.state = STATES.CLOSED;
  }

  onFailure(err) {
    // No contar 4xx no-retriables como falla de circuit (son errores de input, no de salud del servicio).
    const status = err?.response?.status;
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) return;

    this.failures++;
    if (this.failures >= this.threshold && this.state !== STATES.OPEN) {
      this.state = STATES.OPEN;
      this.openedAt = Date.now();
      logger.error(`circuit ${this.name} OPEN — ${this.failures} fallos consecutivos`, { service: 'circuit', err });
    }
  }

  snapshot() {
    return { name: this.name, state: this.state, failures: this.failures, openedAt: this.openedAt };
  }
}
