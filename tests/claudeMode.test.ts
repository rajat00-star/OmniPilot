import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MissionEngine } from "../server/core/engine";
import { MissionStore } from "../server/core/store";
import { BrowserManager } from "../server/browser/browserManager";
import { createRegistry } from "../server/tools";
import { createPlan } from "../server/core/planner";
import { isTerminal } from "../server/core/stateMachine";
import { startDemoVendors, type DemoVendors } from "../server/demo/fixtureVendors";
import type { Mission } from "../server/core/types";
import type { Analysis } from "../server/core/analysis";
import { tempDir } from "./helpers/fixtures";

// Claude mode end to end against a local stand-in for the Claude API: no real call is made,
// the key is fake, and the browser only reaches the fictional vendor sites on 127.0.0.1.
const FAKE_KEY = "sk-ant-api03-fake-key-for-claude-mode-tests";
const delays = { plan: 0, analysis: 0 };
let calls: string[] = [];
let planTargets: { name: string; urls: string[] }[] = [];

function reply(text: string, outputTokens: number) {
  return JSON.stringify({
    id: "msg_fake", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: [{ type: "thinking", thinking: "", signature: "fake" }, { type: "text", text }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 812, output_tokens: outputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens_details: { thinking_tokens: 300 } },
  });
}

function planReply() {
  return reply(
    JSON.stringify({
      objective: "Compare five AI assistants",
      product_name: "VerityDesk",
      product_pitch: "",
      deliverables: ["competitor_csv", "research_report", "landing_page"],
      targets: planTargets.map((t) => ({ name: t.name, official_urls: t.urls, why_relevant: "competitor" })),
      notes: [],
    }),
    1200,
  );
}

function analysisReply(user: string) {
  const ids = [...user.matchAll(/^(obs_[0-9a-f]+) \| target=([a-z0-9-]+) \|/gm)];
  const byTarget = new Map<string, string[]>();
  for (const [, id, target] of ids) byTarget.set(target, [...(byTarget.get(target) ?? []), id]);
  return reply(
    JSON.stringify({
      competitors: [...byTarget.entries()].map(([target_id, own]) => ({
        target_id,
        positioning: `Positioning of ${target_id}`,
        positioning_evidence_ids: own.slice(0, 2),
        differentiators: [{ text: `Differentiator of ${target_id}`, evidence_ids: own.slice(1, 3) }],
      })),
      market_gaps: [{ statement: "A gap", rationale: "From the evidence", evidence_ids: ids.slice(0, 3).map((m) => m[1]), confidence: "low" }],
      landing: { headline: "VerityDesk", subheadline: "Cited answers", value_props: [{ title: "Cited", body: "Every claim cited", gap_index: 0 }], pricing_angle: "Simple pricing", cta: "Try it" },
    }),
    2600,
  );
}

let fake: http.Server;
let vendors: DemoVendors;
const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };

beforeAll(async () => {
  fake = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const kind = String(body.system).includes("planning module") ? "plan" : "analysis";
    calls.push(kind);
    await new Promise((r) => setTimeout(r, delays[kind]));
    if (res.destroyed) return;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(kind === "plan" ? planReply() : analysisReply(String(body.messages?.[0]?.content ?? "")));
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  // Read by the SDK when the client is first built, which happens on the first Claude call below.
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  vendors = await startDemoVendors({ basePort: 0, latencyMs: 0 });
  planTargets = vendors.catalog.map((c) => ({ name: c.name, urls: c.urls }));
});

afterAll(async () => {
  fake.closeAllConnections();
  fake.close();
  await vendors.close();
  for (const [name, value] of [["ANTHROPIC_API_KEY", saved.key], ["ANTHROPIC_BASE_URL", saved.base]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function runMission(stepTimeoutMs: number): Promise<Mission> {
  const policy = { allowOnlyOrigins: vendors.origins };
  const store = new MissionStore(tempDir());
  const browser = new BrowserManager(policy, { headed: false, navTimeoutMs: 6000 });
  const engine = new MissionEngine(store, createRegistry(), browser, () => "claude", { stepTimeoutMs, maxParallel: 2, urlPolicy: policy });
  try {
    const m = await engine.create({ prompt: "Research five competing AI products, compare pricing and write a CSV, a report and a landing page concept.", productName: "VerityDesk" });
    expect(m.plan?.planner).toBe("claude");
    engine.approve(m.id);
    const start = Date.now();
    for (;;) {
      const cur = store.get(m.id)!;
      if (isTerminal(cur.status)) return cur;
      if (Date.now() - start > 90_000) throw new Error(`mission did not finish; status=${cur.status}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    await browser.shutdown();
  }
}

describe("Claude mode with a slow or normal Claude API", () => {
  beforeEach(() => {
    delays.plan = 0;
    delays.analysis = 0;
    calls = [];
  });

  it("stops waiting for a slow planning call at the deadline and falls back to the rule-based planner", async () => {
    delays.plan = 20_000;
    const start = Date.now();
    const { plan, warnings } = await createPlan({ prompt: "Research three AI coding assistants and write a CSV" }, createRegistry(), "claude", undefined, {}, undefined, { deadlineMs: 2000 });
    expect(Date.now() - start).toBeLessThan(6000);
    expect(plan.planner).toBe("deterministic");
    expect(warnings[0]).toMatch(/did not answer within 2 s/);
    expect(calls).toEqual(["plan"]);
  }, 15_000);

  it("falls back to rule-based analysis inside the step budget, so a slow synthesis no longer fails the mission", async () => {
    delays.analysis = 30_000;
    const m = await runMission(8000);
    const step = m.steps.find((s) => s.tool === "analysis.compare")!;
    expect(step.status).toBe("succeeded");
    expect(m.status).toBe("completed_with_warnings");
    expect((m.analysis as Analysis | undefined)?.generatedBy).toBe("rules");
    expect(m.warnings.some((w) => /Claude synthesis failed \(timeout: Claude did not answer within/.test(w))).toBe(true);
    expect(m.artifacts.map((a) => a.filename)).toContain("competitor-analysis.csv");
    expect(m.checks.every((c) => c.status === "passed")).toBe(true);
  }, 120_000);

  it("plans and analyses with Claude while Playwright does the browsing, and logs token usage without the key", async () => {
    const m = await runMission(45_000);
    expect(calls).toEqual(["plan", "analysis"]);
    expect(m.plan?.planner).toBe("claude");
    expect((m.analysis as Analysis | undefined)?.generatedBy).toBe("claude");
    expect(m.sources.filter((s) => s.ok).length).toBe(9);
    const usage = m.activity.filter((a) => /^Claude (planning|synthesis) call:/.test(a.message)).map((a) => a.message);
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatch(/812 input \+ 1,200 output tokens \(300 thinking\)/);
    expect(JSON.stringify(m)).not.toContain(FAKE_KEY);
  }, 120_000);
});
