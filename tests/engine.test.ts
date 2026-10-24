import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MissionEngine } from "../server/core/engine";
import { MissionStore } from "../server/core/store";
import { BrowserManager } from "../server/browser/browserManager";
import { createRegistry } from "../server/tools";
import { isTerminal } from "../server/core/stateMachine";
import type { Mission, Target } from "../server/core/types";
import { startFixtureServer, tempDir, type Fixture } from "./helpers/fixtures";

let fx: Fixture;
let store: MissionStore;
let browser: BrowserManager;
let engine: MissionEngine;
const policy = { allowLoopback: true };

beforeAll(async () => {
  fx = await startFixtureServer();
  store = new MissionStore(tempDir());
  browser = new BrowserManager(policy, { headed: false, navTimeoutMs: 6000 });
  engine = new MissionEngine(store, createRegistry(), browser, () => "deterministic", { stepTimeoutMs: 45_000, maxParallel: 2, urlPolicy: policy });
});

afterAll(async () => {
  await browser.shutdown();
  await fx.close();
});

const PROMPT = "Research these competitors, create a competitor-analysis CSV, write a research report and a landing-page concept for my product called Verity. Verify every artifact.";

async function planWith(targets: Omit<Target, "origin" | "enabled">[]): Promise<Mission> {
  const m = await engine.create({ prompt: PROMPT });
  expect(m.status).toBe("awaiting_approval");
  return engine.updateTargets(m.id, targets.map((t) => ({ ...t, origin: "user", enabled: true })));
}

async function until(id: string, pred: (m: Mission) => boolean, ms = 120_000): Promise<Mission> {
  const start = Date.now();
  for (;;) {
    const m = store.get(id)!;
    if (pred(m)) return m;
    if (Date.now() - start > ms) throw new Error(`timeout waiting; status=${m.status}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("mission engine with a real browser", () => {
  it("runs a full mission: navigation, extraction, artifacts, read-back verification", async () => {
    const m = await planWith([
      { id: "acme", name: "Acme AI", urls: [`${fx.base}/acme`, `${fx.base}/redirect-ok`] },
      { id: "beta", name: "Beta Writer", urls: [`${fx.base}/beta`] },
      { id: "gamma", name: "Gamma Labs", urls: [`${fx.base}/noprice`] },
    ]);
    engine.approve(m.id);
    const done = await until(m.id, (x) => isTerminal(x.status));
    expect(done.status).toBe("completed");
    expect(done.sources.filter((s) => s.ok)).toHaveLength(4);
    const redirected = done.sources.find((s) => s.requestedUrl.endsWith("/redirect-ok"))!;
    expect(redirected.finalUrl).toBe(`${fx.base}/acme`);
    expect(redirected.redirectChain).toEqual([`${fx.base}/redirect-ok`]);
    // Observations are grounded verbatim in the stored capture.
    const obs = done.observations.filter((o) => o.kind === "observation");
    expect(obs.length).toBeGreaterThan(5);
    expect(obs.every((o) => o.check === "grounded")).toBe(true);
    // Missing price is reported as Not found, never zero.
    const csv = fs.readFileSync(store.filePath(m.id, "competitor-analysis.csv"), "utf8");
    expect(csv).toMatch(/Gamma Labs,captured,.*Not found/);
    expect(csv).toContain("$20/month");
    expect(csv).toContain("€18/mo");
    // Summary figures are computed from execution.
    expect(done.summary).toMatchObject({ sourcesCaptured: 4, sourcesAttempted: 4, pricesFound: 2, pricesUnavailable: 1, descriptionsFound: 2, checksFailed: 0 });
    expect(done.artifacts.map((a) => a.filename).sort()).toEqual(["competitor-analysis.csv", "evidence.json", "landing-page-concept.html", "research-report.md", "verification-report.md"]);
    expect(done.artifacts.every((a) => a.verification === "passed")).toBe(true);
    expect(fs.existsSync(store.filePath(m.id, "screens/landing-page-concept-render.png"))).toBe(true);
    expect(done.plan?.productName).toBe("Verity");
  });

  it("reports extraction failures and blocked redirects honestly and degrades the mission", async () => {
    const m = await planWith([
      { id: "acme", name: "Acme AI", urls: [`${fx.base}/acme`] },
      { id: "missing", name: "Missing Co", urls: [`${fx.base}/does-not-exist`] },
      { id: "sneaky", name: "Sneaky Redirect", urls: [`${fx.base}/redirect-private`] },
    ]);
    engine.approve(m.id);
    const done = await until(m.id, (x) => isTerminal(x.status));
    expect(done.status).toBe("completed_with_warnings");
    const missing = done.sources.find((s) => s.targetId === "missing")!;
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/HTTP 404/);
    const sneaky = done.sources.find((s) => s.targetId === "sneaky")!;
    expect(sneaky.ok).toBe(false);
    expect(sneaky.error).toMatch(/blocked/i);
    expect(done.steps.find((s) => s.id === "collect-missing")!.status).toBe("failed");
    expect(done.steps.find((s) => s.id === "collect-missing")!.error?.recovery).toBeTruthy();
    const csv = fs.readFileSync(store.filePath(m.id, "competitor-analysis.csv"), "utf8");
    expect(csv).toMatch(/Missing Co,inaccessible,.*Source inaccessible/);
    expect(done.summary?.sourcesFailed).toBe(2);
  });

  it("fails the mission when no evidence at all can be captured", async () => {
    const m = await planWith([{ id: "missing", name: "Missing Co", urls: [`${fx.base}/nope`] }]);
    engine.approve(m.id);
    const done = await until(m.id, (x) => isTerminal(x.status));
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/No competitor source could be captured/);
  });

  it("cancels a running mission, closing in-flight navigation", async () => {
    const m = await planWith([
      { id: "slow-a", name: "Slow A", urls: [`${fx.base}/slow`] },
      { id: "slow-b", name: "Slow B", urls: [`${fx.base}/slow`] },
    ]);
    engine.approve(m.id);
    await until(m.id, (x) => x.steps.some((s) => s.status === "running"), 10_000);
    const t0 = Date.now();
    engine.cancel(m.id);
    const done = store.get(m.id)!;
    expect(done.status).toBe("cancelled");
    expect(done.steps.every((s) => ["cancelled", "skipped", "succeeded", "failed"].includes(s.status))).toBe(true);
    // Give the engine loop time to unwind; status must stay cancelled and no artifacts are written.
    await new Promise((r) => setTimeout(r, 1500));
    expect(store.get(m.id)!.status).toBe("cancelled");
    expect(store.get(m.id)!.artifacts).toHaveLength(0);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("pauses between browser actions and resumes", async () => {
    const m = await planWith([{ id: "acme", name: "Acme AI", urls: [`${fx.base}/acme`, `${fx.base}/beta`] }]);
    engine.approve(m.id);
    engine.pause(m.id);
    expect(store.get(m.id)!.status).toBe("paused");
    await new Promise((r) => setTimeout(r, 800));
    expect(store.get(m.id)!.artifacts).toHaveLength(0);
    engine.resume(m.id);
    const done = await until(m.id, (x) => isTerminal(x.status));
    expect(done.status).toBe("completed");
  });

  it("requires explicit approval for consequential tools and honours denial", async () => {
    const m = await planWith([{ id: "acme", name: "Acme AI", urls: [`${fx.base}/acme`] }]);
    // Inject a consequential step into the plan the way a model might propose it.
    store.update(m.id, (mm) => {
      mm.steps.push({ id: "delete-csv", title: "Delete the CSV", description: "", tool: "artifact.delete", input: { filename: "competitor-analysis.csv" }, dependsOn: ["finalize"], critical: false, status: "pending", attempts: 0, evidenceIds: [], artifactIds: [], verification: "not_run" });
    });
    engine.approve(m.id);
    const waiting = await until(m.id, (x) => x.approvals.length > 0);
    expect(waiting.steps.find((s) => s.id === "delete-csv")!.status).toBe("waiting_approval");
    engine.resolveApproval(m.id, waiting.approvals[0].id, false);
    const done = await until(m.id, (x) => isTerminal(x.status));
    expect(done.steps.find((s) => s.id === "delete-csv")!.status).toBe("skipped");
    expect(fs.existsSync(store.filePath(m.id, "competitor-analysis.csv"))).toBe(true);
    expect(done.approvals[0].resolution).toBe("denied");
  });

  it("refuses to run consequential tools ad hoc and validates ad-hoc input", async () => {
    const m = await planWith([{ id: "acme", name: "Acme AI", urls: [`${fx.base}/acme`] }]);
    await expect(engine.runAdHoc(m.id, "artifact.delete", { filename: "x.csv" })).rejects.toMatchObject({ code: "approval_required" });
    await expect(engine.runAdHoc(m.id, "shell.exec", {})).rejects.toMatchObject({ code: "unknown_tool" });
    await expect(engine.runAdHoc(m.id, "browser.open", { url: "http://169.254.169.254/latest/meta-data" })).rejects.toThrow(/blocked|Private|navigation/i);
    engine.cancel(m.id);
  });

  it("treats injected page instructions as data", async () => {
    const m = await planWith([{ id: "inj", name: "Injected", urls: [`${fx.base}/inject`] }]);
    engine.approve(m.id);
    const done = await until(m.id, (x) => isTerminal(x.status));
    const desc = done.observations.find((o) => o.field === "official_description")!;
    expect(desc.value).toMatch(/Ignore previous instructions/);
    expect(desc.kind).toBe("observation");
    // Verification is computed independently of page content.
    expect(done.checks.length).toBeGreaterThan(10);
    expect(done.steps.map((s) => s.tool)).not.toContain("artifact.delete");
  });
});
