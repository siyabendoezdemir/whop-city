import { CHECK_ANSWERS, CHECK_LABEL, COMMIT_ANSWERS, COMMIT_LABEL, type Prompt } from "../city/activities";
import { EVIDENCE_LIMIT, readingFor } from "../city/evidence";
import { DISTRICT_NAMES, DISTRICT_SUBTITLES } from "../city/explain";
import type { DistrictWork, Session } from "../city/session";
import type { DistrictId } from "../city/projection";
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
    <div className="city-flat" data-testid="city-fallback">
      <p className="city-flat__note">
        This browser could not start WebGL, so the city is not drawn. Everything it would have told
        you is below.
      </p>

      <div className="city-flat__session">
        <h1>{session.title}</h1>
        <p>{session.purpose}</p>
      </div>

      <ol className="city-flat__districts">
        {session.work.map((entry) => {
          const { district, activity, run, plan } = entry;
          const reading = readingFor(district);
          const open = selected === district.id;
          const current = run?.current ?? null;

          return (
            <li
              key={district.id}
              className="city-flat__district"
              data-district={district.id}
              data-state={district.state}
              data-progress={entry.complete ? "worked" : "none"}
            >
              <button
                type="button"
                className="city-flat__head"
                data-district-open={district.id}
                aria-expanded={open}
                onClick={() => onSelect(open ? "city" : district.id)}
              >
                <span className="city-flat__name">{DISTRICT_NAMES[district.id]}</span>
                <span className="city-flat__status">
                  {entry.declined
                    ? "You decided against"
                    : entry.complete
                      ? "You worked here"
                      : activity
                        ? "Open"
                        : "Unreadable"}
                </span>
              </button>

              {open ? (
                <div className="city-flat__body">
                  <p className="city-flat__subtitle">{DISTRICT_SUBTITLES[district.id]}</p>
                  <p>
                    <strong>From Whop:</strong> {reading.observed}
                  </p>
                  {reading.ambiguity ? <p>{reading.ambiguity}</p> : null}
                  <p className="city-flat__limit">{EVIDENCE_LIMIT}</p>

                  {activity && current ? (
                    <div className="city-flat__prompt" data-prompt={current.id}>
                      <p>
                        <strong>{current.title}</strong>
                      </p>
                      <p>{current.why}</p>
                      <div className="prompt__answers" role="group" aria-label={current.title}>
                        {current.kind === "check"
                          ? CHECK_ANSWERS.map((value) => (
                              <button key={value} type="button" className="answer" data-answer={value}
                                onClick={() => onAnswer(entry, current, value)}>
                                {CHECK_LABEL[value]}
                              </button>
                            ))
                          : null}
                        {current.kind === "commit"
                          ? COMMIT_ANSWERS.map((value) => (
                              <button key={value} type="button" className="answer" data-answer={value}
                                onClick={() => onAnswer(entry, current, value)}>
                                {COMMIT_LABEL[value]}
                              </button>
                            ))
                          : null}
                        {current.kind === "choice"
                          ? (current.options ?? []).map((option) => (
                              <button key={option.id} type="button" className="answer answer--wide"
                                data-answer={option.id} onClick={() => onAnswer(entry, current, option.id)}>
                                {option.label}
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
                    <>
                      <p>
                        <strong>You told City:</strong>
                      </p>
                      <ul className="planlist">
                        {plan.map((item) => (
                          <li key={item.promptId} className="planlist__item" data-kind={item.kind}>
                            <span className="planlist__mark" aria-hidden="true" />
                            <span className="planlist__text">{item.text}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
