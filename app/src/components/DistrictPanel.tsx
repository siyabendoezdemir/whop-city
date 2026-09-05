import { EVIDENCE_LIMIT, evidenceKind, readingFor } from "../city/evidence";
import { DISTRICT_NAMES, DISTRICT_SUBTITLES } from "../city/explain";
import type { DistrictId } from "../city/projection";
import { CONDITION } from "../city/vocabulary";
import {
  MAX_LEVEL,
  TRADE,
  demolitionRefund,
  rankFor,
  tradesOf,
  upgradeCost,
  type Trade,
} from "../game/catalog";
import type { Plot, Reading } from "../game/state";
import { Glyph } from "./Glyphs";

/**
 * The district, and the plot you are standing on.
 *
 * This is where the game is played. The reading Whop gave the district is at
 * the top, small, and clearly separate — it seeded the opening position and it
 * never changes again. Everything under the rule is the simulation.
 *
 * One plot is in focus at a time and its available moves are the largest thing
 * on the panel, because building is the verb of this product.
 */

type Props = {
  district: DistrictId;
  condition: ReturnType<typeof evidenceKind>;
  reading: Reading;
  credits: number;
  plots: readonly Plot[];
  selected: Plot | null;
  onSelectPlot: (plotId: string) => void;
  onBuild: (plotId: string, trade: Trade) => void;
  onRepair: (plotId: string) => void;
  onClear: (plotId: string) => void;
  /** The advisory round, kept but no longer the point. */
  notes: React.ReactNode;
};

function plotLabel(plot: Plot): string {
  if (plot.derelict) return "Derelict";
  if (plot.level === 0) return "Empty";
  return `${TRADE[plot.trade!].name} · ${plot.level}`;
}

export function DistrictPanel({
  district,
  condition,
  reading,
  credits,
  plots,
  selected,
  onSelectPlot,
  onBuild,
  onRepair,
  onClear,
  notes,
}: Props) {
  const cond = CONDITION[condition];
  const rank = rankFor(reading.totalLevels);

  return (
    <div className="dossier__inner">
      <header className="dossier__head">
        <h1 className="dossier__name">{DISTRICT_NAMES[district]}</h1>
        <p className="dossier__role">{DISTRICT_SUBTITLES[district]}</p>
      </header>

      {/* ---------------------------------------------- what Whop reported, once */}
      <details className="seeded">
        <summary className="seeded__summary">
          <span className="cond" data-tone={cond.tone}>
            <Glyph name={cond.glyph} className="cond__glyph" />
            {cond.label}
          </span>
          <span className="seeded__tag">as Whop found it</span>
        </summary>
        <div className="seeded__body">
          <p>{readingFor({ id: district, state: "healthy", direction: "steady", signal: "quiet", parcels: 0, variant: 0 }).observed.replace(/^Whop reports/, "Whop reported")}</p>
          <p className="seeded__note">
            This set how much of the district was already standing when the city was founded. It is
            not affected by anything you build, and nothing you build here changes it.
          </p>
          <p className="seeded__limit">{EVIDENCE_LIMIT}</p>
        </div>
      </details>

      {/* --------------------------------------------------------------- plots */}
      <section className="plots" aria-label="Plots">
        <h2 className="plots__title">Plots</h2>
        <div className="plots__row" role="group" aria-label="Plots in this district">
          {plots.map((plot) => (
            <button
              key={plot.id}
              type="button"
              className="plotchip"
              data-plot={plot.id}
              data-level={plot.level}
              data-dark={plot.offline ?? (plot.derelict ? "derelict" : "")}
              aria-pressed={selected?.id === plot.id}
              onClick={() => onSelectPlot(plot.id)}
            >
              <span className="plotchip__bars" aria-hidden="true">
                {[1, 2, 3].map((step) => (
                  <span key={step} data-on={plot.level >= step ? "true" : "false"} />
                ))}
              </span>
              <span className="plotchip__label">{plotLabel(plot)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------- the moves here */}
      {selected ? (
        <section className="moves" aria-label="What you can do here" data-plot={selected.id}>
          {selected.derelict ? (
            <>
              <h2 className="moves__title">Derelict</h2>
              <p className="moves__note">
                Standing, and producing nothing. Putting it right costs less than building from
                bare ground.
              </p>
              <button
                type="button"
                className="btn btn--primary"
                data-action="repair"
                disabled={credits < Math.round(upgradeCost(selected.trade ?? "market", 0) * 0.6)}
                onClick={() => onRepair(selected.id)}
              >
                Repair · {Math.round(upgradeCost(selected.trade ?? "market", 0) * 0.6)}c
              </button>
              <button type="button" className="btn btn--quiet" data-action="clear" onClick={() => onClear(selected.id)}>
                Clear the plot instead
              </button>
            </>
          ) : selected.level === 0 ? (
            <>
              <h2 className="moves__title">Bare ground</h2>
              <p className="moves__note">Choose what this plot does. It can be changed later by clearing it.</p>
              <ul className="offers">
                {tradesOf(district).map((spec) => {
                  const locked = spec.unlockAt > rank.level;
                  const cost = upgradeCost(spec.id, 0);
                  const poor = credits < cost;
                  return (
                    <li key={spec.id}>
                      <button
                        type="button"
                        className="offer"
                        data-trade={spec.id}
                        disabled={locked || poor}
                        onClick={() => onBuild(selected.id, spec.id)}
                      >
                        <span className="offer__head">
                          <span className="offer__name">{spec.name}</span>
                          <span className="offer__cost" data-local="true">
                            {cost}c
                          </span>
                        </span>
                        <span className="offer__blurb">{spec.blurb}</span>
                        <span className="offer__stats" data-local="true">
                          {spec.footfall > 0 ? <em>+{spec.footfall} footfall</em> : null}
                          {spec.credits > 0 ? <em>+{spec.credits} credits</em> : null}
                          {spec.draw > 0 ? <em>needs {spec.draw} footfall</em> : null}
                          {spec.capacity > 0 ? <em>+{spec.capacity} capacity</em> : null}
                          {spec.load > 0 ? <em>uses {spec.load} capacity</em> : null}
                          <em>{spec.upkeep}c upkeep</em>
                        </span>
                        {locked ? <span className="offer__locked">Unlocks at rank {spec.unlockAt}</span> : null}
                        {!locked && poor ? <span className="offer__locked">Not enough credits</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              <h2 className="moves__title">
                {TRADE[selected.trade!].name} · level {selected.level}
              </h2>
              <p className="moves__note">
                {selected.offline === "capacity"
                  ? "Dark: the city has no headroom to run it. A foundry in the Offer Forge brings it back."
                  : selected.offline === "funds"
                    ? "Dark: the city could not cover its upkeep. It comes back on by itself once the books balance."
                    : TRADE[selected.trade!].blurb}
              </p>

              {selected.level < Math.min(MAX_LEVEL, rank.levelCap) ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  data-action="upgrade"
                  disabled={credits < upgradeCost(selected.trade!, selected.level)}
                  onClick={() => onBuild(selected.id, selected.trade!)}
                >
                  Raise to level {selected.level + 1} · {upgradeCost(selected.trade!, selected.level)}c
                </button>
              ) : (
                <p className="moves__capped">
                  {selected.level >= MAX_LEVEL
                    ? "As high as anything can be built."
                    : `A ${rank.name} builds no higher. Grow the city to raise the cap.`}
                </p>
              )}

              <button
                type="button"
                className="btn btn--quiet"
                data-action="clear"
                onClick={() => onClear(selected.id)}
              >
                Clear · {demolitionRefund(selected.trade!, selected.level)}c back
              </button>
            </>
          )}
        </section>
      ) : (
        <p className="moves__none">Pick a plot, in the world or above.</p>
      )}

      {notes}
    </div>
  );
}
