import { useEffect, useRef, useState } from "react";

import { Chevron } from "./Icons";
import { Seal } from "./Glyphs";

/**
 * Who you are, and which Whop this city is.
 *
 * The corner used to hold a link that said "Sign out", which answered a
 * question nobody had while leaving the one that matters — *whose business am
 * I looking at?* — unanswered. Somebody who runs three Whops could not tell
 * which of them the city was built from.
 *
 * So it is a profile now: your name, the business being read, and a menu
 * listing every Whop Whop itself says you run. The ones this deployment can
 * actually read are selectable. The ones it cannot say so plainly rather than
 * offering a switch that would quietly show a city full of noughts — a hosted
 * Website's credential is scoped to the account it was deployed under, and
 * pretending otherwise would be the exact fake-capability trap the rest of
 * this codebase is built to avoid.
 */

export type Profile = {
  signedIn: boolean;
  name?: string;
  business?: { id: string; name: string; route: string | null };
  shops?: Array<{ id: string; name: string; readable: boolean }>;
  bound?: boolean;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ProfileChip({ profile }: { profile: Profile | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!profile?.signedIn) {
    return (
      <a className="chip chip--in" href="/api/auth/start" data-action="signin">
        <Seal className="chip__seal" />
        Sign in with Whop
      </a>
    );
  }

  const who = profile.name ?? "Your account";
  const business = profile.business?.name ?? "Your Whop";
  const others = profile.shops ?? [];

  return (
    <div className="chip__root" ref={root}>
      <button
        type="button"
        className="chip"
        data-action="profile"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((was) => !was)}
      >
        <span className="chip__avatar" aria-hidden="true">
          {initials(who)}
        </span>
        <span className="chip__text">
          <span className="chip__who">{who}</span>
          <span className="chip__where" data-testid="profile-business">
            {business}
          </span>
        </span>
        <Chevron className="chip__chev" />
      </button>

      {open ? (
        <div className="menu" role="menu" data-testid="profile-menu">
          <p className="menu__head">Reading</p>
          <p className="menu__now">
            {business}
            {profile.business?.route ? <span className="menu__route">whop.com/{profile.business.route}</span> : null}
          </p>

          {others.length > 1 ? (
            <>
              <p className="menu__head">Your Whops</p>
              <ul className="menu__list">
                {others.map((shop) => {
                  const current = shop.id === profile.business?.id;
                  return (
                    <li key={shop.id}>
                      {shop.readable ? (
                        <a
                          className="menu__item"
                          data-current={current}
                          href={`/api/auth/view?business=${encodeURIComponent(shop.id)}`}
                        >
                          <span>{shop.name}</span>
                          {current ? <span className="menu__tick">✓</span> : null}
                        </a>
                      ) : (
                        <span className="menu__item is-locked" title="This deployment cannot read that business">
                          <span>{shop.name}</span>
                          <span className="menu__locked">not this deployment</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="menu__note">
                A Whop Website reads the business it was published from. To play a different one, publish
                Whop City from that Whop as well.
              </p>
            </>
          ) : null}

          <a className="menu__out" href="/api/auth/logout" data-action="signout">
            Sign out
          </a>
        </div>
      ) : null}
    </div>
  );
}
