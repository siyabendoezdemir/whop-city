/**
 * Runs the Whop capability probe against a dedicated test business and writes
 * a redacted report to `probe-reports/`.
 *
 *   # read-only sweep
 *   WHOP_TEST_ACCESS_TOKEN=... WHOP_TEST_BUSINESS_ID=biz_... pnpm probe
 *
 *   # include the one permitted write (creates a hidden draft product)
 *   WHOP_PROBE_ALLOW_WRITES=1 ... pnpm probe
 *
 * With no credentials it still runs, reports every capability as `skipped`,
 * and exits 0 — so it is safe to wire into CI as a smoke check.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WHOP_API_VERSION_PIN,
  WHOP_PRODUCTION_BASE_URL,
} from "../packages/whop-client/src/capability-manifest.ts";
import {
  WhopCapabilityProbe,
  type CapabilityStatus,
} from "../packages/whop-client/src/capability-probe.ts";

const STATUS_MARK: Record<CapabilityStatus, string> = {
  verified: "PASS",
  "scope-denied": "DENY",
  unauthenticated: "AUTH",
  unavailable: "GONE",
  "invalid-request": "ARGS",
  "rate-limited": "RATE",
  error: "FAIL",
  skipped: "SKIP",
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const accessToken = process.env.WHOP_TEST_ACCESS_TOKEN;
  const accountId = process.env.WHOP_TEST_BUSINESS_ID;
  const allowWrites = process.env.WHOP_PROBE_ALLOW_WRITES === "1";
  const baseUrl = process.env.WHOP_API_BASE_URL ?? WHOP_PRODUCTION_BASE_URL;

  const probe = new WhopCapabilityProbe({
    baseUrl,
    apiVersion: process.env.WHOP_API_VERSION ?? WHOP_API_VERSION_PIN,
    accessToken,
    accountId,
    allowWrites,
  });

  console.log(`base URL     ${baseUrl}`);
  console.log(`api version  ${process.env.WHOP_API_VERSION ?? WHOP_API_VERSION_PIN}`);
  console.log(`credential   ${accessToken ? "present" : "absent — every probe will be skipped"}`);
  console.log(`business     ${accountId ?? "absent"}`);
  console.log(`writes       ${allowWrites ? "ALLOWED (a real draft product may be created)" : "blocked"}`);
  console.log();

  const report = await probe.run();

  for (const capability of report.capabilities) {
    const scopes = capability.requiredScopes.join(", ") || "(bearer only)";
    console.log(
      `${STATUS_MARK[capability.status]}  ${capability.id.padEnd(32)} ${scopes.padEnd(28)} ${
        capability.detail ?? ""
      }`,
    );
  }

  console.log();
  if (report.permissions.status === "verified") {
    console.log(`granted: ${report.permissions.granted.join(", ") || "(none)"}`);
    console.log(`denied:  ${report.permissions.denied.join(", ") || "(none)"}`);
  } else {
    console.log(`permission check: ${report.permissions.status} ${report.permissions.detail ?? ""}`);
  }

  console.log();
  console.log(
    Object.entries(report.summary)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `${status}=${count}`)
      .join("  "),
  );

  const outDir = path.join(repoRoot, "probe-reports");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `capability-report-${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nreport: ${path.relative(repoRoot, outPath)} (git-ignored)`);
}

await main();
