import { useEffect, useMemo, useState } from "react";
import { Check, CircleSlash, Info, Play, Plus, Trash2, X } from "lucide-react";
import type { Mission, StepRun, Target } from "../lib/api";
import { STEP_LABEL, STEP_TONE } from "../lib/format";
import { Badge, Button, IconButton, SectionTitle } from "./ui";

/** Group steps into dependency stages: a step's stage is one more than its deepest dependency. */
export function stages(steps: StepRun[]): StepRun[][] {
  const level = new Map<string, number>();
  const byId = new Map(steps.map((s) => [s.id, s]));
  const depth = (s: StepRun, seen = new Set<string>()): number => {
    if (level.has(s.id)) return level.get(s.id)!;
    if (seen.has(s.id)) return 0;
    seen.add(s.id);
    const d = s.dependsOn.length ? 1 + Math.max(...s.dependsOn.map((x) => (byId.get(x) ? depth(byId.get(x)!, seen) : 0))) : 0;
    level.set(s.id, d);
    return d;
  };
  steps.forEach((s) => depth(s));
  const out: StepRun[][] = [];
  for (const s of steps) (out[level.get(s.id)!] ??= []).push(s);
  return out.filter(Boolean);
}

export function StepGraph({ steps, compact }: { steps: StepRun[]; compact?: boolean }) {
  const groups = useMemo(() => stages(steps), [steps]);
  const titleOf = (id: string) => steps.find((s) => s.id === id)?.title ?? id;
  return (
    <ol className={`stage-list ${compact ? "compact" : ""}`}>
      {groups.map((g, i) => (
        <li key={i} className="stage">
          <div className="stage-head">
            <span className="stage-num">{i + 1}</span>
            <span>{g.length > 1 ? `${g.length} steps in parallel` : "1 step"}</span>
            {i > 0 && <span className="stage-dep">after stage {i}</span>}
          </div>
          <div className="stage-steps">
            {g.map((s) => (
              <div key={s.id} className={`plan-step status-${s.status}`}>
                <div className="plan-step-top">
                  <code className="tool-chip">{s.tool}</code>
                  {s.status !== "pending" && <Badge tone={STEP_TONE[s.status]}>{STEP_LABEL[s.status]}</Badge>}
                  {!s.critical && s.status === "pending" && <span className="optional">non-blocking</span>}
                </div>
                <div className="plan-step-title">{s.title}</div>
                {!compact && <div className="plan-step-desc">{s.description}</div>}
                {s.dependsOn.length > 0 && !compact && (
                  <div className="plan-step-deps" title={s.dependsOn.map(titleOf).join("\n")}>
                    Depends on {s.dependsOn.length === 1 ? titleOf(s.dependsOn[0]) : `${s.dependsOn.length} steps`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

interface Props {
  mission: Mission;
  busy: boolean;
  error?: string;
  onSaveTargets(targets: Target[]): Promise<void>;
  onApprove(): void;
  onCancel(): void;
}

export function PlanReview({ mission, busy, error, onSaveTargets, onApprove, onCancel }: Props) {
  const plan = mission.plan!;
  const [targets, setTargets] = useState<Target[]>(plan.targets);
  useEffect(() => setTargets(plan.targets), [plan.targets]);
  const dirty = JSON.stringify(targets) !== JSON.stringify(plan.targets);
  const enabled = targets.filter((t) => t.enabled).length;

  const edit = (i: number, patch: Partial<Target>) => setTargets((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  return (
    <div className="plan-review">
      <div className="plan-header">
        <div>
          <div className="eyebrow">Plan preview · nothing has run yet</div>
          <h2>{plan.objective}</h2>
          <div className="plan-meta">
            <Badge tone={plan.planner === "claude" ? "accent" : "neutral"}>{plan.planner === "claude" ? "Planned by Claude" : "Rule-based planner"}</Badge>
            <Badge tone="info">Read-only public research</Badge>
            <span>
              Product: <strong>{plan.productName}</strong>
            </span>
            <span>Deliverables: {plan.deliverables.join(", ")}</span>
          </div>
        </div>
      </div>

      {plan.plannerNotes.map((n, i) => (
        <div key={i} className="callout">
          <Info size={16} aria-hidden />
          <span>{n}</span>
        </div>
      ))}

      <section className="card">
        <SectionTitle
          count={enabled}
          action={
            <Button size="sm" variant="ghost" icon={Plus} disabled={targets.length >= 8} onClick={() => setTargets((ts) => [...ts, { id: `custom-${ts.length + 1}`, name: "New target", urls: ["https://"], origin: "user", enabled: true }])}>
              Add target
            </Button>
          }
        >
          Research targets
        </SectionTitle>
        <div className="target-table" role="table" aria-label="Research targets">
          {targets.map((t, i) => (
            <div key={t.id} className={`target-row ${t.enabled ? "" : "disabled"}`} role="row">
              <label className="switch" title={t.enabled ? "Included" : "Excluded"}>
                <input type="checkbox" checked={t.enabled} onChange={(e) => edit(i, { enabled: e.target.checked })} aria-label={`Include ${t.name}`} />
                <span />
              </label>
              <input className="target-name" value={t.name} onChange={(e) => edit(i, { name: e.target.value })} aria-label="Target name" />
              <div className="target-urls">
                {t.urls.map((u, k) => (
                  <input
                    key={k}
                    className="mono"
                    value={u}
                    aria-label={`URL ${k + 1} for ${t.name}`}
                    onChange={(e) => edit(i, { urls: t.urls.map((x, z) => (z === k ? e.target.value : x)) })}
                  />
                ))}
              </div>
              <Badge tone={t.origin === "user" ? "info" : t.origin === "model" ? "accent" : "neutral"}>{t.origin === "catalog" ? "seed list" : t.origin === "model" ? "Claude" : "you"}</Badge>
              <IconButton icon={Trash2} label={`Remove ${t.name}`} disabled={targets.length <= 1} onClick={() => setTargets((ts) => ts.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
        {dirty && (
          <div className="row-end">
            <Button size="sm" variant="ghost" icon={X} onClick={() => setTargets(plan.targets)}>
              Discard edits
            </Button>
            <Button size="sm" icon={Check} loading={busy} onClick={() => onSaveTargets(targets)}>
              Apply and rebuild plan
            </Button>
          </div>
        )}
      </section>

      <section className="card">
        <SectionTitle count={mission.steps.length}>Execution plan and dependencies</SectionTitle>
        <StepGraph steps={mission.steps} />
      </section>

      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}

      <div className="approval-bar">
        <div className="approval-text">
          <strong>Approve to start.</strong> OmniPilot will only open the listed public URLs, write files to this mission's artifact folder, and stop if you cancel.
        </div>
        <Button variant="ghost" icon={CircleSlash} onClick={onCancel}>
          Discard
        </Button>
        <Button variant="primary" icon={Play} onClick={onApprove} disabled={dirty || enabled === 0} loading={busy} title={dirty ? "Apply your target edits first" : undefined}>
          Approve and run
        </Button>
      </div>
    </div>
  );
}
