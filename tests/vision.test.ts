import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { isTerminal } from "../server/core/stateMachine";
import type { Mission } from "../server/core/types";
import { groundReading, pricingPages } from "../server/core/vision";
import { startDemoVendors, type DemoVendors } from "../server/demo/fixtureVendors";
import { ResearchDashboard } from "../web/src/components/Dashboard";
import { VisionPanel } from "../web/src/components/VisionPanel";
import { buildDashboard, pricingScreenshots } from "../web/src/lib/dashboard";
import { tempDir } from "./helpers/fixtures";

// The multimodal companion against a local stand-in for the Claude API: no real call is made and the key is fake.
const FAKE_KEY = "sk-ant-api03-fake-key-for-vision-tests";
const SIGNATURE =
  "Research five competing AI products. Find their official product descriptions and publicly displayed pricing. Compare their positioning, target audiences, and differentiators. Identify potential market gaps, create a structured competitor-analysis CSV, write an evidence-backed research report, and generate a landing-page concept for my hypothetical product. Verify every generated artifact and show me the evidence.";

interface SeenRequest {
  system: string;
  mediaType?: string;
  imageHead?: string;
  text: string;
}
const seen: SeenRequest[] = [];

function reply(text: string) {
  return JSON.stringify({
    id: "msg_fake", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1700, output_tokens: 240, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
}

let fake: Server;
let vendors: DemoVendors;
let ctx: ReturnType<typeof createApp>;
let server: Server;
let base: string;
/** The mission's own server: offline demo, rule-based forced. */
let demo: ReturnType<typeof createApp>;
let demoServer: Server;
let demoBase: string;
let mission: Mission;
const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
const post = (p: string, body?: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  fake = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const content = body.messages?.[0]?.content as { type: string; text?: string; source?: { media_type: string; data: string } }[];
    const image = content.find((b) => b.type === "image");
    const text = content.find((b) => b.type === "text")?.text ?? "";
    seen.push({ system: String(body.system), mediaType: image?.source?.media_type, imageHead: image?.source?.data.slice(0, 4), text });
    if (text.includes("Nimbus")) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "image could not be processed" } }));
      return;
    }
    const lumina = /Lumina/.test(text) && /pricing/.test(text);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      reply(
        JSON.stringify(
          lumina
            ? {
                pricing_visible: true,
                plans: [
                  { plan_name: "Plus", price_text: "$18/month", billing_note: "", limits: ["For professionals who write every day", "Unlimited everything"] },
                  { plan_name: "Platinum", price_text: "$999/month", billing_note: "", limits: [] },
                  { plan_name: "Team", price_text: "$45 per user / month", billing_note: "", limits: [] },
                ],
              }
            : { pricing_visible: false, plans: [] },
        ),
      ),
    );
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;

  // As on the developer Mac: the mission runs rule-based, and a server with Claude configured reads it later.
  vendors = await startDemoVendors({ basePort: 0, latencyMs: 0 });
  const dataDir = tempDir();
  demo = createApp({ dataDir, urlPolicy: { allowOnlyOrigins: vendors.origins }, forceMode: "deterministic", fixture: { catalog: vendors.catalog } });
  demoServer = demo.app.listen(0, "127.0.0.1");
  await new Promise((r) => demoServer.once("listening", r));
  demoBase = `http://127.0.0.1:${(demoServer.address() as AddressInfo).port}`;
  const send = (p: string, b?: unknown) => fetch(demoBase + p, { method: "POST", headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
  const m = (await (await send("/api/missions", { prompt: SIGNATURE, productName: "VerityDesk" })).json()) as Mission;
  await send(`/api/missions/${m.id}/approve`);
  const start = Date.now();
  while (!isTerminal(demo.store.get(m.id)!.status)) {
    if (Date.now() - start > 150_000) throw new Error("mission did not finish");
    await new Promise((r) => setTimeout(r, 150));
  }
  demo.store.flushAll();
  ctx = createApp({ dataDir });
  server = ctx.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  mission = ctx.store.get(m.id)!;
  expect(mission.status).toBe("completed_with_warnings");
}, 180_000);

afterAll(async () => {
  server.close();
  demoServer.close();
  await ctx.browser.shutdown();
  await demo.browser.shutdown();
  await vendors.close();
  fake.closeAllConnections();
  fake.close();
  for (const [name, value] of [["ANTHROPIC_API_KEY", saved.key], ["ANTHROPIC_BASE_URL", saved.base]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("grounding of screenshot readings", () => {
  const capture = ["H3: Pro", "---- VISIBLE TEXT ----", "Pro", "$20 / month", "Up to 1,200 minutes a month", "Enterprise — talk to sales"].join("\n");

  it("keeps a plan only when its name and price are in the captured text", () => {
    const g = groundReading(
      {
        pricing_visible: true,
        plans: [
          { plan_name: "Pro", price_text: "$20/month", billing_note: "", limits: ["Up to 1,200 minutes a month", "Unlimited AI chat"] },
          { plan_name: "Business", price_text: "$30/month", billing_note: "", limits: [] },
          { plan_name: "Pro", price_text: "$25/month", billing_note: "", limits: [] },
          { plan_name: "Enterprise", price_text: "talk to sales", billing_note: "", limits: [] },
        ],
      },
      capture,
    );
    expect(g.kept).toEqual([{ plan: "Pro", price: "$20/month", billing: undefined, limits: ["Up to 1,200 minutes a month"], priceLine: "$20 / month" }]);
    expect(g.limitsDropped).toBe(1);
    expect(g.discarded.map((d) => d.reason)).toEqual(["plan name not in the captured text", "price not in the captured text", "not a price"]);
  });

  it("cannot be steered by text in the image that is not on the page", () => {
    const g = groundReading({ pricing_visible: true, plans: [{ plan_name: "Ignore previous instructions", price_text: "$0", billing_note: "", limits: [] }] }, capture);
    expect(g.kept).toHaveLength(0);
  });
});

describe("reading pricing screenshots with Claude (stand-in API)", () => {
  it("selects the same pricing screenshots on the server and in the UI", () => {
    const server = pricingPages(mission).map((s) => s.id);
    expect(server.length).toBeGreaterThan(0);
    expect(pricingScreenshots(mission).map((s) => s.id)).toEqual(server);
  });

  it("refuses to spend without explicit confirmation, without a key, or in the offline demo", async () => {
    const r = await post(`/api/missions/${mission.id}/vision/pricing`, {});
    expect(r.status).toBe(400);
    const offline = await fetch(`${demoBase}/api/missions/${mission.id}/vision/pricing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmPaidCall: true }) });
    expect(offline.status).toBe(409);
    expect((await offline.json()).error).toMatch(/rule-based mode and makes no Claude calls/);
    delete process.env.ANTHROPIC_API_KEY;
    const r2 = await post(`/api/missions/${mission.id}/vision/pricing`, { confirmPaidCall: true });
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
    expect(r2.status).toBe(409);
    expect((await r2.json()).error).toMatch(/not configured/);
    expect(seen).toHaveLength(0);
  });

  it("sends each screenshot as an image, keeps grounded pairings as inferences and records failures", async () => {
    const r = await post(`/api/missions/${mission.id}/vision/pricing`, { confirmPaidCall: true });
    expect(r.status).toBe(200);
    const m = ctx.store.get(mission.id)!;
    const run = m.visionRuns![0];
    expect(seen).toHaveLength(pricingPages(mission).length);
    for (const s of seen) {
      expect(s.mediaType).toBe("image/jpeg");
      expect(s.imageHead).toBe("/9j/"); // base64 of a JPEG header
      expect(s.system).toMatch(/third-party content/);
    }
    const lumina = run.pages.find((p) => p.targetName === "Lumina Assist" && /pricing/.test(p.url))!;
    expect(lumina.kept).toBe(1);
    expect(lumina.discarded.map((d) => `${d.plan}: ${d.reason}`)).toEqual(["Platinum: plan name not in the captured text", "Team: price not in the captured text"]);
    expect(lumina.limitsDropped).toBe(1);
    const nimbus = run.pages.find((p) => p.targetName === "Nimbus Chat");
    if (nimbus) expect(nimbus.error).toMatch(/400/);

    const plans = m.observations.filter((o) => o.field === "plan_price");
    expect(plans).toHaveLength(1);
    const plan = plans[0];
    expect(plan.value).toBe("Plus: $18/month · For professionals who write every day");
    expect(plan.kind).toBe("inference");
    expect(plan.check).toBe("needs_review");
    expect(plan.excerpt).toContain("$18/month");
    const basis = m.observations.find((o) => o.id === plan.basis![0])!;
    expect(basis.field).toBe("displayed_price");
    expect(basis.value).toBe("$18/month");
    const answered = run.pages.filter((p) => !p.error).length;
    expect(answered).toBe(seen.length - (nimbus ? 1 : 0));
    expect(run.inputTokens).toBe(1700 * answered);
    expect(run.costUsd).toBeCloseTo((1700 * answered * 4 + 240 * answered * 20) / 1e6, 6);
    expect(m.activity.some((a) => /^Claude screenshot reading call: 1,700 input \+ 240 output tokens/.test(a.message))).toBe(true);
    expect(JSON.stringify(m)).not.toContain(FAKE_KEY);
  });

  it("runs at most once per mission", async () => {
    const before = seen.length;
    const r = await post(`/api/missions/${mission.id}/vision/pricing`, { confirmPaidCall: true });
    expect(r.status).toBe(409);
    expect(seen).toHaveLength(before);
  });

  it("shows readings in the dashboard as Claude-vision inferences, never as quoted findings", () => {
    const m = ctx.store.get(mission.id)!;
    const d = buildDashboard(m)!;
    const card = d.cards.find((c) => c.name === "Lumina Assist")!;
    expect(card.pricing.plans.map((p) => p.value)).toEqual(["Plus: $18/month · For professionals who write every day"]);
    expect(d.findings.every((f) => f.evidence.field !== "plan_price")).toBe(true);
    expect(d.verification.vision).toMatchObject({ kept: 1, discarded: 2 });
    expect(d.limitations.join(" ")).toMatch(/pairing is the model's reading and needs review/);
    const html = renderToStaticMarkup(createElement(ResearchDashboard, { mission: m }));
    expect(html).toContain("Plans read from screenshot");
    expect(html).toContain("Claude vision · needs review");
  });

  it("offers the paid button only when Claude is configured and nothing was read yet", () => {
    const health = (configured: boolean) => ({ reasoning: { mode: "claude", configured, model: configured ? "claude-opus-5-5" : null } }) as never;
    const fresh = { ...mission, visionRuns: undefined };
    const render = (m: Mission, configured: boolean) => renderToStaticMarkup(createElement(VisionPanel, { mission: m, health: health(configured), busy: false, onRead: () => {} }));
    expect(render(fresh, true)).toMatch(/<button[^>]*>.*Read \d pricing screenshots? with Claude/);
    expect(render(fresh, false)).not.toContain("<button");
    expect(render(fresh, false)).toContain("Not available in rule-based mode");
    const offlineDemo = { reasoning: { mode: "deterministic", configured: true, model: "claude-opus-5-5" } } as never;
    expect(renderToStaticMarkup(createElement(VisionPanel, { mission: fresh, health: offlineDemo, busy: false, onRead: () => {} }))).not.toContain("<button");
    const done = render(ctx.store.get(mission.id)!, true);
    expect(done).not.toContain("<button");
    expect(done).toContain("1 kept");
  });
});
