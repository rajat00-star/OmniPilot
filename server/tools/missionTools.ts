import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";
import { claudeAnalysis, deterministicAnalysis, inferenceObservations, buildProfiles, type Analysis } from "../core/analysis.js";
import { renderCompetitorCsv, renderEvidenceJson, renderLandingPage, renderReport } from "../core/artifacts.js";
import { computeSummary, runVerification } from "../core/verifier.js";
import { newId, nowIso } from "../core/store.js";
import type { ArtifactRecord } from "../core/types.js";
import { LlmError } from "../llm/claude.js";
import { ToolError, type Tool, type ToolContext } from "./registry.js";

const SAFE_FILENAME = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,80}\.(csv|md|html|json)$/i);

function writeArtifact(ctx: ToolContext, filename: string, kind: ArtifactRecord["kind"], role: string, content: string): ArtifactRecord {
  const full = ctx.store.filePath(ctx.missionId, filename);
  fs.writeFileSync(full, content, "utf8");
  const rec: ArtifactRecord = {
    id: newId("art"),
    kind,
    role,
    filename,
    bytes: Buffer.byteLength(content),
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    createdAt: nowIso(),
    stepId: ctx.stepId,
    verification: "not_run",
  };
  ctx.store.update(ctx.missionId, (m) => {
    m.artifacts = m.artifacts.filter((a) => a.filename !== filename);
    m.artifacts.push(rec);
  });
  ctx.log("success", `Wrote ${filename} (${rec.bytes.toLocaleString()} bytes)`, { filename, sha256: rec.sha256.slice(0, 12) }, "artifact.write");
  return rec;
}

function getAnalysis(ctx: ToolContext): Analysis {
  const a = ctx.mission().analysis as Analysis | undefined;
  if (!a) throw new ToolError("Analysis has not been produced", "missing_analysis", "Run analysis.compare first.");
  return a;
}

export const analysisCompare: Tool<Record<string, never>> = {
  name: "analysis.compare",
  description: "Compare captured evidence across competitors: positioning, audiences, differentiators and market gaps. Claude-grounded when configured, rule-based otherwise.",
  inputSchema: z.object({}).strict(),
  consequential: false,
  retryable: false,
  async run(ctx) {
    const m = ctx.mission();
    const productName = m.plan?.productName ?? "Your Product";
    const pitch = m.plan?.productPitch ?? "";
    const profiles = buildProfiles(m);
    if (!profiles.some((p) => p.status !== "inaccessible")) {
      ctx.log("warning", "No competitor pages were captured; analysis will contain only unknowns", {}, "analysis.compare");
    }
    let result: Omit<Analysis, "generatedAt">;
    if (ctx.mode === "claude") {
      ctx.log("info", "Requesting evidence-grounded synthesis from Claude", {}, "analysis.compare");
      try {
        result = await claudeAnalysis(m, profiles, productName, pitch, ctx.signal);
        // Claude does not produce pricing or audience values; keep rule-derived gaps as a floor if Claude found none.
        if (!result.gaps.length) result.gaps = deterministicAnalysis(m, productName, pitch).gaps;
        ctx.log("success", `Claude synthesis accepted (${result.rejectedModelClaims} uncited claims discarded)`, {}, "analysis.compare");
      } catch (e) {
        const reason = e instanceof LlmError ? `${e.code}: ${e.message}` : (e as Error).message;
        ctx.log("warning", `Claude synthesis failed (${reason}); using deterministic analysis`, {}, "analysis.compare");
        ctx.store.update(ctx.missionId, (mm) => mm.warnings.push(`Claude synthesis failed (${reason}); deterministic analysis used.`));
        result = deterministicAnalysis(m, productName, pitch);
      }
    } else {
      result = deterministicAnalysis(m, productName, pitch);
    }
    const analysis: Analysis = { ...result, generatedAt: nowIso() };
    const inferred = inferenceObservations(analysis);
    ctx.store.update(ctx.missionId, (mm) => {
      mm.analysis = analysis;
      // Replace analysis-derived entries if analysis is re-run; keep extracted observations and audience signals.
      mm.observations = mm.observations.filter((o) => o.kind !== "unknown" && !(o.kind === "inference" && (o.field === "positioning" || o.field === "market_gap")));
      mm.observations.push(...inferred);
    });
    const captured = analysis.profiles.filter((p) => p.status !== "inaccessible").length;
    return {
      summary: `${captured}/${analysis.profiles.length} competitors compared; ${analysis.gaps.length} gaps inferred (${analysis.generatedBy === "claude" ? "Claude" : "rules"})`,
      evidenceIds: inferred.map((o) => o.id),
      outcome: captured < analysis.profiles.length ? "partial" : "ok",
    };
  },
};

const writeInput = z.object({
  kind: z.enum(["competitor_csv", "research_report", "landing_page", "evidence_json"]),
  filename: SAFE_FILENAME,
});

export const artifactWrite: Tool<z.infer<typeof writeInput>> = {
  name: "artifact.write",
  description: "Render an artifact from observed tool outputs and write it inside the mission artifact directory.",
  inputSchema: writeInput,
  consequential: false,
  retryable: false,
  async run(ctx, input) {
    const m = ctx.mission();
    let rec: ArtifactRecord;
    switch (input.kind) {
      case "competitor_csv":
        rec = writeArtifact(ctx, input.filename, "csv", "Competitor analysis", renderCompetitorCsv(getAnalysis(ctx)));
        break;
      case "research_report":
        rec = writeArtifact(ctx, input.filename, "markdown", "Research report", renderReport(m, getAnalysis(ctx)));
        break;
      case "landing_page":
        rec = writeArtifact(ctx, input.filename, "html", "Landing page concept", renderLandingPage(m, getAnalysis(ctx)));
        break;
      case "evidence_json":
        rec = writeArtifact(ctx, input.filename, "json", "Evidence ledger", renderEvidenceJson(m));
        break;
    }
    return { summary: `${rec.filename} written (${rec.bytes.toLocaleString()} bytes)`, artifactIds: [rec.id] };
  },
};

export const artifactRead: Tool<{ filename: string }> = {
  name: "artifact.read",
  description: "Read an artifact back from the mission directory and report its size and a short preview.",
  inputSchema: z.object({ filename: SAFE_FILENAME }),
  consequential: false,
  retryable: true,
  async run(ctx, input) {
    const full = ctx.store.filePath(ctx.missionId, input.filename);
    if (!fs.existsSync(full)) throw new ToolError(`${input.filename} does not exist`, "not_found");
    const text = fs.readFileSync(full, "utf8");
    return { summary: `${input.filename}: ${text.length} chars`, output: { preview: text.slice(0, 600), bytes: Buffer.byteLength(text) } };
  },
};

export const artifactDelete: Tool<{ filename: string }> = {
  name: "artifact.delete",
  description: "Delete an artifact from the mission directory. Consequential: always requires explicit approval.",
  inputSchema: z.object({ filename: SAFE_FILENAME }),
  consequential: true,
  retryable: false,
  async run(ctx, input) {
    const full = ctx.store.filePath(ctx.missionId, input.filename);
    if (!fs.existsSync(full)) throw new ToolError(`${input.filename} does not exist`, "not_found");
    fs.unlinkSync(full);
    ctx.store.update(ctx.missionId, (m) => (m.artifacts = m.artifacts.filter((a) => a.filename !== input.filename)));
    return { summary: `Deleted ${input.filename}` };
  },
};

export const verifierCheck: Tool<{ filenames: string[] }> = {
  name: "verifier.check",
  description: "Independently verify artifacts: read back from disk, parse, check structure, coverage and citations, and re-ground every excerpt against stored captures.",
  inputSchema: z.object({ filenames: z.array(SAFE_FILENAME).min(1).max(10) }),
  consequential: false,
  retryable: false,
  async run(ctx, input) {
    const m = ctx.mission();
    ctx.log("info", `Verifying ${input.filenames.length} artifacts and ${m.observations.length} observations`, {}, "verifier.check");
    const res = await runVerification(m, {
      resolve: (rel) => ctx.store.filePath(ctx.missionId, rel),
      renderHtml: (html, shot) => ctx.browser.renderHtml(html, ctx.store.filePath(ctx.missionId, shot)),
      imageStats: (rel) => ctx.browser.imageStats(ctx.store.filePath(ctx.missionId, rel)),
    }, input.filenames);
    ctx.store.update(ctx.missionId, (mm) => {
      mm.checks = res.checks;
      for (const a of mm.artifacts) {
        const s = res.perArtifact.get(a.id);
        if (s) a.verification = s;
      }
      for (const o of mm.observations) {
        const r = res.observationChecks.get(o.id);
        if (r) {
          o.check = r.check;
          o.checkNote = r.note;
        }
      }
      if (res.renderShot) {
        mm.frames.push({ at: nowIso(), url: "artifact://landing-page-concept.html", title: "Landing page concept (offline render)", screenshotFile: res.renderShot, state: "loaded", stepId: ctx.stepId });
      }
      mm.summary = computeSummary(mm);
    });
    for (const c of res.checks.filter((c) => c.status !== "passed")) {
      ctx.log(c.status === "failed" ? "error" : "warning", `${c.name}: ${c.detail}`, {}, "verifier.check");
    }
    const failed = res.checks.filter((c) => c.status === "failed").length;
    const passed = res.checks.filter((c) => c.status === "passed").length;
    ctx.log(failed ? "warning" : "success", `Verification: ${passed} passed, ${failed} failed, ${res.checks.length - passed - failed} warnings`, {}, "verifier.check");
    return { summary: `${passed}/${res.checks.length} checks passed${failed ? `, ${failed} failed` : ""}`, outcome: failed ? "partial" : "ok" };
  },
};

export const reportFinalize: Tool<Record<string, never>> = {
  name: "report.finalize",
  description: "Write verification-report.md and the mission summary from computed execution results.",
  inputSchema: z.object({}).strict(),
  consequential: false,
  retryable: false,
  async run(ctx) {
    const m = ctx.mission();
    const s = computeSummary(m);
    const L: string[] = [
      `# Verification report — mission ${m.id}`,
      "",
      `Generated ${s.generatedAt}. All figures are computed from execution records, not from model output.`,
      "",
      "## Summary",
      "",
      `- ${s.sourcesCaptured} of ${s.sourcesAttempted} sources captured (${s.sourcesFailed} failed).`,
      `- ${s.targetsWithAnyCapture} of ${s.targetsTotal} competitors had at least one page captured.`,
      `- ${s.descriptionsFound} product descriptions found.`,
      `- ${s.pricesFound} competitors with publicly displayed prices; ${s.pricesUnavailable} unavailable.`,
      `- ${s.observationsGrounded} of ${s.observationsTotal} observations re-grounded verbatim in stored captures (${s.observationsUngrounded} ungrounded).`,
      `- ${s.claimsNeedingReview} inferred claims require human review.`,
      `- ${s.checksPassed} checks passed, ${s.checksFailed} failed, ${s.checksWarned} warnings across ${s.artifactsChecked} artifacts.`,
      "",
      `> ${s.integrityNote}`,
      "",
      "## Checks",
      "",
      "| Status | Scope | Artifact | Check | Detail |",
      "|---|---|---|---|---|",
      ...m.checks.map((c) => `| ${c.status.toUpperCase()} | ${c.scope} | ${m.artifacts.find((a) => a.id === c.artifactId)?.filename ?? "—"} | ${c.name} | ${c.detail.replace(/\|/g, "\\|")} |`),
      "",
      "## Steps",
      "",
      ...m.steps.map((st) => `- **${st.status}** — ${st.title}${st.resultSummary ? `: ${st.resultSummary}` : ""}${st.error ? ` (error: ${st.error.message.slice(0, 200)})` : ""}`),
      "",
    ];
    const text = L.join("\n");
    const rec = writeArtifact(ctx, "verification-report.md", "markdown", "Verification report", text);
    // Self-check: the summary file must read back identically.
    const back = fs.readFileSync(ctx.store.filePath(ctx.missionId, rec.filename));
    const ok = crypto.createHash("sha256").update(back).digest("hex") === rec.sha256;
    ctx.store.update(ctx.missionId, (mm) => {
      const a = mm.artifacts.find((x) => x.id === rec.id);
      if (a) a.verification = ok ? "passed" : "failed";
      mm.summary = s;
      mm.finalSummary = [
        `Captured ${s.sourcesCaptured}/${s.sourcesAttempted} sources across ${s.targetsWithAnyCapture}/${s.targetsTotal} competitors.`,
        `Found ${s.descriptionsFound} descriptions and displayed prices for ${s.pricesFound} competitors (${s.pricesUnavailable} unavailable).`,
        `${s.observationsGrounded}/${s.observationsTotal} observations re-grounded; ${s.claimsNeedingReview} inferences need review.`,
        `${s.checksPassed} checks passed, ${s.checksFailed} failed.`,
      ].join(" ");
    });
    return { summary: `verification-report.md written; read-back ${ok ? "matched" : "MISMATCH"}`, artifactIds: [rec.id] };
  },
};
