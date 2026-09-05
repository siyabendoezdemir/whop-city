import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Prompt } from "../city/activities";
import { PROVENANCE_NOTE } from "../city/evidence";
import { DISTRICT_NAMES, FRESHNESS_NOTE } from "../city/explain";
import { parseProjection, type DistrictId, type PublicCityProjection } from "../city/projection";
import { buildSession, runActivity, type DistrictWork } from "../city/session";
import {
  EMPTY_LOG,
  answersForDistrict,
  clearAll,
  clearAnswer,
  clearDistrict,
  completeSession,
  loadLog,
  recordAnswer,
  saveLog,
  type OperatorLog,
} from "../state/operatorLog";
import { CityFallback } from "./CityFallback";
import { CommandBar } from "./CommandBar";
import { Dossier } from "./Dossier";
import { PlanSheet } from "./PlanSheet";
import { Seal } from "./Glyphs";
import type { FramingKey } from "./framings";
import type { ProgressMark } from "../render/city/markers";

const CityCanvas = lazy(() =>
  import("./CityCanvas").then((module) => ({ default: module.CityCanvas })),
);

/**
 * The shell.
 *
 * At rest there are three things over the world: the seal, the command bar and
 * the camera. Selecting a district adds a fourth and changes the bar; nothing
 * else appears. The earlier arrangement had a crest, a session card, a full
 * district list, a second row of district buttons, a progress widget and an
 * introductory dialog on screen simultaneously, which is how a game ends up
 * looking like a dashboard.
 *
 * What went and where it went:
 *   the district list and the district pill row   -> the studs in the bar
 *   the progress pip widget                       -> the count in the bar
 *   the arrival essay                             -> About, on demand
 *   the reading, ambiguity and limit, always on   -> "Why City says this"
 *   the per-answer disclaimer, repeated           -> one line under the notes
 */

const SNAPSHOT_ENDPOINT = "/api/city/snapshot";
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.15;
const VISITED_KEY = "whop-city.visited.v2";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; projection: PublicCityProjection }
  | { status: "failed" };

function endpointUrl(): string {
  if (typeof location === "undefined") return SNAPSHOT_ENDPOINT;
  const scenario = new URLSearchParams(location.search).get("scenario");
  return scenario ? `${SNAPSHOT_ENDPOINT}?scenario=${encodeURIComponent(scenario)}` : SNAPSHOT_ENDPOINT;
}

function hasVisited(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(VISITED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberVisit(): void {
  try {
    localStorage?.setItem(VISITED_KEY, "1");
  } catch {
    /* storage refused; the pointer simply shows again */
  }
}

function progressMark(work: DistrictWork): ProgressMark {
  if (work.changed) return "changed";
  if (work.declined) return "declined";
  if (work.complete) return "worked";
  return "none";
}

export function CityShell() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [framing, setFraming] = useState<FramingKey>("city");
  const [zoom, setZoom] = useState(1);
  const [log, setLog] = useState<OperatorLog>(EMPTY_LOG);
  const [worldUnavailable, setWorldUnavailable] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [about, setAbout] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [hint, setHint] = useState(false);
  const dossierRef = useRef<HTMLElement>(null);

  const projection = load.status === "ready" ? load.projection : null;

  useEffect(() => {
    let cancelled = false;
    fetch(endpointUrl(), { method: "GET", headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body) => parseProjection(body))
      .then((next) => {
        if (cancelled) return;
        setLoad({ status: "ready", projection: next });
        setLog(loadLog(next.seed));
        setHint(!hasVisited());
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const session = useMemo(
    () => (projection ? buildSession(projection, log.answers) : null),
    [projection, log],
  );

  const selected = useMemo(() => {
    if (!session || framing === "city") return null;
    return session.work.find((entry) => entry.district.id === framing) ?? null;
  }, [session, framing]);

  const progress = useMemo(() => {
    const marks: Record<string, ProgressMark> = {};
    for (const entry of session?.work ?? []) marks[entry.district.id] = progressMark(entry);
    return marks as Record<DistrictId, ProgressMark>;
  }, [session]);

  /** Selection moves the camera and the interface together: one gesture. */
  const select = useCallback((key: FramingKey) => {
    setFraming(key);
    setZoom(1);
    setShowPlan(false);
    setHint(false);
    rememberVisit();
    if (key !== "city") {
      setAnnouncement(`${DISTRICT_NAMES[key as DistrictId]}.`);
      window.requestAnimationFrame(() => dossierRef.current?.focus());
    } else {
      setAnnouncement("Whop City.");
    }
  }, []);

  const persist = useCallback(
    (next: OperatorLog) => {
      setLog(next);
      if (projection) saveLog(projection.seed, next);
    },
    [projection],
  );

  const answer = useCallback(
    (work: DistrictWork, prompt: Prompt, value: string) => {
      if (!work.activity) return;
      const activity = work.activity;

      let next = recordAnswer(log, {
        activityId: activity.id,
        promptId: prompt.id,
        districtId: work.district.id,
        value,
        observedState: work.district.state,
        at: Date.now(),
      });

      // Re-answering a fork strands whatever followed the old branch. Drop it
      // rather than leave answers on a path nobody is walking.
      const reachable = new Set(
        runActivity(
          activity,
          next.answers.filter((entry) => entry.activityId === activity.id),
        ).answered.map((entry) => entry.id),
      );
      for (const entry of next.answers) {
        if (entry.activityId !== activity.id) continue;
        if (entry.promptId === prompt.id) continue;
        if (!reachable.has(entry.promptId)) next = clearAnswer(next, entry.promptId);
      }

      persist(next);
      setAnnouncement("Recorded.");
    },
    [log, persist],
  );

  const undoLast = useCallback(
    (work: DistrictWork) => {
      const answers = answersForDistrict(log, work.district.id);
      const last = [...answers].sort((a, b) => a.at - b.at).pop();
      if (last) persist(clearAnswer(log, last.promptId));
      setAnnouncement("Last answer removed.");
    },
    [log, persist],
  );

  /** The one control: start where the work is, resume where it stopped. */
  const primary = useCallback(() => {
    if (!session) return;
    if (session.complete) {
      setShowPlan(true);
      return;
    }
    const next = session.outstanding[0] ?? session.work.find((entry) => entry.activity && !entry.complete);
    if (next) select(next.district.id);
    else setShowPlan(true);
  }, [session, select]);

  // ----------------------------------------------------------- keyboard
  useEffect(() => {
    if (!projection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const districts = projection.districts;
      if (event.key >= "1" && event.key <= String(districts.length)) {
        select(districts[Number(event.key) - 1].id);
        event.preventDefault();
      } else if (event.key === "0" || event.key === "Escape") {
        if (about) setAbout(false);
        else if (showPlan) setShowPlan(false);
        else select("city");
        event.preventDefault();
      } else if (event.key.toLowerCase() === "f") {
        primary();
        event.preventDefault();
      } else if (event.key.toLowerCase() === "p") {
        setShowPlan((open) => !open);
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [projection, about, showPlan, primary, select]);

  // Finishing the last district is the payoff: the sheet comes up by itself.
  const complete = session?.complete ?? false;
  const wasComplete = useRef(false);
  useEffect(() => {
    if (complete && !wasComplete.current && projection) {
      setShowPlan(true);
      setAnnouncement("Round finished. Your plan is ready.");
      persist(completeSession(log));
    }
    wasComplete.current = complete;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

  // ------------------------------------------------------------- render
  if (load.status === "loading" || load.status === "failed" || !projection || !session) {
    return (
      <main className="city">
        <div className="boot" role="status">
          <span className="boot__name">Whop City</span>
          <span>
            {load.status === "failed"
              ? "The business could not be read."
              : "Surveying the ground…"}
          </span>
        </div>
      </main>
    );
  }

  return (
    <main className="city" data-freshness={projection.freshness}>
      {worldUnavailable ? (
        <CityFallback
          session={session}
          selected={selected?.district.id ?? null}
          onSelect={select}
          onAnswer={answer}
        />
      ) : (
        <Suspense fallback={null}>
          <CityCanvas
            projection={projection}
            framing={framing}
            zoom={zoom}
            progress={progress}
            onSelectDistrict={select}
            onUnavailable={() => setWorldUnavailable(true)}
          />
        </Suspense>
      )}

      <p className="city-live" role="status" aria-live="polite">
        {announcement}
      </p>

      {/* ------------------------------------------------------------- seal */}
      <div className="seal surface">
        <Seal className="seal__mark" />
        <span className="seal__text">
          <span className="seal__name">Whop City</span>
          <span className="seal__state" data-freshness={projection.freshness}>
            {FRESHNESS_NOTE[projection.freshness]}
          </span>
        </span>
        <button
          type="button"
          className="btn seal__about"
          data-action="about"
          aria-label="About Whop City"
          onClick={() => setAbout(true)}
        >
          i
        </button>
      </div>

      {/* -------------------------------------------------------------- bar */}
      <CommandBar
        session={session}
        selected={selected?.district.id ?? null}
        onSelect={select}
        onBack={() => select("city")}
        onPrimary={primary}
        planOpen={showPlan}
      />

      {hint && !selected && session.outstanding.length > 0 ? (
        <div className="hint surface">
          <span>Click a district in the city, or begin the round.</span>
          <button
            type="button"
            className="btn btn--quiet hint__dismiss"
            data-action="dismiss-hint"
            onClick={() => {
              setHint(false);
              rememberVisit();
            }}
          >
            Got it
          </button>
        </div>
      ) : null}

      <div className="camera surface" role="group" aria-label="Camera">
        <button type="button" data-cam="in" aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}>+</button>
        <button type="button" data-cam="out" aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}>−</button>
        <button type="button" data-cam="reset" aria-label="Reset view" onClick={() => setZoom(1)}>⌂</button>
      </div>

      {/* ---------------------------------------------------------- dossier */}
      {selected && !showPlan ? (
        <aside
          className="dossier"
          ref={dossierRef}
          tabIndex={-1}
          aria-label={DISTRICT_NAMES[selected.district.id]}
          data-district={selected.district.id}
          data-state={selected.district.state}
          data-condition={selected.district.signal === "unreadable" ? "unread" : undefined}
          data-progress={progressMark(selected)}
        >
          <Dossier
            work={selected}
            onAnswer={(prompt, value) => answer(selected, prompt, value)}
            onUndoLast={() => undoLast(selected)}
            onRestart={() => persist(clearDistrict(log, selected.district.id))}
          />
        </aside>
      ) : null}

      {/* ------------------------------------------------------------- plan */}
      {showPlan ? (
        <PlanSheet
          session={session}
          rounds={log.sessionsCompleted}
          onClose={() => setShowPlan(false)}
          onClear={() => {
            persist(clearAll(log));
            setShowPlan(false);
            setAnnouncement("All answers cleared.");
          }}
          onCopied={() => setAnnouncement("Plan copied.")}
        />
      ) : null}

      {/* ------------------------------------------------------------ about */}
      {about ? (
        <div className="about" role="dialog" aria-modal="true" aria-label="About Whop City">
          <div className="about__card">
            <h1 className="about__title">A city built from a business</h1>
            <p>
              Every district stands for one part of how this business sells. What is built, lit or
              staked out comes from what Whop reports about it.
            </p>
            <div className="sources">
              <p className="source">
                <span className="source__who">From Whop</span>
                <span className="source__what">{PROVENANCE_NOTE.observed}</span>
              </p>
              <p className="source">
                <span className="source__who">Your answers</span>
                <span className="source__what">{PROVENANCE_NOTE.reported}</span>
              </p>
              <p className="source">
                <span className="source__who">This browser</span>
                <span className="source__what">{PROVENANCE_NOTE.local}</span>
              </p>
            </div>
            <p>
              The city shows the business that deployed this site, and it is public and read-only.
              If that business is not yours you can look around and take notes, but nothing here
              operates it.
            </p>
            <div className="about__acts">
              <button type="button" className="btn btn--primary" data-action="about-done"
                onClick={() => setAbout(false)}>
                Back to the city
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
