import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Environment discovery for the capture scripts.
 *
 * Nothing here is machine-specific by default. Output goes next to the app, and
 * the browser is found by looking rather than by hard-coding one path, so the
 * same command works in Cursor, in CI and on a laptop.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, "..");

/** Defaults to a writable path inside the repository. ART_OUT overrides. */
export function artOut() {
  const dir = process.env.ART_OUT ? resolve(process.env.ART_OUT) : resolve(PROJECT_ROOT, "artifacts");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Scratch space for intermediate frames. Never committed. */
export function framesDir() {
  const dir = resolve(PROJECT_ROOT, ".frames");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const CHROME_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

export function chromeExecutable() {
  if (process.env.CHROME_PATH) {
    const explicit = resolve(process.env.CHROME_PATH);
    if (!existsSync(explicit)) {
      throw new Error(`CHROME_PATH is set to ${explicit} but nothing is there.`);
    }
    return explicit;
  }
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined; // Playwright's bundled build.
}

/** Software WebGL, so capture works on a machine with no GPU. */
export const GL_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

export function launchOptions() {
  const executablePath = chromeExecutable();
  return executablePath ? { executablePath, args: GL_ARGS } : { args: GL_ARGS };
}

/**
 * The production route.
 *
 * Defaults to the preview server serving `pnpm build` output, so the evidence
 * is of the built app rather than of a dev bundle. There is no separate capture
 * entry point: these are photographs of the real route.
 */
export const APP_URL = process.env.CITY_URL ?? "http://localhost:4173";

/**
 * Screenshots are slow here.
 *
 * The city renders through SwiftShader at twice the display resolution, and the
 * shell's blurred panels composite on top of it. A frame takes ten to twenty
 * seconds on this machine, which is well past Playwright's default.
 */
export const SHOT_TIMEOUT = Number(process.env.SHOT_TIMEOUT ?? 180_000);

export async function shoot(page, name) {
  await page.screenshot({ path: artifactPath(name), timeout: SHOT_TIMEOUT, animations: "disabled" });
  return artifactPath(name);
}

/** The city viewport, matching the renderer's authored framing. */
export const VIEW = { width: 1440, height: 900 };

export function artifactPath(name) {
  return resolve(artOut(), name);
}

/**
 * Opens the city route and waits for the world to exist.
 *
 * `capture=1` stops the animation loop so frames are driven explicitly, and
 * `ss` pins the supersampling factor so a capture is reproducible rather than
 * dependent on the display it ran on.
 */
export async function openCity(browser, { scenario, capture = true, ss = 2, view = VIEW } = {}) {
  const page = await browser.newPage({ viewport: view, deviceScaleFactor: 1 });
  const params = new URLSearchParams();
  if (capture) params.set("capture", "1");
  params.set("ss", String(ss));
  if (scenario) params.set("scenario", scenario);

  await page.goto(`${APP_URL}/?${params}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__city?.ready === true, null, { timeout: 60_000 });
  // The canvas exists before the first city does; wait for geometry.
  await page.waitForFunction(() => (window.__city?.info().parcels ?? 0) > 0, null, { timeout: 60_000 });
  return page;
}
