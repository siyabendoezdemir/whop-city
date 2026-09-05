import { HARBOUR_DUE, rankFor, nextRank } from "../game/catalog";
import type { Reading } from "../game/state";

/**
 * The city's vital signs.
 *
 * Top right, always on, three readings and no more. Credits is the only stock
 * — the thing you spend — so it leads and carries its rate. Footfall and
 * capacity are gauges, because both are constraints rather than scores and a
 * bar says "you are near the edge of this" in a way a number never does.
 *
 * The whole panel is marked simulated, once, at the top. Every number in here
 * is invented by the game; none of it is the business, and the one place that
 * needs saying is the place the numbers are.
 */

type Props = {
  credits: number;
  reading: Reading;
};

function Gauge({
  label,
  used,
  of,
  tone,
  short,
  hint,
}: {
  label: string;
  used: number;
  of: number;
  tone: string;
  short: boolean;
  hint: string;
}) {
  const fill = of === 0 ? 0 : Math.min(1, used / of);
  return (
    <div className="gauge" data-short={short ? "true" : "false"} data-gauge={label.toLowerCase()}>
      <span className="gauge__label">{label}</span>
      <span className="gauge__bar" aria-hidden="true">
        <span className="gauge__fill" style={{ width: `${Math.round(fill * 100)}%`, background: tone }} />
      </span>
      <span className="gauge__value" data-local="true">
        {used} / {of}
      </span>
      {short ? <span className="gauge__warn">{hint}</span> : null}
    </div>
  );
}

export function Resources({ credits, reading }: Props) {
  const rank = rankFor(reading.totalLevels);
  const next = nextRank(reading.totalLevels);
  const net = reading.net;

  return (
    <section className="vitals surface" aria-label="City">
      <header className="vitals__head">
        <span className="vitals__rank">{rank.name}</span>
        <span className="vitals__sim" title="Everything in this panel is invented by the game.">
          Simulated
        </span>
      </header>

      <div className="vitals__credits">
        <span className="vitals__amount" data-local="true" data-testid="credits">
          {Math.floor(credits)}
        </span>
        <span className="vitals__unit">credits</span>
        <span className="vitals__rate" data-rate={net > 0 ? "up" : net < 0 ? "down" : "flat"} data-local="true">
          {net > 0 ? "+" : ""}
          {net} / tick
        </span>
      </div>

      <Gauge
        label="Footfall"
        used={reading.footfallDemand}
        of={reading.footfallSupply}
        tone="var(--tone-open)"
        short={reading.shortOfFootfall}
        hint="Not enough people. Build in the Creator Quarter."
      />
      <Gauge
        label="Capacity"
        used={reading.capacityUsed}
        of={reading.capacitySupply}
        tone="var(--tone-active)"
        short={reading.overCapacity}
        hint="No headroom. Build a foundry in the Offer Forge."
      />

      {reading.inArrears ? (
        <p className="vitals__alarm" role="status">
          {reading.darkForFunds === 1 ? "A building is" : `${reading.darkForFunds} buildings are`} dark: the
          city cannot cover its upkeep. Clear something, or wait — the harbour still pays {HARBOUR_DUE} a
          tick.
        </p>
      ) : null}

      {next ? (
        <p className="vitals__next" data-local="true">
          {next.name} at {next.at} levels — {reading.totalLevels} built
        </p>
      ) : (
        <p className="vitals__next">The city is as grand as it gets.</p>
      )}
    </section>
  );
}
