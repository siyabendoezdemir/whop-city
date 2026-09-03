import { defineConfig, devices } from "@playwright/test";

/**
 * Interaction smoke tests against the running dev server.
 *
 * Uses the system Chrome rather than a downloaded browser build, since one is
 * already present in this environment.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.CITY_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          executablePath: "/usr/bin/google-chrome",
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
  ],
});
