import { useEffect, useRef, useState } from "react";
import type { Mission, MissionListItem, Target } from "../../../server/core/types";

export type { Mission, MissionListItem, Target };
export type {
  StepRun,
  SourceCapture,
  Observation,
  ArtifactRecord,
  CheckResult,
  ActivityEntry,
  BrowserFrame,
  MissionStatus,
  StepStatus,
  VerificationSummary,
} from "../../../server/core/types";
export type { Analysis, CompetitorProfile, MarketGap } from "../../../server/core/analysis";

export interface Health {
  ok: boolean;
  reasoning: { mode: "claude" | "deterministic"; configured: boolean; model: string | null };
  browser: { engine: string; headed: boolean; manualTakeover: "window" | "pause-only" };
  tools: { name: string; description: string; consequential: boolean }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly recovery?: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError("Cannot reach the OmniPilot server. Is it running?", 0, "offline");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.code, body.recovery);
  return body as T;
}

export const api = {
  health: () => req<Health>("/api/health"),
  missions: () => req<MissionListItem[]>("/api/missions"),
  mission: (id: string) => req<Mission>(`/api/missions/${id}`),
  create: (prompt: string, productName?: string, productPitch?: string) =>
    req<Mission>("/api/missions", { method: "POST", body: JSON.stringify({ prompt, productName: productName || undefined, productPitch: productPitch || undefined }) }),
  updateTargets: (id: string, targets: Target[]) => req<Mission>(`/api/missions/${id}/targets`, { method: "PUT", body: JSON.stringify({ targets }) }),
  approve: (id: string) => req<Mission>(`/api/missions/${id}/approve`, { method: "POST" }),
  cancel: (id: string) => req<Mission>(`/api/missions/${id}/cancel`, { method: "POST" }),
  pause: (id: string) => req<Mission>(`/api/missions/${id}/pause`, { method: "POST" }),
  takeover: (id: string) => req<Mission>(`/api/missions/${id}/takeover`, { method: "POST" }),
  resume: (id: string) => req<Mission>(`/api/missions/${id}/resume`, { method: "POST" }),
  resolveApproval: (id: string, approvalId: string, approved: boolean) =>
    req<Mission>(`/api/missions/${id}/approvals/${approvalId}`, { method: "POST", body: JSON.stringify({ approved }) }),
  browse: (id: string, url: string) => req<{ summary: string; mission: Mission }>(`/api/missions/${id}/browse`, { method: "POST", body: JSON.stringify({ url }) }),
};

export function fileUrl(missionId: string, rel: string, download = false): string {
  return `/api/missions/${missionId}/files/${rel}${download ? "?download=1" : ""}`;
}

/** Live mission state over Server-Sent Events, with automatic reconnect. */
export function useMissionStream(id: string | undefined): { mission?: Mission; connected: boolean } {
  const [mission, setMission] = useState<Mission>();
  const [connected, setConnected] = useState(false);
  const idRef = useRef(id);
  idRef.current = id;
  useEffect(() => {
    setMission(undefined);
    if (!id) return;
    let es: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const open = () => {
      es = new EventSource(`/api/missions/${id}/events`);
      es.addEventListener("snapshot", (ev) => {
        if (idRef.current !== id) return;
        setMission(JSON.parse((ev as MessageEvent).data));
        setConnected(true);
      });
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!closed) retry = setTimeout(open, 1500);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      es?.close();
    };
  }, [id]);
  return { mission, connected };
}
