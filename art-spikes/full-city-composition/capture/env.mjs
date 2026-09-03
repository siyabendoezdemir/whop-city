import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Environment discovery for the capture scripts.
 *
 * Nothing here is machine-specific by default. Output goes next to the spike,
 * and the browser is found by looking rather than by hard-coding one path, so
 * the same command works in Cursor, in CI and on a laptop.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, "..");

/**
 * Where captures land.
 *
 * Defaults to a writable path inside the repository. Override with ART_OUT for
 * a sandbox that collects artifacts elsewhere.
 */
export function artOut() {
  const dir = process.env.ART_OUT
    ? resolve(process.env.ART_OUT)
    : resolve(PROJECT_ROOT, "artifacts");
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

/**
 * Resolves a browser to drive.
 *
 * CHROME_PATH wins if set. Otherwise the usual install locations are probed,
 * and if none exist we return undefined so Playwright falls back to its own
 * bundled Chromium — which is the right answer on a machine that ran
 * `npx playwright install`.
 */
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

export const DEV_URL = process.env.SPIKE_URL ?? "http://127.0.0.1:5190";

/** Resolve a filename inside the artifact directory. */
export function artifactPath(name) {
  return resolve(artOut(), name);
}
