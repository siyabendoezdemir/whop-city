import { useState } from "react";

import type { CityMetrics } from "../city/projection";
import { RESOURCE } from "../game/buildings";
import { BOTTLENECK, STAGE, bottleneckOf, currentMission, stageOf } from "../game/missions";

/**
 * The Advisor.
 *
 * One thing to do, and how to do it. Not a board of twelve — a backlog is the
 * opposite of guidance. It reads the real figures, names what is actually in
 * the way, and finishes itself when the number moves.
 */

export function Advisor({ metrics, open, onToggle }: { metrics: CityMetrics; open: boolean; onToggle: () => void }) {
  const [showHow, setShowHow] = useState(true);
  const mission = currentMission(metrics);
  const stage = stageOf(metrics);
  const bottleneck = bottleneckOf(metrics);
  if (!mission) return null;

  const progress = Math.round(mission.progress(metrics) * 100);

  if (!open) {
    return (
      <button type="button" className="advisor__tab" data-action="open-advisor" onClick={onToggle}>
        <span className="advisor__mark" aria-hidden="true">
          !
        </span>
        <span className="advisor__tabText">
          <span className="advisor__tabTitle">{mission.title}</span>
          <span className="advisor__tabStage">{BOTTLENECK[bottleneck].name}</span>
        </span>
      </button>
    );
  }

  return (
    <aside className="advisor" data-mission={mission.id} data-bottleneck={bottleneck} aria-label="Advisor">
      <header className="advisor__head">
        <span className="advisor__mark" aria-hidden="true">
          !
        </span>
        <span className="advisor__who">
          <span className="advisor__name">Advisor</span>
          <span className="advisor__stage" data-testid="stage">
            {STAGE[stage].name}
          </span>
        </span>
        <button type="button" className="card__close" data-action="close-advisor" aria-label="Close" onClick={onToggle}>
          ✕
        </button>
      </header>

      <div className="advisor__body">
        <p className="advisor__reads" data-testid="bottleneck">
          {BOTTLENECK[bottleneck].reads}
        </p>

        <h2 className="advisor__title" data-testid="mission">
          {mission.title}
        </h2>
        <p className="advisor__why">{mission.why}</p>

        {mission.standing ? (
          <p className="advisor__measure">
            This one has no finish line. It is how a business this size keeps growing.
          </p>
        ) : (
          <>
            <div className="advisor__track">
              <span className="req__bar">
                <span className="req__fill" style={{ width: `${progress}%` }} />
              </span>
              <span className="advisor__pct" data-local="true">
                {progress}%
              </span>
            </div>
            <p className="advisor__measure">
              Done when your {RESOURCE[mission.resource].name.toLowerCase()} moves. Nothing to tick off.
            </p>
          </>
        )}

        <button
          type="button"
          className="advisor__howBtn"
          data-action="toggle-how"
          aria-expanded={showHow}
          onClick={() => setShowHow((was) => !was)}
        >
          {showHow ? "Hide the how" : "How do I do that?"}
        </button>

        {showHow ? (
          <ol className="advisor__how">
            {mission.how.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}
      </div>
    </aside>
  );
}
