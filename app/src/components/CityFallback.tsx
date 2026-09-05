import { CHECK_ANSWERS, CHECK_LABEL, COMMIT_ANSWERS, COMMIT_LABEL, type Prompt } from "../city/activities";
import { EVIDENCE_LIMIT, evidenceKind, readingFor } from "../city/evidence";
import { DISTRICT_NAMES, DISTRICT_SUBTITLES } from "../city/explain";
import type { DistrictWork, Session } from "../city/session";
import type { DistrictId } from "../city/projection";
import { CONDITION, PROGRESS_LABEL } from "../city/vocabulary";
import { Glyph } from "./Glyphs";
import type { FramingKey } from "./framings";

/**
 * The city without the city.
 *
 * Shown when WebGL will not start — an old machine, a locked-down browser, a
 * lost context. The world is the product and losing it is a real loss, but the
 * part an operator came for is the reading and the work, and those are words.
 * The whole session runs here: the same ranking, the same activities, the same
 * branching, the same local notes.
 */

type Props = {
  session: Session;
  selected: DistrictId | null;
  onSelect: (key: FramingKey) => void;
  onAnswer: (work: DistrictWork, prompt: Prompt, value: string) => void;
};

export function CityFallback({ session, selected, onSelect, onAnswer }: Props) {
  return (
    <div className="flat" data-testid="city-fallback">
      <div className="flat__inner">
        <p className="flat__note">
          This browser could not start WebGL, so the city is not drawn. Everything it would have
          told you is below.
        </p>

        <div className="flat__round">
          <h1>{session.title}</h1>
          <p>{session.purpose}</p>
        </div>

        <ol className="flat__list">
        {session.work.map((entry) => {
          const { district, activity, run, plan } = entry;
          const reading = readingFor(district);
          const open = selected === district.id;
          const current = run?.current ?? null;

          return (
            <li
              key={district.id}
              className="flat__district"
              data-district={district.id}
              data-state={district.state}
              data-condition={evidenceKind(district)}
              data-progress={entry.complete ? "worked" : "none"}
            >
              <button
                type="button"
                className="flat__head"
                data-district-open={district.id}
                aria-expanded={open}
                onClick={() => onSelect(open ? "city" : district.id)}
              >
                <span className="flat__name">{DISTRICT_NAMES[district.id]}</span>
                <span className="flat__status">
                  <span className="cond" data-tone={CONDITION[evidenceKind(district)].tone}>
                    <Glyph name={CONDITION[evidenceKind(district)].glyph} className="cond__glyph" />
                    {CONDITION[evidenceKind(district)].label}
                  </span>
                  {entry.declined ? (
                    <span className="mark">{PROGRESS_LABEL.declined}</span>
                  ) : entry.complete ? (
                    <span className="mark">{PROGRESS_LABEL.worked}</span>
                  ) : null}
                </span>
              </button>

              {open ? (
                <div className="flat__body">
                  <p className="flat__subtitle">{DISTRICT_SUBTITLES[district.id]}</p>
                  <p>{reading.observed}</p>
                  {reading.ambiguity ? <p>{reading.ambiguity}</p> : null}
                  <p className="flat__limit">{EVIDENCE_LIMIT}</p>

                  {activity && current ? (
                    <div className="city-flat__prompt" data-prompt={current.id}>
                      <p>
                        <strong>{current.title}</strong>
                      </p>
                      <p>{current.why}</p>
                      <div className="answers" role="group" aria-label={current.title}>
                        {current.kind === "check"
                          ? CHECK_ANSWERS.map((value) => (
                              <button key={value} type="button" className="btn answer" data-answer={value}
                                onClick={() => onAnswer(entry, current, value)}>
                                {CHECK_LABEL[value]}
                              </button>
                            ))
                          : null}
                        {current.kind === "commit"
                          ? COMMIT_ANSWERS.map((value) => (
                              <button key={value} type="button" className="btn answer" data-answer={value}
                                onClick={() => onAnswer(entry, current, value)}>
                                {COMMIT_LABEL[value]}
                              </button>
                            ))
                          : null}
                        {current.kind === "choice"
                          ? (current.options ?? []).map((option) => (
                              <button key={option.id} type="button" className="plate"
                                data-answer={option.id} onClick={() => onAnswer(entry, current, option.id)}>
                                <span className="plate__label">{option.label}</span>
                              </button>
                            ))
                          : null}
                      </div>
                    </div>
                  ) : null}

                  {activity && !current ? (
                    <p data-testid="district-done">
                      {entry.declined
                        ? "Decided: deliberately not part of the business."
                        : "Everything here is worked through."}
                    </p>
                  ) : null}

                  {!activity ? <p>City could not read this district, so it has nothing to suggest.</p> : null}

                  {plan.length > 0 ? (
                    <ul className="notes__list">
                      {plan.map((item) => (
                        <li key={item.promptId} className="note" data-kind={item.kind}>
                          <span className="note__rule" aria-hidden="true" />
                          <span className="note__text">{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
        </ol>
      </div>
    </div>
  );
}
