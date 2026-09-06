import { useCallback, useEffect, useRef, useState } from "react";

import type { CityMetrics } from "../city/projection";
import {
  freshSales,
  mergeFeed,
  movements,
  parseLive,
  type Dispatch,
  type Sale,
} from "../game/live";

/**
 * Keeping up with a business that is trading right now.
 *
 * The snapshot is a minute-scale document — parcels, districts, freshness —
 * and polling it hard would be twenty-seven upstream reads a go. `/api/city/live`
 * is the small one: four figures and the sales behind them. This hook polls
 * that, works out what is new since the last reply, and hands back both the
 * current figures and a feed of what happened.
 *
 * Three things it is careful about.
 *
 * **It stops when nobody is looking.** A backgrounded tab polls nothing. A tab
 * brought back to the front reads immediately rather than waiting out the
 * interval, because the first thing you want on returning is the current
 * number, not the one from before lunch.
 *
 * **The first reply is not news.** Everything already in the account when the
 * page opened is history; announcing a morning's sales as they arrive would be
 * a lie about when they happened. The opening read seeds the seen-set and
 * publishes nothing.
 *
 * **A failed poll changes nothing.** The last good figures stay on screen and
 * the feed is left alone. Blanking the city because one request timed out is
 * worse than showing figures that are fifteen seconds old.
 */

const ENDPOINT = "/api/city/live";
/** Fast enough that a sale lands while you are still looking at the city. */
export const LIVE_POLL_MS = 15_000;

export type Live = {
  /** The freshest figures, or null if none have arrived. */
  readonly metrics: CityMetrics | null;
  /** Newest first. */
  readonly feed: readonly Dispatch[];
  /** Sales that arrived on the most recent poll, oldest first. */
  readonly arrivals: readonly Sale[];
  /** True once a live read has succeeded. */
  readonly connected: boolean;
  /** Server time of the last good read. */
  readonly at: number | null;
  /** Adds a line the client knows about — a building the player just put up. */
  readonly announce: (entry: Dispatch) => void;
  readonly dismiss: (id: string) => void;
};

function endpointUrl(): string {
  if (typeof location === "undefined") return ENDPOINT;
  const scenario = new URLSearchParams(location.search).get("scenario");
  return scenario ? `${ENDPOINT}?scenario=${encodeURIComponent(scenario)}` : ENDPOINT;
}

export function useLive(enabled: boolean): Live {
  const [metrics, setMetrics] = useState<CityMetrics | null>(null);
  const [feed, setFeed] = useState<readonly Dispatch[]>([]);
  const [arrivals, setArrivals] = useState<readonly Sale[]>([]);
  const [connected, setConnected] = useState(false);
  const [at, setAt] = useState<number | null>(null);

  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const previous = useRef<CityMetrics | null>(null);

  const announce = useCallback((entry: Dispatch) => {
    setFeed((current) => mergeFeed(current, [entry], Date.now()));
  }, []);

  const dismiss = useCallback((id: string) => {
    setArrivals((current) => current.filter((sale) => sale.key !== id));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer = 0;

    const poll = async () => {
      try {
        const response = await fetch(endpointUrl(), { headers: { accept: "application/json" } });
        if (!response.ok) return;
        const body = parseLive(await response.json());
        if (!alive || !body.live) return;

        const now = body.at ?? Date.now();
        setConnected(true);
        setAt(now);

        const lines: Dispatch[] = [];
        if (body.sales) {
          const fresh = freshSales(body.sales, seen.current);
          for (const sale of fresh) seen.current.add(sale.key);
          if (primed.current && fresh.length > 0) {
            setArrivals((current) => [...current, ...fresh].slice(-4));
            for (const sale of fresh) {
              lines.push({ id: `sale-${sale.key}`, at: sale.at, kind: "sale", sale });
            }
          } else if (!primed.current) {
            // Seed the feed with what is already there, silently: it belongs on
            // the list but it is not something that just happened.
            for (const sale of body.sales) {
              lines.push({ id: `sale-${sale.key}`, at: sale.at, kind: "sale", sale });
            }
          }
        }

        if (body.metrics) {
          if (primed.current) lines.push(...movements(previous.current, body.metrics, now));
          previous.current = body.metrics;
          setMetrics(body.metrics);
        }

        if (lines.length > 0) setFeed((current) => mergeFeed(current, lines, now));
        primed.current = true;
      } catch {
        // A dropped poll is not an event. Leave everything exactly as it is.
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      timer = window.setTimeout(async () => {
        await poll();
        schedule();
      }, LIVE_POLL_MS);
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        window.clearTimeout(timer);
        return;
      }
      void poll();
      schedule();
    };

    void poll();
    schedule();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  return { metrics, feed, arrivals, connected, at, announce, dismiss };
}
