import { defineConfig } from "vitest/config";

/**
 * Deliberately not the app's vite config.
 *
 * These are node-side tests of the privacy boundary and the snapshot route.
 * Loading the full app config would drag in the Cloudflare, TanStack Start and
 * React plugins, which do not belong in a unit test run and have historically
 * broken it in ways that had nothing to do with the code under test.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
