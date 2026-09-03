/**
 * First-load reveal.
 *
 * The city is server-rendered, so this is not a spinner standing in for absent
 * data — the world is already in the markup underneath. What it covers is the
 * gap before hydration, when the page looks interactive but no handler is
 * attached yet. It deliberately keeps blocking pointer events until then, so an
 * eager click is delayed rather than silently swallowed.
 *
 * `ready` flips on hydration. The CSS also fades it out on a timer regardless,
 * so a browser that never runs the JS still reaches the city.
 */
export function FirstLoad({ ready }: { ready: boolean }) {
  return (
    <div className="firstload" data-ready={ready} aria-hidden="true" data-testid="first-load">
      <div className="firstload-inner">
        <div className="skeleton-skyline">
          {[38, 62, 26, 50, 44, 58, 30].map((height, index) => (
            <i key={height} style={{ height, animationDelay: `${index * 90}ms` }} />
          ))}
        </div>
        <div className="firstload-mark" />
        <p className="firstload-text">Raising the city</p>
      </div>
    </div>
  );
}
