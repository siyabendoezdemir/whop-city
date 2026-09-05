import { evidenceKind } from "../city/evidence";
import { DISTRICT_NAMES } from "../city/explain";
import type { DistrictId } from "../city/projection";
import type { DistrictWork, Session } from "../city/session";
import { CONDITION, primaryVerb } from "../city/vocabulary";
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
  onPrimary: () => void;
  planOpen: boolean;
};

function studMark(work: DistrictWork): string | undefined {
  if (work.changed) return "changed";
  if (work.complete) return "done";
  return undefined;
}

export function CommandBar({ session, selected, onSelect, onBack, onPrimary, planOpen }: Props) {
  const total = session.work.filter((entry) => entry.activity !== null).length;
  const done = session.work.filter((entry) => entry.complete).length;
  const started = session.plan.length > 0;

  return (
    <div className="bar surface" role="toolbar" aria-label="Round">
      {selected || planOpen ? (
        <button type="button" className="bar__back" data-action="back" onClick={onBack}>
          <span aria-hidden="true">←</span> Whop City
        </button>
      ) : (
        <div className="bar__round">
          <span className="bar__title">{session.title}</span>
          {total > 0 ? (
            <span className="bar__count" data-local="true">
              <span data-testid="session-progress">
                {done} of {total}
              </span>{" "}
              districts worked
            </span>
          ) : (
            <span className="bar__count">Nothing City can suggest work from</span>
          )}
        </div>
      )}

      {!selected && total > 0 ? (
        <button type="button" className="btn btn--primary bar__go" data-action="primary" onClick={onPrimary}>
          {primaryVerb(started, session.complete)}
        </button>
      ) : null}

      {total > 0 ? (
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
                aria-label={`${name}: ${condition.label}${entry.complete ? ", worked" : ""}`}
                onClick={() => onSelect(entry.district.id)}
              >
                <Glyph name={condition.glyph} className="stud__glyph" />
                <span className="stud__name">{name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
