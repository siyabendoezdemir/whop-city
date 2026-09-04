import { expect, test } from "@playwright/test";

/**
 * What the browser is allowed to know.
 *
 * These tests watch the wire rather than the DOM: every request the page makes
 * and every response it receives is recorded, and then the whole lot is checked
 * for the classes of data that must never leave the server.
 */

const ALLOWED_ENDPOINT = "/api/city/snapshot";

/** Everything the projection is forbidden to carry, as it would appear in JSON. */
const FORBIDDEN_JSON_KEYS = [
  "accountId",
  "account_id",
  "businessId",
  "business_id",
  "productId",
  "product_id",
  "planId",
  "plan_id",
  "title",
  "price",
  "amount",
  "revenue",
  "memberCount",
  "member_count",
  "customer",
  "email",
  "capturedAt",
  "captured_at",
  "createdAt",
  "created_at",
  "timestamp",
  "apiKey",
  "authorization",
  "token",
];

/**
 * The HTML subset.
 *
 * Bare English words are useless here — the document legitimately contains a
 * <title> element — so this is limited to field names that only appear when
 * structured business data has been embedded, plus the id and credential
 * patterns checked separately below.
 */
const FORBIDDEN_HTML_KEYS = [
  "accountid",
  "account_id",
  "businessid",
  "business_id",
  "productid",
  "product_id",
  "planid",
  "plan_id",
  "membercount",
  "member_count",
  "capturedat",
  "captured_at",
  "createdat",
  "created_at",
  "priceminorunits",
  "affiliatepercentage",
  "apikey",
  "whop_api",
  "authorization",
];

type Seen = { url: string; method: string; body: string };

async function loadCity(page: import("@playwright/test").Page, query = "") {
  const requests: { url: string; method: string }[] = [];
  const responses: Seen[] = [];

  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/")) return;
    responses.push({
      url,
      method: response.request().method(),
      body: await response.text().catch(() => ""),
    });
  });

  await page.goto(`/${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 120_000 });

  return { requests, responses };
}

test("the browser calls exactly one API endpoint, with GET", async ({ page }) => {
  const { requests } = await loadCity(page);

  const api = requests.filter((request) => new URL(request.url).pathname.startsWith("/api/"));
  expect(api.length).toBeGreaterThan(0);

  for (const request of api) {
    expect(new URL(request.url).pathname).toBe(ALLOWED_ENDPOINT);
    expect(request.method).toBe("GET");
  }
  // One reading per load; nothing polls.
  expect(api).toHaveLength(1);
});

test("the browser talks only to its own origin", async ({ page }) => {
  const { requests } = await loadCity(page);
  const base = new URL(page.url()).origin;

  for (const request of requests) {
    const url = new URL(request.url);
    if (url.protocol === "data:" || url.protocol === "blob:") continue;
    expect(url.origin, `${request.url} is off-origin`).toBe(base);
  }
  // Specifically: the page never reaches Whop itself.
  expect(requests.some((request) => request.url.includes("whop.com"))).toBe(false);
});

test("only the safe projection reaches the client", async ({ page }) => {
  const { responses } = await loadCity(page);

  const snapshot = responses.find((response) => response.url.includes(ALLOWED_ENDPOINT));
  expect(snapshot, "no snapshot response observed").toBeTruthy();

  const body = JSON.parse(snapshot!.body);
  expect(Object.keys(body).sort()).toEqual(["districts", "freshness", "schema", "seed"]);
  expect(body.schema).toBe("whop-city.public.v2");

  for (const district of body.districts) {
    expect(Object.keys(district).sort()).toEqual([
      "direction",
      "id",
      "parcels",
      "signal",
      "state",
      "variant",
    ]);
  }

  const raw = snapshot!.body.toLowerCase();
  for (const key of FORBIDDEN_JSON_KEYS) {
    expect(raw, `snapshot carries "${key}"`).not.toContain(key.toLowerCase());
  }
});

test("the served HTML carries no business data", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  const html = (await response!.text()).toLowerCase();

  for (const key of FORBIDDEN_HTML_KEYS) {
    expect(html, `HTML carries "${key}"`).not.toContain(key);
  }
  // No Whop object ids and no credential-shaped material.
  expect(html).not.toMatch(/\bbiz_[a-z0-9]/i);
  expect(html).not.toMatch(/\bprod_[a-z0-9]/i);
  expect(html).not.toMatch(/\bplan_[a-z0-9]/i);
  expect(html).not.toMatch(/\bapp_[a-z0-9]{6}/i);
});

test("the seed on the wire is opaque and carries no identifier", async ({ page }) => {
  const { responses } = await loadCity(page);
  const body = JSON.parse(responses.find((r) => r.url.includes(ALLOWED_ENDPOINT))!.body);

  expect(body.seed).toMatch(/^[0-9a-f]{16}$/);
  expect(body.seed).not.toContain("biz");
  expect(body.seed).not.toContain("fixture");
});

test("a caller cannot steer the endpoint anywhere", async ({ request, baseURL }) => {
  // The one endpoint refuses everything but GET.
  for (const method of ["post", "put", "patch", "delete"] as const) {
    const response = await request[method](`${baseURL}${ALLOWED_ENDPOINT}`);
    expect(response.status(), `${method} was accepted`).toBe(405);
  }

  // Neighbouring API paths do not exist: there is no dispatcher to walk. The
  // match is a pathname equality check, so case matters too.
  for (const path of ["/api/city", "/api/city/snapshot/extra", "/api/whop", "/API/CITY/SNAPSHOT"]) {
    const response = await request.get(`${baseURL}${path}`, { maxRedirects: 0 });
    expect([404, 405], `${path} answered ${response.status()}`).toContain(response.status());
  }

  // Two spellings resolve to the canonical path rather than to a second
  // endpoint: a trailing slash redirects, and a traversal normalises. Both then
  // answer with the same safe projection and nothing more, so asserting 404
  // here would be asserting the wrong thing.
  const trailing = await request.get(`${baseURL}${ALLOWED_ENDPOINT}/`, { maxRedirects: 0 });
  expect(trailing.status()).toBe(307);
  expect(new URL(trailing.headers().location, baseURL).pathname).toBe(ALLOWED_ENDPOINT);

  const traversed = await request.get(`${baseURL}/api/city/../city/snapshot`);
  expect(traversed.status()).toBe(200);
  expect(Object.keys(await traversed.json()).sort()).toEqual([
    "districts",
    "freshness",
    "schema",
    "seed",
  ]);
});
