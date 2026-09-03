import { defineConfig } from "vitest/config";

/**
 * Deliberately separate from `vite.config.ts`. The app config loads the
 * Cloudflare, TanStack Start, and React plugins, which the test runner does not
 * need and cannot boot inside its worker.
 */
export default defineConfig({
  define: {
    __WHOP_DEV_PROXY__: "null",
    __WHOP_DEV_APP_ID__: "null",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    reporters: ["verbose"],
  },
});
