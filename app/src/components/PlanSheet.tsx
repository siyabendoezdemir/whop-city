import { useState } from "react";

import { evidenceKind } from "../city/evidence";
import { DISTRICT_NAMES } from "../city/explain";
import { planAsText, type Session } from "../city/session";
import { CONDITION } from "../city/vocabulary";
import { Glyph } from "./Glyphs";

/**
 * The plan sheet.
 *
 * The round's deliverable, and the only surface allowed to take the middle of
 * the screen — it is the thing the operator leaves with, not a layer over the
 * world. Each district's entry keeps the two authorities apart in the same
 * arrangement the dossier uses: the observed condition at the head, the
 * operator's own items beneath it.
 *
 * Finishing is allowed to feel like finishing. It is not allowed to imply the
 * business improved, so the line under the title says exactly what happened:
 * a plan exists, and nothing else changed.
 */

type Props = {
  session: Session;
  rounds: number;
  onClose: () => void;
  onClear: () => void;
  onCopied: () => void;
};

export function PlanSheet({ session, rounds, onClose, onClear, onCopied }: Props) {
  const [copied, setCopied] = useState(false);
  const entries = session.work.filter((entry) => entry.plan.length > 0);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Session plan" data-testid="plan">
      <div className="sheet__paper">
        <header className="sheet__head">
          <h1 className="sheet__title">{session.complete ? "Round finished" : "Your plan so far"}</h1>
          <p className="sheet__sub">
            {session.complete
              ? "Every district in this round is worked through. Nothing about the business changed because of it — this is your plan, not a result."
              : "What you have decided so far. Come back to it whenever."}
            {rounds > 0 ? (
              <>
                {" "}
                <span className="sheet__rounds" data-local="true">
                  Rounds finished in this browser: <span data-testid="rounds">{rounds}</span>.
                </span>
              </>
            ) : null}
          </p>
        </header>

        {entries.length === 0 ? (
          <p className="sheet__empty">Nothing recorded yet. Pick a district and start.</p>
        ) : (
          entries.map((entry) => {
            const condition = CONDITION[evidenceKind(entry.district)];
            return (
              <section key={entry.district.id} className="entry" data-district={entry.district.id}>
                <div className="entry__head">
                  <h2 className="entry__name">{DISTRICT_NAMES[entry.district.id]}</h2>
                  <span className="cond" data-tone={condition.tone}>
                    <Glyph name={condition.glyph} className="cond__glyph" />
                    {condition.label}
                  </span>
                </div>
                {entry.changed ? (
                  <p className="entry__changed">Whop reads this differently now than when you worked here.</p>
                ) : null}
                <ul className="entry__items">
                  {entry.plan.map((item) => (
                    <li key={item.promptId} className="note" data-kind={item.kind}>
                      <span className="note__rule" aria-hidden="true" />
                      <span className="note__text">{item.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}

        <footer className="sheet__foot">
          {entries.length > 0 ? (
            <p className="legend">
              <span className="is-action">
                <i /> to do
              </span>
              <span className="is-clear">
                <i /> checked, fine
              </span>
              <span className="is-finding">
                <i /> decided
              </span>
            </p>
          ) : null}

          <p className="sheet__where">
            The condition on each district is from Whop. Everything under it is what you told City,
            kept in this browser only — not sent to Whop, and not a record that the work was done.
          </p>

          <div className="sheet__acts">
            {entries.length > 0 ? (
              <button
                type="button"
                className="btn btn--primary"
                data-action="copy-plan"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(planAsText(session, (id) => DISTRICT_NAMES[id]))
                    .catch(() => undefined);
                  setCopied(true);
                  onCopied();
                }}
              >
                {copied ? "Copied" : "Copy as text"}
              </button>
            ) : null}
            <button type="button" className="btn" data-action="close-plan" onClick={onClose}>
              Back to the city
            </button>
            {entries.length > 0 ? (
              <button type="button" className="btn btn--quiet" data-action="reset-all" onClick={onClear}>
                Clear all answers
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
