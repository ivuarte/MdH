// Token bucket simple — N tokens por segundo, capacidad = N.
export class RateLimiter {
  constructor(tokensPerSecond) {
    this.rate = Math.max(1, tokensPerSecond);
    this.capacity = this.rate;
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
    this.lastRefill = now;
  }

  async acquire() {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const need = 1 - this.tokens;
      const waitMs = Math.ceil((need / this.rate) * 1000);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}
