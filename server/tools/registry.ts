import type { z } from "zod";
import type { MissionStore } from "../core/store.js";
import type { BrowserManager } from "../browser/browserManager.js";
import type { ActivityEntry, BrowserFrame, Mission, ReasoningMode } from "../core/types.js";

export interface ToolContext {
  missionId: string;
  stepId: string;
  mode: ReasoningMode;
  store: MissionStore;
  browser: BrowserManager;
  signal: AbortSignal;
  /** Agent time this step may use before it fails with a timeout (paused time is not counted). */
  budgetMs: number;
  mission(): Mission;
  log(level: ActivityEntry["level"], message: string, data?: Record<string, unknown>, tool?: string): void;
  frame(frame: Omit<BrowserFrame, "at">): void;
  /** Blocks while the mission is paused (manual takeover). */
  checkpoint(): Promise<void>;
}

export interface ToolResult {
  summary: string;
  output?: unknown;
  evidenceIds?: string[];
  artifactIds?: string[];
  /** Tool-level outcome: "partial" marks a step that ran but produced degraded results. */
  outcome?: "ok" | "partial";
}

export interface Tool<I = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  /** Consequential tools (publish, send, delete) always require explicit human approval. */
  consequential: boolean;
  /** Read-only tools may be retried once on transient failures. */
  retryable: boolean;
  run(ctx: ToolContext, input: I): Promise<ToolResult>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (!/^[a-z]+\.[a-z]+$/.test(tool.name)) throw new Error(`Invalid tool name ${tool.name}`);
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  describe(): { name: string; description: string; consequential: boolean }[] {
    return [...this.tools.values()].map((t) => ({ name: t.name, description: t.description, consequential: t.consequential }));
  }
}

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recovery?: string,
    public readonly transient = false,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
