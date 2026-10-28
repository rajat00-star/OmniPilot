import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import type { Analysis } from "../server/core/analysis";
import { isTerminal } from "../server/core/stateMachine";
import type { Mission } from "../server/core/types";
import { startDemoVendors, type DemoVendors } from "../server/demo/fixtureVendors";
import { parseHash, judgeHash } from "../web/src/App";
import { ResearchDashboard } from "../web/src/components/Dashboard";
import { JudgeView } from "../web/src/components/JudgeView";
import { INTEGRITY_DISCLAIMER, buildDashboard, isCitable, priceAmount } from "../web/src/lib/dashboard";
import { tempDir } from "./helpers/fixtures";

// The judge dashboard is built from a real mission run against the offline fixture vendors, never from canned results.
const SIGNATURE =
  "Research five competing AI products. Find their official product descriptions and publicly displayed pricing. Compare their positioning, target audiences, and differentiators. Identify potential market gaps, create a structured competitor-analysis CSV, write an evidence-backed research report, and generate a landing-page concept for my hypothetical product. Verify every generated artifact and show me the evidence.";

let vendors: DemoVendors;
let ctx: ReturnType<typeof createApp>;
let server: Server;
let base: string;
let mission: Mission;

const post = (p: string, body?: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  vendors = await startDemoVendors({ basePort: 0, latencyMs: 0 });
  ctx = createApp({ dataDir: tempDir(), urlPolicy: { allowOnlyOrigins: vendors.origins }, forceMode: "deterministic", fixture: { catalog: vendors.catalog } });
  server = ctx.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const m = (await (await post("/api/missions", { prompt: SIGNATURE, productName: "VerityDesk" })).json()) as Mission;
  await post(`/api/missions/${m.id}/approve`);
  const start = Date.now();
  for (;;) {
    const cur = ctx.store.get(m.id)!;
    if (isTerminal(cur.status)) break;
    if (Date.now() - start > 150_000) throw new Error(`timeout; status=${cur.status}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  // The same JSON the UI receives.
  mission = (await (await fetch(`${base}/api/missions/${m.id}`)).json()) as Mission;
}, 180_000);

afterAll(async () => {
  server.close();
  await ctx.browser.shutdown();
  await vendors.close();
});

const clone = (m: Mission): Mission => JSON.parse(JSON.stringify(m));
const analysisOf = (m: Mission) => m.analysis as Analysis;
const html = (m: Mission) => renderToStaticMarkup(createElement(ResearchDashboard, { mission: m }));
const judge = (m: Mission | undefined, id = mission.id) => renderToStaticMarkup(createElement(JudgeView, { mission: m, missionId: id, onExit: () => {} }));
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

describe("research dashboard view model (real fixture mission)", () => {
  it("summarises the objective and up to three findings, each backed by a stored quote", async () => {
    const d = buildDashboard(mission)!;
    expect(d.objective).toBe(mission.plan!.objective);
    expect(d.dataSource).toBe("fixture");
    expect(d.analysisBy).toBe("rules");
    expect(d.findings.length).toBeGreaterThan(0);
    expect(d.findings.length).toBeLessThanOrEqual(3);
    // One finding per competitor before any competitor gets a second.
    expect(new Set(d.findings.map((f) => f.targetName)).size).toBe(d.findings.length);
    for (const f of d.findings) {
      expect(isCitable(f.evidence)).toBe(true);
      const o = mission.observations.find((x) => x.id === f.evidence.obsId)!;
      expect(o.kind).toBe("observation");
      expect(o.sourceUrl).toBe(f.evidence.sourceUrl);
      // The excerpt really is in the page text that was captured for that source.
      const src = mission.sources.find((s) => s.id === o.sourceId)!;
      expect(src.ok).toBe(true);
      const text = await (await fetch(`${base}/api/missions/${mission.id}/files/${src.textFile}`)).text();
      expect(squash(text)).toContain(squash(o.excerpt!));
    }
  });

  it("keeps displayed prices, a $0 tier, a free option and missing pricing apart", () => {
    const d = buildDashboard(mission)!;
    const byName = Object.fromEntries(d.cards.map((c) => [c.name, c]));
    expect(d.cards.filter((c) => c.pricing.state === "prices")).toHaveLength(mission.summary!.pricesFound);
    for (const c of d.cards) {
      for (const p of c.pricing.prices) {
        const o = mission.observations.find((x) => x.id === p.obsId)!;
        expect(o.field).toBe("displayed_price");
        expect(o.targetId).toBe(c.targetId);
      }
      if (c.pricing.state !== "prices") expect(c.pricing.prices).toHaveLength(0);
    }
    // The fixture vendor with a "$0 per month" tier keeps its $0 as a displayed price.
    const zero = d.cards.find((c) => c.pricing.zeroPrices.length)!;
    expect(zero).toBeDefined();
    expect(zero.pricing.state).toBe("prices");
    expect(priceAmount(zero.pricing.zeroPrices[0].value)).toBe(0);
    // A vendor with no displayed price stays "not found", even when it shows a free plan line.
    const noPrice = d.cards.filter((c) => c.pricing.state === "not_found");
    expect(noPrice.length).toBe(d.cards.length - mission.summary!.pricesFound);
    expect(d.limitations.join(" ")).toMatch(/A missing price is unknown, not free and not \$0/);
    expect(byName["Atlas Agents"].failures[0].error).toMatch(/HTTP 403/);
  });

  it("lists limitations from the record and labels the conclusion by its real origin", () => {
    const d = buildDashboard(mission)!;
    const lim = d.limitations.join(" ");
    expect(lim).toMatch(/Offline demo: fixture pages.*not live research/);
    expect(lim).toMatch(/Atlas Agents \([^)]*HTTP 403/);
    expect(lim).toMatch(/awaiting human review/);
    expect(d.conclusion.by).toBe("rules");
    expect(d.conclusion.text).toContain(`${mission.summary!.sourcesCaptured} of ${mission.summary!.sourcesAttempted} pages`);
  });

  it("builds the feature matrix only from vendor-stated headings of the same competitor", () => {
    const d = buildDashboard(mission)!;
    expect(d.features.length).toBeGreaterThan(0);
    expect(d.features.length).toBeLessThanOrEqual(10);
    for (const row of d.features) {
      for (const [targetId, e] of Object.entries(row.cells)) {
        if (!e) continue;
        const o = mission.observations.find((x) => x.id === e.obsId)!;
        expect(o.field).toBe("vendor_claim");
        expect(o.targetId).toBe(targetId);
      }
    }
  });

  it("reports verification counts straight from the mission summary and artifacts", () => {
    const v = buildDashboard(mission)!.verification;
    const s = mission.summary!;
    expect(v.pagesCaptured).toBe(s.sourcesCaptured);
    expect(v.pagesAttempted).toBe(s.sourcesAttempted);
    expect(v.artifactsTotal).toBe(mission.artifacts.length);
    expect(v.artifactsVerified).toBe(mission.artifacts.filter((a) => a.verification === "passed").length);
    expect(v.checksPassed).toBe(s.checksPassed);
    expect(v.needsReview).toBe(s.claimsNeedingReview);
    expect(v.needsReview).toBeGreaterThan(0);
  });
});

describe("research dashboard edge cases", () => {
  it("drops a quote that failed re-matching from the findings", () => {
    const first = buildDashboard(mission)!.findings[0];
    const m = clone(mission);
    m.observations.find((o) => o.id === first.evidence.obsId)!.check = "ungrounded";
    const d = buildDashboard(m)!;
    expect(d.findings.map((f) => f.evidence.obsId)).not.toContain(first.evidence.obsId);
  });

  it("shows no finding at all rather than an unsupported one", () => {
    const m = clone(mission);
    for (const o of m.observations) o.excerpt = undefined;
    const d = buildDashboard(m)!;
    expect(d.findings).toHaveLength(0);
    expect(d.features).toHaveLength(0);
    expect(decode(html(m))).toContain("No finding could be backed by a quoted excerpt");
  });

  it("marks a competitor with no captured page as inaccessible, not as unpriced or free", () => {
    const m = clone(mission);
    const p = analysisOf(m).profiles[0];
    p.status = "inaccessible";
    const d = buildDashboard(m)!;
    const card = d.cards.find((c) => c.targetId === p.targetId)!;
    expect(card.pricing.state).toBe("inaccessible");
    expect(d.limitations.join(" ")).toContain(`No page was captured for ${p.name}`);
    expect(html(m)).toMatch(/data-pricing-state="inaccessible"[\s\S]*?Source inaccessible/);
  });

  it("labels the conclusion AI-generated only when Claude wrote it", () => {
    const m = clone(mission);
    const a = analysisOf(m);
    a.generatedBy = "claude";
    expect(buildDashboard(m)!.conclusion.by).toBe("rules"); // Claude mode, but no Claude-written gap: still rule-based text.
    a.gaps = [{ id: "gap_x", statement: "Teams lack cited answers.", rationale: "r", basis: [m.observations[0].id], confidence: "low", by: "claude" }];
    const d = buildDashboard(m)!;
    expect(d.conclusion).toEqual({ by: "claude", text: "Teams lack cited answers." });
    const out = html(m);
    expect(out).toContain("AI-generated by Claude");
    expect(out).toContain("Analysis: Claude, evidence-cited");
    expect(html(mission)).not.toContain("AI-generated");
  });

  it("renders nothing without an analysis", () => {
    const m = clone(mission);
    m.analysis = undefined;
    expect(buildDashboard(m)).toBeUndefined();
    expect(html(m)).toBe("");
  });
});

describe("dashboard markup", () => {
  const out = () => decode(html(mission));

  it("has the summary, cards, matrix, pricing and verification sections", () => {
    const o = out();
    for (const s of ["Executive summary", "Key findings from captured pages", "Limitations and open questions", "Competitors", "Feature comparison", "Publicly displayed pricing", "Verification transparency"]) expect(o).toContain(s);
    expect(o).toContain("Rule-based · computed from the record");
    expect(o).toContain("Offline fixture data");
    expect((o.match(/data-testid="competitor-card"/g) ?? []).length).toBe(analysisOf(mission).profiles.length);
  });

  it("links every finding to its source URL and never calls findings verified facts", () => {
    const o = out();
    for (const f of buildDashboard(mission)!.findings) expect(o).toContain(`href="${f.evidence.sourceUrl}"`);
    expect(o).toContain(INTEGRITY_DISCLAIMER);
    expect(o).not.toMatch(/verified facts?/i);
    // External links open without handing the vendor page a reference to this app.
    for (const a of o.match(/<a [^>]*href="https?:[^"]*"[^>]*>/g) ?? []) expect(a).toContain('rel="noreferrer noopener"');
  });

  it("marks inferences and missing pricing in the rendered page", () => {
    const o = out();
    expect(o).toContain("Inferred");
    expect(o).toContain("No price displayed on captured pages. Missing, not $0.");
    expect(o).toMatch(/data-pricing-state="not_found"[\s\S]*?Not found/);
  });
});

describe("judge mode", () => {
  const buttons = (s: string) => [...s.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => squash(m[1].replace(/<[^>]+>/g, " ")));

  it("presents the dashboard read-only, with only evidence buttons and a way back", () => {
    const o = decode(judge(mission));
    expect(o).toContain("Judge mode · read-only");
    expect(o).toContain("Exit judge mode");
    expect(o).toContain('data-testid="research-dashboard"');
    expect(o).toContain("Offline demo mode");
    expect(o).not.toMatch(/<input|<textarea|<form/);
    const labels = buttons(o);
    expect(labels).toContain("Exit judge mode");
    for (const l of labels) expect(l).not.toMatch(/stop|pause|take over|resume|approve|discard|delete|retry|new mission|run/i);
    // Deliverables can be opened, nothing can be changed.
    for (const a of mission.artifacts) expect(o).toContain(`/api/missions/${mission.id}/files/${a.filename}`);
  });

  it("refuses to present a mission that has not completed", () => {
    const m = clone(mission);
    m.status = "running";
    const o = decode(judge(m));
    expect(o).toContain("Judge mode shows completed missions only");
    expect(o).not.toContain('data-testid="research-dashboard"');
    expect(decode(judge(undefined))).toContain("Loading mission");
  });

  it("routes #/judge/<id> separately from the workspace", () => {
    expect(parseHash(judgeHash(mission.id))).toEqual({ id: mission.id, judge: true });
    expect(parseHash(`#/m/${mission.id}`)).toEqual({ id: mission.id, judge: false });
    expect(parseHash("#/")).toEqual({ judge: false });
    expect(parseHash("#/judge/")).toEqual({ id: undefined, judge: true });
  });
});
