import { useEffect } from "react";
import { ArrowLeft, ExternalLink, FlaskConical, Lock } from "lucide-react";
import type { Mission } from "../lib/api";
import { fileUrl } from "../lib/api";
import { isDisplayed } from "../lib/dashboard";
import { MISSION_LABEL, MISSION_TONE } from "../lib/format";
import { ResearchDashboard } from "./Dashboard";
import { Badge, Button, Logo, Orbit } from "./ui";

/**
 * Presentation view of one finished mission. It only reads the stored record: no mission controls,
 * no approvals, no address bar. Exit (or Escape) returns to the normal workspace.
 */
export function JudgeView({ mission, missionId, onExit }: { mission?: Mission; missionId: string; onExit(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onExit();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  return (
    <div className="judge" data-testid="judge-view">
      <header className="judge-head">
        <div className="judge-brand">
          <Logo size={22} />
          <span className="judge-name">OmniPilot</span>
          <Badge tone="accent" icon={Lock}>
            Judge mode · read-only
          </Badge>
        </div>
        <Button size="sm" icon={ArrowLeft} onClick={onExit} title="Back to the full workspace (Esc)">
          Exit judge mode
        </Button>
      </header>
      {mission?.dataSource === "fixture" && (
        <div className="fixture-strip" role="note">
          <FlaskConical size={14} aria-hidden />
          <strong>Offline demo mode</strong>
          <span>Fixture data from fictional vendor sites running on this machine. Nothing was fetched from the internet. This is not live research.</span>
        </div>
      )}
      <main className="judge-body">
        {!mission || mission.id !== missionId ? (
          <div className="loading-state">
            <Orbit size={20} /> Loading mission…
          </div>
        ) : !isDisplayed(mission.status) || !mission.analysis ? (
          <div className="judge-empty card">
            <Badge tone={MISSION_TONE[mission.status]}>{MISSION_LABEL[mission.status]}</Badge>
            <p>Judge mode shows completed missions only. This mission has no completed analysis to present.</p>
            <Button size="sm" icon={ArrowLeft} onClick={onExit}>
              Back to the workspace
            </Button>
          </div>
        ) : (
          <>
            <div className="judge-title">
              <Badge tone={MISSION_TONE[mission.status]}>{MISSION_LABEL[mission.status]}</Badge>
              <h1>{mission.plan?.productName ? `${mission.plan.productName}: competitor research` : "Competitor research"}</h1>
              <span className="mono judge-id">{mission.id}</span>
            </div>
            <ResearchDashboard mission={mission} />
            {mission.artifacts.length > 0 && (
              <section className="card judge-files" aria-label="Deliverables">
                <h3>Deliverables</h3>
                <div className="judge-file-list">
                  {mission.artifacts.map((f) => (
                    <a key={f.id} className="btn btn-secondary btn-sm" href={fileUrl(mission.id, f.filename)} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} aria-hidden />
                      <span>{f.filename}</span>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
