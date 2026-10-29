import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronDown, Circle, CircleDashed, CircleSlash, Download, Hand, RotateCcw, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import type { ActivityEntry, Health, Mission, StepRun } from "../lib/api";
import { fileUrl } from "../lib/api";
import { STEP_LABEL, clock, duration, host } from "../lib/format";
import { ease } from "../lib/motion";
import { BrowserSurface } from "./BrowserSurface";
import { stages } from "./PlanReview";
import { Button, Orbit, SectionTitle, StatusDot } from "./ui";

const FINISHED = ["succeeded", "failed", "skipped", "cancelled"];
export const finishedSteps = (m: Mission) => m.steps.filter((s) => FINISHED.includes(s.status)).length;

export function StepIcon({ s }: { s: StepRun }) {
  switch (s.status) {
    case "running":
      return <Orbit size={15} />;
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

/** Re-renders a component every `ms` while `active`, for elapsed times. */
function useTick(active: boolean, ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

const JOURNEY = ["Describe", "Plan", "Approve", "Execute", "Verify", "Results"] as const;

/** Where the mission is on the journey, derived only from its recorded status. */
function journeyIndex(m: Mission): { at: number; end?: "failed" | "cancelled" } {
  switch (m.status) {
    case "draft":
    case "planning":
      return { at: 1 };
    case "awaiting_approval":
      return { at: 2 };
    case "running":
    case "paused":
      return { at: 3 };
    case "verifying":
      return { at: 4 };
    case "completed":
    case "completed_with_warnings":
      return { at: 6 };
    case "failed":
    case "cancelled": {
      const at = m.checks.length ? 4 : m.steps.some((s) => s.startedAt) ? 3 : m.plan ? 2 : 1;
      return { at, end: m.status };
    }
  }
}

export function JourneyRail({ mission }: { mission: Mission }) {
  const { at, end } = journeyIndex(mission);
  return (
    <ol className="journey" aria-label="Mission progress" data-live={mission.status === "running" || mission.status === "verifying" || undefined}>
      {JOURNEY.map((label, i) => {
        const state = i < at ? "done" : i === at ? (end ?? "current") : "todo";
        return (
          <li key={label} className={`journey-step ${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="journey-bar">
              <m.span className="journey-fill" initial={false} animate={{ scaleX: state === "todo" ? 0 : 1 }} transition={{ duration: 0.7, ease: ease.out, delay: 0.05 * i }} />
            </span>
            <span className="journey-label">
              {label}
              <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (in progress)" : state === "todo" ? " (not started)" : ` (${state})`}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepTrack({ steps }: { steps: StepRun[] }) {
  const done = steps.filter((s) => FINISHED.includes(s.status)).length;
  return (
    <div className="track" role="img" aria-label={`${done} of ${steps.length} steps finished`}>
      {steps.map((s) => (
        <span key={s.id} className={`seg status-${s.status}`} />
      ))}
    </div>
  );
}

function NowCard({ mission, connected }: { mission: Mission; connected: boolean }) {
  const current = mission.steps.find((s) => s.status === "running") ?? mission.steps.find((s) => s.status === "waiting_approval");
  const paused = mission.status === "paused";
  useTick(Boolean(current) && !paused);
  const done = finishedSteps(mission);
  const total = mission.steps.length;
  const title = paused ? "Paused: you have control" : mission.status === "verifying" ? "Verifying every artifact" : (current?.title ?? "Preparing the next step");
  const key = paused ? "paused" : mission.status === "verifying" ? "verifying" : (current?.id ?? "between");
  return (
    <section className="now" aria-label="Current activity">
      <div className="now-top">
        <span className={`now-kicker ${paused ? "paused" : ""}`}>{paused ? "Holding" : mission.status === "verifying" ? "Verify" : "Execute"}</span>
        <span className={`live ${connected ? "on" : ""}`} title={connected ? "Receiving live events from the server" : "Reconnecting to the event stream"}>
          {connected ? "Live" : "Reconnecting"}
        </span>
      </div>
      <div className="now-step-wrap" aria-live="polite" aria-atomic="true">
        <AnimatePresence mode="popLayout" initial={false}>
          <m.div key={key} className="now-step" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.36, ease: ease.out }}>
            <div className="now-title">{title}</div>
          </m.div>
        </AnimatePresence>
      </div>
      <div className="now-meta">
        {paused ? (current ? `Resumes with: ${current.title}` : "The agent resumes from its next step") : current ? (
          <>
            <code>{current.tool}</code>
            <span>running {duration(current.startedAt)}</span>
            {current.attempts > 1 && <span>attempt {current.attempts}</span>}
          </>
        ) : mission.status === "verifying" ? (
          "Reading each file back from disk and re-matching every quote"
        ) : (
          "Waiting for the next step to start"
        )}
      </div>
      <StepTrack steps={mission.steps} />
      <div className="now-foot">
        <span>
          {done} of {total} steps finished
        </span>
        {mission.steps.some((s) => s.status === "failed") && <span className="tone-danger-fg">{mission.steps.filter((s) => s.status === "failed").length} failed</span>}
      </div>
    </section>
  );
}

const PlanTimeline = memo(
  function PlanTimeline({ steps }: { steps: StepRun[] }) {
    const groups = useMemo(() => stages(steps), [steps]);
    return (
      <section className="aside-block" aria-labelledby="tl-title">
        <h3 className="aside-title" id="tl-title">
          Plan <span className="count">{steps.length}</span>
        </h3>
        <ol className="timeline">
          {groups.map((g, i) => (
            <li key={i} className="tl-stage">
              <div className="tl-stage-label">
                Stage {i + 1}
                {g.length > 1 ? ` · ${g.length} in parallel` : ""}
              </div>
              <ul>
                {g.map((s) => (
                  <li key={s.id} className={`tl-step status-${s.status}`}>
                    <span className="tl-icon" key={s.status}>
                      <StepIcon s={s} />
                    </span>
                    <span className="tl-title">{s.title}</span>
                    <span className="tl-meta">{s.finishedAt ? duration(s.startedAt, s.finishedAt) : ""}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    );
  },
  (a, b) => a.steps.map((s) => s.status + (s.finishedAt ?? "")).join() === b.steps.map((s) => s.status + (s.finishedAt ?? "")).join() && a.steps.length === b.steps.length,
);

function Signal({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="signal">
      <dt>{label}</dt>
      <dd>
        <m.span key={String(value)} className="signal-value" initial={{ opacity: 0.35, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: ease.out }}>
          {value}
        </m.span>
        {sub && <span className="signal-sub">{sub}</span>}
      </dd>
    </div>
  );
}

function Signals({ mission }: { mission: Mission }) {
  const pages = mission.sources.filter((s) => s.ok && s.targetId !== "manual").length;
  const failedPages = mission.sources.filter((s) => !s.ok).length;
  const observations = mission.observations.filter((o) => o.kind === "observation").length;
  const passed = mission.checks.filter((c) => c.status === "passed").length;
  return (
    <section className="aside-block" aria-label="Collected so far">
      <dl className="signals">
        <Signal label="Pages captured" value={pages} sub={failedPages ? `${failedPages} failed` : undefined} />
        <Signal label="Observations" value={observations} />
        <Signal label="Files written" value={mission.artifacts.length} />
        <Signal label="Checks passed" value={mission.checks.length ? `${passed}/${mission.checks.length}` : "Not run"} />
      </dl>
    </section>
  );
}

const RecentActivity = memo(
  function RecentActivity({ entries }: { entries: ActivityEntry[] }) {
    const recent = entries.slice(-5).reverse();
    return (
      <section className="aside-block" aria-labelledby="feed-title">
        <h3 className="aside-title" id="feed-title">
          Activity
        </h3>
        <ol className="feed">
          <AnimatePresence initial={false}>
            {recent.map((a) => (
              <m.li
                key={a.id}
                layout="position"
                className={`feed-item level-${a.level}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ duration: 0.32, ease: ease.out }}
              >
                <span className="feed-time">{clock(a.at)}</span>
                {a.tool && <code className="feed-tool">{a.tool}</code>}
                <span className="feed-msg">{a.message}</span>
              </m.li>
            ))}
          </AnimatePresence>
        </ol>
      </section>
    );
  },
  (a, b) => a.entries.length === b.entries.length,
);

function SourcesSoFar({ mission }: { mission: Mission }) {
  const recent = mission.sources.slice(-4).reverse();
  if (!recent.length) return null;
  return (
    <section className="aside-block" aria-labelledby="src-so-far">
      <h3 className="aside-title" id="src-so-far">
        Evidence captured <span className="count">{mission.sources.filter((s) => s.ok).length}</span>
      </h3>
      <ul className="src-mini">
        {recent.map((s) => {
          const url = s.finalUrl ?? s.requestedUrl;
          return (
            <li key={s.id} className={s.ok ? "" : "failed"}>
              <StatusDot tone={s.ok ? "success" : "danger"} />
              <span className="src-mini-text">
                <span className="src-mini-title">{s.ok ? (s.title ?? s.targetName) : `${s.targetName}: ${s.error ?? "not captured"}`}</span>
                <a className="mono" href={url} target="_blank" rel="noreferrer noopener">
                  {host(url)}
                </a>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Approvals the run is waiting on, the mission error, and failed steps with their recovery hints. */
export function MissionAlerts({ mission, onApproval }: { mission: Mission; onApproval(id: string, approved: boolean): void }) {
  const pending = mission.approvals.filter((a) => !a.resolution);
  const failures = mission.steps.filter((s) => s.status === "failed");
  if (!pending.length && !mission.error && !failures.length) return null;
  return (
    <div className="alerts">
      {pending.map((a) => (
        <div key={a.id} className="callout approval" role="alertdialog" aria-labelledby={`appr-${a.id}`}>
          <ShieldAlert size={16} aria-hidden />
          <div className="approval-body">
            <div id={`appr-${a.id}`} className="approval-title">
              Approval required: {a.title}
            </div>
            <div className="approval-reason">{a.reason}</div>
          </div>
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
        <div className="callout danger" role="alert">
          <AlertOctagon size={16} aria-hidden />
          <span>{mission.error}</span>
        </div>
      )}
      {failures.length > 0 && (
        <div className="callout danger-soft">
          <XCircle size={16} aria-hidden />
          <div>
            <div className="approval-title">
              {failures.length} step{failures.length === 1 ? "" : "s"} failed
            </div>
            <ul className="errors">
              {failures.map((s) => (
                <li key={s.id}>
                  <span className="err-title">{s.title}:</span> <span className="err-msg">{s.error?.message}</span>
                  {s.error?.recovery && <div className="err-recovery">{s.error.recovery}</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

interface LiveProps {
  mission: Mission;
  health?: Health;
  connected: boolean;
  error?: string;
  onApproval(id: string, approved: boolean): void;
  onBrowse(url: string): Promise<void>;
}

/** The execution workspace: what is happening now and the real browser on the left, the plan and evidence on the right. */
export function LiveWorkspace({ mission, health, connected, error, onApproval, onBrowse }: LiveProps) {
  return (
    <div className="live-grid">
      <div className="live-main">
        <NowCard mission={mission} connected={connected} />
        <MissionAlerts mission={mission} onApproval={onApproval} />
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <BrowserSurface mission={mission} health={health} onBrowse={onBrowse} />
      </div>
      <aside className="live-aside" aria-label="Plan and evidence">
        <Signals mission={mission} />
        <PlanTimeline steps={mission.steps} />
        <RecentActivity entries={mission.activity} />
        <SourcesSoFar mission={mission} />
      </aside>
    </div>
  );
}

interface OutcomeProps {
  mission: Mission;
  onRunAgain(prompt: string): void;
}

/** How the mission ended, in one band: verified counts or the error, and the next useful action. */
export function OutcomeBanner({ mission, onRunAgain }: OutcomeProps) {
  const s = mission.status;
  const kind = s === "completed" ? "success" : s === "completed_with_warnings" ? "warning" : s === "failed" ? "error" : "cancelled";
  const sum = mission.summary;
  const totalChecks = sum ? sum.checksPassed + sum.checksFailed + sum.checksWarned : 0;
  const report = mission.artifacts.find((a) => a.kind === "markdown" && /report/i.test(a.filename) && !/verification/i.test(a.filename));
  const failed = mission.steps.find((x) => x.status === "failed");
  const Icon = kind === "success" ? ShieldCheck : kind === "warning" ? AlertTriangle : kind === "error" ? AlertOctagon : CircleSlash;
  const title = { success: "Mission complete", warning: "Complete, with warnings", error: "Mission failed", cancelled: "Mission stopped" }[kind];
  return (
    <m.section
      className={`outcome ${kind}`}
      aria-label={title}
      initial={{ opacity: 0, y: 14, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, ease: ease.out }}
    >
      <div className="outcome-icon">
        <Icon size={20} aria-hidden />
      </div>
      <div className="outcome-body">
        <h2 className="outcome-title">{title}</h2>
        {(kind === "success" || kind === "warning") && sum && (
          <p className="outcome-line">
            {sum.checksPassed} of {totalChecks} checks passed · {mission.artifacts.length} files verified on disk · {sum.sourcesCaptured} of {sum.sourcesAttempted} pages captured
            {sum.observationsTotal ? ` · ${sum.observationsGrounded} of ${sum.observationsTotal} quotes re-matched` : ""}
          </p>
        )}
        {kind === "warning" && mission.warnings.length > 0 && (
          <ul className="outcome-list">
            {mission.warnings.slice(0, 3).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {kind === "error" && (
          <p className="outcome-line">
            {mission.error ?? failed?.error?.message ?? "A critical step failed."}
            {failed?.error?.recovery ? ` ${failed.error.recovery}` : ""}
          </p>
        )}
        {kind === "cancelled" && (
          <p className="outcome-line">
            Stopped on request. {mission.steps.filter((x) => x.status === "succeeded").length} of {mission.steps.length} steps had completed; nothing after that point ran.
          </p>
        )}
      </div>
      <div className="outcome-actions">
        {report && (kind === "success" || kind === "warning") && (
          <a className="btn btn-secondary btn-sm" href={fileUrl(mission.id, report.filename, true)}>
            <Download size={14} aria-hidden />
            <span>Download report</span>
          </a>
        )}
        {(kind === "error" || kind === "cancelled") && (
          <Button size="sm" variant="primary" icon={RotateCcw} onClick={() => onRunAgain(mission.prompt)}>
            Run it again
          </Button>
        )}
      </div>
    </m.section>
  );
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
      tabIndex={0}
      aria-label="Tool activity log"
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

/** Every step and the raw tool log, collapsed by default. */
export function ExecutionDetails({ mission }: { mission: Mission }) {
  return (
    <details className="disclosure">
      <summary>
        <ChevronDown size={15} aria-hidden className="chev" />
        Execution details
        <span className="disclosure-meta">
          {mission.steps.length} steps · {mission.activity.length} events
        </span>
      </summary>
      <div className="disclosure-body exec-details">
        <div>
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
          {mission.summary && (
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
          )}
        </div>
        <div className="exec-log">
          <SectionTitle count={mission.activity.length}>Tool activity</SectionTitle>
          <Activity entries={mission.activity} />
        </div>
      </div>
    </details>
  );
}

