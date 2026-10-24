import { describe, expect, it } from "vitest";
import { buildResearchSteps, deterministicPlan, extractUrls, parseDeliverables, parseProductName, parseTargetCount, PlanValidationError, validatePlan } from "../server/core/planner";
import { createRegistry } from "../server/tools";
import type { Plan } from "../server/core/types";

const registry = createRegistry();
const SIGNATURE =
  "Research five competing AI products. Find their official product descriptions and publicly displayed pricing. Compare their positioning, target audiences, and differentiators. Identify potential market gaps, create a structured competitor-analysis CSV, write an evidence-backed research report, and generate a landing-page concept for my hypothetical product. Verify every generated artifact and show me the evidence.";

function basePlan(): Plan {
  return deterministicPlan({ prompt: SIGNATURE }, registry);
}

describe("instruction parsing", () => {
  it("reads target counts, deliverables, product names and URLs", () => {
    expect(parseTargetCount(SIGNATURE)).toBe(5);
    expect(parseTargetCount("compare three AI tools")).toBe(3);
    expect(parseTargetCount("compare 12 products")).toBe(8);
    expect(parseDeliverables(SIGNATURE)).toEqual(["competitor_csv", "research_report", "landing_page", "evidence_json"]);
    expect(parseProductName("a landing page for my product called VerityDesk. Verify it")).toBe("VerityDesk");
    expect(extractUrls("see https://a.com/x, and https://b.org/y.")).toEqual(["https://a.com/x", "https://b.org/y"]);
  });
});

describe("deterministic planner", () => {
  it("builds a valid dependency graph for the signature mission", () => {
    const plan = basePlan();
    expect(plan.planner).toBe("deterministic");
    expect(plan.targets).toHaveLength(5);
    expect(plan.targets.every((t) => t.origin === "catalog")).toBe(true);
    expect(plan.plannerNotes[0]).toMatch(/curated seed list/);
    const collect = plan.steps.filter((s) => s.tool === "research.collect");
    expect(collect).toHaveLength(5);
    const analyze = plan.steps.find((s) => s.id === "analyze")!;
    expect(analyze.dependsOn.sort()).toEqual(collect.map((s) => s.id).sort());
    expect(plan.steps.find((s) => s.id === "verify")!.dependsOn).toHaveLength(4);
    expect(plan.steps.at(-1)!.tool).toBe("report.finalize");
  });

  it("uses URLs from the instruction as user targets", () => {
    const plan = deterministicPlan({ prompt: "Compare https://claude.com/pricing and https://github.com/features/copilot/plans in a CSV" }, registry);
    expect(plan.targets.map((t) => t.origin)).toEqual(["user", "user"]);
    expect(plan.targets[0].urls).toEqual(["https://claude.com/pricing"]);
  });

  it("rejects unsafe URLs embedded in the instruction", () => {
    expect(() => deterministicPlan({ prompt: "Research http://169.254.169.254/latest and report" }, registry)).toThrow(PlanValidationError);
  });
});

describe("plan validation rejects invalid model plans", () => {
  it("rejects unknown tool names", () => {
    const plan = basePlan();
    plan.steps[0] = { ...plan.steps[0], tool: "shell.exec", input: { cmd: "rm -rf /" } };
    expect(() => validatePlan(plan, registry)).toThrow(/unknown tool "shell.exec"/);
  });

  it("rejects malformed tool inputs", () => {
    const plan = basePlan();
    const write = plan.steps.find((s) => s.tool === "artifact.write")!;
    write.input = { kind: "competitor_csv", filename: "../../etc/passwd" };
    expect(() => validatePlan(plan, registry)).toThrow(/invalid input for artifact.write/);
  });

  it("rejects dangling dependencies and cycles", () => {
    const plan = basePlan();
    plan.steps[0].dependsOn = ["does-not-exist"];
    expect(() => validatePlan(plan, registry)).toThrow(/unknown step does-not-exist/);
    const p2 = basePlan();
    p2.steps.find((s) => s.id === "analyze")!.dependsOn.push("verify");
    expect(() => validatePlan(p2, registry)).toThrow(/dependency cycle/);
  });

  it("rejects duplicate ids, empty plans and references to unknown targets", () => {
    const plan = basePlan();
    plan.steps[1].id = plan.steps[0].id;
    expect(() => validatePlan(plan, registry)).toThrow(/duplicate step id/);
    expect(() => validatePlan({ ...basePlan(), steps: [] }, registry)).toThrow(/no steps/);
    const p3 = basePlan();
    p3.steps[0].input = { targetId: "ghost" };
    expect(() => validatePlan(p3, registry)).toThrow(/unknown target/);
  });

  it("rejects private-network target URLs", () => {
    const plan = basePlan();
    plan.targets[0].urls = ["http://10.0.0.1/admin"];
    expect(() => validatePlan(plan, registry)).toThrow(PlanValidationError);
  });

  it("produces a valid graph when targets are disabled", () => {
    const plan = basePlan();
    plan.targets[0].enabled = false;
    const steps = buildResearchSteps(plan.targets, ["competitor_csv"]);
    expect(steps.filter((s) => s.tool === "research.collect")).toHaveLength(4);
    expect(() => validatePlan({ ...plan, steps }, registry)).not.toThrow();
  });
});

describe("seed-list target selection", () => {
  it("does not treat instruction verbs as product topics", () => {
    const plan = basePlan();
    expect(plan.targets.map((t) => t.name)).toEqual(["ChatGPT", "Claude", "Google Gemini", "Microsoft Copilot", "Mistral Le Chat"]);
  });

  it("uses topic words that describe the products", () => {
    const plan = deterministicPlan({ prompt: "Research three AI coding assistants and write a CSV report" }, registry);
    expect(plan.targets.map((t) => t.name).sort()).toEqual(["Claude", "Cursor", "GitHub Copilot"]);
  });
});
