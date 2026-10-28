// Judge-facing view model of a finished mission. Everything here is derived from the mission record:
// no finding, price or citation exists unless an observation with a source URL and a verbatim excerpt backs it.
import type { Analysis, CompetitorProfile, Mission, Observation, SourceCapture } from "./api";

export interface Evidence {
  obsId: string;
  targetName: string;
  field: string;
  value: string;
  kind: Observation["kind"];
  check: Observation["check"];
  checkNote?: string;
  method: string;
  sourceUrl?: string;
  pageTitle?: string;
  capturedAt?: string;
  excerpt?: string;
  /** Mission-relative files of the capture the observation came from. */
  screenshotFile?: string;
  textFile?: string;
  /** Observation ids an inference rests on. */
  basis: string[];
}

export interface Finding {
  targetName: string;
  text: string;
  evidence: Evidence;
}

export type PricingState = "prices" | "not_found" | "inaccessible";

export interface PricingCell {
  state: PricingState;
  prices: Evidence[];
  /** A "Free plan" style line seen on the page. Not the same as a $0 price, and never derived from one. */
  freeOption?: Evidence;
  /** Displayed prices whose amount is zero, shown as the page shows them. */
  zeroPrices: Evidence[];
  /** Plan and price pairs Claude read from a pricing screenshot. Inferences: the pairing needs review. */
  plans: Evidence[];
}

export interface CompetitorCard {
  targetId: string;
  name: string;
  status: CompetitorProfile["status"];
  primaryUrl: string;
  pagesCaptured: number;
  pagesAttempted: number;
  headline?: Evidence;
  description?: Evidence;
  features: Evidence[];
  pricing: PricingCell;
  audiences: Evidence[];
  screenshotFile?: string;
  failures: { url: string; error: string }[];
}

export interface FeatureRow {
  label: string;
  /** Keyed by targetId: the observation that states it, or null when it was not seen on that competitor's captured pages. */
  cells: Record<string, Evidence | null>;
}

export interface VisionFacts {
  model: string;
  pagesRead: number;
  kept: number;
  discarded: number;
  failed: number;
  costUsd?: number;
}

export interface VerificationFacts {
  pagesCaptured: number;
  pagesAttempted: number;
  artifactsVerified: number;
  artifactsTotal: number;
  checksPassed: number;
  checksFailed: number;
  checksWarned: number;
  observationsGrounded: number;
  observationsTotal: number;
  observationsUngrounded: number;
  inferences: number;
  needsReview: number;
  vision?: VisionFacts;
}

export interface Dashboard {
  objective: string;
  analysisBy: Analysis["generatedBy"];
  dataSource: "live" | "fixture";
  capturedAt?: string;
  findings: Finding[];
  limitations: string[];
  conclusion: { text: string; by: "rules" | "claude" };
  cards: CompetitorCard[];
  features: FeatureRow[];
  verification: VerificationFacts;
}

export const INTEGRITY_DISCLAIMER =
  "Artifact checks confirm that the files are intact and well formed and that quoted excerpts match the stored page captures. They do not establish that vendor claims are true, complete or still current.";

const MAX_FEATURE_ROWS = 10;

export function isDisplayed(status: Mission["status"]): boolean {
  return status === "completed" || status === "completed_with_warnings";
}

export function evidenceIndex(m: Mission): Map<string, Evidence> {
  const sources = new Map<string, SourceCapture>(m.sources.map((s) => [s.id, s]));
  return new Map(
    m.observations.map((o) => {
      const src = o.sourceId ? sources.get(o.sourceId) : undefined;
      const e: Evidence = {
        obsId: o.id,
        targetName: o.targetName,
        field: o.field,
        value: o.value,
        kind: o.kind,
        check: o.check,
        checkNote: o.checkNote,
        method: o.method,
        sourceUrl: o.sourceUrl,
        pageTitle: o.pageTitle,
        capturedAt: o.capturedAt,
        excerpt: o.excerpt,
        screenshotFile: src?.screenshotFile,
        textFile: src?.textFile,
        basis: o.basis ?? [],
      };
      return [o.id, e];
    }),
  );
}

/** A quoted fact: an observation with a source and an excerpt that re-matching did not reject. */
export function isCitable(e: Evidence | undefined): e is Evidence {
  return Boolean(e && e.kind === "observation" && e.sourceUrl && e.excerpt && e.check !== "ungrounded");
}

/** Numeric amount of a displayed price such as "$0", "€0.00/mo" or "0 USD"; undefined when none is readable. */
export function priceAmount(value: string): number | undefined {
  const m = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (cards: CompetitorCard[]) => cards.map((c) => c.name).join(", ");

export function buildDashboard(m: Mission): Dashboard | undefined {
  const a = m.analysis as Analysis | undefined;
  if (!a) return undefined;
  const ev = evidenceIndex(m);
  const get = (id?: string) => (id ? ev.get(id) : undefined);

  const cards: CompetitorCard[] = a.profiles.map((p) => {
    const sources = m.sources.filter((s) => s.targetId === p.targetId);
    const prices = p.prices.map((c) => get(c.obsId)).filter(isCitable);
    const freeOption = get(p.freeTier?.obsId);
    const state: PricingState = p.status === "inaccessible" ? "inaccessible" : prices.length ? "prices" : "not_found";
    return {
      targetId: p.targetId,
      name: p.name,
      status: p.status,
      primaryUrl: p.primaryUrl,
      pagesCaptured: p.sourcesCaptured,
      pagesAttempted: p.sourcesAttempted,
      headline: isCitable(get(p.headline?.obsId)) ? get(p.headline?.obsId) : undefined,
      description: isCitable(get(p.description?.obsId)) ? get(p.description?.obsId) : undefined,
      features: p.claims.map((c) => get(c.obsId)).filter(isCitable),
      pricing: {
        state,
        prices,
        freeOption: isCitable(freeOption) ? freeOption : undefined,
        zeroPrices: prices.filter((x) => priceAmount(x.value) === 0),
        plans: m.observations.filter((o) => o.targetId === p.targetId && o.field === "plan_price" && o.sourceUrl && o.excerpt).map((o) => ev.get(o.id)!),
      },
      audiences: p.audiences.map((c) => get(c.obsId)).filter((x): x is Evidence => Boolean(x)),
      screenshotFile: sources.find((s) => s.ok && s.screenshotFile)?.screenshotFile,
      failures: sources.filter((s) => !s.ok).map((s) => ({ url: s.requestedUrl, error: s.error ?? "Not captured" })),
    };
  });

  return {
    objective: m.plan?.objective ?? m.prompt,
    analysisBy: a.generatedBy,
    dataSource: m.dataSource ?? "live",
    capturedAt: m.sources.filter((s) => s.ok).map((s) => s.capturedAt).sort()[0],
    findings: pickFindings(cards),
    limitations: limitations(m, cards),
    conclusion: conclusion(m, a, cards),
    cards,
    features: featureRows(cards),
    verification: verificationFacts(m),
  };
}

/**
 * Up to three quoted facts, one per competitor while competitors remain: displayed pricing first,
 * then a free option, then the vendor's own description. Nothing is ranked by guesswork about importance.
 */
export function pickFindings(cards: CompetitorCard[], max = 3): Finding[] {
  const candidates: (Finding & { rank: number; order: number })[] = [];
  cards.forEach((c, order) => {
    const p = c.pricing;
    if (p.prices.length) {
      const shown = p.prices.slice(0, 3).map((x) => x.value).join(", ");
      candidates.push({ rank: 0, order, targetName: c.name, evidence: p.prices[0], text: `${c.name} displays ${plural(p.prices.length, "price")} on its captured pages: ${shown}${p.prices.length > 3 ? ", …" : ""}.` });
    }
    if (p.freeOption) candidates.push({ rank: 1, order, targetName: c.name, evidence: p.freeOption, text: `${c.name} shows a free option on its captured pages.` });
    const self = c.description ?? c.headline;
    if (self) candidates.push({ rank: 2, order, targetName: c.name, evidence: self, text: `${c.name} describes itself as “${clip(self.value)}”` });
  });
  candidates.sort((x, y) => x.rank - y.rank || x.order - y.order);
  const out: Finding[] = [];
  const used = new Set<string>();
  for (const pass of [true, false]) {
    for (const c of candidates) {
      if (out.length >= max) break;
      if (out.some((f) => f.evidence.obsId === c.evidence.obsId)) continue;
      if (pass && used.has(c.targetName)) continue;
      used.add(c.targetName);
      out.push({ targetName: c.targetName, text: c.text, evidence: c.evidence });
    }
  }
  return out;
}

export function limitations(m: Mission, cards: CompetitorCard[]): string[] {
  const out: string[] = [];
  const s = m.summary;
  if ((m.dataSource ?? "live") === "fixture") out.push("Offline demo: fixture pages from fictional vendors served on this machine. This is not live research.");
  const failed = m.sources.filter((x) => !x.ok && x.targetId !== "manual");
  if (failed.length) {
    const shown = failed.slice(0, 3).map((x) => `${x.targetName} (${x.error ?? "not captured"})`).join("; ");
    out.push(`${plural(failed.length, "page")} could not be captured: ${shown}${failed.length > 3 ? "; …" : ""}.`);
  }
  const inaccessible = cards.filter((c) => c.pricing.state === "inaccessible");
  if (inaccessible.length) out.push(`No page was captured for ${names(inaccessible)}, so nothing is known about ${inaccessible.length === 1 ? "it" : "them"} from this run.`);
  const noPrice = cards.filter((c) => c.pricing.state === "not_found");
  if (noPrice.length) out.push(`No price was displayed on the captured pages of ${names(noPrice)}. A missing price is unknown, not free and not $0.`);
  const review = s?.claimsNeedingReview ?? m.observations.filter((o) => o.check === "needs_review").length;
  if (review) out.push(`${plural(review, "inference")} (audience signals, positioning, market gaps) ${review === 1 ? "is a heuristic" : "are heuristics"} awaiting human review.`);
  const plans = cards.reduce((n, c) => n + c.pricing.plans.length, 0);
  if (plans) out.push(`${plural(plans, "plan and price pairing")} ${plans === 1 ? "was" : "were"} read from screenshots by Claude. The plan and price text is on the captured page, but the pairing is the model's reading and needs review.`);
  const ungrounded = s?.observationsUngrounded ?? m.observations.filter((o) => o.check === "ungrounded").length;
  if (ungrounded) out.push(`${plural(ungrounded, "quoted value")} could not be re-matched against the stored captures and ${ungrounded === 1 ? "is" : "are"} excluded from the findings.`);
  out.push("Vendor pages change. Findings describe the pages at capture time and repeat what vendors say about themselves.");
  return out;
}

export function conclusion(m: Mission, a: Analysis, cards: CompetitorCard[]): Dashboard["conclusion"] {
  // Claude-written text is shown only when Claude produced it in this run, and is labelled as such.
  const claudeGap = a.generatedBy === "claude" ? a.gaps.find((g) => g.by === "claude") : undefined;
  if (claudeGap) return { by: "claude", text: claudeGap.statement };
  const captured = cards.filter((c) => c.status !== "inaccessible");
  const priced = cards.filter((c) => c.pricing.state === "prices");
  const noPrice = cards.filter((c) => c.pricing.state === "not_found");
  const s = m.summary;
  const parts = [`Compared ${plural(cards.length, "competitor")}; ${captured.length} had at least one captured page${s ? ` (${s.sourcesCaptured} of ${s.sourcesAttempted} pages overall)` : ""}.`];
  if (priced.length) parts.push(`Displayed prices were found for ${names(priced)}.`);
  if (noPrice.length) parts.push(`No price was found for ${names(noPrice)}.`);
  parts.push("Comparisons rest on quoted vendor pages; audience and positioning statements are heuristic inferences.");
  return { by: "rules", text: parts.join(" ") };
}

/** Vendor-stated features (page headings), one row each. A blank cell means "not seen", never "does not have". */
export function featureRows(cards: CompetitorCard[]): FeatureRow[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const rows = new Map<string, FeatureRow>();
  const longest = Math.max(0, ...cards.map((c) => c.features.length));
  // Round robin across competitors so one vendor's headings cannot crowd out the others.
  for (let i = 0; i < longest && rows.size < MAX_FEATURE_ROWS; i++) {
    for (const c of cards) {
      const f = c.features[i];
      if (!f || rows.size >= MAX_FEATURE_ROWS) continue;
      const key = norm(f.value);
      const row = rows.get(key) ?? { label: f.value, cells: Object.fromEntries(cards.map((x) => [x.targetId, null])) };
      row.cells[c.targetId] ??= f;
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

export function verificationFacts(m: Mission): VerificationFacts {
  const s = m.summary;
  const obs = m.observations;
  return {
    pagesCaptured: s?.sourcesCaptured ?? m.sources.filter((x) => x.ok).length,
    pagesAttempted: s?.sourcesAttempted ?? m.sources.length,
    artifactsVerified: m.artifacts.filter((x) => x.verification === "passed").length,
    artifactsTotal: m.artifacts.length,
    checksPassed: s?.checksPassed ?? m.checks.filter((c) => c.status === "passed").length,
    checksFailed: s?.checksFailed ?? m.checks.filter((c) => c.status === "failed").length,
    checksWarned: s?.checksWarned ?? m.checks.filter((c) => c.status === "warning").length,
    observationsGrounded: s?.observationsGrounded ?? obs.filter((o) => o.check === "grounded").length,
    observationsTotal: s?.observationsTotal ?? obs.length,
    observationsUngrounded: s?.observationsUngrounded ?? obs.filter((o) => o.check === "ungrounded").length,
    inferences: s?.inferences ?? obs.filter((o) => o.kind === "inference").length,
    needsReview: s?.claimsNeedingReview ?? obs.filter((o) => o.check === "needs_review").length,
    vision: m.visionRuns?.length
      ? {
          model: m.visionRuns[m.visionRuns.length - 1].model,
          pagesRead: m.visionRuns.reduce((n, r) => n + r.pages.filter((p) => !p.error).length, 0),
          kept: m.visionRuns.reduce((n, r) => n + r.pages.reduce((k, p) => k + p.kept, 0), 0),
          discarded: m.visionRuns.reduce((n, r) => n + r.pages.reduce((k, p) => k + p.discarded.length, 0), 0),
          failed: m.visionRuns.reduce((n, r) => n + r.pages.filter((p) => p.error).length, 0),
          costUsd: m.visionRuns.every((r) => r.costUsd !== undefined) ? m.visionRuns.reduce((n, r) => n + (r.costUsd ?? 0), 0) : undefined,
        }
      : undefined,
  };
}

/** Same selection as the server's pricingPages(): captured pages with a screenshot that look like pricing. */
export function pricingScreenshots(m: Mission): SourceCapture[] {
  const priced = new Set(m.observations.filter((o) => o.field === "displayed_price").map((o) => o.sourceId));
  return m.sources
    .filter((s) => s.ok && s.screenshotFile && s.textFile && s.targetId !== "manual")
    .filter((s) => /pric|plan/i.test(s.finalUrl ?? s.requestedUrl) || priced.has(s.id))
    .slice(0, 6);
}
