// Read-only Judge Mode check of a stored live mission. Usage: node judge-live-check.mjs <base> <missionId> <outDir>
// Only GET requests to 127.0.0.1 are allowed; anything else (other hosts, POST/PUT/DELETE) is aborted and recorded.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [base, id, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const baseHost = new URL(base).host;
const browser = await chromium.launch();
const result = { mission: id, viewports: {} };

for (const [label, viewport] of [["desktop-1440x900", { width: 1440, height: 900 }], ["mobile-390x844", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  const blocked = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await page.route("**/*", (route) => {
    const r = route.request();
    const u = new URL(r.url());
    if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (u.host !== baseHost || r.method() !== "GET") {
      blocked.push(`${r.method()} ${u.origin}${u.pathname}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  await page.goto(`${base}/#/judge/${id}`);
  await page.waitForSelector("[data-testid=research-dashboard]", { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, `judge-${label}.png`), fullPage: true });

  const data = await page.evaluate(() => {
    const txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const q = (s) => [...document.querySelectorAll(s)];
    const findings = q(".findings li").map((li) => ({
      text: txt(li.querySelector(".finding-text")),
      source: li.querySelector(".finding-meta a")?.getAttribute("href") ?? null,
      check: txt(li.querySelector(".finding-meta .badge, .finding-meta [class*=badge]")),
    }));
    const pricing = q("table.pricing tbody tr").map((tr) => ({ state: tr.getAttribute("data-pricing-state"), text: txt(tr) }));
    const cards = q("[data-testid=competitor-card]").map((c) => txt(c).slice(0, 300));
    const doc = document.documentElement;
    const overflowing = q("body *")
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > doc.clientWidth + 1 && getComputedStyle(el).position !== "fixed" && !el.closest("[style*=overflow], .table-wrap, .scroll-x");
      })
      .slice(0, 8)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} right=${Math.round(el.getBoundingClientRect().right)}`);
    return {
      judgeView: !!document.querySelector("[data-testid=judge-view]"),
      missionControls: q("button").filter((b) => /^(approve|run|resume|stop|take over|pause|new mission)/i.test(txt(b))).map((b) => txt(b)),
      tags: q(".dash-tags > *").map(txt),
      objective: txt(document.querySelector(".dash-objective p")),
      findings,
      findingsEmptyNote: txt(document.querySelector(".dash-summary .unknown")),
      limitations: q(".limitations li").map(txt),
      conclusionLabel: txt(document.querySelector(".conclusion .dash-label")),
      conclusionText: txt(document.querySelector(".conclusion p")),
      cards,
      pricing,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      overflowing,
    };
  });
  result.viewports[label] = { ...data, errors, blockedRequests: blocked };
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(outDir, "judge-live-result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
