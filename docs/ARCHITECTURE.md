# Architecture

OmniPilot is a single Node.js process (Express API + Playwright) and a React single-page UI. There are no extra services: persistence is JSON per mission plus a files directory, which keeps the demo reproducible and easy to inspect.

```
 React UI ──HTTP──▶ Express API ──▶ MissionEngine ──▶ ToolRegistry (allowlist)
    ▲                    │               │                 ├─ browser.open / extract / screenshot ─▶ BrowserManager ─▶ Chromium (Playwright)
    │                    │               │                 ├─ research.collect
    └──── SSE snapshots ─┘               │                 ├─ analysis.compare ─▶ rules | Claude (structured output)
                                         │                 ├─ artifact.write / read / delete
                                         ▼                 ├─ verifier.check
                                   MissionStore            └─ report.finalize
                         data/missions/<id>/mission.json
                         data/missions/<id>/files/{sources,screens,*.csv,*.md,*.html,*.json}

 After completion (optional, paid, user-confirmed):
 Results ─POST /vision/pricing─▶ vision.readPricing ─screenshot (image)─▶ Claude ─plans─▶ grounding vs stored text ─▶ inferences
 Judge Mode (#/judge/<id>) ◀── read-only view model (web/src/lib/dashboard.ts) built from the same mission record
```

## Data flow

1. **Understand.** `POST /api/missions` → planner. Targets come from your URLs and names, the seed list, or Claude; `validatePlan` checks the result. Status `awaiting_approval`.
2. **Plan approval.** You edit targets and approve (`/approve`). No web page is opened before this.
3. **Execute.** `research.collect` per target. For each URL it validates the URL, opens it in Chromium, validates every redirect hop, stores the visible text with a SHA-256 hash, extracts observations and takes a screenshot.
4. **Analyse.** `analysis.compare` builds profiles and gaps: rule-based, or Claude with citations checked against observation ids.
5. **Deliver.** `artifact.write` renders CSV, Markdown, HTML and JSON from the records only.
6. **Verify.** `verifier.check` re-reads every file and capture, re-grounds excerpts and renders the HTML offline. `report.finalize` writes the verification report and the computed summary.
7. **Present.** The workspace streams it all live over SSE. Judge Mode turns the finished record into a summary in which every finding links to its evidence.
8. **Multimodal companion (optional).** Claude reads the captured pricing screenshots. Plan and price pairs are kept only when both strings occur in the stored text of that page, and are stored as inferences that need review.

## Components

| Component | File | Responsibility |
|---|---|---|
| Planner | `server/core/planner.ts` | Turns the instruction into targets, deliverables and a step graph. Claude mode asks Claude only for targets, URLs and deliverables via structured output; the engine builds the step graph. `validatePlan` checks every plan regardless of source: known tools, per-tool Zod input, unique ids, existing dependencies, no cycles, safe URLs. |
| Tool router | `server/tools/registry.ts`, `server/tools/index.ts` | The only place tools are registered. Steps name a tool; the engine dispatches to the registered implementation. There is no code-execution or shell tool. |
| Execution controller | `server/core/engine.ts` | Runs ready steps (dependencies satisfied) with bounded parallelism, per-step timeouts, one retry for retryable read-only tools, cancellation via `AbortController`, pause checkpoints, and approval gates for consequential tools. Non-critical failures (one inaccessible competitor) degrade the mission; critical failures skip dependents and fail it. |
| State machine | `server/core/stateMachine.ts` | Explicit mission states (`draft → planning → awaiting_approval → running ⇄ paused → verifying → completed / completed_with_warnings / failed / cancelled`) and step states. Illegal transitions throw. |
| Observation layer | `server/browser/browserManager.ts`, `server/core/extraction.ts` | Navigation, redirect chain capture, visible text, title, meta/OG description, headings, screenshot. The capture document is written to disk with a SHA-256 hash; observations quote it verbatim. |
| Analysis | `server/core/analysis.ts` | Competitor profiles, gaps and landing copy. Rule-based in deterministic mode; Claude mode cites observation ids, and claims citing unknown ids are dropped. |
| Report generator | `server/core/artifacts.ts`, `report.finalize` | Renders CSV, Markdown, HTML and JSON strictly from mission records. |
| Verifier | `server/core/verifier.ts` | Independent of whoever wrote the files: existence, read-back hash, parser, required columns/sections, empty or malformed records, zero-price placeholders, citation resolution, offline render, and excerpt re-grounding against stored captures. |
| Event stream | `server/app.ts` (`/api/missions/:id/events`) | Server-Sent Events carrying full mission snapshots (throttled to ~8/s), replayed on connect so reloading the UI loses nothing. |
| Persistence | `server/core/store.ts` | Atomic JSON writes per mission. Missions interrupted by a restart are marked failed with an explanation. |
| Screenshot reader | `server/core/vision.ts`, `POST /api/missions/:id/vision/pricing` | Multimodal companion. Sends up to 6 captured pricing screenshots to Claude as images (structured output, untrusted-content policy). It keeps a plan and price pairing only if both are in the page's stored text capture, whose hash is checked first, and records token usage and cost. Paid, so it needs `confirmPaidCall: true` and runs once per mission. |
| Judge Mode | `web/src/lib/dashboard.ts`, `web/src/components/Dashboard.tsx`, `JudgeView.tsx` | Pure view model of the mission record: findings only from quoted, re-grounded observations; pricing states (displayed, not found, inaccessible); a vendor-stated feature matrix; verification facts with an integrity disclaimer. Read-only route `#/judge/<id>`. |

## Data model

See `server/core/types.ts`. Key records:

* `StepRun`: id, title, tool, validated input, status, start/finish timestamps, attempts, result summary, evidence ids, artifact ids, verification status, error with recovery suggestion.
* `SourceCapture`: requested URL, final URL, redirect chain, HTTP status, title, capture time, stored text file and hash, screenshot, error.
* `Observation`: field, value, class (`observation` | `inference` | `unknown`), method, source, excerpt, basis ids, grounding check.
* `CheckResult`: scope (`integrity` | `coverage` | `grounding` | `render`), name, status, detail.

## Why these choices

* **Web workspace first, Electron later.** A browser-integrated workspace runs immediately and is easy to demo; Playwright drives a real Chromium either headless or visible (`OMNIPILOT_HEADED=1`). Electron packaging was deferred to avoid install risk.
* **Snapshots over deltas on SSE.** Mission documents are small (tens of KB); full snapshots make the UI trivially consistent.
* **JSON over SQLite.** No native build step, and every record is human-readable for judges.
* **Engine-built step graphs.** Claude chooses *what* to research, not *how* the engine runs; this keeps tool selection constrained and plans always valid.
