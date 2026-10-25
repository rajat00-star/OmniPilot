# AdaL by Sylph: development and testing evidence

**Status: Partial.** One genuine AdaL session is documented below. It covers repository audit, local validation, root-cause diagnosis, a security fix with regression tests, and Browser Use testing of the real UI against a local fixture site. It does **not** include a session export or recording, any Claude/API run, or more than one session. Those gaps are listed at the bottom.

## Session

| Field | Value |
|---|---|
| Tool | AdaL (agent session) |
| Session ID | `b4f50c11-9603-4ce6-8283-7a3024ce6a8d` (from the session context) |
| Date | 2026-10-24 (session turns 0 to 2) |
| Machine | macOS (Darwin 27.2.0), arm64 |
| Runtime | Node v26.11.1, npm 11.20.0, Playwright 1.63.0 (Chromium headless shell build 1243) |
| Shell environment | `NODE_ENV=production` was set in the shell (this made the first `npm ci` skip devDependencies; see below); an `ANTHROPIC_API_KEY` variable existed in the shell but was never read, printed or used |
| Base commit | `4955585` on `main`, clean working tree at the start |
| Resulting commit | `f763ccd` (fix, tests, docs, diagnostics). A follow-up commit adds the `*.log` evidence files (ignored by `.gitignore`, so they were force-added) and records this hash. |

Evidence index with provenance for every file: [`docs/evidence/adal/README.md`](evidence/adal/README.md).

## What AdaL did

1. **Read-only audit** (turn 0). Read the README, `package.json`, docs and tests; reported the architecture, open requirements and which checks were safe. No files changed.
2. **Local validation** (turn 1). Ran `npm ci`, `npx playwright install chromium`, typecheck, build and tests.
   * The first `npm ci` omitted devDependencies because the shell has `NODE_ENV=production`; `tsc` and `vite` were then "not found". Fixed for the commands only, with `NODE_ENV=development npm ci --include=dev`. No config files were changed.
   * `npm test` result before any code change: **90 of 91 passed**, one failure in `tests/engine.test.ts` ("reports extraction failures and blocked redirects honestly and degrades the mission"). Log: [`full_suite.BEFORE_fix.log`](evidence/adal/full_suite.BEFORE_fix.log).
3. **Root-cause diagnosis** (turn 2), without contacting any outside host: a Chromium context was set offline, DNS was mocked, and the "public origin" was served with `route.fulfill`.
   * Probe against the unmodified code ([`diag_redirect_hop_probe.BEFORE_fix.output.txt`](evidence/adal/diag_redirect_hop_probe.BEFORE_fix.output.txt)): Chromium requested the redirect target `http://10.20.30.40/admin` and **no route handler ran for that hop**, neither the probe's nor OmniPilot's own. It only failed because the context was offline.
   * Root cause: `BrowserManager` relied on `context.route()` to block unsafe URLs, but Playwright 1.63 does not invoke route handlers for redirect hops. The only check on a redirect was `validateRedirectChain`, which runs **after** navigation. So the browser connected to the redirect target first. In the original failing test the connection to `10.20.30.40` most likely went unanswered until the 6 s navigation timeout, which would explain why the error was `timeout` instead of `blocked` (inferred from the offline probe and the timing; the live connection itself was not observed). For a reachable private address the same gap would let a request reach it before the check; that second consequence is inferred from the mechanism and was deliberately not demonstrated against a real address.
   * A stand-alone experiment ([`diag_cdp_fetch_interception.output.txt`](evidence/adal/diag_cdp_fetch_interception.output.txt)) showed that Chromium's CDP `Fetch.requestPaused` does fire for the redirect hop and can fail it before any connection.
4. **Fix** ([`redirect-guard-source.patch`](evidence/adal/redirect-guard-source.patch)). `server/browser/browserManager.ts` gains `guardRedirects(page)`, called from `open()` right after the page is created. It attaches a CDP Fetch interceptor. For requests that are redirect hops it applies the existing policy (`validateUrl` for documents, `checkUrlStructure` otherwise) and fails blocked hops with `BlockedByClient` before any connection; everything else passes through unchanged. No existing check was removed or loosened, and the post-navigation `validateRedirectChain` remains as a second layer.
5. **Regression tests** (`tests/redirectGuard.test.ts`, 15 tests). Offline and mocked: redirects to private 10/172/192 ranges, cloud metadata, IPv4/IPv6 loopback, IPv4-mapped IPv6, decimal-encoded IP, internal hostname, `localhost`, embedded credentials, `file:` and `javascript:` schemes, an unparseable `Location`, a three-hop chain ending at a blocked host, and a legitimate two-hop chain that must still work. The multi-hop tests use a loopback server whose final hop is a `*.localhost` name, so nothing outside the machine could be contacted even if the guard failed.

## Browser Use testing of the real UI (fixture-backed, no API key)

Done in the same session, after the commits `f763ccd` and `7887bde`. The app was started with `env -u ANTHROPIC_API_KEY npx tsx tests/e2e/fixture-app.ts 8788`: the real server and UI, reasoning mode forced to `deterministic`, loopback targets allowed (as in the test suite; the shipped `npm start` never allows them), with the test fixture site as the only research target. AdaL drove it through Chrome 155 with the Browser Use tools, one action at a time, checking each result with a screenshot or a server read-back. `/api/health` reported `configured: false`. No external site was opened and no Claude/API call was made. The key variable that exists in the shell was never read.

Everything below was observed. Evidence: [`docs/evidence/adal/ui/`](evidence/adal/ui/) (screenshots, `api_readback.txt`, the CSV downloaded through the UI).

| Feature | Result | Evidence |
|---|---|---|
| Composer, rule-based planner (deterministic mode banner) | Works. Plan drafted from three fixture URLs; "nothing has run yet" preview, 7 steps, dependency list. | `01-…`, `02-…` |
| Target editing | Works, with one behaviour to know: an edit is only staged in the browser until **Apply and rebuild plan** is clicked. A rename that was typed but not applied was lost on reload (`03-…`). After Apply, the server held the new name (`Fixture Sites`), the step title was rebuilt (`Research Fixture Sites`), and it survived a reload (`04-…`). | `03-…`, `04-…`, `api_readback.txt` |
| Approve and run | Works. Mission `msn_b361fc2552e6` completed: 7/7 steps, 3/3 pages captured, 12/12 observations grounded, 26/26 checks passed, 4 artifacts. | `05-…`, `api_readback.txt` |
| Results, Evidence and Verification tabs | Render and match the server's numbers (12 observations, 10 inferences, 26 checks). The Browser tab shows the live capture. | `05-…`, `06-…`, `07-…` |
| Artifact read-back | The four artifacts downloaded over HTTP are byte-identical to the files on disk. The CSV downloaded by clicking the artifact link in the browser is byte-identical too. Recorded `textSha256` of all three source captures matches a recomputation. Every observation excerpt was found verbatim in the stored captures. Path traversal on the file endpoint returned 400. | `api_readback.txt`, `competitor-analysis.csv.downloaded-via-ui` |
| Pause and Resume | Works. After Pause the UI showed "Paused" with the takeover banner and the server reported `paused` while the first step was held mid-run. After Resume the mission completed (`msn_799d4aacb544`, 7/7 steps). Screenshot `08-…`. | `08-…`, `api_readback.txt` |
| Stop (cancel) | Works. Mission `msn_b38caaeee47d` was stopped while the 15-second fixture page was loading: UI "Cancelled", all 7 steps `cancelled`, 0 artifacts, no files directory written. | `09-…`, `api_readback.txt` |
| Console | 0 errors, 0 warnings in the browser session (checked once, at the end). | – |

**Not exercised in the UI:** the "Take over" button, "Discard", the consequential-step approval gate (no plan produces one), headed-mode takeover (needs a visible window), the Browser tab live view beyond one screenshot, and the multi-competitor path (the fixture site is a single host, so its three pages grouped into one target and one CSV row).

**Features that need configuration or the outside world, and so were not tested:** Claude planning and synthesis (needs `ANTHROPIC_API_KEY`; the UI states "Deterministic mode … analysis is rule-based, not AI"), research of real public sites (needs outside network access), and the five-competitor signature mission.

**About the earlier "timeout":** no navigation timeout occurred in the UI testing. What did happen: the browser window claimed by the Browser Use session was lost after a long idle gap (the sidebar later read "8h ago"; session timestamps jumped from 16:43Z to 00:40Z). The app (`/api/health` 200) and the shared Chrome (`:9222`) were both still running and unaffected, and re-attaching fixed it. The cause of the lost window handle is not known. It is independent of the app and of the API key. Separately, the first target rename "not persisting" was the unapplied-edit behaviour described above, not a bug.

## Phase A: final-demo validation (fixture-backed, no API key)

Run 2026-10-25 local time from `cf7c4ec` (clean tree). No external site, LAN or metadata address was opened; no Claude/API call was made; the key variable in the shell was removed from the app's environment and never read. Evidence: [`docs/evidence/adal/phaseA/`](evidence/adal/phaseA/).

**Startup (documented):** `npm run build` then `npm start` (http://127.0.0.1:8787). Run here as `NODE_ENV=development npm run build` and `env -u ANTHROPIC_API_KEY OMNIPILOT_DATA_DIR=/tmp/omnipilot-phaseA-data npm start`. The `env -u` is needed on this machine because an API key exists in the shell and, going by `server/config.ts`, the app would otherwise enter Claude mode (inferred from the code; deliberately not tried); the data-dir variable only keeps `./data` clean. The startup banner `reasoning mode: deterministic (ANTHROPIC_API_KEY not set)` was seen in the terminal and is not saved as a file; `/api/health` output in `phaseA/api_readback.txt` (`configured: false`) is the saved confirmation for the fixture app.

**Fixture missions need the launcher.** The shipped app refuses loopback targets by design: a mission containing `http://127.0.0.1:9/acme` failed at planning with "Private, loopback or metadata address 127.0.0.1 is blocked" and nothing was requested (`01b`). So all fixture missions ran through `env -u ANTHROPIC_API_KEY npx tsx tests/e2e/fixture-app.ts 8788` (same server and UI, deterministic mode forced, loopback allowed for the fixture site only).

| Step | Result |
|---|---|
| Mission creation, plan preview | Works. "Plan preview · nothing has run yet". |
| Target editing | Works. "Add target" twice, renamed/filled three targets; "Approve and run" stays disabled while edits are unapplied; after "Apply and rebuild plan" the server held the three targets and the plan was rebuilt to 9 steps (`02`, `03`; the earlier 7-step single-target plan was seen in the previous UI session, not captured in this phase). |
| Approve and run, status | Mission `msn_bb575a736caa` completed: 9/9 steps, 3/3 sources, 3/3 competitors, 2/3 prices (Gamma Labs "Not found", not zero), 12/12 observations grounded, 14 inferences needing review, 26/26 checks passed (`04`, `05`). |
| Artifact generation and read-back | Four artifacts, all verified. HTTP downloads byte-identical to disk; `research-report.md` downloaded by a browser click is byte-identical; source hashes match recomputation; 12/12 excerpts found verbatim in stored captures; parsed CSV has the 3 expected rows; path traversal returns 400 (`phaseA/api_readback.txt`). |
| Take over, manual browse, Resume | Works. Take over paused the mission and showed the banner (`06`). Opening the fixture `/beta` page from the address bar opened a new tab and was recorded as a second source (`07`). Resume completed the mission (`msn_4dd985eb172a`, 7/7 steps, 4 artifacts passed). |
| Stop | Works. `msn_fc0faccd7598`: Cancelled, all 7 steps cancelled, 0 artifacts, no files directory (`08`). |
| Pause button | Not re-tested in this phase. It was verified in the earlier UI session (above). Take over uses the same pause mechanism. |
| Tests | `NODE_ENV=test npm test`: 11 files, 106 passed; `npm run typecheck`: exit 0. No code changed in this phase. |
| Console | 0 errors and 0 warnings on the last page viewed (the check covers only the page loaded since the last navigation). |

**Observations (not defects found, not fixed):** step ids for added targets are `collect-custom-2` / `collect-custom-3`; a page opened by hand during Take over is counted as a captured source; the composer shows a "Ctrl ↵" hint (visible in `01a`); pressing Enter after filling the box did not draft a plan in the earlier UI session (not re-tested in this phase).

**Still not tested:** headed-mode takeover (no visible window), the consequential-step approval gate in the UI, Claude mode, external sites, and the shipped app (`npm start`) running a real research mission.

## Measured results

| Check | Before the fix | After the fix |
|---|---|---|
| `tests/redirectGuard.test.ts` | 12 failed, 3 passed ([log](evidence/adal/redirect_guard_test.BEFORE_fix.log)) | 15 passed ([log](evidence/adal/redirect_guard_test.AFTER_fix.log)) |
| Full `npm test` | 10 files, 91 tests: 90 passed, 1 failed | 11 files, **106 tests passed** ([log](evidence/adal/full_suite.AFTER_fix.log)) |
| `npm run typecheck` | Exit 0 | Exit 0 ([log](evidence/adal/typecheck.AFTER_fix.log)) |
| `npm run build` | Exit 0 | Exit 0 ([log](evidence/adal/build.AFTER_fix.log)) |

Test commands were run with `NODE_ENV=test` and the build/typecheck with `NODE_ENV=development`, because the shell default of `production` omits the dev toolchain.

## Disclosures and limitations

* This is **one** AdaL session. Nothing here shows sustained or repeated use.
* The pre-fix runs of the original engine test (twice, in turn 1, before the offline harness existed) did cause Chromium to attempt a real connection to `10.20.30.40`, a private address. That is how the failure was first noticed. After that point all diagnosis was offline and mocked.
* No session export, recording or screenshots exist. The `BEFORE_fix` probe output is a verbatim transcription, labelled as such.
* Browser Use testing covered only the fixture-backed UI (see above). `npm run e2e:ui`, the live-controls script, live missions against public sites and Claude/API mode were **not** run in this session.
* Browser Use has no recorder and AdaL gave no session-export facility in this session, so the evidence is individual screenshots plus command output. Nine screenshots are kept (one mis-aimed click was not kept). Screenshots were taken at states that mattered, not continuously.
* The UI testing happened on 2026-10-24/25 (the session crossed midnight; the later part ran on 2026-10-25 local time).
* `tests/e2e/fixture-app.ts` was added as the launcher for this testing. It is a test helper only and does not change the product.
* The fix was tested on macOS with Node 26 and Playwright 1.63 only. Behaviour under the restricted proxy in the original cloud build container was not tested; the CDP interceptor sits in the browser, not on the network path, but that is not verified.

## Remaining work to complete the requirement

Requirements 8 and 9 stay **Partial** until there is more genuine evidence, for example: a second session that implements a real item from `docs/CAPABILITIES.md`; Browser Use operation against the shipped `npm start` app with a real, approved research run; an exported session record or screen recording; and further commits authored with AdaL.

## Evidence log

| Date | What AdaL did | Evidence | Commit |
|---|---|---|---|
| 2026-10-24 | Audit, validation, diagnosis and fix of the redirect-hop SSRF gap; 15 regression tests; docs updated | [`docs/evidence/adal/`](evidence/adal/README.md) | `f763ccd`, `7887bde` |
| 2026-10-24/25 | Browser Use testing of the real UI on a fixture site: plan, target edit, approve, results, artifact read-back, pause/resume, stop | [`docs/evidence/adal/ui/`](evidence/adal/ui/) | `decef72` |
| 2026-10-25 | Phase A: documented startup, 3-competitor fixture mission, Take over/manual browse/Resume, Stop, artifact read-back | [`docs/evidence/adal/phaseA/`](evidence/adal/phaseA/) | `438587f` |
