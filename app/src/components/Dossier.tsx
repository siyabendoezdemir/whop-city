import { useEffect, useRef, useState } from "react";

import type { Prompt } from "../city/activities";
import { EVIDENCE_LIMIT, PROVENANCE_NOTE, evidenceKind, readingFor } from "../city/evidence";
import { DISTRICT_NAMES, DISTRICT_SUBTITLES } from "../city/explain";
import type { DistrictWork } from "../city/session";
import { CONDITION } from "../city/vocabulary";
import { NOTE_LIMIT } from "../state/operatorLog";
import { Activity } from "./Activity";
import { Glyph } from "./Glyphs";

/**
 * The dossier: one district, entered.
 *
 * Anchored to the right edge and full height rather than floating, because a
 * card hovering over the middle of a render reads as a dialog interrupting the
 * game instead of a part of it. Reading order is fixed and short: who this is,
 * what Whop says, the one thing to do, and what you have said so far.
 *
 * The evidence — the exact observation, its ambiguity, and the limit of what
 * City can know — sits behind a disclosure rather than on the surface. It has
 * to be one click away, because the ambiguity is the honest part; it does not
 * have to be four lines of defensive prose in front of every reading.
 */

type Props = {
  work: DistrictWork;
  onAnswer: (prompt: Prompt, value: string) => void;
  /** Re-open an answered step so it can be answered again. */
  onReopen: (promptId: string) => void;
  onNote: (text: string) => void;
  onUndoLast: () => void;
  onRestart: () => void;
};

export function Dossier({ work, onAnswer, onReopen, onNote, onUndoLast, onRestart }: Props) {
  const { district, activity, run, plan, changed, declined } = work;
  const [draft, setDraft] = useState(work.note);
  const field = useRef<HTMLTextAreaElement>(null);

  // Switching district swaps the panel's contents underneath the same
  // component, so the draft has to follow it rather than leak across.
  useEffect(() => {
    setDraft(work.note);
  }, [district.id, work.note]);
  const kind = evidenceKind(district);
  const condition = CONDITION[kind];
  const reading = readingFor(district);

  return (
    <div className="dossier__inner">
      <header className="dossier__head">
        <h1 className="dossier__name">{DISTRICT_NAMES[district.id]}</h1>
        <p className="dossier__role">{DISTRICT_SUBTITLES[district.id]}</p>
      </header>

      {/* -------------------------------------------------- observed condition */}
      <section className="state" aria-label="Condition">
        <p className="cond" data-tone={condition.tone}>
          <Glyph name={condition.glyph} className="cond__glyph" />
          {condition.label}
        </p>
        <p className="state__line">{condition.line}</p>

        <details className="why">
          <summary className="why__summary">Why City says this</summary>
          <div className="why__body">
            <p className="why__observed">{reading.observed}</p>
            {reading.ambiguity ? <p className="why__ambiguity">{reading.ambiguity}</p> : null}
            <p className="why__limit" title={PROVENANCE_NOTE.observed}>
              {EVIDENCE_LIMIT}
            </p>
          </div>
        </details>

        {changed ? (
          <p className="state__changed" role="note">
            Whop reads this differently now than when you worked here. Your notes are kept and
            marked. City cannot say what changed, or why.
          </p>
        ) : null}
      </section>

      {/* ---------------------------------------------------------- the work */}
      {activity && run ? (
        <Activity
          activity={activity}
          run={run}
          answerOf={(promptId) =>
            work.answers.find((answer) => answer.promptId === promptId)?.value ?? null
          }
          onAnswer={onAnswer}
          onReopen={onReopen}
        />
      ) : (
        <p className="act act--blocked">
          With no reading there is nothing to suggest. Work proposed from a failed read would be
          work invented from nothing.
        </p>
      )}

      {declined ? <p className="dossier__aside">Set aside deliberately. Nothing further here.</p> : null}

      {/* -------------------------------------------------------- your own line */}
      {activity ? (
        <section className="jot" aria-label="Your note">
          <label className="jot__label" htmlFor={`note-${district.id}`}>
            Anything you want to remember here
          </label>
          <textarea
            id={`note-${district.id}`}
            ref={field}
            className="jot__field"
            data-local="true"
            data-testid="note"
            rows={2}
            maxLength={NOTE_LIMIT}
            placeholder="Optional. A decision, a link, what you found."
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, NOTE_LIMIT))}
            onBlur={() => onNote(draft)}
            // On a phone the keyboard covers the lower half; bring the field
            // above it rather than leaving the operator typing blind.
            onFocus={() =>
              window.setTimeout(() => field.current?.scrollIntoView({ block: "center" }), 250)
            }
          />
          <p className="jot__where">
            Kept in this browser and added to your plan. Not sent to Whop — so keep customer details
            out of it.
          </p>
        </section>
      ) : null}

      {/* --------------------------------------------------------- your notes */}
      {plan.length > 0 ? (
        <section className="notes" aria-label="What you recorded here">
          <h2 className="notes__title">
            Your notes <span data-local="true">({plan.length})</span>
          </h2>
          <ul className="notes__list">
            {plan.map((item) => (
              <li key={item.promptId} className="note" data-kind={item.kind}>
                <span className="note__rule" aria-hidden="true" />
                <span className="note__text">
                  {item.text}
                  {item.staleAgainstObservation ? (
                    <span className="note__stale"> · under an older reading</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <div className="notes__acts">
            <button type="button" className="btn btn--quiet" data-action="undo" onClick={onUndoLast}>
              Undo last
            </button>
            <button type="button" className="btn btn--quiet" data-action="restart" onClick={onRestart}>
              Start over
            </button>
          </div>
          <p className="notes__where" title={PROVENANCE_NOTE.reported}>
            Yours, kept in this browser. Not sent to Whop.
          </p>
        </section>
      ) : null}
    </div>
  );
}
