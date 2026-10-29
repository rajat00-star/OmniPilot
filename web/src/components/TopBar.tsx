import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { Cpu, FlaskConical, Globe2, History, Plus, Settings2, ShieldCheck, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import type { Health, MissionListItem } from "../lib/api";
import { MISSION_LABEL, MISSION_TONE, isActive, timeAgo, type Tone } from "../lib/format";
import { ease } from "../lib/motion";
import { prefs, usePrefs } from "../lib/prefs";
import { sound, toggleSound } from "../lib/sound";
import { Button, IconButton, Logo, StatusDot } from "./ui";

function systemStatus(health?: Health, healthError?: string): { label: string; detail: string; tone: Tone } {
  if (healthError) return { label: "Server unreachable", detail: "Start the OmniPilot server, then reload", tone: "danger" };
  if (!health) return { label: "Connecting", detail: "Checking the OmniPilot server", tone: "neutral" };
  const mode = health.reasoning.mode === "claude" ? "Claude reasoning" : "Rule-based";
  if (health.dataSource === "fixture") return { label: "Offline demo", detail: `${mode} · fixture sites only`, tone: "warning" };
  return { label: "Online", detail: `${mode} · live web`, tone: "success" };
}

interface BarProps {
  health?: Health;
  healthError?: string;
  missionCount: number;
  home: boolean;
  onNew(): void;
  onHistory(): void;
}

/** Identity, system status, sound, settings and history. Everything else lives with the mission it belongs to. */
export function TopBar({ health, healthError, missionCount, home, onNew, onHistory }: BarProps) {
  const status = systemStatus(health, healthError);
  const { sound: soundOn } = usePrefs();
  return (
    <header className="topbar">
      <a className="wordmark" href="#/" aria-label="OmniPilot home">
        <Logo size={26} />
        <span>OmniPilot</span>
      </a>
      <nav className="topnav" aria-label="Main">
        <span className={`sys-status tone-${status.tone}`} title={status.detail}>
          <StatusDot tone={status.tone} />
          <span className="sys-label">{status.label}</span>
          <span className="sys-detail">{status.detail}</span>
        </span>
        <IconButton
          icon={soundOn ? Volume2 : VolumeX}
          label={soundOn ? "Turn interface sound off" : "Turn interface sound on"}
          aria-pressed={soundOn}
          className={`sound-btn ${soundOn ? "on" : ""}`}
          disabled={!sound.available}
          onClick={() => void toggleSound(!soundOn)}
        />
        <Settings health={health} healthError={healthError} />
        <Button variant="ghost" size="sm" icon={History} onClick={onHistory} aria-haspopup="dialog">
          <span className="hide-sm">History</span>
          {missionCount ? <span className="count">{missionCount}</span> : null}
        </Button>
        {!home && (
          <Button variant="secondary" size="sm" icon={Plus} onClick={onNew} aria-label="New mission">
            <span className="hide-sm">New mission</span>
          </Button>
        )}
      </nav>
    </header>
  );
}

function Settings({ health, healthError }: { health?: Health; healthError?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { sound: soundOn, effects } = usePrefs();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="settings">
      <button
        ref={trigger}
        type="button"
        className={`icon-btn ${open ? "active" : ""}`}
        aria-label="Settings"
        title="Settings"
        aria-expanded={open}
        aria-controls="settings-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <Settings2 size={16} strokeWidth={2} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <m.div
            ref={panel}
            id="settings-panel"
            className="settings-panel"
            role="dialog"
            aria-label="Settings"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: ease.out } }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.14 } }}
          >
            <div className="settings-group">
              <label className="switch-row">
                <span>
                  <span className="switch-title">Interface sound</span>
                  <span className="switch-desc">{sound.available ? "Soft synthesized cues for real events. Off by default." : "Not supported in this browser."}</span>
                </span>
                <input type="checkbox" role="switch" checked={soundOn} disabled={!sound.available} onChange={(e) => void toggleSound(e.target.checked)} />
              </label>
              <label className="switch-row">
                <span>
                  <span className="switch-title">Reduce visual effects</span>
                  <span className="switch-desc">Replaces the WebGL core with a light CSS version.</span>
                </span>
                <input type="checkbox" role="switch" checked={effects === "reduced"} onChange={(e) => prefs.set({ effects: e.target.checked ? "reduced" : "full" })} />
              </label>
            </div>
            <div className="settings-group system">
              <div className="micro-label">System</div>
              {healthError ? (
                <div className="conn tone-danger-fg">Server unreachable</div>
              ) : (
                <>
                  <div className="conn">
                    {health?.reasoning.mode === "claude" ? <Sparkles size={14} aria-hidden /> : <Cpu size={14} aria-hidden />}
                    <span>{health ? (health.reasoning.mode === "claude" ? `Claude · ${health.reasoning.model}` : "Rule-based planning and analysis (no AI provider)") : "Checking…"}</span>
                  </div>
                  <div className="conn">
                    <Globe2 size={14} aria-hidden />
                    <span>{health ? `Chromium · ${health.browser.headed ? "visible window" : "headless"}` : "Browser"}</span>
                  </div>
                  <div className="conn">
                    {health?.dataSource === "fixture" ? <FlaskConical size={14} aria-hidden /> : <ShieldCheck size={14} aria-hidden />}
                    <span>{health ? `${health.tools.length} allowlisted tools · ${health.dataSource === "fixture" ? "fixture sites only" : "read-only public research"}` : "Tools"}</span>
                  </div>
                </>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface DrawerProps {
  open: boolean;
  missions: MissionListItem[];
  selectedId?: string;
  onSelect(id: string): void;
  onNew(): void;
  onClose(): void;
}

/** Mission history in a modal drawer (native <dialog>: focus trap and Escape for free). */
export function HistoryDrawer({ open, missions, selectedId, onSelect, onNew, onClose }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="drawer" aria-labelledby="history-title" onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer-inner">
        <div className="drawer-head">
          <h2 id="history-title">Mission history</h2>
          <IconButton icon={X} label="Close history" onClick={onClose} />
        </div>
        <Button
          variant="primary"
          icon={Plus}
          className="drawer-new"
          onClick={() => {
            onNew();
            onClose();
          }}
        >
          Start a new mission
        </Button>
        {missions.length === 0 ? (
          <p className="drawer-empty">No missions yet. Describe one on the home screen to get started.</p>
        ) : (
          <ul className="history-list">
            {missions.map((m) => (
              <li key={m.id}>
                <button
                  className={`history-item ${m.id === selectedId ? "selected" : ""}`}
                  aria-current={m.id === selectedId ? "true" : undefined}
                  onClick={() => {
                    onSelect(m.id);
                    onClose();
                  }}
                >
                  <StatusDot tone={MISSION_TONE[m.status]} pulse={isActive(m.status)} />
                  <span className="history-text">
                    <span className="history-title">{m.prompt}</span>
                    <span className="history-meta">
                      {MISSION_LABEL[m.status]} · {timeAgo(m.createdAt)}
                      {m.artifactCount ? ` · ${m.artifactCount} files` : ""}
                      {m.dataSource === "fixture" ? " · offline demo" : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
