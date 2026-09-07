/**
 * Minimal declaration for the Workers runtime module.
 *
 * Only the binding bag is used, and only through a guarded dynamic import in
 * `src/server/env.ts`, so pulling in the full Workers type package would be
 * more surface than this needs.
 */
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
