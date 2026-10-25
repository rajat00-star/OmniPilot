# Product validation

This file has two parts. **Part A** is measured on the developer machine on 2026-10-24 during an AdaL session (evidence: `docs/evidence/adal/`). **Part B** is the earlier validation from a cloud build container, kept for history and labelled with its original environment. Part B results were not re-run on the Mac and must not be read as measured here.

Status key: **Verified** = executed and passed in the stated environment. **Partial** = works with a stated gap. **Not verified** = implemented or documented, not executed in any environment I can point to. **Blocked** = cannot be run without something missing. **Not met** = absent.

---

# Part A: measured on the developer machine (2026-10-24)

## Environment
| Item | Value |
|---|---|
| OS / arch | macOS (Darwin 27.2.0), arm64 |
| Node / npm | v26.11.1 / 11.20.0 (docs target Node 20+, earlier validation used Node 22) |
| Playwright | 1.63.0, Chromium headless shell build 1243, installed with `npx playwright install chromium` |
| Base commit | `4955585`; the fix is in `f763ccd` |
| `NODE_ENV` | The shell had `NODE_ENV=production`. With that, `npm ci` skips devDependencies and `typecheck`/`build`/`test` fail with "command not found". Measured runs used `NODE_ENV=development` (install, typecheck, build) and `NODE_ENV=test` (tests). |
| API key | None used. No Claude/API call was made. |
| Network | Package and browser installation, plus one exception: the two pre-fix runs of the original `engine.test.ts` failure made Chromium attempt a connection to the private address `10.20.30.40` (no answer was received). All diagnosis and the new tests run offline or against loopback only, and the fixed code never reaches that address. |

## Commands and results
| Command | Before the redirect fix | After the redirect fix |
|---|---|---|
| `NODE_ENV=development npm ci --include=dev` | exit 0, 150 packages, 0 vulnerabilities | n/a |
| `NODE_ENV=development npm run typecheck` | exit 0 | exit 0 |
| `NODE_ENV=development npm run build` | exit 0 (JS chunk 515 kB triggers Vite's 500 kB warning) | exit 0, same warning |
| `NODE_ENV=test npm test` | exit 1: 10 files, **90 of 91 passed**, 1 failed | exit 0: 11 files, **106 of 106 passed** |
| `NODE_ENV=test npx vitest run tests/redirectGuard.test.ts` | 12 failed, 3 passed | 15 passed |

The pre-fix failure was `tests/engine.test.ts` "reports extraction failures and blocked redirects honestly and degrades the mission" (expected `/blocked/`, received `Navigation timed out`). Root cause and fix: redirect hops were not seen by Playwright route handlers, so they were only validated after the browser had already requested them. They are now validated through CDP Fetch interception before any connection. See `docs/ADAL.md` and `docs/SECURITY.md`.

Logs: `docs/evidence/adal/full_suite.BEFORE_fix.log`, `full_suite.AFTER_fix.log`, `redirect_guard_test.*.log`, `typecheck.AFTER_fix.log`, `build.AFTER_fix.log`.

## Not executed on this machine
`npm run mission`, `npm run e2e:ui`, `node tests/e2e/live-controls.mjs`, any live public-site research, any Claude/API run, and headed-mode takeover. They need outside network access, an API key you approve spending, or a visible browser. Their results appear only in Part B.

## Mandatory track requirements (status as of this file)
Evidence type matters: *unit* = pure code tests; *mocked browser* = real Chromium, no outside host; *local E2E* = real Chromium against the loopback fixture; *live* = outside sites; *Claude* = real API.

| # | Requirement | Status | Evidence | Remaining work and limits |
|---|---|---|---|---|
| 1 | AI-native desktop browser or browser-integrated workspace | **Partial** | Web UI driving real Chromium; `tests/engine.test.ts` (local E2E), `npm run build` | No Electron shell. Without a key there is no AI reasoning (deterministic mode). Whether to package it is an owner decision. |
| 2 | Natural-language multi-step task execution | **Verified (deterministic, local)** / **Not verified (Claude)** | `tests/planner.test.ts`, `tests/engine.test.ts` | Claude planning path never run live (`tests/llm.test.ts` covers missing-key and schema handling only). |
| 3 | Real browser / authorized application interaction | **Verified (local fixture)** / **Not verified on this machine (live sites)** | `tests/engine.test.ts`, `tests/visual.test.ts`; live captures only in Part B | Live public-site capture was not repeated here. |
| 4 | Outcome verification | **Verified (unit + local E2E)** | `tests/verifier.test.ts` (11), `tests/engine.test.ts`, `tests/visual.test.ts` | Proves integrity and traceability, not that vendor claims are true. |
| 5 | Transparent progress, actions, results, errors | **Verified (API/SSE tests; real UI on a fixture site via Browser Use)** | `tests/api.test.ts`, `docs/evidence/adal/ui/` | `npm run e2e:ui` (external sites) not run on this machine. |
| 6a | User approval | **Verified (local E2E)** | `tests/engine.test.ts` approval/denial tests | The consequential-step gate is tested only with a test tool; no real plan produces one. |
| 6b | Cancellation | **Verified (local E2E; real UI Stop button on a fixture site)** | `tests/engine.test.ts` "cancels a running mission", `docs/evidence/adal/ui/09-cancelled.jpg` | Live-controls script not run here. |
| 6c | Manual takeover | **Partial** | Pause/resume in `tests/engine.test.ts`; Pause and Resume buttons in the real UI (`docs/evidence/adal/ui/08-paused-takeover.jpg`) | The "Take over" button was not clicked. In-page clicking needs headed mode (`OMNIPILOT_HEADED=1`); not tested anywhere. |
| 7 | End-to-end multi-tool workflow | **Verified (local fixture)** | `tests/engine.test.ts` full-mission test | Five-competitor live mission not re-run here. |
| 7b | URL/redirect safety (supporting security control) | **Verified (unit + mocked browser)** | `tests/urlSafety.test.ts`, `tests/redirectGuard.test.ts`, `tests/engine.test.ts` | Tested on macOS/Node 26 only; not tested behind a restricted proxy. |
| 8 | Active use of AdaL by Sylph | **Partial** | `docs/ADAL.md`, `docs/evidence/adal/` | One session. Browser Use run on the fixture-backed UI only; no session export or recording. |
| 9 | Genuine evidence of AdaL usage | **Partial** | `docs/evidence/adal/README.md` | Real logs, patch and diagnostics exist and are committed (`f763ccd` and follow-up); no screen recording. |
| – | Five competitors fully researched (signature mission) | **Not verified here / Blocked** | Part B only | Needs unrestricted network and approval to browse; Part B reached 2 of 5. |
| – | Live Claude mode | **Blocked** | None | Needs an API key you approve for paid use. A key variable exists in the shell but was not read or used. |
| – | Image understanding of screenshots (multimodal) | **Not met** | – | Only pixel-statistics and layout checks exist (`tests/visual.test.ts`, local). No model interprets images. |

---

# Part B: historical validation (cloud build container, commit `9c6a150`, 2026-10-24)

*Provenance: written by the original build in a cloud container with Node 22.22, Playwright 1.63 Chromium, no `ANTHROPIC_API_KEY`, and an egress proxy that reached only a few public hosts (claude.com, microsoft.com, github.com reachable; chatgpt.com, gemini.google, mistral.ai, perplexity.ai, notion.com, cursor.com, jasper.ai not). Not re-run on the Mac. Its test counts (91 tests) predate the redirect fix and the 15 new tests.*

| # | Requirement | Status then | Evidence then |
|---|---|---|---|
| 1 | AI-native browser-integrated workspace | Partial | Web workspace, no Electron; deterministic mode runs no AI reasoning |
| 2 | Natural-language multi-step execution | Verified (deterministic) / Unverified (Claude) | Signature instruction produced a 12-step plan and executed |
| 3 | Real browser interaction | Verified | Live captures of claude.com, anthropic.com, microsoft.com, github.com |
| 4 | Outcome verification | Verified | 36/36 checks on the live signature mission; 11 tamper tests |
| 5 | Transparent progress | Verified | SSE, activity log, UI e2e with zero console errors |
| 6a / 6b / 6c | Approval / cancellation / takeover | Verified / Verified / Partial | Live control script, 17 expectations met; clicking in page needs headed mode |
| 7 | End-to-end multi-tool workflow | Verified | Full tool chain on the live mission |
| 8 / 9 | AdaL use and evidence | Not met | AdaL was not installed in that container |

Signature mission then: `completed_with_warnings`, 4/10 pages, 2/5 competitors (6 pages blocked by that container's network policy), 36/36 checks. Named-competitor mission (Claude, Microsoft Copilot, GitHub Copilot): `completed`, 6/6 sources, 55/55 observations grounded. Visual verification: render σ=34.6, hero and CTA above the fold, contrast 15.71 / 7.3 / 4.04:1. Test totals then: 10 files, 91 tests passed; typecheck and build passed; `live-controls.mjs` 17/17; `npm run e2e:ui` completed with 0 console errors. Claude mode: not run.

Fixed during that validation: the deterministic seed-list selector chose the wrong competitors (instruction verbs read as product topics), and inaccessible competitors were shown as "Not found" rather than "Unknown". Both have regression tests.

Known gap from that run, now addressed: that container's redirect-block test passed, but on the Mac it exposed that redirect hops were validated only after the browser requested them (Part A).
