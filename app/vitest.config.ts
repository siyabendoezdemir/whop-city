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
  /**
   * Unit tests run with fixtures compiled in, so the fixture-backed paths are
   * exercisable. The production side of the guard is asserted by passing the
   * flag explicitly, and proved against a real deployable build in
   * `tests/productionBuild.test.ts`.
   */
  define: { __CITY_FIXTURES_BUILD__: "true" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
