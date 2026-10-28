import fs from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { parse as parseCsv } from "csv-parse/sync";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { DATA_SOURCE_LABEL } from "../server/core/artifacts";
import { isTerminal } from "../server/core/stateMachine";
import type { Mission } from "../server/core/types";
import { startDemoVendors, type DemoVendors } from "../server/demo/fixtureVendors";
import { tempDir } from "./helpers/fixtures";

// The Grand Finale fallback: the signature mission against five fictional vendors served locally.
const SIGNATURE =
  "Research five competing AI products. Find their official product descriptions and publicly displayed pricing. Compare their positioning, target audiences, and differentiators. Identify potential market gaps, create a structured competitor-analysis CSV, write an evidence-backed research report, and generate a landing-page concept for my hypothetical product. Verify every generated artifact and show me the evidence.";

let vendors: DemoVendors;
let ctx: ReturnType<typeof createApp>;
let server: Server;
let base: string;

beforeAll(async () => {
  vendors = await startDemoVendors({ basePort: 0, latencyMs: 0 });
  ctx = createApp({ dataDir: tempDir(), urlPolicy: { allowOnlyOrigins: vendors.origins }, forceMode: "deterministic", fixture: { catalog: vendors.catalog } });
  server = ctx.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await ctx.browser.shutdown();
  await vendors.close();
});

const post = (p: string, body?: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function until(id: string, ms = 150_000): Promise<Mission> {
  const start = Date.now();
  for (;;) {
    const m = ctx.store.get(id)!;
    if (isTerminal(m.status)) return m;
    if (Date.now() - start > ms) throw new Error(`timeout; status=${m.status}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe("offline demo mode (fixture-backed, labelled)", () => {
  it("advertises fixture mode in health", async () => {
    const h = await (await fetch(`${base}/api/health`)).json();
    expect(h.dataSource).toBe("fixture");
    expect(h.reasoning.mode).toBe("deterministic");
    expect(h.fixtureSites.map((s: { name: string }) => s.name)).toEqual(["Lumina Assist", "Orbit Copilot", "Quillstone AI", "Atlas Agents", "Nimbus Chat"]);
  });

  let mission: Mission;

  it("plans the signature mission against the five fictional vendors and says so", async () => {
    const r = await post("/api/missions", { prompt: SIGNATURE, productName: "VerityDesk" });
    expect(r.status).toBe(201);
    const m = (await r.json()) as Mission;
    expect(m.dataSource).toBe("fixture");
    expect(m.plan!.targets.map((t) => t.name)).toHaveLength(5);
    expect(m.plan!.plannerNotes.join(" ")).toMatch(/Offline demo mode.*not live research/);
    expect((await post(`/api/missions/${m.id}/approve`)).status).toBe(200);
    mission = await until(m.id);
  });

  it("handles redirect, missing price, blocked page and injected text honestly", () => {
    const m = mission;
    // One of ten pages answers HTTP 403, so the run completes with warnings rather than claiming full success.
    expect(m.status).toBe("completed_with_warnings");
    expect(m.sources.filter((s) => s.ok)).toHaveLength(9);
    const blocked = m.sources.find((s) => !s.ok)!;
    expect(blocked.targetName).toBe("Atlas Agents");
    expect(blocked.error).toMatch(/HTTP 403/);
    const orbit = m.sources.find((s) => s.targetName === "Orbit Copilot" && s.redirectChain.length)!;
    expect(orbit.finalUrl).toMatch(/\/platform$/);
    expect(m.summary!.targetsWithAnyCapture).toBe(5);
    expect(m.summary!.pricesFound).toBe(3);
    expect(m.summary!.observationsUngrounded).toBe(0);
    expect(m.checks.filter((c) => c.status === "failed")).toEqual([]);
  });

  it("labels every artifact as fixture data and the verifier checks the label", () => {
    const m = mission;
    const file = (name: string) => fs.readFileSync(ctx.store.filePath(m.id, name), "utf8");
    const label = DATA_SOURCE_LABEL.fixture;
    const rows = parseCsv(file("competitor-analysis.csv"), { columns: true }) as Record<string, string>[];
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.data_source === label)).toBe(true);
    const byName = Object.fromEntries(rows.map((r) => [r.competitor, r]));
    expect(byName["Quillstone AI"].pricing_status).toBe("Not found");
    expect(byName["Quillstone AI"].displayed_prices).toBe("");
    expect(byName["Atlas Agents"].status).toBe("partial");
    expect(byName["Nimbus Chat"].displayed_prices).toContain("$12/month");
    expect(file("research-report.md")).toContain(`**Data source: ${label}.**`);
    expect(file("verification-report.md")).toContain(`**Data source: ${label}.**`);
    expect(JSON.parse(file("evidence.json")).dataSource).toBe(label);
    expect(file("landing-page-concept.html")).toContain("offline demo fixture");
    const labelChecks = m.checks.filter((c) => c.name === "Data source labelled on every row" || c.name === "Data source stated");
    expect(labelChecks.map((c) => c.status)).toEqual(["passed", "passed"]);
  });

  it("blocks the public web and the app's own API during manual browsing", async () => {
    for (const url of ["https://claude.com/pricing", `${base}/api/health`]) {
      const r = await post(`/api/missions/${mission.id}/browse`, { url });
      expect(r.status).toBe(400);
      const body = await r.json();
      expect(body.error).toMatch(/Offline demo mode: only the local demo fixture sites can be opened/);
    }
  });
});
