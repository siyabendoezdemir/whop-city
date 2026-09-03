import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DISTRICT_PALETTE, SKY, paletteFor } from "../city/palette";
import { boxFaces, buildWorld, footprint, iso, polygon, type DistrictLayout } from "../city/world";
import type { CityProjection, DistrictId } from "../server/projection";

type Camera = { cx: number; cy: number; zoom: number };

const MIN_ZOOM = 0.28;
const MAX_ZOOM = 2.4;
/** Well above the overview fit, so selecting a district reads as a move. */
const FOCUS_ZOOM = 1.55;
/** Leaves breathing room around the world in the overview. */
const FIT_MARGIN = 0.95;

/** Assumed aspect for the first server render; corrected on mount. */
const SSR_SIZE = { width: 1440, height: 780 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fitCamera(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  size: { width: number; height: number },
): Camera {
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const zoom = clamp(Math.min(size.width / worldW, size.height / worldH) * FIT_MARGIN, MIN_ZOOM, MAX_ZOOM);
  return { cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2, zoom };
}

export type CityWorldProps = {
  projection: CityProjection;
  selected: DistrictId | null;
  onSelect: (id: DistrictId | null) => void;
  focusToken: number;
};

export function CityWorld({ projection, selected, onSelect, focusToken }: CityWorldProps) {
  const world = useMemo(() => buildWorld(projection), [projection]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(SSR_SIZE);
  const [camera, setCamera] = useState<Camera>(() => fitCamera(world.bounds, SSR_SIZE));
  const [hovered, setHovered] = useState<DistrictId | null>(null);
  const [dragging, setDragging] = useState(false);

  const target = useRef<Camera | null>(null);
  const frame = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const moved = useRef(false);

  // Measure the stage and refit once, after hydration.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0) return;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || size === SSR_SIZE) return;
    fitted.current = true;
    setCamera(fitCamera(world.bounds, size));
  }, [size, world.bounds]);

  /** Eases the camera toward a target so focus changes feel physical. */
  const animateTo = useCallback((next: Camera) => {
    target.current = next;
    if (frame.current !== null) return;
    const step = () => {
      setCamera((current) => {
        const goal = target.current;
        if (!goal) return current;
        const cx = current.cx + (goal.cx - current.cx) * 0.16;
        const cy = current.cy + (goal.cy - current.cy) * 0.16;
        const zoom = current.zoom + (goal.zoom - current.zoom) * 0.16;
        const settled =
          Math.abs(goal.cx - cx) < 0.4 && Math.abs(goal.cy - cy) < 0.4 && Math.abs(goal.zoom - zoom) < 0.002;
        if (settled) {
          target.current = null;
          frame.current = null;
          return goal;
        }
        frame.current = requestAnimationFrame(step);
        return { cx, cy, zoom };
      });
    };
    frame.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  // Focus the selected district whenever selection changes or focus is re-asked.
  useEffect(() => {
    if (!selected) return;
    const district = world.districts.find((d) => d.id === selected);
    if (!district) return;
    animateTo({ cx: district.center.x, cy: district.center.y - 60, zoom: FOCUS_ZOOM });
  }, [selected, focusToken, world.districts, animateTo]);

  const resetView = useCallback(() => {
    onSelect(null);
    animateTo(fitCamera(world.bounds, size));
  }, [animateTo, onSelect, size, world.bounds]);

  const zoomBy = useCallback(
    (factor: number) => {
      setCamera((current) => ({ ...current, zoom: clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM) }));
    },
    [],
  );

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, cx: camera.cx, cy: camera.cy };
    moved.current = false;
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start) return;
    target.current = null;
    const dx = (event.clientX - start.x) / camera.zoom;
    const dy = (event.clientY - start.y) / camera.zoom;
    // A few pixels of jitter is a click, not a pan.
    if (Math.abs(event.clientX - start.x) > 4 || Math.abs(event.clientY - start.y) > 4) {
      moved.current = true;
    }
    setCamera((current) => ({ ...current, cx: start.cx - dx, cy: start.cy - dy }));
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  /** Panning across the map must not select whatever the pointer lands on. */
  const selectIfNotDragging = useCallback(
    (id: DistrictId) => {
      if (moved.current) {
        moved.current = false;
        return;
      }
      onSelect(id);
    },
    [onSelect],
  );

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    setCamera((current) => ({ ...current, zoom: clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM) }));
  };

  const viewW = size.width / camera.zoom;
  const viewH = size.height / camera.zoom;
  const viewBox = `${camera.cx - viewW / 2} ${camera.cy - viewH / 2} ${viewW} ${viewH}`;
  const sky = SKY[projection.skyPhase];

  return (
    <div ref={containerRef} className="stage">
      <svg
        className="world"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid slice"
        role="application"
        aria-label="Whop City world map"
        data-dragging={dragging}
        data-testid="city-world"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sky.from} />
            <stop offset="55%" stopColor={sky.via} />
            <stop offset="100%" stopColor={sky.to} />
          </linearGradient>
          <filter id="soft-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id="plot-shadow" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#8ea3bf" floodOpacity="0.22" />
          </filter>
        </defs>

        {/* Sky is drawn far larger than the world so panning never reveals an edge. */}
        <rect x={-12000} y={-12000} width={24000} height={24000} fill="url(#sky)" />

        {world.districts.map((district) => (
          <DistrictGroup
            key={district.id}
            district={district}
            selected={selected === district.id}
            dimmed={selected !== null && selected !== district.id}
            hovered={hovered === district.id}
            onHover={setHovered}
            onSelect={selectIfNotDragging}
          />
        ))}
      </svg>

      <div className="panel dock" data-testid="district-dock">
        <button
          type="button"
          className="dock-btn"
          aria-pressed={selected === null}
          onClick={resetView}
          data-testid="dock-overview"
        >
          Overview
        </button>
        {world.districts.map((district) => (
          <button
            key={district.id}
            type="button"
            className="dock-btn"
            aria-pressed={selected === district.id}
            onClick={() => onSelect(district.id)}
            data-testid={`dock-${district.id}`}
          >
            <span
              className="dock-swatch"
              style={{ background: paletteFor(district.id, district.projection.tier).hue }}
            />
            <span className="dock-label">{district.projection.name}</span>
          </button>
        ))}
      </div>

      <div className="panel zoom-dock">
        <button type="button" className="zoom-btn" aria-label="Zoom in" onClick={() => zoomBy(1.22)} data-testid="zoom-in">
          +
        </button>
        <button type="button" className="zoom-btn" aria-label="Zoom out" onClick={() => zoomBy(0.82)} data-testid="zoom-out">
          −
        </button>
      </div>
    </div>
  );
}

type DistrictGroupProps = {
  district: DistrictLayout;
  selected: boolean;
  dimmed: boolean;
  hovered: boolean;
  onHover: (id: DistrictId | null) => void;
  onSelect: (id: DistrictId) => void;
};

function DistrictGroup({ district, selected, dimmed, hovered, onHover, onSelect }: DistrictGroupProps) {
  const { projection } = district;
  const palette = paletteFor(district.id, projection.tier);
  const label = district.labelAnchor;
  const raised = selected || hovered;

  return (
    // The whole district is one target, so clicking a tower selects the
    // district it belongs to rather than falling through to the map.
    <g
      className="district-group district-hit"
      data-dimmed={dimmed}
      data-testid={`district-${district.id}`}
      role="button"
      tabIndex={0}
      aria-label={`${projection.name}. Tier ${projection.tier} of 5. ${projection.signal}. ${projection.direction}.`}
      onPointerEnter={() => onHover(district.id)}
      onPointerLeave={() => onHover(null)}
      onClick={() => onSelect(district.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(district.id);
        }
      }}
    >
      <polygon
        className="district-plot"
        points={polygon(district.plot)}
        fill={palette.plot}
        stroke={palette.plotEdge}
        strokeWidth={raised ? 3 : 1.5}
        filter="url(#plot-shadow)"
      />

      {district.buildings.map((building) => {
        const faces = boxFaces(building);
        const tone = building.accent ? palette.accent : palette.body;
        const shadowPoints = footprint(building);
        const topOrigin = iso(building.gx, building.gy, building.h);

        return (
          <g key={building.key} className="building" style={{ animationDelay: `${building.delay}ms` }}>
            <polygon points={shadowPoints} fill="#7d93b3" opacity={0.2} filter="url(#soft-shadow)" />
            <polygon points={faces.left} fill={tone.left} />
            <polygon points={faces.right} fill={tone.right} />
            <polygon points={faces.top} fill={tone.top} />
            {building.lit ? (
              <circle cx={topOrigin.x} cy={topOrigin.y + 4} r={2.6} fill={palette.window} opacity={0.95} />
            ) : null}
          </g>
        );
      })}

      <text
        className="district-label"
        x={label.x}
        y={label.y - 18}
        textAnchor="middle"
        fill="#0b1220"
      >
        {projection.name}
      </text>
      <text
        className="district-label district-signal"
        x={label.x}
        y={label.y - 3}
        textAnchor="middle"
        fill={palette.hue === DISTRICT_PALETTE[district.id].hue ? palette.hue : "#64748b"}
      >
        {projection.signal}
      </text>
    </g>
  );
}
