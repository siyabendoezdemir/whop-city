import type { ReactElement } from "react";

import type { CityMetrics } from "../city/projection";
import { RESOURCE, RESOURCES, money, type Resource } from "../game/buildings";

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
 * here ticks up on its own.
 */

const ICON: Record<Resource, ReactElement> = {
  gold: (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <ellipse cx="10" cy="14.4" rx="7.4" ry="3.2" opacity="0.55" />
      <ellipse cx="10" cy="11.6" rx="7.4" ry="3.2" opacity="0.8" />
      <ellipse cx="10" cy="8.6" rx="7.4" ry="3.2" />
      <ellipse cx="10" cy="8.2" rx="4.6" ry="1.8" fill="#fff6d8" opacity="0.75" />
    </svg>
  ),
  citizens: (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <circle cx="7.4" cy="6.6" r="3.4" />
      <path d="M1.4 17.6c0-3.2 2.7-5.4 6-5.4s6 2.2 6 5.4z" />
      <circle cx="14.6" cy="7.8" r="2.6" opacity="0.6" />
      <path d="M12.4 17.6c0-2.4 1.2-4 3.2-4 1.9 0 3 1.4 3 4z" opacity="0.6" />
    </svg>
  ),
  traffic: (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 1.6c3.1 3.4 4.7 6.2 4.7 8.6a4.7 4.7 0 1 1-9.4 0c0-2.4 1.6-5.2 4.7-8.6z" />
      <path d="M10 6.4c1.6 1.9 2.4 3.4 2.4 4.6a2.4 2.4 0 1 1-4.8 0c0-1.2.8-2.7 2.4-4.6z" fill="#fff" opacity="0.42" />
    </svg>
  ),
  recurring: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M16.6 8.4a6.8 6.8 0 1 0 .3 3.4" />
      <path d="M17.4 3.6v4.9h-4.9" />
    </svg>
  ),
};

export function ResourceIcon({ resource }: { resource: Resource }) {
  return ICON[resource];
}

function delta(now: number, before: number): "up" | "down" | "flat" {
  if (before === 0 && now === 0) return "flat";
  if (now > before) return "up";
  if (now < before) return "down";
  return "flat";
}

export function ResourceBar({ metrics }: { metrics: CityMetrics }) {
  const move: Partial<Record<Resource, "up" | "down" | "flat">> = {
    gold: delta(metrics.gold, metrics.goldBefore),
    traffic: delta(metrics.traffic, metrics.trafficBefore),
  };

  return (
    <div className="res" data-source={metrics.source} aria-label="Your business">
      {RESOURCES.map((resource) => (
        <div key={resource} className="res__pill" data-resource={resource} data-tone={RESOURCE[resource].tone}>
          <span className="res__badge" aria-hidden="true">
            {ICON[resource]}
          </span>
          <span className="res__figures">
            <span className="res__value" data-testid={`res-${resource}`}>
              {money(resource, metrics[resource])}
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
