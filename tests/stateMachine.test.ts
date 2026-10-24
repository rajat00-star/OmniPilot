import { describe, expect, it } from "vitest";
import { assertMissionTransition, assertStepTransition, canTransitionMission, isTerminal, InvalidTransitionError } from "../server/core/stateMachine";

describe("task state machine", () => {
  it("allows the normal mission lifecycle", () => {
    const path = ["draft", "planning", "awaiting_approval", "running", "verifying", "completed"] as const;
    for (let i = 1; i < path.length; i++) expect(canTransitionMission(path[i - 1], path[i])).toBe(true);
  });

  it("supports pause/resume and cancellation from active states", () => {
    expect(canTransitionMission("running", "paused")).toBe(true);
    expect(canTransitionMission("paused", "running")).toBe(true);
    for (const s of ["draft", "planning", "awaiting_approval", "running", "paused", "verifying"] as const) expect(canTransitionMission(s, "cancelled")).toBe(true);
  });

  it("rejects skipping approval and leaving terminal states", () => {
    expect(() => assertMissionTransition("planning", "running")).toThrow(InvalidTransitionError);
    expect(() => assertMissionTransition("draft", "completed")).toThrow(InvalidTransitionError);
    for (const s of ["completed", "completed_with_warnings", "failed", "cancelled"] as const) {
      expect(isTerminal(s)).toBe(true);
      expect(() => assertMissionTransition(s, "running")).toThrow(InvalidTransitionError);
    }
  });

  it("guards step transitions", () => {
    expect(() => assertStepTransition("pending", "running")).not.toThrow();
    expect(() => assertStepTransition("succeeded", "running")).toThrow(InvalidTransitionError);
    expect(() => assertStepTransition("pending", "succeeded")).toThrow(InvalidTransitionError);
  });
});
