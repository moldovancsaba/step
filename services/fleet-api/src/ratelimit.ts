/**
 * Token-bucket rate limiter (#66) — pure + deterministic (time injected).
 *
 * Per-key buckets refill continuously; `take` succeeds while tokens remain. Used
 * to gate the public signed-heartbeat intake so a flood of garbage signatures
 * cannot exhaust CPU (ECDSA recovery runs only after the cheap bucket passes).
 * Bounded key set (LRU-ish by last-touch) so the limiter itself can't be a memory
 * DoS.
 */
export interface BucketResult {
  allowed: boolean;
  /** seconds until at least one token is available (0 when allowed) */
  retryAfterS: number;
}

export class RateLimiter {
  private readonly state = new Map<string, { tokens: number; updatedAtMs: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly maxKeys = 100_000,
  ) {}

  take(key: string, nowMs: number, cost = 1): BucketResult {
    let b = this.state.get(key);
    if (!b) {
      if (this.state.size >= this.maxKeys) this.evictOldest();
      b = { tokens: this.capacity, updatedAtMs: nowMs };
      this.state.set(key, b);
    } else {
      const elapsed = Math.max(0, (nowMs - b.updatedAtMs) / 1000);
      b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
      b.updatedAtMs = nowMs;
      // keep recency for eviction: re-insert
      this.state.delete(key);
      this.state.set(key, b);
    }
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { allowed: true, retryAfterS: 0 };
    }
    const deficit = cost - b.tokens;
    return { allowed: false, retryAfterS: this.refillPerSec > 0 ? Math.ceil(deficit / this.refillPerSec) : 1 };
  }

  private evictOldest() {
    const oldest = this.state.keys().next().value; // Map preserves insertion/recency order
    if (oldest !== undefined) this.state.delete(oldest);
  }
}
