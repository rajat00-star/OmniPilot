// Local-only launcher for UI testing against the fixture site (no external hosts, no Claude).
// Usage: env -u ANTHROPIC_API_KEY npx tsx tests/e2e/fixture-app.ts [port]
// Starts (1) the test fixture site on an ephemeral loopback port and (2) the real OmniPilot app
// on 127.0.0.1:<port> (default 8788) with loopback targets allowed and the reasoning mode forced
// to deterministic. Loopback is allowed here exactly as in the test suite; the shipped `npm start`
// never allows it.
import path from "node:path";
import { createApp } from "../../server/app";
import { startFixtureServer, tempDir } from "../helpers/fixtures";

const port = Number(process.argv[2] || 8788);
const fx = await startFixtureServer();
const dataDir = tempDir();
const { app, store, browser } = createApp({
  dataDir,
  urlPolicy: { allowLoopback: true },
  forceMode: "deterministic",
  staticDir: path.resolve("dist/web"),
});
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`[fixture-app] OmniPilot UI:   http://127.0.0.1:${port}`);
  console.log(`[fixture-app] fixture site:   ${fx.base}  (pages: /acme /beta /noprice /inject /redirect-ok /slow)`);
  console.log(`[fixture-app] data dir:       ${dataDir}`);
  console.log(`[fixture-app] reasoning mode: deterministic (forced)`);
});

async function shutdown() {
  store.flushAll();
  server.close();
  await browser.shutdown();
  await fx.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
