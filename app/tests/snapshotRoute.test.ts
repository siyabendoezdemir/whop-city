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
    expect(Object.keys(body).sort()).toEqual(["districts", "freshness", "schema", "seed"]);
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
