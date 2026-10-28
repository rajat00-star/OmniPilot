# OmniPilot Grand Finale: verification on this Mac (2026-10-28)

Repository: /Users/rajatsanger/Developer/OmniPilot, HEAD `8fceb93` ("docs: record Phase A evidence commit"). Nothing was committed, pushed, stashed, reset or deleted. No public website was contacted. No Claude/Anthropic API call was made: every app and test command ran with `env -u ANTHROPIC_API_KEY`, and the app reported `reasoning.mode = deterministic`.

**Result: the inherited Grand Finale patch verifies cleanly. I reproduced one inherited security gap (API isolation), fixed it as specified with a regression test, and re-verified everything after the fix.**

## 1. Environment and state (01-state.txt, 01b-patch-check.txt)

| Item | Result |
|---|---|
| `git rev-parse --short HEAD` / `git log -1 --oneline` | `8fceb93` / `8fceb93 docs: record Phase A evidence commit` |
| Modified tracked files | 26 (matches expected) |
| `git diff --check` | exit 0 |
| `git diff --stat \| tail -1` (inherited) | `26 files changed, 231 insertions(+), 40 deletions(-)` |
| Expected untracked files | all present: scripts/demo-offline.ts, server/demo/, tests/offlineDemo.test.ts, tests/e2e/offline-demo-ui.mjs, docs/FINALE.md, docs/screenshots/offline-demo/ |
| Other untracked files (pre-existing, not touched) | `omnipilot-finale-changes.patch` (a copy in the repo root, same hash), `docs/evidence/adal/phaseB/` |
| Patch sha256 (~/Downloads and repo-root copy) | `41c7d2ee8ffb593e9cadd420455c21ec2a6cc38aa857870808ba5e8c1bf30e04`, matches; 41 files in the patch |
| `git apply -R --check <patch>` | exit 0, so the patch is fully applied |
| Trailing whitespace in untracked text files | none (grep exit 1) |
| node / npm / playwright | v26.11.1 / 11.20.0 / Version 1.63.0 |
| NODE_ENV in shell | unset |
| ANTHROPIC_API_KEY set in shell / in .env | no / no (there is no .env file) |

## 2. Baseline on the inherited state, before any change

| Command | Exit | Result |
|---|---|---|
| `NODE_ENV=development npm run typecheck` | 0 | clean (02-typecheck-baseline.log) |
| `env -u ANTHROPIC_API_KEY NODE_ENV=test npm test` | 0 | **12 files, 115 tests passed** (02-test-baseline.log) |
| `NODE_ENV=development npm run build` | 0 | built; only Vite's usual "chunk larger than 500 kB" warning (02-build-baseline.log) |

## 3. Launcher configuration (read-only review)

- package.json line 11: `"demo:offline": "tsx scripts/demo-offline.ts"`. Confirmed.
- scripts/demo-offline.ts:
  - `urlPolicy: { allowOnlyOrigins: vendors.origins }`, where `origins` is exactly the five `http://127.0.0.1:<basePort+i>` vendor origins built in `startDemoVendors`.
  - `forceMode: "deterministic"` and `fixture: { catalog: vendors.catalog }`.
  - Ports: PORT (default 8787) and OMNIPILOT_DEMO_BASE_PORT (default 41001, five consecutive ports). Data dir: OMNIPILOT_DATA_DIR (default ./data-demo). Latency: 2000 ms. Everything binds to 127.0.0.1. This matches docs/FINALE.md.
- In browserManager.open, `validateUrl(rawUrl, policy)` runs before any page or navigation is created. That is why refused URLs fail with no network access.

## 4. Server start

**Deviation:** 8787 and 41001–41005 were already held by PID 5728, a `tsx scripts/demo-offline.ts` started about 20 minutes before my session (probably your own rehearsal; see 04-preexisting-port-holder.txt). I did not touch it. As the brief allows, I used **PORT=8788, OMNIPILOT_DEMO_BASE_PORT=42001**, so all URLs below use 8788 and 42001–42005.

`env -u ANTHROPIC_API_KEY PORT=8788 OMNIPILOT_DEMO_BASE_PORT=42001 OMNIPILOT_DATA_DIR=/tmp/omnipilot-finale-mac-data npm run demo:offline` (npm PID 6242). It printed the OFFLINE DEMO MODE banner and "stop with Ctrl+C" (demo-offline-server.log). `/api/health` (04-health.json) returned `dataSource: "fixture"`, `reasoning.mode: "deterministic"` and **5 fixtureSites**.

## 5. Offline UI E2E (offline-demo-ui.txt, screenshots and artifacts in offline-demo-ui/)

`node tests/e2e/offline-demo-ui.mjs http://127.0.0.1:8788 docs/evidence/finale-mac-2026-10-28/offline-demo-ui`: **exit 0**. Mission `msn_2d1d7c07397d`.

| Check | Result |
|---|---|
| final status | Completed with warnings |
| sources captured | 9/10 planned (+ 2 manual pages) |
| competitors captured / prices found | 5/5 / 3 |
| observations grounded | 38/38 |
| checks passed / failed / warnings | 38 / 0 / 0 |
| artifacts sha256 match | 5/5 |
| take over / public-web browse / resume | Paused / blocked ("Offline demo mode…") / resumed |
| Stop mid-run | cancelled / 0 artifacts, steps cancelled |
| browser console errors | 0 |

These results are identical to the cloud run. docs/screenshots/offline-demo was not overwritten.

## 6. Vendor behaviour and artifact integrity (06-vendor-and-artifacts.txt)

- `42002/`: `301 http://127.0.0.1:42002/platform`. Pass.
- `42004/pricing`: 403. Pass.
- `42003/pricing`: 0 matches for `[$€£][0-9]`. Pass.
- `42005/`: contains "ignore your previous instructions" (1 match). Pass.
- Fixture banner on all 10 pages. Pass.
- CSV: 5 rows, every `data_source` = "OFFLINE DEMO FIXTURE (fictional vendors, not live research)". Pass.
- Quillstone AI: pricing_status "Not found", displayed_prices `''`. Pass.
- Atlas Agents: status "partial" ("1/2 pages captured."), failed source `http://127.0.0.1:42004/pricing` has error "Page returned HTTP 403". Pass.
- evidence.json: Orbit `redirectChain: ["http://127.0.0.1:42002/"]` is present, and `dataSource` is present. Pass.
- Injection text: `grep -ci` gives 0 in all 5 artifacts. Pass.
- research-report.md and verification-report.md each contain the bold Data source line once. Pass.
- Recomputed sha256 of files/ against mission.json artifacts[]: **5/5 match**. Source textFile against textSha256: **10/10 match** (the other 2 sources had no text by design: the blocked example.com browse and the 403).

## 7. Security boundaries

**(a) Exact origin** (07a-exact-origin.txt), POST /api/missions/msn_2d1d7c07397d/browse:

| URL | Result |
|---|---|
| https://example.com/ | 400 "Offline demo mode … (https://example.com is blocked)" |
| http://127.0.0.1:8788/api/health (the app's own API) | 400 "Offline demo mode …" |
| http://localhost:42001/ (fixture port, wrong host spelling) | 400 "Offline demo mode …" |
| http://127.0.0.1:42999/ | 400 "Offline demo mode …" |
| http://127.0.0.1:42001/pricing (fixture) | 200, "Opened … Lumina Assist pricing" |

Note: the successful browse added one manual source to that completed mission in the temp data dir. This happened after the artifact hashes were checked.

**(b) Redirect hops:** `env -u ANTHROPIC_API_KEY NODE_ENV=test npx vitest run tests/redirectGuard.test.ts`: exit 0, **15/15 passed** (07b-redirectGuard.log).

**(c) App API isolation. The inherited gap was reproduced on this Mac** (07c-isolation-before-fix.txt):
- `Host: rebind.example:8788` GET /api/missions returned **200** (DNS-rebinding style).
- `Origin: https://evil.example` POST /api/missions returned **201**: a cross-site page could create a mission.

I stopped my server and applied the specified fix, and nothing else (see section 8). The new tests/isolation.test.ts **failed on the inherited code**: 2 failed ("expected 200 to be 403", "expected 201 to be 403") and 1 passed (the redirect/BrowserManager test, which covers already-correct behaviour). See 07c-isolation-test-before-fix.log. After the fix: 3/3 passed (07c-isolation-test-after-fix.log).

My first post-fix typecheck failed. The error was in my own new test, not in app code: `tests/isolation.test.ts(77,56): error TS2345: … '{ origin?: undefined; host: string; }' is not assignable to … 'Record<string, string>'` (kept as 07c-typecheck-after-fix-attempt1-failed.log). I fixed it by typing the header list as `Record<string, string>[]`.

After the fix:

| Command | Exit | Result |
|---|---|---|
| typecheck | 0 | clean |
| npm test | 0 | **13 files, 118 tests passed** |
| build | 0 | built (same chunk-size warning) |
| `git diff --check` | 0 | |

Restarted server (npm PID 7054, same ports and data dir). Health still reported fixture / deterministic / 5 sites. Curls (07c-isolation-after-fix.txt):
- rebind Host: **403** `forbidden_host`
- cross-site POST: **403** `forbidden_origin`
- normal GET /api/missions: 200

E2E after the fix (offline-demo-ui-after-fix.txt): **exit 0**, mission `msn_dce454023f6a`, identical table (Completed with warnings, 9/10, 5/5, prices 3, 38/38 grounded, 38/0/0, sha256 5/5, Stop gives cancelled / 0, 0 console errors).

The Vite dev proxy (vite.config.ts, `changeOrigin: false`) forwards `Host: localhost:5173` and `Origin: http://localhost:5173`. Both are loopback, so `npm run dev` keeps working; a test covers the 5173 origin.

## 8. Inherited vs new changes

**Inherited (patch, unchanged by me):** the 26 modified tracked files plus the untracked docs/FINALE.md, docs/screenshots/offline-demo/, scripts/demo-offline.ts, server/demo/fixtureVendors.ts, tests/e2e/offline-demo-ui.mjs and tests/offlineDemo.test.ts.

**New (mine):**
1. `server/app.ts`: the `LOOPBACK_HOST` regex and `isLoopbackOrigin()` above `const MIME`, plus a Host/Origin middleware right after `app.disable("x-powered-by")`. The tracked diff stat goes from 231 to 255 insertions. app.ts was already modified by the patch, so it shows as a single ` M`. `git apply -R --check` of the patch still passes, because my lines don't overlap its hunks.
2. `tests/isolation.test.ts` (new, untracked): 3 tests.
3. `docs/evidence/finale-mac-2026-10-28/` (new): all logs, screenshots, artifacts and this report.

Final `git status --short`: the same 26 ` M` files; `??` docs/FINALE.md, docs/evidence/adal/phaseB/ (pre-existing), docs/evidence/finale-mac-2026-10-28/, docs/screenshots/offline-demo/, omnipilot-finale-changes.patch (pre-existing), scripts/demo-offline.ts, server/demo/, tests/e2e/offline-demo-ui.mjs, tests/isolation.test.ts, tests/offlineDemo.test.ts.

`git diff --stat -- docs/evidence/adal`: empty. `git status --short -- docs/evidence/adal` shows only `?? docs/evidence/adal/phaseB/`, which was already untracked when my session started. I did not touch it.

Shutdown: I sent SIGTERM only to my own processes (6242/6260/6261, then 7054/7072/7073). Both logs end with "SIGTERM received, shutting down". Ports 8788 and 42001–42005 are free. **8787 and 41001–41005 are still held by the pre-existing PID 5728, which I did not start and left running.**

## 9. Remaining risks

- **Your already-running demo (PID 5728 on 8787) still runs the pre-fix code.** Ctrl+C it and start it again to pick up the isolation fix. tsx runs the server source, so the server needs no rebuild, but run the build once anyway per the rehearsal steps.
- The fix is uncommitted, like the rest of the patch. Commit or keep it deliberately before the finale.
- `Host`/`Origin` checks guard the API against browsers. Any local process can still call it, which is expected for a loopback-only tool.
- If you open the UI through a non-loopback hostname (for example a LAN IP or a `.local` name), it now gets 403. Use http://127.0.0.1:8787 or http://localhost:8787 on stage.
- E2E timings depend on the 2000 ms fixture latency; on this Mac each run took about 1 minute.
- The Vite build warns that a chunk is over 500 kB. This is cosmetic and was already present at baseline.

## 10. Rehearsal steps for this Mac

1. Stop the old instance first (the one on 8787, PID 5728): Ctrl+C in its terminal.
2. `cd /Users/rajatsanger/Developer/OmniPilot && NODE_ENV=development npm run build`
3. `env -u ANTHROPIC_API_KEY npm run demo:offline` and wait for "stop with Ctrl+C".
4. Open http://127.0.0.1:8787 and check for the amber "OFFLINE DEMO MODE" strip.
5. Optional 1-minute pre-check in a second terminal: `env -u ANTHROPIC_API_KEY node tests/e2e/offline-demo-ui.mjs http://127.0.0.1:8787 /tmp/rehearsal`
6. Follow "## 3. Timed demo (5 minutes)" in docs/FINALE.md.
7. Ctrl+C to stop. Demo data stays in ./data-demo.
