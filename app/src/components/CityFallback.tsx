import {
  ATTENTION_LABEL,
  attentionQueue,
  DIRECTION_NOTE,
  SIGNAL_NOTE,
} from "../city/attention";
import { DISTRICT_NAMES, DISTRICT_SUBTITLES } from "../city/explain";
import { briefingForOrUnreadable } from "../city/playbook";
import type { DistrictId, PublicCityProjection } from "../city/projection";
import { districtProgress, isReviewed, type ReviewLog } from "../state/operatorLog";
import type { FramingKey } from "./framings";

/**
 * The city without the city.
 *
 * Shown when WebGL will not start — an old machine, a locked-down browser, a
 * lost context. The world is the product, so this is a real loss, but the part
 * an operator came for is the reading and the moves, and those are text. The
 * whole briefing works here: the same queue, the same states, the same review
 * marks, the same local-only persistence.
 *
 * It is not a stub and it is not an apology page. It says plainly that the
 * world could not be drawn, then gets on with it.
 */

type Props = {
  projection: PublicCityProjection;
  log: ReviewLog;
  selected: DistrictId | null;
  onSelect: (key: FramingKey) => void;
  onToggleMove: (moveId: string, districtId: DistrictId) => void;
};

export function CityFallback({ projection, log, selected, onSelect, onToggleMove }: Props) {
  const queue = attentionQueue(projection.districts);

  return (
    <div className="city-flat" data-testid="city-fallback">
      <p className="city-flat__note">
        This browser could not start WebGL, so the city is not drawn. Everything it would have told
        you is below.
      </p>

      <ol className="city-flat__districts">
        {queue.map(({ district, level }) => {
          const briefing = briefingForOrUnreadable(district);
          const progress = districtProgress(log, briefing.moves.map((move) => move.id));
          const open = selected === district.id;

          return (
            <li key={district.id} className="city-flat__district" data-district={district.id}
              data-state={district.state} data-level={level}>
              <button
                type="button"
                className="city-flat__head"
                data-district-open={district.id}
                aria-expanded={open}
                onClick={() => onSelect(open ? "city" : district.id)}
              >
                <span className="city-flat__name">{DISTRICT_NAMES[district.id]}</span>
                <span className="city-flat__status">
                  {progress.complete ? "Reviewed" : ATTENTION_LABEL[level]}
                </span>
              </button>

              {open ? (
                <div className="city-flat__body">
                  <p className="city-flat__subtitle">{DISTRICT_SUBTITLES[district.id]}</p>
                  <p className="city-flat__reading">{briefing.reading}</p>
                  <p className="city-flat__signal">
                    {SIGNAL_NOTE[district.signal]} · {DIRECTION_NOTE[district.direction]}
                  </p>
                  <p className="city-flat__stake">{briefing.stake}</p>

                  <ol className="city-flat__moves">
                    {briefing.moves.map((move) => (
                      <li key={move.id}>
                        <button
                          type="button"
                          className="city-move__mark"
                          data-move={move.id}
                          aria-pressed={isReviewed(log, move.id)}
                          onClick={() => onToggleMove(move.id, district.id)}
                        >
                          <span className="city-move__tick" aria-hidden="true">
                            {isReviewed(log, move.id) ? "✓" : ""}
                          </span>
                          <span className="city-move__text">
                            <span className="city-move__title">{move.title}</span>
                            <span className="city-move__detail">{move.detail}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
