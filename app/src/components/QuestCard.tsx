import { useState } from "react";

import type { CityMetrics } from "../city/projection";
import { DISTRICT_NAMES } from "../city/explain";
import { RESOURCE } from "../game/buildings";
import type { Quest } from "../game/quests";
import { Chevron, DistrictIcon, ResourceIcon } from "./Icons";

/**
 * One quest, and how to do it.
 *
 * The interesting design constraint here is that this cannot be a checklist.
 * Nothing on this card can be ticked, because the only thing that finishes a
 * quest is the business's own number moving — so the steps are worded as
 * things to go and do, and the bar underneath is read from Whop rather than
 * from anything the player told us.
 *
 * The "how" is collapsed by default on a quest the player has seen before and
 * open on a fresh one, because the first question is always "what" and the
 * second is "yes but how".
 */

type Props = {
  quest: Quest;
  metrics: CityMetrics;
  /** Shown when the card is standing in for the whole city rather than one district. */
  scope: "city" | "district";
  onGo?: () => void;
};

export function QuestCard({ quest, metrics, scope, onGo }: Props) {
  const [showHow, setShowHow] = useState(true);
  const progress = Math.max(0, Math.min(1, quest.progress(metrics)));
  const percent = Math.round(progress * 100);
  const words = RESOURCE[quest.resource];

  return (
    <aside
      className="quest"
      data-quest={quest.id}
      data-district={quest.district}
      data-urgent={quest.urgent ? "true" : "false"}
      data-testid="quest"
    >
      <header className="quest__head">
        <span className="quest__mark" aria-hidden="true">
          <DistrictIcon district={quest.district} />
        </span>
        <span className="quest__where">
          {scope === "city" ? "Do this next" : DISTRICT_NAMES[quest.district]}
        </span>
        {quest.urgent ? <span className="quest__flag">Needs attention</span> : null}
      </header>

      <h2 className="quest__title">{quest.title}</h2>
      <p className="quest__why">{quest.why}</p>

      {quest.standing ? (
        <p className="quest__standing">
          A practice, not a finish line. Nothing here ticks itself off.
        </p>
      ) : (
        <div className="quest__meter">
          <span className="quest__bar" role="img" aria-label={`${percent} percent of the way there`}>
            <span className="quest__fill" style={{ width: `${percent}%` }} />
          </span>
          <span className="quest__pct">
            <span className="quest__res" aria-hidden="true">
              <ResourceIcon resource={quest.resource} />
            </span>
            {percent}%
          </span>
        </div>
      )}

      {!quest.standing ? (
        <p className="quest__done">Done when your {words.name.toLowerCase()} moves. Nothing to tick off.</p>
      ) : null}

      <button
        type="button"
        className="quest__toggle"
        aria-expanded={showHow}
        onClick={() => setShowHow((was) => !was)}
      >
        <Chevron className={showHow ? "is-open" : ""} />
        {showHow ? "Hide how" : "Show me how"}
      </button>

      {showHow ? (
        <ol className="quest__how">
          {quest.how.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}

      {onGo ? (
        <button type="button" className="press press--ghost" data-action="quest-go" onClick={onGo}>
          Show me the district
        </button>
      ) : null}
    </aside>
  );
}
