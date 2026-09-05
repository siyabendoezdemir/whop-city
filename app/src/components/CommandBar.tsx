import { evidenceKind } from "../city/evidence";
import { DISTRICT_NAMES } from "../city/explain";
import type { DistrictId } from "../city/projection";
import type { DistrictWork, Session } from "../city/session";
import { CONDITION } from "../city/vocabulary";
import type { Plot, Reading } from "../game/state";
import { Glyph } from "./Glyphs";

/**
 * The command bar.
 *
 * One surface along the bottom edge carrying everything the resting city
 * needs: what this round is, the single control that starts or resumes it, and
 * three studs that are both the compact district overview and the only other
 * way to navigate. The district list used to be a permanent panel on the left
 * *and* a row of pills along the bottom; this is what replaced both.
 *
 * When a district is selected the bar changes rather than multiplying: the
 * primary control becomes the way back out.
 */

type Props = {
  session: Session;
  selected: DistrictId | null;
  onSelect: (id: DistrictId) => void;
  onBack: () => void;
  /** Take me to the next thing worth doing. */
  onPrimary: () => void;
  planOpen: boolean;
  plots: readonly Plot[];
  reading: Reading | null;
};

/**
 * What the city most needs said, in one line.
 *
 * Ordered by how badly it wants attention rather than by category, because the
 * bar has room for exactly one of these and the player should be told the
 * worst thing first.
 */
function status(reading: Reading | null, plots: readonly Plot[]): string {
  if (!reading) return "";
  if (reading.inArrears) return "Buildings are dark — the city cannot pay for them.";
  if (reading.overCapacity) return "Out of headroom. A foundry would fix it.";
  if (reading.shortOfFootfall) return "Short of footfall — the shops are half empty.";
  if (reading.developed === 0) return "Nothing built yet. Start with somewhere people go.";
  if (plots.some((plot) => plot.derelict)) return "Something inherited is standing but dead.";
  if (reading.net <= 1) return "Breaking even. Build something that earns.";
  return `Running well · ${reading.net} credits a tick`;
}

function studMark(work: DistrictWork): string | undefined {
  if (work.changed) return "changed";
  if (work.complete) return "done";
  return undefined;
}

export function CommandBar({
  session,
  selected,
  onSelect,
  onBack,
  onPrimary,
  planOpen,
  plots,
  reading,
}: Props) {
  const levelsIn = (district: DistrictId) =>
    plots.filter((plot) => plot.district === district).reduce((sum, plot) => sum + plot.level, 0);

  return (
    <div className="bar surface" role="toolbar" aria-label="Round">
      {selected || planOpen ? (
        <button type="button" className="bar__back" data-action="back" onClick={onBack}>
          <span aria-hidden="true">←</span> Whop City
        </button>
      ) : (
        <div className="bar__round">
          <span className="bar__title" data-testid="city-status">
            {status(reading, plots)}
          </span>
          <span className="bar__count" data-local="true">
            <span data-testid="city-levels">{reading?.totalLevels ?? 0}</span> levels standing across{" "}
            {reading?.developed ?? 0} plots
          </span>
        </div>
      )}

      {/* One action at a time. With a district open the way out is the way
          back, and a second primary beside it asks the same question twice. */}
      {!selected && !planOpen ? (
        <button type="button" className="btn btn--primary bar__go" data-action="primary" onClick={onPrimary}>
          Build
        </button>
      ) : null}

      {/* The studs stand whether or not there is work. A city City could not
          read still has districts, and each one can still say so. */}
      {session.work.length > 0 ? (
        <div className="studs">
          {session.work.map((entry) => {
            const condition = CONDITION[evidenceKind(entry.district)];
            const name = DISTRICT_NAMES[entry.district.id];
            return (
              <button
                key={entry.district.id}
                type="button"
                className="stud"
                data-district={entry.district.id}
                data-tone={condition.tone}
                data-condition={evidenceKind(entry.district)}
                data-progress={studMark(entry) ?? "none"}
                data-done={entry.complete ? "true" : "false"}
                aria-pressed={selected === entry.district.id}
                aria-label={`${name}: ${levelsIn(entry.district.id)} levels built. Whop found it ${condition.label}.`}
                onClick={() => onSelect(entry.district.id)}
              >
                <Glyph name={condition.glyph} className="stud__glyph" />
                <span className="stud__name">{name}</span>
                <span className="stud__levels" data-local="true">
                  {levelsIn(entry.district.id)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
