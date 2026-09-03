import { chromium } from "@playwright/test";

/**
 * Deterministic demo recording. Same harness as the passing suite, so what the
 * video shows and what the tests assert cannot drift apart.
 */
const OUT = "/tmp/whop-spike/demo-video";

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

const beat = (ms = 2200) => page.waitForTimeout(ms);

async function report(label) {
  const count = await page.locator('[data-testid="district-inspector"]').count();
  if (!count) {
    console.log(`${label.padEnd(30)} panel=CLOSED`);
    return;
  }
  const title = await page.locator('[data-testid="inspector-title"]').innerText();
  const metrics = await page.locator('[data-testid="district-inspector"] .metric-value').allInnerTexts();
  console.log(`${label.padEnd(30)} panel=OPEN title=${JSON.stringify(title)} metrics=${JSON.stringify(metrics)}`);
}

await page.goto("http://127.0.0.1:3000/");
await page.waitForSelector('[data-testid="first-load"]', { state: "hidden" });
await beat(3200);
await report("overview");

// Select by clicking the city itself, not a button.
await page.locator('[data-testid="district-commerce-core"] polygon').nth(4).click({ force: true });
await beat(2600);
await report("clicked Commerce Core");

// The locked operator control: click it and show nothing happens.
await page.locator('[data-testid="operator-locked-action"]').first().hover();
await beat(900);
await page.locator('[data-testid="operator-locked-action"]').first().click({ force: true });
await beat(2400);
await report("clicked LOCKED action");

await page.getByTestId("dock-creator-quarter").click();
await beat(2600);
await report("dock Creator Quarter");

await page.getByTestId("dock-offer-forge").click();
await beat(2600);
await report("dock Offer Forge");

await page.getByTestId("zoom-in").click();
await beat(700);
await page.getByTestId("zoom-in").click();
await beat(1400);
await page.getByTestId("zoom-out").click();
await beat(700);
await page.getByTestId("zoom-out").click();
await beat(1400);
await report("after zoom");

// Drag-pan across empty sky.
await page.mouse.move(320, 260);
await page.mouse.down();
for (let i = 1; i <= 18; i++) {
  await page.mouse.move(320 + i * 11, 260 + i * 5);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await beat(1800);
await report("after drag-pan");

await page.getByTestId("dock-overview").click();
await beat(3200);
await report("back to overview");

await context.close();
await browser.close();
console.log("recording written to", OUT);
