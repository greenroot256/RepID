/**
 * A fixed-window rate limiter for the endpoints where guessing costs something:
 * password sign-in and the challenge/verify round trip.
 *
 * In-memory and therefore per-process. That is the right trade for this
 * deployment — one API instance, sessions already live in the database — but
 * it is not a distributed limit: a second instance would give an attacker twice
 * the budget, and a restart resets every counter. The call sites document this
 * so it is not mistaken for a stronger guarantee than it is. Moving it behind
 * a shared store is a drop-in replacement: only `consume` and `reset` are used.
 */

interface Window {
  count: number;
  /** When this window stops counting, as an epoch ms. */
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Bounds the map itself. Without this, every distinct email or IP that is
 *  ever tried leaves an entry behind for the lifetime of the process. */
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number): void {
  if (windows.size < MAX_TRACKED_KEYS) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  // Still oversized: everything is live and single-window. Dropping the
  // oldest half is a rough cap, and the worst it costs is that some counters
  // start over — which an attacker can already achieve for free by waiting.
  if (windows.size >= MAX_TRACKED_KEYS) {
    const half = Math.floor(windows.size / 2);
    let dropped = 0;
    for (const key of windows.keys()) {
      windows.delete(key);
      if (++dropped >= half) break;
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds to wait before retrying. Only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

/**
 * Counts one attempt against `bucket:key` and reports whether it may proceed.
 *
 * The key should identify the *thing being guessed* (an email, a wallet) rather
 * than only the caller, so that hammering one account from many addresses is
 * still throttled. Callers that want to also limit per-IP pass a composite key.
 */
export function consume(bucket: string, key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const id = `${bucket}:${key}`;
  sweep(now);

  const existing = windows.get(id);
  if (!existing || existing.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Clears the counter after a *successful* sign-in, so a user who fat-fingers
 * their password a few times is not left throttled once they finally get it
 * right. Only ever called on the success path.
 */
export function reset(bucket: string, key: string): void {
  windows.delete(`${bucket}:${key}`);
}

/** Test seam: drops all counters. */
export function resetAll(): void {
  windows.clear();
}
