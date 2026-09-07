import { afterEach, describe, expect, it, vi } from "vitest";

import { handleAuthStart } from "../src/server/oauth";

/**
 * The Blueprint bootstrap.
 *
 * Every Blueprint deployment registers a **new** Whop app, and a new app has
 * no OAuth callback whitelisted and is a `confidential` client. So the first
 * person to press "Sign in with Whop" on a freshly published City gets
 * `redirect_uri is invalid` back from Whop before anything else happens — which
 * is exactly what a second deployment did.
 *
 * These assert the fix, and the shape of it: the deployment configures its own
 * app record, once, and refuses to send anybody to Whop if that did not work.
 */

const ENV = { WHOP_APP_ID: "app_test", CITY_SESSION_SECRET: "a-secret-long-enough-to-be-a-secret" };
const CALLBACK = "https://city.example/api/auth/callback";

const start = () => new Request("https://city.example/api/auth/start");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

type Call = { url: string; method: string; body: unknown };

/**
 * A Whop that remembers what it was told.
 *
 * `app` is mutated by a successful PATCH, so a read-back sees what a real one
 * would and the test is about the exchange rather than about a stub.
 */
function stubWhop(options: { app: { redirect_uris: string[]; oauth_client_type: string }; patchOk?: boolean }) {
  const calls: Call[] = [];
  const app = { ...options.app, id: "app_test", account: { id: "biz_test" } };

  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (url.includes("/api/v1/apps/") && method === "PATCH") {
      if (options.patchOk === false) return new Response("no", { status: 403 });
      const body = JSON.parse(String(init!.body)) as { redirect_uris: string[]; oauth_client_type: string };
      app.redirect_uris = body.redirect_uris;
      app.oauth_client_type = body.oauth_client_type;
      return new Response(JSON.stringify(app), { status: 200 });
    }
    if (url.includes("/api/v1/apps/")) return new Response(JSON.stringify(app), { status: 200 });
    return new Response("{}", { status: 200 });
  });

  return { calls, app };
}

/** Imported fresh each time: the module caches a successful bootstrap. */
async function freshStart() {
  vi.resetModules();
  const module = (await import("../src/server/oauth")) as { handleAuthStart: typeof handleAuthStart };
  return module.handleAuthStart;
}

describe("a freshly published City", () => {
  it("registers its own callback before sending anybody to Whop", async () => {
    const whop = stubWhop({ app: { redirect_uris: [], oauth_client_type: "confidential" } });
    const response = await (await freshStart())(start(), ENV);

    const patch = whop.calls.find((call) => call.method === "PATCH");
    expect(patch, "no PATCH was made, so the app was left unregistered").toBeTruthy();
    expect(patch!.body).toEqual({
      // Exactly two fields. Nothing else about the app is the deployment's
      // business to change.
      redirect_uris: [CALLBACK],
      oauth_client_type: "public",
    });

    // And it only then sends them on.
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/oauth/authorize");
  });

  it("keeps a callback somebody else registered", async () => {
    const other = "https://preview.example/api/auth/callback";
    const whop = stubWhop({ app: { redirect_uris: [other], oauth_client_type: "confidential" } });
    await (await freshStart())(start(), ENV);

    const patch = whop.calls.find((call) => call.method === "PATCH")!;
    // Replacing rather than merging would break the other environment.
    expect(patch.body).toEqual({ redirect_uris: [other, CALLBACK], oauth_client_type: "public" });
  });

  it("writes nothing at all once the app is already configured", async () => {
    const whop = stubWhop({ app: { redirect_uris: [CALLBACK], oauth_client_type: "public" } });
    const response = await (await freshStart())(start(), ENV);

    expect(whop.calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(response.status).toBe(302);
  });

  it("does it once, not on every sign-in", async () => {
    const whop = stubWhop({ app: { redirect_uris: [], oauth_client_type: "confidential" } });
    const signIn = await freshStart();
    await signIn(start(), ENV);
    const afterFirst = whop.calls.length;
    await signIn(start(), ENV);

    expect(whop.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(whop.calls.length, "the second sign-in read the app record again").toBe(afterFirst);
  });

  it("refuses to send anybody to Whop when it could not register", async () => {
    // Better a message saying so than the raw `redirect_uri is invalid` that
    // Whop would otherwise hand back.
    stubWhop({ app: { redirect_uris: [], oauth_client_type: "confidential" }, patchOk: false });
    const response = await (await freshStart())(start(), ENV);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("auth=unregistered");
    expect(response.headers.get("location")).not.toContain("oauth/authorize");
  });

  it("touches nothing but its own app record", async () => {
    const whop = stubWhop({ app: { redirect_uris: [], oauth_client_type: "confidential" } });
    await (await freshStart())(start(), ENV);

    for (const call of whop.calls) {
      if (call.method === "GET") continue;
      expect(call.method, `${call.method} ${call.url}`).toBe("PATCH");
      expect(new URL(call.url).pathname).toBe("/api/v1/apps/app_test");
    }
  });
});
