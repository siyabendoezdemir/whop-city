import type { ReactElement } from "react";

import type { CityMetrics } from "../city/projection";
import { RESOURCE, RESOURCES, type Resource } from "../game/buildings";

/**
 * The real numbers, along the top.
 *
 * These are counts from the business's own Whop account and they are the only
 * currency the game has. A pill going up means the business went up; there is
 * nothing here that ticks on its own.
 */

const ICON: Record<Resource, ReactElement> = {
  customers: (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="5" r="2.9" />
      <path d="M1 14.2c0-2.6 2.2-4.4 5-4.4s5 1.8 5 4.4z" />
      <circle cx="12.2" cy="6" r="2.2" opacity="0.65" />
      <path d="M10.4 14.2c0-1.9 1-3.2 2.6-3.2 1.5 0 2.4 1.1 2.4 3.2z" opacity="0.65" />
    </svg>
  ),
  products: (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.4 14.6 5v6L8 14.6 1.4 11V5z" opacity="0.9" />
      <path d="M8 1.4 14.6 5 8 8.6 1.4 5z" />
    </svg>
  ),
  waysToBuy: (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="1.2" y="3.4" width="13.6" height="9.6" rx="1.6" />
      <rect x="1.2" y="5.8" width="13.6" height="2" fill="#3a2405" opacity="0.55" />
    </svg>
  ),
  affiliates: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
      <path d="M6.4 9.6 9.6 6.4" />
      <path d="M9.2 4.4 10.6 3a2.9 2.9 0 1 1 4.1 4.1l-1.4 1.4" />
      <path d="M6.8 11.6 5.4 13a2.9 2.9 0 1 1-4.1-4.1l1.4-1.4" />
    </svg>
  ),
  bestRate: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
      <path d="M3.4 12.6 12.6 3.4" />
      <circle cx="4.7" cy="4.7" r="1.9" />
      <circle cx="11.3" cy="11.3" r="1.9" />
    </svg>
  ),
};

export function ResourceIcon({ resource }: { resource: Resource }) {
  return ICON[resource];
}

export function ResourceBar({ metrics }: { metrics: CityMetrics }) {
  const withheld = metrics.source !== "owner";

  return (
    <div className="res" data-source={metrics.source} aria-label="Your business">
      {RESOURCES.map((resource) => (
        <div key={resource} className="res__pill" data-resource={resource}>
          <span className="res__icon" aria-hidden="true">
            {ICON[resource]}
          </span>
          <span className="res__stack">
            <span className="res__value" data-testid={`res-${resource}`}>
              {metrics[resource]}
              {RESOURCE[resource].suffix ?? ""}
            </span>
            <span className="res__name">{RESOURCE[resource].name}</span>
          </span>
        </div>
      ))}

      {withheld ? (
        <p className="res__locked">
          Your real figures show in your Whop dashboard. This is the public view.
        </p>
      ) : null}
    </div>
  );
}
