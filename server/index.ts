import path from "node:path";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { llmStatus } from "./llm/claude.js";

const { app, store, browser } = createApp({ staticDir: path.resolve("dist/web") });

const server = app.listen(config.port, "127.0.0.1", () => {
  const llm = llmStatus();
  console.log(`[omnipilot] API listening on http://127.0.0.1:${config.port}`);
  console.log(`[omnipilot] reasoning mode: ${llm.mode}${llm.configured ? ` (${llm.model})` : " (ANTHROPIC_API_KEY not set)"}`);
  console.log(`[omnipilot] data dir: ${config.dataDir}`);
});

async function shutdown(signal: string) {
  console.log(`[omnipilot] ${signal} received, shutting down`);
  store.flushAll();
  server.close();
  await browser.shutdown();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
