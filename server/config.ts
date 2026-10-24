import fs from "node:fs";
import path from "node:path";

// Load .env if present. Node 22 ships a native loader, so no dotenv dependency.
const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFile);
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  port: int("PORT", 8787),
  dataDir: path.resolve(process.env.OMNIPILOT_DATA_DIR || "./data"),
  headed: process.env.OMNIPILOT_HEADED === "1",
  navTimeoutMs: int("OMNIPILOT_NAV_TIMEOUT_MS", 25_000),
  stepTimeoutMs: int("OMNIPILOT_STEP_TIMEOUT_MS", 120_000),
  maxConcurrentPages: int("OMNIPILOT_MAX_PAGES", 2),
  model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  /** Never exposed to the client. Only presence is reported. */
  get apiKey(): string | undefined {
    const k = process.env.ANTHROPIC_API_KEY?.trim();
    return k ? k : undefined;
  },
  browserExecutable: process.env.OMNIPILOT_CHROMIUM_PATH || undefined,
};

export type Config = typeof config;
