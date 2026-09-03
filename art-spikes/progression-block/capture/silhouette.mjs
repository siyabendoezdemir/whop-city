import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

const OUT = process.env.ART_OUT ?? "/opt/cursor/artifacts";
const FRAMES = "/tmp/whop-spike/art-frames";
const STATES = ["dormant", "rising", "healthy", "struggling"];

const GL_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
];

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 300)));

await page.goto("http://127.0.0.1:5180/?bare=1", { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
await page.waitForTimeout(1200);

const canvas = page.locator("canvas");
for (const state of STATES) {
  await page.evaluate((s) => window.__setState(s), state);
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__silhouette(true));
  await page.waitForTimeout(500);
  await canvas.screenshot({ path: `${FRAMES}/sil-${state}.png` });
  await page.evaluate(() => window.__silhouette(false));
  await page.waitForTimeout(300);
  console.log("silhouette", state);
}

execFileSync("ffmpeg", [
  "-y",
  "-i", `${FRAMES}/sil-dormant.png`,
  "-i", `${FRAMES}/sil-rising.png`,
  "-i", `${FRAMES}/sil-healthy.png`,
  "-i", `${FRAMES}/sil-struggling.png`,
  "-filter_complex",
  "[0:v]scale=720:-1,pad=iw:ih+2:0:0:white[a];[1:v]scale=720:-1,pad=iw:ih+2:0:0:white[b];" +
    "[2:v]scale=720:-1,pad=iw:ih+2:0:0:white[c];[3:v]scale=720:-1,pad=iw:ih+2:0:0:white[d];" +
    "[a][b]hstack[top];[c][d]hstack[bot];[top][bot]vstack",
  `${OUT}/silhouette_contact_sheet.png`,
], { stdio: "pipe" });
console.log("contact sheet written");

await browser.close();
