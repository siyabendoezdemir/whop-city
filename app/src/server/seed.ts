/**
 * The layout seed.
 *
 * The city has to look the same every time a given business opens it, so the
 * seed is a stable function of who they are. It must not be a way to learn who
 * they are.
 *
 * HMAC-SHA-256 over the account id, truncated to 64 bits, keyed with
 * `CITY_SEED_SECRET`. The key is not optional. An unkeyed digest of an account
 * id is only as strong as the input space, and Whop account ids are short and
 * structured, so a determined attacker who knows the format can grind one and
 * recover the business from a public page. That fallback used to exist here and
 * is gone: a live, account-bound projection either gets a keyed seed or it does
 * not get served at all.
 *
 * Fixtures and the unavailable city are not account-bound, so they keep the
 * inert fixed seed below and need no secret.
 *
 * The raw account id never leaves this module.
 */

const DOMAIN = "whop-city/layout-seed/v2";
/** 64 bits: plenty to seed a layout, too few to be a useful handle. */
const SEED_BYTES = 8;

/**
 * Shortest key we will accept.
 *
 * Not a cryptographic threshold so much as a typo guard: a two-character
 * `CITY_SEED_SECRET` is a misconfiguration, and treating it as valid would put
 * a near-grindable seed on a public page while looking correctly configured.
 */
export const MIN_SEED_SECRET_LENGTH = 16;

/** Seed used where there is no account to key from. Stable and obviously inert. */
export const ANONYMOUS_SEED = "0000000000000000";

/**
 * A distinct inert seed per fixture scenario.
 *
 * Fixtures are different invented businesses, so they must not share a seed:
 * the browser keys the player's saved city on it, and one seed for all of them
 * meant loading `thriving` after `blank` showed `blank`'s empty city with
 * `thriving`'s figures. Obviously fake — it is the anonymous seed with the
 * scenario's initials written into the low bytes — and unreachable from a
 * deployable build, where the fixture branch does not exist.
 */
export function fixtureSeed(scenario: string): string {
  let hash = 0;
  for (let i = 0; i < scenario.length; i++) hash = (Math.imul(hash, 131) + scenario.charCodeAt(i)) >>> 0;
  return `00000000${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Raised when an account-bound seed is asked for without a usable key.
 *
 * Callers must treat this as "cannot serve this business" and fall back to the
 * generic unavailable city. It carries no detail: the message must never reach
 * a response.
 */
export class SeedSecretUnavailable extends Error {
  constructor() {
    super("no usable CITY_SEED_SECRET");
    this.name = "SeedSecretUnavailable";
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether a deployment can serve an account-bound city at all.
 *
 * Exported so the route can decide before doing any upstream work, rather than
 * reading a business and then discovering it cannot render it.
 */
export function isUsableSeedSecret(secret: unknown): secret is string {
  return typeof secret === "string" && secret.trim().length >= MIN_SEED_SECRET_LENGTH;
}

/**
 * @param accountId The raw business id. Consumed here, never returned.
 * @param secret The deployment key. Absent, blank or too short throws.
 * @throws SeedSecretUnavailable
 */
export async function deriveLayoutSeed(accountId: string, secret: unknown): Promise<string> {
  if (!isUsableSeedSecret(secret)) throw new SeedSecretUnavailable();

  const encoder = new TextEncoder();
  const digest = await hmac(
    encoder.encode(secret.trim()),
    encoder.encode(`${DOMAIN}:${accountId}`),
  );
  return toHex(digest.slice(0, SEED_BYTES));
}

async function hmac(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, message as BufferSource));
}

/**
 * A small deterministic integer stream from the seed.
 *
 * Used to pick renderer variants so two businesses in the same state still get
 * visibly different cities. Carries no information beyond the seed itself.
 */
export function seedStream(seed: string): () => number {
  let state = 0;
  for (let i = 0; i < seed.length; i++) {
    state = (Math.imul(state, 31) + seed.charCodeAt(i)) >>> 0;
  }
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}
