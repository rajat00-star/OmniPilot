import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../server/app";
import { tempDir } from "./helpers/fixtures";

let server: Server;
let base: string;
let ctx: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = createApp({ dataDir: tempDir(), forceMode: "deterministic" });
  server = ctx.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await ctx.browser.shutdown();
});

const post = (p: string, body?: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("HTTP API", () => {
  it("reports health without secrets", async () => {
    const h = await (await fetch(`${base}/api/health`)).json();
    expect(h.reasoning.mode).toBe("deterministic");
    expect(h.tools.map((t: { name: string }) => t.name)).toContain("verifier.check");
    expect(JSON.stringify(h)).not.toMatch(/sk-ant/);
  });

  it("validates mission input", async () => {
    const r = await post("/api/missions", { prompt: "hi" });
    expect(r.status).toBe(400);
  });

  it("creates a plan that waits for approval, and rejects unsafe target edits", async () => {
    const r = await post("/api/missions", { prompt: "Research three AI coding assistants and write a CSV report" });
    expect(r.status).toBe(201);
    const m = await r.json();
    expect(m.status).toBe("awaiting_approval");
    const bad = await fetch(`${base}/api/missions/${m.id}/targets`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targets: [{ id: "x", name: "Metadata", urls: ["http://169.254.169.254/"], origin: "user", enabled: true }] }),
    });
    expect(bad.status).toBe(422);
    const browse = await post(`/api/missions/${m.id}/browse`, { url: "http://localhost:8787/api/health" });
    expect(browse.status).toBe(400);
    expect((await post(`/api/missions/${m.id}/resume`)).status).toBe(409);
    const cancel = await (await post(`/api/missions/${m.id}/cancel`)).json();
    expect(cancel.status).toBe("cancelled");
  });

  it("confines file access to the mission artifact directory", async () => {
    const m = await (await post("/api/missions", { prompt: "Research three AI coding assistants and write a CSV report" })).json();
    for (const p of ["../mission.json", "..%2Fmission.json", "sources/../../x", "a/b/c.txt"]) {
      const r = await fetch(`${base}/api/missions/${m.id}/files/${p}`);
      expect([400, 404]).toContain(r.status);
    }
    expect([400, 404]).toContain((await fetch(`${base}/api/missions/..%2F..%2Fetc/files/passwd`)).status);
  });

  it("streams mission snapshots over SSE", async () => {
    const m = await (await post("/api/missions", { prompt: "Research three AI coding assistants and write a CSV report" })).json();
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/missions/${m.id}/events`, { signal: ctrl.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toMatch(/^event: snapshot/);
    expect(text).toContain(m.id);
    ctrl.abort();
  });
});
