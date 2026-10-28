// Read-only: open a completed offline-demo mission, Results tab, and record the multimodal panel.
// Usage: node vision-panel-check.mjs <base> <missionId> <outDir>. Only GET to the app host is allowed.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
const [base, id, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const host = new URL(base).host;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], blocked = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.route("**/*", (r) => {
  const q = r.request(), u = new URL(q.url());
  if (u.host === host && q.method() === "GET") return r.continue();
  blocked.push(`${q.method()} ${u.origin}${u.pathname}`);
  return r.abort("blockedbyclient");
});
await page.goto(`${base}/#/m/${id}`);
await page.getByRole("tab", { name: /Results/ }).click();
const panel = page.locator("section.vision-card");
await panel.waitFor({ timeout: 15000 });
await panel.scrollIntoViewIfNeeded();
await panel.screenshot({ path: path.join(outDir, "vision-panel-offline.png") });
const result = {
  mission: id,
  title: await panel.locator("h2,h3,h4,.section-title").first().textContent().catch(() => null),
  text: (await panel.innerText()).replace(/\s+/g, " ").trim(),
  buttonsInPanel: await panel.locator("button").count(),
  errors,
  blocked,
};
fs.writeFileSync(path.join(outDir, "vision-panel-offline.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
