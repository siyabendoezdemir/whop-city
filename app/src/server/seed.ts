/**
 * The layout seed.
 *
 * The city has to look the same every time a given business opens it, which
 * means the seed has to be a stable function of who they are. It must not be a
 * way to learn who they are.
 *
 * So: HMAC-SHA-256 over the account id, truncated to 64 bits. Keyed with
 * `CITY_SEED_SECRET` when the deployment provides one, which makes recovering
 * the account id infeasible even though account ids are short and structured.
 * Without a secret it falls back to a domain-separated plain digest, which is
 * still a one-way function but is only as strong as the input space — a
 * determined attacker who knows the id format could grind it. That is a real
 * limitation and it is why the secret path exists; see the README.
 *
 * The raw account id never leaves this module.
 */

const DOMAIN = "whop-city/layout-seed/v2";
/** 64 bits: plenty to seed a layout, too few to be a useful handle. */
const SEED_BYTES = 8;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Seed used when there is no account to key from. Stable and obviously inert. */
export const ANONYMOUS_SEED = "0000000000000000";

/**
 * @param accountId The raw business id. Consumed here, never returned.
 * @param secret Optional deployment secret. Present in hosted, absent in dev.
 */
export async function deriveLayoutSeed(
  accountId: string | null,
  secret: string | null,
): Promise<string> {
  if (!accountId) return ANONYMOUS_SEED;

  const encoder = new TextEncoder();
  const material = encoder.encode(`${DOMAIN}:${accountId}`);

  const digest = secret
    ? await hmac(encoder.encode(secret), material)
    : new Uint8Array(await crypto.subtle.digest("SHA-256", material as BufferSource));

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
