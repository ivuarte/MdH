import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from './logger.js';

const state = {
  started_at: new Date().toISOString(),
  services: {},
  breakers: {}
};

let flushPending = false;

function scheduleFlush() {
  if (flushPending) return;
  flushPending = true;
  setImmediate(async () => {
    flushPending = false;
    try {
      const file = path.resolve(config.HEALTH_FILE);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      logger.warn('No se pudo escribir health file', { service: 'health', err });
    }
  });
}

export const health = {
  registerService(name) {
    if (!state.services[name]) {
      state.services[name] = {
        started_at: null,
        last_tick_at: null,
        last_ok_at: null,
        last_error_at: null,
        last_error: null,
        ticks: 0,
        errors: 0,
        ok: false
      };
    }
    scheduleFlush();
  },
  serviceStarted(name) {
    this.registerService(name);
    state.services[name].started_at = new Date().toISOString();
    state.services[name].ok = true;
    scheduleFlush();
  },
  tickOk(name) {
    this.registerService(name);
    const s = state.services[name];
    s.last_tick_at = new Date().toISOString();
    s.last_ok_at = s.last_tick_at;
    s.last_error = null;
    s.ticks += 1;
    s.ok = true;
    scheduleFlush();
  },
  tickErr(name, err) {
    this.registerService(name);
    const s = state.services[name];
    s.last_tick_at = new Date().toISOString();
    s.last_error_at = s.last_tick_at;
    s.last_error = err?.message || String(err);
    s.errors += 1;
    s.ok = false;
    scheduleFlush();
  },
  setBreaker(snapshot) {
    state.breakers[snapshot.name] = snapshot;
    scheduleFlush();
  },
  snapshot() {
    return JSON.parse(JSON.stringify(state));
  }
};
