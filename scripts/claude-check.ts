// Checks the Claude setup without ever printing the API key.
// Usage:
//   npm run claude:check                                   no network: which key, model and overrides the server will use
//   npm run claude:check -- --model                        one free API call: is the key accepted and the model available?
//   npm run claude:check -- --plan --confirm-paid-call     one paid planning call through OmniPilot's own planner
// The planning call opens no web page; it prints the proposed targets, token usage and an estimated cost.
import fs from "node:fs";
import path from "node:path";
import util from "node:util";

// Recorded before the server config loads .env, which never overrides a variable already set in the shell.
const shellKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
const envFile = path.resolve(".env");
const fileVars: NodeJS.Dict<string> = fs.existsSync(envFile) ? util.parseEnv(fs.readFileSync(envFile, "utf8")) : {};

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const { config } = await import("../server/config.js");
const { createPlan } = await import("../server/core/planner.js");
const { createRegistry } = await import("../server/tools/index.js");
const { describeUsage } = await import("../server/llm/claude.js");

/** US dollars per million tokens, from Anthropic's published price list (checked 2026-10-28). */
const PRICES: Record<string, { input: number; output: number }> = { "claude-opus-5-5": { input: 4, output: 20 } };

const args = new Set(process.argv.slice(2));
const yesNo = (v: unknown) => (v ? "yes" : "no");
const fileKey = fileVars.ANTHROPIC_API_KEY?.trim() || undefined;
const key = config.apiKey;

console.log("Claude configuration (values of secrets are never shown)");
console.log(`  ANTHROPIC_API_KEY set:        ${yesNo(key)}${key ? ` (from ${shellKey ? "the shell environment" : ".env"})` : ""}`);
if (shellKey && fileKey) console.log(`  .env also has a key:          yes, ${shellKey === fileKey ? "the same one" : "a DIFFERENT one, which is ignored because the shell value wins"}`);
console.log(`  model:                        ${config.model}${process.env.ANTHROPIC_MODEL ? " (from ANTHROPIC_MODEL)" : " (default)"}`);
const baseUrl = process.env.ANTHROPIC_BASE_URL;
const baseHost = (() => {
  try {
    return baseUrl ? new URL(baseUrl).host : undefined;
  } catch {
    return "an unparseable URL";
  }
})();
console.log(`  ANTHROPIC_BASE_URL override:  ${baseUrl ? `yes (${baseHost})` : "no"}`);
console.log(`  ANTHROPIC_AUTH_TOKEN set:     ${yesNo(process.env.ANTHROPIC_AUTH_TOKEN)} (ignored: OmniPilot passes the API key explicitly)`);
console.log(`  ANTHROPIC_CUSTOM_HEADERS set: ${yesNo(process.env.ANTHROPIC_CUSTOM_HEADERS)}`);
console.log(`  ANTHROPIC_LOG set:            ${yesNo(process.env.ANTHROPIC_LOG)}`);
console.log(`  proxy variables set:          ${yesNo(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy)}`);

if (!args.has("--model") && !args.has("--plan")) process.exit(key ? 0 : 1);
if (!key) {
  console.log("\nNo API key is configured, so no call was made.");
  process.exit(1);
}
// The key only goes to Anthropic, or to a stand-in on this machine (the offline tests use one).
if (baseUrl && baseHost !== "api.anthropic.com" && !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(baseHost ?? "")) {
  console.log(`\nRefusing to send the key to ${baseHost}. Unset ANTHROPIC_BASE_URL first.`);
  process.exit(1);
}

if (args.has("--model")) {
  const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 20_000 });
  try {
    const m = await client.models.retrieve(config.model);
    const caps = m.capabilities as unknown as Record<string, any> | null;
    console.log(`\nModel check (free, no tokens): ${m.id} is available to this key`);
    console.log(`  name / lifecycle:   ${m.display_name} / ${m.lifecycle}`);
    console.log(`  max output tokens:  ${m.max_tokens ?? "unknown"}`);
    console.log(`  structured outputs: ${caps ? yesNo(caps.structured_outputs?.supported) : "unknown"}`);
    console.log(`  effort "medium":    ${caps ? yesNo(caps.effort?.medium?.supported) : "unknown"}`);
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    const why =
      status === 401 ? "the key was rejected (401)" :
      status === 403 ? "the key is not allowed to use this model or workspace (403)" :
      status === 404 ? `model ${config.model} is not available to this key (404)` :
      e instanceof Anthropic.APIConnectionError ? "api.anthropic.com could not be reached from this network" :
      `unexpected error${status ? ` ${status}` : ""}`;
    console.log(`\nModel check failed: ${why}.`);
    process.exit(1);
  }
}

if (args.has("--plan")) {
  if (!args.has("--confirm-paid-call")) {
    console.log("\n--plan makes one paid Claude call. Add --confirm-paid-call to run it.");
    process.exit(1);
  }
  const prompt = "Research three AI meeting-notes assistants. Find their official product and pricing pages and write a competitor CSV.";
  let usage: import("../server/llm/claude.js").LlmUsage | undefined;
  const started = Date.now();
  const { plan, warnings } = await createPlan({ prompt }, createRegistry(), "claude", undefined, {}, undefined, {
    deadlineMs: config.stepTimeoutMs,
    onUsage: (u) => (usage = u),
  });
  console.log(`\nPlanning call (${((Date.now() - started) / 1000).toFixed(1)} s): planner = ${plan.planner}`);
  if (usage) {
    console.log(`  ${describeUsage("planning", usage)}, stop reason ${usage.stopReason}`);
    const price = PRICES[usage.model] ?? PRICES[config.model];
    if (price) console.log(`  estimated cost:     $${((usage.inputTokens * price.input + usage.outputTokens * price.output) / 1e6).toFixed(4)}`);
  }
  for (const t of plan.targets) console.log(`  target ${t.name}: ${t.urls.join(" ")}`);
  if (warnings.length) {
    console.log(`  ${warnings.join("; ")}`);
    process.exit(1);
  }
}
