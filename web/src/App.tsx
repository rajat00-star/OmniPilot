import { useCallback, useEffect, useState } from "react";
import { FileSearch, Globe, Hand, ListChecks, Loader2, Pause, Play, ShieldCheck, Square, Table2 } from "lucide-react";
import { api, ApiError, useMissionStream, type Health, type Mission, type MissionListItem, type Target } from "./lib/api";
import { MISSION_LABEL, MISSION_TONE, isActive, isDone } from "./lib/format";
import { Sidebar } from "./components/Sidebar";
import { Composer } from "./components/Composer";
import { PlanReview, StepGraph } from "./components/PlanReview";
import { BrowserSurface } from "./components/BrowserSurface";
import { AgentPanel } from "./components/AgentPanel";
import { EvidenceView, ResultsView, VerificationView } from "./components/Results";
import { Badge, Button, StatusDot } from "./components/ui";

type View = "browser" | "plan" | "results" | "evidence" | "verification";

const VIEWS: { id: View; label: string; icon: typeof Globe }[] = [
  { id: "browser", label: "Browser", icon: Globe },
  { id: "plan", label: "Plan", icon: ListChecks },
  { id: "results", label: "Results", icon: Table2 },
  { id: "evidence", label: "Evidence", icon: FileSearch },
  { id: "verification", label: "Verification", icon: ShieldCheck },
];

function useHashSelection(): [string | undefined, (id?: string) => void] {
  const read = () => (location.hash.startsWith("#/m/") ? location.hash.slice(4) : undefined);
  const [id, setId] = useState<string | undefined>(read);
  useEffect(() => {
    const on = () => setId(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [id, (next) => (location.hash = next ? `#/m/${next}` : "#/")];
}

export function App() {
  const [health, setHealth] = useState<Health>();
  const [healthError, setHealthError] = useState<string>();
  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [selectedId, select] = useHashSelection();
  const { mission: streamed, connected } = useMissionStream(selectedId);
  const [view, setView] = useState<View>("browser");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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

  const mission = streamed && streamed.id === selectedId ? streamed : undefined;
  const status = mission?.status;

  // Keep the sidebar list in sync with live status changes.
  useEffect(() => {
    if (status) refreshList();
  }, [status, mission?.artifacts.length, refreshList]);

  // Pick a sensible default view per mission phase.
  useEffect(() => {
    if (!status) return;
    if (status === "awaiting_approval") setView("plan");
    else if (status === "running" || status === "planning") setView("browser");
    else if (isDone(status)) setView("results");
  }, [status, selectedId]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}${e.recovery ? ` ${e.recovery}` : ""}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = (prompt: string, productName: string, pitch: string) =>
    act(async () => {
      const m = await api.create(prompt, productName, pitch);
      await refreshList();
      select(m.id);
    });

  return (
    <div className="app">
      <Sidebar
        missions={missions}
        selectedId={selectedId}
        current={mission}
        health={health}
        healthError={healthError}
        onSelect={(id) => {
          setError(undefined);
          select(id);
        }}
        onNew={() => {
          setError(undefined);
          select(undefined);
        }}
      />

      <main className="workspace">
        {!selectedId ? (
          <Composer health={health} busy={busy} error={error} onSubmit={create} />
        ) : !mission ? (
          <div className="loading-state">
            <Loader2 className="spin" size={20} aria-hidden /> Loading mission…
          </div>
        ) : (
          <MissionWorkspace mission={mission} health={health} view={view} setView={setView} busy={busy} error={error} act={act} />
        )}
      </main>

      <AgentPanel mission={mission} connected={connected} onApproval={(aid, ok) => mission && act(() => api.resolveApproval(mission.id, aid, ok))} />
    </div>
  );
}

interface WsProps {
  mission: Mission;
  health?: Health;
  view: View;
  setView(v: View): void;
  busy: boolean;
  error?: string;
  act(fn: () => Promise<unknown>): Promise<void>;
}

function MissionWorkspace({ mission, health, view, setView, busy, error, act }: WsProps) {
  const s = mission.status;
  const running = s === "running" || s === "verifying";
  const counts: Partial<Record<View, number>> = {
    evidence: mission.observations.length || undefined,
    verification: mission.checks.length || undefined,
    results: mission.artifacts.length || undefined,
  };
  return (
    <div className="mission">
      <header className="mission-head">
        <div className="mission-head-main">
          <div className="mission-status-line">
            <Badge tone={MISSION_TONE[s]}>
              <StatusDot tone={MISSION_TONE[s]} pulse={isActive(s)} />
              {MISSION_LABEL[s]}
            </Badge>
            <span className="mission-id mono">{mission.id}</span>
            <span className="mission-mode">{mission.mode === "claude" ? "Claude reasoning" : "Deterministic mode"}</span>
          </div>
          <h1 className="mission-title" title={mission.prompt}>
            {mission.prompt}
          </h1>
        </div>
        <div className="mission-controls">
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
            <Button size="sm" variant="primary" icon={Play} onClick={() => act(() => api.resume(mission.id))} disabled={busy}>
              Resume agent
            </Button>
          )}
          {(running || s === "paused" || s === "awaiting_approval") && (
            <Button size="sm" variant="danger" icon={Square} onClick={() => act(() => api.cancel(mission.id))} disabled={busy}>
              {s === "awaiting_approval" ? "Discard" : "Stop"}
            </Button>
          )}
        </div>
      </header>

      {s === "paused" && (
        <div className="callout warn">
          <Hand size={16} aria-hidden />
          <span>
            You have control. The agent is holding before its next browser action.{" "}
            {health?.browser.headed ? "Use the visible Chromium window or the address bar below, then resume." : "Use the address bar below to open pages manually, then resume. (Headless mode: there is no visible window to click in.)"}
          </span>
        </div>
      )}

      {s === "awaiting_approval" ? (
        <PlanReview
          mission={mission}
          busy={busy}
          error={error}
          onSaveTargets={(targets: Target[]) => act(() => api.updateTargets(mission.id, targets))}
          onApprove={() => act(() => api.approve(mission.id))}
          onCancel={() => act(() => api.cancel(mission.id))}
        />
      ) : (
        <>
          <nav className="viewtabs" role="tablist" aria-label="Mission views">
            {VIEWS.map((v) => (
              <button key={v.id} role="tab" aria-selected={view === v.id} className={`viewtab ${view === v.id ? "active" : ""}`} onClick={() => setView(v.id)}>
                <v.icon size={15} aria-hidden />
                {v.label}
                {counts[v.id] !== undefined && <span className="count">{counts[v.id]}</span>}
              </button>
            ))}
          </nav>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <div className="view-body">
            {view === "browser" && <BrowserSurface mission={mission} health={health} onBrowse={(url) => act(() => api.browse(mission.id, url))} />}
            {view === "plan" && (
              <div className="results">
                <section className="card">
                  <StepGraph steps={mission.steps} />
                </section>
              </div>
            )}
            {view === "results" && <ResultsView mission={mission} />}
            {view === "evidence" && <EvidenceView mission={mission} />}
            {view === "verification" && <VerificationView mission={mission} />}
          </div>
        </>
      )}
    </div>
  );
}
