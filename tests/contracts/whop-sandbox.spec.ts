/**
 * Whop capability contract — Task 1.
 *
 * Three layers, so the suite is useful whether or not credentials exist:
 *
 *   1. Offline. Always runs. Checks the capability manifest against a committed
 *      extract of Whop's OpenAPI documents, and checks the probe's own safety
 *      behaviour (version pin, redaction, idempotency, null-vs-zero).
 *   2. Live unauthenticated. `WHOP_LIVE_UNAUTH=1`. Needs network, no secrets.
 *      Confirms the version-pin contract and that every protected operation
 *      refuses an anonymous caller.
 *   3. Live sandbox. `WHOP_LIVE_SANDBOX=1` plus credentials. Runs the real
 *      capability sweep and the one permitted write against the dedicated test
 *      business, and proves a replayed intent does not create a second product.
 */

import { describe, expect, it } from "vitest";

import openApiScopes from "../fixtures/whop-openapi-scopes.json" with { type: "json" };
import {
  CAPABILITY_MANIFEST,
  CITY_OIDC_SCOPES,
  CITY_REQUESTED_SCOPES,
  CITY_WEBHOOK_EVENTS,
  WHOP_API_VERSION_PIN,
  WHOP_PRODUCTION_BASE_URL,
  WHOP_SANDBOX_BASE_URL,
} from "../../packages/whop-client/src/capability-manifest.ts";
import {
  buildIdempotencyKey,
  classifyStatus,
  createFetchTransport,
  normalizeBusinessSnapshot,
  WhopCapabilityProbe,
  type DraftOfferIntent,
  type ProbeRequest,
  type ProbeResponse,
  type ProbeTransport,
} from "../../packages/whop-client/src/capability-probe.ts";
import {
  assertNoCredentialLeak,
  pseudonymizeId,
  redact,
  redactHeaders,
  REDACTED,
} from "../../packages/whop-client/src/redaction.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RecordedCall {
  request: ProbeRequest;
}

function recordingTransport(
  handler: (request: ProbeRequest) => ProbeResponse,
): { transport: ProbeTransport; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const transport: ProbeTransport = async (request) => {
    calls.push({ request });
    return handler(request);
  };
  return { transport, calls };
}

const ok = (body: unknown): ProbeResponse => ({ status: 200, headers: {}, body });

/**
 * Fake credentials, assembled at runtime so no literal in this file matches a
 * secret scanner. They must still have the shape of the real thing, because
 * that shape is exactly what the redaction assertions exercise.
 */
const FAKE = {
  token: ["whop", "live", "abcdefghijklmnopqrstuvwxyz012345"].join("_"),
  webhookSecret: ["ws", "0123456789abcdef0123456789abcdef"].join("_"),
};

const TEST_TOKEN = FAKE.token;

type SecurityAlternative = { auth: "bearer" | "none"; scopes: string[] };
const specOperations = openApiScopes.operations as Record<
  string,
  { surface: string; security: SecurityAlternative[] }
>;

// ---------------------------------------------------------------------------
// 1. Offline: manifest agrees with Whop's published spec
// ---------------------------------------------------------------------------

describe("capability manifest matches Whop's OpenAPI security", () => {
  it("pins the API version the spec advertises", () => {
    expect(WHOP_API_VERSION_PIN).toBe(openApiScopes.apiVersionDate);
  });

  it("uses the base URLs the spec declares", () => {
    const urls = openApiScopes.servers.map((s) => s.url);
    expect(urls).toContain(WHOP_PRODUCTION_BASE_URL);
    expect(urls).toContain(WHOP_SANDBOX_BASE_URL);
  });

  const probeable = CAPABILITY_MANIFEST.filter((c) => c.surface !== "oauth");

  it.each(probeable.map((c) => [`${c.method} ${c.path}`, c] as const))(
    "%s declares the least scope the spec allows",
    (key, capability) => {
      const spec = specOperations[key];
      expect(spec, `${key} is not tracked in the OpenAPI fixture`).toBeDefined();

      const alternatives = spec!.security;
      // `security: []` on an operation means the spec marks it fully public.
      if (alternatives.length === 0) {
        expect(capability.requiredScopes).toEqual([]);
        return;
      }

      const declared = [...capability.requiredScopes].sort();
      const bearerAlternatives = alternatives.filter((a) => a.auth === "bearer");
      const matches = bearerAlternatives.some(
        (a) => JSON.stringify(a.scopes) === JSON.stringify(declared),
      );
      expect(
        matches,
        `${key}: manifest declares [${declared.join(", ")}] but the spec offers ${JSON.stringify(
          bearerAlternatives.map((a) => a.scopes),
        )}`,
      ).toBe(true);

      // Where the spec offers a cheaper alternative, the manifest must take it.
      const cheapest = bearerAlternatives.reduce(
        (min, a) => (a.scopes.length < min.scopes.length ? a : min),
        bearerAlternatives[0]!,
      );
      expect(
        declared.length,
        `${key}: spec allows [${cheapest.scopes.join(", ")}], which is cheaper`,
      ).toBe(cheapest.scopes.length);
    },
  );

  it("requests no scope outside the manifest", () => {
    const fromManifest = new Set(
      CAPABILITY_MANIFEST.filter((c) => c.surface !== "oauth").flatMap((c) => c.requiredScopes),
    );
    for (const scope of CITY_REQUESTED_SCOPES) expect(fromManifest.has(scope)).toBe(true);
  });

  it("never requests scopes v1 has no use for", () => {
    // Money movement, contact details, and balances are explicit v1 non-goals.
    const forbidden = [
      "payment:charge",
      "payment:manage",
      "member:email:read",
      "member:phone:read",
      "membership:cancel",
      "company:balance:read",
      "payout:account:read",
      "access_pass:delete",
      "affiliate:create",
    ];
    for (const scope of forbidden) expect(CITY_REQUESTED_SCOPES).not.toContain(scope);
  });

  it("does not request the OIDC email scope", () => {
    expect(CITY_OIDC_SCOPES).not.toContain("email");
  });

  it("creates the draft offer with a visibility value Whop accepts", () => {
    // City sends `hidden`. If Whop renames or drops it, this fails here rather
    // than at the moment a player confirms a real write.
    expect(openApiScopes.productVisibilityValues).toContain("hidden");
    expect(draftIntent().visibility).toBe("hidden");
  });

  it("subscribes only to events Whop publishes", () => {
    // Affiliate activity has no event; nothing in the list may imply otherwise.
    expect(CITY_WEBHOOK_EVENTS.some((event) => event.startsWith("affiliate."))).toBe(false);
    for (const event of CITY_WEBHOOK_EVENTS) expect(event).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });
});

// ---------------------------------------------------------------------------
// 2. Offline: probe safety behaviour
// ---------------------------------------------------------------------------

describe("probe sends a pinned, credential-bearing request", () => {
  it("pins the API version on every request", async () => {
    const { transport, calls } = recordingTransport(() => ok({ data: [] }));
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      transport,
    });

    await probe.run();

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.request.headers["api-version-date"]).toBe(WHOP_API_VERSION_PIN);
      expect(call.request.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);
    }
  });

  it("targets the sandbox host when configured to", async () => {
    const { transport, calls } = recordingTransport(() => ok({ data: [] }));
    const probe = new WhopCapabilityProbe({
      baseUrl: WHOP_SANDBOX_BASE_URL,
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      transport,
    });

    await probe.probeCapability(CAPABILITY_MANIFEST.find((c) => c.id === "business.list")!);

    expect(calls[0]!.request.url.startsWith(WHOP_SANDBOX_BASE_URL)).toBe(true);
  });

  it("never puts the credential in recorded evidence", async () => {
    const { transport } = recordingTransport(() =>
      ok({ data: [{ id: "biz_realid123", title: "Real Business", email: "seller@example.com" }] }),
    );
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      transport,
    });

    const report = await probe.run();
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(TEST_TOKEN);
    expect(serialized).not.toContain("seller@example.com");
    expect(serialized).not.toContain("biz_realid123");
  });

  it("makes no network call and skips everything without a credential", async () => {
    const { transport, calls } = recordingTransport(() => ok({ data: [] }));
    const probe = new WhopCapabilityProbe({ accountId: "biz_TEST", transport });

    const report = await probe.run();

    expect(calls).toHaveLength(0);
    expect(report.credentialPresent).toBe(false);
    expect(report.summary.skipped).toBe(CAPABILITY_MANIFEST.length);
    expect(report.summary.verified).toBe(0);
  });

  it("skips writes unless writes are explicitly allowed", async () => {
    const { transport, calls } = recordingTransport(() => ok({ data: [] }));
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      transport,
    });

    const report = await probe.run();
    const writes = report.capabilities.filter((c) =>
      CAPABILITY_MANIFEST.find((m) => m.id === c.id)?.mutates,
    );

    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(write.status).toBe("skipped");
    for (const call of calls) expect(call.request.method).toBe("GET");
  });

  it("refuses to create an offer when writes are disabled", async () => {
    const { transport } = recordingTransport(() => ok({ data: [] }));
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      transport,
    });

    await expect(probe.createDraftOfferOnce(draftIntent())).rejects.toThrow(/Writes are disabled/);
  });
});

describe("outcome classification", () => {
  it.each([
    [200, "verified"],
    [201, "verified"],
    [400, "invalid-request"],
    [401, "unauthenticated"],
    [403, "scope-denied"],
    [404, "unavailable"],
    [410, "unavailable"],
    [429, "rate-limited"],
    [500, "error"],
  ] as const)("maps HTTP %i to %s", (status, expected) => {
    expect(classifyStatus(status)).toBe(expected);
  });

  it("separates a missing scope from a missing endpoint", async () => {
    const { transport } = recordingTransport((request) =>
      request.url.includes("/members")
        ? { status: 403, headers: {}, body: { error: { type: "forbidden", message: "no scope" } } }
        : { status: 404, headers: {}, body: { error: { type: "not_found", message: "gone" } } },
    );
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      transport,
    });

    const report = await probe.run();
    const members = report.capabilities.find((c) => c.id === "commerce.members.list");
    const products = report.capabilities.find((c) => c.id === "offers.products.list");

    expect(members?.status).toBe("scope-denied");
    expect(products?.status).toBe("unavailable");
  });
});

describe("permission check", () => {
  it("splits granted from denied actions", async () => {
    const { transport } = recordingTransport((request) =>
      request.url.includes("/permissions")
        ? ok({
            data: [
              { action: "access_pass:basic:read", granted: true },
              { action: "access_pass:create", granted: true },
              { action: "stats:read", granted: false },
            ],
          })
        : ok({ data: [] }),
    );
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      transport,
    });

    const result = await probe.checkPermissions(["access_pass:create", "stats:read"]);

    expect(result.status).toBe("verified");
    expect(result.granted).toEqual(["access_pass:basic:read", "access_pass:create"]);
    expect(result.denied).toEqual(["stats:read"]);
  });
});

// ---------------------------------------------------------------------------
// 3. Offline: idempotency
// ---------------------------------------------------------------------------

function draftIntent(overrides: Partial<DraftOfferIntent> = {}): DraftOfferIntent {
  return {
    title: "Whop City draft offer",
    visibility: "hidden",
    description: "Created from an explicit, reviewed operation intent.",
    nonce: "intent-0001",
    ...overrides,
  };
}

describe("idempotent draft-offer creation", () => {
  it("derives a stable key from the reviewed intent", () => {
    expect(buildIdempotencyKey(draftIntent())).toBe(buildIdempotencyKey(draftIntent()));
    expect(buildIdempotencyKey(draftIntent())).not.toBe(
      buildIdempotencyKey(draftIntent({ nonce: "intent-0002" })),
    );
    expect(buildIdempotencyKey(draftIntent())).not.toBe(
      buildIdempotencyKey(draftIntent({ title: "Something else" })),
    );
  });

  it("creates exactly one product when the same intent is submitted twice", async () => {
    const created: { id: string; metadata: Record<string, unknown> }[] = [];
    const { transport, calls } = recordingTransport((request) => {
      if (request.method === "GET") return ok({ data: created });
      const metadata = JSON.parse(request.body ?? "{}").metadata as Record<string, unknown>;
      const product = { id: `prod_${created.length + 1}`, metadata };
      created.push(product);
      return { status: 201, headers: {}, body: product };
    });
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      allowWrites: true,
      transport,
    });

    const first = await probe.createDraftOfferOnce(draftIntent());
    const second = await probe.createDraftOfferOnce(draftIntent());

    expect(first.created).toBe(true);
    expect(first.reason).toBe("created");
    expect(second.created).toBe(false);
    expect(second.reason).toBe("replayed");
    expect(second.productId).toBe(first.productId);
    expect(created).toHaveLength(1);
    expect(calls.filter((c) => c.request.method === "POST")).toHaveLength(1);
  });

  it("creates a second product only for a genuinely different intent", async () => {
    const created: { id: string; metadata: Record<string, unknown> }[] = [];
    const { transport } = recordingTransport((request) => {
      if (request.method === "GET") return ok({ data: created });
      const metadata = JSON.parse(request.body ?? "{}").metadata as Record<string, unknown>;
      const product = { id: `prod_${created.length + 1}`, metadata };
      created.push(product);
      return { status: 201, headers: {}, body: product };
    });
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      allowWrites: true,
      transport,
    });

    await probe.createDraftOfferOnce(draftIntent());
    await probe.createDraftOfferOnce(draftIntent({ nonce: "intent-0002" }));

    expect(created).toHaveLength(2);
  });

  it("sends the idempotency key both as a header and in product metadata", async () => {
    const { transport, calls } = recordingTransport((request) =>
      request.method === "GET" ? ok({ data: [] }) : { status: 201, headers: {}, body: { id: "prod_1" } },
    );
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      allowWrites: true,
      transport,
    });

    const intent = draftIntent();
    await probe.createDraftOfferOnce(intent);

    const post = calls.find((c) => c.request.method === "POST")!;
    const key = buildIdempotencyKey(intent);
    expect(post.request.headers["idempotency-key"]).toBe(key);
    expect(JSON.parse(post.request.body!).metadata.whop_city_idempotency_key).toBe(key);
  });

  it("treats Whop's own replay as a replay, not a fresh creation", async () => {
    // Whop stores a keyed response for 24 hours and flags the replay. City must
    // not write a second receipt when it sees one.
    const { transport } = recordingTransport((request) =>
      request.method === "GET"
        ? ok({ data: [] })
        : {
            status: 201,
            headers: { "Idempotent-Replayed": "true" },
            body: { id: "prod_original" },
          },
    );
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      allowWrites: true,
      transport,
    });

    const outcome = await probe.createDraftOfferOnce(draftIntent());

    expect(outcome.created).toBe(false);
    expect(outcome.reason).toBe("replayed");
    expect(outcome.productId).toBe("prod_original");
  });

  it("creates the offer hidden, never visible", async () => {
    const { transport, calls } = recordingTransport((request) =>
      request.method === "GET" ? ok({ data: [] }) : { status: 201, headers: {}, body: { id: "prod_1" } },
    );
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      allowWrites: true,
      transport,
    });

    await probe.createDraftOfferOnce(draftIntent());

    const post = calls.find((c) => c.request.method === "POST")!;
    expect(JSON.parse(post.request.body!).visibility).toBe("hidden");
  });

  it("reports a failed write instead of claiming success", async () => {
    const { transport } = recordingTransport((request) =>
      request.method === "GET"
        ? ok({ data: [] })
        : {
            status: 403,
            headers: {},
            body: { error: { type: "forbidden", message: "missing access_pass:create" } },
          },
    );
    const probe = new WhopCapabilityProbe({
      accessToken: TEST_TOKEN,
      accountId: "biz_TEST",
      allowWrites: true,
      transport,
    });

    const outcome = await probe.createDraftOfferOnce(draftIntent());

    expect(outcome.created).toBe(false);
    expect(outcome.reason).toBe("failed");
    expect(outcome.detail).toContain("access_pass:create");
  });
});

// ---------------------------------------------------------------------------
// 4. Offline: redaction
// ---------------------------------------------------------------------------

describe("fixture redaction", () => {
  const salt = "test-salt";

  it("strips secrets and personal data but keeps shape", () => {
    const result = redact(
      {
        id: "biz_ABC123XYZ",
        title: "Acme Detailing",
        email: "owner@acme.test",
        webhook_secret: FAKE.webhookSecret,
        access_token: FAKE.token,
        nested: { phone: "+15551234567", count: 12 },
      },
      { salt },
    ) as Record<string, unknown>;

    expect(result.webhook_secret).toBe(REDACTED);
    expect(result.access_token).toBe(REDACTED);
    expect(result.email).toBe(REDACTED);
    expect(result.title).toBe(REDACTED);
    expect((result.nested as Record<string, unknown>).phone).toBe(REDACTED);
    expect((result.nested as Record<string, unknown>).count).toBe(12);
  });

  it("pseudonymizes Whop ids deterministically and irreversibly", () => {
    const once = pseudonymizeId("biz_ABC123XYZ", salt);
    expect(once).toBe(pseudonymizeId("biz_ABC123XYZ", salt));
    expect(once).not.toBe("biz_ABC123XYZ");
    expect(once.startsWith("biz_")).toBe(true);
    expect(pseudonymizeId("biz_ABC123XYZ", "other-salt")).not.toBe(once);
  });

  it("keeps referential integrity across a payload", () => {
    const result = redact(
      { a: { id: "prod_SAME1234" }, b: { product_id: "prod_SAME1234" } },
      { salt },
    ) as { a: { id: string }; b: { product_id: string } };
    expect(result.a.id).toBe(result.b.product_id);
  });

  it("redacts credential-bearing headers", () => {
    const headers = redactHeaders(
      { authorization: `Bearer ${TEST_TOKEN}`, "idempotency-key": "abc", accept: "application/json" },
      { salt },
    );
    expect(headers.authorization).toBe(REDACTED);
    expect(headers["idempotency-key"]).toBe(REDACTED);
    expect(headers.accept).toBe("application/json");
  });

  it("refuses to emit output that still contains a credential", () => {
    expect(() => assertNoCredentialLeak(`{"h":"Bearer ${FAKE.token}"}`)).toThrow(/bearer token/);
    expect(() => assertNoCredentialLeak(`{"s":"${FAKE.webhookSecret}"}`)).toThrow(
      /webhook secret/,
    );
    expect(() => assertNoCredentialLeak('{"e":"owner@acme.test"}')).toThrow(/email/);
    expect(() => assertNoCredentialLeak('{"id":"biz_abcdef1234"}')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Offline: normalization
// ---------------------------------------------------------------------------

describe("business snapshot normalization", () => {
  const baseInputs = {
    businessId: "biz_TEST",
    capturedAt: "2026-09-03T00:00:00.000Z",
    source: "poll" as const,
  };

  it("counts the v1 metrics from list payloads", () => {
    const snapshot = normalizeBusinessSnapshot({
      ...baseInputs,
      members: { data: [{ id: "mber_1" }, { id: "mber_2" }] },
      memberships: { data: [{ status: "active" }, { status: "canceled" }, { status: "active" }] },
      payments: { data: [{ id: "pay_1" }] },
      products: {
        data: [
          { id: "prod_1", visibility: "visible", global_affiliate_percentage: 10 },
          { id: "prod_2", visibility: "hidden", global_affiliate_percentage: 0 },
        ],
      },
      plans: { data: [{ id: "plan_1" }] },
      affiliates: { data: [] },
    });

    expect(snapshot.commerce.memberCount).toBe(2);
    expect(snapshot.commerce.activeMembershipCount).toBe(2);
    expect(snapshot.offers.productCount).toBe(2);
    expect(snapshot.offers.visibleProductCount).toBe(1);
    expect(snapshot.affiliates.affiliateCount).toBe(0);
    expect(snapshot.affiliates.programmeConfigured).toBe(true);
  });

  it("reports an unreadable metric as null, never as zero", () => {
    const snapshot = normalizeBusinessSnapshot({
      ...baseInputs,
      products: { data: [] },
      unavailable: ["commerce.members.list", "affiliates.list"],
    });

    expect(snapshot.commerce.memberCount).toBeNull();
    expect(snapshot.commerce.recentPaymentCount).toBeNull();
    expect(snapshot.affiliates.affiliateCount).toBeNull();
    expect(snapshot.offers.productCount).toBe(0);
    expect(snapshot.unavailable).toContain("commerce.members.list");
  });
});

// ---------------------------------------------------------------------------
// 6. Live, unauthenticated. Network only, no secrets.
// ---------------------------------------------------------------------------

const liveUnauth = process.env.WHOP_LIVE_UNAUTH === "1" ? describe : describe.skip;

liveUnauth("live Whop API, no credential", () => {
  const transport = createFetchTransport();
  const call = (path: string, apiVersion = WHOP_API_VERSION_PIN) =>
    transport({
      method: "GET",
      url: `${WHOP_PRODUCTION_BASE_URL}${path}`,
      headers: { accept: "application/json", "api-version-date": apiVersion },
    });

  it("accepts the pinned API version", async () => {
    const response = await call("/products?first=1");
    expect(response.status).toBe(200);
  });

  it("rejects an unknown version and names the supported ones", async () => {
    const response = await call("/products?first=1", "1999-01-01");
    expect(response.status).toBe(400);
    const message = JSON.stringify(response.body);
    expect(message).toContain("Unknown Api-Version-Date");
    expect(message).toContain(WHOP_API_VERSION_PIN);
  });

  it.each([
    "/accounts?first=1",
    "/permissions?resource_id=biz_000000",
    "/members?first=1",
    "/payments?first=1",
    "/plans?first=1",
    "/stats",
    "/webhooks",
  ])("refuses %s without a credential", async (path) => {
    const response = await call(path);
    expect(response.status).toBe(401);
  });

  it("refuses an anonymous product write", async () => {
    const response = await transport({
      method: "POST",
      url: `${WHOP_PRODUCTION_BASE_URL}/products`,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-version-date": WHOP_API_VERSION_PIN,
      },
      body: JSON.stringify({ title: "anonymous write must be refused" }),
    });
    expect(response.status).toBe(401);
  });

  it("still matches the committed OpenAPI scope extract", async () => {
    const response = await fetch(openApiScopes.generatedFrom.native);
    const spec = (await response.json()) as {
      info: Record<string, string>;
      paths: Record<string, Record<string, { security?: Record<string, string[]>[] }>>;
    };

    expect(spec.info["x-api-version-date"]).toBe(openApiScopes.apiVersionDate);
    expect(JSON.stringify(spec)).toContain('"hidden"');

    for (const [key, expected] of Object.entries(specOperations)) {
      if (expected.surface !== "native") continue;
      const [method, apiPath] = key.split(" ") as [string, string];
      const op = spec.paths[apiPath]?.[method.toLowerCase()];
      expect(op, `${key} disappeared from the native spec`).toBeDefined();
      const actual = (op!.security ?? []).map((requirement) => {
        const entries = Object.entries(requirement);
        if (entries.length === 0) return { auth: "none", scopes: [] };
        return { auth: "bearer", scopes: entries.flatMap(([, s]) => s).sort() };
      });
      expect(actual, `${key} changed its required scopes`).toEqual(expected.security);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Live sandbox. Credentials required.
// ---------------------------------------------------------------------------

const liveSandbox =
  process.env.WHOP_LIVE_SANDBOX === "1" &&
  process.env.WHOP_TEST_ACCESS_TOKEN &&
  process.env.WHOP_TEST_BUSINESS_ID
    ? describe
    : describe.skip;

liveSandbox("live capability sweep against the dedicated test business", () => {
  const makeProbe = (allowWrites: boolean) =>
    new WhopCapabilityProbe({
      baseUrl: process.env.WHOP_API_BASE_URL ?? WHOP_PRODUCTION_BASE_URL,
      accessToken: process.env.WHOP_TEST_ACCESS_TOKEN as string,
      accountId: process.env.WHOP_TEST_BUSINESS_ID as string,
      allowWrites,
    });

  it("returns a normalized business snapshot", async () => {
    const report = await makeProbe(false).run();

    expect(report.credentialPresent).toBe(true);
    expect(report.summary.unauthenticated).toBe(0);
    expect(
      report.capabilities.find((c) => c.id === "business.list")?.status,
      "listing owned businesses is the floor for business selection",
    ).toBe("verified");
    expect(report.permissions.status).toBe("verified");
  });

  it("creates exactly one product for a replayed intent", async () => {
    const probe = makeProbe(true);
    const intent: DraftOfferIntent = {
      title: `Whop City probe ${new Date().toISOString().slice(0, 10)}`,
      visibility: "hidden",
      description: "Created by the Task 1 capability probe. Safe to delete.",
      nonce: `probe-${process.env.WHOP_PROBE_NONCE ?? "default"}`,
    };

    const first = await probe.createDraftOfferOnce(intent);
    const second = await probe.createDraftOfferOnce(intent);

    expect(first.reason).toBe("created");
    expect(first.productId).toBeDefined();
    expect(second.reason).toBe("replayed");
    expect(second.productId).toBe(first.productId);
  });
});
