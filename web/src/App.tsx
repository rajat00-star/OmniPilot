import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, LazyMotion, MotionConfig, m } from "motion/react";
import { FileSearch, FlaskConical, Globe, Hand, ListChecks, Pause, Play, Presentation, ShieldCheck, Square, Table2 } from "lucide-react";
import { api, ApiError, useMissionStream, type Health, type Mission, type MissionListItem, type MissionStatus, type Target } from "./lib/api";
import { MISSION_LABEL, MISSION_TONE, isActive, isDone } from "./lib/format";
import { fade, rise, sequence, view as viewMotion } from "./lib/motion";
import { prefs } from "./lib/prefs";
import { sound } from "./lib/sound";
import { CoreAnchor, CoreProvider, useCore, type CoreMode } from "./components/core/OmniCore";
import { HistoryDrawer, TopBar } from "./components/TopBar";
import { Composer } from "./components/Composer";
import { PlanReview, StepGraph, stages } from "./components/PlanReview";
import { BrowserSurface } from "./components/BrowserSurface";
import { ExecutionDetails, JourneyRail, LiveWorkspace, OutcomeBanner, finishedSteps } from "./components/Execution";
import { EvidenceView, ResultsView, VerificationView } from "./components/Results";
import { JudgeView } from "./components/JudgeView";
import { isDisplayed } from "./lib/dashboard";
import { Badge, Button, Orbit, StatusDot } from "./components/ui";

type View = "browser" | "plan" | "results" | "evidence" | "verification";

const VIEWS: { id: View; label: string; icon: typeof Globe }[] = [
  { id: "results", label: "Results", icon: Table2 },
  { id: "browser", label: "Browser", icon: Globe },
  { id: "evidence", label: "Evidence", icon: FileSearch },
  { id: "verification", label: "Verification", icon: ShieldCheck },
  { id: "plan", label: "Plan", icon: ListChecks },
];

/** The core's state for each mission status. */
const CORE_MODE: Record<MissionStatus, CoreMode> = {
  draft: "idle",
  planning: "planning",
  awaiting_approval: "review",
  running: "executing",
  paused: "paused",
  verifying: "verifying",
  completed: "success",
  completed_with_warnings: "warning",
  failed: "error",
  cancelled: "cancelled",
};

interface Route {
  id?: string;
  /** #/judge/<id>: the read-only presentation view of a finished mission. */
  judge: boolean;
}

export function parseHash(hash: string): Route {
  if (hash.startsWith("#/judge/")) return { id: decodeURIComponent(hash.slice(8)) || undefined, judge: true };
  if (hash.startsWith("#/m/")) return { id: hash.slice(4) || undefined, judge: false };
  return { judge: false };
}

export const judgeHash = (id: string) => `#/judge/${encodeURIComponent(id)}`;

function useHashSelection(): [Route, (id?: string) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, (next) => (location.hash = next ? `#/m/${next}` : "#/")];
}

/** With sound left on from an earlier visit, the audio context may only start on this visit's first gesture. */
function useSoundUnlock() {
  useEffect(() => {
    if (!prefs.get().sound) return;
    const unlock = (e: Event) => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      const quiet = (e.target as Element | null)?.closest?.(".sound-btn, .settings-panel");
      void sound.unlock().then((ok) => ok && !quiet && sound.play("ready"));
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, []);
}

// Motion's animation features load in their own chunk; components render immediately and animate once it lands.
const motionFeatures = () => import("./lib/motion-features").then((mod) => mod.default);

export function App() {
  const [route, select] = useHashSelection();
  useSoundUnlock();
  return (
    <LazyMotion features={motionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <CoreProvider enabled={!(route.judge && route.id)}>
          <Shell route={route} select={select} />
        </CoreProvider>
      </MotionConfig>
    </LazyMotion>
  );
}

const FINISHED = ["succeeded", "failed", "skipped", "cancelled"];
const completedStages = (m: Mission) => stages(m.steps).filter((g) => g.every((s) => FINISHED.includes(s.status))).length;

function Shell({ route, select }: { route: Route; select(id?: string): void }) {
  const { id: selectedId, judge } = route;
  const [health, setHealth] = useState<Health>();
  const [healthError, setHealthError] = useState<string>();
  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const { mission: streamed, connected } = useMissionStream(selectedId);
  const [created, setCreated] = useState<Mission>();
  const [view, setView] = useState<View>("results");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [flash, setFlash] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState({ prompt: "", n: 0 });
  const [composerFocused, setComposerFocused] = useState(false);
  const core = useCore();
  const stopRequested = useRef(false);
  const seen = useRef<{ id?: string; status?: MissionStatus; activity: number; stages: number }>({ activity: 0, stages: 0 });

  // The create response is shown at once; the live stream replaces it a moment later, and it is never reused.
  const mission = streamed && streamed.id === selectedId ? streamed : created && created.id === selectedId ? created : undefined;
  const status = mission?.status;
  useEffect(() => {
    if (created && (created.id !== selectedId || streamed?.id === created.id)) setCreated(undefined);
  }, [created, selectedId, streamed]);

  // Navigating (Back, a link, judge mode) always leaves the history drawer closed.
  useEffect(() => setHistoryOpen(false), [selectedId, judge]);

  const refreshList = useCallback(() => api.missions().then(setMissions).catch(() => {}), []);

  useEffect(() => {
    const load = () =>
      api
        .health()
        .then((h) => {
          setHealth(h);
          setHealthError(undefined);
        })
        .catch((e) => setHealthError((e as Error).message));
    load();
    refreshList();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [refreshList]);

  useEffect(() => {
    if (status) refreshList();
  }, [status, mission?.artifacts.length, refreshList]);

  // Finished missions open on their results.
  useEffect(() => {
    if (status && isDone(status)) setView("results");
  }, [status, selectedId]);

  // A failed action shows its message and tints the core briefly; nothing else is implied.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 2400);
    return () => clearTimeout(t);
  }, [flash]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}${e.recovery ? ` ${e.recovery}` : ""}` : (e as Error).message);
      setFlash(true);
      sound.play("error");
    } finally {
      setBusy(false);
    }
  }, []);

  const create = (prompt: string, productName: string, pitch: string) =>
    act(async () => {
      const m = await api.create(prompt, productName, pitch);
      seen.current = { id: m.id, status: m.status, activity: m.activity.length, stages: completedStages(m) };
      setCreated(m);
      sound.play("plan");
      void refreshList();
      select(m.id);
    });

  // Core state comes only from what the app knows: the request in flight, focus, or the mission's recorded status.
  const coreMode: CoreMode = flash ? "error" : !selectedId ? (busy ? "planning" : composerFocused ? "focus" : "idle") : mission ? CORE_MODE[mission.status] : "idle";
  useEffect(() => core.setMode(coreMode), [core, coreMode]);

  const total = mission?.steps.length ?? 0;
  const done = mission ? finishedSteps(mission) : 0;
  const progressVisible = Boolean(mission && mission.status !== "awaiting_approval" && mission.status !== "planning" && mission.status !== "draft" && total > 0);
  useEffect(() => core.setProgress(total ? done / total : 0, total, progressVisible), [core, done, total, progressVisible]);

  // Real events drive pulses and sounds. The first snapshot of a mission is only recorded, so opening an old
  // mission from history never replays its completion.
  useEffect(() => {
    if (!mission) return;
    const prev = seen.current;
    const stageCount = completedStages(mission);
    const next = { id: mission.id, status: mission.status, activity: mission.activity.length, stages: stageCount };
    seen.current = next;
    if (prev.id !== mission.id) return;
    const live = mission.status === "running" || mission.status === "verifying";
    const fresh = mission.activity.length - prev.activity;
    if (fresh > 0 && (live || prev.status === "running" || prev.status === "verifying")) {
      const errored = mission.activity.slice(-fresh).some((a) => a.level === "error");
      core.pulse(errored ? 0.45 : Math.min(1, 0.45 + 0.12 * fresh));
    }
    if (stageCount > prev.stages && live) sound.play("milestone");
    if (prev.status === mission.status) return;
    switch (mission.status) {
      case "verifying":
        sound.play("milestone");
        break;
      case "completed":
        sound.play("success");
        core.celebrate();
        break;
      case "completed_with_warnings":
        sound.play("warning");
        core.celebrate();
        break;
      case "failed":
        sound.play("error");
        break;
      case "cancelled":
        if (!stopRequested.current) sound.play("cancel");
        break;
    }
    stopRequested.current = false;
  }, [mission, core]);

  const onFocusChange = useCallback((f: boolean) => setComposerFocused(f), []);

  const exitJudge = useCallback(() => {
    if (selectedId) location.hash = `#/m/${selectedId}`;
  }, [selectedId]);

  if (judge && selectedId) return <JudgeView mission={mission} missionId={selectedId} onExit={exitJudge} />;

  const fixture = health?.dataSource === "fixture" || mission?.dataSource === "fixture";
  const goNew = () => {
    setError(undefined);
    select(undefined);
  };
  const coreLabel = `OmniPilot core: ${mission ? MISSION_LABEL[mission.status] : busy ? "planning" : "ready"}`;

  return (
    <div className={`app ${selectedId ? "is-mission" : "is-home"}`} data-core={core.engine}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar health={health} healthError={healthError} missionCount={missions.length} home={!selectedId} onNew={goNew} onHistory={() => setHistoryOpen(true)} />
      {fixture && (
        <div className="fixture-strip" role="note">
          <FlaskConical size={14} aria-hidden />
          <strong>Offline demo mode</strong>
          <span>Fixture data from five fictional vendor sites running on this machine. Nothing is fetched from the internet. This is not live research.</span>
        </div>
      )}

      <main className="workspace" id="main" tabIndex={-1}>
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={selectedId ?? "home"} className="view" variants={viewMotion} initial="hidden" animate="show" exit="exit">
            {!selectedId ? (
              <Composer key={draft.n} initialPrompt={draft.prompt} health={health} busy={busy} error={error} coreLabel={coreLabel} onFocusChange={onFocusChange} onSubmit={create} />
            ) : !mission ? (
              <div className="loading-state" role="status">
                <Orbit size={20} /> Loading mission…
              </div>
            ) : (
              <MissionWorkspace
                mission={mission}
                health={health}
                connected={connected}
                view={view}
                setView={setView}
                busy={busy}
                error={error}
                act={act}
                coreLabel={coreLabel}
                onStop={() => {
                  stopRequested.current = true;
                  sound.play("cancel");
                }}
                onEngage={() => {
                  sound.play("engage");
                  core.pulse(0.9);
                }}
                onRunAgain={(prompt) => {
                  setDraft((d) => ({ prompt, n: d.n + 1 }));
                  goNew();
                }}
              />
            )}
          </m.div>
        </AnimatePresence>
      </main>

      <HistoryDrawer
        open={historyOpen}
        missions={missions}
        selectedId={selectedId}
        onSelect={(id) => {
          setError(undefined);
          select(id);
        }}
        onNew={goNew}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}

interface WsProps {
  mission: Mission;
  health?: Health;
  connected: boolean;
  view: View;
  setView(v: View): void;
  busy: boolean;
  error?: string;
  coreLabel: string;
  act(fn: () => Promise<unknown>): Promise<void>;
  onStop(): void;
  onEngage(): void;
  onRunAgain(prompt: string): void;
}

function MissionWorkspace({ mission, health, connected, view, setView, busy, error, coreLabel, act, onStop, onEngage, onRunAgain }: WsProps) {
  const s = mission.status;
  const running = s === "running" || s === "verifying";
  const done = isDone(s);
  const counts: Partial<Record<View, number>> = {
    evidence: mission.observations.length || undefined,
    verification: mission.checks.length || undefined,
    results: mission.artifacts.length || undefined,
  };
  const browse = (url: string) => act(() => api.browse(mission.id, url));
  const approval = (aid: string, ok: boolean) => act(() => api.resolveApproval(mission.id, aid, ok));
  return (
    <m.div className="mission" variants={sequence(0.07)} initial="hidden" animate="show">
      <header className="m-head">
        <m.div className="m-head-text" variants={rise}>
          <div className="mission-status-line">
            <Badge tone={MISSION_TONE[s]}>
              <StatusDot tone={MISSION_TONE[s]} pulse={isActive(s)} />
              {MISSION_LABEL[s]}
            </Badge>
            <span className="mission-id mono">{mission.id}</span>
            <span className="mission-mode">{mission.mode === "claude" ? "Claude reasoning" : "Rule-based"}</span>
            <span className="mission-mode">{mission.dataSource === "fixture" ? "Offline fixture data" : "Live web"}</span>
          </div>
          <h1 className="mission-title" title={mission.prompt}>
            {mission.prompt}
          </h1>
          <div className="mission-controls">
            {isDisplayed(s) && Boolean(mission.analysis) && (
              <Button size="sm" icon={Presentation} onClick={() => (location.hash = judgeHash(mission.id))} title="Read-only presentation of these results">
                Judge mode
              </Button>
            )}
            {s === "running" && (
              <>
                <Button size="sm" icon={Pause} onClick={() => act(() => api.pause(mission.id))} disabled={busy}>
                  Pause
                </Button>
                <Button
                  size="sm"
                  icon={Hand}
                  onClick={() => act(() => api.takeover(mission.id))}
                  disabled={busy}
                  title={
                    health?.browser.headed
                      ? "Pause the agent and use the visible Chromium window or the address bar"
                      : "Pause the agent and drive the browser from the address bar. Run with OMNIPILOT_HEADED=1 for a visible window."
                  }
                >
                  Take over
                </Button>
              </>
            )}
            {s === "paused" && (
              <Button
                size="sm"
                variant="primary"
                icon={Play}
                onClick={() => {
                  onEngage();
                  void act(() => api.resume(mission.id));
                }}
                disabled={busy}
              >
                Resume agent
              </Button>
            )}
            {(running || s === "paused") && (
              <Button
                size="sm"
                variant="danger"
                icon={Square}
                onClick={() => {
                  onStop();
                  void act(() => api.cancel(mission.id));
                }}
                disabled={busy}
              >
                Stop
              </Button>
            )}
          </div>
        </m.div>
        <m.div className="m-head-core" variants={fade}>
          <CoreAnchor size="compact" label={coreLabel} />
        </m.div>
      </header>

      <m.div variants={rise}>
        <JourneyRail mission={mission} />
      </m.div>

      {s === "paused" && (
        <div className="callout warn">
          <Hand size={16} aria-hidden />
          <span>
            You have control. The agent is holding before its next browser action.{" "}
            {health?.browser.headed ? "Use the visible Chromium window or the address bar below, then resume." : "Use the address bar below to open pages manually, then resume. (Headless mode: there is no visible window to click in.)"}
          </span>
        </div>
      )}

      <m.div variants={rise} className="m-body">
        {s === "awaiting_approval" ? (
          <PlanReview
            mission={mission}
            busy={busy}
            error={error}
            onSaveTargets={(targets: Target[]) => act(() => api.updateTargets(mission.id, targets))}
            onApprove={() => {
              onEngage();
              void act(() => api.approve(mission.id));
            }}
            onCancel={() => act(() => api.cancel(mission.id))}
          />
        ) : !done ? (
          <LiveWorkspace mission={mission} health={health} connected={connected} error={error} onApproval={approval} onBrowse={browse} />
        ) : (
          <>
            <OutcomeBanner mission={mission} onRunAgain={onRunAgain} />
            <div
              className="viewtabs"
              role="tablist"
              aria-label="Mission views"
              onKeyDown={(e) => {
                const i = VIEWS.findIndex((v) => v.id === view);
                const keys: Record<string, number> = { ArrowRight: (i + 1) % VIEWS.length, ArrowLeft: (i - 1 + VIEWS.length) % VIEWS.length, Home: 0, End: VIEWS.length - 1 };
                const next = keys[e.key];
                if (next === undefined) return;
                e.preventDefault();
                setView(VIEWS[next].id);
                document.getElementById(`tab-${VIEWS[next].id}`)?.focus();
              }}
            >
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  id={`tab-${v.id}`}
                  role="tab"
                  aria-selected={view === v.id}
                  aria-controls="mission-view"
                  tabIndex={view === v.id ? 0 : -1}
                  className={`viewtab ${view === v.id ? "active" : ""}`}
                  onClick={() => setView(v.id)}
                >
                  <v.icon size={15} aria-hidden />
                  {v.label}
                  {counts[v.id] !== undefined && <span className="count">{counts[v.id]}</span>}
                  {view === v.id && <m.span className="viewtab-ink" layoutId="viewtab-ink" transition={{ type: "spring", stiffness: 420, damping: 38 }} />}
                </button>
              ))}
            </div>
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <div className="view-body" key={view} id="mission-view" role="tabpanel" aria-labelledby={`tab-${view}`}>
              {view === "browser" && <BrowserSurface mission={mission} health={health} onBrowse={browse} />}
              {view === "plan" && (
                <div className="results">
                  <section className="card">
                    <StepGraph steps={mission.steps} />
                  </section>
                </div>
              )}
              {view === "results" && <ResultsView mission={mission} health={health} busy={busy} onReadPricing={() => act(() => api.readPricing(mission.id))} />}
              {view === "evidence" && <EvidenceView mission={mission} />}
              {view === "verification" && <VerificationView mission={mission} />}
            </div>
          </>
        )}
      </m.div>

      {s !== "awaiting_approval" && mission.steps.length > 0 && <ExecutionDetails mission={mission} />}
    </m.div>
  );
}
