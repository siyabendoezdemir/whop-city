import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Prompt } from "../city/activities";
import { ATTENTION_LABEL, attentionFor } from "../city/attention";
import { evidenceKind } from "../city/evidence";
import { DISTRICT_NAMES, FRESHNESS_NOTE } from "../city/explain";
import { parseProjection, type DistrictId, type PublicCityProjection } from "../city/projection";
import { buildSession, planAsText, runActivity, type DistrictWork } from "../city/session";
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
import { DistrictPanel, Provenance } from "./DistrictPanel";
import { FRAMING_ORDER, type FramingKey } from "./framings";
import type { ProgressMark } from "../render/city/markers";

const CityCanvas = lazy(() =>
  import("./CityCanvas").then((module) => ({ default: module.CityCanvas })),
);

/**
 * The city shell.
 *
 * Mission control, not a dashboard. The world owns the viewport; everything on
 * top of it exists to answer, in order: what needs attention, why, what to do,
 * and what came out of doing it.
 *
 * The rule the whole interface is built around is that three kinds of fact stay
 * apart — what Whop reported, what the operator answered, and what this browser
 * remembers. They are stored separately in `city/session.ts`, labelled
 * separately here, and drawn as separate objects in the world.
 */

const SNAPSHOT_ENDPOINT = "/api/city/snapshot";
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.15;
const ORIENTED_KEY = "whop-city.oriented.v1";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; projection: PublicCityProjection }
  | { status: "failed" };

function endpointUrl(): string {
  if (typeof location === "undefined") return SNAPSHOT_ENDPOINT;
  const scenario = new URLSearchParams(location.search).get("scenario");
  return scenario ? `${SNAPSHOT_ENDPOINT}?scenario=${encodeURIComponent(scenario)}` : SNAPSHOT_ENDPOINT;
}

/** Orientation is shown once per browser, and can be reopened. */
function hasBeenOriented(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(ORIENTED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberOriented(): void {
  try {
    localStorage?.setItem(ORIENTED_KEY, "1");
  } catch {
    /* storage refused; the card simply shows again next time */
  }
}

/** What the player has done here, as one word the world can draw. */
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
  const [orienting, setOrienting] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

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
        setOrienting(!hasBeenOriented());
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

  const select = useCallback((key: FramingKey) => {
    setFraming(key);
    setZoom(1);
    setShowPlan(false);
    if (key !== "city") {
      setAnnouncement(`${DISTRICT_NAMES[key as DistrictId]} selected.`);
      window.requestAnimationFrame(() => panelRef.current?.focus());
    } else {
      setAnnouncement("Whole city.");
    }
  }, []);

  const persist = useCallback(
    (next: OperatorLog) => {
      setLog(next);
      if (projection) saveLog(projection.seed, next);
    },
    [projection],
  );

  /**
   * Records an answer.
   *
   * Answering a branching question again invalidates everything that followed
   * the old branch, so those answers are dropped rather than left orphaned in
   * a path nobody is on any more.
   */
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

      const reachable = new Set(
        runActivity(activity, next.answers.filter((entry) => entry.activityId === activity.id))
          .answered.map((entry) => entry.id),
      );
      for (const entry of next.answers) {
        if (entry.activityId !== activity.id) continue;
        if (entry.promptId === prompt.id) continue;
        if (!reachable.has(entry.promptId)) next = clearAnswer(next, entry.promptId);
      }

      persist(next);
      setAnnouncement("Recorded in this browser.");
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
        select("city");
        event.preventDefault();
      } else if (event.key.toLowerCase() === "f") {
        const next = session?.outstanding[0];
        if (next) select(next.district.id);
        else setAnnouncement("Nothing is outstanding.");
        event.preventDefault();
      } else if (event.key.toLowerCase() === "p") {
        setShowPlan((open) => !open);
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [projection, session, select]);

  // Finishing the last outstanding district is the payoff; open the plan.
  const complete = session?.complete ?? false;
  const previouslyComplete = useRef(false);
  useEffect(() => {
    if (complete && !previouslyComplete.current && projection) {
      setShowPlan(true);
      setAnnouncement("Session complete. Your plan is ready.");
      persist(completeSession(log));
    }
    previouslyComplete.current = complete;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

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

  if (load.status === "failed" || !projection || !session) {
    return (
      <main className="city">
        <div className="city-first-load" role="status">
          <span className="city-first-load__crest">Whop City</span>
          <span className="city-first-load__note">{FRESHNESS_NOTE.unavailable}</span>
        </div>
      </main>
    );
  }

  const worked = session.work.filter((entry) => entry.complete).length;
  const total = session.work.filter((entry) => entry.activity !== null).length;

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

      {/* ------------------------------------------------------------ crest */}
      <div className="city-crest">
        <span className="city-crest__name">Whop City</span>
        <span className="city-crest__state" data-freshness={projection.freshness}>
          {FRESHNESS_NOTE[projection.freshness]}
        </span>
        <span className="city-crest__mode">
          This city shows the business that deployed it. Public, read-only.
        </span>
        <button type="button" className="ghost ghost--tiny" data-action="orient"
          onClick={() => setOrienting(true)}>
          What is this?
        </button>
      </div>

      {/* ---------------------------------------------------------- session */}
      <section className="city-queue" aria-label="This session">
        <div className="session">
          <h2 className="session__title">{session.title}</h2>
          <p className="session__purpose">{session.purpose}</p>
          {total > 0 ? (
            <p className="session__count" data-local="true">
              <span data-testid="session-progress">
                {worked} of {total}
              </span>{" "}
              districts worked
            </p>
          ) : null}
        </div>

        <ul className="city-queue__list">
          {session.work.map((entry) => {
            const kind = evidenceKind(entry.district);
            const mark = progressMark(entry);
            return (
              <li key={entry.district.id}>
                <button
                  type="button"
                  className="city-queue__item"
                  data-district={entry.district.id}
                  data-condition={kind}
                  data-progress={mark}
                  data-level={attentionFor(entry.district)}
                  aria-pressed={framing === entry.district.id}
                  onClick={() => select(entry.district.id)}
                >
                  <span className="city-queue__level" aria-hidden="true" />
                  <span className="city-queue__text">
                    <span className="city-queue__name">{DISTRICT_NAMES[entry.district.id]}</span>
                    {/* Two separate chips: what Whop reported, and what you did.
                        Local progress never overwrites the business condition. */}
                    <span className="city-queue__chips">
                      <span className="chip chip--observed" data-condition={kind}>
                        {ATTENTION_LABEL[attentionFor(entry.district)]}
                      </span>
                      {mark !== "none" ? (
                        <span className="chip chip--local" data-progress={mark}>
                          {mark === "worked"
                            ? "You worked here"
                            : mark === "declined"
                              ? "You decided against"
                              : "Reading changed"}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="city-queue__actions">
          {session.plan.length > 0 ? (
            <button type="button" className="ghost" data-action="plan" onClick={() => setShowPlan(true)}>
              Open plan
            </button>
          ) : null}
          <p className="city-queue__hint">
            Click a district in the city, or press <kbd>F</kbd> for the next one.
          </p>
        </div>
      </section>

      <nav className="city-jump" aria-label="Camera">
        {FRAMING_ORDER.map((key) => (
          <button key={key} type="button" data-district={key} aria-pressed={key === framing}
            onClick={() => select(key)}>
            {key === "city" ? "Whop City" : DISTRICT_NAMES[key as DistrictId]}
          </button>
        ))}
      </nav>

      <div className="city-camera" role="group" aria-label="Zoom">
        <button type="button" data-cam="in" aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}>+</button>
        <button type="button" data-cam="out" aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}>−</button>
        <button type="button" data-cam="reset" aria-label="Reset zoom" onClick={() => setZoom(1)}>⌂</button>
      </div>

      {/* -------------------------------------------------- the district panel */}
      {selected && !showPlan ? (
        <aside
          className="city-brief"
          ref={panelRef}
          tabIndex={-1}
          aria-label={`${DISTRICT_NAMES[selected.district.id]} panel`}
          data-district={selected.district.id}
          data-state={selected.district.state}
          data-condition={evidenceKind(selected.district)}
          data-progress={progressMark(selected)}
        >
          <DistrictPanel
            work={selected}
            onAnswer={(prompt, value) => answer(selected, prompt, value)}
            onUndoLast={() => undoLast(selected)}
            onRestart={() => persist(clearDistrict(log, selected.district.id))}
          />
        </aside>
      ) : null}

      {/* --------------------------------------------------------- the payoff */}
      {showPlan ? (
        <aside className="city-brief city-brief--plan" aria-label="Session plan" data-testid="plan">
          <header className="panel__head">
            <p className="panel__subtitle">Session plan</p>
            <h1 className="panel__name">{session.complete ? "Round finished" : "What you have so far"}</h1>
          </header>

          {session.complete ? (
            <p className="panel__payoff">
              Every district in this round is worked through. Nothing about the business changed
              because of it — this is your plan, not a result.
              {log.sessionsCompleted > 0 ? (
                <>
                  {" "}
                  <span data-local="true">
                    Rounds finished in this browser: <span data-testid="rounds">{log.sessionsCompleted}</span>.
                  </span>
                </>
              ) : null}
            </p>
          ) : null}

          {session.work.map((entry) =>
            entry.plan.length === 0 ? null : (
              <section key={entry.district.id} className="planblock" data-district={entry.district.id}>
                <div className="planblock__head">
                  <h2>{DISTRICT_NAMES[entry.district.id]}</h2>
                  <span className="chip chip--observed" data-condition={evidenceKind(entry.district)}>
                    Whop reported: {entry.district.state}
                  </span>
                </div>
                <ul className="planlist">
                  {entry.plan.map((item) => (
                    <li key={item.promptId} className="planlist__item" data-kind={item.kind}>
                      <span className="planlist__mark" aria-hidden="true" />
                      <span className="planlist__text">{item.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}

          {session.plan.length === 0 ? (
            <p className="panel__blocked">Nothing recorded yet. Pick a district and start.</p>
          ) : null}

          <footer className="panel__planFoot">
            <Provenance kind="reported" />
            <p className="panel__local">
              Your answers, kept in this browser only. Not sent to Whop, and not a record that the
              work was done.
            </p>
            <div className="panel__undo">
              <button
                type="button"
                className="ghost"
                data-action="copy-plan"
                onClick={() => {
                  const text = planAsText(session, (id) => DISTRICT_NAMES[id]);
                  navigator.clipboard?.writeText(text).catch(() => undefined);
                  setCopied(true);
                  setAnnouncement("Plan copied.");
                }}
              >
                {copied ? "Copied" : "Copy plan as text"}
              </button>
              <button type="button" className="ghost" data-action="close-plan" onClick={() => setShowPlan(false)}>
                Back to the city
              </button>
              <button
                type="button"
                className="ghost"
                data-action="reset-all"
                onClick={() => {
                  persist(clearAll(log));
                  setShowPlan(false);
                  setAnnouncement("All answers cleared.");
                }}
              >
                Clear all answers
              </button>
            </div>
          </footer>
        </aside>
      ) : null}

      {/* ---------------------------------------------------------- orientation */}
      {orienting ? (
        <div className="orient" role="dialog" aria-modal="true" aria-label="What Whop City is">
          <div className="orient__card">
            <h1 className="orient__title">This is a city built from a business</h1>
            <p>
              Every district stands for one part of how the business sells. What is built, lit or
              boarded up comes from what Whop reports about it — <Provenance kind="observed" />
            </p>
            <p>
              City suggests work and records what you answer. It cannot see your storefront, cannot
              try a purchase, and does not change anything in Whop. Your answers stay in this
              browser — <Provenance kind="reported" /> <Provenance kind="local" />
            </p>
            <p className="orient__whose">
              The city shows the business that deployed this site. If that is not you, you can look
              around and take notes, but nothing you do here operates their business.
            </p>
            <button
              type="button"
              className="orient__go"
              data-action="orient-done"
              onClick={() => {
                setOrienting(false);
                rememberOriented();
                const first = session.outstanding[0];
                if (first) select(first.district.id);
              }}
            >
              {session.outstanding.length > 0 ? "Show me what needs attention" : "Look around"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------- progression */}
      {!session.unreadable ? (
        <div className="city-progress" data-local="true" aria-label="Districts worked">
          <span className="city-progress__label">Worked</span>
          <span
            className="city-progress__pips"
            role="img"
            aria-label={`${worked} of ${total} districts worked in this browser`}
          >
            {session.work.map((entry) => (
              <span
                key={entry.district.id}
                className="city-progress__pip"
                data-district={entry.district.id}
                data-filled={entry.complete ? "true" : "false"}
                data-declined={entry.declined ? "true" : "false"}
              />
            ))}
          </span>
        </div>
      ) : null}
    </main>
  );
}
