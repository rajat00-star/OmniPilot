import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";
import type { Page } from "playwright";
import { BrowserError, type PageSnapshot } from "../browser/browserManager.js";
import { buildCaptureDocument, extractObservations } from "../core/extraction.js";
import { newId, nowIso } from "../core/store.js";
import type { Observation, SourceCapture, Target } from "../core/types.js";
import { UnsafeUrlError } from "../security/urlSafety.js";
import { ToolError, type Tool, type ToolContext } from "./registry.js";

interface OpenPage {
  page: Page;
  snapshot: PageSnapshot;
  source: SourceCapture;
  release: () => Promise<void>;
}

/** The page most recently opened by browser.open for each mission (used by extract/screenshot). */
const currentPages = new Map<string, OpenPage>();

export async function releaseCurrentPage(missionId: string): Promise<void> {
  const cur = currentPages.get(missionId);
  currentPages.delete(missionId);
  await cur?.release();
}

/** Navigate, observe, and persist the capture document. Failures are recorded as failed sources. */
async function openAndRecord(
  ctx: ToolContext,
  target: Pick<Target, "id" | "name">,
  url: string,
): Promise<{ source: SourceCapture; open?: OpenPage }> {
  const source: SourceCapture = {
    id: newId("src"),
    targetId: target.id,
    targetName: target.name,
    requestedUrl: url,
    redirectChain: [],
    capturedAt: nowIso(),
    ok: false,
    stepId: ctx.stepId,
  };
  ctx.log("info", `Navigating to ${url}`, { url }, "browser.open");
  ctx.frame({ url, state: "loading", stepId: ctx.stepId });
  try {
    const { page, snapshot, release } = await ctx.browser.open(ctx.missionId, url, ctx.signal);
    source.capturedAt = nowIso();
    source.finalUrl = snapshot.finalUrl;
    source.redirectChain = snapshot.redirectChain;
    source.httpStatus = snapshot.httpStatus;
    source.title = snapshot.title;
    source.ok = true;
    const doc = buildCaptureDocument(snapshot, source.capturedAt);
    const textFile = `sources/${source.id}.txt`;
    fs.writeFileSync(ctx.store.filePath(ctx.missionId, textFile), doc, "utf8");
    source.textFile = textFile;
    source.textSha256 = crypto.createHash("sha256").update(doc).digest("hex");
    source.textLength = doc.length;
    ctx.log(
      "success",
      `Loaded "${snapshot.title || snapshot.finalUrl}" (${snapshot.visibleText.length.toLocaleString()} chars of visible text)`,
      { url: snapshot.finalUrl, status: snapshot.httpStatus, redirects: snapshot.redirectChain.length },
      "browser.open",
    );
    return { source, open: { page, snapshot, source, release } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    source.error = msg;
    const state = e instanceof UnsafeUrlError || (e instanceof BrowserError && e.code === "blocked") ? "blocked" : "failed";
    ctx.frame({ url, state, detail: msg, stepId: ctx.stepId });
    ctx.log(e instanceof BrowserError && e.code === "cancelled" ? "warning" : "error", `Could not load ${url}: ${msg}`, { url }, "browser.open");
    if (e instanceof BrowserError && e.code === "cancelled") throw new ToolError(msg, "cancelled");
    return { source };
  }
}

async function screenshotInto(ctx: ToolContext, open: OpenPage): Promise<void> {
  const file = `screens/${open.source.id}.jpg`;
  try {
    await ctx.browser.screenshot(open.page, ctx.store.filePath(ctx.missionId, file));
    open.source.screenshotFile = file;
    ctx.log("info", `Captured screenshot of ${open.snapshot.finalUrl}`, { file }, "browser.screenshot");
  } catch (e) {
    ctx.log("warning", `Screenshot failed: ${(e as Error).message.split("\n")[0]}`, {}, "browser.screenshot");
  }
  ctx.frame({
    url: open.snapshot.finalUrl,
    requestedUrl: open.source.requestedUrl,
    title: open.snapshot.title,
    screenshotFile: open.source.screenshotFile,
    state: "loaded",
    stepId: ctx.stepId,
  });
}

function recordSource(ctx: ToolContext, source: SourceCapture, observations: Observation[] = []): void {
  ctx.store.update(ctx.missionId, (m) => {
    m.sources.push(source);
    m.observations.push(...observations);
  });
}

const urlInput = z.object({ url: z.string().min(8).max(2048), label: z.string().max(80).optional() });

export const browserOpen: Tool<z.infer<typeof urlInput>> = {
  name: "browser.open",
  description: "Navigate the controlled browser to a validated public http(s) URL and record the page as a source.",
  inputSchema: urlInput,
  consequential: false,
  retryable: true,
  async run(ctx, input) {
    await releaseCurrentPage(ctx.missionId);
    const { source, open } = await openAndRecord(ctx, { id: "manual", name: input.label || "Manual browse" }, input.url);
    recordSource(ctx, source);
    if (!open) throw new ToolError(source.error || "Navigation failed", "navigation_failed", "Check the URL or try another source.", true);
    currentPages.set(ctx.missionId, open);
    return { summary: `Opened ${source.finalUrl} — "${source.title}"`, evidenceIds: [source.id], output: { url: source.finalUrl, title: source.title } };
  },
};

export const browserExtract: Tool<Record<string, never>> = {
  name: "browser.extract",
  description: "Extract description, headings, displayed prices and audience signals from the current page.",
  inputSchema: z.object({}).strict(),
  consequential: false,
  retryable: false,
  async run(ctx) {
    const cur = currentPages.get(ctx.missionId);
    if (!cur) throw new ToolError("No page is open", "no_page", "Run browser.open first.");
    const obs = extractObservations(cur.snapshot, cur.source);
    ctx.store.update(ctx.missionId, (m) => m.observations.push(...obs));
    ctx.log("success", `Extracted ${obs.length} observations from ${cur.snapshot.finalUrl}`, {}, "browser.extract");
    return { summary: `${obs.length} observations extracted`, evidenceIds: obs.map((o) => o.id) };
  },
};

export const browserScreenshot: Tool<Record<string, never>> = {
  name: "browser.screenshot",
  description: "Capture a screenshot of the current page as visual evidence.",
  inputSchema: z.object({}).strict(),
  consequential: false,
  retryable: true,
  async run(ctx) {
    const cur = currentPages.get(ctx.missionId);
    if (!cur) throw new ToolError("No page is open", "no_page", "Run browser.open first.");
    await screenshotInto(ctx, cur);
    ctx.store.update(ctx.missionId, (m) => {
      const s = m.sources.find((x) => x.id === cur.source.id);
      if (s) s.screenshotFile = cur.source.screenshotFile;
    });
    if (!cur.source.screenshotFile) throw new ToolError("Screenshot failed", "screenshot_failed");
    return { summary: `Screenshot saved (${cur.source.screenshotFile})`, evidenceIds: [cur.source.id] };
  },
};

export const researchCollect: Tool<{ targetId: string }> = {
  name: "research.collect",
  description:
    "For one research target: open each official URL (browser.open), extract observations (browser.extract) and capture a screenshot (browser.screenshot). Inaccessible sources are recorded as failures.",
  inputSchema: z.object({ targetId: z.string().regex(/^[a-z0-9-]{1,40}$/) }),
  consequential: false,
  retryable: false,
  async run(ctx, input) {
    const target = ctx.mission().plan?.targets.find((t) => t.id === input.targetId);
    if (!target) throw new ToolError(`Unknown target ${input.targetId}`, "unknown_target");
    const evidence: string[] = [];
    let ok = 0;
    let attempts = 0;
    const errors: string[] = [];
    for (const url of target.urls) {
      await ctx.checkpoint();
      if (ctx.signal.aborted) throw new ToolError("Cancelled", "cancelled");
      attempts++;
      let { source, open } = await openAndRecord(ctx, target, url);
      // One polite retry for timeouts only; network policy and HTTP errors are not retried.
      if (!open && /timed out/i.test(source.error || "") && !ctx.signal.aborted) {
        ctx.log("info", `Retrying ${url} once after timeout`, {}, "browser.open");
        ({ source, open } = await openAndRecord(ctx, target, url));
      }
      if (!open) {
        errors.push(`${url}: ${source.error}`);
        recordSource(ctx, source);
        continue;
      }
      try {
        await screenshotInto(ctx, open);
        const obs = extractObservations(open.snapshot, source);
        ctx.log("success", `Extracted ${obs.length} observations from ${source.finalUrl}`, { fields: [...new Set(obs.map((o) => o.field))] }, "browser.extract");
        recordSource(ctx, source, obs);
        evidence.push(source.id, ...obs.map((o) => o.id));
        ok++;
      } finally {
        await open.release();
      }
    }
    if (ok === 0) {
      throw new ToolError(
        `No source for ${target.name} could be captured (${attempts} attempted). ${errors.join(" | ")}`.slice(0, 900),
        "sources_unavailable",
        "The site may block automated access or be outside this environment's network allowlist. Edit the target URLs or continue without it; it will be reported as Unknown.",
      );
    }
    return {
      summary: `${ok}/${attempts} pages captured for ${target.name}`,
      evidenceIds: evidence,
      outcome: ok < attempts ? "partial" : "ok",
    };
  },
};
