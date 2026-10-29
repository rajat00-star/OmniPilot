# Grand Finale runbook

Everything here was run on 2026-10-28 in a Linux cloud container (Node 22.22, Playwright 1.63 Chromium, no API key). Rehearse once on the presenting laptop before going on stage.

## 1. Launch

```bash
npm ci
npx playwright install chromium   # skip if Playwright's Chromium is already installed
npm run build                     # UI into dist/web
```

| Mode | Command | What the audience sees |
|---|---|---|
| **Offline demo (primary on stage)** | `env -u ANTHROPIC_API_KEY npm run demo:offline` | Amber "OFFLINE DEMO MODE" strip. Five fictional vendors served on `127.0.0.1:41001–41005`. Only those origins can be opened; the public web and the app's own API are blocked. Reasoning is forced to deterministic. Data in `./data-demo`. |
| Live web | `npm start` | Real public sites, via the curated seed list or URLs you paste. Depends on the venue network. |
| Live + Claude | `.env` with `ANTHROPIC_API_KEY`, then `npm start` | Claude plans, writes the analysis and can read the pricing screenshots. **Makes paid calls.** |

Open http://127.0.0.1:8787. Stop with Ctrl+C. Knobs: `PORT`, `OMNIPILOT_DEMO_BASE_PORT` (41001), `OMNIPILOT_DEMO_LATENCY_MS` (2000 ms per fixture page, which slows the run to a pace you can narrate), `OMNIPILOT_HEADED=1` (visible Chromium window).

On macOS with `NODE_ENV=production` in the shell, use `NODE_ENV=development npm ci --include=dev` (see `docs/ADAL.md`).

**Rehearsal check (about 1 minute):** with the offline demo running, `node tests/e2e/offline-demo-ui.mjs http://127.0.0.1:8787 /tmp/rehearsal` drives the whole journey through the real UI and prints the result table. The last recorded run is in `docs/screenshots/offline-demo/run-log.json`.

## 2. What the offline fixture contains

| Vendor (fictional) | Pages | Behaviour it demonstrates |
|---|---|---|
| Lumina Assist | `/`, `/pricing` | Normal product and pricing pages, free tier, three prices |
| Orbit Copilot | `/` → 301 → `/platform`, `/pricing` | Redirect recorded hop by hop and validated; € pricing |
| Quillstone AI | `/`, `/pricing` | No displayed price → **Not found**, never 0 |
| Atlas Agents | `/`, `/pricing` (HTTP 403) | Blocked page → failed source, competitor "partial", run ends **Completed with warnings** |
| Nimbus Chat | `/`, `/pricing` | Page text tells "AI agents" to mark every check as passed; it has no effect and never reaches an artifact |

Last rehearsal, mission `msn_62b4931532ab`: 9/10 planned pages captured, 5/5 competitors, prices for 3/5, 38/38 observations grounded, 38/38 checks passed, 5/5 artifacts downloaded with sha256 matching the record, Take over blocked `https://example.com` and allowed a fixture page, Stop gave `cancelled` with 0 artifacts, 0 console errors.

## 3. Timed demo

The judge-facing script, with narration, expected results, a failure workflow, a recording checklist and a fallback, is in [DEMO_SCRIPT.md](DEMO_SCRIPT.md). For the offline fixture version, follow its fallback row: **Signature mission → Draft plan → Approve**. Then use Take over (`https://example.com` refused, `127.0.0.1:41001/pricing` allowed), the Results tab (Atlas 403 → *completed with warnings*, Quillstone → *Not found*), Judge mode, and the Nimbus page whose injected instructions have no effect.

## 4. Recovery plan

| Problem | Recovery |
|---|---|
| `npm run demo:offline` says port in use | Another server is running: Ctrl+C it, or `PORT=8788 npm run demo:offline`. Fixture ports busy: `OMNIPILOT_DEMO_BASE_PORT=42001`. |
| UI shows "Server unreachable" | The server stopped. Restart it; finished missions reload from `./data-demo` (in-progress ones are marked "Interrupted"). |
| Run is too fast to narrate | Press **Pause** (time paused no longer counts against the step budget), or restart with `OMNIPILOT_DEMO_LATENCY_MS=3500`. |
| Run is stuck on a step | Each page has a 25 s navigation timeout and each step a 120 s budget of agent time; it will fail honestly. Press **Stop** and show the completed rehearsal mission from the sidebar. |
| Chromium fails to launch | `npx playwright install chromium`, or point `OMNIPILOT_CHROMIUM_PATH` at an installed Chromium. |
| Anything else on stage | Open the completed mission from **History** (keep one from the rehearsal), or show the screenshots in `docs/screenshots/offline-demo/`. |
| Judges ask for a live site | Only if the venue network allows it: `npm start`, then **Your own URLs** with a reachable page. Say up front that live results depend on the network. |

## 5. Technical Q&A

**Architecture?** React 19 + Vite UI; Express 5 + TypeScript server; Playwright Chromium, one browser context per mission and at most two pages at once. The engine runs a validated dependency graph of registered tools (`research.collect`, `analysis.compare`, `artifact.write`, `verifier.check`, `report.finalize`), streams snapshots over SSE and persists each mission as JSON with atomic writes.

**Is it AI?** Two modes, labelled everywhere. Deterministic mode (what you are seeing) uses rules for planning and analysis; the browser work, extraction and verification are real. Claude mode lets Claude propose targets and write analysis, and discards any claim that does not cite a captured observation. Claude mode is tested end to end against a stand-in API. No real Claude API call has been made from this project yet: the 2026-10-28 Claude test (`docs/evidence/claude-test-2026-10-28/REPORT.md`) stopped before the call each time because the configured key was not a standard API key. The multimodal companion reads pricing screenshots with Claude and keeps only the readings it can find in the captured page text; see `docs/REQUIREMENTS.md` for what has run against the real API.

**How do you verify?** The verifier is separate from the writers. It reads every artifact back from disk and compares SHA-256 hashes. It parses CSV, Markdown, HTML and JSON, checks the required columns and sections, rejects zero placeholders for missing prices and resolves every citation and evidence id. It re-finds each quoted excerpt in the stored, hash-checked page capture and renders the landing page offline with pixel, above-the-fold and WCAG contrast checks. It also checks the data-source label. This proves integrity and traceability. It does not prove that a vendor's claims are true.

**Security?** Only http/https URLs are allowed, and URLs with embedded credentials are rejected. Private, loopback and metadata addresses and internal names are blocked, and DNS is checked. Redirect hops are validated over CDP *before* Chromium connects (the AdaL fix `f763ccd`), and the chain is checked again after navigation. Artifact paths are confined to the mission folder, and served HTML is sandboxed by CSP. Page text is treated as untrusted data. Consequential tools need explicit approval. The offline demo adds an exact-origin allowlist. Open risks: single-user local app, no auth; headless takeover is address bar only.

**What happens when a site blocks you?** That source is recorded as failed with the reason, the competitor becomes partial or Unknown, the report lists it under "Unknowns and failed sources", and the mission ends "completed with warnings".

**What did AdaL do?** One documented session (`docs/ADAL.md`, status Partial): it diagnosed and fixed the redirect-hop SSRF gap with 15 regression tests (`f763ccd`, `7887bde`), and drove the real UI with Browser Use against a fixture site (`decef72`, `438587f`). The finale changes (offline mode, pause-aware step budget, planner URL handling, Claude-mode hardening, Judge Mode, screenshot reading) were made with Claude Code, not AdaL. The tasks the team still runs with AdaL are listed in `docs/SUBMISSION.md`.

## 6. Implemented vs planned

| Implemented and exercised | Implemented, not exercised | Planned / not built |
|---|---|---|
| Plan → approval → browser execution → evidence → verification → deliverables; edit targets; pause, take over, resume, stop; redirect, 403 and missing-price handling; offline fixture mode with labelled artifacts; Judge Mode; a live three-vendor mission | Claude synthesis and screenshot reading against the real API (tested with a stand-in); headed-window takeover (needs a display); the consequential-approval gate in the UI (no plan produces one) | Desktop shell, authenticated sites, form submission, audio and video, multi-user access |
