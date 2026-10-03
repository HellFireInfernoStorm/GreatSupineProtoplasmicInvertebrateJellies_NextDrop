import type { LockoutConfig } from "./config";

interface Entry {
  failures: number;
  lockedUntil: number;
}

export interface Lockout {
  /** Milliseconds until `key` may try again; 0 when it is not locked. */
  retryAfterMs(key: string): number;
  /** Record a failure. Returns the new lock duration, 0 while still under the threshold. */
  fail(key: string): number;
  succeed(key: string): void;
}

/**
 * Exponential lockout backoff. After `threshold` failures each further failure locks the key for
 * `baseMs * 2^n`, capped at `maxMs`. Kept in process memory: the API runs as one container (ADR 0028).
 */
export function createLockout(config: LockoutConfig, now: () => number): Lockout {
  const entries = new Map<string, Entry>();
  const forget = () => {
    // Bound memory: drop unlocked entries once the map grows.
    if (entries.size < 10_000) return;
    const t = now();
    for (const [key, entry] of entries) if (entry.lockedUntil <= t) entries.delete(key);
  };
  return {
    retryAfterMs(key) {
      const entry = entries.get(key);
      return entry ? Math.max(0, entry.lockedUntil - now()) : 0;
    },
    fail(key) {
      forget();
      const entry = entries.get(key) ?? { failures: 0, lockedUntil: 0 };
      entry.failures += 1;
      const over = entry.failures - config.threshold;
      const duration = over > 0 ? Math.min(config.maxMs, config.baseMs * 2 ** (over - 1)) : 0;
      entry.lockedUntil = duration > 0 ? now() + duration : 0;
      entries.set(key, entry);
      return duration;
    },
    succeed(key) {
      entries.delete(key);
    },
  };
}
