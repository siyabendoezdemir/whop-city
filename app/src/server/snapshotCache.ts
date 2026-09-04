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
 *    wait on one capture instead of starting their own.
 *  - **A short TTL.** The result is reused for a few seconds afterwards.
 *
 * Deliberately not a shared or CDN cache. The value is one business's city, and
 * the entry is keyed by deployment context and held in this isolate's memory
 * only; the response itself stays `no-store`. A shared cache in front of this
 * endpoint would be a way to serve one business's city to another, which is the
 * one failure this whole boundary exists to prevent.
 *
 * The clock is a parameter rather than `Date.now()` so expiry is testable
 * without waiting for it.
 */

/** Short enough that a state change shows up promptly; long enough to matter. */
export const SNAPSHOT_TTL_MS = 10_000;

type Entry<T> = {
  /** In flight, or settled and being reused until `expiresAt`. */
  promise: Promise<T>;
  expiresAt: number;
  settled: boolean;
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

/**
 * Runs `produce` at most once per key per TTL, coalescing concurrent callers.
 *
 * A rejected capture is not retained: the entry is dropped as soon as it
 * settles unhappily, so a transient upstream failure cannot be served as a
 * result for the rest of the window. Callers already in flight still share that
 * one attempt, which is the point — a failing upstream must not be amplified
 * either.
 */
export async function withSingleFlight<T>(
  key: string,
  now: number,
  produce: () => Promise<T>,
  ttlMs: number = SNAPSHOT_TTL_MS,
): Promise<T> {
  const existing = entries.get(key);
  if (existing && existing.expiresAt > now) return existing.promise as Promise<T>;

  const entry: Entry<T> = {
    promise: produce(),
    expiresAt: now + ttlMs,
    settled: false,
  };
  entries.set(key, entry as Entry<unknown>);

  try {
    const value = await entry.promise;
    entry.settled = true;
    return value;
  } catch (error) {
    // Drop it, but only if it is still ours: a later caller may have replaced
    // the entry after expiry and that one is not this failure's to evict.
    if (entries.get(key) === (entry as Entry<unknown>)) entries.delete(key);
    throw error;
  }
}
