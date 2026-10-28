import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { MissionEngine } from "./core/engine.js";
import { MissionStore } from "./core/store.js";
import type { Mission } from "./core/types.js";
import { BrowserManager } from "./browser/browserManager.js";
import { createRegistry } from "./tools/index.js";
import { ToolError } from "./tools/registry.js";
import { llmStatus } from "./llm/claude.js";
import { pricingPages, readPricingScreenshots } from "./core/vision.js";
import { PlanValidationError, type FixtureCatalog } from "./core/planner.js";
import { UnsafePathError, assertSafeId } from "./security/paths.js";
import { UnsafeUrlError, type UrlPolicy } from "./security/urlSafety.js";
import { config } from "./config.js";

export interface AppOptions {
  dataDir?: string;
  urlPolicy?: UrlPolicy;
  forceMode?: "claude" | "deterministic";
  staticDir?: string;
  /** Offline demo: fictional vendors served locally. Missions are labelled as fixture data everywhere. */
  fixture?: FixtureCatalog;
}

const CreateBody = z.object({
  prompt: z.string().trim().min(8, "Describe the mission in at least a few words").max(4000),
  productName: z.string().trim().max(60).optional(),
  productPitch: z.string().trim().max(400).optional(),
});

const TargetsBody = z.object({
  targets: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(80),
        urls: z.array(z.string().trim()).min(1).max(3),
        origin: z.enum(["user", "catalog", "model"]),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(8),
});

const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK_HOST.test(u.host);
  } catch {
    return false;
  }
}

const MIME: Record<string, string> = {
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

export function createApp(opts: AppOptions = {}) {
  const store = new MissionStore(opts.dataDir ?? config.dataDir);
  const browser = new BrowserManager(opts.urlPolicy ?? {});
  const registry = createRegistry();
  const engine = new MissionEngine(store, registry, browser, () => opts.forceMode ?? llmStatus().mode, {
    stepTimeoutMs: config.stepTimeoutMs,
    maxParallel: 2,
    urlPolicy: opts.urlPolicy,
    fixture: opts.fixture,
  });
  const app = express();
  app.disable("x-powered-by");
  // Loopback only: a non-loopback Host means DNS rebinding, and a foreign Origin on a write means a cross-site post.
  app.use((req, res, next) => {
    if (!LOOPBACK_HOST.test(req.headers.host ?? "")) {
      res.status(403).json({ error: "This server only answers requests addressed to 127.0.0.1 or localhost", code: "forbidden_host" });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && req.method !== "GET" && req.method !== "HEAD" && !isLoopbackOrigin(origin)) {
      res.status(403).json({ error: "Requests started by another website are not accepted", code: "forbidden_origin" });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
  const mission = (req: Request): Mission => {
    const id = assertSafeId(String(req.params.id));
    const m = store.get(id);
    if (!m) throw new ToolError("Mission not found", "not_found");
    return m;
  };

  app.get("/api/health", (_req, res) => {
    const llm = llmStatus();
    res.json({
      ok: true,
      reasoning: { mode: opts.forceMode ?? llm.mode, configured: llm.configured, model: llm.configured ? llm.model : null },
      dataSource: opts.fixture ? "fixture" : "live",
      fixtureSites: opts.fixture ? opts.fixture.catalog.map((e) => ({ name: e.name, urls: e.urls })) : [],
      browser: { engine: "chromium (Playwright)", headed: browser.isHeaded, manualTakeover: browser.isHeaded ? "window" : "pause-only" },
      tools: registry.describe(),
    });
  });

  app.get("/api/missions", (_req, res) => res.json(store.list()));

  app.post(
    "/api/missions",
    wrap(async (req, res) => {
      const body = CreateBody.parse(req.body);
      const m = await engine.create(body);
      res.status(201).json(m);
    }),
  );

  app.get("/api/missions/:id", wrap((req, res) => res.json(mission(req))));

  app.put(
    "/api/missions/:id/targets",
    wrap((req, res) => {
      const m = mission(req);
      const body = TargetsBody.parse(req.body);
      res.json(engine.updateTargets(m.id, body.targets));
    }),
  );

  app.post("/api/missions/:id/approve", wrap((req, res) => res.json(engine.approve(mission(req).id))));
  app.post("/api/missions/:id/cancel", wrap((req, res) => res.json(engine.cancel(mission(req).id))));
  app.post("/api/missions/:id/pause", wrap((req, res) => res.json(engine.pause(mission(req).id))));
  app.post("/api/missions/:id/takeover", wrap((req, res) => res.json(engine.pause(mission(req).id, "Manual takeover requested"))));
  app.post("/api/missions/:id/resume", wrap((req, res) => res.json(engine.resume(mission(req).id))));
  // Multimodal companion: Claude reads the captured pricing screenshots. Paid, so the request must
  // carry the user's explicit confirmation, and it runs at most once per mission.
  const visionBusy = new Set<string>();
  app.post(
    "/api/missions/:id/vision/pricing",
    wrap(async (req, res) => {
      z.object({ confirmPaidCall: z.literal(true, "Reading screenshots is a paid Claude call and needs confirmPaidCall: true") }).parse(req.body ?? {});
      const m = mission(req);
      if (!llmStatus().configured) throw new ToolError("Claude is not configured on this server", "invalid_state", "Start the server with ANTHROPIC_API_KEY set to use screenshot reading.");
      // The offline demo forces rule-based mode and promises no Claude calls; that holds here too.
      if ((opts.forceMode ?? llmStatus().mode) !== "claude") throw new ToolError("This server runs in rule-based mode and makes no Claude calls", "invalid_state");
      if (m.status !== "completed" && m.status !== "completed_with_warnings") throw new ToolError("Screenshots can be read once the mission has completed", "invalid_state");
      if (m.visionRuns?.length) throw new ToolError("The screenshots of this mission were already read", "invalid_state");
      if (!pricingPages(m).length) throw new ToolError("This mission has no captured pricing screenshots", "invalid_state");
      if (visionBusy.has(m.id)) throw new ToolError("Screenshot reading is already running for this mission", "invalid_state");
      visionBusy.add(m.id);
      try {
        const run = await readPricingScreenshots(store, m.id);
        res.json({ run, mission: store.get(m.id) });
      } finally {
        visionBusy.delete(m.id);
      }
    }),
  );
  app.post(
    "/api/missions/:id/approvals/:approvalId",
    wrap((req, res) => {
      const { approved } = z.object({ approved: z.boolean() }).parse(req.body);
      res.json(engine.resolveApproval(mission(req).id, String(req.params.approvalId), approved));
    }),
  );
  app.post(
    "/api/missions/:id/browse",
    wrap(async (req, res) => {
      const { url } = z.object({ url: z.string().trim().min(4).max(2048) }).parse(req.body);
      const m = mission(req);
      const normalized = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
      const result = await engine.runAdHoc(m.id, "browser.open", { url: normalized, label: "Manual browse" });
      await engine.runAdHoc(m.id, "browser.screenshot", {}).catch(() => undefined);
      res.json({ ...result, mission: store.get(m.id) });
    }),
  );

  // Server-Sent Events: full mission snapshots, throttled. Replays current state on connect.
  app.get("/api/missions/:id/events", (req, res) => {
    let m: Mission;
    try {
      m = mission(req);
    } catch {
      res.status(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (mm: Mission) => res.write(`event: snapshot\ndata: ${JSON.stringify(mm)}\n\n`);
    send(m);
    let timer: NodeJS.Timeout | undefined;
    let latest: Mission | undefined;
    const onUpdate = (mm: Mission) => {
      latest = mm;
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (latest) send(latest);
      }, 120);
    };
    const key = `mission:${m.id}`;
    store.events.on(key, onUpdate);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      store.events.off(key, onUpdate);
      clearInterval(ping);
      clearTimeout(timer);
    });
  });

  // Artifact and evidence files: path-checked, served with explicit types, HTML sandboxed.
  app.get(
    /^\/api\/missions\/([a-z0-9_-]+)\/files\/(.+)$/i,
    wrap((req, res) => {
      const params = req.params as unknown as Record<string, string>;
      const id = assertSafeId(params[0]);
      if (!store.get(id)) throw new ToolError("Mission not found", "not_found");
      const rel = params[1];
      const full = store.filePath(id, rel);
      if (!fs.existsSync(full)) throw new ToolError("File not found", "not_found");
      const ext = path.extname(full).toLowerCase();
      res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
      if (req.query.download === "1") res.setHeader("Content-Disposition", `attachment; filename="${path.basename(full)}"`);
      fs.createReadStream(full).pipe(res);
    }),
  );

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir, { index: "index.html" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(opts.staticDir!, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? "Invalid request", code: "invalid_input" });
    if (err instanceof UnsafeUrlError) return res.status(400).json({ error: err.message, code: `unsafe_url:${err.code}` });
    if (err instanceof UnsafePathError) return res.status(400).json({ error: err.message, code: "unsafe_path" });
    if (err instanceof PlanValidationError) return res.status(422).json({ error: err.message, issues: err.issues, code: "invalid_plan" });
    if (err instanceof ToolError) {
      const status = err.code === "not_found" ? 404 : err.code === "invalid_state" ? 409 : 400;
      return res.status(status).json({ error: err.message, code: err.code, recovery: err.recovery });
    }
    console.error("[omnipilot] unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Internal error", code: "internal" });
  });

  return { app, store, engine, browser, registry };
}
