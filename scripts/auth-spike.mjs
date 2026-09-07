#!/usr/bin/env node
// Read-only operator-auth and runtime spike against a Whop business.
//
// Answers the questions in docs/website-auth-spike.md using the Whop CLI, and
// writes a redacted report to probe-reports/ (git-ignored).
//
// The credential is never passed as an argument and never written to disk: it
// is read by the CLI from WHOP_API_KEY in this process's environment, and every
// line of output is scrubbed before it is printed or saved.
//
// This script cannot mutate anything. Every CLI invocation is checked against
// an allowlist of read-only verbs, and a call that is not on the list throws.
//
// Usage:
//   WHOP_API_KEY=... node scripts/auth-spike.mjs [--account biz_x] [--app app_x]

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

const API = "https://api.whop.com";
const API_VERSION = "2026-09-02-2";

// Only these CLI verbs may ever be invoked. Anything else is a bug or an
// attempted mutation, and throws before it reaches the network.
const READ_ONLY_VERBS = new Set(["get", "list", "check", "access"]);

const secrets = ["WHOP_API_KEY", "WHOP_APP_SECRET", "WHOP_CLIENT_SECRET"]
  .map((n) => process.env[n])
  .filter((v) => typeof v === "string" && v.length >= 12);

function scrub(text) {
  let out = String(text);
  for (const secret of secrets) out = out.split(secret).join("[REDACTED]");
  // Mask e-mail local parts: this report is attached to a public repository.
  return out.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+)/g, "$1***$2");
}

const lines = [];
function say(text = "") {
  const clean = scrub(text);
  lines.push(clean);
  console.log(clean);
}

async function whop(args) {
  const verb = args.find((a) => READ_ONLY_VERBS.has(a));
  if (!verb) {
    throw new Error(`refusing to run a non-read-only whop command: ${args.join(" ")}`);
  }
  const { stdout } = await run("whop", [...args, "--format", "json"], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

// Unauthenticated fetch, used to prove which endpoints are world-readable.
async function anon(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Api-Version-Date": API_VERSION },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!process.env.WHOP_API_KEY) {
    console.error("WHOP_API_KEY is not set in the environment. Nothing to do.");
    process.exit(1);
  }

  say(`# Whop operator-auth spike`);
  say(`run at        : ${new Date().toISOString()}`);
  say(`api version   : ${API_VERSION}`);
  say();

  // ---------------------------------------------------------------- identity
  let accountId = arg("--account");
  if (!accountId) {
    const accounts = await whop(["accounts", "list"]);
    accountId = accounts.data?.[0]?.id;
  }
  const account = await whop(["accounts", "get", accountId]);
  say(`## Business`);
  say(`  id     : ${account.id}`);
  say(`  title  : ${account.title}`);
  say(`  route  : ${account.route}`);
  say(`  status : ${account.status}`);
  say();

  // ------------------------------------------------------- granted authority
  const perms = await whop(["permissions", "check", "--resource_id", accountId]);
  const rows = perms.data ?? [];
  const granted = rows.filter((r) => r.granted).map((r) => r.action);
  const denied = rows.filter((r) => !r.granted).map((r) => r.action);

  say(`## What this credential may do on the business`);
  say(`  actions in enum : ${rows.length}`);
  say(`  granted         : ${granted.length}`);
  say(`  denied          : ${denied.length}`);
  say();
  say(`  decisive for the architecture:`);
  for (const action of [
    "company:authorized_user:read",
    "company:authorized_user:email:read",
    "developer:update_app",
    "developer:manage_oauth",
    "developer:manage_webhook",
  ]) {
    const hit = rows.find((r) => r.action === action);
    say(`    ${action.padEnd(38)} ${!hit ? "not in enum" : hit.granted ? "GRANTED" : "denied"}`);
  }
  say();
  say(`  destructive actions this credential holds:`);
  for (const action of [
    "company:delete",
    "company:transfer_ownership",
    "payout:withdraw_funds",
    "payout:transfer_funds",
    "payment:charge",
    "access_pass:delete",
  ]) {
    const hit = rows.find((r) => r.action === action);
    if (hit?.granted) say(`    ${action}`);
  }
  say();
  say(`  denied: ${denied.length ? denied.join(", ") : "(nothing)"}`);
  say();

  // ------------------------------------------------------- the operator gate
  say(`## Operator gate — GET /team_members`);
  const team = await whop([
    "team-members", "list",
    "--account_id", accountId,
    "--status", "joined",
  ]);
  for (const m of team.data ?? []) {
    say(`  ${m.id}`);
    say(`    role            : ${m.role}`);
    say(`    authorized_role : ${m.authorized_role}`);
    say(`    status          : ${m.status}`);
    say(`    is_agent        : ${m.is_agent}`);
    say(`    email returned  : ${m.email === null ? "null" : "POPULATED — scope is granted"}`);
    say(`    user            : ${m.user?.id} (@${m.user?.username})`);
  }
  say();

  // ------------------------------------------- access level, member and not
  say(`## Fallback gate — GET /users/{id}/access/{resource}`);
  const owner = team.data?.[0]?.user?.id;
  if (owner) {
    const a = await whop(["users", "access", owner, accountId]);
    say(`  owner ${owner}`);
    say(`    has_access=${a.has_access} access_level=${a.access_level}`);
  }
  for (const username of ["whop", "jack"]) {
    const pub = await anon(`/api/v1/users/${username}`);
    const id = pub.body?.id;
    if (!id) continue;
    const a = await whop(["users", "access", id, accountId]);
    say(`  non-member @${username} (${id})`);
    say(`    has_access=${a.has_access} access_level=${a.access_level}`);
    const t = await whop([
      "team-members", "list",
      "--account_id", accountId,
      "--user_id", id,
      "--status", "joined",
    ]);
    say(`    team_members rows=${(t.data ?? []).length} (HTTP 200 — deny is an empty array, not an error)`);
  }
  say();

  // ---------------------------------------------------------------- the app
  const appId = arg("--app") ?? (await whop(["apps", "list"])).data?.[0]?.id;
  if (appId) {
    const app = await whop(["apps", "get", appId]);
    say(`## App record — GET /apps/{id}`);
    say(`  id                : ${app.id}`);
    say(`  app_type          : ${app.app_type}`);
    say(`  route             : ${app.route}`);
    say(`  hosted_url        : ${app.hosted_url}`);
    say(`  oauth_client_type : ${app.oauth_client_type}`);
    say(`  redirect_uris     : ${JSON.stringify(app.redirect_uris)}`);
    say(`  required_scopes   : ${JSON.stringify(app.required_scopes)}`);
    say(`  product_id        : ${app.product_id}`);
    say(`  account.id        : ${app.account?.id}`);
    say();

    const anonApp = await anon(`/api/v1/apps/${appId}`);
    say(`## Is the app record world-readable?`);
    say(`  unauthenticated GET /apps/{id} -> HTTP ${anonApp.status}`);
    say(`  exposes redirect_uris     : ${anonApp.body?.redirect_uris !== undefined}`);
    say(`  exposes oauth_client_type : ${anonApp.body?.oauth_client_type !== undefined}`);
    say(`  exposes account.id        : ${anonApp.body?.account?.id !== undefined}`);
    say(`  exposes secrets           : ${JSON.stringify(anonApp.body?.secrets)}`);
    say();

    if (app.product_id) {
      const anonProd = await anon(`/api/v1/products/${app.product_id}`);
      say(`## Is the app's product world-readable?`);
      say(`  unauthenticated GET /products/{id} -> HTTP ${anonProd.status}`);
      say(`  exposes metadata : ${anonProd.body?.metadata !== undefined} -> ${JSON.stringify(anonProd.body?.metadata)}`);
      say(`  visibility       : ${anonProd.body?.visibility}`);
      say();
    }
  }

  // ------------------------------------------------------- error envelopes
  say(`## Error envelopes`);
  const notFound = await anon(`/api/v1/apps/app_definitelynotreal`);
  say(`  API   : HTTP ${notFound.status} ${JSON.stringify(notFound.body)}`);
  const oauth = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=__probe__",
  });
  say(`  OAuth : HTTP ${oauth.status} ${JSON.stringify(await oauth.json())}`);
  say();

  await mkdir("probe-reports", { recursive: true });
  const path = `probe-reports/auth-spike-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  await writeFile(path, lines.join("\n") + "\n", "utf8");
  console.log(`\nreport written to ${path} (git-ignored)`);
}

main().catch((err) => {
  console.error(scrub(err?.message ?? String(err)));
  process.exit(1);
});
