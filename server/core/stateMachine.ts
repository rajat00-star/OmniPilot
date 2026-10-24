import type { MissionStatus, StepStatus } from "./types.js";

const MISSION_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["awaiting_approval", "failed", "cancelled"],
  awaiting_approval: ["running", "cancelled", "planning"],
  running: ["paused", "verifying", "failed", "cancelled", "completed", "completed_with_warnings"],
  paused: ["running", "cancelled"],
  verifying: ["completed", "completed_with_warnings", "failed", "cancelled"],
  completed: [],
  completed_with_warnings: [],
  failed: [],
  cancelled: [],
};

const STEP_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  pending: ["running", "waiting_approval", "skipped", "cancelled"],
  waiting_approval: ["running", "skipped", "cancelled"],
  running: ["succeeded", "failed", "cancelled", "running"],
  succeeded: [],
  failed: [],
  skipped: [],
  cancelled: [],
};

export class InvalidTransitionError extends Error {
  constructor(kind: string, from: string, to: string) {
    super(`Invalid ${kind} transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransitionMission(from: MissionStatus, to: MissionStatus): boolean {
  return MISSION_TRANSITIONS[from].includes(to);
}

export function assertMissionTransition(from: MissionStatus, to: MissionStatus): void {
  if (!canTransitionMission(from, to)) throw new InvalidTransitionError("mission", from, to);
}

export function assertStepTransition(from: StepStatus, to: StepStatus): void {
  if (!STEP_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError("step", from, to);
}

export function isTerminal(status: MissionStatus): boolean {
  return MISSION_TRANSITIONS[status].length === 0;
}
