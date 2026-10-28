import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { BrowserManager } from "../server/browser/browserManager";

function listen(handler: http.RequestListener): Promise<{ server: http.Server; origin: string }> {
  const server = http.createServer(handler);
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

// The redirect-hop guard is attached to the pages the agent opens. A visited page can open more
// windows itself; their redirect hops would not be checked, so no such window may survive.
describe("windows opened by a visited page", () => {
  it("cannot reach a blocked origin through a redirect", async () => {
    const hits: string[] = [];
    const target = await listen((req, res) => {
      hits.push(req.url ?? "");
      res.end("private");
    });
    const site = await listen((req, res) => {
      if (req.url?.startsWith("/hop")) {
        res.writeHead(302, { location: `${target.origin}/secret${req.url.slice(4)}` });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><title>Opener</title><h1>Opener</h1><script>
        const late = window.open("about:blank");
        setTimeout(() => { if (late) late.location = "/hop-late"; }, 200);
        window.open("/hop-direct");
        window.open("/hop-noopener", "_blank", "noopener");
        const a = document.createElement("a"); a.href = "/hop-link"; a.target = "_blank"; document.body.append(a); a.click();
      </script>`);
    });
    const browser = new BrowserManager({ allowOnlyOrigins: [site.origin] }, { headed: false, navTimeoutMs: 6000 });
    try {
      const { snapshot, page, release } = await browser.open("popups", `${site.origin}/opener`);
      expect(snapshot.title).toBe("Opener");
      await new Promise((r) => setTimeout(r, 1500));
      expect(hits).toEqual([]);
      // Only the page the agent opened is left in its browser context.
      expect(page.context().pages()).toEqual([page]);
      await release();
    } finally {
      await browser.shutdown();
      site.server.close();
      target.server.close();
    }
  });
});
