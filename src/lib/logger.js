import { config } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[(config.logLevel || 'info').toLowerCase()] ?? LEVELS.info;
const useJson = (config.logFormat || 'json').toLowerCase() === 'json';

function serializeErr(err) {
  if (!err) return null;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      code: err.code,
      status: err?.response?.status,
      stack: config.env === 'development' ? err.stack : undefined
    };
  }
  return String(err);
}

function emit(level, msg, ctx = {}) {
  if (LEVELS[level] < minLevel) return;
  const base = {
    ts: new Date().toISOString(),
    level,
    msg: typeof msg === 'string' ? msg : JSON.stringify(msg),
    ...ctx
  };
  if (ctx.err) base.err = serializeErr(ctx.err);

  if (useJson) {
    const line = JSON.stringify(base);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  } else {
    const tag = `[${level.toUpperCase()}]`;
    const svc = ctx.service ? `[${ctx.service}]` : '';
    const dir = ctx.direction ? `[${ctx.direction}]` : '';
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(tag, svc, dir, base.msg, ctx.err ? serializeErr(ctx.err) : '');
  }
}

export const logger = {
  debug: (msg, ctx) => emit('debug', msg, ctx),
  info:  (msg, ctx) => emit('info', msg, ctx),
  warn:  (msg, ctx) => emit('warn', msg, ctx),
  error: (msg, ctx) => emit('error', msg, ctx),
  child(defaults) {
    return {
      debug: (msg, ctx) => emit('debug', msg, { ...defaults, ...ctx }),
      info:  (msg, ctx) => emit('info', msg, { ...defaults, ...ctx }),
      warn:  (msg, ctx) => emit('warn', msg, { ...defaults, ...ctx }),
      error: (msg, ctx) => emit('error', msg, { ...defaults, ...ctx })
    };
  }
};
