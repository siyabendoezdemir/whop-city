/**
 * Build-time constants, replaced by `vite.config.ts`.
 *
 * `__CITY_FIXTURES_BUILD__` is the literal `false` in a deployable build, which
 * is what lets the bundler delete the fixture branch and, with it, the fixture
 * module and every piece of invented business data inside it. Referencing it
 * directly at a branch — rather than through a function — is what makes that
 * elimination provable to the bundler.
 */
declare const __CITY_FIXTURES_BUILD__: boolean;
