import { createHash } from 'node:crypto';

export function sha256(s) {
  return createHash('sha256').update(String(s ?? '')).digest('hex');
}
