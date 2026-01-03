export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
};

export class InMemoryRateLimiter {
  private buckets = new Map<string, number[]>();

  constructor(private limit: number, private windowMs: number) {}

  consume(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const entries = (this.buckets.get(key) || []).filter(
      (ts) => ts > windowStart
    );
    if (entries.length >= this.limit) {
      const resetAt = entries[0] + this.windowMs;
      return {
        ok: false,
        remaining: 0,
        resetAt
      };
    }
    entries.push(now);
    this.buckets.set(key, entries);
    return {
      ok: true,
      remaining: this.limit - entries.length,
      resetAt: entries[0] + this.windowMs
    };
  }
}
