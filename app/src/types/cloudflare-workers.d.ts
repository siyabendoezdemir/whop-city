/**
 * Minimal declaration for the Workers runtime module.
 *
 * Only the binding bag is used, and only through a guarded dynamic import in
 * `src/server/city.ts`, so pulling in the full Workers type package would be
 * more surface than this needs.
 */
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

/**
 * Dev-only wiring injected by `vite.config.ts`. Both are `null` in a build, so
 * nothing here reaches production output. Neither is a secret: the dev proxy is
 * a localhost origin and the app id is public on `GET /apps/{id}`.
 */
declare const __WHOP_DEV_PROXY__: string | null;
declare const __WHOP_DEV_APP_ID__: string | null;
