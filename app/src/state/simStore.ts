/**
 * Keeping the city between visits.
 *
 * Local to this browser and keyed by the projection's opaque seed, exactly as
 * the operator log is: two businesses opened in the same browser keep separate
 * cities and neither can read the other's.
 *
 * Nothing about the business is stored. The saved city is plot levels, trades,
 * a credit balance and a clock — all of it invented by play.
 */

import type { GameState, Plot } from "../game/state";
import type { Trade } from "../game/catalog";

const PREFIX = "whop-city.sim.v1";
const SCHEMA = 1;

type Saved = { schema: number; state: GameState };

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

const TRADES = new Set<string>(["market", "arcade", "signal", "stage", "foundry", "depot"]);

function isPlot(value: unknown): value is Plot {
  if (typeof value !== "object" || value === null) return false;
  const plot = value as Record<string, unknown>;
  return (
    typeof plot.id === "string" &&
    typeof plot.district === "string" &&
    typeof plot.level === "number" &&
    plot.level >= 0 &&
    (plot.trade === null || (typeof plot.trade === "string" && TRADES.has(plot.trade))) &&
    typeof plot.derelict === "boolean" &&
    (plot.offline === null || plot.offline === "capacity" || plot.offline === "funds") &&
    typeof plot.built === "number"
  );
}

/**
 * Reads a saved city, or nothing.
 *
 * A save that does not parse cleanly is dropped rather than repaired: a
 * half-understood city would produce an economy the player cannot reason
 * about, and founding a fresh one is honest and instant.
 */
export function loadCity(seed: string): GameState | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(`${PREFIX}:${seed}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Saved;
    if (parsed?.schema !== SCHEMA) return null;

    const state = parsed.state;
    if (
      typeof state?.seed !== "string" ||
      state.seed !== seed ||
      typeof state.credits !== "number" ||
      !Number.isFinite(state.credits) ||
      state.credits < 0 ||
      !Array.isArray(state.plots) ||
      !state.plots.every(isPlot) ||
      typeof state.ticks !== "number" ||
      typeof state.lastTickAt !== "number"
    ) {
      return null;
    }

    return {
      seed,
      credits: state.credits,
      plots: state.plots,
      works: Array.isArray(state.works) ? state.works.filter((w): w is Trade & never => typeof w === "string") : [],
      ticks: Math.max(0, Math.floor(state.ticks)),
      lastTickAt: state.lastTickAt,
      events: Array.isArray(state.events) ? state.events.slice(0, 24) : [],
    } as GameState;
  } catch {
    return null;
  }
}

export function saveCity(state: GameState): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(`${PREFIX}:${state.seed}`, JSON.stringify({ schema: SCHEMA, state } satisfies Saved));
  } catch {
    // Full, or refused. Play continues; the city just will not be there later.
  }
}

export function forgetCity(seed: string): void {
  try {
    storage()?.removeItem(`${PREFIX}:${seed}`);
  } catch {
    /* nothing to do */
  }
}
