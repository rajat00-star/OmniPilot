// Rehearsal of the Grand Finale offline demo through the real UI (Playwright).
// Start the app first: npm run build && npm run demo:offline
// Usage: node tests/e2e/offline-demo-ui.mjs [baseUrl] [outDir]
import { chromium } from "playwright";
import fs from "node:fs";
import crypto from "node:crypto";

const base = process.argv[2] || "http://127.0.0.1:8787";
const out = process.argv[3] || "docs/screenshots/offline-demo";
fs.mkdirSync(out, { recursive: true });
const results = [];
const note = (k, v) => {
  results.push([k, v]);
  console.log(k.padEnd(52), v);
};
const health = await (await fetch(`${base}/api/health`)).json();
if (health.dataSource !== "fixture") throw new Error("Server is not in offline demo mode; start it with npm run demo:offline");
note("health: dataSource / reasoning", `${health.dataSource} / ${health.reasoning.mode}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(e.message));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const badge = () => page.locator(".mission-status-line .badge").first().textContent();

// 1. Intent
await page.goto(base);
await page.getByRole("heading", { name: "What should OmniPilot do?" }).waitFor();
await page.getByRole("button", { name: /Signature mission/ }).click();
await page.getByLabel("Your product name (optional)").fill("VerityDesk");
await shot("01-composer-offline");

// 2. Plan review and an edit
await page.getByRole("button", { name: "Draft plan" }).click();
await page.getByRole("button", { name: "Approve and run" }).waitFor({ timeout: 30000 });
note("plan targets", (await page.getByLabel("Target name").evaluateAll((els) => els.map((e) => e.value))).join(", "));
await shot("02-plan-review");
await page.getByLabel("Include Nimbus Chat").setChecked(false, { force: true });
await page.getByRole("button", { name: "Apply and rebuild plan" }).click();
await page.waitForFunction(() => !document.querySelector(".row-end"), null, { timeout: 10000 });
note("steps after disabling Nimbus Chat", await page.locator(".stage-steps > *").count());
await page.getByLabel("Include Nimbus Chat").setChecked(true, { force: true });
await page.getByRole("button", { name: "Apply and rebuild plan" }).click();
await page.waitForFunction(() => !document.querySelector(".row-end"), null, { timeout: 10000 });
note("edit round-trip (disable + re-enable target)", "applied");

// 3. Approve, watch, take over, manual browse, resume
await page.getByRole("button", { name: "Approve and run" }).click();
await page.getByRole("button", { name: "Take over" }).waitFor({ timeout: 15000 });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "Take over" }).click();
await page.waitForTimeout(1500);
await shot("03-running-then-taken-over");
await page.waitForFunction(() => /Paused/.test(document.querySelector(".mission-status-line .badge")?.textContent || ""), null, { timeout: 10000 });
note("take over -> status", await badge());
const addr = page.getByLabel("Address");
const before = consoleErrors.length;
await addr.fill("https://example.com/");
await addr.press("Enter");
await page.waitForTimeout(1200);
// The browser logs the deliberate HTTP 400 refusal as a resource error; that one is expected, not an app error.
const expected = consoleErrors.splice(before).filter((e) => !/status of 400/.test(e));
consoleErrors.push(...expected);
const blockedMsg = await page.locator("[role=alert], .inline-error").first().textContent().catch(() => "");
note("manual browse to public web (must be blocked)", (blockedMsg || "").slice(0, 110));
await shot("04-takeover-public-web-blocked");
const lumina = health.fixtureSites[0].urls[1];
await addr.fill(lumina);
await addr.press("Enter");
await page.waitForTimeout(2500);
await shot("05-takeover-manual-fixture-page");
await page.getByRole("button", { name: "Resume agent" }).click();
note("resume", "clicked");

// 4. Results, evidence, verification
await page.waitForFunction(() => /Completed|Failed|Cancelled/.test(document.querySelector(".mission-status-line .badge")?.textContent || ""), null, { timeout: 180000 });
await page.waitForTimeout(800);
note("final status", await badge());
await shot("06-results");
await page.getByRole("tab", { name: /Evidence/ }).click();
await page.waitForTimeout(400);
await shot("07-evidence");
await page.getByRole("tab", { name: /Verification/ }).click();
await page.waitForTimeout(400);
await shot("08-verification");

// 5. Read artifacts back over HTTP and compare with the recorded hashes
const id = decodeURIComponent(new URL(page.url()).hash.replace("#/m/", ""));
const m = await (await fetch(`${base}/api/missions/${id}`)).json();
let matched = 0;
for (const a of m.artifacts) {
  const buf = Buffer.from(await (await fetch(`${base}/api/missions/${id}/files/${a.filename}?download=1`)).arrayBuffer());
  if (crypto.createHash("sha256").update(buf).digest("hex") === a.sha256) matched++;
  fs.writeFileSync(`${out}/${a.filename}`, buf);
}
note("mission id", id);
note("artifacts downloaded, sha256 matches record", `${matched}/${m.artifacts.length}`);
note("sources captured", `${m.summary.sourcesCaptured}/${m.summary.sourcesAttempted} (+ manual pages: ${m.sources.filter((s) => s.targetId === "manual").length})`);
note("competitors with any capture / prices found", `${m.summary.targetsWithAnyCapture}/${m.summary.targetsTotal} / ${m.summary.pricesFound}`);
note("observations grounded", `${m.summary.observationsGrounded}/${m.summary.observationsTotal}`);
note("checks passed / failed / warnings", `${m.summary.checksPassed} / ${m.summary.checksFailed} / ${m.summary.checksWarned}`);
note("failed sources", m.sources.filter((s) => !s.ok).map((s) => `${s.targetName}: ${s.error}`).join(" | "));

// 5b. Judge mode: read-only presentation, evidence drill-down, and the way back
await page.getByRole("tab", { name: /Results/ }).click();
await page.getByTestId("research-dashboard").waitFor();
await page.getByRole("button", { name: "Judge mode" }).click();
await page.getByTestId("judge-view").waitFor();
await page.waitForTimeout(600);
note("judge: mission controls shown", await page.getByRole("button", { name: /^(Stop|Pause|Take over|Resume agent|Approve and run|Discard)$/ }).count());
note("judge: competitor cards", await page.getByTestId("competitor-card").count());
await shot("10-judge");
await page.locator(".findings .ev-btn").first().click();
await page.getByRole("dialog").waitFor();
note("judge: evidence dialog source", await page.getByRole("dialog").locator("a[href^='http']").first().getAttribute("href"));
await shot("11-judge-evidence");
await page.keyboard.press("Escape");
await page.getByRole("dialog").waitFor({ state: "detached" });
note("judge: still in judge mode after closing evidence", new URL(page.url()).hash.startsWith("#/judge/"));
await page.keyboard.press("Escape");
await page.locator(".mission-status-line").waitFor();
note("judge: Escape returns to workspace", new URL(page.url()).hash === `#/m/${id}`);

// 6. Stop mid-run
await page.getByRole("button", { name: "New mission" }).click();
await page.getByRole("button", { name: /Signature mission/ }).click();
await page.getByRole("button", { name: "Draft plan" }).click();
await page.getByRole("button", { name: "Approve and run" }).waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Approve and run" }).click();
await page.getByRole("button", { name: "Stop" }).waitFor({ timeout: 10000 });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Stop" }).click();
await page.waitForFunction(() => /Cancelled/.test(document.querySelector(".mission-status-line .badge")?.textContent || ""), null, { timeout: 15000 });
await page.waitForTimeout(2000);
const id2 = decodeURIComponent(new URL(page.url()).hash.replace("#/m/", ""));
const m2 = await (await fetch(`${base}/api/missions/${id2}`)).json();
note("stop mid-run -> status / artifacts", `${m2.status} / ${m2.artifacts.length}`);
note("stop: step states", [...new Set(m2.steps.map((s) => s.status))].join(","));
await shot("09-stopped");

note("browser console errors", consoleErrors.length);
fs.writeFileSync(`${out}/run-log.json`, JSON.stringify({ base, at: new Date().toISOString(), results, consoleErrors }, null, 2));
await browser.close();
if (consoleErrors.length) process.exit(2);
