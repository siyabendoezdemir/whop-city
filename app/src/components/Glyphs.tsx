/**
 * The city's glyphs.
 *
 * Each one echoes the mark standing in the world for the same condition, so
 * the reading in the command bar and the thing on the skyline are recognisably
 * the same statement. That is the point of drawing them rather than reaching
 * for a generic icon set: a hazard chevron in the panel means the hazard
 * chevron out there.
 */

type Props = { className?: string };

const box = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Hazard chevron on a mast: a district reading wrong. */
export function GlyphAlert({ className }: Props) {
  return (
    <svg {...box} className={className}>
      <path d="M8 2.4 14 12.2H2z" fill="currentColor" fillOpacity="0.18" />
      <path d="M8 6.2v2.6" />
      <path d="M8 10.6h.01" strokeWidth="2" />
    </svg>
  );
}

/** Survey stakes and a string line: ground nothing has been built on. */
export function GlyphPlot({ className }: Props) {
  return (
    <svg {...box} className={className}>
      <path d="M3 5.6V3h2.6M10.4 3H13v2.6M13 10.4V13h-2.6M5.6 13H3v-2.6" />
      <path d="M3 8h10" strokeDasharray="2 2.2" strokeOpacity="0.7" />
    </svg>
  );
}

/** Scaffold ring: work put up recently. */
export function GlyphScaffold({ className }: Props) {
  return (
    <svg {...box} className={className}>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M2.6 8h10.8M8 2.6v10.8" strokeOpacity="0.6" />
    </svg>
  );
}

/** A steady lamp: nothing asking for attention. */
export function GlyphSteady({ className }: Props) {
  return (
    <svg {...box} className={className}>
      <circle cx="8" cy="8" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="5.6" strokeOpacity="0.45" />
    </svg>
  );
}

/** A blank plate: City could not read this at all. */
export function GlyphUnknown({ className }: Props) {
  return (
    <svg {...box} className={className}>
      <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1" strokeDasharray="2.4 2" />
      <path d="M6.4 6.3a1.7 1.7 0 1 1 1.9 2v1" />
      <path d="M8.3 11.6h.01" strokeWidth="2" />
    </svg>
  );
}

const BY_NAME = {
  alert: GlyphAlert,
  plot: GlyphPlot,
  scaffold: GlyphScaffold,
  steady: GlyphSteady,
  unknown: GlyphUnknown,
} as const;

export type GlyphName = keyof typeof BY_NAME;

export function Glyph({ name, className }: { name: GlyphName; className?: string }) {
  const Drawn = BY_NAME[name];
  return <Drawn className={className} />;
}

/** The city seal. A promontory under a low sun — the world, abstracted. */
export function Seal({ className }: Props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.5" />
      <path d="M3.6 13.4h12.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M5.4 13.4V9.2h2.3v4.2M8.9 13.4V6.4h2.5v7M12.6 13.4v-3h2v3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="13.9" cy="5.4" r="1.5" fill="currentColor" />
    </svg>
  );
}
