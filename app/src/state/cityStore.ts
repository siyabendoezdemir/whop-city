/**
 * The city between visits.
 *
 * All that is kept is which levels the player has pressed the button on, per
 * business, in this browser. The business's own figures are never stored: they
 * are read fresh from Whop every time, because they are the truth and a cached
 * copy would only ever be a stale lie.
 */

import type { CityState } from "../game/city";

const PREFIX = "whop-city.game.v1";
const SCHEMA = 1;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadCity(seed: string): CityState | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(`${PREFIX}:${seed}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { schema?: number; state?: CityState };
    if (parsed?.schema !== SCHEMA || !parsed.state) return null;

    const state = parsed.state;
    if (state.seed !== seed || typeof state.claimed !== "object" || state.claimed === null) return null;

    // Levels only, and only sane ones. A hand-edited file is capped again at
    // read time by what the business earned, so this is belt and braces.
    const claimed: Record<string, number> = {};
    for (const [id, level] of Object.entries(state.claimed)) {
      if (typeof level === "number" && Number.isInteger(level) && level > 0 && level <= 5) {
        claimed[id] = level;
      }
    }

    return {
      seed,
      claimed,
      lastSeenAt: typeof state.lastSeenAt === "number" ? state.lastSeenAt : 0,
      lastSeen: state.lastSeen ?? null,
    };
  } catch {
    return null;
  }
}

export function saveCity(state: CityState): void {
  try {
    storage()?.setItem(`${PREFIX}:${state.seed}`, JSON.stringify({ schema: SCHEMA, state }));
  } catch {
    // Full or refused. Play continues; the city just will not be here later.
  }
}
