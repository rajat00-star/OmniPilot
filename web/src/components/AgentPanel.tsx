import { useEffect, useRef, useState } from "react";
import { AlertOctagon, CheckCircle2, Circle, CircleDashed, CircleSlash, Hand, Loader2, ShieldAlert, ShieldCheck, Target, XCircle } from "lucide-react";
import type { ActivityEntry, Mission, StepRun } from "../lib/api";
import { MISSION_LABEL, MISSION_TONE, STEP_LABEL, clock, duration, isActive } from "../lib/format";
import { Badge, Button, Empty, SectionTitle, StatusDot } from "./ui";

function StepIcon({ s }: { s: StepRun }) {
  switch (s.status) {
    case "running":
      return <Loader2 size={15} className="spin tone-accent-fg" aria-label="Running" />;
    case "succeeded":
      return s.verification === "warning" ? <CheckCircle2 size={15} className="tone-warning-fg" aria-label="Succeeded with warnings" /> : <CheckCircle2 size={15} className="tone-success-fg" aria-label="Succeeded" />;
    case "failed":
      return <XCircle size={15} className="tone-danger-fg" aria-label="Failed" />;
    case "waiting_approval":
      return <Hand size={15} className="tone-info-fg" aria-label="Needs approval" />;
    case "skipped":
    case "cancelled":
      return <CircleSlash size={15} className="tone-muted-fg" aria-label={STEP_LABEL[s.status]} />;
    default:
      return <Circle size={15} className="tone-muted-fg" aria-label="Pending" />;
  }
}

function Activity({ entries }: { entries: ActivityEntry[] }) {
  const ref = useRef<HTMLOListElement>(null);
  const [stick, setStick] = useState(true);
  useEffect(() => {
    if (stick && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries.length, stick]);
  return (
    <ol
      className="activity"
      ref={ref}
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
      }}
    >
      {entries.map((a) => (
        <li key={a.id} className={`act level-${a.level}`}>
          <span className="act-time">{clock(a.at)}</span>
          {a.tool && <code className="act-tool">{a.tool}</code>}
          <span className="act-msg">{a.message}</span>
          {typeof a.data?.recovery === "string" && <span className="act-recovery">Suggested: {a.data.recovery}</span>}
        </li>
      ))}
    </ol>
  );
}

interface Props {
  mission?: Mission;
  connected: boolean;
  onApproval(id: string, approved: boolean): void;
}

export function AgentPanel({ mission, connected, onApproval }: Props) {
  if (!mission) {
    return (
      <aside className="panel" aria-label="Agent panel">
        <div className="panel-head">
          <span className="panel-title">Agent</span>
        </div>
        <Empty icon={Target} title="No active mission">
          The agent's objective, current step, live tool activity, evidence and verification appear here.
        </Empty>
      </aside>
    );
  }
  const current = mission.steps.find((s) => s.status === "running") ?? mission.steps.find((s) => s.status === "waiting_approval");
  const done = mission.steps.filter((s) => ["succeeded", "failed", "skipped", "cancelled"].includes(s.status)).length;
  const pending = mission.approvals.filter((a) => !a.resolution);
  const failures = mission.steps.filter((s) => s.status === "failed");
  const evidence = mission.observations.filter((o) => o.kind === "observation").length;
  const captured = mission.sources.filter((s) => s.ok && s.targetId !== "manual").length;
  const manual = mission.sources.filter((s) => s.ok && s.targetId === "manual").length;
  const pct = mission.steps.length ? Math.round((done / mission.steps.length) * 100) : 0;

  return (
    <aside className="panel" aria-label="Agent panel">
      <div className="panel-head">
        <span className="panel-title">Agent</span>
        <Badge tone={MISSION_TONE[mission.status]}>
          <StatusDot tone={MISSION_TONE[mission.status]} pulse={isActive(mission.status)} />
          {MISSION_LABEL[mission.status]}
        </Badge>
        <span className={`live ${connected ? "on" : ""}`} title={connected ? "Receiving live events" : "Reconnecting to event stream"}>
          {connected ? "Live" : "Offline"}
        </span>
      </div>

      <div className="panel-scroll">
        <div className="panel-block">
          <div className="micro-label">Objective</div>
          <p className="objective">{mission.plan?.objective ?? mission.prompt}</p>
          <div className="progress" aria-label={`${done} of ${mission.steps.length} steps finished`}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-meta">
            <span>
              {done}/{mission.steps.length} steps
            </span>
            <span>{captured} pages captured{manual ? ` + ${manual} manual` : ""}</span>
            <span>{evidence} observations</span>
          </div>
        </div>

        {current && (
          <div className="panel-block current">
            <div className="micro-label">Current step</div>
            <div className="current-step">
              <StepIcon s={current} />
              <div>
                <div className="current-title">{current.title}</div>
                <div className="current-meta">
                  <code>{current.tool}</code> · {duration(current.startedAt)}
                </div>
              </div>
            </div>
          </div>
        )}

        {pending.map((a) => (
          <div key={a.id} className="panel-block approval" role="alertdialog" aria-label="Approval required">
            <div className="approval-head">
              <ShieldAlert size={16} aria-hidden /> Approval required
            </div>
            <div className="approval-title">{a.title}</div>
            <div className="approval-reason">{a.reason}</div>
            <div className="row-end">
              <Button size="sm" variant="ghost" onClick={() => onApproval(a.id, false)}>
                Deny
              </Button>
              <Button size="sm" variant="primary" onClick={() => onApproval(a.id, true)}>
                Approve
              </Button>
            </div>
          </div>
        ))}

        {mission.error && (
          <div className="panel-block failure">
            <AlertOctagon size={16} aria-hidden />
            <div>{mission.error}</div>
          </div>
        )}

        {failures.length > 0 && (
          <div className="panel-block">
            <SectionTitle count={failures.length}>Errors and recovery</SectionTitle>
            <ul className="errors">
              {failures.map((s) => (
                <li key={s.id}>
                  <div className="err-title">{s.title}</div>
                  <div className="err-msg">{s.error?.message}</div>
                  {s.error?.recovery && <div className="err-recovery">{s.error.recovery}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {mission.steps.length > 0 && (
          <div className="panel-block">
            <SectionTitle count={mission.steps.length}>Steps</SectionTitle>
            <ol className="steps">
              {mission.steps.map((s) => (
                <li key={s.id} className={`step status-${s.status}`}>
                  <StepIcon s={s} />
                  <div className="step-body">
                    <div className="step-title">{s.title}</div>
                    <div className="step-meta">
                      <code>{s.tool}</code>
                      {s.startedAt && <span>{duration(s.startedAt, s.finishedAt)}</span>}
                      {s.attempts > 1 && <span>{s.attempts} attempts</span>}
                    </div>
                    {s.resultSummary && <div className="step-result">{s.resultSummary}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {mission.summary && (
          <div className="panel-block">
            <SectionTitle>Verification</SectionTitle>
            <div className="verify-mini">
              <span className="tone-success-fg">
                <ShieldCheck size={14} aria-hidden /> {mission.summary.checksPassed} passed
              </span>
              <span className={mission.summary.checksFailed ? "tone-danger-fg" : "tone-muted-fg"}>
                <XCircle size={14} aria-hidden /> {mission.summary.checksFailed} failed
              </span>
              <span className={mission.summary.checksWarned ? "tone-warning-fg" : "tone-muted-fg"}>
                <CircleDashed size={14} aria-hidden /> {mission.summary.checksWarned} {mission.summary.checksWarned === 1 ? "warning" : "warnings"}
              </span>
            </div>
          </div>
        )}

        <div className="panel-block grow">
          <SectionTitle count={mission.activity.length}>Live tool activity</SectionTitle>
          <Activity entries={mission.activity} />
        </div>
      </div>
    </aside>
  );
}
