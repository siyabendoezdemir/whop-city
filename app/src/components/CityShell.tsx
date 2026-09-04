import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ATTENTION_LABEL,
  DIRECTION_NOTE,
  SIGNAL_NOTE,
  attentionFor,
  attentionQueue,
  needsAttention,
} from "../city/attention";
import { DISTRICT_NAMES, DISTRICT_SUBTITLES, FRESHNESS_NOTE } from "../city/explain";
import { briefingForOrUnreadable } from "../city/playbook";
import { parseProjection, type DistrictId, type PublicCityProjection } from "../city/projection";
import {
  EMPTY_LOG,
  clearReviewed,
  districtProgress,
  hasChangedSinceReview,
  isReviewed,
  loadLog,
  markReviewed,
  saveLog,
  type ReviewLog,
} from "../state/operatorLog";
import { CityFallback } from "./CityFallback";
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
 * Mission control, not a dashboard. The world owns the viewport; everything
 * else is edge-anchored and exists to answer three questions in order: what
 * needs attention, why, and what to do about it.
 *
 * The loop it implements:
 *
 *   signal   — districts that need looking at light a marker in the world and
 *              appear at the top of the attention queue
 *   focus    — picking one, in the world or from the queue, glides the camera
 *              in and opens its briefing
 *   review   — the briefing lists moves; each can be marked reviewed
 *   progress — a district whose moves are all reviewed stops asking, and if the
 *              city later reads it differently the briefing says so
 *
 * What the loop deliberately does not do is claim anything City cannot see. A
 * move is a check the operator runs in Whop; marking it reviewed records that
 * they said they looked. Nothing here is sent anywhere, and the interface says
 * so at the point of the click rather than in a footnote.
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
 * The server honours this only in a build with fixtures compiled in, and
 * ignores the query string entirely otherwise — see `server/snapshotRoute.ts`.
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
  const [log, setLog] = useState<ReviewLog>(EMPTY_LOG);
  const [worldUnavailable, setWorldUnavailable] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const briefingRef = useRef<HTMLElement>(null);

  const projection = load.status === "ready" ? load.projection : null;

  useEffect(() => {
    let cancelled = false;
    fetch(endpointUrl(), { method: "GET", headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      // Validated on arrival with the same whitelist the server serialises
      // through, so a payload carrying anything extra is refused rather than
      // rendered.
      .then((body) => parseProjection(body))
      .then((next) => {
        if (cancelled) return;
        setLoad({ status: "ready", projection: next });
        setLog(loadLog(next.seed));
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const queue = useMemo(
    () => (projection ? attentionQueue(projection.districts) : []),
    [projection],
  );

  const selected = useMemo(() => {
    if (!projection || framing === "city") return null;
    return projection.districts.find((district) => district.id === framing) ?? null;
  }, [projection, framing]);

  const briefing = selected ? briefingForOrUnreadable(selected) : null;

  const progress = useMemo(() => {
    if (!briefing) return null;
    return districtProgress(log, briefing.moves.map((move) => move.id));
  }, [briefing, log]);

  /** Districts whose every move has been reviewed. Their markers stop asking. */
  const resolved = useMemo(() => {
    if (!projection) return [] as DistrictId[];
    return projection.districts
      .filter((district) => {
        const moves = briefingForOrUnreadable(district).moves;
        return districtProgress(log, moves.map((move) => move.id)).complete;
      })
      .map((district) => district.id);
  }, [projection, log]);

  const select = useCallback(
    (key: FramingKey) => {
      setFraming(key);
      setZoom(1);
      if (key !== "city") {
        setAnnouncement(`${DISTRICT_NAMES[key as DistrictId]} selected. Briefing open.`);
        // Move focus to the briefing so a keyboard user lands where the content
        // is rather than having to hunt for it after the camera moves.
        window.requestAnimationFrame(() => briefingRef.current?.focus());
      } else {
        setAnnouncement("Whole city.");
      }
    },
    [],
  );

  const toggleMove = useCallback(
    (moveId: string, districtId: DistrictId) => {
      if (!projection) return;
      const district = projection.districts.find((d) => d.id === districtId);
      if (!district) return;

      setLog((current) => {
        const next = isReviewed(current, moveId)
          ? clearReviewed(current, moveId)
          : markReviewed(current, { moveId, districtId, stateAtReview: district.state });
        saveLog(projection.seed, next);
        return next;
      });
      setAnnouncement(
        isReviewed(log, moveId) ? "Move unmarked." : "Move marked as reviewed on this device.",
      );
    },
    [projection, log],
  );

  // ----------------------------------------------------------- keyboard
  useEffect(() => {
    if (!projection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal a key from something the operator is typing into.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const districts = projection.districts;
      if (event.key >= "1" && event.key <= String(districts.length)) {
        select(districts[Number(event.key) - 1].id);
        event.preventDefault();
        return;
      }
      if (event.key === "0" || event.key === "Escape") {
        select("city");
        event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() === "f") {
        // Jump to the most pressing district that still wants attention.
        const next = queue.find((entry) => needsAttention(entry.level) && !resolved.includes(entry.district.id));
        if (next) select(next.district.id);
        else setAnnouncement("Nothing is asking for attention.");
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [projection, queue, resolved, select]);

  // ------------------------------------------------------------- render
  if (load.status === "loading") {
    return (
      <main className="city">
        <div className="city-first-load" role="status">
          <span className="city-first-load__crest">Whop City</span>
          <span className="city-first-load__note">Surveying the ground…</span>
        </div>
      </main>
    );
  }

  if (load.status === "failed" || !projection) {
    return (
      <main className="city">
        <div className="city-first-load" role="status">
          <span className="city-first-load__crest">Whop City</span>
          <span className="city-first-load__note">{FRESHNESS_NOTE.unavailable}</span>
        </div>
      </main>
    );
  }

  const readable = projection.freshness !== "unavailable";
  const outstanding = queue.filter(
    (entry) => needsAttention(entry.level) && !resolved.includes(entry.district.id),
  );

  return (
    <main className="city" data-freshness={projection.freshness}>
      {worldUnavailable ? (
        <CityFallback
          projection={projection}
          log={log}
          selected={selected?.id ?? null}
          onSelect={select}
          onToggleMove={toggleMove}
        />
      ) : (
        <Suspense fallback={null}>
          <CityCanvas
            projection={projection}
            framing={framing}
            zoom={zoom}
            resolved={resolved}
            onSelectDistrict={select}
            onUnavailable={() => setWorldUnavailable(true)}
          />
        </Suspense>
      )}

      <p className="city-live" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="city-crest">
        <span className="city-crest__name">Whop City</span>
        <span className="city-crest__state" data-freshness={projection.freshness}>
          {FRESHNESS_NOTE[projection.freshness]}
        </span>
        <span className="city-crest__mode">Public view · read-only</span>
      </div>

      {/* ------------------------------------------------- the attention queue */}
      <section className="city-queue" aria-label="Districts needing attention">
        <h2 className="city-queue__title">
          {readable
            ? outstanding.length > 0
              ? "Asking for attention"
              : "Nothing is asking for attention"
            : "The business could not be read"}
        </h2>

        <ul className="city-queue__list">
          {queue.map(({ district, level }) => {
            const isResolved = resolved.includes(district.id);
            return (
              <li key={district.id}>
                <button
                  type="button"
                  className="city-queue__item"
                  data-district={district.id}
                  data-level={level}
                  data-resolved={isResolved ? "true" : "false"}
                  aria-pressed={framing === district.id}
                  onClick={() => select(district.id)}
                >
                  <span className="city-queue__level" aria-hidden="true" />
                  <span className="city-queue__text">
                    <span className="city-queue__name">{DISTRICT_NAMES[district.id]}</span>
                    <span className="city-queue__status">
                      {isResolved ? "Reviewed" : ATTENTION_LABEL[level]}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="city-queue__hint">
          Pick a marker in the city, or press <kbd>F</kbd> for the next one.
        </p>
      </section>

      <nav className="city-jump" aria-label="Camera">
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

      <div className="city-camera" role="group" aria-label="Zoom">
        <button
          type="button"
          data-cam="in"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
        >
          +
        </button>
        <button
          type="button"
          data-cam="out"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
        >
          −
        </button>
        <button type="button" data-cam="reset" aria-label="Reset zoom" onClick={() => setZoom(1)}>
          ⌂
        </button>
      </div>

      {/* ------------------------------------------------------- the briefing */}
      {selected && briefing ? (
        <aside
          className="city-brief"
          ref={briefingRef}
          tabIndex={-1}
          aria-label={`${DISTRICT_NAMES[selected.id]} briefing`}
          data-district={selected.id}
          data-state={selected.state}
          data-level={attentionFor(selected)}
        >
          <header className="city-brief__head">
            <p className="city-brief__subtitle">{DISTRICT_SUBTITLES[selected.id]}</p>
            <h1 className="city-brief__name">{DISTRICT_NAMES[selected.id]}</h1>
            <p className="city-brief__reading">{briefing.reading}</p>
            <p className="city-brief__signal">
              {SIGNAL_NOTE[selected.signal]} · {DIRECTION_NOTE[selected.direction]}
            </p>
          </header>

          {hasChangedSinceReview(log, selected.id, selected.state) ? (
            <p className="city-brief__changed" role="note">
              This district reads differently than when you reviewed it. Worth another look — City
              cannot tell you why it changed.
            </p>
          ) : null}

          <p className="city-brief__stake">{briefing.stake}</p>

          {briefing.moves.length > 0 ? (
            <>
              <ol className="city-brief__moves">
                {briefing.moves.map((move) => {
                  const done = isReviewed(log, move.id);
                  return (
                    <li key={move.id} className="city-move" data-reviewed={done ? "true" : "false"}>
                      <button
                        type="button"
                        className="city-move__mark"
                        data-move={move.id}
                        aria-pressed={done}
                        onClick={() => toggleMove(move.id, selected.id)}
                      >
                        <span className="city-move__tick" aria-hidden="true">
                          {done ? "✓" : ""}
                        </span>
                        <span className="city-move__text">
                          <span className="city-move__title">{move.title}</span>
                          <span className="city-move__detail">{move.detail}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              <footer className="city-brief__foot">
                <p className="city-brief__progress" data-local="true">
                  <span data-testid="district-progress">
                    {progress?.reviewed ?? 0} of {progress?.total ?? 0}
                  </span>{" "}
                  reviewed
                </p>
                <p className="city-brief__local">
                  Kept in this browser. Not sent to Whop, and not a record that the work was done.
                </p>
              </footer>
            </>
          ) : (
            <p className="city-brief__local">
              No moves while the reading is unavailable. Acting on a failed reading would be acting
              on nothing.
            </p>
          )}
        </aside>
      ) : null}

      {/* ------------------------------------------------------- progression */}
      {readable ? (
        <div className="city-progress" data-local="true" aria-label="Review progress">
          <span className="city-progress__label">Districts reviewed</span>
          <span className="city-progress__pips" role="img"
            aria-label={`${resolved.length} of ${projection.districts.length} districts reviewed`}>
            {projection.districts.map((district) => (
              <span
                key={district.id}
                className="city-progress__pip"
                data-district={district.id}
                data-filled={resolved.includes(district.id) ? "true" : "false"}
              />
            ))}
          </span>
        </div>
      ) : null}
    </main>
  );
}
