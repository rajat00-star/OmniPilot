import { createPlan, replanTargets, type PlanInput } from "./planner.js";
import { assertMissionTransition, assertStepTransition, isTerminal } from "./stateMachine.js";
import { MissionStore, newId, nowIso } from "./store.js";
import type { ApprovalRequest, Mission, MissionStatus, ReasoningMode, StepRun, Target } from "./types.js";
import { ToolError, type ToolContext, type ToolRegistry } from "../tools/registry.js";
import type { BrowserManager } from "../browser/browserManager.js";
import { releaseCurrentPage } from "../tools/browserTools.js";
import { config } from "../config.js";
import type { UrlPolicy } from "../security/urlSafety.js";

interface RunState {
  abort: AbortController;
  paused: boolean;
  resumeWaiters: (() => void)[];
  approvalWaiters: Map<string, (approved: boolean) => void>;
}

export class MissionEngine {
  private runs = new Map<string, RunState>();

  constructor(
    readonly store: MissionStore,
    readonly registry: ToolRegistry,
    readonly browser: BrowserManager,
    private readonly modeResolver: () => ReasoningMode,
    private readonly opts: { stepTimeoutMs: number; maxParallel: number; urlPolicy?: UrlPolicy } = { stepTimeoutMs: config.stepTimeoutMs, maxParallel: 2 },
  ) {}

  private setStatus(id: string, to: MissionStatus): void {
    this.store.update(id, (m) => {
      assertMissionTransition(m.status, to);
      m.status = to;
    });
  }

  private setStep(id: string, stepId: string, fn: (s: StepRun) => void): void {
    this.store.update(id, (m) => {
      const s = m.steps.find((x) => x.id === stepId);
      if (s) fn(s);
    });
  }

  private moveStep(id: string, stepId: string, to: StepRun["status"], extra?: (s: StepRun) => void): void {
    this.setStep(id, stepId, (s) => {
      assertStepTransition(s.status, to);
      s.status = to;
      extra?.(s);
    });
  }

  /** Create a mission and produce a plan for the user to review. Execution waits for approval. */
  async create(input: PlanInput): Promise<Mission> {
    const mode = this.modeResolver();
    const m: Mission = {
      id: newId("msn"),
      prompt: input.prompt.slice(0, 4000),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "draft",
      mode,
      steps: [],
      sources: [],
      observations: [],
      artifacts: [],
      checks: [],
      approvals: [],
      activity: [],
      frames: [],
      warnings: [],
    };
    this.store.create(m);
    this.setStatus(m.id, "planning");
    this.store.log(m.id, { level: "info", message: `Planning in ${mode === "claude" ? "Claude" : "deterministic"} mode`, tool: "planner" });
    try {
      const { plan, warnings } = await createPlan(input, this.registry, mode, undefined, this.opts.urlPolicy);
      this.store.update(m.id, (mm) => {
        mm.plan = plan;
        mm.steps = plan.steps.map(toRun);
        mm.warnings.push(...warnings);
      });
      this.store.log(m.id, { level: "success", message: `Plan ready: ${plan.steps.length} steps across ${plan.targets.length} targets. Awaiting your approval.`, tool: "planner" });
      this.setStatus(m.id, "awaiting_approval");
    } catch (e) {
      this.store.update(m.id, (mm) => {
        mm.status = "failed";
        mm.error = `Planning failed: ${(e as Error).message}`;
      });
      this.store.log(m.id, { level: "error", message: `Planning failed: ${(e as Error).message}`, tool: "planner" });
    }
    return this.store.get(m.id)!;
  }

  /** Edit targets during plan review; the step graph is rebuilt and revalidated. */
  updateTargets(id: string, targets: Target[]): Mission {
    const m = this.mustGet(id);
    if (m.status !== "awaiting_approval" || !m.plan) throw new ToolError("Targets can only be edited while the plan awaits approval", "invalid_state");
    const plan = replanTargets(m.plan, targets, this.registry, this.opts.urlPolicy);
    return this.store.update(id, (mm) => {
      mm.plan = plan;
      mm.steps = plan.steps.map(toRun);
    });
  }

  approve(id: string): Mission {
    const m = this.mustGet(id);
    if (m.status !== "awaiting_approval") throw new ToolError(`Mission is ${m.status}, not awaiting approval`, "invalid_state");
    if (!m.steps.length) throw new ToolError("Plan has no steps", "invalid_state");
    this.setStatus(id, "running");
    this.store.log(id, { level: "info", message: "Plan approved. Execution started." });
    const run: RunState = { abort: new AbortController(), paused: false, resumeWaiters: [], approvalWaiters: new Map() };
    this.runs.set(id, run);
    void this.execute(id, run).catch((e) => {
      this.store.log(id, { level: "error", message: `Engine error: ${(e as Error).message}` });
      this.store.update(id, (mm) => {
        if (!isTerminal(mm.status)) {
          mm.status = "failed";
          mm.error = (e as Error).message;
        }
      });
    });
    return this.store.get(id)!;
  }

  cancel(id: string): Mission {
    const m = this.mustGet(id);
    if (isTerminal(m.status)) return m;
    const run = this.runs.get(id);
    run?.abort.abort();
    for (const w of run?.approvalWaiters.values() ?? []) w(false);
    for (const w of run?.resumeWaiters.splice(0) ?? []) w();
    this.store.update(id, (mm) => {
      assertMissionTransition(mm.status, "cancelled");
      mm.status = "cancelled";
      for (const s of mm.steps) if (s.status === "pending" || s.status === "running" || s.status === "waiting_approval") {
        s.status = "cancelled";
        s.finishedAt ??= nowIso();
      }
    });
    this.store.log(id, { level: "warning", message: "Mission cancelled by user. In-flight browser pages were closed." });
    void releaseCurrentPage(id);
    void this.browser.closeContext(id);
    return this.store.get(id)!;
  }

  pause(id: string, reason = "Paused by user"): Mission {
    const run = this.runs.get(id);
    const m = this.mustGet(id);
    if (!run || m.status !== "running") throw new ToolError(`Cannot pause a mission that is ${m.status}`, "invalid_state");
    run.paused = true;
    this.setStatus(id, "paused");
    this.store.log(id, { level: "warning", message: `${reason}. Execution will hold before the next browser action.` });
    return this.store.get(id)!;
  }

  resume(id: string): Mission {
    const run = this.runs.get(id);
    const m = this.mustGet(id);
    if (!run || m.status !== "paused") throw new ToolError(`Cannot resume a mission that is ${m.status}`, "invalid_state");
    run.paused = false;
    this.setStatus(id, "running");
    for (const w of run.resumeWaiters.splice(0)) w();
    this.store.log(id, { level: "info", message: "Resumed." });
    return this.store.get(id)!;
  }

  resolveApproval(id: string, approvalId: string, approved: boolean): Mission {
    const run = this.runs.get(id);
    const waiter = run?.approvalWaiters.get(approvalId);
    if (!waiter) throw new ToolError("No pending approval with that id", "not_found");
    this.store.update(id, (m) => {
      const a = m.approvals.find((x) => x.id === approvalId);
      if (a) {
        a.resolution = approved ? "approved" : "denied";
        a.resolvedAt = nowIso();
      }
    });
    run!.approvalWaiters.delete(approvalId);
    waiter(approved);
    return this.store.get(id)!;
  }

  /** Run a single registered tool on behalf of the user (e.g. address-bar navigation). */
  async runAdHoc(id: string, tool: string, input: unknown): Promise<{ summary: string }> {
    const t = this.registry.get(tool);
    if (!t) throw new ToolError(`Unknown tool ${tool}`, "unknown_tool");
    if (t.consequential) throw new ToolError(`${tool} is consequential and can only run as an approved plan step`, "approval_required");
    const parsed = t.inputSchema.safeParse(input);
    if (!parsed.success) throw new ToolError(`Invalid input: ${parsed.error.issues[0]?.message}`, "invalid_input");
    this.mustGet(id);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.opts.stepTimeoutMs);
    try {
      return await t.run(this.ctx(id, "manual", abort.signal, undefined), parsed.data);
    } finally {
      clearTimeout(timer);
    }
  }

  private mustGet(id: string): Mission {
    const m = this.store.get(id);
    if (!m) throw new ToolError("Mission not found", "not_found");
    return m;
  }

  private ctx(id: string, stepId: string, signal: AbortSignal, run?: RunState): ToolContext {
    return {
      missionId: id,
      stepId,
      mode: this.store.get(id)!.mode,
      store: this.store,
      browser: this.browser,
      signal,
      mission: () => this.store.get(id)!,
      log: (level, message, data, tool) => this.store.log(id, { level, message, data, tool, stepId }),
      frame: (f) => this.store.update(id, (m) => {
        m.frames.push({ at: nowIso(), ...f });
        if (m.frames.length > 80) m.frames.splice(0, m.frames.length - 80);
      }),
      checkpoint: async () => {
        if (!run?.paused) return;
        await new Promise<void>((r) => run.resumeWaiters.push(r));
      },
    };
  }

  private depsState(m: Mission, s: StepRun): "ready" | "wait" | "blocked" {
    for (const d of s.dependsOn) {
      const dep = m.steps.find((x) => x.id === d);
      if (!dep) return "blocked";
      if (dep.status === "pending" || dep.status === "running" || dep.status === "waiting_approval") return "wait";
      if (dep.status === "succeeded") continue;
      // A failed non-critical dependency (e.g. one inaccessible competitor) degrades but does not block.
      if (dep.status === "failed" && !dep.critical) continue;
      return "blocked";
    }
    return "ready";
  }

  private async execute(id: string, run: RunState): Promise<void> {
    const inFlight = new Map<string, Promise<void>>();
    for (;;) {
      if (run.abort.signal.aborted) break;
      if (run.paused) await new Promise<void>((r) => run.resumeWaiters.push(r));
      if (run.abort.signal.aborted) break;
      const m = this.store.get(id)!;
      // Skip steps whose critical dependencies failed.
      for (const s of m.steps) {
        if (s.status === "pending" && this.depsState(m, s) === "blocked") {
          this.moveStep(id, s.id, "skipped", (x) => {
            x.finishedAt = nowIso();
            x.error = { message: "Skipped because a required earlier step did not succeed" };
          });
          this.store.log(id, { level: "warning", stepId: s.id, message: `Skipped "${s.title}" (dependency failed)` });
        }
      }
      const fresh = this.store.get(id)!;
      const ready = fresh.steps.filter((s) => s.status === "pending" && !inFlight.has(s.id) && this.depsState(fresh, s) === "ready");
      for (const s of ready) {
        if (inFlight.size >= this.opts.maxParallel) break;
        const p = this.runStep(id, s.id, run).finally(() => inFlight.delete(s.id));
        inFlight.set(s.id, p);
      }
      if (inFlight.size === 0) break;
      await Promise.race(inFlight.values());
    }
    await Promise.allSettled(inFlight.values());
    await releaseCurrentPage(id);
    await this.browser.closeContext(id);
    this.finish(id);
    this.runs.delete(id);
  }

  private finish(id: string): void {
    const m = this.store.get(id)!;
    if (isTerminal(m.status)) return;
    const failedCritical = m.steps.filter((s) => s.critical && (s.status === "failed" || s.status === "skipped"));
    const failedAny = m.steps.filter((s) => s.status === "failed" || s.status === "skipped");
    const checksFailed = m.checks.some((c) => c.status === "failed");
    const captured = m.sources.some((s) => s.ok && s.targetId !== "manual");
    let to: MissionStatus;
    let error: string | undefined;
    if (failedCritical.length) {
      to = "failed";
      error = `Critical step failed: ${failedCritical.map((s) => s.title).join(", ")}`;
    } else if (!captured) {
      to = "failed";
      error = "No competitor source could be captured, so no research evidence exists. Artifacts were still written and record every field as Unknown.";
    } else if (failedAny.length || checksFailed || m.warnings.length) {
      to = "completed_with_warnings";
    } else {
      to = "completed";
    }
    this.store.update(id, (mm) => {
      assertMissionTransition(mm.status, to);
      mm.status = to;
      if (error) mm.error = error;
    });
    this.store.log(id, { level: to === "completed" ? "success" : to === "failed" ? "error" : "warning", message: `Mission ${to.replace(/_/g, " ")}.${error ? ` ${error}` : ""}` });
    this.store.persistNow(id);
  }

  private async runStep(id: string, stepId: string, run: RunState): Promise<void> {
    const step = this.store.get(id)!.steps.find((s) => s.id === stepId)!;
    const tool = this.registry.get(step.tool);
    if (!tool) {
      this.moveStep(id, stepId, "running");
      this.moveStep(id, stepId, "failed", (s) => (s.error = { message: `Unknown tool ${step.tool}`, code: "unknown_tool" }));
      return;
    }
    const parsed = tool.inputSchema.safeParse(step.input);
    if (tool.consequential) {
      const approval: ApprovalRequest = { id: newId("apr"), stepId, title: step.title, reason: `${tool.name} is a consequential action and needs your explicit approval.`, createdAt: nowIso() };
      this.moveStep(id, stepId, "waiting_approval");
      this.store.update(id, (m) => m.approvals.push(approval));
      this.store.log(id, { level: "warning", stepId, message: `Approval required: ${step.title}`, tool: tool.name });
      const ok = await new Promise<boolean>((r) => run.approvalWaiters.set(approval.id, r));
      if (run.abort.signal.aborted) return;
      if (!ok) {
        this.moveStep(id, stepId, "skipped", (s) => {
          s.finishedAt = nowIso();
          s.error = { message: "Denied by user", code: "denied" };
        });
        this.store.log(id, { level: "warning", stepId, message: `Denied: ${step.title}` });
        return;
      }
    }
    if (step.tool === "verifier.check") {
      const m = this.store.get(id)!;
      if (m.status === "running") this.setStatus(id, "verifying");
    }
    this.moveStep(id, stepId, "running", (s) => {
      s.startedAt = nowIso();
      s.attempts++;
    });
    this.store.log(id, { level: "info", stepId, message: `Started: ${step.title}`, tool: tool.name });
    if (!parsed.success) {
      this.moveStep(id, stepId, "failed", (s) => {
        s.finishedAt = nowIso();
        s.error = { message: `Invalid input: ${parsed.error.issues[0]?.message}`, code: "invalid_input" };
      });
      return;
    }
    const maxAttempts = tool.retryable ? 2 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const stepAbort = new AbortController();
      const onParentAbort = () => stepAbort.abort();
      run.abort.signal.addEventListener("abort", onParentAbort, { once: true });
      let timer: NodeJS.Timeout | undefined;
      try {
        const result = await Promise.race([
          tool.run(this.ctx(id, stepId, stepAbort.signal, run), parsed.data),
          new Promise<never>((_, rej) => {
            timer = setTimeout(() => {
              stepAbort.abort();
              rej(new ToolError(`Step exceeded its ${Math.round(this.opts.stepTimeoutMs / 1000)}s time budget`, "timeout", "Retry the mission or reduce the number of targets.", true));
            }, this.opts.stepTimeoutMs);
          }),
        ]);
        if (run.abort.signal.aborted) return;
        this.moveStep(id, stepId, "succeeded", (s) => {
          s.finishedAt = nowIso();
          s.resultSummary = result.summary;
          s.output = result.output;
          s.evidenceIds = result.evidenceIds ?? [];
          s.artifactIds = result.artifactIds ?? [];
          s.verification = result.outcome === "partial" ? "warning" : "passed";
        });
        this.store.log(id, { level: result.outcome === "partial" ? "warning" : "success", stepId, message: `Finished: ${step.title} — ${result.summary}`, tool: tool.name });
        return;
      } catch (e) {
        if (run.abort.signal.aborted) return;
        const te = e instanceof ToolError ? e : new ToolError((e as Error).message, "tool_error");
        if (attempt < maxAttempts && te.transient) {
          this.store.log(id, { level: "warning", stepId, message: `Retrying "${step.title}" after: ${te.message}`, tool: tool.name });
          this.setStep(id, stepId, (s) => s.attempts++);
          continue;
        }
        this.moveStep(id, stepId, "failed", (s) => {
          s.finishedAt = nowIso();
          s.error = { message: te.message, code: te.code, recovery: te.recovery };
          s.verification = "failed";
        });
        this.store.log(id, { level: step.critical ? "error" : "warning", stepId, message: `Failed: ${step.title} — ${te.message}`, tool: tool.name, data: te.recovery ? { recovery: te.recovery } : undefined });
        return;
      } finally {
        clearTimeout(timer);
        run.abort.signal.removeEventListener("abort", onParentAbort);
      }
    }
  }
}

function toRun(s: import("./types.js").PlanStep): StepRun {
  return { ...s, status: "pending", attempts: 0, evidenceIds: [], artifactIds: [], verification: "not_run" };
}
