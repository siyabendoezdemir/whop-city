import { useEffect, useState } from "react";

import { ago, amount, detail, headline, type Dispatch, type Sale } from "../game/live";
import { CoinMark, MemberMark, TrafficMark, UpMark } from "./Icons";

/**
 * What just happened.
 *
 * Two surfaces over one list. A sale that lands while the city is open throws
 * a card that slides in, sits for a few seconds and goes — the thing you look
 * up for. Behind that, a roll of the last day, for the thing you scroll when
 * you come back after lunch and want to know what you missed.
 *
 * Every line is an event that happened in the account. There is no encouraging
 * filler, nothing fires on a timer, and a quiet hour looks quiet, because a
 * feed that always has something on it is a feed nobody believes.
 */

function markFor(entry: Dispatch) {
  switch (entry.kind) {
    case "sale":
      return <CoinMark />;
    case "member":
      return <MemberMark />;
    case "visitors":
      return <TrafficMark />;
    case "level":
      return <UpMark />;
  }
}

/** How long a sale card stays up before it retires to the roll. */
const TOAST_MS = 7_000;

export function SaleToasts({
  sales,
  onDone,
}: {
  sales: readonly Sale[];
  onDone: (key: string) => void;
}) {
  useEffect(() => {
    if (sales.length === 0) return;
    const timers = sales.map((sale) => window.setTimeout(() => onDone(sale.key), TOAST_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [sales, onDone]);

  if (sales.length === 0) return null;

  return (
    <div className="pops" role="status" aria-live="polite" data-testid="sale-pops">
      {sales.map((sale) => (
        <button
          key={sale.key}
          type="button"
          className="pop"
          data-kind={sale.kind}
          onClick={() => onDone(sale.key)}
        >
          <span className="pop__mark" aria-hidden="true">
            <CoinMark />
          </span>
          <span className="pop__body">
            <span className="pop__figure">+{amount(sale.cents)}</span>
            <span className="pop__what">
              {sale.kind === "renewal" ? "Renewed" : "New sale"}
              {sale.product ? ` · ${sale.product}` : ""}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function Feed({
  entries,
  connected,
  now,
}: {
  entries: readonly Dispatch[];
  connected: boolean;
  now: number;
}) {
  const [open, setOpen] = useState(false);

  // Everything that landed in the last few minutes, for the count on the tab.
  const recent = entries.filter((entry) => now - entry.at < 60 * 60 * 1000).length;

  return (
    <div className="feed" data-open={open || undefined}>
      <button
        type="button"
        className="feed__tab"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        data-testid="feed-toggle"
      >
        <span className="feed__dot" data-live={connected || undefined} aria-hidden="true" />
        <span className="feed__label">Activity</span>
        {recent > 0 ? <span className="feed__count">{recent}</span> : null}
      </button>

      {open ? (
        <div className="feed__roll" data-testid="feed-roll">
          {entries.length === 0 ? (
            <p className="feed__quiet">
              {connected
                ? "Nothing has happened in the last day. The city is watching."
                : "Sign in with Whop to watch your business live."}
            </p>
          ) : (
            <ul className="feed__list">
              {entries.map((entry) => {
                const under = detail(entry);
                return (
                  <li key={entry.id} className="feed__row" data-kind={entry.kind}>
                    <span className="feed__mark" aria-hidden="true">
                      {markFor(entry)}
                    </span>
                    <span className="feed__text">
                      <span className="feed__head">{headline(entry)}</span>
                      {under ? <span className="feed__sub">{under}</span> : null}
                    </span>
                    <span className="feed__when">{ago(entry.at, now)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
