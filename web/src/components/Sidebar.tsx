import { Bot, Cpu, FileText, FolderOpen, Globe2, Plus, ShieldCheck, Sparkles } from "lucide-react";
import type { Health, Mission, MissionListItem } from "../lib/api";
import { fileUrl } from "../lib/api";
import { MISSION_LABEL, MISSION_TONE, bytes, isActive, timeAgo } from "../lib/format";
import { Button, Logo, StatusDot } from "./ui";

interface Props {
  missions: MissionListItem[];
  selectedId?: string;
  current?: Mission;
  health?: Health;
  healthError?: string;
  onSelect(id: string): void;
  onNew(): void;
}

export function Sidebar({ missions, selectedId, current, health, healthError, onSelect, onNew }: Props) {
  const artifacts = current?.artifacts ?? [];
  return (
    <aside className="sidebar" aria-label="Navigation">
      <div className="brand">
        <Logo />
        <div>
          <div className="brand-name">OmniPilot</div>
          <div className="brand-tag">From intent to verified execution</div>
        </div>
      </div>

      <Button variant="primary" icon={Plus} className="new-mission" onClick={onNew}>
        New mission
      </Button>

      <nav className="side-section" aria-label="Recent missions">
        <div className="side-label">Missions</div>
        {missions.length === 0 && <div className="side-empty">No missions yet. Describe one to get started.</div>}
        <ul className="mission-list">
          {missions.map((m) => (
            <li key={m.id}>
              <button className={`mission-item ${m.id === selectedId ? "selected" : ""}`} onClick={() => onSelect(m.id)} title={m.prompt}>
                <StatusDot tone={MISSION_TONE[m.status]} pulse={isActive(m.status)} />
                <span className="mission-item-text">
                  <span className="mission-item-title">{m.prompt}</span>
                  <span className="mission-item-meta">
                    {MISSION_LABEL[m.status]} · {timeAgo(m.createdAt)}
                    {m.artifactCount ? ` · ${m.artifactCount} files` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="side-section">
        <div className="side-label">Artifacts{current ? "" : " (select a mission)"}</div>
        {current && artifacts.length === 0 && <div className="side-empty">Artifacts appear here as the mission writes them.</div>}
        <ul className="artifact-list">
          {artifacts.map((a) => (
            <li key={a.id}>
              <a className="artifact-item" href={fileUrl(current!.id, a.filename, true)} title={`Download ${a.filename}`}>
                {a.kind === "csv" || a.kind === "json" ? <FolderOpen size={14} aria-hidden /> : <FileText size={14} aria-hidden />}
                <span className="artifact-name">{a.filename}</span>
                <span className="artifact-size">{bytes(a.bytes)}</span>
                <StatusDot tone={a.verification === "passed" ? "success" : a.verification === "failed" ? "danger" : a.verification === "warning" ? "warning" : "neutral"} />
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="side-footer" aria-label="Connection status">
        {healthError ? (
          <div className="conn">
            <StatusDot tone="danger" />
            <span>Server unreachable</span>
          </div>
        ) : (
          <>
            <div className="conn" title={health?.reasoning.configured ? `Model: ${health.reasoning.model}` : "Set ANTHROPIC_API_KEY on the server to enable Claude reasoning"}>
              {health?.reasoning.mode === "claude" ? <Sparkles size={14} aria-hidden /> : <Cpu size={14} aria-hidden />}
              <span>{health ? (health.reasoning.mode === "claude" ? "Claude connected" : "Deterministic mode") : "Checking…"}</span>
              <StatusDot tone={health?.reasoning.mode === "claude" ? "success" : "warning"} />
            </div>
            <div className="conn-sub">
              {health?.reasoning.mode === "claude" ? health.reasoning.model : "No AI provider configured. Browsing, extraction and verification are real; analysis is rule-based."}
            </div>
            <div className="conn">
              <Globe2 size={14} aria-hidden />
              <span>{health ? `Chromium · ${health.browser.headed ? "visible window" : "headless"}` : "Browser"}</span>
              <StatusDot tone={health ? "success" : "neutral"} />
            </div>
            <div className="conn">
              <ShieldCheck size={14} aria-hidden />
              <span>{health ? `${health.tools.length} allowlisted tools` : "Tools"}</span>
            </div>
            <div className="conn muted">
              <Bot size={14} aria-hidden />
              <span>{health?.dataSource === "fixture" ? "Offline demo: fixture sites only" : "Read-only research mode"}</span>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
