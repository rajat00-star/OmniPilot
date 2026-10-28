# Evidence index

Every entry points to saved output from a real run. The folders named `*-2026-10-28` were written on the developer Mac (macOS, arm64). The cloud-container runs that predate the Mac are labelled as such in [VALIDATION.md](VALIDATION.md). Nothing here was produced by AdaL unless it is under `docs/evidence/adal/`.

## Current state (Grand Finale, 2026-10-28)

| What | Where | Shows |
|---|---|---|
| Final check run | `docs/evidence/finale-complete-2026-10-28/REPORT.md` and its logs | After all finale changes: typecheck exit 0, 17 files / 146 tests passed, build exit 0 (one warning: a JS chunk over 500 kB), offline UI rehearsal exit 0 with 0 console errors, and the git status confirming nothing was committed or pushed |
| Audit before the final changes | `docs/evidence/finale-audit-2026-10-28/` | Git state, the search for the official brief, checks (typecheck, 16 files / 138 tests, build), the evidence inventory and the AdaL install state |
| Judge dashboard on real data | `docs/evidence/judge-dashboard-2026-10-28/` | Judge mode on the live mission at desktop and phone widths; rehearsal log with Judge Mode steps (0 mission controls, Escape returns to the workspace) |
| Live web mission | `docs/evidence/live-mission-2026-10-28/` (copy of the git-ignored `data/missions/msn_e8b87606bacb/`, scanned for secrets; `SUMMARY.md`) | Otter.ai, Fireflies.ai and Fathom from one instruction: 6/6 public pages captured, prices for 3/3, 54/54 observations grounded, 28/28 checks; text captures with SHA-256, screenshots, CSV, report, evidence ledger, landing page and verification report |
| Screenshot reading, live API | `docs/evidence/vision-live-2026-10-28/` *(only if the paid run is approved)* | Request count, kept and discarded readings, token usage and cost |
| Claude mode test | `docs/evidence/claude-test-2026-10-28/` | The Claude configuration check. No real Claude call was made: the configured key was not a standard API key |
| Mac verification of the earlier finale patches | `docs/evidence/finale-mac-2026-10-28/` | Patches 1 and 2 applied; tests and offline rehearsal (38/38 checks) |
| Offline rehearsal screenshots | `docs/screenshots/offline-demo/` and `run-log.json` | Every UI stage of the fixture demo, including take-over and stop |

## Automated tests (what each file proves)

| File | Proves |
|---|---|
| `tests/planner.test.ts` | Instructions become validated plans: targets, deliverables, URLs, dependency graph, no cycles, unsafe URLs rejected |
| `tests/engine.test.ts` | Full mission in real Chromium against a local site; approval and denial; pause and cancel; blocked redirects; injected page instructions ignored |
| `tests/verifier.test.ts` | Tampered, missing, malformed and fake-zero artifacts are caught; excerpts re-grounded |
| `tests/visual.test.ts` | Blank screenshot detection; offline landing-page render, above-the-fold and contrast checks |
| `tests/offlineDemo.test.ts` | The five-vendor fixture run: redirect, missing price, 403 page, injection, data-source labels |
| `tests/dashboard.test.ts` | Judge dashboard and Judge Mode built from a real fixture mission; no invented findings; $0 vs Not found vs inaccessible; read-only Judge view |
| `tests/vision.test.ts` | Screenshot reading: grounding rule, image request shape, paid-call confirmation, once per mission, UI labels |
| `tests/claudeMode.test.ts` | Claude planning and synthesis against a stand-in API, deadlines and fallback, token usage logged, key never stored |
| `tests/urlSafety.test.ts`, `tests/redirectGuard.test.ts`, `tests/isolation.test.ts`, `tests/popupGuard.test.ts`, `tests/paths.test.ts` | SSRF and private-network blocking, redirect-hop validation, Host and Origin guard, pop-up windows blocked, file paths confined |
| `tests/api.test.ts`, `tests/llm.test.ts`, `tests/stateMachine.test.ts`, `tests/extraction.test.ts` | API validation and SSE, untrusted-content wrapping, legal state transitions, extraction rules |

UI rehearsal: `tests/e2e/offline-demo-ui.mjs <baseUrl> <outDir>` drives the real UI end to end. Pass an `outDir` so the committed screenshots are not overwritten.

## AdaL evidence (genuine, partial)

| What | Where |
|---|---|
| Session b4f50c11: redirect-hop SSRF fix with before and after logs, diagnostics and 15 regression tests; Browser Use run on the fixture UI | `docs/ADAL.md`, `docs/evidence/adal/` (commits `f763ccd` `7887bde` `decef72` `cf7c4ec` `438587f`) |
| Raw AdaL session transcripts | On the developer Mac in `~/.adal/sessions/`, not in the repository. See [SUBMISSION.md](SUBMISSION.md) for how to add them after a secrets review |

The uncommitted Grand Finale changes on top of `8fceb93` were written with Claude Code, not AdaL.
