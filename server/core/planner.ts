import { z } from "zod";
import { pickCatalogTargets } from "./catalog.js";
import { newId } from "./store.js";
import type { Plan, PlanStep, ReasoningMode, Target } from "./types.js";
import { checkUrlStructure, type UrlPolicy } from "../security/urlSafety.js";
import { structured, LlmError, UNTRUSTED_POLICY } from "../llm/claude.js";
import type { ToolRegistry } from "../tools/registry.js";

export const MAX_TARGETS = 8;
export const MAX_URLS_PER_TARGET = 3;
export const MAX_STEPS = 40;

export type Deliverable = "competitor_csv" | "research_report" | "landing_page" | "evidence_json";

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

export function parseTargetCount(prompt: string): number {
  const m = prompt.match(/\b(two|three|four|five|six|seven|eight|\d{1,2})\s+(?:competing|competitor|rival|ai|products?|tools?|companies|apps?|services?)/i);
  if (!m) return 5;
  const n = NUMBER_WORDS[m[1].toLowerCase()] ?? Number.parseInt(m[1], 10);
  return Math.min(Math.max(n || 5, 1), MAX_TARGETS);
}

export function parseDeliverables(prompt: string): Deliverable[] {
  const d: Deliverable[] = [];
  if (/\b(csv|spreadsheet|table)\b/i.test(prompt)) d.push("competitor_csv");
  if (/\b(report|analysis|memo|write[- ]?up)\b/i.test(prompt)) d.push("research_report");
  if (/\blanding[- ]?page\b/i.test(prompt)) d.push("landing_page");
  if (d.length === 0) d.push("competitor_csv", "research_report");
  d.push("evidence_json");
  return d;
}

export function parseProductName(prompt: string): string | undefined {
  const m = prompt.match(/\b(?:product|startup|app|tool)\s+(?:called|named)\s+["“']?([A-Z][\w-]*(?:\s[A-Z][\w-]*){0,2})/);
  return m?.[1];
}

export function extractUrls(prompt: string): string[] {
  const found = prompt.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:]+$/, "")))];
}

const DELIVERABLE_FILES: Record<Deliverable, { filename: string; title: string }> = {
  competitor_csv: { filename: "competitor-analysis.csv", title: "Write competitor-analysis CSV" },
  research_report: { filename: "research-report.md", title: "Write evidence-backed research report" },
  landing_page: { filename: "landing-page-concept.html", title: "Generate landing-page concept" },
  evidence_json: { filename: "evidence.json", title: "Export evidence ledger" },
};

/** Build the step graph for a research mission. Shared by both planners so the engine stays in control. */
export function buildResearchSteps(targets: Target[], deliverables: Deliverable[]): PlanStep[] {
  const steps: PlanStep[] = [];
  const collectIds: string[] = [];
  for (const t of targets.filter((t) => t.enabled)) {
    const id = `collect-${t.id}`;
    collectIds.push(id);
    steps.push({
      id,
      title: `Research ${t.name}`,
      description: `Open ${t.urls.length} official page${t.urls.length === 1 ? "" : "s"}, capture visible text, metadata and a screenshot, and extract description and displayed pricing.`,
      tool: "research.collect",
      input: { targetId: t.id },
      dependsOn: [],
      critical: false,
    });
  }
  steps.push({
    id: "analyze",
    title: "Compare positioning and find market gaps",
    description: "Compare captured evidence across competitors. Inferences are labelled and cite the observations they rest on.",
    tool: "analysis.compare",
    input: {},
    dependsOn: collectIds,
    critical: true,
  });
  const writeIds: string[] = [];
  for (const d of deliverables) {
    const id = `write-${d.replace(/_/g, "-")}`;
    writeIds.push(id);
    steps.push({
      id,
      title: DELIVERABLE_FILES[d].title,
      description: `Write ${DELIVERABLE_FILES[d].filename} to the mission artifact directory from observed tool outputs.`,
      tool: "artifact.write",
      input: { kind: d, filename: DELIVERABLE_FILES[d].filename },
      dependsOn: ["analyze"],
      critical: d !== "landing_page",
    });
  }
  steps.push({
    id: "verify",
    title: "Independently verify artifacts and evidence",
    description: "Read every artifact back from disk, parse it, check structure and citations, and re-check each quoted excerpt against the stored page capture.",
    tool: "verifier.check",
    input: { filenames: deliverables.map((d) => DELIVERABLE_FILES[d].filename) },
    dependsOn: writeIds,
    critical: true,
  });
  steps.push({
    id: "finalize",
    title: "Compile verification report and mission summary",
    description: "Write verification-report.md with counts computed from execution results.",
    tool: "report.finalize",
    input: {},
    dependsOn: ["verify"],
    critical: true,
  });
  return steps;
}

// ---------- validation ----------

export class PlanValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid plan: ${issues.join("; ")}`);
    this.name = "PlanValidationError";
  }
}

const StepShape = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/),
  title: z.string().min(1).max(160),
  description: z.string().max(600),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  dependsOn: z.array(z.string()).max(MAX_STEPS),
  critical: z.boolean(),
});

const TargetShape = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(80),
  urls: z.array(z.string()).min(1).max(MAX_URLS_PER_TARGET),
  origin: z.enum(["user", "catalog", "model"]),
  enabled: z.boolean(),
});

/**
 * Validate a plan regardless of who produced it: known tools only, valid inputs per tool,
 * unique ids, existing dependencies, no cycles, and safe URLs.
 */
export function validatePlan(plan: Plan, registry: ToolRegistry, policy: UrlPolicy = {}): Plan {
  const issues: string[] = [];
  if (!plan.steps.length) issues.push("plan has no steps");
  if (plan.steps.length > MAX_STEPS) issues.push(`plan has ${plan.steps.length} steps (max ${MAX_STEPS})`);
  if (plan.targets.length > MAX_TARGETS) issues.push(`too many targets (max ${MAX_TARGETS})`);
  for (const t of plan.targets) {
    const r = TargetShape.safeParse(t);
    if (!r.success) issues.push(`target ${t?.name ?? "?"}: ${r.error.issues[0]?.message}`);
    for (const u of t.urls ?? []) {
      try {
        checkUrlStructure(u, policy);
      } catch (e) {
        issues.push(`target ${t.name}: ${(e as Error).message}`);
      }
    }
  }
  const ids = new Set<string>();
  for (const s of plan.steps) {
    const r = StepShape.safeParse(s);
    if (!r.success) {
      issues.push(`step ${s?.id ?? "?"}: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
      continue;
    }
    if (ids.has(s.id)) issues.push(`duplicate step id ${s.id}`);
    ids.add(s.id);
    const tool = registry.get(s.tool);
    if (!tool) {
      issues.push(`step ${s.id}: unknown tool "${s.tool}"`);
      continue;
    }
    const inp = tool.inputSchema.safeParse(s.input);
    if (!inp.success) issues.push(`step ${s.id}: invalid input for ${s.tool}: ${inp.error.issues[0]?.path.join(".")} ${inp.error.issues[0]?.message}`);
    if (s.tool === "research.collect" && !plan.targets.some((t) => t.id === (s.input as { targetId?: string }).targetId)) {
      issues.push(`step ${s.id}: references unknown target`);
    }
  }
  for (const s of plan.steps) for (const d of s.dependsOn ?? []) if (!ids.has(d)) issues.push(`step ${s.id}: depends on unknown step ${d}`);
  // Cycle detection (DFS).
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      issues.push(`dependency cycle: ${[...trail, id].join(" -> ")}`);
      return;
    }
    state.set(id, 1);
    for (const d of byId.get(id)?.dependsOn ?? []) if (byId.has(d)) visit(d, [...trail, id]);
    state.set(id, 2);
  };
  for (const s of plan.steps) visit(s.id, []);
  if (issues.length) throw new PlanValidationError([...new Set(issues)]);
  return plan;
}

// ---------- planners ----------

function slug(name: string, used: Set<string>): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "target";
  let s = base;
  let i = 2;
  while (used.has(s)) s = `${base}-${i++}`;
  used.add(s);
  return s;
}

export interface PlanInput {
  prompt: string;
  productName?: string;
  productPitch?: string;
}

export function deterministicPlan(input: PlanInput, registry: ToolRegistry, policy: UrlPolicy = {}): Plan {
  const notes: string[] = [];
  const count = parseTargetCount(input.prompt);
  const used = new Set<string>();
  let targets: Target[];
  const urls = extractUrls(input.prompt);
  if (urls.length) {
    const byHost = new Map<string, string[]>();
    for (const u of urls) {
      try {
        const host = new URL(u).hostname.replace(/^www\./, "");
        byHost.set(host, [...(byHost.get(host) ?? []), u].slice(0, MAX_URLS_PER_TARGET));
      } catch {
        notes.push(`Ignored unparseable URL ${u}`);
      }
    }
    targets = [...byHost.entries()].slice(0, MAX_TARGETS).map(([host, us]) => ({ id: slug(host, used), name: host, urls: us, origin: "user" as const, enabled: true }));
    notes.push(`Targets taken from ${urls.length} URL(s) in your instruction.`);
  } else {
    targets = pickCatalogTargets(input.prompt, count).map((e) => ({ id: slug(e.name, used), name: e.name, urls: e.urls, origin: "catalog" as const, enabled: true }));
    notes.push(
      `Deterministic mode cannot discover competitors on its own, so ${targets.length} targets were proposed from OmniPilot's curated seed list. Review, edit or disable them before approving. All pages are fetched live.`,
    );
  }
  const deliverables = parseDeliverables(input.prompt);
  const productName = input.productName?.trim() || parseProductName(input.prompt) || "Your Product";
  const plan: Plan = {
    objective: input.prompt.trim().slice(0, 600),
    productName,
    productPitch: input.productPitch?.trim() || "",
    deliverables: deliverables.map((d) => DELIVERABLE_FILES[d].filename),
    targets,
    steps: buildResearchSteps(targets, deliverables),
    planner: "deterministic",
    plannerNotes: notes,
  };
  return validatePlan(plan, registry, policy);
}

const ModelPlanSchema = z.object({
  objective: z.string(),
  product_name: z.string(),
  product_pitch: z.string(),
  deliverables: z.array(z.enum(["competitor_csv", "research_report", "landing_page"])),
  targets: z.array(
    z.object({
      name: z.string(),
      official_urls: z.array(z.string()),
      why_relevant: z.string(),
    }),
  ),
  notes: z.array(z.string()),
});

export async function claudePlan(input: PlanInput, registry: ToolRegistry, signal?: AbortSignal, policy: UrlPolicy = {}): Promise<Plan> {
  const count = parseTargetCount(input.prompt);
  const out = await structured({
    schema: ModelPlanSchema,
    signal,
    system: [
      "You are the planning module of OmniPilot, a browser research agent. You produce a plan; you do not perform research and must not state facts about products beyond naming them.",
      `Choose exactly ${count} competing products relevant to the user's instruction (unless the user lists specific ones). For each, give 1-${MAX_URLS_PER_TARGET} official https URLs on the vendor's own domain: prefer the pricing page and the main product page. Never use third-party review sites.`,
      "Deliverables must be chosen only from the enum. product_name: the user's hypothetical product name if given, otherwise a short neutral placeholder. Keep notes brief and user-facing.",
      UNTRUSTED_POLICY,
    ].join("\n"),
    user: `Instruction:\n${input.prompt}\n\nUser-supplied product name: ${input.productName || "(none)"}\nUser-supplied product pitch: ${input.productPitch || "(none)"}`,
  });
  const used = new Set<string>();
  const targets: Target[] = out.targets.slice(0, MAX_TARGETS).map((t) => ({
    id: slug(t.name, used),
    name: t.name.slice(0, 80),
    urls: t.official_urls.slice(0, MAX_URLS_PER_TARGET),
    origin: "model",
    enabled: true,
  }));
  const deliverables: Deliverable[] = [...new Set(out.deliverables)];
  if (!deliverables.length) deliverables.push("competitor_csv", "research_report");
  deliverables.push("evidence_json");
  const plan: Plan = {
    objective: out.objective.slice(0, 600) || input.prompt.slice(0, 600),
    productName: input.productName?.trim() || out.product_name.slice(0, 60) || "Your Product",
    productPitch: input.productPitch?.trim() || out.product_pitch.slice(0, 400),
    deliverables: deliverables.map((d) => DELIVERABLE_FILES[d].filename),
    targets,
    steps: buildResearchSteps(targets, deliverables),
    planner: "claude",
    plannerNotes: [
      "Targets and URLs were proposed by Claude and validated by OmniPilot's URL policy. They are fetched live; nothing about them is assumed true until captured.",
      ...out.notes.slice(0, 4).map((n) => n.slice(0, 300)),
    ],
  };
  return validatePlan(plan, registry, policy);
}

export async function createPlan(
  input: PlanInput,
  registry: ToolRegistry,
  mode: ReasoningMode,
  signal?: AbortSignal,
  policy: UrlPolicy = {},
): Promise<{ plan: Plan; warnings: string[] }> {
  if (mode === "claude") {
    try {
      return { plan: await claudePlan(input, registry, signal, policy), warnings: [] };
    } catch (e) {
      const reason = e instanceof LlmError || e instanceof PlanValidationError ? e.message : String(e);
      const plan = deterministicPlan(input, registry, policy);
      plan.plannerNotes.unshift(`Claude planning failed (${reason}); fell back to the deterministic planner.`);
      return { plan, warnings: [`Claude planning failed: ${reason}`] };
    }
  }
  return { plan: deterministicPlan(input, registry, policy), warnings: [] };
}

/** Rebuild steps after the user edits targets in the plan preview. */
export function replanTargets(plan: Plan, targets: Target[], registry: ToolRegistry, policy: UrlPolicy = {}): Plan {
  const deliverables = (Object.keys(DELIVERABLE_FILES) as Deliverable[]).filter((d) => plan.deliverables.includes(DELIVERABLE_FILES[d].filename));
  const next: Plan = { ...plan, targets, steps: buildResearchSteps(targets, deliverables) };
  return validatePlan(next, registry, policy);
}

export { newId };
