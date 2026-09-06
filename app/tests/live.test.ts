import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ZERO_METRICS, type CityMetrics } from "../src/city/projection";
import {
  ago,
  amount,
  freshSales,
  headline,
  mergeFeed,
  movements,
  parseLive,
  type Dispatch,
  type Sale,
} from "../src/game/live";
import { LIVE_PATH, handleLiveRequest } from "../src/server/liveRoute";
import { digest, toSale } from "../src/server/sales";
import { resetSnapshotCache } from "../src/server/snapshotCache";
import { mintSession } from "../src/server/session";

const owner: CityMetrics = {
  ...ZERO_METRICS,
  source: "owner",
  gold: 6_200,
  citizens: 130,
  traffic: 340,
  recurring: 3_100,
};

const sale = (over: Partial<Sale> = {}): Sale => ({
  key: "k1",
  cents: 4_900,
  at: 1_000,
  kind: "first",
  product: "Pro monthly",
  ...over,
});

// ---------------------------------------------------------------------------
// Turning a payment into a feed line
// ---------------------------------------------------------------------------

describe("reading a payment", () => {
  const now = Date.parse("2026-09-06T12:00:00Z");
  const row = {
    id: "pay_ABC123",
    usd_total: 49,
    paid_at: "2026-09-06T11:30:00Z",
    billing_reason: "subscription_create",
    product: { title: "Pro monthly" },
  };

  it("keeps the amount, the time, the kind and the product", () => {
    const read = toSale(row, now)!;
    expect(read.cents).toBe(4_900);
    expect(read.at).toBe(Date.parse("2026-09-06T11:30:00Z"));
    expect(read.kind).toBe("first");
    expect(read.product).toBe("Pro monthly");
  });

  it("carries no buyer, and no upstream identifier", () => {
    const read = toSale(
      {
        ...row,
        member: { id: "mem_9", email: "buyer@example.com", name: "A Buyer" },
        user: { id: "user_9", username: "buyer" },
        membership: { id: "mem_9" },
      },
      now,
    )!;
    const serialised = JSON.stringify(read);
    for (const secret of ["buyer@example.com", "A Buyer", "mem_9", "user_9", "pay_ABC123"]) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret);
    }
    expect(Object.keys(read).sort()).toEqual(["at", "cents", "key", "kind", "product"]);
  });

  it("tells a renewal from a first purchase", () => {
    expect(toSale({ ...row, billing_reason: "subscription_cycle" }, now)!.kind).toBe("renewal");
    expect(toSale({ ...row, billing_reason: "renewal" }, now)!.kind).toBe("renewal");
    // One word apart from a renewal and the opposite thing: this is somebody
    // signing up, and calling it a renewal is calling a win a retention.
    expect(toSale({ ...row, billing_reason: "subscription_create" }, now)!.kind).toBe("first");
    expect(toSale({ ...row, billing_reason: "one_time" }, now)!.kind).toBe("first");
  });

  it("drops a row it cannot honestly describe", () => {
    expect(toSale({ ...row, usd_total: 0 }, now)).toBeNull();
    expect(toSale({ ...row, usd_total: undefined, total: undefined }, now)).toBeNull();
    expect(toSale({ ...row, paid_at: undefined, created_at: undefined }, now)).toBeNull();
    expect(toSale({ ...row, id: undefined }, now)).toBeNull();
    expect(toSale("nonsense", now)).toBeNull();
  });

  it("ignores a payment dated in the future or older than the window", () => {
    expect(toSale({ ...row, paid_at: "2026-09-08T00:00:00Z" }, now)).toBeNull();
    expect(toSale({ ...row, paid_at: "2026-09-01T00:00:00Z" }, now)).toBeNull();
  });

  it("accepts epoch seconds as well as an ISO string", () => {
    const read = toSale({ ...row, paid_at: (now - 60_000) / 1000 }, now)!;
    expect(read.at).toBe(now - 60_000);
  });

  it("gives the same id the same key, and different ids different keys", () => {
    expect(digest("pay_1")).toBe(digest("pay_1"));
    expect(digest("pay_1")).not.toBe(digest("pay_2"));
  });
});

// ---------------------------------------------------------------------------
// What counts as news
// ---------------------------------------------------------------------------

describe("the feed", () => {
  it("only reports sales it has not reported before", () => {
    const seen = new Set(["k1"]);
    const fresh = freshSales([sale(), sale({ key: "k2", at: 2_000 })], seen);
    expect(fresh.map((s) => s.key)).toEqual(["k2"]);
  });

  it("reports members gained and never members lost", () => {
    expect(movements(owner, { ...owner, citizens: 133 }, 10)).toEqual([
      { id: "member-10", at: 10, kind: "member", gained: 3 },
    ]);
    expect(movements(owner, { ...owner, citizens: 120 }, 10)).toEqual([]);
  });

  it("reports visitors only when the day's count crosses a hundred", () => {
    expect(movements(owner, { ...owner, traffic: 380 }, 10)).toEqual([]);
    const crossed = movements(owner, { ...owner, traffic: 402 }, 10);
    expect(crossed.map((entry) => entry.kind)).toEqual(["visitors"]);
  });

  it("says nothing at all about a business it is not entitled to", () => {
    expect(movements(ZERO_METRICS, { ...ZERO_METRICS, citizens: 99 }, 10)).toEqual([]);
    expect(movements(owner, { ...ZERO_METRICS, citizens: 99 }, 10)).toEqual([]);
  });

  it("does not report revenue as well as the sales that made it", () => {
    const kinds = movements(owner, { ...owner, gold: owner.gold + 500 }, 10).map((e) => e.kind);
    expect(kinds).not.toContain("revenue");
  });

  it("deduplicates, sorts newest first and forgets yesterday", () => {
    const now = 10_000_000;
    const line = (id: string, at: number): Dispatch => ({
      id,
      at,
      kind: "member",
      gained: 1,
    });
    const merged = mergeFeed(
      [line("a", now - 1000), line("old", now - 25 * 60 * 60 * 1000)],
      [line("b", now), line("a", now - 1000)],
      now,
    );
    expect(merged.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("says what happened in one line", () => {
    expect(headline({ id: "1", at: 0, kind: "sale", sale: sale() })).toBe("$49 sale");
    expect(headline({ id: "1", at: 0, kind: "sale", sale: sale({ kind: "renewal" }) })).toBe(
      "$49 renewed",
    );
    expect(headline({ id: "1", at: 0, kind: "member", gained: 1 })).toBe("New member");
    expect(headline({ id: "1", at: 0, kind: "member", gained: 4 })).toBe("4 new members");
  });

  it("writes money and time the short way", () => {
    expect(amount(4_900)).toBe("$49");
    expect(amount(4_950)).toBe("$49.50");
    expect(amount(250_000)).toBe("$2.5k");
    expect(amount(4_800_000)).toBe("$48k");
    expect(ago(1_000, 2_000)).toBe("just now");
    expect(ago(0, 5 * 60_000)).toBe("5m ago");
    expect(ago(0, 3 * 60 * 60_000)).toBe("3h ago");
  });

  it("refuses a reply that is not a live one", () => {
    expect(parseLive({ live: false })).toEqual({ live: false });
    expect(parseLive(null)).toEqual({ live: false });
    expect(parseLive({ live: true, sales: "nope" }).sales).toBeUndefined();
    expect(parseLive({ live: true, sales: [{ key: 1 }] }).sales).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------

const SECRET = "a-test-secret-that-is-long-enough-to-be-usable";
const ACCOUNT = "biz_xPy7WHYB7QGju5";

const signedIn = async () =>
  `city_session=${encodeURIComponent(await mintSession("user_real", ACCOUNT, SECRET))}`;

function request(cookie?: string): Request {
  return new Request(`https://city.example${LIVE_PATH}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("GET /api/city/live", () => {
  beforeEach(() => resetSnapshotCache());
  afterEach(() => vi.unstubAllGlobals());

  it("tells a visitor to a live deployment nothing, and reads nothing to do it", async () => {
    // A live deployment: an API origin and a usable seed key. Anything that
    // reached upstream would show up here as a call.
    const fetches: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      fetches.push(String(input));
      return new Response("{}", { status: 200 });
    });

    const response = await handleLiveRequest(request(), {
      WHOP_API_ORIGIN: "https://api.whop.com",
      CITY_SEED_SECRET: SECRET,
      CITY_SESSION_SECRET: SECRET,
      WHOP_ACCOUNT_ID: ACCOUNT,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ live: false });
    expect(fetches, "a visitor cost the business an upstream read").toEqual([]);
  });

  it("refuses a session signed with somebody else's secret", async () => {
    const forged = `city_session=${encodeURIComponent(
      await mintSession("user_real", ACCOUNT, "a-completely-different-secret-value"),
    )}`;
    const response = await handleLiveRequest(request(forged), {
      WHOP_API_ORIGIN: "https://api.whop.com",
      CITY_SEED_SECRET: SECRET,
      CITY_SESSION_SECRET: SECRET,
      WHOP_ACCOUNT_ID: ACCOUNT,
    });
    expect(await response.json()).toEqual({ live: false });
  });

  it("never lets a shared cache hold one business's takings", async () => {
    const response = await handleLiveRequest(request(), { CITY_FIXTURES: "true" });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("refuses anything but a GET", async () => {
    const response = await handleLiveRequest(
      new Request(`https://city.example${LIVE_PATH}`, { method: "POST" }),
      {},
    );
    expect(response.status).toBe(405);
  });

  it("gives an owner the figures and the sales behind them", async () => {
    const env = {
      CITY_FIXTURES: "true",
      CITY_SESSION_SECRET: SECRET,
      WHOP_ACCOUNT_ID: ACCOUNT,
    };
    const response = await handleLiveRequest(
      new Request(`https://city.example${LIVE_PATH}?scenario=thriving`, {
        headers: { cookie: await signedIn() },
      }),
      env,
    );
    const body = await response.json();
    expect(body.live).toBe(true);
    expect(body.metrics.source).toBe("owner");
    expect(body.metrics.gold).toBeGreaterThan(0);
    expect(body.sales.length).toBeGreaterThan(0);
    for (const entry of body.sales) {
      expect(Object.keys(entry).sort()).toEqual(["at", "cents", "key", "kind", "product"]);
    }
  });

  it("leaves the sales out rather than claiming there were none", async () => {
    const env = {
      CITY_FIXTURES: "true",
      CITY_SESSION_SECRET: SECRET,
      WHOP_ACCOUNT_ID: ACCOUNT,
    };
    const response = await handleLiveRequest(
      new Request(`https://city.example${LIVE_PATH}?scenario=unavailable`, {
        headers: { cookie: await signedIn() },
      }),
      env,
    );
    const body = await response.json();
    expect(body.live).toBe(true);
    expect("sales" in body).toBe(false);
  });
});
