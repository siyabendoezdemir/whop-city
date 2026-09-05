import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import { DISTRICT_NAMES } from "../city/explain";
import { parseProjection, type PublicCityProjection } from "../city/projection";
import { BUILDINGS, buildingById, nextTier } from "../game/buildings";
import {
  claim,
  cityTier,
  markSeen,
  newCity,
  readyCount,
  totalLevels,
  viewAll,
  viewOf,
  type CityState,
} from "../game/city";
import { loadCity, saveCity } from "../state/cityStore";
import { Advisor } from "./Advisor";
import { BuildingCard } from "./BuildingCard";
import { DesktopOnly } from "./DesktopOnly";
import { ResourceBar } from "./ResourceBar";
import { Seal } from "./Glyphs";

const CityCanvas = lazy(() =>
  import("./CityCanvas").then((module) => ({ default: module.CityCanvas })),
);

/**
 * Whop City.
 *
 * A city you fly around, made of buildings that level up when your Whop
 * business does. There is one loop and it is short: see a building with a
 * green arrow over it, click it, read what it cost — five customers, three
 * products — and press the button. The city grows toward a skyline.
 *
 * Nothing here simulates a business. Every number on screen came out of the
 * account, and the only way to move one is to go and move it for real.
 */

const SNAPSHOT_ENDPOINT = "/api/city/snapshot";
/** Whop's own figures move slowly; a minute is plenty and is kind to the API. */
const REFRESH_MS = 60_000;

type Load =
  | { status: "loading" }
  | { status: "ready"; projection: PublicCityProjection }
  | { status: "failed" };

function endpointUrl(): string {
  if (typeof location === "undefined") return SNAPSHOT_ENDPOINT;
  const scenario = new URLSearchParams(location.search).get("scenario");
  return scenario ? `${SNAPSHOT_ENDPOINT}?scenario=${encodeURIComponent(scenario)}` : SNAPSHOT_ENDPOINT;
}

export function CityShell() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [city, setCity] = useState<CityState | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [framing, setFraming] = useState<string>("city");
  const [zoom, setZoom] = useState(1);
  const [badges, setBadges] = useState<Array<{ id: string; x: number; y: number; n: number }>>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [advisorOpen, setAdvisorOpen] = useState(true);
  const [tooSmall, setTooSmall] = useState(false);

  /**
   * A phone is not a screen you can play this on.
   *
   * Measured rather than sniffed: what matters is whether there is room for a
   * city and a card side by side, not what the device calls itself.
   */
  useEffect(() => {
    const check = () => setTooSmall(window.innerWidth < 900 || window.innerHeight < 560);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const projection = load.status === "ready" ? load.projection : null;
  const metrics = projection?.metrics ?? null;

  // ------------------------------------------------------------- the data
  const fetchProjection = useCallback(async () => {
    const response = await fetch(endpointUrl(), { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("unavailable");
    return parseProjection(await response.json());
  }, []);

  useEffect(() => {
    let alive = true;
    fetchProjection()
      .then((next) => {
        if (!alive) return;
        setLoad({ status: "ready", projection: next });
        setCity(loadCity(next.seed) ?? newCity(next.seed, Date.now()));
      })
      .catch(() => alive && setLoad({ status: "failed" }));

    // The business keeps moving while the city is open, so the city keeps up.
    const timer = window.setInterval(() => {
      fetchProjection()
        .then((next) => alive && setLoad({ status: "ready", projection: next }))
        .catch(() => undefined);
    }, REFRESH_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [fetchProjection]);

  const views = useMemo(
    () => (city && metrics ? viewAll(city, metrics) : []),
    [city, metrics],
  );
  const waiting = city && metrics ? readyCount(city, metrics) : 0;
  const levels = city && metrics ? totalLevels(city, metrics) : 0;
  const tier = city && metrics ? cityTier(city, metrics) : null;
  const upcoming = nextTier(levels);

  const persist = useCallback((next: CityState) => {
    setCity(next);
    saveCity(next);
  }, []);

  const upgrade = useCallback(
    (id: string) => {
      if (!city || !metrics) return;
      const before = viewOf(buildingById(id)!, city, metrics).level;
      const next = claim(city, id, metrics);
      const after = viewOf(buildingById(id)!, next, metrics).level;
      if (after === before) return;
      persist(next);
      setFlash(`${buildingById(id)!.name} is now level ${after}`);
    },
    [city, metrics, persist],
  );

  // Remember what the business looked like, so a return can say what moved.
  useEffect(() => {
    if (!city || !metrics) return;
    const timer = window.setTimeout(() => persist(markSeen(city, metrics, Date.now())), 4_000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2_600);
    return () => window.clearTimeout(timer);
  }, [flash]);

  /**
   * Green arrows over anything ready.
   *
   * Positioned from the renderer's own projection of each plot, refreshed on a
   * timer rather than every frame: eleven badges do not need sixty updates a
   * second, and the camera glide settles well inside this.
   */
  useEffect(() => {
    const tick = () => {
      const hooks = window.__city;
      if (!hooks?.ready) return;
      setBadges(
        views
          .filter((view) => view.ready > 0)
          .map((view) => {
            const at = hooks.plotPoint(view.building.id);
            return at ? { id: view.building.id, x: at.x, y: at.y, n: view.ready } : null;
          })
          .filter((badge): badge is { id: string; x: number; y: number; n: number } => badge !== null),
      );
    };
    tick();
    const timer = window.setInterval(tick, 300);
    return () => window.clearInterval(timer);
  }, [views]);

  const pickedView = picked ? views.find((view) => view.building.id === picked) ?? null : null;

  const goTo = useCallback((id: string) => {
    setPicked(id);
    const building = buildingById(id);
    if (building) setFraming(building.district);
  }, []);

  // ----------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        setPicked(null);
        setFraming("city");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (tooSmall) return <DesktopOnly />;

  if (load.status === "loading") {
    return (
      <main className="city">
        <div className="boot" role="status">
          <span className="boot__name">Whop City</span>
          <span>Surveying the ground…</span>
        </div>
      </main>
    );
  }

  if (load.status === "failed" || !projection || !city || !metrics || !tier) {
    return (
      <main className="city">
        <div className="boot" role="status">
          <span className="boot__name">Whop City</span>
          <span>Could not reach your business. Try again in a moment.</span>
        </div>
      </main>
    );
  }

  return (
    <main className="city" data-freshness={projection.freshness} data-tier={tier.level}>
      <Suspense fallback={null}>
        <CityCanvas
          projection={projection}
          framing={framing as never}
          zoom={zoom}
          levels={Object.fromEntries(views.map((view) => [view.building.id, view.level]))}
          selected={picked}
          onSelectPlot={goTo}
          onSelectDistrict={(key) => {
            setFraming(key);
            setPicked(null);
          }}
          onUnavailable={() => undefined}
        />
      </Suspense>

      {/* ------------------------------------------------------------ tier */}
      <div className="tier" data-testid="tier">
        <Seal className="tier__crest" />
        <span className="tier__text">
          <span className="tier__name">{tier.name}</span>
          <span className="tier__levels">
            {upcoming ? `${levels} / ${upcoming.at} to ${upcoming.name}` : `${levels} levels — as grand as it gets`}
          </span>
        </span>
      </div>

      <ResourceBar metrics={metrics} />

      {/* --------------------------------------------------- ready to press */}
      {badges.map((badge) => (
        <button
          key={badge.id}
          type="button"
          className="ready"
          data-ready={badge.id}
          style={{ left: badge.x, top: badge.y }}
          aria-label={`${buildingById(badge.id)?.name}: ${badge.n} upgrade ready`}
          onClick={() => goTo(badge.id)}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 13V4" />
            <path d="M3.6 8.4 8 3.6l4.4 4.8" />
          </svg>
          {badge.n > 1 ? <span className="ready__n">{badge.n}</span> : null}
        </button>
      ))}

      <Advisor metrics={metrics} open={advisorOpen && !pickedView} onToggle={() => setAdvisorOpen((was) => !was)} />

      {metrics.source !== "owner" ? (
        <p className="public-note">
          This is the public view, so the figures read zero. Open it from your Whop dashboard to play
          with your own.
        </p>
      ) : null}

      {pickedView ? (
        <BuildingCard view={pickedView} onUpgrade={() => upgrade(pickedView.building.id)} onClose={() => setPicked(null)} />
      ) : null}

      {flash ? (
        <p className="toast surface" role="status">
          {flash}
        </p>
      ) : null}

      {/* ------------------------------------------------------ nothing ready */}
      {waiting === 0 && !pickedView ? (
        <p className="nudge surface" role="status">
          {metrics.source === "owner"
            ? "Nothing to upgrade yet. Grow the business and the city follows."
            : "Open this from your Whop dashboard to see your own figures."}
        </p>
      ) : null}

      <div className="camera surface" role="group" aria-label="Camera">
        <button type="button" data-cam="in" aria-label="Zoom in" onClick={() => setZoom((z) => Math.max(0.45, z - 0.15))}>
          +
        </button>
        <button type="button" data-cam="out" aria-label="Zoom out" onClick={() => setZoom((z) => Math.min(1.6, z + 0.15))}>
          −
        </button>
        <button
          type="button"
          data-cam="reset"
          aria-label="Back to the whole city"
          onClick={() => {
            setZoom(1);
            setFraming("city");
            setPicked(null);
          }}
        >
          ⌂
        </button>
      </div>

      <nav className="districts" aria-label="Districts" data-shifted={advisorOpen && !pickedView ? "true" : "false"}>
        {(["commerce-core", "offer-forge", "creator-quarter"] as const).map((id) => {
          const built = views.filter((view) => view.building.district === id);
          const ready = built.reduce((sum, view) => sum + view.ready, 0);
          return (
            <button
              key={id}
              type="button"
              className="districts__go"
              data-district={id}
              data-ready={ready > 0 ? "true" : "false"}
              aria-pressed={framing === id}
              onClick={() => {
                setFraming(id);
                setPicked(null);
              }}
            >
              {DISTRICT_NAMES[id]}
              <span className="districts__count">{built.reduce((sum, view) => sum + view.level, 0)}</span>
              {ready > 0 ? <span className="districts__bell">{ready}</span> : null}
            </button>
          );
        })}
      </nav>
    </main>
  );
}

export const ALL_BUILDINGS = BUILDINGS;
