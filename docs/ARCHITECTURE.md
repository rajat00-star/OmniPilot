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
```

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
