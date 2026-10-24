import type { MissionStatus, StepStatus } from "./api";

export const MISSION_LABEL: Record<MissionStatus, string> = {
  draft: "Draft",
  planning: "Planning",
  awaiting_approval: "Awaiting approval",
  running: "Running",
  paused: "Paused",
  verifying: "Verifying",
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  failed: "Failed",
  cancelled: "Cancelled",
};

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export const MISSION_TONE: Record<MissionStatus, Tone> = {
  draft: "neutral",
  planning: "accent",
  awaiting_approval: "info",
  running: "accent",
  paused: "warning",
  verifying: "accent",
  completed: "success",
  completed_with_warnings: "warning",
  failed: "danger",
  cancelled: "neutral",
};

export const STEP_TONE: Record<StepStatus, Tone> = {
  pending: "neutral",
  waiting_approval: "info",
  running: "accent",
  succeeded: "success",
  failed: "danger",
  skipped: "neutral",
  cancelled: "neutral",
};

export const STEP_LABEL: Record<StepStatus, string> = {
  pending: "Pending",
  waiting_approval: "Needs approval",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function clock(iso?: string): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}

export function duration(a?: string, b?: string): string {
  if (!a) return "";
  const ms = (b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function host(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const isActive = (s: MissionStatus) => s === "running" || s === "paused" || s === "verifying" || s === "planning";
export const isDone = (s: MissionStatus) => s === "completed" || s === "completed_with_warnings" || s === "failed" || s === "cancelled";
