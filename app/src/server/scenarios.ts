/**
 * The names of the fixture scenarios.
 *
 * Deliberately separate from `fixtures.ts`, which holds the invented business
 * data. The snapshot route needs to resolve a scenario name for its cache key
 * even in a build that has no fixtures in it, and if that pulled in the fixture
 * module the bundler could not drop the data along with the dead branch.
 *
 * Nothing here describes a business. It is a closed list of words.
 */

export const FIXTURE_SCENARIOS = [
  "blank",
  "balanced",
  "launch",
  "thriving",
  "struggling",
  "unavailable",
] as const;
export type FixtureScenario = (typeof FIXTURE_SCENARIOS)[number];

export const DEFAULT_SCENARIO: FixtureScenario = "balanced";

/**
 * Resolves an untrusted string to a scenario.
 *
 * Closed allowlist with a silent fallback: an unknown value is not an error and
 * does not echo back, it is simply the default.
 */
export function resolveScenario(value: string | null | undefined): FixtureScenario {
  return FIXTURE_SCENARIOS.includes(value as FixtureScenario)
    ? (value as FixtureScenario)
    : DEFAULT_SCENARIO;
}
