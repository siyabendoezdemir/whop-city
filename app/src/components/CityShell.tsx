import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import { DISTRICT_NAMES, DISTRICT_SUBTITLES, FRESHNESS_NOTE, explain } from "../city/explain";
import { parseProjection, type DistrictId, type PublicCityProjection } from "../city/projection";
import { FRAMING_ORDER, type FramingKey } from "./framings";

/**
 * The renderer is loaded on demand.
 *
 * three and the whole authored city are a large graph, and none of it can run
 * on the server. Splitting it here keeps it out of the server bundle rather
 * than relying on the route's `ssr: false` to stop it executing.
 */
const CityCanvas = lazy(() =>
  import("./CityCanvas").then((module) => ({ default: module.CityCanvas })),
);

/**
 * The city shell.
 *
 * The world owns the viewport. What sits on top of it is deliberately small and
 * anchored to the edges: a crest, a read-only marker, district navigation and
 * camera controls. There is no header, no bottom navigation bar and no
 * dashboard chrome.
 *
 * Selecting a district glides the camera into the neighbourhood and opens one
 * sentence about what is visible there. No cards, no charts, no numbers — the
 * projection does not carry any, and this is not the place to invent them.
 */

/** The one endpoint the browser is allowed to call. */
const SNAPSHOT_ENDPOINT = "/api/city/snapshot";

const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.15;

type LoadState =
  | { status: "loading" }
  | { status: "ready"; projection: PublicCityProjection }
  | { status: "failed" };

/**
 * Forwards the fixture scenario, if the page was opened with one.
 *
 * The server honours this only when there is no live binding, and ignores it
 * entirely otherwise — see `server/snapshotRoute.ts`. It exists so the visual
 * and browser tests can drive the world through its states without a business.
 */
function endpointUrl(): string {
  if (typeof location === "undefined") return SNAPSHOT_ENDPOINT;
  const scenario = new URLSearchParams(location.search).get("scenario");
  return scenario ? `${SNAPSHOT_ENDPOINT}?scenario=${encodeURIComponent(scenario)}` : SNAPSHOT_ENDPOINT;
}

export function CityShell() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [framing, setFraming] = useState<FramingKey>("city");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetch(endpointUrl(), { method: "GET", headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      // Validated on arrival with the same whitelist the server serialises
      // through, so a payload carrying anything extra is refused rather than
      // rendered.
      .then((body) => parseProjection(body))
      .then((projection) => {
        if (!cancelled) setLoad({ status: "ready", projection });
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const select = useCallback((key: FramingKey) => {
    setFraming(key);
    setZoom(1);
  }, []);

  const projection = load.status === "ready" ? load.projection : null;

  const selected = useMemo(() => {
    if (!projection || framing === "city") return null;
    return projection.districts.find((district) => district.id === framing) ?? null;
  }, [projection, framing]);

  return (
    <main className="city">
      {projection ? (
        <Suspense fallback={null}>
          <CityCanvas projection={projection} framing={framing} zoom={zoom} />
        </Suspense>
      ) : null}

      {load.status === "loading" ? (
        <div className="city-first-load" role="status">
          <span className="city-first-load__crest">Whop City</span>
          <span className="city-first-load__note">Surveying the ground…</span>
        </div>
      ) : null}

      {load.status === "failed" ? (
        <div className="city-first-load" role="status">
          <span className="city-first-load__crest">Whop City</span>
          <span className="city-first-load__note">{FRESHNESS_NOTE.unavailable}</span>
        </div>
      ) : null}

      {projection ? (
        <>
          <div className="city-crest">
            <span className="city-crest__name">Whop City</span>
            <span className="city-crest__state" data-freshness={projection.freshness}>
              {FRESHNESS_NOTE[projection.freshness]}
            </span>
            {/* Stated plainly rather than implied by the absence of buttons. */}
            <span className="city-crest__mode">Public view · read-only</span>
          </div>

          <nav className="city-jump" aria-label="Districts">
            {FRAMING_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                data-district={key}
                aria-pressed={key === framing}
                onClick={() => select(key)}
              >
                {key === "city" ? "Whop City" : DISTRICT_NAMES[key as DistrictId]}
              </button>
            ))}
          </nav>

          <div className="city-camera" role="group" aria-label="Camera">
            <button type="button" data-cam="in" aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}>
              +
            </button>
            <button type="button" data-cam="out" aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}>
              −
            </button>
            <button type="button" data-cam="reset" aria-label="Reset camera" onClick={() => setZoom(1)}>
              ⌂
            </button>
          </div>

          {selected ? (
            <aside className="city-place" data-district={selected.id} data-state={selected.state}>
              <p className="city-place__subtitle">{DISTRICT_SUBTITLES[selected.id]}</p>
              <h1 className="city-place__name">{DISTRICT_NAMES[selected.id]}</h1>
              <p className="city-place__explain">{explain(selected)}</p>
            </aside>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
