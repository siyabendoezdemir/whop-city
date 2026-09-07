import { RESOURCE, money, type Resource } from "../game/buildings";
import type { Change } from "../game/city";
import { ResourceIcon } from "./Icons";

/**
 * What the business did while nobody was looking.
 *
 * The reason to come back. A city-builder that looks identical every time you
 * open it is a screensaver; this is the line that says the last three days
 * added something, and it is read entirely from Whop's own figures rather than
 * from anything that ticked over in the browser.
 *
 * Only movements are listed, and a fall is shown as plainly as a rise. A panel
 * that only ever reported good news would be worth nothing the first time
 * something went wrong.
 */

const NAMEABLE: Resource[] = ["gold", "citizens", "traffic", "recurring"];

type Props = { changes: readonly Change[]; onDismiss: () => void };

export function WhileAway({ changes, onDismiss }: Props) {
  const shown = changes
    .filter((change): change is Change & { resource: Resource } =>
      NAMEABLE.includes(change.resource as Resource),
    )
    .slice(0, 4);
  if (shown.length === 0) return null;

  return (
    <aside className="away" data-testid="while-away">
      <p className="away__head">Since you were last here</p>
      <ul className="away__list">
        {shown.map((change) => {
          const up = change.to > change.from;
          return (
            <li key={change.resource} data-move={up ? "up" : "down"}>
              <span className="away__icon" aria-hidden="true">
                <ResourceIcon resource={change.resource} />
              </span>
              <span className="away__name">{RESOURCE[change.resource].name}</span>
              <span className="away__delta">
                {up ? "+" : "−"}
                {money(change.resource, Math.abs(change.to - change.from))}
              </span>
              <span className="away__now">{money(change.resource, change.to)}</span>
            </li>
          );
        })}
      </ul>
      <button type="button" className="press press--ghost" data-action="dismiss-away" onClick={onDismiss}>
        Got it
      </button>
    </aside>
  );
}
