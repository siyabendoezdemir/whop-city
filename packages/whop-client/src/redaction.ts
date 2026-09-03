/**
 * Redaction for capability-probe fixtures.
 *
 * Task 1 captures real request/response pairs from a live Whop business. Those
 * fixtures are useless as a contract baseline if they carry secrets or personal
 * data, and dangerous if they reach Git. Everything written to disk goes
 * through `redact` first.
 */

import { createHash } from "node:crypto";

/** Header names never recorded, in any casing. */
const SECRET_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-whop-user-token",
  "idempotency-key",
]);

/** Object keys whose values are secrets. Matched case-insensitively. */
const SECRET_KEYS = [
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "webhook_secret",
  "api_key",
  "apikey",
  "secret",
  "code_verifier",
  "password",
];

/**
 * Object keys whose values identify a person or a business. Matched
 * case-insensitively. Business-identifying fields (`title`, `headline`,
 * `route`) are included because a fixture only needs to document shape, and a
 * product title names the seller as surely as an email address does.
 */
const IDENTIFYING_KEYS = [
  "email",
  "phone",
  "phone_number",
  "name",
  "username",
  "preferred_username",
  "profile_picture",
  "picture",
  "address",
  "billing_address",
  "shipping_address",
  "ip",
  "ip_address",
  "title",
  "headline",
  "route",
];

/** Whop resource tags. Real IDs are replaced with a stable pseudonym. */
const ID_TAG_PATTERN =
  /\b(biz|user|prod|plan|mem|mber|pay|hook|app|exp|aff|msg|ws|cus)_[A-Za-z0-9]{4,}\b/g;

export const REDACTED = "[redacted]";

function matches(key: string, list: readonly string[]): boolean {
  const lower = key.toLowerCase();
  return list.some((candidate) => lower === candidate || lower.endsWith(`_${candidate}`));
}

/**
 * Deterministic pseudonym for a Whop ID. The same real ID always maps to the
 * same placeholder, so relationships between fixtures survive redaction while
 * the original identifier does not.
 */
export function pseudonymizeId(id: string, salt: string): string {
  const [tag] = id.split("_", 1);
  const digest = createHash("sha256").update(`${salt}:${id}`).digest("hex").slice(0, 10);
  return `${tag}_${digest}`;
}

export function pseudonymizeIdsInString(value: string, salt: string): string {
  return value.replace(ID_TAG_PATTERN, (match) => pseudonymizeId(match, salt));
}

export interface RedactOptions {
  /**
   * Salt for ID pseudonymization. Use a per-capture random salt so pseudonyms
   * cannot be reversed by re-hashing a guessed ID.
   */
  readonly salt: string;
}

/**
 * Recursively strips secrets, replaces personal data, and pseudonymizes Whop
 * IDs. Unknown structures are preserved so a fixture still documents shape.
 */
export function redact(value: unknown, options: RedactOptions): unknown {
  return redactValue(value, options, 0);
}

function redactValue(value: unknown, options: RedactOptions, depth: number): unknown {
  if (depth > 20) return REDACTED;
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return pseudonymizeIdsInString(value, options.salt);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, options, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (matches(key, SECRET_KEYS)) {
        out[key] = REDACTED;
      } else if (matches(key, IDENTIFYING_KEYS)) {
        out[key] = item === null ? null : REDACTED;
      } else {
        out[key] = redactValue(item, options, depth + 1);
      }
    }
    return out;
  }

  return REDACTED;
}

/** Drops credential-bearing headers and redacts what remains. */
export function redactHeaders(
  headers: Readonly<Record<string, string>>,
  options: RedactOptions,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SECRET_HEADERS.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = pseudonymizeIdsInString(value, options.salt);
  }
  return out;
}

/**
 * Last line of defence before a fixture is written. Throws if anything that
 * looks like a live credential survived redaction.
 */
export function assertNoCredentialLeak(serialized: string): void {
  const leaks: string[] = [];
  // Whop credential prefixes: API keys, webhook secrets, OAuth client secrets.
  if (/\bBearer\s+[A-Za-z0-9._-]{12,}/.test(serialized)) leaks.push("bearer token");
  if (/\bws_[A-Za-z0-9]{16,}\b/.test(serialized)) leaks.push("webhook secret (ws_)");
  if (/\bwhop_[A-Za-z0-9]{16,}\b/.test(serialized)) leaks.push("whop credential (whop_)");
  if (/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(serialized)) leaks.push("email address");
  if (leaks.length > 0) {
    throw new Error(`Refusing to write fixture: possible ${leaks.join(", ")} in output`);
  }
}
