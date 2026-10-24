import fs from "node:fs";
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

export interface ImageStats {
  width: number;
  height: number;
  meanLuma: number;
  lumaStd: number;
  /** Share of sampled pixels that differ noticeably from the dominant colour. */
  nonUniformShare: number;
}

export interface RenderLayout {
  viewport: { width: number; height: number };
  h1: { inFold: boolean; contrast: number | null; text: string } | null;
  cta: { inFold: boolean; contrast: number | null } | null;
  body: { contrast: number | null } | null;
}

export interface RenderResult {
  consoleErrors: string[];
  title: string;
  textLength: number;
  layout: RenderLayout;
  pixels: ImageStats;
}

const IMAGE_STATS_SCRIPT = `(() => {
  const img = document.getElementById("i");
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas");
  const scale = Math.min(1, 400 / Math.max(w, h));
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0, sum = 0, sq = 0; const hist = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    sum += y; sq += y * y; n++;
    const key = (d[i] >> 4) + "," + (d[i + 1] >> 4) + "," + (d[i + 2] >> 4);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const mean = sum / n;
  const top = Math.max(...hist.values());
  return { width: w, height: h, meanLuma: Math.round(mean * 10) / 10, lumaStd: Math.round(Math.sqrt(Math.max(0, sq / n - mean * mean)) * 10) / 10, nonUniformShare: Math.round((1 - top / n) * 1000) / 1000 };
})()`;

// WCAG 2.x contrast of an element's text colour against its effective (first opaque ancestor) background.
const LAYOUT_SCRIPT = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const parse = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(",").map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const contrast = (el) => { const fg = parse(getComputedStyle(el).color); if (!fg) return null; const a = lum(fg), b = lum(bgOf(el)); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
  const inFold = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw && getComputedStyle(el).visibility !== "hidden"; };
  const h1 = document.querySelector("h1");
  const cta = document.querySelector(".cta, a[href], button");
  const sub = document.querySelector(".sub, p");
  return {
    viewport: { width: vw, height: vh },
    h1: h1 ? { inFold: inFold(h1), contrast: contrast(h1), text: (h1.innerText || "").slice(0, 120) } : null,
    cta: cta ? { inFold: inFold(cta), contrast: contrast(cta) } : null,
    body: sub ? { contrast: contrast(sub) } : null,
  };
})()`;

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
  /**
   * Pixel statistics for a screenshot, computed in a scratch page canvas. This is measurement,
   * not image understanding: it tells us whether a capture is blank or near-uniform.
   */
  async imageStats(file: string): Promise<ImageStats> {
    const browser = await this.getBrowser();
    const ctx = await browser.newContext({ javaScriptEnabled: true });
    await ctx.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
    try {
      const page = await ctx.newPage();
      const ext = file.toLowerCase().endsWith(".png") ? "png" : "jpeg";
      const b64 = fs.readFileSync(file).toString("base64");
      await page.setContent(`<img id="i" src="data:image/${ext};base64,${b64}">`, { waitUntil: "load", timeout: 10_000 });
      return (await page.evaluate(IMAGE_STATS_SCRIPT)) as ImageStats;
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  async renderHtml(html: string, screenshotFile: string): Promise<RenderResult> {
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
      const layout = (await page.evaluate(LAYOUT_SCRIPT)) as RenderLayout;
      const pixels = await this.imageStats(screenshotFile);
      return { consoleErrors, title, textLength, layout, pixels };
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
