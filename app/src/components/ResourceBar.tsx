import type { CityMetrics } from "../city/projection";
import { RESOURCE, RESOURCES, money, type Resource } from "../game/buildings";
import { RESOURCE_ICON } from "./Icons";

/**
 * The four resources, along the top.
 *
 * Built like a Clash of Clans resource bar: a dark capsule with a jewelled
 * badge sitting proud of its left edge, the number big and right of it, and a
 * distinct material per resource so they are told apart at a glance rather
 * than read. Gold is money taken, Citizens are the people paying, Footfall is
 * who came through today, Reserve is the part that comes back every month.
 *
 * Every figure is real and comes from the business's own Whop stats. Nothing
 * here ticks up on its own — and when Whop would not answer, the capsules show
 * a dash rather than a nought, because a row of noughts is a claim about the
 * business and a dash is a claim about the reading.
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
    <div className="res" data-source={metrics.source} aria-label="Your business">
      {RESOURCES.map((resource) => (
        <div key={resource} className="res__pill" data-resource={resource} data-tone={RESOURCE[resource].tone}>
          <span className="res__badge" aria-hidden="true">
            {RESOURCE_ICON[resource]}
          </span>
          <span className="res__figures">
            <span className="res__value" data-testid={`res-${resource}`}>
              {known ? money(resource, metrics[resource]) : "—"}
            </span>
            <span className="res__name">{RESOURCE[resource].name}</span>
          </span>
          {move[resource] && move[resource] !== "flat" ? (
            <span className="res__move" data-move={move[resource]} aria-hidden="true">
              {move[resource] === "up" ? "▲" : "▼"}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
