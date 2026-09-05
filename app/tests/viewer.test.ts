import { afterEach, describe, expect, it, vi } from "vitest";

import { audienceFor, isAdminOf } from "../src/server/viewer";
import { mintSession, readSession, sessionCookie } from "../src/server/session";

/**
 * The gate on the business's real figures.
 *
 * A Whop website has no iframe token — the runtime authenticates as the
 * business, never as the visitor — so identity is an OAuth sign-in reduced to
 * a signed cookie. What is worth proving is that the signature actually holds:
 * a forged, tampered, expired or borrowed cookie has to be refused by the
 * cryptography rather than by a mock.
 */

const ACCOUNT = "biz_xPy7WHYB7QGju5";
const SECRET = "a-secret-long-enough-to-be-a-secret";
const ENV = { WHOP_APP_ID: "app_USXOBX9htLTka7", WHOP_ACCOUNT_ID: ACCOUNT, CITY_SESSION_SECRET: SECRET };

const withCookie = (cookie: string | null) =>
  new Request("https://city.example/api/city/snapshot", {
    headers: cookie ? { cookie } : {},
  });

const signedIn = async (over: { user?: string; account?: string; secret?: string; now?: number } = {}) =>
  `city_session=${encodeURIComponent(
    await mintSession(over.user ?? "user_real", over.account ?? ACCOUNT, over.secret ?? SECRET, over.now),
  )}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubAccess(level: string | null, ok = true) {
  vi.stubGlobal("fetch", async () =>
    ok
      ? new Response(JSON.stringify(level === null ? {} : { access_level: level }), { status: 200 })
      : new Response("nope", { status: 500 }),
  );
}

describe("the session cookie", () => {
  it("round-trips a session it signed itself", async () => {
    const session = await readSession(withCookie(await signedIn()), SECRET, ACCOUNT);
    expect(session?.userId).toBe("user_real");
    expect(session?.accountId).toBe(ACCOUNT);
  });

  it("refuses one signed with a different secret", async () => {
    const forged = await signedIn({ secret: "some-other-secret-of-good-length" });
    expect(await readSession(withCookie(forged), SECRET, ACCOUNT)).toBeNull();
  });

  it("refuses one whose body has been edited", async () => {
    const raw = await mintSession("user_real", ACCOUNT, SECRET);
    const [body, signature] = raw.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ userId: "user_attacker", accountId: ACCOUNT, issuedAt: 0, expiresAt: Date.now() + 1e6 }),
    )
      .toString("base64url");
    expect(body).not.toBe(tampered);
    expect(
      await readSession(withCookie(`city_session=${tampered}.${signature}`), SECRET, ACCOUNT),
    ).toBeNull();
  });

  it("refuses one that has expired", async () => {
    const old = await signedIn({ now: Date.now() - 8 * 60 * 60 * 1000 });
    expect(await readSession(withCookie(old), SECRET, ACCOUNT)).toBeNull();
  });

  it("refuses one minted for another business", async () => {
    // A cookie from one deployed City carried to another must not open it.
    const elsewhere = await signedIn({ account: "biz_somewhere_else" });
    expect(await readSession(withCookie(elsewhere), SECRET, ACCOUNT)).toBeNull();
  });

  it("refuses everything when the deployment has no signing secret", async () => {
    const cookie = await signedIn();
    expect(await readSession(withCookie(cookie), undefined, ACCOUNT)).toBeNull();
    expect(await readSession(withCookie(cookie), "too-short", ACCOUNT)).toBeNull();
  });

  it("refuses rubbish and an absent cookie", async () => {
    for (const cookie of [null, "city_session=", "city_session=nonsense", "other=1"]) {
      expect(await readSession(withCookie(cookie), SECRET, ACCOUNT), String(cookie)).toBeNull();
    }
  });

  it("is set HttpOnly, Secure and scoped to the whole site", () => {
    const cookie = sessionCookie("value", 3600);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    // Lax, not Strict: the sign-in comes back from Whop by redirect and Strict
    // would drop the cookie on that first navigation.
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });
});

describe("checking they run this business", () => {
  it("lets an admin through", async () => {
    stubAccess("admin");
    expect(await isAdminOf("user_real", ENV)).toBe(true);
  });

  it("keeps a customer of the business out", async () => {
    // Holding a membership is not running the place, and the figures are the
    // owner's, not every buyer's.
    stubAccess("customer");
    expect(await isAdminOf("user_real", ENV)).toBe(false);
  });

  it("keeps out anyone the check does not vouch for", async () => {
    for (const level of ["no_access", "member", null]) {
      stubAccess(level);
      expect(await isAdminOf("user_real", ENV), String(level)).toBe(false);
    }
  });

  it("fails closed when the check itself fails", async () => {
    stubAccess("admin", false);
    expect(await isAdminOf("user_real", ENV)).toBe(false);

    vi.stubGlobal("fetch", async () => {
      throw new Error("network");
    });
    expect(await isAdminOf("user_real", ENV)).toBe(false);
  });
});

describe("the audience", () => {
  it("is the owner for a signed-in admin", async () => {
    expect(await audienceFor(withCookie(await signedIn()), ENV)).toBe("owner");
  });

  it("is public for every way it can go wrong", async () => {
    const good = await signedIn();
    expect(await audienceFor(withCookie(null), ENV)).toBe("public");
    expect(await audienceFor(withCookie("city_session=rubbish"), ENV)).toBe("public");
    expect(await audienceFor(withCookie(await signedIn({ account: "biz_other" })), ENV)).toBe("public");
    // No signing secret on the deployment means nobody is ever the owner.
    expect(await audienceFor(withCookie(good), { ...ENV, CITY_SESSION_SECRET: undefined })).toBe("public");
    // And no account binding means there is nothing to be an owner of.
    expect(await audienceFor(withCookie(good), { CITY_SESSION_SECRET: SECRET })).toBe("public");
  });
});
