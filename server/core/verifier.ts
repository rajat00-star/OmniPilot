import fs from "node:fs";
import crypto from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { parse as parseHtml } from "node-html-parser";
import { CSV_COLUMNS, PRICING_STATUSES, REPORT_SECTIONS } from "./artifacts.js";
import { normalizeWs } from "./extraction.js";
import { newId, nowIso } from "./store.js";
import type { ImageStats, RenderResult } from "../browser/browserManager.js";
import type { ArtifactRecord, CheckResult, Mission, Observation, ObservationCheck, VerificationSummary } from "./types.js";

export interface VerifierIO {
  /** Absolute path for a mission-relative file. */
  resolve(relative: string): string;
  /** Optional offline render of HTML artifacts (Playwright). */
  renderHtml?(html: string, screenshotRelative: string): Promise<RenderResult>;
  /** Optional pixel statistics for a stored screenshot (mission-relative path). */
  imageStats?(relative: string): Promise<ImageStats>;
}

type Add = (c: Omit<CheckResult, "id">) => void;

function sha256(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Integrity checks shared by every artifact: exists, readable, hash matches what was written. */
function readBack(a: ArtifactRecord, io: VerifierIO, add: Add): string | undefined {
  const file = io.resolve(a.filename);
  if (!fs.existsSync(file)) {
    add({ artifactId: a.id, scope: "integrity", name: "File exists", status: "failed", detail: `${a.filename} is missing on disk` });
    return undefined;
  }
  add({ artifactId: a.id, scope: "integrity", name: "File exists", status: "passed", detail: file.split("/").slice(-3).join("/") });
  const buf = fs.readFileSync(file);
  if (buf.length === 0) {
    add({ artifactId: a.id, scope: "integrity", name: "Non-empty", status: "failed", detail: "File is empty" });
    return undefined;
  }
  const match = sha256(buf) === a.sha256;
  add({
    artifactId: a.id,
    scope: "integrity",
    name: "Read back matches written bytes",
    status: match ? "passed" : "failed",
    detail: match ? `${buf.length.toLocaleString()} bytes, sha256 ${a.sha256.slice(0, 12)}…` : "Content on disk differs from what the writer recorded",
  });
  return buf.toString("utf8");
}

export function verifyCsv(a: ArtifactRecord, text: string, m: Mission, add: Add): void {
  let rows: Record<string, string>[];
  try {
    rows = parseCsv(text, { columns: true, skip_empty_lines: true, relax_column_count: false });
    add({ artifactId: a.id, scope: "integrity", name: "Parses as CSV", status: "passed", detail: `${rows.length} data rows` });
  } catch (e) {
    add({ artifactId: a.id, scope: "integrity", name: "Parses as CSV", status: "failed", detail: (e as Error).message.slice(0, 200) });
    return;
  }
  const header = Object.keys(rows[0] ?? {});
  const headerLine = parseCsv(text.split(/\r?\n/)[0] ?? "", {})[0] as string[] | undefined;
  const cols = headerLine ?? header;
  const missing = CSV_COLUMNS.filter((c) => !cols.includes(c));
  add({
    artifactId: a.id,
    scope: "integrity",
    name: "Required columns present",
    status: missing.length ? "failed" : "passed",
    detail: missing.length ? `Missing: ${missing.join(", ")}` : `${CSV_COLUMNS.length} required columns`,
  });
  const expected = (m.plan?.targets ?? []).filter((t) => t.enabled).length;
  add({
    artifactId: a.id,
    scope: "coverage",
    name: "One row per competitor",
    status: rows.length === expected ? "passed" : "failed",
    detail: `${rows.length} rows for ${expected} enabled targets`,
  });
  const empties: string[] = [];
  const badStatus: string[] = [];
  const fakeZero: string[] = [];
  const inconsistent: string[] = [];
  for (const r of rows) {
    for (const c of ["competitor", "status", "primary_url", "pricing_status", "official_description"]) if (!r[c]?.trim()) empties.push(`${r.competitor || "?"}.${c}`);
    if (!PRICING_STATUSES.includes(r.pricing_status as (typeof PRICING_STATUSES)[number])) badStatus.push(`${r.competitor}: ${r.pricing_status}`);
    if (r.pricing_status !== "Found" && /(^|\D)0(\.0+)?(\D|$)/.test(r.displayed_prices || "")) fakeZero.push(r.competitor);
    if ((r.pricing_status === "Found") !== Boolean(r.displayed_prices?.trim())) inconsistent.push(r.competitor);
  }
  add({ artifactId: a.id, scope: "integrity", name: "No empty required cells", status: empties.length ? "failed" : "passed", detail: empties.length ? empties.slice(0, 6).join(", ") : "All required cells populated (Unknown/Not found used explicitly)" });
  add({ artifactId: a.id, scope: "integrity", name: "Valid pricing status values", status: badStatus.length ? "failed" : "passed", detail: badStatus.length ? badStatus.join("; ") : `All in {${PRICING_STATUSES.join(", ")}}` });
  add({ artifactId: a.id, scope: "integrity", name: "Missing prices not shown as zero", status: fakeZero.length ? "failed" : "passed", detail: fakeZero.length ? `Rows: ${fakeZero.join(", ")}` : "No zero placeholders for missing prices" });
  add({ artifactId: a.id, scope: "integrity", name: "Pricing status consistent with values", status: inconsistent.length ? "failed" : "passed", detail: inconsistent.length ? `Rows: ${inconsistent.join(", ")}` : "Found ⇔ prices listed" });
  const capturedUrls = new Set(m.sources.filter((s) => s.ok).map((s) => s.finalUrl));
  const uncited = rows.filter((r) => r.description_source_url && !capturedUrls.has(r.description_source_url)).map((r) => r.competitor);
  add({ artifactId: a.id, scope: "coverage", name: "Description sources are captured pages", status: uncited.length ? "failed" : "passed", detail: uncited.length ? `Not in capture log: ${uncited.join(", ")}` : "Every description URL is in the capture log" });
  const known = new Set(m.observations.map((o) => o.id));
  const dangling = rows.flatMap((r) => (r.evidence_ids || "").split(/\s+/).filter(Boolean)).filter((id) => !known.has(id));
  add({ artifactId: a.id, scope: "coverage", name: "Evidence ids resolve", status: dangling.length ? "failed" : "passed", detail: dangling.length ? `${dangling.length} unknown ids` : "All evidence ids exist in the ledger" });
}

export function verifyReport(a: ArtifactRecord, text: string, m: Mission, add: Add): void {
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map((x) => x[1].trim());
  const missing = REPORT_SECTIONS.filter((s) => !headings.includes(s));
  add({ artifactId: a.id, scope: "integrity", name: "Required sections present", status: missing.length ? "failed" : "passed", detail: missing.length ? `Missing: ${missing.join(", ")}` : `${REPORT_SECTIONS.length} sections found` });
  const captured = m.sources.filter((s) => s.ok);
  const notCited = captured.filter((s) => !text.includes(s.finalUrl ?? "\u0000"));
  add({ artifactId: a.id, scope: "coverage", name: "Every captured source cited", status: notCited.length ? "failed" : captured.length ? "passed" : "warning", detail: notCited.length ? `${notCited.length} sources not cited` : captured.length ? `${captured.length} sources cited in Evidence index` : "No sources were captured to cite" });
  const targets = (m.plan?.targets ?? []).filter((t) => t.enabled);
  const absent = targets.filter((t) => !text.includes(`### ${t.name}`));
  add({ artifactId: a.id, scope: "coverage", name: "Every competitor has a profile", status: absent.length ? "failed" : "passed", detail: absent.length ? `Missing: ${absent.map((t) => t.name).join(", ")}` : `${targets.length} profiles` });
  const labelled = /\*\*Observed\*\*/.test(text) && /\*\*Inferred\*\*/.test(text) && /\*\*Unknown\*\*/.test(text);
  add({ artifactId: a.id, scope: "integrity", name: "Observed / inferred / unknown labelling", status: labelled ? "passed" : "failed", detail: labelled ? "Label legend present" : "Legend missing" });
  const refs = [...text.matchAll(/\[S(\d+)\]/g)].map((x) => Number(x[1]));
  const bad = refs.filter((n) => n < 1 || n > captured.length);
  add({ artifactId: a.id, scope: "coverage", name: "Inline citations resolve", status: bad.length ? "failed" : "passed", detail: bad.length ? `${bad.length} citations point past the evidence index` : `${refs.length} inline citations` });
}

export async function verifyLanding(a: ArtifactRecord, text: string, m: Mission, add: Add, io: VerifierIO): Promise<string | undefined> {
  const root = parseHtml(text);
  const title = root.querySelector("title")?.text.trim();
  const h1 = root.querySelector("h1")?.text.trim();
  const sections = root.querySelectorAll("section").length;
  add({ artifactId: a.id, scope: "integrity", name: "HTML structure", status: title && h1 && sections >= 3 ? "passed" : "failed", detail: `title=${title ? "yes" : "no"}, h1=${h1 ? "yes" : "no"}, sections=${sections}` });
  const disclaimer = /not market-validated/i.test(root.querySelector(".banner")?.text ?? "");
  add({ artifactId: a.id, scope: "integrity", name: "Concept disclaimer present", status: disclaimer ? "passed" : "failed", detail: disclaimer ? "Banner states it is an unvalidated concept" : "Disclaimer missing" });
  const known = new Set(m.observations.map((o) => o.id));
  const refs = root.querySelectorAll("[data-evidence]").flatMap((e) => (e.getAttribute("data-evidence") ?? "").split(/\s+/).filter(Boolean));
  const dangling = refs.filter((r) => !known.has(r));
  add({ artifactId: a.id, scope: "coverage", name: "Evidence attributes resolve", status: dangling.length ? "failed" : refs.length ? "passed" : "warning", detail: dangling.length ? `${dangling.length} unknown ids` : refs.length ? `${refs.length} evidence references` : "No evidence references in page" });
  const scripts = root.querySelectorAll("script").length;
  add({ artifactId: a.id, scope: "integrity", name: "No scripts in generated page", status: scripts ? "failed" : "passed", detail: `${scripts} script tags` });
  if (!io.renderHtml) {
    add({ artifactId: a.id, scope: "render", name: "Renders in browser", status: "warning", detail: "Render check unavailable" });
    return undefined;
  }
  const shot = `screens/${a.filename.replace(/\.html$/, "")}-render.png`;
  try {
    const r = await io.renderHtml(text, shot);
    add({ artifactId: a.id, scope: "render", name: "Renders in browser", status: r.consoleErrors.length ? "failed" : r.textLength > 200 ? "passed" : "warning", detail: r.consoleErrors.length ? r.consoleErrors.slice(0, 2).join("; ") : `Rendered offline in Chromium, ${r.textLength} chars visible, screenshot saved` });
    visualChecks(a, r, add);
    return shot;
  } catch (e) {
    add({ artifactId: a.id, scope: "render", name: "Renders in browser", status: "failed", detail: (e as Error).message.split("\n")[0] });
    return undefined;
  }
}

export const VISUAL_THRESHOLDS = { minLumaStd: 6, minNonUniform: 0.005, headingContrast: 3, textContrast: 4.5 };

/** Visual checks on the rendered landing page: measured from the screenshot pixels and the rendered layout. */
export function visualChecks(a: ArtifactRecord, r: RenderResult, add: Add): void {
  const T = VISUAL_THRESHOLDS;
  const blank = r.pixels.lumaStd < T.minLumaStd || r.pixels.nonUniformShare < T.minNonUniform;
  add({ artifactId: a.id, scope: "render", name: "Screenshot is not blank", status: blank ? "failed" : "passed", detail: `${r.pixels.width}×${r.pixels.height}px, luminance σ=${r.pixels.lumaStd}, ${(r.pixels.nonUniformShare * 100).toFixed(1)}% non-background pixels` });
  const hero = r.layout.h1?.inFold && r.layout.cta?.inFold;
  add({ artifactId: a.id, scope: "render", name: "Headline and call to action above the fold", status: hero ? "passed" : "failed", detail: `viewport ${r.layout.viewport.width}×${r.layout.viewport.height}: headline ${r.layout.h1 ? (r.layout.h1.inFold ? "visible" : "below fold") : "missing"}, CTA ${r.layout.cta ? (r.layout.cta.inFold ? "visible" : "below fold") : "missing"}` });
  const hc = r.layout.h1?.contrast ?? null;
  const bc = r.layout.body?.contrast ?? null;
  const cc = r.layout.cta?.contrast ?? null;
  const ok = (hc ?? 0) >= T.headingContrast && (bc ?? 0) >= T.textContrast && (cc ?? 0) >= T.headingContrast;
  add({ artifactId: a.id, scope: "render", name: "Text contrast meets WCAG AA", status: ok ? "passed" : "warning", detail: `headline ${hc ?? "n/a"}:1 (≥${T.headingContrast}), body ${bc ?? "n/a"}:1 (≥${T.textContrast}), CTA ${cc ?? "n/a"}:1 (≥${T.headingContrast})` });
}

/** Every captured source should have a non-blank screenshot linked to the step that took it. */
export async function checkScreenshots(m: Mission, io: VerifierIO, add: Add): Promise<void> {
  const captured = m.sources.filter((s) => s.ok && s.targetId !== "manual");
  if (!captured.length) return;
  const missing: string[] = [];
  const blank: string[] = [];
  let measured = 0;
  for (const s of captured) {
    if (!s.screenshotFile || !fs.existsSync(io.resolve(s.screenshotFile))) {
      missing.push(s.targetName);
      continue;
    }
    if (!io.imageStats) continue;
    try {
      const st = await io.imageStats(s.screenshotFile);
      measured++;
      if (st.lumaStd < VISUAL_THRESHOLDS.minLumaStd || st.nonUniformShare < VISUAL_THRESHOLDS.minNonUniform) blank.push(`${s.targetName} (${s.finalUrl})`);
    } catch {
      missing.push(`${s.targetName} (unreadable)`);
    }
  }
  add({
    scope: "render",
    name: "Screenshot evidence for every captured page",
    status: missing.length ? "failed" : blank.length ? "warning" : "passed",
    detail: missing.length
      ? `Missing for: ${missing.join(", ")}`
      : blank.length
        ? `${blank.length} near-blank capture(s), review: ${blank.join("; ")}`
        : `${captured.length} screenshots present${measured ? `, ${measured} pixel-checked non-blank` : ""}, each linked to its capture step`,
  });
}

export function verifyEvidenceJson(a: ArtifactRecord, text: string, m: Mission, add: Add): void {
  let doc: { sources?: unknown[]; observations?: { id: string; sourceId: string | null; kind: string }[] };
  try {
    doc = JSON.parse(text);
    add({ artifactId: a.id, scope: "integrity", name: "Parses as JSON", status: "passed", detail: "Valid JSON" });
  } catch (e) {
    add({ artifactId: a.id, scope: "integrity", name: "Parses as JSON", status: "failed", detail: (e as Error).message });
    return;
  }
  const okShape = Array.isArray(doc.sources) && Array.isArray(doc.observations);
  add({ artifactId: a.id, scope: "integrity", name: "Ledger shape", status: okShape ? "passed" : "failed", detail: okShape ? `${doc.sources!.length} sources, ${doc.observations!.length} observations` : "sources/observations arrays missing" });
  if (!okShape) return;
  const srcIds = new Set(m.sources.map((s) => s.id));
  const orphan = doc.observations!.filter((o) => o.kind === "observation" && (!o.sourceId || !srcIds.has(o.sourceId)));
  add({ artifactId: a.id, scope: "coverage", name: "Observations link to sources", status: orphan.length ? "failed" : "passed", detail: orphan.length ? `${orphan.length} observations without a captured source` : "Every observation links to a captured source" });
}

/**
 * Grounding: re-read each stored capture, confirm its hash, and confirm each observation's
 * excerpt and value literally occur in it. This checks extraction fidelity, not truth.
 */
export function checkGrounding(m: Mission, io: VerifierIO, add: Add): Map<string, { check: ObservationCheck; note: string }> {
  const results = new Map<string, { check: ObservationCheck; note: string }>();
  const texts = new Map<string, string | null>();
  for (const s of m.sources.filter((x) => x.ok && x.textFile)) {
    try {
      const buf = fs.readFileSync(io.resolve(s.textFile!));
      texts.set(s.id, sha256(buf) === s.textSha256 ? normalizeWs(buf.toString("utf8")).toLowerCase() : null);
    } catch {
      texts.set(s.id, null);
    }
  }
  const tampered = [...texts.values()].filter((v) => v === null).length;
  add({ scope: "grounding", name: "Stored captures intact", status: tampered ? "failed" : texts.size ? "passed" : "warning", detail: tampered ? `${tampered} capture files missing or modified` : `${texts.size} capture files hash-verified` });
  let grounded = 0;
  let ungrounded = 0;
  for (const o of m.observations) {
    if (o.kind === "observation") {
      const t = o.sourceId ? texts.get(o.sourceId) : undefined;
      const ex = normalizeWs(o.excerpt ?? "").toLowerCase();
      const val = normalizeWs(o.value).toLowerCase();
      if (!t || !ex) {
        results.set(o.id, { check: "ungrounded", note: "Capture unavailable for re-check" });
        ungrounded++;
      } else if (t.includes(ex) && (ex.includes(val) || o.field === "free_tier")) {
        results.set(o.id, { check: "grounded", note: "Excerpt found verbatim in stored capture" });
        grounded++;
      } else {
        results.set(o.id, { check: "ungrounded", note: "Excerpt or value not found in stored capture" });
        ungrounded++;
      }
    } else if (o.kind === "inference") {
      const basisOk = (o.basis ?? []).every((b) => m.observations.some((x) => x.id === b));
      results.set(o.id, { check: "needs_review", note: basisOk ? "Inference with resolvable basis; requires human review" : "Inference references unknown observations" });
    }
  }
  add({
    scope: "grounding",
    name: "Observations grounded in captures",
    status: ungrounded ? "failed" : grounded ? "passed" : "warning",
    detail: `${grounded} grounded, ${ungrounded} ungrounded`,
  });
  return results;
}

export async function runVerification(
  m: Mission,
  io: VerifierIO,
  filenames: string[],
): Promise<{ checks: CheckResult[]; perArtifact: Map<string, CheckResult["status"]>; observationChecks: Map<string, { check: ObservationCheck; note: string }>; renderShot?: string }> {
  const checks: CheckResult[] = [];
  const add: Add = (c) => checks.push({ id: newId("chk"), ...c });
  let renderShot: string | undefined;
  for (const name of filenames) {
    const a = m.artifacts.find((x) => x.filename === name);
    if (!a) {
      add({ scope: "integrity", name: `Artifact ${name} produced`, status: "failed", detail: "The writer step did not produce this artifact" });
      continue;
    }
    const text = readBack(a, io, add);
    if (text === undefined) continue;
    if (a.kind === "csv") verifyCsv(a, text, m, add);
    else if (a.kind === "markdown") verifyReport(a, text, m, add);
    else if (a.kind === "html") renderShot = (await verifyLanding(a, text, m, add, io)) ?? renderShot;
    else if (a.kind === "json") verifyEvidenceJson(a, text, m, add);
  }
  const observationChecks = checkGrounding(m, io, add);
  await checkScreenshots(m, io, add);
  const perArtifact = new Map<string, CheckResult["status"]>();
  for (const c of checks) {
    if (!c.artifactId) continue;
    const prev = perArtifact.get(c.artifactId);
    if (c.status === "failed" || prev === "failed") perArtifact.set(c.artifactId, "failed");
    else if (c.status === "warning" || prev === "warning") perArtifact.set(c.artifactId, "warning");
    else perArtifact.set(c.artifactId, "passed");
  }
  return { checks, perArtifact, observationChecks, renderShot };
}

export function computeSummary(m: Mission): VerificationSummary {
  const targets = (m.plan?.targets ?? []).filter((t) => t.enabled);
  const okSources = m.sources.filter((s) => s.ok && s.targetId !== "manual");
  const attempted = m.sources.filter((s) => s.targetId !== "manual");
  const withCapture = new Set(okSources.map((s) => s.targetId));
  const obsFor = (field: string) => new Set(m.observations.filter((o) => o.field === field && o.kind === "observation").map((o) => o.targetId));
  const priced = obsFor("displayed_price");
  const observations = m.observations.filter((o: Observation) => o.kind === "observation");
  return {
    generatedAt: nowIso(),
    sourcesAttempted: attempted.length,
    sourcesCaptured: okSources.length,
    sourcesFailed: attempted.length - okSources.length,
    targetsTotal: targets.length,
    targetsWithAnyCapture: targets.filter((t) => withCapture.has(t.id)).length,
    descriptionsFound: targets.filter((t) => obsFor("official_description").has(t.id)).length,
    pricesFound: targets.filter((t) => priced.has(t.id)).length,
    pricesUnavailable: targets.filter((t) => !priced.has(t.id)).length,
    observationsTotal: observations.length,
    observationsGrounded: observations.filter((o) => o.check === "grounded").length,
    observationsUngrounded: observations.filter((o) => o.check === "ungrounded").length,
    inferences: m.observations.filter((o) => o.kind === "inference").length,
    claimsNeedingReview: m.observations.filter((o) => o.check === "needs_review").length,
    artifactsChecked: new Set(m.checks.filter((c) => c.artifactId).map((c) => c.artifactId)).size,
    checksPassed: m.checks.filter((c) => c.status === "passed").length,
    checksFailed: m.checks.filter((c) => c.status === "failed").length,
    checksWarned: m.checks.filter((c) => c.status === "warning").length,
    integrityNote: "Artifact checks prove the files are well-formed, complete and traceable to captured pages. They do not prove the vendors' claims are true or current.",
  };
}
