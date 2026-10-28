// Offline demo launcher: the real OmniPilot server and UI, run against five fictional vendor sites
// served on this machine. No public website is contacted and no Claude call is made.
// Usage: npm run build && npm run demo:offline
// Env: PORT (default 8787), OMNIPILOT_DEMO_BASE_PORT (default 41001), OMNIPILOT_DEMO_LATENCY_MS (default 2000),
//      OMNIPILOT_DATA_DIR (default ./data-demo, kept apart from live missions).
import path from "node:path";
import { createApp } from "../server/app.js";
import { config } from "../server/config.js";
import { startDemoVendors } from "../server/demo/fixtureVendors.js";

const basePort = Number(process.env.OMNIPILOT_DEMO_BASE_PORT || 41001);
const latencyMs = Number(process.env.OMNIPILOT_DEMO_LATENCY_MS || 2000);
const dataDir = path.resolve(process.env.OMNIPILOT_DATA_DIR || "./data-demo");

const vendors = await startDemoVendors({ basePort, latencyMs });
const { app, store, browser } = createApp({
  dataDir,
  // Only the fixture origins can be opened: the public web, other local ports and this app's own API are blocked.
  urlPolicy: { allowOnlyOrigins: vendors.origins },
  forceMode: "deterministic",
  fixture: { catalog: vendors.catalog },
  staticDir: path.resolve("dist/web"),
});

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`[omnipilot] OFFLINE DEMO MODE — fixture data, not live research`);
  console.log(`[omnipilot] UI:        http://127.0.0.1:${config.port}`);
  console.log(`[omnipilot] reasoning: deterministic (forced; no Claude calls)`);
  console.log(`[omnipilot] data dir:  ${dataDir}`);
  console.log(`[omnipilot] fictional vendor sites (${latencyMs} ms simulated latency):`);
  for (const v of vendors.catalog) console.log(`  - ${v.name.padEnd(14)} ${v.urls.join("  ")}`);
  console.log(`[omnipilot] stop with Ctrl+C`);
});

async function shutdown(signal: string) {
  console.log(`[omnipilot] ${signal} received, shutting down`);
  store.flushAll();
  server.close();
  await browser.shutdown();
  await vendors.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
