import { MAX_LEVEL, RESOURCE, money } from "../game/buildings";
import type { BuildingView } from "../game/city";
import { ResourceIcon } from "./ResourceBar";

/**
 * One building, and the button.
 *
 * The requirement is the loudest thing on it, because the requirement is the
 * game: *this needs five customers, you have three*. The bar fills as the
 * business grows, and when it is full the button turns green and asks to be
 * pressed. Nothing upgrades itself — pressing it is the point.
 */

type Props = {
  view: BuildingView;
  onUpgrade: () => void;
  onClose: () => void;
};

function plural(n: number, resource: BuildingView["building"]["resource"]) {
  const words = RESOURCE[resource];
  return n === 1 ? words.one : words.many;
}

export function BuildingCard({ view, onUpgrade, onClose }: Props) {
  const { building, level, need, has, short: shortfall, progress, maxed, ready } = view;
  const words = RESOURCE[building.resource];
  const state = maxed ? "maxed" : ready > 0 ? "ready" : "waiting";

  return (
    <aside className="card" data-building={building.id} data-level={level} data-state={state}>
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

      <div className="card__body">
        {maxed ? (
          <div className="req">
            <p className="req__short">
              Built as high as it goes. Level {MAX_LEVEL} of {MAX_LEVEL}.
            </p>
          </div>
        ) : (
          <div className="req">
            <p className="req__line">
              <span className="res__icon" aria-hidden="true">
                <ResourceIcon resource={building.resource} />
              </span>
              <span className="req__count" data-testid="have">
                {money(building.resource, has)}
              </span>
              <span className="req__of" data-testid="need">
                / {money(building.resource, need!)}
              </span>
              <span>{words.name.toLowerCase()}</span>
            </p>

            <span className="req__bar" role="img" aria-label={`${Math.round(progress * 100)}% toward level ${level + 1}`}>
              <span className="req__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>

            <p className="req__short">
              {shortfall > 0 ? (
                <>
                  Level {level + 1} needs <strong>{money(building.resource, need!)}</strong> — {money(building.resource, shortfall)}{" "}
                  {plural(shortfall, building.resource)} to go.
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
          {maxed ? "Fully built" : ready > 0 ? `Upgrade to level ${level + 1}` : `Grow to level ${level + 1}`}
        </button>
      </div>

      <p className="card__foot">
        Real figures from your Whop account. The only way to level this up is to grow the business.
      </p>
    </aside>
  );
}
