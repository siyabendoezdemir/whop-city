/**
 * The exact set of Whop capabilities Whop City v1 depends on.
 *
 * Every entry is derived from Whop's published OpenAPI documents, not from
 * assumption. `requiredScopes` mirrors the `security` requirement the spec
 * declares for that operation; an empty array means the operation accepts any
 * authenticated bearer with no additional grant.
 *
 * `tests/contracts/whop-sandbox.spec.ts` re-checks this manifest against a
 * committed extract of the spec, so a Whop-side scope change fails CI instead
 * of silently breaking a district at runtime.
 */

/** Which Whop API surface an operation belongs to. */
export type WhopSurface = "native" | "legacy" | "oauth";

export type CapabilityKind = "identity" | "read" | "write" | "meta";

/** Which part of the product stops working when a capability is unavailable. */
export type CityDependency =
  | "sign-in"
  | "business-selection"
  | "commerce-core"
  | "offer-forge"
  | "creator-quarter"
  | "operations"
  | "live-updates"
  | "diagnostics";

export interface CapabilityDefinition {
  readonly id: string;
  readonly title: string;
  readonly kind: CapabilityKind;
  readonly surface: WhopSurface;
  readonly method: "GET" | "POST";
  /** Path relative to the API base URL, or an absolute URL for OAuth endpoints. */
  readonly path: string;
  /** Scopes the spec requires. Empty means "any authenticated bearer". */
  readonly requiredScopes: readonly string[];
  readonly dependency: CityDependency;
  /** Why City needs it, in the words the permission matrix uses. */
  readonly rationale: string;
  /**
   * Query parameters to send during a probe. The tokens `{accountId}`,
   * `{today}`, and `{from30d}` are substituted at probe time.
   */
  readonly probeQuery?: Readonly<Record<string, string>>;
  /** Path-template values, e.g. `{ metric: "net_revenue" }` for `/stats/{metric}`. */
  readonly probePathParams?: Readonly<Record<string, string>>;
  /**
   * True when the operation changes seller-visible state. The probe never runs
   * these unless it is explicitly told to, and only against the test business.
   */
  readonly mutates?: boolean;
}

/** The latest dated version Whop advertises, and the version City pins to. */
export const WHOP_API_VERSION_PIN = "2026-09-02-2";

export const WHOP_PRODUCTION_BASE_URL = "https://api.whop.com/api/v1";
export const WHOP_SANDBOX_BASE_URL = "https://sandbox-api.whop.com/api/v1";
export const WHOP_OAUTH_BASE_URL = "https://api.whop.com/oauth";

/**
 * OIDC scopes requested at authorization time. City deliberately omits `email`:
 * the leaderboard is anonymous and no v1 feature needs an address.
 */
export const CITY_OIDC_SCOPES = ["openid", "profile"] as const;

export const CAPABILITY_MANIFEST: readonly CapabilityDefinition[] = [
  {
    id: "identity.userinfo",
    title: "Read the signed-in user's identity",
    kind: "identity",
    surface: "oauth",
    method: "GET",
    path: `${WHOP_OAUTH_BASE_URL}/userinfo`,
    requiredScopes: ["openid"],
    dependency: "sign-in",
    rationale:
      "Establishes the player record. `profile` adds name/username/picture; City never requests `email`.",
  },
  {
    id: "meta.permissions",
    title: "Check what this credential is granted on a business",
    kind: "meta",
    surface: "native",
    method: "GET",
    path: "/permissions",
    requiredScopes: [],
    dependency: "diagnostics",
    rationale:
      "Reports granted/denied per action for one resource without calling each endpoint. City uses it to disable districts the seller did not grant rather than surfacing 403s.",
    probeQuery: { resource_id: "{accountId}" },
  },
  {
    id: "business.list",
    title: "List the businesses the signed-in user owns",
    kind: "read",
    surface: "native",
    method: "GET",
    path: "/accounts",
    requiredScopes: [],
    dependency: "business-selection",
    rationale:
      "Populates the business picker. A user token returns that user's business accounts. Balance fields and `order=volume` need extra scopes City does not request.",
    probeQuery: { first: "10" },
  },
  {
    id: "offers.products.list",
    title: "Read the business's products",
    kind: "read",
    surface: "native",
    method: "GET",
    path: "/products",
    requiredScopes: ["access_pass:basic:read"],
    dependency: "offer-forge",
    rationale: "Offer Forge counts, titles, visibility state, and affiliate configuration.",
    probeQuery: { account_id: "{accountId}", first: "10" },
  },
  {
    id: "offers.plans.list",
    title: "Read the business's pricing plans",
    kind: "read",
    surface: "native",
    method: "GET",
    path: "/plans",
    requiredScopes: ["plan:basic:read"],
    dependency: "offer-forge",
    rationale: "Offer Forge pricing signal: whether products have buyable plans at all.",
    probeQuery: { account_id: "{accountId}", first: "10" },
  },
  {
    id: "commerce.members.list",
    title: "Read the business's members",
    kind: "read",
    surface: "native",
    method: "GET",
    path: "/members",
    requiredScopes: ["member:basic:read"],
    dependency: "commerce-core",
    rationale:
      "Customer-count signal. City requests neither `member:email:read` nor `member:phone:read`, so contact fields come back null.",
    probeQuery: { account_id: "{accountId}", first: "10" },
  },
  {
    id: "commerce.memberships.list",
    title: "Read the business's memberships",
    kind: "read",
    surface: "native",
    method: "GET",
    path: "/memberships",
    requiredScopes: ["member:basic:read"],
    dependency: "commerce-core",
    rationale: "Active-versus-churned signal behind Commerce Core health.",
    probeQuery: { account_id: "{accountId}", first: "10" },
  },
  {
    id: "commerce.payments.list",
    title: "Read the business's payments",
    kind: "read",
    surface: "native",
    method: "GET",
    path: "/payments",
    requiredScopes: ["payment:basic:read"],
    dependency: "commerce-core",
    rationale:
      "Revenue signal when the seller declines `stats:read`. Amounts are money objects, not bare numbers.",
    probeQuery: { account_id: "{accountId}", first: "10" },
  },
  {
    id: "commerce.stats.catalogue",
    title: "List the metrics this credential can query",
    kind: "meta",
    surface: "native",
    method: "GET",
    path: "/stats",
    requiredScopes: [],
    dependency: "diagnostics",
    rationale:
      "Enumerates available metric keys, units, and breakdown properties, so City names only metrics that exist.",
  },
  {
    id: "commerce.stats.series",
    title: "Read a metric as a time series",
    kind: "read",
    surface: "native",
    method: "GET",
    path: "/stats/{metric}",
    requiredScopes: ["stats:read"],
    dependency: "commerce-core",
    rationale:
      "Preferred revenue source: pre-aggregated series with an explicit unit, instead of City summing payments itself. `from` and `to` are mandatory; the metric key is free-form and enumerated by `GET /stats`.",
    probePathParams: { metric: "net_revenue" },
    probeQuery: { account_id: "{accountId}", from: "{from30d}", to: "{today}" },
  },
  {
    id: "affiliates.list",
    title: "Read the business's affiliates",
    kind: "read",
    surface: "legacy",
    method: "GET",
    path: "/affiliates",
    requiredScopes: ["affiliate:basic:read"],
    dependency: "creator-quarter",
    rationale:
      "Creator Quarter readiness and activity. Affiliates have no versioned successor, so this stays on the legacy surface. `account_id` is required.",
    probeQuery: { account_id: "{accountId}", first: "10" },
  },
  {
    id: "operations.create-draft-offer",
    title: "Create a hidden draft product",
    kind: "write",
    surface: "native",
    method: "POST",
    path: "/products",
    requiredScopes: ["access_pass:create"],
    dependency: "operations",
    rationale:
      "The single v1 write. `visibility` keeps it out of the storefront, the `Idempotency-Key` header dedupes for 24 hours, `metadata` carries the same key for durable dedupe past that window, and the affiliate percentage fields are accepted at creation.",
    mutates: true,
  },
  {
    id: "operations.read-created-offer",
    title: "Read back a product by ID",
    kind: "read",
    surface: "native",
    method: "GET",
    path: "/products/{id}",
    requiredScopes: [],
    dependency: "operations",
    rationale:
      "Confirms the write landed before City issues a receipt or animates construction. The spec marks retrieve-by-id public, but whether a `hidden` product is readable that way is unverified — City reads it with the seller's token regardless.",
  },
  {
    id: "live.webhooks.list",
    title: "List webhooks on the business",
    kind: "read",
    surface: "native",
    method: "GET",
    path: "/webhooks",
    requiredScopes: ["developer:manage_webhook"],
    dependency: "live-updates",
    rationale:
      "Detects an existing City webhook before creating a second one, and reads health fields (`enabled`, `disabled_reason`, `consecutive_failures`).",
  },
  {
    id: "live.webhooks.create",
    title: "Create a webhook on the business",
    kind: "write",
    surface: "native",
    method: "POST",
    path: "/webhooks",
    requiredScopes: ["developer:manage_webhook"],
    dependency: "live-updates",
    rationale:
      "Event-led sync. `resource_id` defaults to the current account. `webhook_secret` is returned once and reads back null for OAuth callers, so City must capture and encrypt it at creation.",
    mutates: true,
  },
];

/**
 * Non-OIDC scopes City asks a seller to grant. Everything else in the manifest
 * is reachable with a bare authenticated bearer.
 */
export const CITY_REQUESTED_SCOPES: readonly string[] = Object.freeze([
  ...new Set(
    CAPABILITY_MANIFEST.filter((c) => c.surface !== "oauth").flatMap((c) => c.requiredScopes),
  ),
].sort());

/**
 * Whop events City subscribes to. Affiliate activity has no event and must be
 * polled — see `docs/whop-permission-matrix.md`.
 */
export const CITY_WEBHOOK_EVENTS: readonly string[] = [
  "product.created",
  "product.updated",
  "product.published",
  "product.unpublished",
  "product.deleted",
  "plan.created",
  "plan.updated",
  "plan.deleted",
  "member.created",
  "membership.activated",
  "membership.deactivated",
  "payment.succeeded",
  "payment.failed",
];

export function getCapability(id: string): CapabilityDefinition {
  const found = CAPABILITY_MANIFEST.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown capability: ${id}`);
  return found;
}
