import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DISTRICT_IDS,
  parseProjection,
  type CityMetrics,
  type DistrictId,
  type PublicCityProjection,
} from "../city/projection";
import { BUILDINGS, MAX_LEVEL, RESOURCES, buildingById, buildingsIn, nextTier } from "../game/buildings";
import {
  changesSince,
  claim,
  cityTier,
  districtTally,
  levelsOf,
  markSeen,
  markersOf,
  newCity,
  readyCount,
  totalLevels,
  viewAll,
  viewOf,
  type Change,
  type CityState,
} from "../game/city";
import { cityQuest, questFor, readingFor } from "../game/quests";
import { loadCity, saveCity } from "../state/cityStore";
import { useLive } from "../state/useLive";
import { BuildingCard } from "./BuildingCard";
import { DesktopOnly } from "./DesktopOnly";
import { DistrictRail, type RailEntry } from "./DistrictRail";
import { Feed, SaleToasts } from "./Feed";
import { ProfileChip, type Profile } from "./Profile";
import { QuestCard } from "./QuestCard";
import { ResourceBar, type Bumps } from "./ResourceBar";
import { WhileAway } from "./WhileAway";
import { Seal } from "./Glyphs";

const CityCanvas = lazy(() =>
  import("./CityCanvas").then((module) => ({ default: module.CityCanvas })),
);

/**
 * Whop City.
 *
 * A city you fly around, made of buildings that go up when your Whop business
 * does. The loop is short: a gold bubble appears over a plot, you click the
 * plot, the card tells you what the business reached, and you press the
 * button. The city grows toward a skyline.
 *
 * Nothing here simulates a business. Every number on screen came out of the
 * account, and the only way to move one is to go and move it for real.
 *
 * The layout is a heads-up display and obeys the rules of one: everything is
 * anchored to an edge, nothing floats in the middle, and the four regions
 * never overlap at any desktop width. Top left is who you are and how grand
 * the city is; top centre is what you have; top right is which Whop this is.
 * Down the left are the three districts. Bottom right is the one contextual
 * panel — a building when you have selected one, otherwise the quest.
 */

const SNAPSHOT_ENDPOINT = "/api/city/snapshot";
const PROFILE_ENDPOINT = "/api/city/profile";
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

/** Somebody who has asked for less motion does not want a four-second intro. */
function prefersStill(): boolean {
  return (
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** How long each storey of the founding sweep holds before the next one. */
const RISE_MS = 820;

/**
 * How much each figure went up by on the last reading.
 *
 * Only rises. A month's revenue falling is a real thing that happens — a
 * refund, a chargeback — and it belongs on the figure itself, not floating up
 * out of it in green. Cleared after a beat so the bar goes back to being a
 * bar.
 */
function useBumps(metrics: CityMetrics | null): Bumps {
  const [bumps, setBumps] = useState<Bumps>({});
  const previous = useRef<CityMetrics | null>(null);

  useEffect(() => {
    if (!metrics || metrics.source !== "owner") return;
    const before = previous.current;
    previous.current = metrics;
    if (!before || before.source !== "owner") return;

    const next: Bumps = {};
    for (const resource of RESOURCES) {
      const rise = metrics[resource] - before[resource];
      if (rise > 0) next[resource] = rise;
    }
    if (Object.keys(next).length === 0) return;

    setBumps(next);
    const timer = window.setTimeout(() => setBumps({}), 1_600);
    return () => window.clearTimeout(timer);
  }, [metrics]);

  return bumps;
}

export function CityShell() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [city, setCity] = useState<CityState | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [district, setDistrict] = useState<DistrictId | null>(null);
  const [framing, setFraming] = useState<string>("city");
  const [zoom, setZoom] = useState(1);
  const [flash, setFlash] = useState<string | null>(null);
  const [tooSmall, setTooSmall] = useState(false);
  /**
   * The founding sweep.
   *
   * On a first visit the city is seeded to whatever the business has already
   * earned, which for an established Whop is most of a skyline arriving in one
   * frame. Instead it rises: every plot is capped at this number, and the cap
   * climbs a level at a time. Nothing is invented — it is the same city, told
   * over four seconds instead of none — and it is the moment that makes the
   * connection between the business and the buildings without a word of copy.
   *
   * Null once it has played, and null from the start on a return visit.
   */
  const [rising, setRising] = useState<number | null>(null);
  /**
   * What the business did while nobody was looking.
   *
   * Captured at load, before `markSeen` moves the baseline forward, because
   * the whole value of it is that it is the difference between two visits. It
   * is the reason to come back: the city is a record of a month's work and
   * this is the line that says what the last few days added to it.
   */
  const [away, setAway] = useState<Change[] | null>(null);

  /** What came back from the sign-in round trip, if anything. */
  const authNote = useMemo(() => {
    if (typeof location === "undefined") return null;
    switch (new URLSearchParams(location.search).get("auth")) {
      case "notadmin":
        return "That Whop account does not run this business, so the figures stay hidden.";
      case "denied":
        return "Sign-in was cancelled. The public city is still here.";
      case "failed":
        return "Sign-in did not complete. Try again.";
      case "unavailable":
        return "This deployment is not set up for sign-in yet.";
      case "unregistered":
        return "Whop has not accepted this site's sign-in address yet. Try again in a minute — it registers itself on the first attempt.";
      case "out":
        return "Signed out. This is the public city.";
      default:
        return null;
    }
  }, []);

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
  /**
   * The figures, as fresh as they can be got.
   *
   * The snapshot brings a set at load and refreshes them slowly. The live
   * endpoint brings the same four every fifteen seconds, and when it has
   * spoken its answer is the newer one and wins. Everything downstream — the
   * levels a plot has earned, whether a building is ready, which quest is on
   * the card — reads from here, which is what makes a sale that lands right
   * now change the city right now rather than at the next minute boundary.
   */
  const live = useLive(projection?.metrics.source === "owner");
  const metrics = live.metrics ?? projection?.metrics ?? null;
  const bumps = useBumps(metrics);

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
        // Seeded from the business on a first visit, so somebody who has been
        // trading for two years arrives at the city that business built rather
        // than at eleven empty plots.
        const saved = loadCity(next.seed);
        setCity(saved ?? newCity(next.seed, Date.now(), next.metrics));
        if (!saved && next.metrics.source === "owner" && !prefersStill()) setRising(0);
        if (saved) {
          const moved = changesSince(saved, next.metrics).filter((change) => change.from !== change.to);
          if (moved.length > 0) setAway(moved);
        }
      })
      .catch(() => alive && setLoad({ status: "failed" }));

    fetch(PROFILE_ENDPOINT, { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : { signedIn: false }))
      .then((body) => alive && setProfile(body as Profile))
      .catch(() => alive && setProfile({ signedIn: false }));

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
  const settled = useMemo(
    () => (city && metrics ? levelsOf(city, metrics) : {}),
    [city, metrics],
  );
  const levels = useMemo(() => {
    if (rising === null) return settled;
    return Object.fromEntries(
      Object.entries(settled).map(([id, level]) => [id, Math.min(level, rising)]),
    );
  }, [settled, rising]);
  const markers = useMemo(
    () => (city && metrics && rising === null ? markersOf(city, metrics) : {}),
    [city, metrics, rising],
  );

  // Climb a storey at a time, then stop and never run again this session.
  useEffect(() => {
    if (rising === null) return;
    if (rising >= MAX_LEVEL) {
      const done = window.setTimeout(() => setRising(null), RISE_MS);
      return () => window.clearTimeout(done);
    }
    const timer = window.setTimeout(() => setRising((step) => (step === null ? null : step + 1)), RISE_MS);
    return () => window.clearTimeout(timer);
  }, [rising]);
  const waiting = city && metrics ? readyCount(city, metrics) : 0;
  const built = city && metrics ? totalLevels(city, metrics) : 0;
  const tier = city && metrics ? cityTier(city, metrics) : null;
  const upcoming = nextTier(built);

  const rail: RailEntry[] = useMemo(() => {
    if (!city || !metrics) return [];
    return DISTRICT_IDS.map((id) => {
      const tally = districtTally(city, metrics, id);
      return {
        district: id,
        levels: tally.levels,
        maxLevels: buildingsIn(id).length * MAX_LEVEL,
        built: tally.built,
        plots: tally.plots,
        ready: tally.ready,
        reading: readingFor(id, metrics),
        resource: buildingsIn(id)[0].resource,
      };
    });
  }, [city, metrics]);

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
      setFlash(`${buildingById(id)!.name} — level ${after}`);
      // On the roll beside the sales that paid for it. The feed is a record of
      // the business and the city together, and a building going up is the one
      // line on it the player wrote themselves.
      live.announce({
        id: `level-${id}-${after}`,
        at: Date.now(),
        kind: "level",
        plot: id,
        name: buildingById(id)!.name,
        level: after,
      });
    },
    [city, metrics, persist, live],
  );

  // Remember what the business looked like, so a return can say what moved.
  //
  // Only ever for the owner. A visitor's figures are all zeroes, and writing
  // those to storage would leave an empty saved city behind that the owner
  // then inherits when they sign in — no founding sweep, and a baseline of
  // nought for the panel that is supposed to say what changed.
  useEffect(() => {
    if (!city || !metrics || metrics.source !== "owner") return;
    const timer = window.setTimeout(() => persist(markSeen(city, metrics, Date.now())), 4_000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 3_400);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const pickedView = picked ? views.find((view) => view.building.id === picked) ?? null : null;

  const goToPlot = useCallback((id: string) => {
    setPicked(id);
    const building = buildingById(id);
    if (building) {
      setDistrict(building.district);
      setFraming(building.district);
    }
  }, []);

  const goToDistrict = useCallback((id: DistrictId) => {
    setDistrict((was) => (was === id ? null : id));
    setFraming((was) => (was === id ? "city" : id));
    setPicked(null);
  }, []);

  // ----------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        setPicked(null);
        setDistrict(null);
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

  const quest = district ? questFor(district, metrics) : cityQuest(metrics);

  return (
    <main className="city" data-freshness={projection.freshness} data-tier={tier.level}>
      <Suspense fallback={null}>
        <CityCanvas
          projection={projection}
          framing={framing as never}
          zoom={zoom}
          levels={levels}
          markers={markers}
          selected={picked}
          onSelectPlot={goToPlot}
          onSelectDistrict={goToDistrict}
          onUnavailable={() => undefined}
        />
      </Suspense>

      {/* --------------------------------------------------------- top left
          The name of the Whop comes first, and it is the biggest thing here.
          "I don't know which Whop it selects" is not a question a player
          should be able to have, and burying the answer in a corner menu is
          how they had it. The tier is the smaller line underneath. */}
      <div className="crest" data-testid="tier">
        <span className="crest__shield" aria-hidden="true">
          <Seal className="crest__seal" />
          <span className="crest__level">{tier.level}</span>
        </span>
        <span className="crest__text">
          <span className="crest__whop" data-testid="crest-business">
            {profile?.business?.name ?? "Whop City"}
          </span>
          <span className="crest__meter">
            <span
              className="crest__fill"
              style={{ width: `${upcoming ? Math.round((built / upcoming.at) * 100) : 100}%` }}
            />
          </span>
          <span className="crest__sub">
            {tier.name}
            {upcoming ? ` · ${built}/${upcoming.at} to ${upcoming.name}` : ` · ${built} levels, the top`}
          </span>
        </span>
      </div>

      <ResourceBar metrics={metrics} bumps={bumps} />

      <div className="corner">
        <ProfileChip profile={profile} />
      </div>

      {/* ------------------------------------------- live, down the right side
          A sale that lands while the city is open throws a card; the roll
          behind the tab is the last day of it. Both are owner-only, because
          both are the business's takings. */}
      {metrics.source === "owner" ? (
        <>
          <SaleToasts sales={live.arrivals} onDone={live.dismiss} />
          <Feed entries={live.feed} connected={live.connected} now={live.at ?? Date.now()} />
        </>
      ) : null}

      {away && rising === null ? <WhileAway changes={away} onDismiss={() => setAway(null)} /> : null}

      {/* ------------------------------------------------------ left rail */}
      <DistrictRail entries={rail} active={district} onPick={goToDistrict} />

      {/* -------------------------------------------------- ready to build
          The most direct answer there is to "what do I do next": a count and
          one button, above whatever else is in the corner. A bubble in the
          world tells you a plot is waiting; this tells you how many and takes
          you to one. */}
      {!pickedView && waiting > 0 && rising === null ? (
        <button
          type="button"
          className="ready"
          data-action="build-next"
          data-testid="ready-bar"
          onClick={() => {
            const next = views.find((view) => view.ready > 0);
            if (next) goToPlot(next.building.id);
          }}
        >
          <span className="ready__n">{waiting}</span>
          <span className="ready__what">
            {waiting === 1 ? "building is ready" : "buildings are ready"}
          </span>
          <span className="ready__go">Build</span>
        </button>
      ) : null}

      {/* ------------------------------------- bottom right: one panel only */}
      {pickedView ? (
        <BuildingCard
          view={pickedView}
          onUpgrade={() => upgrade(pickedView.building.id)}
          onClose={() => setPicked(null)}
        />
      ) : quest ? (
        <QuestCard
          quest={quest}
          metrics={metrics}
          scope={district ? "district" : "city"}
          onGo={district ? undefined : () => goToDistrict(quest.district)}
        />
      ) : null}

      {/* --------------------------------------------------------- camera */}
      <div className="camera" role="group" aria-label="Camera">
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
            setDistrict(null);
            setPicked(null);
          }}
        >
          ⌂
        </button>
      </div>

      {/* -------------------------------------------------- status, briefly */}
      {flash ? (
        <p className="toast" role="status" data-testid="toast">
          {flash}
        </p>
      ) : null}

      {rising !== null ? (
        <p className="nudge" role="status" data-testid="rising">
          Surveying your Whop — this is the city your business has already built.
        </p>
      ) : null}

      {rising === null && !flash && metrics.source !== "owner" ? (
        <p className="nudge" role="status" data-testid="nudge">
          {metrics.source === "unreadable"
            ? "Whop would not give up this business's figures just now. The city is waiting on them."
            : (authNote ?? "This is the public city. Sign in with Whop to play it with your own business.")}
        </p>
      ) : null}

      {rising === null && !flash && metrics.source === "owner" && waiting === 0 && built === 0 ? (
        <p className="nudge" role="status" data-testid="nudge">
          Empty ground. Everything here goes up when the business does — start with the quest.
        </p>
      ) : null}
    </main>
  );
}

export const ALL_BUILDINGS = BUILDINGS;
