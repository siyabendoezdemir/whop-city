import { useState } from "react";

import type { CityMetrics } from "../city/projection";
import { DISTRICT_NAMES } from "../city/explain";
import { RESOURCE, money } from "../game/buildings";
import type { Quest } from "../game/quests";
import { Chevron, DistrictIcon } from "./Icons";

/**
 * One thing to do next.
 *
 * The version before this put a title, a paragraph of reasoning, a percentage,
 * a caveat and three numbered steps on screen at once, in every district, all
 * the time. The report on it was "information overload with a lot of text
 * everywhere", and that is exactly right: Clash of Clans never shows you a
 * paragraph. It shows a picture, a bar with two real numbers on it, and one
 * button.
 *
 * So the resting card is four things — where, what, how far, and a button —
 * and everything else is behind the button. The bar carries the actual figures
 * rather than a percentage, because "48%" is not a fact anybody can act on and
 * "$48k of $100k" is.
 */

type Props = {
  quest: Quest;
  metrics: CityMetrics;
  /** Shown when the card stands in for the whole city rather than one district. */
  scope: "city" | "district";
  onGo?: () => void;
};

export function QuestCard({ quest, metrics, scope, onGo }: Props) {
  const [open, setOpen] = useState(false);
  const progress = Math.max(0, Math.min(1, quest.progress(metrics)));
  const words = RESOURCE[quest.resource];
  const rate = quest.rate?.(metrics) ?? null;
  const have = metrics[quest.resource];
  const target = quest.target?.(metrics) ?? null;

  return (
    <aside
      className="quest"
      data-quest={quest.id}
      data-district={quest.district}
      data-urgent={quest.urgent ? "true" : "false"}
      data-open={open}
      data-testid="quest"
    >
      <header className="quest__head">
        <span className="quest__mark" aria-hidden="true">
          <DistrictIcon district={quest.district} />
        </span>
        <span className="quest__where">
          {scope === "city" ? "Do this next" : DISTRICT_NAMES[quest.district]}
        </span>
        {quest.urgent ? <span className="quest__flag">Fix first</span> : null}
      </header>

      <h2 className="quest__title">{quest.title}</h2>

      {quest.standing ? (
        <p className="quest__standing">An ongoing practice. Nothing here ticks itself off.</p>
      ) : (
        <div className="quest__meter">
          <span className="quest__bar" role="img" aria-label={`${Math.round(progress * 100)} percent of the way there`}>
            <span className="quest__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
          <span className="quest__count" data-testid="quest-count">
            <strong>{rate ? rate.now : money(quest.resource, have)}</strong>
            {rate ? ` / ${rate.goal}` : target !== null ? ` / ${money(quest.resource, target)}` : null}
            <em>{rate ? rate.label : words.name}</em>
          </span>
        </div>
      )}

      <button
        type="button"
        className="press press--wide"
        aria-expanded={open}
        data-action="quest-how"
        onClick={() => setOpen((was) => !was)}
      >
        {open ? "Close" : "How do I do this?"}
        <Chevron className={open ? "is-open" : ""} />
      </button>

      {open ? (
        <div className="quest__more">
          <p className="quest__why">{quest.why}</p>
          <ol className="quest__how">
            {quest.how.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {onGo ? (
            <button type="button" className="press press--ghost" data-action="quest-go" onClick={onGo}>
              Take me to {DISTRICT_NAMES[quest.district]}
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
