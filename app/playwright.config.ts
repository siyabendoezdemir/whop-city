import { defineConfig, devices } from "@playwright/test";

import { GL_ARGS, chromeExecutable } from "./capture/env.mjs";

/**
 * Browser tests run against the built app on the preview server, not the dev
 * bundle, so what is under test is what would ship.
 *
 * WebGL comes from SwiftShader: this machine has no GPU, and a city that
 * silently falls back to a blank canvas would pass a test that only checked the
 * DOM. The timeouts are generous for the same reason — software-rendering a
 * supersampled city is slow.
 */
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.CITY_URL ?? "http://localhost:4173",
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: GL_ARGS, executablePath: chromeExecutable() },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.CITY_URL
    ? undefined
    : {
        command: "pnpm preview --port 4173",
        url: "http://localhost:4173/api/city/snapshot",
        // Never borrow a server someone else started. `vite preview` loads the
        // server bundle into memory at boot, so a reused process keeps serving
        // whichever build it was started against — which is how a production
        // privacy run once passed while pointed at a fixtures server. If the
        // port is busy the run fails loudly, which is the correct outcome.
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
