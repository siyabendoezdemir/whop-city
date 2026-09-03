import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts", "packages/**/*.spec.ts"],
    environment: "node",
    // The live sandbox probe reaches the real Whop API and is slower than a unit test.
    testTimeout: 30_000,
  },
});
