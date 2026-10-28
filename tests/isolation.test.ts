import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { BrowserManager } from "../server/browser/browserManager";
import { tempDir } from "./helpers/fixtures";

/**
 * The app API only answers requests addressed to loopback (DNS rebinding) and refuses state-changing
 * requests started by another website (cross-site POST). fetch() cannot set Host, so http.request is used.
 */
let server: Server;
let port: number;
let ctx: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = createApp({ dataDir: tempDir(), forceMode: "deterministic" });
  server = ctx.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.close();
  await ctx.browser.shutdown();
});

function request(method: string, p: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port, method, path: p, headers: { ...(data ? { "content-type": "application/json" } : {}), ...headers } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const missionCount = async () => (await request("GET", "/api/missions", { host: `127.0.0.1:${port}` })).json.length as number;
const prompt = { prompt: "Research five competing AI products and write a CSV" };

describe("app API isolation", () => {
  it("only answers requests whose Host is loopback", async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
      expect((await request("GET", "/api/missions", { host })).status).toBe(200);
    }
    for (const host of [`rebind.example:${port}`, "rebind.example", `127.0.0.1.nip.io:${port}`]) {
      const r = await request("GET", "/api/missions", { host });
      expect(r.status).toBe(403);
      expect(r.json.code).toBe("forbidden_host");
    }
  });

  it("refuses state-changing requests started by another website", async () => {
    const before = await missionCount();
    for (const origin of ["https://evil.example", "null", `http://127.0.0.1.evil.example:${port}`]) {
      const r = await request("POST", "/api/missions", { host: `127.0.0.1:${port}`, origin }, prompt);
      expect(r.status).toBe(403);
      expect(r.json.code).toBe("forbidden_origin");
    }
    expect(await missionCount()).toBe(before);
    const allowed: Record<string, string>[] = [{ origin: `http://127.0.0.1:${port}` }, { origin: "http://localhost:5173" }, {}];
    for (const headers of allowed) {
      const r = await request("POST", "/api/missions", { host: `127.0.0.1:${port}`, ...headers }, prompt);
      expect(r.status).toBe(201);
    }
  });

  it("blocks a redirect from an allowed origin to another local server before it is contacted", async () => {
    let bHits = 0;
    const b = http.createServer((_req, res) => {
      bHits++;
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head><title>B</title></head><body>B</body></html>");
    });
    await new Promise<void>((r) => b.listen(0, "127.0.0.1", r));
    const bOrigin = `http://127.0.0.1:${(b.address() as AddressInfo).port}`;
    const a = http.createServer((_req, res) => {
      res.writeHead(302, { location: `${bOrigin}/secret` });
      res.end();
    });
    await new Promise<void>((r) => a.listen(0, "127.0.0.1", r));
    const aOrigin = `http://127.0.0.1:${(a.address() as AddressInfo).port}`;
    const bm = new BrowserManager({ allowOnlyOrigins: [aOrigin] }, { headed: false, navTimeoutMs: 4000 });
    try {
      await expect(bm.open("isolation", `${aOrigin}/hop`)).rejects.toMatchObject({ code: "blocked" });
      expect(bHits).toBe(0);
    } finally {
      await bm.shutdown();
      await new Promise((r) => a.close(r));
      await new Promise((r) => b.close(r));
    }
  });
});
