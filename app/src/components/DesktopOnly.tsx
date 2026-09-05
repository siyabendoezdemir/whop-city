import { Seal } from "./Glyphs";

/**
 * Not on a phone.
 *
 * The city is a thing you fly around with a mouse and read at a glance; on a
 * 390-pixel screen it is neither. Rather than ship a cramped version that
 * makes the game look bad, this says so and gets out of the way.
 */
export function DesktopOnly() {
  return (
    <main className="city">
      <div className="gate">
        <Seal className="gate__crest" />
        <h1 className="gate__title">Whop City needs a bigger screen</h1>
        <p className="gate__line">
          It is a city you fly around and read at a glance. On a phone it would be neither, so it
          waits for you on a laptop or desktop.
        </p>
        <p className="gate__small">Open this page again on a computer and your city will be exactly where you left it.</p>
      </div>
    </main>
  );
}
