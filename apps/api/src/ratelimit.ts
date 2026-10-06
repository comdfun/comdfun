/** Fixed one-minute windows per key (IP + bearer token), as IMD: 300 requests and 30 quotes a minute. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  constructor(limit: number, windowMs = 60_000, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Returns 0 when allowed, else seconds until the window resets. */
  hit(key: string): number {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      w = { start: t, count: 0 };
      this.windows.set(key, w);
    }
    w.count++;
    if (w.count > this.limit) return Math.max(1, Math.ceil((w.start + this.windowMs - t) / 1000));
    if (this.windows.size > 50_000) this.gc(t);
    return 0;
  }

  private gc(t: number) {
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
  }
}
