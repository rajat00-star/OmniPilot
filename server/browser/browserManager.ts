import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config } from "../config.js";
import { checkUrlStructure, validateRedirectChain, validateUrl, UnsafeUrlError, type UrlPolicy } from "../security/urlSafety.js";

export interface PageSnapshot {
  requestedUrl: string;
  finalUrl: string;
  redirectChain: string[];
  httpStatus?: number;
  title: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  canonical: string;
  lang: string;
  h1: string[];
  h2: string[];
  h3: string[];
  visibleText: string;
}

export class BrowserError extends Error {
  constructor(
    message: string,
    public readonly code: "timeout" | "network" | "blocked" | "cancelled" | "http_error" | "unknown",
  ) {
    super(message);
    this.name = "BrowserError";
  }
}

const MAX_TEXT = 80_000;

// Plain-JS source string: bundlers (tsx/esbuild) inject helpers into transpiled functions
// that do not exist inside the page, so the in-page script is kept as literal text.
const EXTRACT_SCRIPT = `(() => {
  const meta = (sel) => ((document.querySelector(sel) && document.querySelector(sel).getAttribute("content")) || "").trim();
  const texts = (sel, n) => Array.from(document.querySelectorAll(sel))
    .map((e) => (e.innerText || "").replace(/\\s+/g, " ").trim())
    .filter((t) => t.length > 1 && t.length < 240)
    .slice(0, n);
  const canonical = document.querySelector('link[rel="canonical"]');
  return {
    title: document.title || "",
    metaDescription: meta('meta[name="description"]'),
    ogTitle: meta('meta[property="og:title"]'),
    ogDescription: meta('meta[property="og:description"]'),
    canonical: canonical ? canonical.getAttribute("href") || "" : "",
    lang: document.documentElement.lang || "",
    h1: texts("h1", 5),
    h2: texts("h2", 20),
    h3: texts("h3", 30),
    visibleText: (document.body ? document.body.innerText : "").slice(0, ${MAX_TEXT}),
  };
})()`;

/** Bounded semaphore so research never opens more than N pages at once. */
class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    return () => {
      this.active--;
      this.queue.shift()?.();
    };
  }
}

function proxyFromEnv(): { server: string; bypass?: string } | undefined {
  const server = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!server) return undefined;
  const bypass = process.env.NO_PROXY || process.env.no_proxy;
  return { server, bypass: bypass || undefined };
}

export class BrowserManager {
  private browser?: Browser;
  private launching?: Promise<Browser>;
  private contexts = new Map<string, BrowserContext>();
  private livePages = new Map<string, Set<Page>>();
  private sem: Semaphore;

  constructor(
    private readonly policy: UrlPolicy = {},
    private readonly opts = { headed: config.headed, navTimeoutMs: config.navTimeoutMs },
  ) {
    this.sem = new Semaphore(config.maxConcurrentPages);
  }

  get isHeaded(): boolean {
    return this.opts.headed;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) {
      this.launching = chromium
        .launch({
          headless: !this.opts.headed,
          executablePath: config.browserExecutable,
          proxy: this.policy.allowLoopback ? undefined : proxyFromEnv(),
        })
        .then((b) => {
          this.browser = b;
          this.launching = undefined;
          return b;
        })
        .catch((e) => {
          this.launching = undefined;
          throw e;
        });
    }
    return this.launching;
  }

  async context(key: string): Promise<BrowserContext> {
    const existing = this.contexts.get(key);
    if (existing) return existing;
    const browser = await this.getBrowser();
    const ctx = await browser.newContext({
      viewport: { width: 1366, height: 860 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0 Safari/537.36 OmniPilot/0.1 (+research; read-only)",
      acceptDownloads: false,
      serviceWorkers: "block",
      javaScriptEnabled: true,
    });
    // Block subresources that target non-http(s) schemes or local/private literal hosts.
    await ctx.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      try {
        checkUrlStructure(url, this.policy);
        if (route.request().isNavigationRequest() && route.request().frame() === route.request().frame().page().mainFrame()) {
          await validateUrl(url, this.policy);
        }
        return route.continue();
      } catch {
        return route.abort("blockedbyclient");
      }
    });
    this.contexts.set(key, ctx);
    return ctx;
  }

  /**
   * Open a URL in a fresh page, wait for content, validate the redirect chain and
   * return an observation snapshot. The page is returned so callers can screenshot it;
   * callers must call release().
   */
  async open(
    key: string,
    rawUrl: string,
    signal?: AbortSignal,
  ): Promise<{ page: Page; snapshot: PageSnapshot; release: () => Promise<void> }> {
    await validateUrl(rawUrl, this.policy);
    if (signal?.aborted) throw new BrowserError("Cancelled before navigation", "cancelled");
    const releaseSlot = await this.sem.acquire();
    let page: Page | undefined;
    const pages = this.livePages.get(key) ?? new Set<Page>();
    this.livePages.set(key, pages);
    const onAbort = () => void page?.close().catch(() => {});
    signal?.addEventListener("abort", onAbort, { once: true });
    const release = async () => {
      signal?.removeEventListener("abort", onAbort);
      if (page) pages.delete(page);
      await page?.close().catch(() => {});
      releaseSlot();
    };
    try {
      const ctx = await this.context(key);
      page = await ctx.newPage();
      pages.add(page);
      page.setDefaultTimeout(this.opts.navTimeoutMs);
      let response;
      try {
        response = await page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout: this.opts.navTimeoutMs });
      } catch (e) {
        throw classifyNavError(e, signal);
      }
      // Give client-rendered pages a brief, bounded chance to paint content.
      await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
      if (signal?.aborted) throw new BrowserError("Cancelled during navigation", "cancelled");

      const chain: string[] = [];
      let req = response?.request().redirectedFrom() ?? null;
      while (req) {
        chain.unshift(req.url());
        req = req.redirectedFrom();
      }
      const finalUrl = page.url();
      try {
        await validateRedirectChain([...chain, finalUrl], this.policy);
      } catch (e) {
        throw new BrowserError(
          `Redirect led to a blocked destination: ${e instanceof UnsafeUrlError ? e.message : String(e)}`,
          "blocked",
        );
      }
      const status = response?.status();
      if (status && status >= 400) {
        throw new BrowserError(`Page returned HTTP ${status}`, "http_error");
      }
      const extracted = (await page.evaluate(EXTRACT_SCRIPT)) as Omit<PageSnapshot, "requestedUrl" | "finalUrl" | "redirectChain" | "httpStatus">;
      return {
        page,
        release,
        snapshot: { requestedUrl: rawUrl, finalUrl, redirectChain: chain, httpStatus: status, ...extracted },
      };
    } catch (e) {
      await release();
      if (e instanceof BrowserError || e instanceof UnsafeUrlError) throw e;
      throw classifyNavError(e, signal);
    }
  }

  async screenshot(page: Page, file: string): Promise<void> {
    await page.screenshot({ path: file, type: "jpeg", quality: 70, fullPage: false, timeout: 10_000 });
  }

  /** Render local HTML (an artifact we generated) without network access, for render verification. */
  async renderHtml(html: string, screenshotFile: string): Promise<{ consoleErrors: string[]; title: string; textLength: number }> {
    const browser = await this.getBrowser();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
    await ctx.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => consoleErrors.push(e.message));
    try {
      await page.setContent(html, { waitUntil: "load", timeout: 10_000 });
      await page.screenshot({ path: screenshotFile, type: "png", fullPage: false });
      const title = await page.title();
      const textLength = (await page.evaluate("document.body ? document.body.innerText.length : 0")) as number;
      return { consoleErrors, title, textLength };
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  async closeContext(key: string): Promise<void> {
    const ctx = this.contexts.get(key);
    this.contexts.delete(key);
    this.livePages.delete(key);
    await ctx?.close().catch(() => {});
  }

  async shutdown(): Promise<void> {
    for (const key of [...this.contexts.keys()]) await this.closeContext(key);
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
  }
}

function classifyNavError(e: unknown, signal?: AbortSignal): BrowserError {
  if (signal?.aborted) return new BrowserError("Navigation cancelled", "cancelled");
  const msg = e instanceof Error ? e.message : String(e);
  const first = msg.split("\n")[0];
  if (/Timeout/i.test(msg)) return new BrowserError(`Navigation timed out: ${first}`, "timeout");
  if (/ERR_BLOCKED_BY_CLIENT/i.test(msg)) return new BrowserError("Navigation blocked by OmniPilot URL policy", "blocked");
  if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_INTERNET|ERR_ADDRESS|ERR_CERT|ERR_SSL|net::/i.test(msg)) {
    return new BrowserError(`Site unreachable from this environment: ${first}`, "network");
  }
  if (/closed|Target page/i.test(msg)) return new BrowserError(`Browser page closed: ${first}`, "cancelled");
  return new BrowserError(first, "unknown");
}
