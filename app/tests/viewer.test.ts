import { SignJWT, exportJWK, generateKeyPair, importJWK, type JWK } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { audienceFor, isAdminOf, verifyViewer } from "../src/server/viewer";

/**
 * The gate on the business's real figures.
 *
 * Tested with real ES256 keys rather than a stubbed verifier, because the
 * thing worth proving is that a forged or misdirected token is actually
 * rejected by the cryptography — not that a mock returned false.
 */

const APP = "app_USXOBX9htLTka7";
const ACCOUNT = "biz_xPy7WHYB7QGju5";
const ENV = { WHOP_APP_ID: APP, WHOP_ACCOUNT_ID: ACCOUNT };

let publicJwk: JWK;
let sign: (claims: Record<string, unknown>) => Promise<string>;
let otherSign: (claims: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  const mine = await generateKeyPair("ES256");
  const theirs = await generateKeyPair("ES256");
  publicJwk = await exportJWK(mine.publicKey);

  sign = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(mine.privateKey);

  otherSign = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(theirs.privateKey);
});

const keys = async () => (await importJWK(publicJwk, "ES256")) as CryptoKey;

const withToken = (token: string | null) =>
  new Request("https://city.example/api/city/snapshot", {
    headers: token ? { "x-whop-user-token": token } : {},
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A stand-in for the access check, so the token tests do not need network. */
function stubAccess(level: string | null, ok = true) {
  vi.stubGlobal("fetch", async () =>
    ok
      ? new Response(JSON.stringify(level === null ? {} : { access_level: level }), { status: 200 })
      : new Response("nope", { status: 500 }),
  );
}

describe("verifying the viewer", () => {
  it("accepts a token Whop signed for this app", async () => {
    const token = await sign({ sub: "user_real", aud: APP });
    expect(await verifyViewer(withToken(token), ENV, await keys())).toBe("user_real");
  });

  it("refuses a token minted for a different app", async () => {
    // Otherwise any Whop app could hand its own token over and read this
    // business's figures.
    const token = await sign({ sub: "user_real", aud: "app_someone_else" });
    expect(await verifyViewer(withToken(token), ENV, await keys())).toBeNull();
  });

  it("refuses a token signed by somebody else's key", async () => {
    const token = await otherSign({ sub: "user_real", aud: APP });
    expect(await verifyViewer(withToken(token), ENV, await keys())).toBeNull();
  });

  it("refuses an expired token", async () => {
    const stale = await new SignJWT({ sub: "user_real", aud: APP })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign((await generateKeyPair("ES256")).privateKey);
    expect(await verifyViewer(withToken(stale), ENV, await keys())).toBeNull();
  });

  it("refuses rubbish, and an absent header", async () => {
    expect(await verifyViewer(withToken("not.a.token"), ENV, await keys())).toBeNull();
    expect(await verifyViewer(withToken(""), ENV, await keys())).toBeNull();
    expect(await verifyViewer(withToken(null), ENV, await keys())).toBeNull();
  });

  it("refuses everything when the deployment does not know which app it is", async () => {
    const token = await sign({ sub: "user_real", aud: APP });
    expect(await verifyViewer(withToken(token), {}, await keys())).toBeNull();
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
  it("is the owner only with both a good token and an admin check", async () => {
    stubAccess("admin");
    const token = await sign({ sub: "user_real", aud: APP });
    expect(await audienceFor(withToken(token), ENV, await keys())).toBe("owner");
  });

  it("is public for every way it can go wrong", async () => {
    const good = await sign({ sub: "user_real", aud: APP });
    const wrongApp = await sign({ sub: "user_real", aud: "app_other" });

    stubAccess("admin");
    expect(await audienceFor(withToken(null), ENV, await keys())).toBe("public");
    expect(await audienceFor(withToken("rubbish"), ENV, await keys())).toBe("public");
    expect(await audienceFor(withToken(wrongApp), ENV, await keys())).toBe("public");

    stubAccess("customer");
    expect(await audienceFor(withToken(good), ENV, await keys())).toBe("public");

    stubAccess("admin", false);
    expect(await audienceFor(withToken(good), ENV, await keys())).toBe("public");
  });
});
