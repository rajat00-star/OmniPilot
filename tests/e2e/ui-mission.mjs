// UI end-to-end: drives the real OmniPilot UI with Playwright, runs a mission, saves screenshots.
// Usage: node tests/e2e/ui-mission.mjs [baseUrl] [outDir]
import { chromium } from "playwright";
import fs from "node:fs";

const base = process.argv[2] || "http://127.0.0.1:8787";
const out = process.argv[3] || "docs/screenshots";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(e.message));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

await page.goto(base);
await page.getByRole("heading", { name: "What should OmniPilot do?" }).waitFor();
await shot("01-composer");
await page.getByRole("button", { name: /Named competitors/ }).click();
await page.getByLabel("Your product name (optional)").fill("VerityDesk");
await page.getByRole("button", { name: "Draft plan" }).click();
await page.getByRole("button", { name: "Approve and run" }).waitFor({ timeout: 60000 });
await shot("02-plan-review");
await page.getByRole("button", { name: "Approve and run" }).click();
await page.getByText("Agent driving").waitFor({ timeout: 20000 });
await page.waitForSelector(".shot img", { timeout: 60000 });
await page.waitForTimeout(1500);
await shot("03-running-browser");
await page.waitForFunction(() => /Completed|Failed|Cancelled/.test(document.querySelector(".mission-status-line .badge")?.textContent || ""), null, { timeout: 300000 });
const status = await page.locator(".mission-status-line .badge").first().textContent();
await page.waitForTimeout(800);
await shot("04-results");
await page.getByRole("tab", { name: /Evidence/ }).click();
await page.waitForTimeout(400);
await shot("05-evidence");
await page.getByRole("tab", { name: /Verification/ }).click();
await page.waitForTimeout(400);
await shot("06-verification");
await page.getByRole("tab", { name: /Browser/ }).click();
await shot("07-browser-after");
console.log(JSON.stringify({ status, consoleErrors }, null, 2));
await browser.close();
if (consoleErrors.length) process.exit(2);
