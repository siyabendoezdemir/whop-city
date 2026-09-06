import type { CityMetrics } from "../city/projection";
import { RESOURCE, RESOURCES, money, type Resource } from "../game/buildings";
import { RESOURCE_ICON } from "./Icons";

/**
 * Your four numbers, along the top.
 *
 * Built like a Clash of Clans resource bar — a dark capsule with a jewelled
 * badge proud of its left edge, the figure big and right of it — with one
 * deliberate departure: the label under each figure is the **Whop metric**,
 * not a game word. Gold and Reserve read as invented currency, and a player
 * looking at "0 Reserve" cannot tell whether that is a real fact about their
 * business or a thing the game has not given them yet.
 *
 * Hovering a capsule says the same thing at length. Nothing here ticks up on
 * its own, and when Whop would not answer the capsules show a dash rather than
 * a nought: a nought is a claim about the business, a dash is a claim about the
 * reading.
 */

function delta(now: number, before: number): "up" | "down" | "flat" {
  if (before === 0 && now === 0) return "flat";
  if (now > before) return "up";
  if (now < before) return "down";
  return "flat";
}

export function ResourceBar({ metrics }: { metrics: CityMetrics }) {
  const known = metrics.source === "owner";
  const move: Partial<Record<Resource, "up" | "down" | "flat">> = known
    ? { gold: delta(metrics.gold, metrics.goldBefore), traffic: delta(metrics.traffic, metrics.trafficBefore) }
    : {};

  return (
    <div className="res" data-source={metrics.source} aria-label="Your Whop, in four numbers">
      {RESOURCES.map((resource) => {
        const words = RESOURCE[resource];
        return (
          <div
            key={resource}
            className="res__pill"
            data-resource={resource}
            data-tone={words.tone}
            title={`${words.full} — ${words.blurb}`}
          >
            <span className="res__badge" aria-hidden="true">
              {RESOURCE_ICON[resource]}
            </span>
            <span className="res__figures">
              <span className="res__value" data-testid={`res-${resource}`}>
                {known ? money(resource, metrics[resource]) : "—"}
              </span>
              <span className="res__name">{words.name}</span>
            </span>
            {move[resource] && move[resource] !== "flat" ? (
              <span className="res__move" data-move={move[resource]} aria-hidden="true">
                {move[resource] === "up" ? "▲" : "▼"}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
