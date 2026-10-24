import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { runVerification, computeSummary } from "../server/core/verifier";
import { renderCompetitorCsv, renderReport, renderEvidenceJson, renderLandingPage } from "../server/core/artifacts";
import { deterministicAnalysis, inferenceObservations, type Analysis } from "../server/core/analysis";
import { buildCaptureDocument, extractObservations } from "../server/core/extraction";
import type { ArtifactRecord, Mission, SourceCapture } from "../server/core/types";
import { tempDir } from "./helpers/fixtures";

const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

/** Build a mission with one captured source and one inaccessible target, plus its artifacts on disk. */
function setup() {
  const dir = tempDir();
  const resolve = (rel: string) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    return full;
  };
  const snap = {
    requestedUrl: "https://acme.test/", finalUrl: "https://acme.test/", redirectChain: [], httpStatus: 200, title: "Acme", metaDescription: "Acme helps analysts.", ogTitle: "", ogDescription: "", canonical: "", lang: "en",
    h1: ["Answers with sources for analysts"], h2: ["Cited answers your whole team can trust"], h3: [], visibleText: "Built for research teams.\nFree\nPro $20/month",
  };
  const src: SourceCapture = { id: "src_a", targetId: "acme", targetName: "Acme", requestedUrl: snap.requestedUrl, finalUrl: snap.finalUrl, redirectChain: [], capturedAt: "2026-10-24T00:00:00Z", ok: true, stepId: "collect-acme", title: "Acme" };
  const doc = buildCaptureDocument(snap, src.capturedAt);
  fs.writeFileSync(resolve("sources/src_a.txt"), doc);
  src.textFile = "sources/src_a.txt";
  src.textSha256 = sha(doc);
  fs.writeFileSync(resolve("screens/src_a.jpg"), "jpeg-bytes");
  src.screenshotFile = "screens/src_a.jpg";
  const failed: SourceCapture = { id: "src_b", targetId: "gone", targetName: "Gone Inc", requestedUrl: "https://gone.test/", redirectChain: [], capturedAt: "2026-10-24T00:00:00Z", ok: false, error: "Site unreachable", stepId: "collect-gone" };
  const m: Mission = {
    id: "msn_test01", prompt: "p", createdAt: "", updatedAt: "", status: "verifying", mode: "deterministic", steps: [], approvals: [], activity: [], frames: [], warnings: [], checks: [], artifacts: [],
    sources: [src, failed], observations: extractObservations(snap, src),
    plan: { objective: "o", productName: "Verity", productPitch: "", deliverables: [], planner: "deterministic", plannerNotes: [], steps: [], targets: [
      { id: "acme", name: "Acme", urls: [snap.requestedUrl], origin: "user", enabled: true },
      { id: "gone", name: "Gone Inc", urls: [failed.requestedUrl], origin: "user", enabled: true },
    ] },
  };
  const analysis: Analysis = { ...deterministicAnalysis(m, "Verity", ""), generatedAt: "" };
  m.analysis = analysis;
  m.observations.push(...inferenceObservations(analysis));
  const write = (filename: string, kind: ArtifactRecord["kind"], content: string) => {
    fs.writeFileSync(resolve(filename), content);
    m.artifacts.push({ id: `art_${filename}`, kind, role: filename, filename, bytes: content.length, sha256: sha(content), createdAt: "", stepId: "w", verification: "not_run" });
  };
  write("competitor-analysis.csv", "csv", renderCompetitorCsv(analysis));
  write("research-report.md", "markdown", renderReport(m, analysis));
  write("landing-page-concept.html", "html", renderLandingPage(m, analysis));
  write("evidence.json", "json", renderEvidenceJson(m));
  const files = m.artifacts.map((a) => a.filename);
  return { m, dir, resolve, files };
}

const failedNames = (checks: { status: string; name: string }[]) => checks.filter((c) => c.status === "failed").map((c) => c.name);

describe("artifact verification", () => {
  it("passes well-formed artifacts and grounds observations", async () => {
    const { m, resolve, files } = setup();
    const r = await runVerification(m, { resolve }, files);
    expect(failedNames(r.checks)).toEqual([]);
    expect([...r.observationChecks.values()].filter((v) => v.check === "grounded").length).toBeGreaterThan(3);
    m.checks = r.checks;
    for (const o of m.observations) {
      const c = r.observationChecks.get(o.id);
      if (c) o.check = c.check;
    }
    const s = computeSummary(m);
    expect(s).toMatchObject({ sourcesAttempted: 2, sourcesCaptured: 1, sourcesFailed: 1, pricesFound: 1, pricesUnavailable: 1, descriptionsFound: 1, checksFailed: 0 });
  });

  it("requires screenshot evidence for every captured page", async () => {
    const { m, resolve, files, dir } = setup();
    fs.unlinkSync(path.join(dir, "screens/src_a.jpg"));
    const r = await runVerification(m, { resolve }, files);
    expect(failedNames(r.checks)).toContain("Screenshot evidence for every captured page");
  });

  it("detects missing files", async () => {
    const { m, resolve, files, dir } = setup();
    fs.unlinkSync(path.join(dir, "research-report.md"));
    const r = await runVerification(m, { resolve }, files);
    expect(failedNames(r.checks)).toContain("File exists");
  });

  it("detects post-write tampering via read-back hash", async () => {
    const { m, resolve, files, dir } = setup();
    fs.appendFileSync(path.join(dir, "evidence.json"), " ");
    const r = await runVerification(m, { resolve }, files);
    expect(failedNames(r.checks)).toContain("Read back matches written bytes");
  });

  it("detects missing CSV columns, empty required cells and fake zero prices", async () => {
    const { m, resolve, files, dir } = setup();
    const bad = "competitor,status,primary_url,pricing_status,official_description,displayed_prices\nAcme,captured,https://acme.test/,Not found,,$0\n";
    fs.writeFileSync(path.join(dir, "competitor-analysis.csv"), bad);
    m.artifacts.find((a) => a.kind === "csv")!.sha256 = sha(bad);
    const r = await runVerification(m, { resolve }, files);
    const f = failedNames(r.checks);
    expect(f).toContain("Required columns present");
    expect(f).toContain("No empty required cells");
    expect(f).toContain("Missing prices not shown as zero");
    expect(f).toContain("One row per competitor");
  });

  it("detects malformed CSV", async () => {
    const { m, resolve, files, dir } = setup();
    const bad = 'a,b\n"unterminated,1\n';
    fs.writeFileSync(path.join(dir, "competitor-analysis.csv"), bad);
    m.artifacts.find((a) => a.kind === "csv")!.sha256 = sha(bad);
    const r = await runVerification(m, { resolve }, files);
    expect(failedNames(r.checks)).toContain("Parses as CSV");
  });

  it("detects missing report sections and uncited sources", async () => {
    const { m, resolve, files, dir } = setup();
    const bad = "# Report\n\n## Executive summary\n\nNothing here.\n";
    fs.writeFileSync(path.join(dir, "research-report.md"), bad);
    m.artifacts.find((a) => a.kind === "markdown")!.sha256 = sha(bad);
    const r = await runVerification(m, { resolve }, files);
    const f = failedNames(r.checks);
    expect(f).toContain("Required sections present");
    expect(f).toContain("Every captured source cited");
    expect(f).toContain("Every competitor has a profile");
  });

  it("flags observations whose excerpt is not in the stored capture", async () => {
    const { m, resolve, files } = setup();
    const desc = m.observations.find((o) => o.field === "official_description")!;
    desc.value = desc.excerpt = "Acme is the cheapest tool on the market.";
    const r = await runVerification(m, { resolve }, files);
    expect(r.observationChecks.get(desc.id)!.check).toBe("ungrounded");
    expect(failedNames(r.checks)).toContain("Observations grounded in captures");
  });

  it("detects a modified capture file", async () => {
    const { m, resolve, files, dir } = setup();
    fs.appendFileSync(path.join(dir, "sources/src_a.txt"), "\ninjected");
    const r = await runVerification(m, { resolve }, files);
    expect(failedNames(r.checks)).toContain("Stored captures intact");
  });

  it("checks landing page structure and dangling evidence references", async () => {
    const { m, resolve, files, dir } = setup();
    const bad = `<html><head><title>x</title></head><body><h1>Hi</h1><section data-evidence="obs_fake"></section><script>alert(1)</script></body></html>`;
    fs.writeFileSync(path.join(dir, "landing-page-concept.html"), bad);
    m.artifacts.find((a) => a.kind === "html")!.sha256 = sha(bad);
    const r = await runVerification(m, { resolve }, files);
    const f = failedNames(r.checks);
    expect(f).toEqual(expect.arrayContaining(["HTML structure", "Concept disclaimer present", "Evidence attributes resolve", "No scripts in generated page"]));
  });

  it("reports an artifact the writer never produced", async () => {
    const { m, resolve, files } = setup();
    const r = await runVerification(m, { resolve }, [...files, "missing.csv"]);
    expect(failedNames(r.checks)).toContain("Artifact missing.csv produced");
  });
});
