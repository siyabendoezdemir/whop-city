import { defineConfig } from "vite";

// Self-contained spike. No proxies, no env, no network at runtime.
export default defineConfig({
  server: { host: "127.0.0.1", port: 5190 },
  build: { target: "es2022" },
});
