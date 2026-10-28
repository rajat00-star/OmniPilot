import { z } from "zod";
import { AUDIENCE_LEXICON } from "./extraction.js";
import { newId } from "./store.js";
import type { Mission, Observation, Target } from "./types.js";
import { structured, untrusted, UNTRUSTED_POLICY, type ClaudeCallOptions } from "../llm/claude.js";

export interface Cited {
  value: string;
  obsId: string;
  sourceUrl?: string;
  excerpt?: string;
}

export interface CompetitorProfile {
  targetId: string;
  name: string;
  status: "captured" | "partial" | "inaccessible";
  primaryUrl: string;
  pageTitle?: string;
  capturedAt?: string;
  sourcesCaptured: number;
  sourcesAttempted: number;
  description?: Cited;
  headline?: Cited;
  prices: Cited[];
  pricingStatus: "Found" | "Not found" | "Source inaccessible";
  freeTier?: Cited;
  audiences: Cited[];
  claims: Cited[];
  positioning?: { text: string; basis: string[]; by: "rules" | "claude" };
  differentiators: { text: string; basis: string[]; by: "rules" | "claude" }[];
}

export interface MarketGap {
  id: string;
  statement: string;
  rationale: string;
  basis: string[];
  confidence: "low" | "medium";
  by: "rules" | "claude";
}

export interface LandingCopy {
  headline: string;
  subheadline: string;
  valueProps: { title: string; body: string; gapId?: string }[];
  pricingAngle: string;
  cta: string;
  by: "rules" | "claude";
}

export interface Analysis {
  generatedBy: "rules" | "claude";
  generatedAt: string;
  productName: string;
  productPitch: string;
  profiles: CompetitorProfile[];
  gaps: MarketGap[];
  landing: LandingCopy;
  notes: string[];
  rejectedModelClaims: number;
}

function cite(o: Observation): Cited {
  return { value: o.value, obsId: o.id, sourceUrl: o.sourceUrl, excerpt: o.excerpt };
}

export function buildProfiles(m: Mission): CompetitorProfile[] {
  const targets: Target[] = (m.plan?.targets ?? []).filter((t) => t.enabled);
  return targets.map((t) => {
    const sources = m.sources.filter((s) => s.targetId === t.id);
    const okSources = sources.filter((s) => s.ok);
    const obs = m.observations.filter((o) => o.targetId === t.id && o.kind !== "inference");
    const inf = m.observations.filter((o) => o.targetId === t.id && o.kind === "inference");
    const first = (field: string) => obs.find((o) => o.field === field);
    const prices = obs.filter((o) => o.field === "displayed_price").map(cite);
    const desc = first("official_description");
    // Prefer a descriptive headline over page labels such as "Pricing".
    const headlines = obs.filter((o) => o.field === "headline");
    const headline = headlines.find((o) => o.value.split(/\s+/).length >= 3) ?? headlines[0];
    const status: CompetitorProfile["status"] = okSources.length === 0 ? "inaccessible" : okSources.length < sources.length ? "partial" : "captured";
    const claims = obs.filter((o) => o.field === "vendor_claim").map(cite);
    const p: CompetitorProfile = {
      targetId: t.id,
      name: t.name,
      status,
      primaryUrl: okSources[0]?.finalUrl ?? t.urls[0],
      pageTitle: okSources[0]?.title,
      capturedAt: okSources[0]?.capturedAt,
      sourcesCaptured: okSources.length,
      sourcesAttempted: sources.length,
      description: desc && cite(desc),
      headline: headline && cite(headline),
      prices,
      pricingStatus: status === "inaccessible" ? "Source inaccessible" : prices.length ? "Found" : "Not found",
      freeTier: first("free_tier") && cite(first("free_tier")!),
      audiences: [...new Map(inf.filter((o) => o.field === "target_audience").map((o) => [o.value, cite(o)])).values()].slice(0, 3),
      claims: [...new Map(claims.map((c) => [c.value, c])).values()].slice(0, 5),
      differentiators: [],
    };
    if (headline || desc) {
      const basis = [headline?.id, desc?.id].filter(Boolean) as string[];
      p.positioning = {
        text: headline ? `Leads with "${headline.value}"${desc ? `; describes itself as: ${desc.value}` : ""}` : `Describes itself as: ${desc!.value}`,
        basis,
        by: "rules",
      };
    }
    p.differentiators = p.claims.slice(0, 3).map((c) => ({ text: `Vendor-stated: ${c.value}`, basis: [c.obsId], by: "rules" as const }));
    return p;
  });
}

export function deterministicGaps(profiles: CompetitorProfile[]): MarketGap[] {
  const captured = profiles.filter((p) => p.status !== "inaccessible");
  const gaps: MarketGap[] = [];
  if (captured.length === 0) return gaps;
  const n = captured.length;
  for (const audience of Object.keys(AUDIENCE_LEXICON)) {
    const mentioning = captured.filter((p) => p.audiences.some((a) => a.value === audience));
    if (mentioning.length <= Math.floor(n / 3)) {
      gaps.push({
        id: newId("gap"),
        statement: `"${audience}" appears under-addressed: only ${mentioning.length} of ${n} captured competitor pages show it among their top audience signals.`,
        rationale: "Computed from keyword audience signals on captured pages. Absence of a keyword is weak evidence; review before relying on it.",
        basis: captured.flatMap((p) => p.audiences.map((a) => a.obsId)),
        confidence: "low",
        by: "rules",
      });
    }
  }
  const noPrice = captured.filter((p) => p.pricingStatus === "Not found");
  if (noPrice.length > 0) {
    gaps.push({
      id: newId("gap"),
      statement: `Pricing transparency: ${noPrice.length} of ${n} captured competitors did not display a price on the captured pages (${noPrice.map((p) => p.name).join(", ")}).`,
      rationale: "A product with clear, public pricing could differentiate on transparency. Prices may exist on pages that were not captured.",
      basis: noPrice.flatMap((p) => [p.description?.obsId, p.headline?.obsId].filter(Boolean) as string[]),
      confidence: "low",
      by: "rules",
    });
  }
  const noFree = captured.filter((p) => !p.freeTier);
  if (noFree.length > 0 && noFree.length < n) {
    gaps.push({
      id: newId("gap"),
      statement: `Entry-level access: ${n - noFree.length} of ${n} captured competitors display a free option; ${noFree.map((p) => p.name).join(", ")} did not on captured pages.`,
      rationale: "Indicates where a free or trial tier is (or is not) used as a wedge.",
      basis: captured.filter((p) => p.freeTier).map((p) => p.freeTier!.obsId),
      confidence: "medium",
      by: "rules",
    });
  }
  // Keep the strongest few; under-addressed audiences are capped so the list stays readable.
  const audienceGaps = gaps.filter((g) => g.statement.startsWith('"')).slice(0, 3);
  return [...gaps.filter((g) => !g.statement.startsWith('"')), ...audienceGaps];
}

export function deterministicLanding(productName: string, pitch: string, gaps: MarketGap[], profiles: CompetitorProfile[]): LandingCopy {
  const top = gaps[0];
  const audienceGap = gaps.find((g) => g.statement.startsWith('"'));
  const audience = audienceGap?.statement.match(/^"([^"]+)"/)?.[1];
  const priced = profiles.flatMap((p) => p.prices.map((x) => x.value));
  return {
    headline: audience ? `${productName}: the AI workspace built for ${audience.toLowerCase()}` : `${productName}: AI work you can verify`,
    subheadline: pitch || "Every answer comes with its sources, every output is checked, and nothing is claimed that was not observed.",
    valueProps: [
      ...(audienceGap ? [{ title: `Made for ${audience}`, body: "Workflows, defaults and examples designed for this audience from day one.", gapId: audienceGap.id }] : []),
      ...(top && top !== audienceGap ? [{ title: "Positioned on an observed gap", body: top.statement, gapId: top.id }] : []),
      { title: "Evidence, not assertions", body: "Outputs link to the exact source pages they came from, with capture time and excerpt." },
      { title: "Verified deliverables", body: "Files are read back and checked before they are handed over." },
    ].slice(0, 4),
    pricingAngle: priced.length
      ? `Competitor list prices observed on captured pages include ${[...new Set(priced)].slice(0, 5).join(", ")}. Price ${productName} transparently and publish it on the page.`
      : `No competitor prices were captured, so no price anchor is suggested. Publish ${productName}'s pricing openly.`,
    cta: `Join the ${productName} early access list`,
    by: "rules",
  };
}

// ---------- Claude synthesis ----------

const ClaudeAnalysisSchema = z.object({
  competitors: z.array(
    z.object({
      target_id: z.string(),
      positioning: z.string(),
      positioning_evidence_ids: z.array(z.string()),
      differentiators: z.array(z.object({ text: z.string(), evidence_ids: z.array(z.string()) })),
    }),
  ),
  market_gaps: z.array(
    z.object({
      statement: z.string(),
      rationale: z.string(),
      evidence_ids: z.array(z.string()),
      confidence: z.enum(["low", "medium"]),
    }),
  ),
  landing: z.object({
    headline: z.string(),
    subheadline: z.string(),
    value_props: z.array(z.object({ title: z.string(), body: z.string(), gap_index: z.number() })),
    pricing_angle: z.string(),
    cta: z.string(),
  }),
});

/**
 * Evidence-grounded synthesis. Claude only sees observation ids, fields and quoted values;
 * every claim must cite ids we hold. Uncited or mis-cited claims are dropped and counted.
 */
export async function claudeAnalysis(
  m: Mission,
  profiles: CompetitorProfile[],
  productName: string,
  pitch: string,
  signal?: AbortSignal,
  llm: ClaudeCallOptions = {},
): Promise<Omit<Analysis, "generatedAt">> {
  const known = new Set(m.observations.map((o) => o.id));
  const evidence = m.observations
    .filter((o) => o.targetId !== "manual")
    .map((o) => `${o.id} | target=${o.targetId} | ${o.kind} | ${o.field} | ${o.value.slice(0, 300)}`)
    .join("\n");
  const inaccessible = profiles.filter((p) => p.status === "inaccessible").map((p) => p.name);
  const out = await structured({
    schema: ClaudeAnalysisSchema,
    signal,
    ...llm,
    system: [
      "You are the synthesis module of OmniPilot. Compare competitors using ONLY the evidence lines provided.",
      "Every positioning statement, differentiator and market gap must cite evidence ids from the list. Do not cite ids that are not listed. Do not invent prices, features or audiences.",
      "Positioning and gaps are inferences: phrase them as such. If evidence is thin, say so and use confidence 'low'.",
      "The landing page copy is a concept for the user's hypothetical product; ground its angle in the market gaps (gap_index refers to market_gaps order, -1 if none).",
      UNTRUSTED_POLICY,
    ].join("\n"),
    user: [
      `Hypothetical product: ${productName}${pitch ? ` — ${pitch}` : ""}`,
      `Targets: ${profiles.map((p) => `${p.targetId} (${p.name}, ${p.status})`).join(", ")}`,
      inaccessible.length ? `Inaccessible (no evidence, treat as unknown): ${inaccessible.join(", ")}` : "",
      untrusted("captured-observations", evidence),
    ].join("\n\n"),
  });
  let rejected = 0;
  const keep = (ids: string[]) => {
    const valid = ids.filter((id) => known.has(id));
    return valid;
  };
  const byTarget = new Map(out.competitors.map((c) => [c.target_id, c]));
  const merged = profiles.map((p) => {
    const c = byTarget.get(p.targetId);
    if (!c || p.status === "inaccessible") return p;
    const posBasis = keep(c.positioning_evidence_ids);
    const next = { ...p };
    if (posBasis.length) next.positioning = { text: c.positioning, basis: posBasis, by: "claude" as const };
    else rejected++;
    const diffs = c.differentiators
      .map((d) => ({ text: d.text, basis: keep(d.evidence_ids), by: "claude" as const }))
      .filter((d) => (d.basis.length ? true : (rejected++, false)));
    if (diffs.length) next.differentiators = diffs.slice(0, 4);
    return next;
  });
  const gaps: MarketGap[] = [];
  for (const g of out.market_gaps.slice(0, 6)) {
    const basis = keep(g.evidence_ids);
    if (!basis.length) {
      rejected++;
      continue;
    }
    gaps.push({ id: newId("gap"), statement: g.statement, rationale: g.rationale, basis, confidence: g.confidence, by: "claude" });
  }
  const landing: LandingCopy = {
    headline: out.landing.headline.slice(0, 140),
    subheadline: out.landing.subheadline.slice(0, 300),
    valueProps: out.landing.value_props.slice(0, 4).map((v) => ({
      title: v.title.slice(0, 80),
      body: v.body.slice(0, 300),
      gapId: v.gap_index >= 0 ? gaps[v.gap_index]?.id : undefined,
    })),
    pricingAngle: out.landing.pricing_angle.slice(0, 400),
    cta: out.landing.cta.slice(0, 60),
    by: "claude",
  };
  return {
    generatedBy: "claude",
    productName,
    productPitch: pitch,
    profiles: merged,
    gaps,
    landing,
    notes: [`Claude synthesis cited ${gaps.reduce((n, g) => n + g.basis.length, 0)} evidence references across ${gaps.length} gaps.`],
    rejectedModelClaims: rejected,
  };
}

export function deterministicAnalysis(m: Mission, productName: string, pitch: string): Omit<Analysis, "generatedAt"> {
  const profiles = buildProfiles(m);
  const gaps = deterministicGaps(profiles);
  return {
    generatedBy: "rules",
    productName,
    productPitch: pitch,
    profiles,
    gaps,
    landing: deterministicLanding(productName, pitch, gaps, profiles),
    notes: [
      "Deterministic mode: positioning summaries restate captured headlines and descriptions; audiences come from keyword signals; gaps are computed by counting signals across competitors. No AI reasoning was used.",
    ],
    rejectedModelClaims: 0,
  };
}

/** Record analysis inferences as observations so they appear in the evidence ledger. */
export function inferenceObservations(a: Analysis): Observation[] {
  const out: Observation[] = [];
  for (const p of a.profiles) {
    if (p.positioning) {
      out.push({
        id: newId("inf"),
        targetId: p.targetId,
        targetName: p.name,
        field: "positioning",
        value: p.positioning.text,
        kind: "inference",
        method: p.positioning.by === "claude" ? "claude:synthesis" : "rules:restate-headline",
        basis: p.positioning.basis,
        check: "needs_review",
      });
    }
    if (p.pricingStatus !== "Found") {
      out.push({
        id: newId("unk"),
        targetId: p.targetId,
        targetName: p.name,
        field: "displayed_price",
        value: p.pricingStatus === "Source inaccessible" ? "Unknown (source inaccessible)" : "Not found on captured pages",
        kind: "unknown",
        method: "absence",
        check: "unverified",
      });
    }
  }
  for (const g of a.gaps) {
    out.push({
      id: g.id,
      targetId: "market",
      targetName: "Market",
      field: "market_gap",
      value: g.statement,
      kind: "inference",
      method: g.by === "claude" ? "claude:synthesis" : "rules:signal-count",
      basis: g.basis,
      check: "needs_review",
    });
  }
  return out;
}
