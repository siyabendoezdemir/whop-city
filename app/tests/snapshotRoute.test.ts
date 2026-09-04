import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SNAPSHOT_METHOD, SNAPSHOT_PATH, handleSnapshotRequest } from "../src/server/snapshotRoute";
import type { Env } from "../src/server/whop-client";

const ORIGIN = "https://city-spike.whop.site";
const url = (query = "") => `${ORIGIN}${SNAPSHOT_PATH}${query}`;

/** No bindings: the local and fixture-backed case. */
const FIXTURE_ENV: Env = {};

/** What a hosted deployment looks like. */
const LIVE_ENV: Env = {
  WHOP_API_ORIGIN: "https://api.whop.com",
  WHOP_ACCOUNT_ID: "biz_LIVE_ACCOUNT",
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the snapshot endpoint", () => {
  it("is a single fixed same-origin path", () => {
    expect(SNAPSHOT_PATH).toBe("/api/city/snapshot");
    expect(SNAPSHOT_METHOD).toBe("GET");
  });

  it("answers GET with the safe projection", async () => {
    const response = await handleSnapshotRequest(new Request(url()), FIXTURE_ENV);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["districts", "freshness", "schema", "seed"]);
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

  it("ignores caller input entirely when reading live", async () => {
    // Everything a caller could try to smuggle: a different account, another
    // origin, a path, a method override, a body.
    const hostile = url(
      "?account_id=biz_ATTACKER" +
        "&url=https%3A%2F%2Fevil.example%2Fsteal" +
        "&scenario=struggling" +
        "&method=DELETE" +
        "&path=%2Fapi%2Fv1%2Fpayments",
    );

    await handleSnapshotRequest(
      new Request(hostile, { headers: { "x-whop-account-id": "biz_ATTACKER" } }),
      LIVE_ENV,
    );

    expect(fetchSpy).toHaveBeenCalled();
    for (const call of fetchSpy.mock.calls) {
      const requested = String(call[0]);
      const init = (call[1] ?? {}) as RequestInit;

      // Only this app's own read endpoints, on the bound origin.
      expect(requested.startsWith("https://api.whop.com/api/v1/")).toBe(true);
      expect(requested).toMatch(/^https:\/\/api\.whop\.com\/api\/v1\/(products|plans|apps)/);

      // The caller's account never reaches the wire; the bound one does.
      expect(requested).not.toContain("biz_ATTACKER");
      expect(requested).not.toContain("evil.example");
      expect(requested).not.toContain("payments");

      // Reads only, and nothing caller-shaped attached.
      expect(init.method ?? "GET").toBe("GET");
      expect(init.body ?? null).toBeNull();
    }
  });

  it("uses the bound account and not one supplied by the caller", async () => {
    await handleSnapshotRequest(new Request(url("?account_id=biz_ATTACKER")), LIVE_ENV);
    const accountScoped = fetchSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((requested) => requested.includes("account_id="));
    expect(accountScoped.length).toBeGreaterThan(0);
    for (const requested of accountScoped) {
      expect(requested).toContain(encodeURIComponent("biz_LIVE_ACCOUNT"));
    }
  });

  it("honours the fixture scenario only when there is no live binding", async () => {
    const fixture = await (
      await handleSnapshotRequest(new Request(url("?scenario=unavailable")), FIXTURE_ENV)
    ).json();
    expect(fixture.freshness).toBe("unavailable");

    // Same parameter, live deployment: the query string is not consulted, so
    // the result reflects the (stubbed, empty) upstream rather than the fixture.
    const live = await (
      await handleSnapshotRequest(new Request(url("?scenario=unavailable")), LIVE_ENV)
    ).json();
    expect(live.freshness).toBe("live");
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

  it("reveals nothing when the upstream throws", async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:443 while reading biz_LIVE_ACCOUNT");
    });

    const response = await handleSnapshotRequest(new Request(url()), LIVE_ENV);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("10.0.0.5");
    expect(text).not.toContain("biz_LIVE_ACCOUNT");
  });

  it("does not read from an origin outside whop.com", async () => {
    await handleSnapshotRequest(new Request(url()), {
      WHOP_API_ORIGIN: "https://evil.example",
      WHOP_ACCOUNT_ID: "biz_LIVE_ACCOUNT",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not read over plain http", async () => {
    await handleSnapshotRequest(new Request(url()), {
      WHOP_API_ORIGIN: "http://api.whop.com",
      WHOP_ACCOUNT_ID: "biz_LIVE_ACCOUNT",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
