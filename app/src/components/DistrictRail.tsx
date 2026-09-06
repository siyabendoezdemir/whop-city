import { DISTRICT_IDS, type DistrictId } from "../city/projection";
import { DISTRICT_NAMES } from "../city/explain";
import { RESOURCE } from "../game/buildings";
import type { Reading } from "../game/quests";
import { DistrictIcon } from "./Icons";

/**
 * The three districts, down the left.
 *
 * Each one is a place you can go, and the button says everything you would
 * otherwise have to fly over and look at: what it runs on, how much of it is
 * standing, whether anything there is waiting to be pressed, and how that part
 * of the business is actually doing.
 *
 * Condition and progress are kept apart deliberately. The bar of pips is what
 * the player has built; the line underneath is what the business is doing. A
 * fully built district whose members are walking out has to be able to say
 * both of those things at once.
 */

export type RailEntry = {
  district: DistrictId;
  levels: number;
  maxLevels: number;
  built: number;
  plots: number;
  ready: number;
  reading: Reading;
  resource: keyof typeof RESOURCE;
};

type Props = {
  entries: readonly RailEntry[];
  active: DistrictId | null;
  onPick: (district: DistrictId) => void;
};

export function DistrictRail({ entries, active, onPick }: Props) {
  const byId = new Map(entries.map((entry) => [entry.district, entry]));

  return (
    <nav className="rail" aria-label="Districts">
      {DISTRICT_IDS.map((id) => {
        const entry = byId.get(id);
        if (!entry) return null;
        const pips = Math.round((entry.levels / Math.max(1, entry.maxLevels)) * 10);
        return (
          <button
            key={id}
            type="button"
            className="rail__go"
            data-district={id}
            data-tone={entry.reading.tone}
            aria-pressed={active === id}
            onClick={() => onPick(id)}
          >
            <span className="rail__icon" aria-hidden="true">
              <DistrictIcon district={id} />
            </span>

            <span className="rail__text">
              <span className="rail__top">
                <span className="rail__name">{DISTRICT_NAMES[id]}</span>
                <span className="rail__built" data-testid={`rail-built-${id}`}>
                  {entry.built}/{entry.plots}
                </span>
              </span>

              <span className="rail__pips" aria-hidden="true">
                {Array.from({ length: 10 }, (_, index) => (
                  <i key={index} data-on={index < pips} />
                ))}
              </span>

              <span className="rail__reading" data-tone={entry.reading.tone}>
                {entry.reading.line}
              </span>
            </span>

            {entry.ready > 0 ? (
              <span className="rail__bell" data-testid={`rail-ready-${id}`}>
                {entry.ready}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
