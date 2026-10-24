import { describe, expect, it } from "vitest";
import { extractObservations, findFreeTier, findPrices, isClaimLike } from "../server/core/extraction";
import type { PageSnapshot } from "../server/browser/browserManager";
import type { SourceCapture } from "../server/core/types";

const source: SourceCapture = { id: "src_1", targetId: "acme", targetName: "Acme", requestedUrl: "https://acme.test/", finalUrl: "https://acme.test/", redirectChain: [], capturedAt: "2026-10-24T00:00:00Z", ok: true, stepId: "s" };
const snap = (over: Partial<PageSnapshot>): PageSnapshot => ({
  requestedUrl: "https://acme.test/", finalUrl: "https://acme.test/", redirectChain: [], title: "Acme", metaDescription: "", ogTitle: "", ogDescription: "", canonical: "", lang: "en", h1: [], h2: [], h3: [], visibleText: "", ...over,
});

describe("extraction", () => {
  it("finds displayed prices with their source line", () => {
    const p = findPrices("Free\n$0 per month\nPro\n$20/month billed monthly\nTeam US$25 per user / month\n€18/mo");
    expect(p.map((x) => x.value)).toEqual(["$0 per month", "$20/month", "US$25 per user / month", "€18/mo"]);
    expect(p[1].line).toBe("$20/month billed monthly");
  });

  it("detects free tiers and ignores long paragraphs", () => {
    expect(findFreeTier("Plans\nFree\nPro")).toBe("Free");
    expect(findFreeTier("Our product is free of bugs and ".repeat(10))).toBeUndefined();
  });

  it("never invents a price or description when the page has none", () => {
    const obs = extractObservations(snap({ visibleText: "Talk to our team for pricing." }), source);
    expect(obs.find((o) => o.field === "displayed_price")).toBeUndefined();
    expect(obs.find((o) => o.field === "official_description")).toBeUndefined();
  });

  it("classifies audiences as inferences needing review and quotes evidence", () => {
    const obs = extractObservations(snap({ metaDescription: "Assistant for developers.", h1: ["Ship faster"], visibleText: "Built for developers and engineering teams.\n$10/month" }), source);
    const desc = obs.find((o) => o.field === "official_description")!;
    expect(desc).toMatchObject({ kind: "observation", value: "Assistant for developers.", excerpt: "Assistant for developers.", sourceUrl: "https://acme.test/" });
    const aud = obs.filter((o) => o.field === "target_audience");
    expect(aud.length).toBeGreaterThan(0);
    expect(aud.every((o) => o.kind === "inference" && o.check === "needs_review")).toBe(true);
  });

  it("filters page furniture from vendor claims", () => {
    expect(isClaimLike("Navigation Menu")).toBe(false);
    expect(isClaimLike("Compare features across plans")).toBe(false);
    expect(isClaimLike("Cited answers your whole team can trust")).toBe(true);
  });
});
