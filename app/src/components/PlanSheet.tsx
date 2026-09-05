import { useEffect, useRef, useState } from "react";

import { evidenceKind } from "../city/evidence";
import { copyPlan, downloadPlan, planFilename } from "../city/export";
import { DISTRICT_NAMES } from "../city/explain";
import { planAsText, type Session } from "../city/session";
import { CONDITION } from "../city/vocabulary";
import type { FiledRound } from "../state/operatorLog";
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
 * business improved, so the line under the title says exactly what happened: a
 * plan exists, and nothing else changed.
 */

type Props = {
  session: Session;
  rounds: readonly FiledRound[];
  onClose: () => void;
  /** File this round and clear the desk. Only offered once it is finished. */
  onFileRound: () => void;
  onDiscard: () => void;
  onSay: (message: string) => void;
};

const conditionOf = (district: Parameters<typeof evidenceKind>[0]) => CONDITION[evidenceKind(district)];

function roundAsText(round: FiledRound): string {
  const lines = [`# Whop City — ${round.title}`, "", new Date(round.at).toISOString().slice(0, 16).replace("T", " ") + " UTC", ""];
  let current = "";
  for (const item of round.items) {
    if (item.districtName !== current) {
      current = item.districtName;
      lines.push(`## ${current}`, `Whop reported: ${item.condition}`, "");
    }
    const mark = item.kind === "action" ? "- [ ]" : item.kind === "clear" ? "- [x]" : item.kind === "note" ? ">" : "-";
    lines.push(`${mark} ${item.text}`);
  }
  lines.push("", "---", "Kept in your browser only. Not sent to Whop.");
  return lines.join("\n");
}

export function PlanSheet({ session, rounds, onClose, onFileRound, onDiscard, onSay }: Props) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [confirming, setConfirming] = useState(false);
  const paperRef = useRef<HTMLDivElement>(null);
  const entries = session.work.filter((entry) => entry.plan.length > 0);
  const text = planAsText(session, (id) => DISTRICT_NAMES[id], (district) => conditionOf(district).label);

  // Escape closes, and focus starts inside the sheet so a keyboard user is not
  // left behind on the city.
  useEffect(() => {
    paperRef.current?.focus();
  }, []);

  const actions = entries.length > 0;

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Round plan" data-testid="plan">
      <div className="sheet__paper" ref={paperRef} tabIndex={-1}>
        <header className="sheet__head">
          <h1 className="sheet__title">{session.complete ? "Round finished" : "Your plan so far"}</h1>
          <p className="sheet__sub">
            {session.complete
              ? "Every district in this round is worked through. Nothing about the business changed because of it — this is your plan, not a result."
              : "What you have decided so far. Come back to it whenever."}
          </p>
        </header>

        {entries.length === 0 ? (
          <p className="sheet__empty">Nothing recorded yet. Pick a district and start.</p>
        ) : (
          entries.map((entry) => {
            const condition = conditionOf(entry.district);
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
          {actions ? (
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
              <span className="is-note">
                <i /> your note
              </span>
            </p>
          ) : null}

          <p className="sheet__where">
            The condition on each district is from Whop. Everything under it is what you told Whop
            City, kept in this browser only — not sent to Whop, and not a record that the work was
            done.
          </p>

          <div className="sheet__acts">
            {actions ? (
              <>
                <button
                  type="button"
                  className="btn btn--primary"
                  data-action="copy-plan"
                  onClick={async () => {
                    const result = await copyPlan(text);
                    setCopied(result === "copied" ? "done" : "failed");
                    onSay(result === "copied" ? "Plan copied." : "Could not copy. Use Download, or select the text.");
                  }}
                >
                  {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy as text"}
                </button>
                <button
                  type="button"
                  className="btn"
                  data-action="download-plan"
                  onClick={() => {
                    const ok = downloadPlan(text, planFilename(session.title));
                    onSay(ok ? "Plan downloaded." : "Could not download in this browser.");
                  }}
                >
                  Download
                </button>
              </>
            ) : null}
            <button type="button" className="btn" data-action="close-plan" onClick={onClose}>
              Back to the city
            </button>
          </div>

          {/* The copy route can fail for reasons a deployment does not control.
              When it does, the text is put on screen to be selected by hand
              rather than the button pretending it worked. */}
          {copied === "failed" ? (
            <label className="fallbackCopy">
              <span>This browser would not let the page copy for you. Select this and copy it:</span>
              <textarea readOnly value={text} rows={6} data-testid="plan-text" />
            </label>
          ) : null}

          {/* Starting again and throwing away are different intentions, and
              only one of them used to be on offer. */}
          {actions ? (
            <div className="sheet__next">
              {session.complete ? (
                <button type="button" className="btn" data-action="new-round" onClick={onFileRound}>
                  File this round and start a new one
                </button>
              ) : null}

              {confirming ? (
                <span className="confirm" role="group" aria-label="Discard this round?">
                  <span className="confirm__ask">Throw away this round's notes?</span>
                  <button type="button" className="btn btn--quiet" data-action="discard-yes"
                    onClick={() => { setConfirming(false); onDiscard(); }}>
                    Throw away
                  </button>
                  <button type="button" className="btn btn--quiet" data-action="discard-no"
                    onClick={() => setConfirming(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="btn btn--quiet" data-action="discard"
                  onClick={() => setConfirming(true)}>
                  Discard this round
                </button>
              )}
            </div>
          ) : null}

          {rounds.length > 0 ? (
            <details className="filed">
              <summary className="filed__summary">
                Earlier rounds <span data-local="true">({rounds.length})</span>
              </summary>
              <ul className="filed__list">
                {rounds.map((round) => (
                  <li key={round.at} className="filed__round">
                    <span className="filed__when" data-local="true">
                      {new Date(round.at).toISOString().slice(0, 10)}
                    </span>
                    <span className="filed__title">{round.title}</span>
                    <span className="filed__count" data-local="true">
                      {round.items.length} items
                    </span>
                    <button
                      type="button"
                      className="btn btn--quiet"
                      data-action="copy-filed"
                      onClick={async () => {
                        const result = await copyPlan(roundAsText(round));
                        onSay(result === "copied" ? "Earlier round copied." : "Could not copy that round.");
                      }}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet"
                      data-action="download-filed"
                      onClick={() =>
                        downloadPlan(roundAsText(round), planFilename(round.title, new Date(round.at)))
                      }
                    >
                      Download
                    </button>
                  </li>
                ))}
              </ul>
              <p className="filed__where">
                Kept in this browser. The newest {rounds.length === 1 ? "round is" : "rounds are"} kept;
                older ones drop off.
              </p>
            </details>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
