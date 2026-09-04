/**
 * Amplification control for the snapshot endpoint.
 *
 * `/api/city/snapshot` is public and unauthenticated, and one call to it fans
 * out into up to twenty-seven upstream reads. Without anything in front of that,
 * a visitor holding refresh — or a crawler, or a single popular page — turns
 * into sustained load on Whop's API with the deployment's own credential
 * attached. So two things happen here, and only these two:
 *
 *  - **Single flight.** Concurrent requests that resolve to the same deployment
 *    wait on one capture instead of starting their own. An entry that is still
 *    running is shared no matter how long it has been running: the window is
 *    measured from when a capture *finishes*, never from when it started, or a
 *    capture slower than the window would be joined by a second fan-out at
 *    exactly the moment the upstream is least able to take one.
 *  - **A short TTL after success.** A settled result is reused for a few
 *    seconds. Nothing else is retained: a rejection is dropped the instant it
 *    settles, and so is a result the caller declines to retain — which is how a
 *    capture that failed its mandatory reads avoids being served as a stable
 *    answer for the rest of the window.
 *
 * Deliberately not a shared or CDN cache. The value is one business's city, and
 * the entry is keyed by deployment context and held in this isolate's memory
 * only; the response itself stays `private, no-store`. A shared cache in front
 * of this endpoint would be a way to serve one business's city to another,
 * which is the one failure this whole boundary exists to prevent.
 *
 * The clock is injectable so expiry is testable without waiting for it.
 */

/** Short enough that a state change shows up promptly; long enough to matter. */
export const SNAPSHOT_TTL_MS = 10_000;

type Entry<T> = {
  promise: Promise<T>;
  /** Null while the producer is still running. Set once it settles happily. */
  expiresAt: number | null;
};

const entries = new Map<string, Entry<unknown>>();

/** Test seam. Never called by the route. */
export function resetSnapshotCache(): void {
  entries.clear();
}

/** Visible for tests: how many deployments currently hold an entry. */
export function snapshotCacheSize(): number {
  return entries.size;
}

export type SingleFlightOptions<T> = {
  /** Defaults to the wall clock. Tests supply their own. */
  clock?: () => number;
  ttlMs?: number;
  /**
   * Whether a settled value is worth keeping.
   *
   * Defaults to keeping everything. The route declines to keep an unavailable
   * projection, so a failed capture is retried on the next request rather than
   * pinned for the window — while callers already waiting on it still share
   * that one attempt.
   */
  retain?: (value: T) => boolean;
};

export async function withSingleFlight<T>(
  key: string,
  produce: () => Promise<T>,
  options: SingleFlightOptions<T> = {},
): Promise<T> {
  const clock = options.clock ?? Date.now;
  const ttlMs = options.ttlMs ?? SNAPSHOT_TTL_MS;
  const retain = options.retain ?? (() => true);

  const existing = entries.get(key);
  if (existing) {
    // In flight: join it, however long it has been going.
    if (existing.expiresAt === null) return existing.promise as Promise<T>;
    // Settled and still fresh.
    if (existing.expiresAt > clock()) return existing.promise as Promise<T>;
  }

  const entry: Entry<T> = { promise: produce(), expiresAt: null };
  entries.set(key, entry as Entry<unknown>);

  /** Only evict if this entry is still the one in the map. */
  const evict = () => {
    if (entries.get(key) === (entry as Entry<unknown>)) entries.delete(key);
  };

  try {
    const value = await entry.promise;
    if (retain(value)) {
      entry.expiresAt = clock() + ttlMs;
    } else {
      evict();
    }
    return value;
  } catch (error) {
    evict();
    throw error;
  }
}
