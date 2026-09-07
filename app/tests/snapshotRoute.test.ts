import { isLiveSource } from "../src/server/snapshotRoute";
import { apiOrigin, boundAppId, isWhopPlan } from "../src/server/whop-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SNAPSHOT_METHOD,
  SNAPSHOT_PATH,
  deploymentKey,
  handleSnapshotRequest,
  isFixtureSource,
  resolveSource,
} from "../src/server/snapshotRoute";
import {
  SNAPSHOT_TTL_MS,
  resetSnapshotCache,
  snapshotCacheSize,
  withSingleFlight,
} from "../src/server/snapshotCache";
import { FIXTURE_SCENARIOS, resolveScenario } from "../src/server/scenarios";
import type { Env } from "../src/server/whop-client";

const ORIGIN = "https://city-spike.whop.site";
const url = (query = "") => `${ORIGIN}${SNAPSHOT_PATH}${query}`;

/** Long enough to be a real key rather than a typo. */
const SECRET = "a-deployment-secret-long-enough";

/** Local, with fixtures explicitly switched on. Comes from `.dev.vars`. */
const FIXTURE_ENV: Env = { CITY_FIXTURES: "1" };

/** A deployment with nothing bound and no fixture opt-in. */
const UNCONFIGURED_ENV: Env = {};

/** A correctly configured hosted deployment. */
const LIVE_ENV: Env = {
  WHOP_API_ORIGIN: "https://api.whop.com",
  WHOP_ACCOUNT_ID: "biz_LIVE_ACCOUNT",
  CITY_SEED_SECRET: SECRET,
};

/** A hosted deployment that forgot the seed key. */
const LIVE_NO_SECRET_ENV: Env = {
  WHOP_API_ORIGIN: "https://api.whop.com",
  WHOP_ACCOUNT_ID: "biz_LIVE_ACCOUNT",
};

const PRODUCT = {
  id: "prod_1",
  title: "A product",
  visibility: "visible",
  member_count: 12,
  created_at: "2026-01-01T00:00:00Z",
  default_plan: null,
  global_affiliate_status: "enabled",
  global_affiliate_percentage: 20,
  member_affiliate_status: "disabled",
};

const PLAN = {
  id: "plan_1",
  plan_type: "renewal",
  visibility: "visible",
  created_at: "2026-01-01T00:00:00Z",
  initial_price: { amount: "10.00", currency: "usd" },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A healthy upstream: one product, one plan, and the detail read behind it. */
function healthyUpstream(): (input: unknown) => Promise<Response> {
  return async (input: unknown) => {
    const requested = String(input);
    if (requested.includes("/products/")) return json(PRODUCT);
    if (requested.includes("/products")) return json({ data: [PRODUCT] });
    if (requested.includes("/plans")) return json({ data: [PLAN] });
    return json({});
  };
}

/** A business that genuinely has nothing in it. */
function emptyUpstream(): (input: unknown) => Promise<Response> {
  return async () => json({ data: [] });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetSnapshotCache();
  fetchSpy = vi.fn(healthyUpstream());
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSnapshotCache();
});

const read = async (env: Env, query = "") =>
  (await handleSnapshotRequest(new Request(url(query)), env)).json();

describe("the snapshot endpoint", () => {
  it("is a single fixed same-origin path", () => {
    expect(SNAPSHOT_PATH).toBe("/api/city/snapshot");
    expect(SNAPSHOT_METHOD).toBe("GET");
  });

  it("answers GET with the safe projection", async () => {
    const response = await handleSnapshotRequest(new Request(url()), FIXTURE_ENV);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual([
      "districts",
      "freshness",
      "metrics",
      "schema",
      "seed",
    ]);
    // Fixtures are invented data with no business behind them, so the game is
    // fully playable in dev and the figures come through. A production build
    // has no fixture branch at all — `production-build.spec.ts` proves the
    // guard compiles it away — and the live path withholds unless the viewer
    // has been verified as an admin.
    expect(body.metrics.source).toBe("owner");
    expect(typeof body.metrics.gold).toBe("number");
  });

  it("marks the response private and unstored, never shared", async () => {
    const response = await handleSnapshotRequest(new Request(url()), FIXTURE_ENV);
    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("private");
    expect(cacheControl).not.toContain("public");
    expect(cacheControl).not.toContain("s-maxage");
  });

  it("refuses every method other than GET", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const response = await handleSnapshotRequest(new Request(url(), { method }), FIXTURE_ENV);
      expect(response.status, `${method} was accepted`).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
    }
  });

  it("makes no outbound request at all without a binding", async () => {
    await handleSnapshotRequest(new Request(url()), FIXTURE_ENV);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says it cannot read the business rather than inventing one", async () => {
    const body = await read(UNCONFIGURED_ENV);
    expect(body.freshness).toBe("unavailable");
    for (const district of body.districts) {
      expect(district.state).toBe("dormant");
      expect(district.signal).toBe("unreadable");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cannot be talked into fixtures by a caller", async () => {
    const body = await read(UNCONFIGURED_ENV, "?scenario=thriving");
    expect(body.freshness).toBe("unavailable");
    expect(body.districts.every((d: { state: string }) => d.state === "dormant")).toBe(true);
  });

  it("ignores caller input entirely when reading live", async () => {
    const hostile =
      "?account_id=biz_ATTACKER" +
      "&url=https%3A%2F%2Fevil.example%2Fsteal" +
      "&scenario=struggling" +
      "&method=DELETE" +
      "&path=%2Fapi%2Fv1%2Fpayments";

    await handleSnapshotRequest(
      new Request(url(hostile), { headers: { "x-whop-account-id": "biz_ATTACKER" } }),
      LIVE_ENV,
    );

    expect(fetchSpy).toHaveBeenCalled();
    for (const call of fetchSpy.mock.calls) {
      const requested = String(call[0]);
      const init = (call[1] ?? {}) as RequestInit;

      expect(requested).toMatch(/^https:\/\/api\.whop\.com\/api\/v1\/(products|plans|apps)/);
      expect(requested).not.toContain("biz_ATTACKER");
      expect(requested).not.toContain("evil.example");
      expect(requested).not.toContain("payments");
      expect(init.method ?? "GET").toBe("GET");
      expect(init.body ?? null).toBeNull();
    }
  });

  it("uses the bound account and not one supplied by the caller", async () => {
    await handleSnapshotRequest(new Request(url("?account_id=biz_ATTACKER")), LIVE_ENV);
    const scoped = fetchSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((requested) => requested.includes("account_id="));
    expect(scoped.length).toBeGreaterThan(0);
    for (const requested of scoped) {
      expect(requested).toContain(encodeURIComponent("biz_LIVE_ACCOUNT"));
    }
  });

  it("falls back to an unknown scenario silently rather than echoing it", async () => {
    const response = await handleSnapshotRequest(
      new Request(url("?scenario=%3Cscript%3Ealert(1)%3C%2Fscript%3E")),
      FIXTURE_ENV,
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain("script");
    expect(text).not.toContain("alert");
  });
});

// ---------------------------------------------------------------------------
// Blocker 1: a live city without a keyed seed must not be served at all.
// ---------------------------------------------------------------------------

describe("the seed key is mandatory for a live city", () => {
  it("serves the unavailable city when the secret is missing", async () => {
    const body = await read(LIVE_NO_SECRET_ENV);
    expect(body.freshness).toBe("unavailable");
    expect(body.seed).toBe("0000000000000000");
    expect(resolveSource(LIVE_NO_SECRET_ENV)).toBe("none");
  });

  it("serves the unavailable city when the secret is blank or too short", async () => {
    for (const secret of ["", "   ", "short"]) {
      resetSnapshotCache();
      const body = await read({ ...LIVE_NO_SECRET_ENV, CITY_SEED_SECRET: secret });
      expect(body.freshness, `secret ${JSON.stringify(secret)} was accepted`).toBe("unavailable");
    }
  });

  it("reads nothing upstream when it could not render the result anyway", async () => {
    // The key is checked before the capture, so a misconfigured deployment does
    // not spend the business's rate limit on a city it cannot serve.
    await read(LIVE_NO_SECRET_ENV);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves a live city once the secret is present", async () => {
    const body = await read(LIVE_ENV);
    expect(body.freshness).toBe("live");
    expect(body.seed).toMatch(/^[0-9a-f]{16}$/);
    expect(body.seed).not.toBe("0000000000000000");
  });

  it("gives the same business the same city under the same secret", async () => {
    const first = await read(LIVE_ENV);
    resetSnapshotCache();
    const second = await read(LIVE_ENV);
    expect(first.seed).toBe(second.seed);
  });

  it("gives the same business a different city under a different secret", async () => {
    const first = await read(LIVE_ENV);
    resetSnapshotCache();
    const second = await read({ ...LIVE_ENV, CITY_SEED_SECRET: "another-secret-long-enough" });
    expect(first.seed).not.toBe(second.seed);
  });

  it("never puts the account id on the wire", async () => {
    const response = await handleSnapshotRequest(new Request(url()), LIVE_ENV);
    const text = await response.text();
    expect(text).not.toContain("biz_LIVE_ACCOUNT");
    expect(text).not.toContain("biz_");
  });
});

// ---------------------------------------------------------------------------
// Blocker 2: a failed read is not a business with nothing in it.
// ---------------------------------------------------------------------------

describe("upstream failures do not become dormant business state", () => {
  const expectUnavailable = async (env: Env = LIVE_ENV) => {
    const body = await read(env);
    expect(body.freshness).toBe("unavailable");
    for (const district of body.districts) {
      expect(district.state).toBe("dormant");
      expect(district.signal).toBe("unreadable");
    }
    return body;
  };

  it("treats a rejected request as unavailable, not empty", async () => {
    fetchSpy.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:443"));
    await expectUnavailable();
  });

  it("treats a timeout as unavailable, not empty", async () => {
    fetchSpy.mockImplementation(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      });
    });
    await expectUnavailable();
  });

  it("treats a non-OK status as unavailable, not empty", async () => {
    for (const status of [400, 404, 429, 500, 502, 503]) {
      resetSnapshotCache();
      fetchSpy.mockImplementation(async () => json({ error: "nope" }, status));
      await expectUnavailable();
    }
  });

  it("treats an authorization failure as unavailable, not empty", async () => {
    for (const status of [401, 403]) {
      resetSnapshotCache();
      fetchSpy.mockImplementation(async () => json({ error: "unauthorized" }, status));
      await expectUnavailable();
    }
  });

  it("treats a malformed body as unavailable, not empty", async () => {
    fetchSpy.mockImplementation(
      async () =>
        new Response("<html>gateway timeout</html>", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expectUnavailable();
  });

  it("treats a 200 with no account on it as unavailable", async () => {
    fetchSpy.mockImplementation(async () => json({}));
    await expectUnavailable({
      WHOP_API_ORIGIN: "https://api.whop.com",
      APP_ID: "app_1",
      CITY_SEED_SECRET: SECRET,
    });
  });

  it("treats one failed detail read as unavailable rather than a quiet quarter", async () => {
    // The strict choice, and the point of it: a failed affiliate read would
    // otherwise render Creator Quarter dormant, which reads as "nobody is
    // affiliating" when the truth is that we could not look.
    fetchSpy.mockImplementation(async (input: unknown) => {
      const requested = String(input);
      if (requested.includes("/products/")) return json({ error: "nope" }, 500);
      if (requested.includes("/products")) return json({ data: [PRODUCT] });
      if (requested.includes("/plans")) return json({ data: [PLAN] });
      return json({});
    });
    await expectUnavailable();
  });

  it("keeps a genuinely empty business as a live result", async () => {
    // The other half of the contract. A business that really has nothing is a
    // successful read and must stay live, or the operator can never tell the
    // difference between an empty shop and a broken city.
    fetchSpy.mockImplementation(emptyUpstream());
    const body = await read(LIVE_ENV);

    expect(body.freshness).toBe("live");
    expect(body.seed).not.toBe("0000000000000000");
    for (const district of body.districts) {
      expect(district.state).toBe("dormant");
      // "unbuilt", not "unreadable": we looked, and there is nothing there.
      expect(district.signal).toBe("unbuilt");
    }
  });

  it("exposes no upstream error text, url, id or status", async () => {
    fetchSpy.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.5:443 while reading biz_LIVE_ACCOUNT"),
    );
    const response = await handleSnapshotRequest(new Request(url()), LIVE_ENV);
    const text = await response.text();

    expect(response.status).toBe(200);
    for (const leak of ["ECONNREFUSED", "10.0.0.5", "biz_LIVE_ACCOUNT", "api.whop.com", "stack"]) {
      expect(text, `response carried ${leak}`).not.toContain(leak);
    }
  });
});

// ---------------------------------------------------------------------------
// Blocker 3: a public endpoint must not amplify into the upstream API.
// ---------------------------------------------------------------------------

describe("request amplification is bounded", () => {
  /** A clock the test moves by hand, so expiry never depends on real time. */
  function fakeClock(start = 1_000_000) {
    let now = start;
    return { now: () => now, advance: (ms: number) => (now += ms) };
  }

  /** A producer that resolves only when the test says so. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("coalesces concurrent requests into one upstream capture", async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => handleSnapshotRequest(new Request(url()), LIVE_ENV)),
    );
    const bodies = await Promise.all(responses.map((response) => response.json()));

    // One capture: account is bound, so products + plans + one detail read.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it("shares an in-flight capture that outlives the ttl", async () => {
    // The bug this replaces: the window used to start when the producer did, so
    // a capture slower than ten seconds was joined by a second upstream
    // fan-out at exactly the moment the upstream was least able to take one.
    const clock = fakeClock();
    const gate = deferred<string>();
    let started = 0;
    const produce = () => {
      started += 1;
      return gate.promise;
    };

    const first = withSingleFlight("k", produce, { clock: clock.now });
    clock.advance(SNAPSHOT_TTL_MS * 5);
    const second = withSingleFlight("k", produce, { clock: clock.now });

    expect(started).toBe(1);
    gate.resolve("one capture");
    expect(await first).toBe("one capture");
    expect(await second).toBe("one capture");
    expect(started).toBe(1);
  });

  it("starts the ttl when the capture settles, not when it began", async () => {
    const clock = fakeClock();
    const gate = deferred<string>();
    let started = 0;
    const produce = () => {
      started += 1;
      return started === 1 ? gate.promise : Promise.resolve("second");
    };

    const first = withSingleFlight("k", produce, { clock: clock.now });
    clock.advance(SNAPSHOT_TTL_MS * 3); // the capture takes longer than the window
    gate.resolve("first");
    await first;

    // Still fresh, because the window opened at settlement.
    clock.advance(SNAPSHOT_TTL_MS - 1);
    expect(await withSingleFlight("k", produce, { clock: clock.now })).toBe("first");
    expect(started).toBe(1);

    clock.advance(2);
    expect(await withSingleFlight("k", produce, { clock: clock.now })).toBe("second");
    expect(started).toBe(2);
  });

  it("does not retain a rejected capture", async () => {
    const clock = fakeClock();
    let calls = 0;
    const produce = async () => {
      calls += 1;
      if (calls === 1) throw new Error("upstream down");
      return "recovered";
    };

    await expect(withSingleFlight("k", produce, { clock: clock.now })).rejects.toThrow();
    // Same instant: the failure was dropped, so this is a fresh attempt.
    expect(await withSingleFlight("k", produce, { clock: clock.now })).toBe("recovered");
  });

  it("does not retain a result the caller declines to keep", async () => {
    const clock = fakeClock();
    let calls = 0;
    const produce = async () => `attempt-${(calls += 1)}`;
    const retain = (value: string) => value !== "attempt-1";

    expect(await withSingleFlight("k", produce, { clock: clock.now, retain })).toBe("attempt-1");
    // Not kept, so the very next request retries rather than replaying it.
    expect(await withSingleFlight("k", produce, { clock: clock.now, retain })).toBe("attempt-2");
    // That one is retained.
    expect(await withSingleFlight("k", produce, { clock: clock.now, retain })).toBe("attempt-2");
    expect(calls).toBe(2);
    expect(snapshotCacheSize()).toBe(1);
  });

  it("shares one failed attempt between concurrent callers, then retries", async () => {
    const clock = fakeClock();
    const gate = deferred<string>();
    let started = 0;
    const produce = () => {
      started += 1;
      return started === 1 ? gate.promise : Promise.resolve("after");
    };

    const a = withSingleFlight("k", produce, { clock: clock.now });
    const b = withSingleFlight("k", produce, { clock: clock.now });
    gate.reject(new Error("down"));

    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
    expect(started, "concurrent callers each started their own attempt").toBe(1);

    expect(await withSingleFlight("k", produce, { clock: clock.now })).toBe("after");
  });

  it("never serves a failed capture as a live city, and retries it", async () => {
    fetchSpy.mockRejectedValue(new Error("upstream down"));
    expect((await read(LIVE_ENV)).freshness).toBe("unavailable");
    const callsAfterFailure = fetchSpy.mock.calls.length;

    // An unavailable answer is a failure with a face on it, so it is not
    // pinned for the window: the next request goes back upstream.
    expect((await read(LIVE_ENV)).freshness).toBe("unavailable");
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFailure);

    // And a recovered upstream is picked up immediately, not after the ttl.
    fetchSpy.mockImplementation(healthyUpstream());
    expect((await read(LIVE_ENV)).freshness).toBe("live");
  });

  it("reuses a successful live city for the window", async () => {
    expect((await read(LIVE_ENV)).freshness).toBe("live");
    const calls = fetchSpy.mock.calls.length;
    await read(LIVE_ENV);
    expect(fetchSpy.mock.calls.length).toBe(calls);
  });

  it("keys entries by deployment, so two deployments never share a city", async () => {
    const a: Env = { ...LIVE_ENV, WHOP_ACCOUNT_ID: "biz_ALPHA" };
    const b: Env = { ...LIVE_ENV, WHOP_ACCOUNT_ID: "biz_BETA" };

    expect(deploymentKey(a, "live")).not.toBe(deploymentKey(b, "live"));

    const [first, second] = await Promise.all([read(a), read(b)]);
    expect(first.seed).not.toBe(second.seed);
    // Two captures, not one shared between them.
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it("separates a live deployment from a fixture one", () => {
    expect(deploymentKey(LIVE_ENV, "live")).not.toBe(deploymentKey(FIXTURE_ENV, "fixture"));
    expect(deploymentKey(UNCONFIGURED_ENV, "none")).not.toBe(deploymentKey(LIVE_ENV, "live"));
  });

  it("builds its key from bindings only, never from the request", () => {
    const key = deploymentKey(LIVE_ENV, "live");
    expect(key).toContain("biz_LIVE_ACCOUNT");
    expect(key).toContain("https://api.whop.com");
    expect(key).not.toContain("scenario");
    expect(key).not.toContain("?");
  });
});

// ---------------------------------------------------------------------------
// The permitted upstream origin.
// ---------------------------------------------------------------------------

describe("the permitted api origin", () => {
  const refuses = async (origin: string) => {
    resetSnapshotCache();
    const body = await read({ ...LIVE_ENV, WHOP_API_ORIGIN: origin });
    expect(body.freshness, `${origin} was accepted`).toBe("unavailable");
    expect(fetchSpy, `${origin} caused a request`).not.toHaveBeenCalled();
  };

  it("refuses a non-whop host", async () => {
    await refuses("https://evil.example");
    await refuses("https://api.whop.com.evil.example");
    await refuses("https://notwhop.com");
  });

  it("refuses plain http", async () => {
    await refuses("http://api.whop.com");
  });

  it("refuses the marketplace apex, which is not an api host", async () => {
    await refuses("https://whop.com");
  });

  it("refuses an origin carrying credentials, a path or a query", async () => {
    await refuses("https://user:pass@api.whop.com");
    await refuses("https://api.whop.com/v1");
    await refuses("https://api.whop.com/?x=1");
  });

  it("accepts the documented api host", async () => {
    const body = await read(LIVE_ENV);
    expect(body.freshness).toBe("live");
  });
});

// ---------------------------------------------------------------------------
// A 200 is not on its own a successful read.
// ---------------------------------------------------------------------------

describe("malformed upstream responses are not live cities", () => {
  const expectUnavailable = async (env: Env = LIVE_ENV) => {
    const body = await read(env);
    expect(body.freshness).toBe("unavailable");
    for (const district of body.districts) {
      expect(district.state).toBe("dormant");
      expect(district.signal).toBe("unreadable");
    }
  };

  /**
   * Serves `products`/`plans`/`detail` overrides on top of a healthy upstream.
   *
   * Key presence rather than `??`, so an override of `null` is served as `null`
   * instead of falling through to the healthy default — which is exactly the
   * case being tested.
   */
  function upstream(overrides: { products?: unknown; plans?: unknown; detail?: unknown }) {
    const pick = (key: keyof typeof overrides, fallback: unknown) =>
      key in overrides ? overrides[key] : fallback;
    return async (input: unknown) => {
      const requested = String(input);
      if (requested.includes("/products/")) return json(pick("detail", PRODUCT));
      if (requested.includes("/products")) return json(pick("products", { data: [PRODUCT] }));
      if (requested.includes("/plans")) return json(pick("plans", { data: [PLAN] }));
      return json({});
    };
  }

  it("rejects a 200 product list with no data on it", async () => {
    fetchSpy.mockImplementation(upstream({ products: {} }));
    await expectUnavailable();
  });

  it("rejects a 200 plan list with no data on it", async () => {
    fetchSpy.mockImplementation(upstream({ plans: {} }));
    await expectUnavailable();
  });

  it("rejects a list whose data is not an array", async () => {
    for (const products of [{ data: null }, { data: "nope" }, { data: { 0: PRODUCT } }]) {
      resetSnapshotCache();
      fetchSpy.mockImplementation(upstream({ products }));
      await expectUnavailable();
    }
  });

  it("rejects a list body that is not an object at all", async () => {
    for (const products of [null, [PRODUCT], "ok", 7]) {
      resetSnapshotCache();
      fetchSpy.mockImplementation(upstream({ products }));
      await expectUnavailable();
    }
  });

  it("rejects list items with no usable id", async () => {
    for (const products of [{ data: [{}] }, { data: [{ id: "" }] }, { data: [null] }]) {
      resetSnapshotCache();
      fetchSpy.mockImplementation(upstream({ products }));
      await expectUnavailable();
    }
  });

  it("rejects an empty product detail", async () => {
    // The case that used to slip through: {} became a successful detail and
    // every affiliate field was silently read as disabled, so Creator Quarter
    // rendered dormant on no evidence at all.
    fetchSpy.mockImplementation(upstream({ detail: {} }));
    await expectUnavailable();
  });

  it("rejects a product detail missing the affiliate fields it exists to fetch", async () => {
    const { global_affiliate_status, ...withoutStatus } = PRODUCT;
    void global_affiliate_status;
    fetchSpy.mockImplementation(upstream({ detail: withoutStatus }));
    await expectUnavailable();

    resetSnapshotCache();
    const { member_affiliate_status, ...withoutMember } = PRODUCT;
    void member_affiliate_status;
    fetchSpy.mockImplementation(upstream({ detail: withoutMember }));
    await expectUnavailable();
  });

  it("rejects a product detail for a different product", async () => {
    // Otherwise one product's affiliate state gets attached to another.
    fetchSpy.mockImplementation(upstream({ detail: { ...PRODUCT, id: "prod_SOMEONE_ELSE" } }));
    await expectUnavailable();
  });

  it("rejects an app response with no account object", async () => {
    const byAppId: Env = {
      WHOP_API_ORIGIN: "https://api.whop.com",
      APP_ID: "app_1",
      CITY_SEED_SECRET: SECRET,
    };
    for (const app of [{}, { account: null }, { account: {} }, { account: { id: "" } }]) {
      resetSnapshotCache();
      fetchSpy.mockImplementation(async (input: unknown) =>
        String(input).includes("/apps/") ? json(app) : json({ data: [] }),
      );
      await expectUnavailable(byAppId);
    }
  });

  it("still treats a well-formed empty page as a live, genuinely empty business", async () => {
    // The distinction the validation must not destroy.
    fetchSpy.mockImplementation(async () => json({ data: [] }));
    const body = await read(LIVE_ENV);
    expect(body.freshness).toBe("live");
    for (const district of body.districts) {
      expect(district.state).toBe("dormant");
      expect(district.signal).toBe("unbuilt");
    }
  });
});

// ---------------------------------------------------------------------------
// Fixtures cannot exist in a deployable build.
// ---------------------------------------------------------------------------

describe("fixtures are a build-time capability, not a runtime flag", () => {
  const HOSTED_WITH_FIXTURES_INJECTED: Env = {
    CITY_FIXTURES: "1",
    // A hosted deployment that is also misconfigured: this is the combination
    // that used to publish an invented city as live.
    WHOP_API_ORIGIN: "https://api.whop.com",
    WHOP_ACCOUNT_ID: "biz_LIVE_ACCOUNT",
  };

  it("ignores CITY_FIXTURES when the build has no fixtures in it", () => {
    expect(isFixtureSource({ CITY_FIXTURES: "1" }, false)).toBe(false);
    expect(isFixtureSource({ CITY_FIXTURES: true }, false)).toBe(false);
    expect(resolveSource(HOSTED_WITH_FIXTURES_INJECTED, false)).toBe("none");
    expect(resolveSource({ CITY_FIXTURES: "1" }, false)).toBe("none");
  });

  it("honours CITY_FIXTURES only when the build has fixtures in it", () => {
    expect(isFixtureSource({ CITY_FIXTURES: "1" }, true)).toBe(true);
    expect(isFixtureSource({}, true)).toBe(false);
  });

  it("needs both: a fixture build without the binding is still not fixtures", () => {
    expect(resolveSource({}, true)).toBe("none");
  });

  it("a live-configured deployment is live regardless of the fixture flag", () => {
    expect(resolveSource({ ...LIVE_ENV, CITY_FIXTURES: "1" }, true)).toBe("live");
  });
});

describe("the scenario allowlist", () => {
  it("is closed and falls back silently", () => {
    for (const scenario of FIXTURE_SCENARIOS) expect(resolveScenario(scenario)).toBe(scenario);
    for (const bogus of ["", null, undefined, "../../etc/passwd", "<script>"]) {
      expect(resolveScenario(bogus)).toBe("balanced");
    }
  });
});

// ---------------------------------------------------------------------------
// The row schema: every field the snapshot consumes, or the read is refused.
// ---------------------------------------------------------------------------

describe("upstream rows are validated field by field", () => {
  const expectUnavailable = async (env: Env = LIVE_ENV) => {
    const body = await read(env);
    expect(body.freshness).toBe("unavailable");
    for (const district of body.districts) {
      expect(district.state).toBe("dormant");
      expect(district.signal).toBe("unreadable");
    }
  };

  const expectLive = async (env: Env = LIVE_ENV) => {
    const body = await read(env);
    expect(body.freshness).toBe("live");
    return body;
  };

  function upstream(overrides: { products?: unknown; plans?: unknown; detail?: unknown }) {
    const pick = (key: keyof typeof overrides, fallback: unknown) =>
      key in overrides ? overrides[key] : fallback;
    return async (input: unknown) => {
      const requested = String(input);
      if (requested.includes("/products/")) return json(pick("detail", PRODUCT));
      if (requested.includes("/products")) return json(pick("products", { data: [PRODUCT] }));
      if (requested.includes("/plans")) return json(pick("plans", { data: [PLAN] }));
      return json({});
    };
  }

  /** Serves one product row, everything else healthy. */
  const withProduct = (product: unknown) => upstream({ products: { data: [product] }, detail: product });
  /** Serves one plan row, everything else healthy. */
  const withPlan = (plan: unknown) => upstream({ plans: { data: [plan] } });

  const refusesProduct = async (label: string, product: unknown) => {
    resetSnapshotCache();
    fetchSpy.mockImplementation(withProduct(product));
    const body = await read(LIVE_ENV);
    expect(body.freshness, `${label} was accepted`).toBe("unavailable");
  };

  const refusesPlan = async (label: string, plan: unknown) => {
    resetSnapshotCache();
    fetchSpy.mockImplementation(withPlan(plan));
    const body = await read(LIVE_ENV);
    expect(body.freshness, `${label} was accepted`).toBe("unavailable");
  };

  it("refuses the id-only row from the audit", async () => {
    // The exact reported payload. It used to pass and render a live city out of
    // a product with no title, no visibility, no members and no date.
    fetchSpy.mockImplementation(upstream({ products: { data: [{ id: "prod_1" }] } }));
    await expectUnavailable();
  });

  it("refuses a product missing any field the snapshot reads", async () => {
    for (const key of ["id", "title", "visibility", "member_count", "created_at", "default_plan"]) {
      const { [key]: _dropped, ...without } = PRODUCT as Record<string, unknown>;
      void _dropped;
      await refusesProduct(`product without ${key}`, without);
    }
  });

  it("refuses a plan missing any field the snapshot reads", async () => {
    for (const key of ["id", "plan_type", "visibility", "created_at", "initial_price"]) {
      const { [key]: _dropped, ...without } = PLAN as Record<string, unknown>;
      void _dropped;
      await refusesPlan(`plan without ${key}`, without);
    }
  });

  it("refuses a non-numeric value where a quantity is read", async () => {
    // parseFloat would turn each of these into a number and the district state
    // would follow it.
    for (const memberCount of [{}, [], true, false, "many", "", "  ", "12 members", "NaN"]) {
      await refusesProduct(`member_count ${JSON.stringify(memberCount)}`, {
        ...PRODUCT,
        member_count: memberCount,
      });
    }
  });

  it("accepts a quantity in either representation the api uses", async () => {
    for (const memberCount of [12, 0, "12", "12.5", null]) {
      resetSnapshotCache();
      fetchSpy.mockImplementation(withProduct({ ...PRODUCT, member_count: memberCount }));
      const body = await read(LIVE_ENV);
      expect(body.freshness, `member_count ${JSON.stringify(memberCount)} was refused`).toBe("live");
    }
  });

  it("refuses a malformed date where a timestamp is read", async () => {
    for (const createdAt of ["", "not a date", "2026", "2026-13-45T99:99:99Z", 1767225600000, {}, true]) {
      await refusesProduct(`created_at ${JSON.stringify(createdAt)}`, {
        ...PRODUCT,
        created_at: createdAt,
      });
    }
  });

  it("accepts a well-formed timestamp or null", async () => {
    for (const createdAt of ["2026-01-01T00:00:00Z", "2026-01-01T00:00:00.123+02:00", null]) {
      resetSnapshotCache();
      fetchSpy.mockImplementation(withProduct({ ...PRODUCT, created_at: createdAt }));
      const body = await read(LIVE_ENV);
      expect(body.freshness, `created_at ${JSON.stringify(createdAt)} was refused`).toBe("live");
    }
  });

  it("refuses a wrong type where a nullable string is read", async () => {
    for (const key of ["title", "visibility"]) {
      for (const value of [7, true, {}, [], undefined]) {
        await refusesProduct(`${key} ${JSON.stringify(value)}`, { ...PRODUCT, [key]: value });
      }
    }
  });

  it("refuses a malformed default plan", async () => {
    for (const defaultPlan of [
      {},
      { id: "" },
      { id: 7, plan_type: null },
      { id: "plan_1" },
      { id: "plan_1", plan_type: 7 },
      "plan_1",
      [],
      true,
    ]) {
      await refusesProduct(`default_plan ${JSON.stringify(defaultPlan)}`, {
        ...PRODUCT,
        default_plan: defaultPlan,
      });
    }
  });

  it("accepts a well-formed default plan or null", async () => {
    for (const defaultPlan of [null, { id: "plan_1", plan_type: "renewal" }, { id: "plan_1", plan_type: null }]) {
      resetSnapshotCache();
      fetchSpy.mockImplementation(withProduct({ ...PRODUCT, default_plan: defaultPlan }));
      expect((await read(LIVE_ENV)).freshness).toBe("live");
    }
  });

  it("refuses a malformed initial price", async () => {
    for (const initialPrice of [
      {},
      { amount: "10.00" },
      { currency: "usd" },
      { amount: {}, currency: "usd" },
      { amount: "ten", currency: "usd" },
      { amount: "10.00", currency: 7 },
      "10.00",
      [],
      true,
    ]) {
      await refusesPlan(`initial_price ${JSON.stringify(initialPrice)}`, {
        ...PLAN,
        initial_price: initialPrice,
      });
    }
  });

  it("accepts a well-formed initial price or null", async () => {
    for (const initialPrice of [
      null,
      { amount: "10.00", currency: "usd" },
      { amount: 10, currency: null },
      { amount: null, currency: "usd" },
    ]) {
      resetSnapshotCache();
      fetchSpy.mockImplementation(withPlan({ ...PLAN, initial_price: initialPrice }));
      expect((await read(LIVE_ENV)).freshness).toBe("live");
    }
  });

  it("refuses a detail missing any affiliate field it exists to fetch", async () => {
    for (const key of [
      "global_affiliate_status",
      "global_affiliate_percentage",
      "member_affiliate_status",
    ]) {
      const { [key]: _dropped, ...without } = PRODUCT as Record<string, unknown>;
      void _dropped;
      resetSnapshotCache();
      fetchSpy.mockImplementation(upstream({ detail: without }));
      const body = await read(LIVE_ENV);
      expect(body.freshness, `detail without ${key} was accepted`).toBe("unavailable");
    }
  });

  it("refuses a detail whose affiliate fields are the wrong type", async () => {
    resetSnapshotCache();
    fetchSpy.mockImplementation(upstream({ detail: { ...PRODUCT, global_affiliate_status: 1 } }));
    expect((await read(LIVE_ENV)).freshness).toBe("unavailable");

    resetSnapshotCache();
    fetchSpy.mockImplementation(
      upstream({ detail: { ...PRODUCT, global_affiliate_percentage: "twenty" } }),
    );
    expect((await read(LIVE_ENV)).freshness).toBe("unavailable");
  });

  it("refuses a detail for a different product", async () => {
    resetSnapshotCache();
    fetchSpy.mockImplementation(upstream({ detail: { ...PRODUCT, id: "prod_SOMEONE_ELSE" } }));
    expect((await read(LIVE_ENV)).freshness).toBe("unavailable");
  });

  it("refuses the whole page when one row of many is malformed", async () => {
    // A partially-understood catalogue is not a smaller catalogue.
    resetSnapshotCache();
    fetchSpy.mockImplementation(
      upstream({ products: { data: [PRODUCT, { id: "prod_2" }, PRODUCT] } }),
    );
    expect((await read(LIVE_ENV)).freshness).toBe("unavailable");
  });

  it("keeps every nullable field nullable on a live read", async () => {
    const sparse = {
      ...PRODUCT,
      title: null,
      visibility: null,
      member_count: null,
      created_at: null,
      default_plan: null,
      global_affiliate_status: null,
      global_affiliate_percentage: null,
      member_affiliate_status: null,
    };
    resetSnapshotCache();
    fetchSpy.mockImplementation(
      upstream({
        products: { data: [sparse] },
        detail: sparse,
        plans: { data: [{ ...PLAN, plan_type: null, visibility: null, created_at: null, initial_price: null }] },
      }),
    );
    const body = await expectLive();
    // A real product nobody has bought, with nothing published about it.
    expect(body.districts.every((d: { state: string }) => d.state !== "healthy")).toBe(true);
  });

  it("keeps a well-formed empty page live and genuinely empty", async () => {
    resetSnapshotCache();
    fetchSpy.mockImplementation(async () => json({ data: [] }));
    const body = await expectLive();
    for (const district of body.districts) {
      expect(district.state).toBe("dormant");
      expect(district.signal).toBe("unbuilt");
    }
  });
});

// ---------------------------------------------------------------------------
// Timestamps: shape and calendar, not Date.parse.
// ---------------------------------------------------------------------------

describe("timestamps are calendar-strict", () => {
  function upstream(overrides: { products?: unknown; plans?: unknown; detail?: unknown }) {
    const pick = (key: keyof typeof overrides, fallback: unknown) =>
      key in overrides ? overrides[key] : fallback;
    return async (input: unknown) => {
      const requested = String(input);
      if (requested.includes("/products/")) return json(pick("detail", PRODUCT));
      if (requested.includes("/products")) return json(pick("products", { data: [PRODUCT] }));
      if (requested.includes("/plans")) return json(pick("plans", { data: [PLAN] }));
      return json({});
    };
  }

  /** The same timestamp on a product row, and separately on a plan row. */
  const freshnessFor = async (createdAt: unknown, row: "product" | "plan") => {
    resetSnapshotCache();
    fetchSpy.mockImplementation(
      row === "product"
        ? upstream({
            products: { data: [{ ...PRODUCT, created_at: createdAt }] },
            detail: { ...PRODUCT, created_at: createdAt },
          })
        : upstream({ plans: { data: [{ ...PLAN, created_at: createdAt }] } }),
    );
    return (await read(LIVE_ENV)).freshness;
  };

  const rejects = async (createdAt: unknown, why: string) => {
    for (const row of ["product", "plan"] as const) {
      expect(await freshnessFor(createdAt, row), `${row}: ${why} (${String(createdAt)})`).toBe(
        "unavailable",
      );
    }
  };

  const accepts = async (createdAt: unknown) => {
    for (const row of ["product", "plan"] as const) {
      expect(await freshnessFor(createdAt, row), `${row}: ${String(createdAt)} was refused`).toBe(
        "live",
      );
    }
  };

  it("rejects the dates javascript would roll over", async () => {
    // The audit's three. Date.parse accepts every one of them and hands back a
    // date in the following month, which then feeds the recency buckets.
    await rejects("2026-02-29T00:00:00Z", "2026 is not a leap year");
    await rejects("2026-02-30T00:00:00Z", "february never has 30 days");
    await rejects("2026-04-31T00:00:00Z", "april has 30 days");
  });

  it("knows which years february has 29 days in", async () => {
    await accepts("2024-02-29T00:00:00Z"); // divisible by 4
    await rejects("2025-02-29T00:00:00Z", "not a leap year");
    await accepts("2000-02-29T00:00:00Z"); // divisible by 400
    await rejects("1900-02-29T00:00:00Z", "divisible by 100 but not 400");
    await accepts("2024-02-28T00:00:00Z");
  });

  it("rejects an impossible month or day", async () => {
    await rejects("2026-00-10T00:00:00Z", "month 0");
    await rejects("2026-13-10T00:00:00Z", "month 13");
    await rejects("2026-01-00T00:00:00Z", "day 0");
    await rejects("2026-01-32T00:00:00Z", "january has 31 days");
    await rejects("2026-06-31T00:00:00Z", "june has 30 days");
    await rejects("2026-09-31T00:00:00Z", "september has 30 days");
    await rejects("2026-11-31T00:00:00Z", "november has 30 days");
  });

  it("accepts the last day of every month", async () => {
    for (const [month, day] of [
      ["01", "31"], ["02", "28"], ["03", "31"], ["04", "30"], ["05", "31"], ["06", "30"],
      ["07", "31"], ["08", "31"], ["09", "30"], ["10", "31"], ["11", "30"], ["12", "31"],
    ]) {
      expect(
        await freshnessFor(`2026-${month}-${day}T12:00:00Z`, "product"),
        `2026-${month}-${day} was refused`,
      ).toBe("live");
    }
  });

  it("rejects an impossible time of day", async () => {
    await rejects("2026-01-01T24:00:00Z", "hour 24");
    await rejects("2026-01-01T99:00:00Z", "hour 99");
    await rejects("2026-01-01T00:60:00Z", "minute 60");
    await rejects("2026-01-01T00:00:60Z", "second 60");
    await rejects("2026-01-01T00:00:99Z", "second 99");
  });

  it("accepts the edges of a valid time of day", async () => {
    await accepts("2026-01-01T00:00:00Z");
    await accepts("2026-01-01T23:59:59Z");
  });

  it("rejects a malformed or out-of-range offset", async () => {
    await rejects("2026-01-01T00:00:00", "no offset at all");
    await rejects("2026-01-01T00:00:00+24:00", "offset hour 24");
    await rejects("2026-01-01T00:00:00+00:60", "offset minute 60");
    await rejects("2026-01-01T00:00:00+0100", "offset without a colon");
    await rejects("2026-01-01T00:00:00+1:00", "one-digit offset hour");
    await rejects("2026-01-01T00:00:00 Z", "space before the offset");
  });

  it("accepts utc and explicit offsets", async () => {
    await accepts("2026-01-01T00:00:00Z");
    await accepts("2026-01-01T00:00:00z");
    await accepts("2026-01-01T00:00:00+00:00");
    await accepts("2026-06-15T09:30:00-07:00");
    await accepts("2026-06-15T09:30:00+23:59");
  });

  it("accepts fractional seconds only where they are well formed", async () => {
    await accepts("2026-01-01T00:00:00.1Z");
    await accepts("2026-01-01T00:00:00.123Z");
    await accepts("2026-01-01T00:00:00.123456+02:00");
    await rejects("2026-01-01T00:00:00.Z", "a dot with no digits");
    await rejects("2026-01-01T00:00:00,123Z", "a comma instead of a dot");
  });

  it("still accepts a genuinely null created_at", async () => {
    await accepts(null);
  });

  it("still refuses a non-string created_at", async () => {
    await rejects(1767225600000, "an epoch number");
    await rejects({}, "an object");
    await rejects("", "an empty string");
    await rejects("2026", "a bare year");
    await rejects("2026-01-01", "a date with no time");
  });

  it("keeps a well-formed empty page live", async () => {
    resetSnapshotCache();
    fetchSpy.mockImplementation(async () => json({ data: [] }));
    expect((await read(LIVE_ENV)).freshness).toBe("live");
  });
});

describe("the deployment's bindings are the ones the runtime actually sets", () => {
  it("reads the public API when no origin is named", () => {
    // Hosted Whop does not inject WHOP_API_ORIGIN — measured, and written down
    // in docs/website-auth-spike.md. Requiring it meant every deployed City
    // failed closed and no business was ever read.
    expect(apiOrigin({})).toBe("https://api.whop.com");
    expect(apiOrigin({ WHOP_API_ORIGIN: "" })).toBe("https://api.whop.com");
  });

  it("still honours an override, and still refuses a bad one", () => {
    expect(apiOrigin({ WHOP_API_ORIGIN: "https://api.eu.whop.com" })).toBe("https://api.eu.whop.com");
    for (const bad of [
      "https://api.whop.com.evil.example",
      "http://api.whop.com",
      "https://notwhop.com",
      "https://user:pass@api.whop.com",
      "https://api.whop.com/v1",
      "https://api.whop.com/?x=1",
      "not a url",
    ]) {
      expect(apiOrigin({ WHOP_API_ORIGIN: bad }), bad).toBeNull();
    }
  });

  it("finds the app under either name the runtime might use", () => {
    expect(boundAppId({ WHOP_APP_ID: "app_hosted" })).toBe("app_hosted");
    expect(boundAppId({ APP_ID: "app_local" })).toBe("app_local");
    // Hosted wins, so a stale local value cannot point a deployment elsewhere.
    expect(boundAppId({ WHOP_APP_ID: "app_hosted", APP_ID: "app_local" })).toBe("app_hosted");
    expect(boundAppId({})).toBeNull();
    expect(boundAppId({ WHOP_APP_ID: "" })).toBeNull();
  });

  it("still refuses to go live without a usable seed secret", () => {
    // The widening is in the origin only. A deployment that can reach the API
    // but cannot key its layout seed is still not a live source.
    expect(isLiveSource({ WHOP_APP_ID: "app_1" })).toBe(false);
    expect(isLiveSource({ WHOP_APP_ID: "app_1", CITY_SEED_SECRET: "short" })).toBe(false);
    expect(
      isLiveSource({ WHOP_APP_ID: "app_1", CITY_SEED_SECRET: "vI8IN_Yo_zJMdil3-QzndMH0Xua7PP_TpwxN7DHaYGM" }),
    ).toBe(true);
  });
});

describe("a plan's price, in the shape the live API actually sends", () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    id: "plan_1",
    plan_type: "one_time",
    visibility: "visible",
    created_at: "2026-09-03T12:04:29.963Z",
    initial_price: 0,
    ...over,
  });

  it("accepts a plain number, which is what a real business returns", () => {
    // The validator originally required an { amount, currency } object. Nobody
    // had ever received one: the first deployment read a real business, every
    // plan failed this check, and the city fell back to unavailable.
    expect(isWhopPlan(plan({ initial_price: 0 }))).toBe(true);
    expect(isWhopPlan(plan({ initial_price: 29.99 }))).toBe(true);
  });

  it("still accepts the object form, and an absent price", () => {
    expect(isWhopPlan(plan({ initial_price: { amount: 2999, currency: "usd" } }))).toBe(true);
    expect(isWhopPlan(plan({ initial_price: null }))).toBe(true);
  });

  it("rejects a price that is not a price", () => {
    for (const bad of ["29.99", Number.NaN, Number.POSITIVE_INFINITY, -1, [], true]) {
      expect(isWhopPlan(plan({ initial_price: bad })), String(bad)).toBe(false);
    }
  });
});
