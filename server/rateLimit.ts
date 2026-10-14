/**
 * Sliding-window limiter, in memory.
 * ponytail: per-process state, so the limit is per instance. Move to Redis or the DB if the app runs more than one replica.
 */
const PRUNE_ABOVE = 10_000;

export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();

  function prune(now: number) {
    for (const [key, times] of Array.from(hits)) {
      if (times.every((t) => now - t >= windowMs)) hits.delete(key);
    }
  }

  return {
    /** True if the call is allowed (and counted), false if the key is over the limit. */
    allow(key: string, now = Date.now()): boolean {
      if (limit === 0) return true;
      if (hits.size > PRUNE_ABOVE) prune(now);
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      hits.set(key, [...recent, now]);
      return true;
    },
    /** Number of tracked keys, for tests. */
    size: () => hits.size,
  };
}
