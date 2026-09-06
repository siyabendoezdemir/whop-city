import { MAX_LEVEL, RESOURCE, money } from "../game/buildings";
import type { BuildingView } from "../game/city";
import { ResourceIcon, UpMark } from "./Icons";

/**
 * One building, and the button.
 *
 * The requirement is the loudest thing on it, because the requirement is the
 * game: *this needs a thousand in revenue, you have six hundred*. The bar
 * fills as the business grows, and when it is full the button turns green and
 * asks to be pressed. Nothing upgrades itself — pressing it is the point.
 *
 * The row of level pips at the top is the whole ladder at a glance, so a
 * player can see they are three of five into a building without doing
 * arithmetic on two numbers.
 */

type Props = {
  view: BuildingView;
  onUpgrade: () => void;
  onClose: () => void;
};

export function BuildingCard({ view, onUpgrade, onClose }: Props) {
  const { building, level, need, has, short: shortfall, progress, maxed, ready } = view;
  const words = RESOURCE[building.resource];
  const state = maxed ? "maxed" : ready > 0 ? "ready" : "waiting";

  return (
    <aside className="card" data-building={building.id} data-level={level} data-state={state} data-testid="building-card">
      <header className="card__head">
        <span className="card__badge" data-level={level} aria-label={`Level ${level}`}>
          {level}
        </span>
        <span className="card__title">
          <h2 className="card__name">{building.name}</h2>
          <p className="card__role">{building.role}</p>
        </span>
        <button type="button" className="card__close" data-action="close-card" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>

      <span className="card__pips" aria-hidden="true">
        {Array.from({ length: MAX_LEVEL }, (_, index) => (
          <i key={index} data-on={index < level} data-ready={index >= level && index < level + ready} />
        ))}
      </span>

      <div className="card__body">
        {maxed ? (
          <p className="req__short req__short--done">
            Built as high as it goes. Level {MAX_LEVEL} of {MAX_LEVEL}.
          </p>
        ) : (
          <div className="req">
            <p className="req__line">
              <span className="req__icon" aria-hidden="true">
                <ResourceIcon resource={building.resource} />
              </span>
              <span className="req__count" data-testid="have">
                {money(building.resource, has)}
              </span>
              <span className="req__of" data-testid="need">
                / {money(building.resource, need!)}
              </span>
              <span className="req__unit">{words.unit}</span>
            </p>

            <span className="req__bar" role="img" aria-label={`${Math.round(progress * 100)}% toward level ${level + 1}`}>
              <span className="req__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>

            <p className="req__short">
              {shortfall > 0 ? (
                <>
                  <strong>{money(building.resource, shortfall)}</strong> more {words.unit} and level{" "}
                  {level + 1} is yours.
                </>
              ) : (
                <>Level {level + 1} is paid for. Take it.</>
              )}
            </p>
          </div>
        )}

        <button
          type="button"
          className="press"
          data-state={state}
          data-action="upgrade"
          disabled={state !== "ready"}
          onClick={onUpgrade}
        >
          {state === "ready" ? <UpMark className="press__mark" /> : null}
          {maxed ? "Fully built" : ready > 0 ? `Build level ${level + 1}` : `Locked until level ${level + 1}`}
        </button>
      </div>

      <p className="card__foot">
        Real figures from your Whop account. The only way to level this up is to grow the business.
      </p>
    </aside>
  );
}
