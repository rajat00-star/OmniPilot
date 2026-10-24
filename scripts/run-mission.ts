// Headless end-to-end run of a mission through the real engine (no UI).
// Usage: npm run mission -- "instruction text"
import { createApp } from "../server/app.js";
import { isTerminal } from "../server/core/stateMachine.js";

const prompt =
  process.argv.slice(2).join(" ") ||
  "Research five competing AI products. Find their official product descriptions and publicly displayed pricing. Compare their positioning, target audiences, and differentiators. Identify potential market gaps, create a structured competitor-analysis CSV, write an evidence-backed research report, and generate a landing-page concept for my hypothetical product. Verify every generated artifact and show me the evidence.";

const { engine, store, browser } = createApp();
const m = await engine.create({ prompt });
console.log(`mission ${m.id}: ${m.status} (${m.mode})`);
for (const t of m.plan?.targets ?? []) console.log(`  target ${t.name} [${t.origin}] ${t.urls.join(" ")}`);
if (m.status !== "awaiting_approval") process.exit(1);
engine.approve(m.id);
let seen = 0;
await new Promise<void>((resolve) => {
  const tick = () => {
    const cur = store.get(m.id)!;
    for (const a of cur.activity.slice(seen)) console.log(`  [${a.level}] ${a.tool ?? ""} ${a.message}`);
    seen = cur.activity.length;
    if (isTerminal(cur.status)) return resolve();
    setTimeout(tick, 500);
  };
  tick();
});
const done = store.get(m.id)!;
store.flushAll();
console.log(`\nstatus: ${done.status}${done.error ? ` — ${done.error}` : ""}`);
console.log(`summary: ${done.finalSummary ?? "(none)"}`);
console.log(`artifacts: ${done.artifacts.map((a) => `${a.filename}=${a.verification}`).join(", ")}`);
console.log(`files: ${store.filesDir(m.id)}`);
await browser.shutdown();
