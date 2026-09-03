/**
 * Whop capability probe — Task 1.
 *
 * Answers one question against a live, dedicated test business: which of the
 * capabilities in `capability-manifest.ts` actually work for a user OAuth
 * token, and which do not. It writes the answer as a machine-readable report
 * that `docs/whop-permission-matrix.md` is kept honest against.
 *
 * Safety rules this module enforces:
 *   - Credentials are held in a closure and never returned, logged, or stored.
 *   - Writes run only when `allowWrites` is explicitly true.
 *   - The one permitted write is a hidden draft product, created at most once
 *     per idempotency key.
 */

import { createHash, randomUUID } from "node:crypto";

import {
  CAPABILITY_MANIFEST,
  WHOP_API_VERSION_PIN,
  WHOP_PRODUCTION_BASE_URL,
  type CapabilityDefinition,
} from "./capability-manifest.ts";
import { assertNoCredentialLeak, redact, redactHeaders } from "./redaction.ts";

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface ProbeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface ProbeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export type ProbeTransport = (request: ProbeRequest) => Promise<ProbeResponse>;

export function createFetchTransport(fetchImpl: typeof fetch = fetch): ProbeTransport {
  return async (request) => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: { ...request.headers },
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      // Leave the raw text; a non-JSON body is itself a finding.
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  };
}

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

export type CapabilityStatus =
  /** 2xx. The capability works for this credential on this business. */
  | "verified"
  /** 403. The endpoint exists but the credential lacks the scope. */
  | "scope-denied"
  /** 401. No usable credential was presented. */
  | "unauthenticated"
  /** 404 / 410. The operation is absent at the pinned version. */
  | "unavailable"
  /** 400. Reached the endpoint, but the probe's own arguments were rejected. */
  | "invalid-request"
  /** 429. Could not be determined without backing off. */
  | "rate-limited"
  /** 5xx or transport failure. */
  | "error"
  /** Never attempted: no credential, or a write with writes disabled. */
  | "skipped";

export function classifyStatus(status: number): CapabilityStatus {
  if (status >= 200 && status < 300) return "verified";
  switch (status) {
    case 401:
      return "unauthenticated";
    case 403:
      return "scope-denied";
    case 404:
    case 410:
      return "unavailable";
    case 400:
    case 422:
      return "invalid-request";
    case 429:
      return "rate-limited";
    default:
      return status >= 500 ? "error" : "error";
  }
}

/** Whop's error envelope: `{ "error": { "type": ..., "message": ... } }`. */
export function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

export interface CapabilityProbeConfig {
  /** API base URL. Defaults to production; the sandbox host is also supported. */
  readonly baseUrl?: string;
  /** Dated API version to pin. Always sent, on every request. */
  readonly apiVersion?: string;
  /** OAuth access token or API key. Never recorded. */
  readonly accessToken?: string | undefined;
  /** The `biz_` id of the dedicated test business. */
  readonly accountId?: string | undefined;
  /** Writes are refused unless this is explicitly true. */
  readonly allowWrites?: boolean;
  readonly transport?: ProbeTransport;
}

export interface CapabilityResult {
  readonly id: string;
  readonly title: string;
  readonly method: string;
  readonly path: string;
  readonly surface: string;
  readonly dependency: string;
  readonly requiredScopes: readonly string[];
  readonly status: CapabilityStatus;
  readonly httpStatus?: number;
  readonly detail?: string;
  /** Redacted request/response pair, safe to commit as a fixture. */
  readonly evidence?: unknown;
}

export interface PermissionCheckResult {
  readonly status: CapabilityStatus;
  readonly granted: readonly string[];
  readonly denied: readonly string[];
  readonly detail?: string;
}

export interface CapabilityReport {
  readonly generatedAt: string;
  readonly baseUrl: string;
  readonly apiVersion: string;
  readonly credentialPresent: boolean;
  readonly accountIdPresent: boolean;
  readonly writesAllowed: boolean;
  readonly permissions: PermissionCheckResult;
  /**
   * Every permission action Whop knows about for this business, granted or
   * not. Whop publishes no enumerable list of requestable app permissions, so
   * this is the only authoritative source for the vocabulary.
   */
  readonly allPermissions: PermissionCheckResult;
  readonly capabilities: readonly CapabilityResult[];
  readonly summary: Readonly<Record<CapabilityStatus, number>>;
}

const SKIP_NO_CREDENTIAL = "No credential supplied; probe not attempted.";
const SKIP_NO_ACCOUNT = "No test business id supplied; probe not attempted.";
const SKIP_WRITE_DISABLED = "Write capability; re-run with allowWrites to verify.";

export class WhopCapabilityProbe {
  readonly #baseUrl: string;
  readonly #apiVersion: string;
  readonly #accessToken: string | undefined;
  readonly #accountId: string | undefined;
  readonly #allowWrites: boolean;
  readonly #transport: ProbeTransport;
  readonly #salt: string;

  constructor(config: CapabilityProbeConfig = {}) {
    this.#baseUrl = (config.baseUrl ?? WHOP_PRODUCTION_BASE_URL).replace(/\/$/, "");
    this.#apiVersion = config.apiVersion ?? WHOP_API_VERSION_PIN;
    this.#accessToken = config.accessToken;
    this.#accountId = config.accountId;
    this.#allowWrites = config.allowWrites ?? false;
    this.#transport = config.transport ?? createFetchTransport();
    this.#salt = randomUUID();
  }

  /** Headers sent on every request. The version pin is not optional. */
  #headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "api-version-date": this.#apiVersion,
      ...extra,
    };
    if (this.#accessToken) headers.authorization = `Bearer ${this.#accessToken}`;
    return headers;
  }

  #url(path: string, query: Record<string, string> = {}): string {
    const base = path.startsWith("http") ? path : `${this.#baseUrl}${path}`;
    const url = new URL(base);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  /** Substitutes `{accountId}`, `{today}`, and `{from30d}` in a probe value. */
  #expand(value: string): string {
    const today = new Date();
    const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    return value
      .replaceAll("{accountId}", this.#accountId ?? "")
      .replaceAll("{today}", today.toISOString().slice(0, 10))
      .replaceAll("{from30d}", from.toISOString().slice(0, 10));
  }

  #resolveQuery(capability: CapabilityDefinition): Record<string, string> {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(capability.probeQuery ?? {})) {
      query[key] = this.#expand(value);
    }
    return query;
  }

  /** Fills a path template, or returns undefined when a value is missing. */
  #resolvePath(capability: CapabilityDefinition): string | undefined {
    let resolved = capability.path;
    for (const [key, value] of Object.entries(capability.probePathParams ?? {})) {
      resolved = resolved.replaceAll(`{${key}}`, this.#expand(value));
    }
    return /\{[^}]+\}/.test(resolved) ? undefined : resolved;
  }

  #evidence(request: ProbeRequest, response: ProbeResponse): unknown {
    const evidence = {
      request: {
        method: request.method,
        url: redact(request.url, { salt: this.#salt }),
        headers: redactHeaders(request.headers, { salt: this.#salt }),
      },
      response: {
        status: response.status,
        body: redact(response.body, { salt: this.#salt }),
      },
    };
    assertNoCredentialLeak(JSON.stringify(evidence));
    return evidence;
  }

  /**
   * Asks Whop directly which actions this credential holds on the business.
   * Cheaper and safer than discovering each 403 by calling the endpoint.
   */
  async checkPermissions(actions: readonly string[]): Promise<PermissionCheckResult> {
    if (!this.#accessToken) return { status: "skipped", granted: [], denied: [], detail: SKIP_NO_CREDENTIAL };
    if (!this.#accountId) return { status: "skipped", granted: [], denied: [], detail: SKIP_NO_ACCOUNT };

    const request: ProbeRequest = {
      method: "GET",
      url: this.#url("/permissions", {
        resource_id: this.#accountId,
        ...(actions.length > 0 ? { actions: actions.join(",") } : {}),
      }),
      headers: this.#headers(),
    };

    let response: ProbeResponse;
    try {
      response = await this.#transport(request);
    } catch (cause) {
      return { status: "error", granted: [], denied: [], detail: describeError(cause) };
    }

    const status = classifyStatus(response.status);
    if (status !== "verified") {
      const detail = extractErrorMessage(response.body);
      return {
        status,
        granted: [],
        denied: [],
        ...(detail === undefined ? {} : { detail }),
      };
    }

    const rows = readPermissionRows(response.body);
    return {
      status: "verified",
      granted: rows.filter((r) => r.granted).map((r) => r.action),
      denied: rows.filter((r) => !r.granted).map((r) => r.action),
    };
  }

  async probeCapability(capability: CapabilityDefinition): Promise<CapabilityResult> {
    const base = {
      id: capability.id,
      title: capability.title,
      method: capability.method,
      path: capability.path,
      surface: capability.surface,
      dependency: capability.dependency,
      requiredScopes: capability.requiredScopes,
    };

    if (!this.#accessToken) return { ...base, status: "skipped", detail: SKIP_NO_CREDENTIAL };
    if (capability.mutates && !this.#allowWrites) {
      return { ...base, status: "skipped", detail: SKIP_WRITE_DISABLED };
    }
    const resolvedPath = this.#resolvePath(capability);
    if (resolvedPath === undefined) {
      // Templated resource paths (`/products/{id}`) need an id produced by an
      // earlier step; they are probed by the write flow, not the sweep.
      return { ...base, status: "skipped", detail: "Requires an id from a prior step." };
    }
    const needsAccount = Object.values(capability.probeQuery ?? {}).some((v) =>
      v.includes("{accountId}"),
    );
    if (needsAccount && !this.#accountId) {
      return { ...base, status: "skipped", detail: SKIP_NO_ACCOUNT };
    }

    const request: ProbeRequest = {
      method: capability.method,
      url: this.#url(resolvedPath, this.#resolveQuery(capability)),
      headers: this.#headers(),
    };

    let response: ProbeResponse;
    try {
      response = await this.#transport(request);
    } catch (cause) {
      return { ...base, status: "error", detail: describeError(cause) };
    }

    const detail = extractErrorMessage(response.body);
    return {
      ...base,
      status: classifyStatus(response.status),
      httpStatus: response.status,
      ...(detail === undefined ? {} : { detail }),
      evidence: this.#evidence(request, response),
    };
  }

  /** Probes every read/meta capability, plus writes when explicitly allowed. */
  async run(
    manifest: readonly CapabilityDefinition[] = CAPABILITY_MANIFEST,
  ): Promise<CapabilityReport> {
    const scopes = [...new Set(manifest.flatMap((c) => c.requiredScopes))].sort();
    const permissions = await this.checkPermissions(scopes);
    // Omitting `actions` makes Whop return the complete action vocabulary.
    const allPermissions = await this.checkPermissions([]);

    const capabilities: CapabilityResult[] = [];
    for (const capability of manifest) {
      capabilities.push(await this.probeCapability(capability));
    }

    return {
      generatedAt: new Date().toISOString(),
      baseUrl: this.#baseUrl,
      apiVersion: this.#apiVersion,
      credentialPresent: Boolean(this.#accessToken),
      accountIdPresent: Boolean(this.#accountId),
      writesAllowed: this.#allowWrites,
      permissions,
      allPermissions,
      capabilities,
      summary: summarize(capabilities),
    };
  }

  // -------------------------------------------------------------------------
  // The one permitted write
  // -------------------------------------------------------------------------

  /**
   * Creates the v1 draft offer at most once for a given intent.
   *
   * Two layers, because Whop's server-side guarantee is time-boxed:
   *
   *  1. `Idempotency-Key`. Every authenticated POST accepts it, and Whop
   *     replays the stored response for 24 hours, flagged with
   *     `Idempotent-Replayed: true`. Beyond 24 hours the same key executes
   *     fresh, and a stored 4xx replays as that same 4xx.
   *  2. The key stamped into product `metadata`, plus a pre-flight read. This
   *     is what stops a duplicate offer when a player retries a mission days
   *     later, which layer 1 no longer covers.
   */
  async createDraftOfferOnce(intent: DraftOfferIntent): Promise<DraftOfferOutcome> {
    if (!this.#accessToken) throw new Error(SKIP_NO_CREDENTIAL);
    if (!this.#accountId) throw new Error(SKIP_NO_ACCOUNT);
    if (!this.#allowWrites) throw new Error("Writes are disabled on this probe.");

    const idempotencyKey = buildIdempotencyKey(intent);

    const existing = await this.#findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { created: false, reason: "replayed", productId: existing, idempotencyKey };
    }

    const body = {
      account_id: this.#accountId,
      title: intent.title,
      visibility: intent.visibility,
      ...(intent.description === undefined ? {} : { description: intent.description }),
      ...(intent.globalAffiliatePercentage === undefined
        ? {}
        : { global_affiliate_percentage: intent.globalAffiliatePercentage }),
      metadata: { [IDEMPOTENCY_METADATA_KEY]: idempotencyKey },
    };

    const request: ProbeRequest = {
      method: "POST",
      url: this.#url("/products"),
      headers: this.#headers({
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      }),
      body: JSON.stringify(body),
    };

    const response = await this.#transport(request);
    if (classifyStatus(response.status) !== "verified") {
      return {
        created: false,
        reason: "failed",
        idempotencyKey,
        httpStatus: response.status,
        ...(extractErrorMessage(response.body) === undefined
          ? {}
          : { detail: extractErrorMessage(response.body) as string }),
        evidence: this.#evidence(request, response),
      };
    }

    const productId = readProductId(response.body);
    const replayed = readHeader(response.headers, "idempotent-replayed") === "true";
    return {
      created: !replayed,
      reason: replayed ? "replayed" : "created",
      idempotencyKey,
      ...(productId === undefined ? {} : { productId }),
      httpStatus: response.status,
      evidence: this.#evidence(request, response),
    };
  }

  async #findByIdempotencyKey(key: string): Promise<string | undefined> {
    const response = await this.#transport({
      method: "GET",
      url: this.#url("/products", { account_id: this.#accountId as string, first: "100" }),
      headers: this.#headers(),
    });
    if (classifyStatus(response.status) !== "verified") return undefined;
    const rows = readProductRows(response.body);
    return rows.find((row) => row.metadata?.[IDEMPOTENCY_METADATA_KEY] === key)?.id;
  }
}

// ---------------------------------------------------------------------------
// Draft offer intent
// ---------------------------------------------------------------------------

export const IDEMPOTENCY_METADATA_KEY = "whop_city_idempotency_key";

export interface DraftOfferIntent {
  readonly title: string;
  /** `hidden` keeps the product off the seller's public storefront. */
  readonly visibility: "hidden" | "quick_link" | "visible";
  readonly description?: string;
  readonly globalAffiliatePercentage?: number;
  /** Distinguishes two legitimately identical offers created at different times. */
  readonly nonce: string;
}

export interface DraftOfferOutcome {
  readonly created: boolean;
  readonly reason: "created" | "replayed" | "failed";
  readonly idempotencyKey: string;
  readonly productId?: string;
  readonly httpStatus?: number;
  readonly detail?: string;
  readonly evidence?: unknown;
}

/** Stable hash of the reviewed intent. The same intent always yields the same key. */
export function buildIdempotencyKey(intent: DraftOfferIntent): string {
  const canonical = JSON.stringify([
    intent.title,
    intent.visibility,
    intent.description ?? null,
    intent.globalAffiliatePercentage ?? null,
    intent.nonce,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export interface BusinessSnapshot {
  readonly businessId: string;
  readonly capturedAt: string;
  readonly source: "poll" | "webhook" | "operation";
  readonly commerce: {
    readonly memberCount: number | null;
    readonly activeMembershipCount: number | null;
    readonly recentPaymentCount: number | null;
  };
  readonly offers: {
    readonly productCount: number | null;
    readonly visibleProductCount: number | null;
    readonly planCount: number | null;
  };
  readonly affiliates: {
    readonly affiliateCount: number | null;
    readonly programmeConfigured: boolean | null;
  };
  /** Capability ids that could not be read, so the UI can say so explicitly. */
  readonly unavailable: readonly string[];
}

export interface SnapshotInputs {
  readonly businessId: string;
  readonly capturedAt: string;
  readonly source: BusinessSnapshot["source"];
  readonly members?: unknown;
  readonly memberships?: unknown;
  readonly payments?: unknown;
  readonly products?: unknown;
  readonly plans?: unknown;
  readonly affiliates?: unknown;
  readonly unavailable?: readonly string[];
}

/**
 * Turns raw list payloads into City's v1 metrics.
 *
 * A metric that could not be read is `null`, never `0`. Rendering an
 * unreadable district as an empty one would tell the seller their business is
 * failing when City simply lacks the scope.
 */
export function normalizeBusinessSnapshot(inputs: SnapshotInputs): BusinessSnapshot {
  const products = readRows(inputs.products);
  return {
    businessId: inputs.businessId,
    capturedAt: inputs.capturedAt,
    source: inputs.source,
    commerce: {
      memberCount: countRows(inputs.members),
      activeMembershipCount: countRows(inputs.memberships, (row) => row.status === "active"),
      recentPaymentCount: countRows(inputs.payments),
    },
    offers: {
      productCount: countRows(inputs.products),
      visibleProductCount:
        products === undefined ? null : products.filter((r) => r.visibility === "visible").length,
      planCount: countRows(inputs.plans),
    },
    affiliates: {
      affiliateCount: countRows(inputs.affiliates),
      programmeConfigured:
        products === undefined
          ? null
          : products.some((r) => typeof r.global_affiliate_percentage === "number" && r.global_affiliate_percentage > 0),
    },
    unavailable: inputs.unavailable ?? [],
  };
}

// ---------------------------------------------------------------------------
// Payload readers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function readRows(payload: unknown): Row[] | undefined {
  if (payload === undefined || payload === null) return undefined;
  if (Array.isArray(payload)) return payload as Row[];
  if (typeof payload === "object") {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as Row[];
  }
  return undefined;
}

function countRows(payload: unknown, predicate?: (row: Row) => boolean): number | null {
  const rows = readRows(payload);
  if (rows === undefined) return null;
  return predicate ? rows.filter(predicate).length : rows.length;
}

function readPermissionRows(body: unknown): { action: string; granted: boolean }[] {
  const rows = readRows(body) ?? [];
  return rows.flatMap((row) => {
    const action = row.action;
    if (typeof action !== "string") return [];
    return [{ action, granted: row.granted === true }];
  });
}

function readProductRows(body: unknown): { id: string; metadata?: Record<string, unknown> }[] {
  const rows = readRows(body) ?? [];
  return rows.flatMap((row) => {
    if (typeof row.id !== "string") return [];
    const metadata =
      typeof row.metadata === "object" && row.metadata !== null
        ? (row.metadata as Record<string, unknown>)
        : undefined;
    return [{ id: row.id, ...(metadata === undefined ? {} : { metadata }) }];
  });
}

function readProductId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

/** Header lookup that tolerates whatever casing the transport preserved. */
function readHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function summarize(
  results: readonly CapabilityResult[],
): Readonly<Record<CapabilityStatus, number>> {
  const summary: Record<CapabilityStatus, number> = {
    verified: 0,
    "scope-denied": 0,
    unauthenticated: 0,
    unavailable: 0,
    "invalid-request": 0,
    "rate-limited": 0,
    error: 0,
    skipped: 0,
  };
  for (const result of results) summary[result.status] += 1;
  return summary;
}
