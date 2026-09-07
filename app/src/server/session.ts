/**
 * The owner's session.
 *
 * A Whop website has no iframe and no injected user token — the hosting docs
 * are explicit that the runtime "authenticates as your business, never as the
 * visitor", and that visitor identity means OAuth. So the owner signs in with
 * Whop, and what survives that is this: a small signed cookie saying which
 * user Whop vouched for and that they were an admin of this business when
 * they signed in.
 *
 * Stateless on purpose. There is nowhere to keep a session table on a hosted
 * website, so the cookie carries its own claims and an HMAC over them. It is
 * short-lived, `HttpOnly`, `Secure` and `SameSite=Lax`, and it holds nothing
 * but a user id, a business id and two timestamps — no token, no name, no
 * email, nothing that would matter if it leaked.
 */

const COOKIE = "city_session";
/** Long enough to play, short enough that admin rights are rechecked often. */
const LIFETIME_MS = 60 * 60 * 1000;

/** One of the signed-in user's businesses, as the profile menu needs it. */
export type Shop = { readonly id: string; readonly name: string };

export type Session = {
  readonly userId: string;
  /** The business they were an admin of. Must match the deployment's own. */
  readonly accountId: string;
  /**
   * What to call the player. Read once at sign-in from the `profile` scope so
   * the interface can greet somebody by name instead of showing them a
   * "Sign out" link and calling that a profile.
   */
  readonly name?: string;
  /**
   * The businesses this user runs, as Whop listed them at sign-in.
   *
   * Somebody with several Whops needs to know which one the city is about,
   * and be able to say. Names and ids only, capped, and never served to
   * anyone but the signed-in user themselves.
   */
  readonly shops?: readonly Shop[];
  /**
   * Which of them the city is currently depicting.
   *
   * Defaults to the deployment's own business, which is the only one a hosted
   * Website's credential is guaranteed to be able to read.
   */
  readonly viewing?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
};

/** Keeps the cookie small and bounded whatever Whop returns. */
export const MAX_SHOPS = 8;

export function trimShops(shops: readonly Shop[]): Shop[] {
  return shops
    .filter((shop) => typeof shop.id === "string" && shop.id.length > 0)
    .slice(0, MAX_SHOPS)
    .map((shop) => ({ id: shop.id, name: String(shop.name ?? "").slice(0, 48) || shop.id }));
}

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view: Uint8Array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Constant-time by construction: the comparison is done by WebCrypto. */
async function verify(secret: string, body: string, signature: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify("HMAC", await key(secret), fromBase64url(signature), encoder.encode(body));
  } catch {
    return false;
  }
}

export async function mintSession(
  userId: string,
  accountId: string,
  secret: string,
  extra: { name?: string; shops?: readonly Shop[]; viewing?: string } = {},
  now = Date.now(),
): Promise<string> {
  const session: Session = {
    userId,
    accountId,
    issuedAt: now,
    expiresAt: now + LIFETIME_MS,
    ...(extra.name ? { name: extra.name.slice(0, 48) } : {}),
    ...(extra.shops && extra.shops.length > 0 ? { shops: trimShops(extra.shops) } : {}),
    ...(extra.viewing ? { viewing: extra.viewing } : {}),
  };
  const body = base64url(encoder.encode(JSON.stringify(session)));
  const signature = base64url(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body)));
  return `${body}.${signature}`;
}

/**
 * Reads a session, or nothing.
 *
 * Every failure is the same failure: no cookie, a bad signature, an expired
 * one, or a session minted for a different business than the deployment is
 * bound to now. That last check is what stops a cookie from one City being
 * carried to another.
 */
export async function readSession(
  request: Request,
  secret: string | undefined,
  accountId: string,
  now = Date.now(),
): Promise<Session | null> {
  if (!secret || secret.length < 24) return null;

  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;

  const [body, signature] = decodeURIComponent(raw).split(".");
  if (!body || !signature) return null;
  if (!(await verify(secret, body, signature))) return null;

  try {
    const session = JSON.parse(new TextDecoder().decode(new Uint8Array(fromBase64url(body)))) as Session;
    if (typeof session.userId !== "string" || session.userId.length === 0) return null;
    if (session.accountId !== accountId) return null;
    if (typeof session.expiresAt !== "number" || session.expiresAt <= now) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Which business this session is looking at.
 *
 * Always one the session itself listed, and otherwise the deployment's own.
 * A caller cannot name a business: the id has to have come back from Whop on
 * this user's own sign-in, or it is not honoured.
 */
export function viewingOf(session: Session): string {
  if (!session.viewing) return session.accountId;
  if (session.viewing === session.accountId) return session.accountId;
  return session.shops?.some((shop) => shop.id === session.viewing)
    ? session.viewing
    : session.accountId;
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  return [
    `${COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "Secure",
    // Lax rather than Strict: the sign-in returns from Whop by redirect, and
    // Strict would drop the cookie on that first navigation back.
    "SameSite=Lax",
  ].join("; ");
}

export const clearedSessionCookie = sessionCookie("", 0);
export const SESSION_SECONDS = LIFETIME_MS / 1000;
