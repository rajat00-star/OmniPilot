import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserContext } from "playwright";
import { BrowserError, BrowserManager } from "../server/browser/browserManager";

/**
 * Network-free harness for redirect-based SSRF bypass attempts.
 *
 * - DNS is mocked through the URL policy, so no resolver is contacted.
 * - The "origin" is served by route.fulfill on a reserved .test host, so no server is involved.
 * - The context is set offline: if a hop is NOT stopped by OmniPilot's own guard, Chromium fails
 *   immediately with a network error instead of sending any packet.
 */
const policy = { resolve: async () => ["198.41.0.4"] }; // mocked public answer; never connected to
const bm = new BrowserManager(policy, { headed: false, navTimeoutMs: 4000 });
let ctx: BrowserContext;

beforeAll(async () => {
  ctx = await bm.context("redirect-guard");
  await ctx.setOffline(true);
});
afterAll(async () => {
  await bm.shutdown();
});

/** Serve a single 302 from a fake public origin. Later-registered routes run first. */
async function redirectTo(path: string, location: string) {
  await ctx.route(`http://origin.test/${path}`, (r) => r.fulfill({ status: 302, headers: { location }, body: "" }));
}

async function openError(path: string): Promise<BrowserError> {
  try {
    const { release } = await bm.open("redirect-guard", `http://origin.test/${path}`);
    await release();
  } catch (e) {
    if (e instanceof BrowserError) return e;
    throw e;
  }
  throw new Error("expected open() to be rejected");
}

describe("redirect hops are validated before any connection is attempted", () => {
  const blockedTargets: [string, string][] = [
    ["private-10", "http://10.20.30.40/admin"],
    ["private-192", "http://192.168.1.1/"],
    ["private-172", "http://172.16.0.5/"],
    ["metadata-v4", "http://169.254.169.254/latest/meta-data"],
    ["loopback-v4", "http://127.0.0.1:8787/api/health"],
    ["loopback-v6", "http://[::1]/"],
    ["mapped-v6", "http://[::ffff:10.0.0.1]/"],
    ["decimal-ip", "http://2130706433/"],
    ["internal-name", "http://metadata.google.internal/computeMetadata/v1/"],
    ["localhost", "http://localhost:8787/"],
    ["credentials", "http://user:pw@origin.test/"],
  ];
  for (const [name, location] of blockedTargets) {
    it(`blocks a redirect to ${name}`, async () => {
      await redirectTo(name, location);
      const err = await openError(name);
      expect(err.code).toBe("blocked");
      expect(err.message).toMatch(/blocked/i);
    });
  }

  it("blocks non-http schemes in a redirect Location", async () => {
    for (const [name, location] of [
      ["scheme-file", "file:///etc/passwd"],
      ["scheme-js", "javascript:alert(1)"],
    ] as const) {
      await redirectTo(name, location);
      const err = await openError(name);
      expect(["blocked", "network"]).toContain(err.code); // the browser itself refuses these schemes
      expect(err.code).not.toBe("timeout");
    }
  });

  it("treats an unparseable Location as a non-redirect: nothing is followed and nothing hangs", async () => {
    await redirectTo("malformed", "http://[invalid/");
    try {
      const { snapshot, release } = await bm.open("redirect-guard", "http://origin.test/malformed");
      await release();
      expect(snapshot.redirectChain).toEqual([]);
      expect(snapshot.finalUrl).toBe("http://origin.test/malformed");
    } catch (e) {
      expect(e).toBeInstanceOf(BrowserError);
      expect((e as BrowserError).code).not.toBe("timeout");
    }
  });
});

describe("multi-hop redirect chains", () => {
  // Intermediate hops cannot be faked with route.fulfill (redirect hops are not routed), so a tiny
  // loopback server serves them. The final hop is a *.localhost name: blocked by policy, and if the
  // guard ever failed Chromium would resolve it to loopback internally, never to an outside host.
  let server: http.Server;
  let base: string;
  let local: BrowserManager;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const next: Record<string, string> = {
        "/a": "/b",
        "/b": "/c",
        "/c": "http://chain-final.localhost/secret",
        "/ok-a": "/ok-b",
        "/ok-b": "/ok-c",
      };
      if (req.url && next[req.url]) {
        res.writeHead(302, { location: next[req.url] });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><head><title>End</title></head><body><h1>End of chain</h1></body></html>");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    local = new BrowserManager({ allowLoopback: true }, { headed: false, navTimeoutMs: 4000 });
  });
  afterAll(async () => {
    await local.shutdown();
    await new Promise((r) => server.close(r));
  });

  it("blocks a disallowed host at the end of a three-hop chain", async () => {
    await expect(local.open("chain", `${base}/a`)).rejects.toMatchObject({ code: "blocked" });
  });

  it("still follows a legitimate multi-hop chain and records every hop", async () => {
    const { snapshot, release } = await local.open("chain", `${base}/ok-a`);
    await release();
    expect(snapshot.finalUrl).toBe(`${base}/ok-c`);
    expect(snapshot.redirectChain).toEqual([`${base}/ok-a`, `${base}/ok-b`]);
    expect(snapshot.httpStatus).toBe(200);
  });
});
