import type { PageSnapshot } from "../browser/browserManager.js";
import type { Observation, SourceCapture } from "./types.js";
import { newId } from "./store.js";

/**
 * The capture document is what we store on disk for each page. Everything an observation
 * quotes must appear in this text, which lets the verifier re-check grounding from disk.
 */
export function buildCaptureDocument(s: PageSnapshot, capturedAt: string): string {
  const lines = [
    `URL: ${s.finalUrl}`,
    `REQUESTED_URL: ${s.requestedUrl}`,
    `CAPTURED_AT: ${capturedAt}`,
    `HTTP_STATUS: ${s.httpStatus ?? "unknown"}`,
    `TITLE: ${s.title}`,
    `META_DESCRIPTION: ${s.metaDescription}`,
    `OG_TITLE: ${s.ogTitle}`,
    `OG_DESCRIPTION: ${s.ogDescription}`,
    `CANONICAL: ${s.canonical}`,
    ...s.h1.map((h) => `H1: ${h}`),
    ...s.h2.map((h) => `H2: ${h}`),
    ...s.h3.map((h) => `H3: ${h}`),
    "---- VISIBLE TEXT ----",
    s.visibleText,
  ];
  return lines.join("\n");
}

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Prices like $20, $20/month, US$8.50 per user / month, €18/mo, £15 per seat.
const PRICE_RE =
  /(?:US\$|\$|€|£)\s?\d{1,5}(?:[.,]\d{1,2})?(?:\s?(?:\/|per)\s?(?:user|seat|member|editor)?\s?(?:\/|per)?\s?(?:mo(?:nth)?|yr|year|annually|monthly))?/gi;

export interface PricePoint {
  value: string;
  line: string;
}

export function findPrices(visibleText: string, max = 6): PricePoint[] {
  const out: PricePoint[] = [];
  const seen = new Set<string>();
  for (const rawLine of visibleText.split(/\n+/)) {
    const line = normalizeWs(rawLine);
    if (!line || line.length > 300) continue;
    for (const m of line.matchAll(PRICE_RE)) {
      const value = normalizeWs(m[0]);
      // Ignore bare numbers that are clearly not prices, e.g. "$0" in marketing stats is still a price; keep it.
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value, line });
      if (out.length >= max) return out;
    }
  }
  return out;
}

export function findFreeTier(visibleText: string): string | undefined {
  for (const rawLine of visibleText.split(/\n+/)) {
    const line = normalizeWs(rawLine);
    if (line.length > 160) continue;
    if (/^(free|free plan|free tier|start for free|try (it )?for free|get started for free|free forever)\b/i.test(line)) return line;
  }
  return undefined;
}

export const AUDIENCE_LEXICON: Record<string, RegExp> = {
  "Developers & engineers": /\b(developers?|engineers?|engineering teams?|coding|codebases?|API)\b/i,
  "Enterprises": /\b(enterprises?|enterprise-grade|organi[sz]ations?|SSO|SOC ?2|compliance)\b/i,
  "Teams & collaboration": /\b(teams?|collaborat\w*|workspaces?)\b/i,
  "Individuals & professionals": /\b(individuals?|personal|professionals?|freelancers?)\b/i,
  "Students & education": /\b(students?|education|learners?|teachers?|universit\w+)\b/i,
  "Marketing & content": /\b(marketers?|marketing|content creators?|copywriting|brand voice)\b/i,
  "Research & analysis": /\b(research\w*|analys\w+|insights?|data analysis)\b/i,
  "Sales & support": /\b(sales|customer support|customer service|support teams?)\b/i,
};

export function findAudienceSignals(visibleText: string): { audience: string; count: number; line: string }[] {
  const lines = visibleText.split(/\n+/).map(normalizeWs).filter((l) => l.length > 8 && l.length < 260);
  const res: { audience: string; count: number; line: string }[] = [];
  for (const [audience, re] of Object.entries(AUDIENCE_LEXICON)) {
    const matching = lines.filter((l) => re.test(l));
    if (matching.length > 0) res.push({ audience, count: matching.length, line: matching[0] });
  }
  return res.sort((a, b) => b.count - a.count);
}

const BOILERPLATE = /\b(navigation|menu|footer|cookies?|faqs?|frequently asked|sign ?up|log ?in|sign ?in|subscribe|newsletter|powered by|trusted by|our customers|contact (us|sales)|resources|related|learn more|get started|compare (features|plans)|terms|privacy|careers|press|blog)\b/i;

/** Headings that read like product claims rather than page furniture. */
export function isClaimLike(h: string): boolean {
  const words = h.split(/\s+/).filter(Boolean).length;
  return h.length >= 16 && h.length <= 140 && words >= 4 && !BOILERPLATE.test(h);
}

function obs(
  source: SourceCapture,
  partial: Pick<Observation, "field" | "value" | "kind" | "method"> & Partial<Observation>,
): Observation {
  return {
    id: newId("obs"),
    targetId: source.targetId,
    targetName: source.targetName,
    sourceId: source.id,
    sourceUrl: source.finalUrl ?? source.requestedUrl,
    pageTitle: source.title,
    capturedAt: source.capturedAt,
    check: "unverified",
    ...partial,
  };
}

/**
 * Deterministic extraction of observations from one captured page. Observations quote the
 * page verbatim; anything derived by heuristics is labelled as an inference.
 */
export function extractObservations(s: PageSnapshot, source: SourceCapture): Observation[] {
  const out: Observation[] = [];
  const description = s.metaDescription || s.ogDescription;
  if (description) {
    out.push(
      obs(source, {
        field: "official_description",
        value: normalizeWs(description),
        kind: "observation",
        method: s.metaDescription ? "dom:meta[name=description]" : "dom:meta[property=og:description]",
        excerpt: normalizeWs(description),
      }),
    );
  }
  const headline = s.h1[0];
  if (headline) {
    out.push(obs(source, { field: "headline", value: headline, kind: "observation", method: "dom:h1", excerpt: headline }));
  }
  const subheads = [...new Set([...s.h2, ...s.h3])].filter(isClaimLike).slice(0, 5);
  for (const h of subheads) {
    out.push(obs(source, { field: "vendor_claim", value: h, kind: "observation", method: s.h2.includes(h) ? "dom:h2" : "dom:h3", excerpt: h }));
  }
  for (const p of findPrices(s.visibleText)) {
    out.push(obs(source, { field: "displayed_price", value: p.value, kind: "observation", method: "regex:price", excerpt: p.line }));
  }
  const free = findFreeTier(s.visibleText);
  if (free) {
    out.push(obs(source, { field: "free_tier", value: "Free option displayed", kind: "observation", method: "regex:free-tier", excerpt: free }));
  }
  for (const a of findAudienceSignals(s.visibleText).slice(0, 3)) {
    out.push(
      obs(source, {
        field: "target_audience",
        value: a.audience,
        kind: "inference",
        method: `keyword-heuristic (${a.count} matching line${a.count === 1 ? "" : "s"})`,
        excerpt: a.line,
        check: "needs_review",
      }),
    );
  }
  return out;
}
