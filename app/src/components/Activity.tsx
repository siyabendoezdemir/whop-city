import {
  CHECK_ANSWERS,
  CHECK_LABEL,
  COMMIT_ANSWERS,
  COMMIT_LABEL,
  type Activity as ActivityDef,
  type Prompt,
} from "../city/activities";
import type { ActivityRun } from "../city/session";

/**
 * The work itself, composed three ways.
 *
 * The engine underneath is one thing — an ordered walk over prompts — but a
 * survey, a decision and a commitment are not the same act, and presenting
 * them in one questionnaire card was the flaw this replaces. Each gets a shape
 * that matches what it asks of the operator:
 *
 *   survey      a ledger you work down, answered rows collapsing behind you
 *   decision    a fork, options as full-width plates you choose between
 *   commitment  a single statement with two opposed answers and nothing else
 *
 * All three are keyboard-operable in the same way and all three record the
 * same kind of thing: the operator's own report.
 */

type Props = {
  activity: ActivityDef;
  run: ActivityRun;
  /** Answers already given, so the ledger can show what was said. */
  answerOf: (promptId: string) => string | null;
  onAnswer: (prompt: Prompt, value: string) => void;
  /** Re-open an answered step. Anything that followed it is dropped. */
  onReopen: (promptId: string) => void;
};

const KIND_NAME: Record<Prompt["kind"], string> = {
  check: "Survey",
  choice: "Decision",
  commit: "Commitment",
};

const CHECK_TONE: Record<string, string> = {
  confirmed: "clear",
  problem: "flagged",
  "not-applicable": "aside",
};

export function Activity({ activity, run, answerOf, onAnswer, onReopen }: Props) {
  const current = run.current;

  if (!current) {
    return (
      <div className="act act--done" data-testid="district-done">
        <p className="act__doneLine">Worked through.</p>
      </div>
    );
  }

  const kind = current.kind;

  return (
    <section className="act" data-kind={kind} data-prompt={current.id} aria-label={activity.title}>
      <header className="act__head">
        <h2 className="act__title">{activity.title}</h2>
        <p className="act__purpose">{activity.purpose}</p>
      </header>

      {/* ------------------------------------------------------------ survey */}
      {kind === "check" ? (
        <div className="ledger">
          <p className="ledger__count">
            {KIND_NAME.check} · step <span data-local="true">{run.reached + 1}</span>
          </p>

          {run.answered.length > 0 ? (
            <ol className="ledger__done">
              {run.answered.map((prompt) => {
                const value = answerOf(prompt.id) ?? "";
                return (
                  <li key={prompt.id} className="ledger__row" data-outcome={CHECK_TONE[value] ?? "aside"}>
                    <button
                      type="button"
                      className="ledger__reopen"
                      data-reopen={prompt.id}
                      title="Answer this step again"
                      onClick={() => onReopen(prompt.id)}
                    >
                      <span className="ledger__tick" aria-hidden="true" />
                      <span className="ledger__what">{prompt.title}</span>
                      <span className="ledger__said">
                        {CHECK_LABEL[value as keyof typeof CHECK_LABEL] ?? value}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : null}

          <div className="ledger__now">
            <h3 className="step__title">{current.title}</h3>
            <p className="step__why">{current.why}</p>
            <div className="answers" role="group" aria-label={current.title}>
              {CHECK_ANSWERS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="btn answer"
                  data-answer={value}
                  onClick={() => onAnswer(current, value)}
                >
                  {CHECK_LABEL[value]}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- decision */}
      {kind === "choice" ? (
        <div className="fork">
          <p className="fork__kind">{KIND_NAME.choice}</p>
          <h3 className="step__title step__title--lead">{current.title}</h3>
          <p className="step__why">{current.why}</p>
          <div className="fork__options" role="group" aria-label={current.title}>
            {(current.options ?? []).map((option) => (
              <button
                key={option.id}
                type="button"
                className="plate"
                data-answer={option.id}
                onClick={() => onAnswer(current, option.id)}
              >
                <span className="plate__label">{option.label}</span>
                <span className="plate__go" aria-hidden="true">
                  →
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* -------------------------------------------------------- commitment */}
      {kind === "commit" ? (
        <div className="resolve">
          <p className="fork__kind">{KIND_NAME.commit}</p>
          <h3 className="step__title step__title--lead">{current.title}</h3>
          <p className="step__why">{current.why}</p>
          <div className="resolve__answers" role="group" aria-label={current.title}>
            {COMMIT_ANSWERS.map((value) => (
              <button
                key={value}
                type="button"
                className={value === "will-do" ? "btn btn--primary answer" : "btn answer"}
                data-answer={value}
                onClick={() => onAnswer(current, value)}
              >
                {COMMIT_LABEL[value]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
