import { config } from '../config.js';
import { logger } from './logger.js';

const DEFAULT_NON_RETRY_STATUSES = new Set([400, 404, 422]);

function isRetryable(err, nonRetryStatuses) {
  if (!err) return false;
  if (err.code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND'].includes(err.code)) return true;
  const status = err?.response?.status;
  if (status == null) return true;
  if (nonRetryStatuses.has(status)) return false;
  if (status >= 500) return true;
  if (status === 408 || status === 429) return true;
  return false;
}

function backoffMs(attempt, baseMs, maxMs) {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt - 1));
  const jitter = Math.random() * exp * 0.3;
  return Math.floor(exp + jitter);
}

export async function withRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? config.RETRY_MAX_ATTEMPTS;
  const baseMs = opts.baseMs ?? config.RETRY_BASE_MS;
  const maxMs = opts.maxMs ?? config.RETRY_MAX_MS;
  const nonRetry = new Set([...(opts.nonRetryStatuses || []), ...DEFAULT_NON_RETRY_STATUSES]);
  const onRetry = opts.onRetry;
  const label = opts.label || 'op';

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isRetryable(err, nonRetry)) {
        throw err;
      }
      const wait = backoffMs(attempt, baseMs, maxMs);
      logger.warn(`retry ${label} attempt=${attempt} wait=${wait}ms`, { err });
      if (typeof onRetry === 'function') {
        try { await onRetry(attempt, err); } catch { /* ignore */ }
      }
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
