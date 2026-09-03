import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CityWorld } from "../components/CityWorld";
import { DistrictInspector } from "../components/DistrictInspector";
import { FirstLoad } from "../components/FirstLoad";
import { loadCityProjection } from "../server/city";
import type { DistrictId } from "../server/projection";

export const Route = createFileRoute("/")({
  loader: async () => loadCityProjection(),
  component: City,
});

function City() {
  const projection = Route.useLoaderData();
  const [selected, setSelected] = useState<DistrictId | null>(null);
  const [focusToken, setFocusToken] = useState(0);

  // Flips once hydration has run, which is the moment the world actually
  // becomes clickable. The reveal overlay waits for this rather than a timer.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const select = useCallback((id: DistrictId | null) => {
    setSelected(id);
    setFocusToken((token) => token + 1);
  }, []);

  const district = useMemo(
    () => projection.districts.find((candidate) => candidate.id === selected) ?? null,
    [projection.districts, selected],
  );

  const live = projection.freshness === "live";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          Whop City
          <span className="brand-sub">· a business you can walk through</span>
        </div>

        <div className="topbar-spacer" />

        <span className="chip" data-testid="freshness-chip">
          <span className="chip-dot" data-state={live ? "live" : "unavailable"} />
          {live ? "Live snapshot" : "Business unreadable"}
        </span>
        <span className="chip" data-testid="city-tier-chip">
          City tier {projection.cityTier} / 5
        </span>
        <span className="chip">Public view</span>
      </header>

      <CityWorld projection={projection} selected={selected} onSelect={select} focusToken={focusToken} />

      {district ? (
        <DistrictInspector
          district={district}
          freshness={projection.freshness}
          capturedAt={projection.capturedAt}
          onClose={() => select(null)}
        />
      ) : null}

      {!live ? (
        <div className="notice" role="status" data-testid="unavailable-notice">
          The business could not be read. Districts are shown dormant rather than estimated.
        </div>
      ) : null}

      <p className="sr-only">
        Whop City renders a privacy-safe projection of a Whop business. It shows district tier,
        health, direction, and freshness only. No revenue, customer records, product names, or
        pricing reach this page.
      </p>

      <FirstLoad ready={hydrated} />
    </div>
  );
}
