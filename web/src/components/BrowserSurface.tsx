import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Ban, Globe, Lock, MousePointer2, RotateCw } from "lucide-react";
import type { BrowserFrame, Health, Mission } from "../lib/api";
import { fileUrl } from "../lib/api";
import { clock, host } from "../lib/format";
import { Empty, Orbit } from "./ui";

interface Tab {
  key: string;
  url: string;
  title?: string;
  state: BrowserFrame["state"];
  shot?: string;
  detail?: string;
  at: string;
}

function buildTabs(frames: BrowserFrame[]): Tab[] {
  const map = new Map<string, Tab>();
  for (const f of frames) {
    // A redirected page reports its final URL; key it by the requested URL so the tab updates in place.
    const key = f.requestedUrl ?? f.url;
    const prev = map.get(key);
    map.set(key, {
      key,
      url: f.url,
      title: f.title ?? prev?.title,
      state: f.state,
      shot: f.screenshotFile ?? prev?.shot,
      detail: f.detail,
      at: f.at,
    });
  }
  return [...map.values()];
}

interface Props {
  mission: Mission;
  health?: Health;
  onBrowse(url: string): Promise<void>;
}

export function BrowserSurface({ mission, health, onBrowse }: Props) {
  const tabs = useMemo(() => buildTabs(mission.frames), [mission.frames]);
  const lastFrame = mission.frames[mission.frames.length - 1];
  const latest = lastFrame ? (lastFrame.requestedUrl ?? lastFrame.url) : undefined;
  const [selected, setSelected] = useState<string | undefined>();
  const [follow, setFollow] = useState(true);
  const active = tabs.find((t) => t.key === (follow ? latest : selected)) ?? tabs[tabs.length - 1];
  const [address, setAddress] = useState("");
  // While the viewer is typing a URL, live frames must not overwrite it.
  const [editing, setEditing] = useState(false);
  const [navBusy, setNavBusy] = useState(false);
  const [navError, setNavError] = useState<string>();
  useEffect(() => {
    if (!editing) setAddress(active?.url ?? "");
  }, [active?.url, editing]);

  const executing = mission.status === "running" || mission.status === "verifying";
  const canNavigate = !executing && mission.status !== "planning";

  const go = async () => {
    if (!address.trim() || !canNavigate) return;
    setNavBusy(true);
    setNavError(undefined);
    try {
      await onBrowse(address.trim());
      setFollow(true);
    } catch (e) {
      setNavError((e as Error).message);
    } finally {
      setNavBusy(false);
      setEditing(false);
    }
  };

  return (
    <div className="browser">
      <div className="tabstrip" role="tablist" aria-label="Pages opened by the controlled browser">
        {tabs.length === 0 && <div className="tab placeholder">No pages opened yet</div>}
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t === active}
            className={`tab ${t === active ? "active" : ""} state-${t.state}`}
            onClick={() => {
              setSelected(t.key);
              setFollow(t.key === latest);
            }}
            title={t.url}
          >
            {t.state === "loading" ? <Orbit size={13} /> : t.state === "failed" ? <AlertTriangle size={13} aria-hidden /> : t.state === "blocked" ? <Ban size={13} aria-hidden /> : <Globe size={13} aria-hidden />}
            <span className="tab-title">{t.title || host(t.url)}</span>
          </button>
        ))}
      </div>
      <div className="addressbar">
        <button className="icon-btn" aria-label="Reload current page" title={canNavigate ? "Reload" : "Available when the mission is paused or finished"} disabled={!canNavigate || !active?.url.startsWith("http")} onClick={() => active && onBrowse(active.url)}>
          <RotateCw size={15} aria-hidden />
        </button>
        <div className={`address ${canNavigate ? "" : "readonly"}`}>
          <Lock size={13} aria-hidden className={active?.url.startsWith("https") ? "secure" : ""} />
          <input
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setEditing(true);
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            readOnly={!canNavigate}
            aria-label="Address"
            placeholder={canNavigate ? (mission.dataSource === "fixture" ? "Enter a fixture-site URL (offline demo: the public web is blocked)" : "Enter a public URL to open it in the controlled browser") : ""}
            title={canNavigate ? "Navigate the controlled browser (URL policy applies)" : "The agent is driving. Pause or take over to navigate manually."}
            spellCheck={false}
          />
        </div>
        <button className="icon-btn" aria-label="Go" disabled={!canNavigate || navBusy} onClick={go}>
          {navBusy ? <Orbit size={15} /> : <ArrowRight size={15} aria-hidden />}
        </button>
        <span className={`driver ${executing ? "agent" : "user"}`}>
          {executing ? "Agent driving" : mission.status === "paused" ? "You have control" : "Idle"}
        </span>
      </div>
      {navError && (
        <div className="inline-error slim" role="alert">
          {navError}
        </div>
      )}
      <div className="viewport">
        {!active ? (
          <Empty icon={MousePointer2} title="The controlled browser is idle">
            Pages open here as the mission navigates. Each view is a real screenshot captured by Playwright from headless Chromium.
          </Empty>
        ) : active.state === "loading" && !active.shot ? (
          <div className="viewport-state">
            <Orbit size={26} />
            <div>Loading {host(active.url)}…</div>
          </div>
        ) : active.state === "failed" || active.state === "blocked" ? (
          <div className="viewport-state error">
            {active.state === "blocked" ? <Ban size={22} aria-hidden /> : <AlertTriangle size={22} aria-hidden />}
            <div className="viewport-error-title">{active.state === "blocked" ? "Blocked by URL policy" : "Page could not be loaded"}</div>
            <div className="viewport-error-detail">{active.detail}</div>
            <div className="viewport-error-url mono">{active.url}</div>
          </div>
        ) : active.shot ? (
          <figure className="shot">
            <img src={fileUrl(mission.id, active.shot)} alt={`Screenshot of ${active.title ?? active.url}`} />
            <figcaption>
              Captured {clock(active.at)} · {health?.browser.headed ? "visible Chromium window" : "headless Chromium"} · screenshot evidence
            </figcaption>
          </figure>
        ) : (
          <div className="viewport-state">Loaded {host(active.url)} (no screenshot)</div>
        )}
      </div>
    </div>
  );
}
