# AdaL session evidence index

Session: `b4f50c11-9603-4ce6-8283-7a3024ce6a8d`, date 2026-10-24, machine: macOS arm64, Node v26.11.1, npm 11.20.0, Playwright 1.63.0.
Starting commit: `4955585`. Fix commit: `f763ccd`. The `*.log` files are in a follow-up commit because `.gitignore` excludes `*.log` (they were added with `git add -f`).

Every file below is real tool output from that session or a source file from it. Nothing was typed in by hand except where stated.
ANSI colour codes were stripped from `*.log` files with `sed`; no other edits were made.

| File | What it is |
|---|---|
| `full_suite.BEFORE_fix.log` | `npm test` on the unmodified tree (copied from `/tmp/omnipilot_test.log`, written in an earlier turn of this session): 90 passed, 1 failed (`engine.test.ts` "blocked redirects"). |
| `diag_redirect_hop_probe.ts.txt` | Diagnostic script (offline context, DNS mocked) that logs which requests and routes fire. Stored with a `.txt` suffix because it was a throwaway script that imported `./server/...` from the repo root. |
| `diag_redirect_hop_probe.BEFORE_fix.output.txt` | Its output against the unmodified code. **Transcribed** from the session terminal, because it was not redirected to a file at the time (said so in the file header). |
| `diag_redirect_hop_probe.AFTER_fix.output.txt` | Same script, rerun with the fix (written directly by the command). |
| `diag_cdp_fetch_interception.ts.txt` / `.output.txt` | Stand-alone experiment (offline) showing CDP `Fetch.requestPaused` does fire for the redirect hop. |
| `redirect_guard_test.BEFORE_fix.log` | New `tests/redirectGuard.test.ts` run against the original `browserManager.ts` (temporarily stashed, then restored): 12 failed, 3 passed. |
| `redirect_guard_test.AFTER_fix.log` | Same test file with the fix: 15 passed. |
| `full_suite.AFTER_fix.log` | `npm test` with the fix: 11 files, 106 tests passed. |
| `typecheck.AFTER_fix.log`, `build.AFTER_fix.log` | `npm run typecheck`, `npm run build` (both exit 0). |
| `redirect-guard-source.patch` | `git diff -- server` for the fix. |

## Browser Use UI testing (fixture-backed, no API key) — `ui/`

Captured 2026-10-24/25 in the same session, after commits `f763ccd` and `7887bde`, against `tests/e2e/fixture-app.ts` (real app and UI, deterministic mode forced, fixture site only). Screenshots are real Browser Use captures copied unmodified from the session's screenshot folder and renamed. Details and what each shows are in `docs/ADAL.md`.

| File | What it is |
|---|---|
| `ui/01-composer-deterministic-mode.jpg` | New-mission screen; "Deterministic mode … not AI" notice |
| `ui/02-plan-preview-fixture-urls.jpg` | Plan preview ("nothing has run yet"), 7 steps, three fixture URLs |
| `ui/03-unsaved-edit-lost-on-reload.jpg` | After a reload the un-applied rename is gone (edits need "Apply and rebuild plan") |
| `ui/04-target-edit-persisted-after-apply.jpg` | After Apply and a reload the name `Fixture Sites` and rebuilt step title persist |
| `ui/05-mission-completed-results.jpg` | Completed mission: 3/3 sources, 12/12 grounded, 26/26 checks |
| `ui/06-evidence-tab.jpg`, `ui/07-verification-tab.jpg` | Evidence and Verification tabs |
| `ui/08-paused-takeover.jpg` | Paused mission with the takeover banner |
| `ui/09-cancelled.jpg` | Cancelled mission, all steps cancelled, no results |
| `ui/api_readback.txt` | Output of commands run against the app: health (no key configured), mission summary, byte comparison of artifact downloads with files on disk, source hash recomputation, pause/resume and cancel end states |
| `ui/competitor-analysis.csv.downloaded-via-ui` | CSV downloaded by clicking the artifact link in the browser |
| `full_suite.AFTER_ui_session.log`, `typecheck.AFTER_ui_session.log` | `npm test` (106 passed) and typecheck (exit 0) after the UI session |

Not captured: the paused-state API read (status `paused`, first step `running`) was read from the terminal and is described in `ADAL.md` but not saved as a file. One screenshot of a mis-aimed click was not kept.

## Phase A: final-demo validation, fixture-backed — `phaseA/`

Captured 2026-10-25 (local time) from commit `cf7c4ec`, no API key, fixture URLs only. First the shipped app (`NODE_ENV=development npm run build`, then `env -u ANTHROPIC_API_KEY OMNIPILOT_DATA_DIR=/tmp/omnipilot-phaseA-data npm start` on :8787), then the fixture launcher (`env -u ANTHROPIC_API_KEY npx tsx tests/e2e/fixture-app.ts 8788`). Details in `docs/ADAL.md`.

| File | What it is |
|---|---|
| `phaseA/01a-shipped-npm-start-composer.jpg`, `phaseA/01b-shipped-app-rejects-loopback-target.jpg` | Shipped `npm start` app: composer, then the planner refusing a loopback target ("Private, loopback or metadata address 127.0.0.1 is blocked") |
| `phaseA/02-add-target-three-rows-unsaved.jpg`, `phaseA/03-plan-rebuilt-9-steps-persisted.jpg` | Three targets added with "Add target", then applied; plan rebuilt to 9 steps |
| `phaseA/04-multi-competitor-completed.jpg`, `phaseA/05-verification-tab.jpg` | Completed 3-competitor mission (3/3 sources, 2/3 prices, 12/12 grounded, 26/26 checks) and its Verification tab |
| `phaseA/06-take-over-paused.jpg`, `phaseA/07-manual-navigation-beta.jpg` | "Take over": mission paused, then a manual address-bar navigation to a fixture page |
| `phaseA/08-stopped-cancelled.jpg` | Stop: mission cancelled, no artifacts |
| `phaseA/api_readback.txt` | Script output: HTTP downloads vs disk (byte compare), source hash recomputation, excerpt grounding, parsed CSV rows, path traversal, final states |
| `phaseA/research-report.md.downloaded-via-ui` | Report downloaded by clicking the artifact link in the browser |
| `phaseA/full_suite.PhaseA.log` | `npm test` run after the Phase A browser work (no code changed): 11 files, 106 passed. Typecheck exited 0 but was not saved to a file |

Not captured as files (seen in the terminal only): the startup banner of `npm start`, the `paused` status read after Take over, the typecheck exit code, and the browser console check.

Not available: a recording or export of the AdaL session itself, screenshots, and Browser Use runs. None were made and none are claimed.
