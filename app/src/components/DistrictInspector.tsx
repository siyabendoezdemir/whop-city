import { DIRECTION_LABEL, paletteFor } from "../city/palette";
import type { CityProjection, DistrictProjection } from "../server/projection";

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="10.5" width="16" height="10" rx="2.6" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8 10.5V7.8a4 4 0 1 1 8 0v2.7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Operator Mode boundary.
 *
 * These affordances are deliberately inert. They exist so the shape of the
 * operator surface is visible in the product now, and so the seam is designed
 * rather than bolted on later — but every control is genuinely disabled and
 * labelled as such. Nothing here sets local state, fakes a result, or implies
 * the action would work if clicked. The auth slice that unlocks them is not
 * built; see docs/website-auth-spike.md.
 */
function OperatorMode({ districtName }: { districtName: string }) {
  const actions = [
    `Adjust ${districtName} focus`,
    "Draft a new offer",
    "Open the district ledger",
  ];

  return (
    <section className="operator" aria-labelledby="operator-heading" data-testid="operator-mode">
      <div className="operator-head" id="operator-heading">
        <LockIcon />
        Operator Mode
      </div>
      <p className="operator-note">
        Read-only. Operator actions need a verified Whop team member, and that sign-in
        is not built yet — these controls are disabled, not pending.
      </p>
      <div className="operator-actions">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            className="locked-action"
            disabled
            aria-disabled="true"
            data-testid="operator-locked-action"
            title="Operator Mode is not available yet"
          >
            <LockIcon />
            {action}
            <span className="locked-badge">Locked</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function TierTrack({ tier, hue }: { tier: number; hue: string }) {
  return (
    <div className="tier-track" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((step) => (
        <span key={step} className="tier-pip" style={{ background: step <= tier ? hue : undefined }} />
      ))}
    </div>
  );
}

export type DistrictInspectorProps = {
  district: DistrictProjection;
  freshness: CityProjection["freshness"];
  capturedAt: number;
  onClose: () => void;
};

export function DistrictInspector({ district, freshness, capturedAt, onClose }: DistrictInspectorProps) {
  const palette = paletteFor(district.id, district.tier);
  const captured = new Date(capturedAt);

  return (
    <aside className="panel panel-inspector" aria-label={`${district.name} details`} data-testid="district-inspector">
      <header>
        <h2 className="panel-title" data-testid="inspector-title">
          {district.name}
        </h2>
        <p className="panel-tagline">{district.tagline}</p>
      </header>

      <div className="metric-grid">
        <div className="metric">
          <div className="metric-label">Tier</div>
          <div className="metric-value" data-testid="inspector-tier">
            {district.tier} <span style={{ color: "var(--ink-25)", fontWeight: 500 }}>/ 5</span>
          </div>
          <TierTrack tier={district.tier} hue={palette.hue} />
        </div>

        <div className="metric">
          <div className="metric-label">Health</div>
          <div className="metric-value">{Math.round(district.health * 100)}%</div>
          <div className="health-track">
            <div
              className="health-fill"
              style={{ width: `${Math.max(3, district.health * 100)}%`, background: palette.hue }}
            />
          </div>
        </div>

        <div className="metric">
          <div className="metric-label">Direction</div>
          <div className="metric-value">{DIRECTION_LABEL[district.direction]}</div>
        </div>

        <div className="metric">
          <div className="metric-label">Signal</div>
          <div className="metric-value">{district.signal}</div>
        </div>
      </div>

      <p className="operator-note" style={{ marginTop: 14, marginBottom: 0 }}>
        {freshness === "live"
          ? `Read from the business at ${captured.toLocaleTimeString()}. This view is a privacy-safe projection — no revenue, customer records, product names, or pricing cross to the browser.`
          : "The business could not be read, so the city is rendered dormant rather than estimated."}
      </p>

      <OperatorMode districtName={district.name} />

      <button
        type="button"
        className="dock-btn"
        style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
        onClick={onClose}
        data-testid="inspector-close"
      >
        Back to overview
      </button>
    </aside>
  );
}
