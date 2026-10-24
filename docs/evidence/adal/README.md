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

Not available: a recording or export of the AdaL session itself, screenshots, and Browser Use runs. None were made and none are claimed.
