import { CHECK_ANSWERS, CHECK_LABEL, COMMIT_ANSWERS, COMMIT_LABEL, type Prompt } from "../city/activities";
import { EVIDENCE_LIMIT, PROVENANCE_LABEL, PROVENANCE_NOTE, readingFor } from "../city/evidence";
import { DISTRICT_NAMES, DISTRICT_SUBTITLES } from "../city/explain";
import type { DistrictWork } from "../city/session";
import type { DistrictId } from "../city/projection";

/**
 * One district's panel: what City saw, the work in front of you, and what you
 * have decided so far.
 *
 * The three are visually separate because they have different authority. The
 * reading is what Whop reported and carries the limit of what City can know.
 * The activity is a question being put to the operator. The plan is what they
 * answered, marked as theirs.
 */

type Props = {
  work: DistrictWork;
  onAnswer: (prompt: Prompt, value: string) => void;
  onUndoLast: () => void;
  onRestart: () => void;
};

/** A small tag saying where a block of content came from. */
export function Provenance({ kind }: { kind: "observed" | "reported" | "local" }) {
  return (
    <span className="prov" data-provenance={kind} title={PROVENANCE_NOTE[kind]}>
      {PROVENANCE_LABEL[kind]}
    </span>
  );
}

export function DistrictPanel({ work, onAnswer, onUndoLast, onRestart }: Props) {
  const { district, activity, run, plan, changed, declined } = work;
  const reading = readingFor(district);
  const current = run?.current ?? null;

  return (
    <>
      <header className="panel__head">
        <p className="panel__subtitle">{DISTRICT_SUBTITLES[district.id]}</p>
        <h1 className="panel__name">{DISTRICT_NAMES[district.id]}</h1>
      </header>

      {/* ------------------------------------------------------- what City saw */}
      <section className="panel__reading" aria-label="What City observed">
        <Provenance kind="observed" />
        <p className="panel__observed">{reading.observed}</p>
        {reading.ambiguity ? <p className="panel__ambiguity">{reading.ambiguity}</p> : null}
        <p className="panel__limit">{EVIDENCE_LIMIT}</p>
      </section>

      {changed ? (
        <p className="panel__changed" role="note">
          City has read this district differently since you worked here. Your notes are kept, but
          they are no longer known to be current. City cannot tell you what changed or why.
        </p>
      ) : null}

      {/* --------------------------------------------------------- the activity */}
      {activity ? (
        <section className="panel__activity" aria-label="Work">
          <div className="panel__activityHead">
            <h2 className="panel__activityTitle">{activity.title}</h2>
            <p className="panel__activityPurpose">{activity.purpose}</p>
          </div>

          {current ? (
            <div className="prompt" data-kind={current.kind} data-prompt={current.id}>
              <p className="prompt__step">
                Step <span data-local="true">{(run?.reached ?? 0) + 1}</span>
              </p>
              <h3 className="prompt__title">{current.title}</h3>
              <p className="prompt__why">{current.why}</p>

              <div className="prompt__answers" role="group" aria-label={current.title}>
                {current.kind === "check"
                  ? CHECK_ANSWERS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="answer"
                        data-answer={value}
                        onClick={() => onAnswer(current, value)}
                      >
                        {CHECK_LABEL[value]}
                      </button>
                    ))
                  : null}

                {current.kind === "commit"
                  ? COMMIT_ANSWERS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="answer"
                        data-answer={value}
                        onClick={() => onAnswer(current, value)}
                      >
                        {COMMIT_LABEL[value]}
                      </button>
                    ))
                  : null}

                {current.kind === "choice"
                  ? (current.options ?? []).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="answer answer--wide"
                        data-answer={option.id}
                        onClick={() => onAnswer(current, option.id)}
                      >
                        {option.label}
                      </button>
                    ))
                  : null}
              </div>

              <p className="prompt__note">
                Your answer, not a measurement. City does not check it and does not send it anywhere.
              </p>
            </div>
          ) : (
            <p className="panel__done" data-testid="district-done">
              {declined
                ? "Decided: this is deliberately not part of the business. Nothing further here."
                : "Everything here is worked through. The plan below is what you decided."}
            </p>
          )}
        </section>
      ) : (
        <p className="panel__blocked">
          City could not read this district, so it has nothing to suggest. Work proposed from a
          failed reading would be work invented from nothing.
        </p>
      )}

      {/* -------------------------------------------------------- what you said */}
      {plan.length > 0 ? (
        <section className="panel__plan" aria-label="What you decided here">
          <div className="panel__planHead">
            <h2 className="panel__planTitle">Your notes here</h2>
            <Provenance kind="reported" />
          </div>
          <ul className="planlist">
            {plan.map((item) => (
              <li key={item.promptId} className="planlist__item" data-kind={item.kind}>
                <span className="planlist__mark" aria-hidden="true" />
                <span className="planlist__text">
                  {item.text}
                  {item.staleAgainstObservation ? (
                    <span className="planlist__stale"> · recorded under an older reading</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

          <div className="panel__undo">
            <button type="button" className="ghost" data-action="undo" onClick={onUndoLast}>
              Undo last answer
            </button>
            <button type="button" className="ghost" data-action="restart" onClick={onRestart}>
              Start this district again
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}

export const DISTRICT_LABEL = (id: DistrictId) => DISTRICT_NAMES[id];
