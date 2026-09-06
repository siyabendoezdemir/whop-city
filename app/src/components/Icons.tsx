import type { ReactElement } from "react";

import type { DistrictId } from "../city/projection";
import type { Resource } from "../game/buildings";

/**
 * The icon set.
 *
 * Drawn rather than taken from a library, for the same reason the world is
 * modelled rather than photographed: these have to look like they belong to
 * the same city as the buildings. Solid shapes, no hairlines, readable at
 * eighteen pixels — a strategy HUD is read at a glance or not at all.
 */

export const RESOURCE_ICON: Record<Resource, ReactElement> = {
  gold: (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <ellipse cx="10" cy="14.2" rx="7.4" ry="3.2" opacity="0.5" />
      <ellipse cx="10" cy="11.4" rx="7.4" ry="3.2" opacity="0.75" />
      <ellipse cx="10" cy="8.4" rx="7.4" ry="3.2" />
      <ellipse cx="10" cy="8" rx="4.4" ry="1.7" fill="#fff6d8" opacity="0.75" />
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
      <path d="M3 17.4V9.2l7-5.6 7 5.6v8.2z" opacity="0.32" />
      <path d="M10 1.6 18.6 8.5l-1.2 1.5L10 4.2 2.6 10 1.4 8.5z" />
      <path d="M7.6 17.4v-4.9h4.8v4.9z" />
    </svg>
  ),
  recurring: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M16.4 8.2a6.8 6.8 0 1 0 .4 3.6" />
      <path d="M17.6 3.4v5h-5" />
    </svg>
  ),
};

/**
 * One mark per district, echoing what actually stands there: towers downtown,
 * a sawtooth shed at the forge, a terrace of narrow bays in the quarter.
 */
export const DISTRICT_ICON: Record<DistrictId, ReactElement> = {
  "commerce-core": (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 21V10h5v11z" opacity="0.55" />
      <path d="M9.5 21V4h5.5v17z" />
      <path d="M16.5 21v-8H21v8z" opacity="0.55" />
      <rect x="11.4" y="6.4" width="1.6" height="1.8" fill="#0000" stroke="none" />
    </svg>
  ),
  "offer-forge": (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 21v-7l4-3v3l4-3v3l4-3v10z" />
      <path d="M17 21V6h3v15z" opacity="0.6" />
      <path d="M17.2 5.2 18.5 2l1.3 3.2z" opacity="0.6" />
    </svg>
  ),
  "creator-quarter": (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 21v-8l3.2-2.6L8.4 13v8z" opacity="0.55" />
      <path d="M9 21v-9.6L12.6 8l3.6 3.4V21z" />
      <path d="M16.8 21v-7l3-2.4 2.2 1.8V21z" opacity="0.55" />
    </svg>
  ),
};

export function ResourceIcon({ resource }: { resource: Resource }) {
  return RESOURCE_ICON[resource];
}

export function DistrictIcon({ district }: { district: DistrictId }) {
  return DISTRICT_ICON[district];
}

/** A chevron, used for anything that opens or points. */
export function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 6.2 8 10.2l4-4" />
    </svg>
  );
}

/** The upgrade mark: the same chevron pair the world's bubbles carry. */
export function UpMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3.4 8.6 8 4l4.6 4.6" />
      <path d="M3.4 12.4 8 7.8l4.6 4.6" />
    </svg>
  );
}
