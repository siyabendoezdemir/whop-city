/**
 * Hosted-runtime verification probe.
 *
 * Public surface: the two bytes `ok`, as `text/plain`, for every request on
 * every path. Nothing else is ever written to a response body.
 *
 * Findings go to `console.log` and are readable only through
 *   whop apps logs app_USXOBX9htLTka7 --query "[city-probe]"
 * which is authenticated and retained for 7 days.
 *
 * Two properties this file is written to make auditable:
 *
 *   1. The handler ignores the incoming request completely. It never reads the
 *      URL, path, query, method, headers, or body, so nothing a visitor sends
 *      can influence what it does.
 *   2. Every outbound call is a hardcoded GET, against an origin checked to be
 *      a Whop host, with no request body. There is no code path in this file
 *      that can write to Whop.
 *
 * Values of bindings are never logged — only names, types, and lengths.
 */

const TAG = "[city-probe]";

/** Canonical API host, used whenever the binding is absent or unrecognised. */
const DEFAULT_ORIGIN = "https://api.whop.com";

/** Bindings the hosting documentation says the runtime sets. */
const DOCUMENTED_BINDINGS = [
  "APP_ID",
  "BUILD_ID",
  "WHOP_API_ORIGIN",
  "WHOP_ACCOUNT_ID",
  "ASSETS",
  "REALTIME",
];

/** Names seen under `whop apps dev`, checked here to compare the two runtimes. */
const DEV_BINDINGS = ["WHOP_APP_ID", "WHOP_API_KEY"];

/**
 * Permissions worth naming individually. The hosting docs claim the injected
 * key "can't move money" and that withdrawals and transfers are not granted.
 * The business API key measured in the read-only spike holds both, so these
 * are the actions that decide whether the two credentials really differ.
 */
const DECISIVE_ACTIONS = [
  "payout:withdraw_funds",
  "payout:transfer_funds",
  "payout:create_destination",
  "company:delete",
  "company:transfer_ownership",
  "payment:charge",
  "company:authorized_user:read",
  "developer:update_app",
  "developer:manage_oauth",
];

function log(line: string): void {
  console.log(`${TAG} ${line}`);
}

/** Reports what a binding is without ever revealing what it holds. */
function shape(value: unknown): string {
  if (value === undefined) return "ABSENT";
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string") return `string(len ${(value as string).length})`;
  if (type === "object") return `object(${(value as object).constructor?.name ?? "?"})`;
  return type;
}

/** True when a value looks like a credential rather than an identifier. */
function looksLikeCredential(value: unknown): boolean {
  return typeof value === "string" && value.length >= 40 && !value.includes(" ");
}

/**
 * Restricts outbound traffic to Whop. A binding that is missing, malformed, or
 * points anywhere else collapses to the canonical host, so the probe cannot be
 * pointed at a third party by a surprising runtime value.
 */
function safeOrigin(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_ORIGIN;
  try {
    const url = new URL(value);
    const whopHost = url.hostname === "whop.com" || url.hostname.endsWith(".whop.com");
    return url.protocol === "https:" && whopHost ? url.origin : DEFAULT_ORIGIN;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

type GetResult = { status: number; json: unknown };

/**
 * The only network primitive in this file. Method is a literal, there is no
 * body, and the path is supplied by this module rather than by the request.
 */
async function get(origin: string, path: string, headers?: Record<string, string>): Promise<GetResult> {
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "GET",
      headers: { "Api-Version-Date": "2026-09-02-2", ...headers },
      signal: AbortSignal.timeout(10_000),
    });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch (error) {
    log(`  request to ${path} failed: ${error instanceof Error ? error.name : "unknown"}`);
    return { status: -1, json: null };
  }
}

async function runProbe(env: Record<string, unknown>): Promise<void> {
  log("=== hosted runtime probe ===");

  // ---------------------------------------------------------------- bindings
  log("bindings on the worker env argument:");
  for (const name of DOCUMENTED_BINDINGS) log(`  ${name.padEnd(18)} ${shape(env[name])}`);
  log("bindings seen under `whop apps dev`, for comparison:");
  for (const name of DEV_BINDINGS) log(`  ${name.padEnd(18)} ${shape(env[name])}`);

  const envNames = Object.keys(env).sort();
  log(`all env keys (${envNames.length}): ${envNames.join(", ")}`);

  const nodeProcess = (globalThis as { process?: { env?: Record<string, unknown> } }).process;
  const processEnv = nodeProcess?.env ? Object.keys(nodeProcess.env).sort() : null;
  log(`process.env keys: ${processEnv ? `(${processEnv.length}) ${processEnv.join(", ")}` : "process.env unavailable"}`);

  // Tests the documented claim that "the key never reaches your code".
  const credentialBearing = envNames.filter((name) => looksLikeCredential(env[name]));
  log(`env values that look like a credential: ${credentialBearing.length === 0 ? "none" : credentialBearing.join(", ")}`);

  // ------------------------------------------------------------ the identity
  const origin = safeOrigin(env.WHOP_API_ORIGIN);
  log(`WHOP_API_ORIGIN resolved to: ${origin}${env.WHOP_API_ORIGIN ? "" : " (binding absent, defaulted)"}`);

  const appId = typeof env.APP_ID === "string" ? env.APP_ID : typeof env.WHOP_APP_ID === "string" ? env.WHOP_APP_ID : null;
  log(`app id binding: ${appId ?? "ABSENT"}`);

  let accountId = typeof env.WHOP_ACCOUNT_ID === "string" ? env.WHOP_ACCOUNT_ID : null;
  log(`WHOP_ACCOUNT_ID binding: ${accountId ?? "ABSENT"}`);

  // The derivation the spike recommended when the binding is missing.
  if (appId) {
    const app = await get(origin, `/api/v1/apps/${appId}`);
    const derived = (app.json as { account?: { id?: string } } | null)?.account?.id ?? null;
    log(`GET /apps/{APP_ID} -> ${app.status}, account.id = ${derived ?? "none"}`);
    if (!accountId && derived) {
      accountId = derived;
      log("  using the derived account id, confirming the fallback path works in hosted");
    }
  }

  // ----------------------------------------------------------- the proxy
  const me = await get(origin, "/api/v1/accounts/me");
  log(`GET /accounts/me with no key set by us -> ${me.status} (200 means the outbound proxy attached one)`);

  const optOut = await get(origin, "/api/v1/accounts/me", { "x-whop-inject-key": "none" });
  log(`GET /accounts/me with x-whop-inject-key: none -> ${optOut.status} (401 means the opt-out works)`);

  // ------------------------------------------ what the injected key may do
  if (!accountId) {
    log("no account id available, skipping the permission scan");
  } else {
    const perms = await get(origin, `/api/v1/permissions?resource_id=${accountId}`);
    const rows = ((perms.json as { data?: { action: string; granted: boolean }[] } | null)?.data ?? []);
    log(`GET /permissions?resource_id=… -> ${perms.status}, ${rows.length} actions returned`);

    if (rows.length > 0) {
      const granted = rows.filter((row) => row.granted);
      log(`  granted ${granted.length} / ${rows.length}  (the business API key scored 246 / 257)`);
      for (const action of DECISIVE_ACTIONS) {
        const row = rows.find((candidate) => candidate.action === action);
        log(`    ${action.padEnd(32)} ${row ? (row.granted ? "GRANTED" : "denied") : "not in enum"}`);
      }
      const deniedNames = rows.filter((row) => !row.granted).map((row) => row.action);
      log(`  denied (${deniedNames.length}): ${deniedNames.join(", ") || "(nothing)"}`);
    }
  }

  log("=== probe complete ===");
}

let done = false;

export default {
  /**
   * `request` is deliberately unused: the response is a constant and the probe
   * takes no input from the caller.
   */
  async fetch(_request: Request, env: Record<string, unknown>): Promise<Response> {
    if (!done) {
      done = true;
      try {
        await runProbe(env);
      } catch (error) {
        log(`probe threw: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }
    return new Response("ok", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  },
};
