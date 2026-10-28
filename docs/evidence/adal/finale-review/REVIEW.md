# Finale checklist review: OmniPilot vs `docs/REQUIREMENTS.md`

Date: 2026-10-28 · Reviewer: AdaL, run in this repository (CLI session `fb2294d1-31b7-4a78-bb89-8f52ce99d14a`) · Machine: macOS arm64, Node v26.11.1

**TL;DR.** The checklist is mostly honest. I re-ran typecheck and the test suite myself (146/146 before my change), drove the offline demo through a real Chrome window, and inspected Judge Mode. I found one genuine, reproducible security bug (IPv6 SSRF bypass), fixed it, and added a regression test (158/158 after). The biggest gaps are the same ones the docs already admit: no real Claude call, no audio or video, no demo video. A few claims go slightly beyond the evidence. They are listed in section 4.

Nothing was committed or pushed. No existing file other than `server/security/urlSafety.ts` and `tests/urlSafety.test.ts` was modified. Both already had uncommitted changes from you, and I kept them.

## 0. What I did and what I only recommend

**Done by me in this session (each has a saved log in this folder):**

| Action | Evidence file |
|---|---|
| Read `REQUIREMENTS`, `ARCHITECTURE`, `SECURITY`, `SUBMISSION`, `EVIDENCE_INDEX` | n/a |
| Read `server/security/urlSafety.ts`; grepped planner limits and test coverage | n/a |
| Ran `npm run typecheck` and `npx vitest run` on the tree as I found it | `typecheck.BEFORE.log`, `full_suite.BEFORE.log` (17 files, 146 tests, exit 0) |
| Probed IPv6 literal handling, wrote a failing regression test, saw it fail | `urlSafety_regression.BEFORE_fix.log` (11 failed, 27 passed) |
| Fixed `urlSafety.ts` | `urlSafety_fix.patch.txt` |
| Re-ran the test file, typecheck and the full suite | `urlSafety_regression.AFTER_fix.log` (38/38), `typecheck.AFTER_fix.log`, `full_suite.AFTER_fix.log` (17 files, 158 tests) |
| `npm run build` | `build.log` (exit 0) |
| Started `npm run demo:offline` on a throwaway data dir (`/tmp/omnipilot-review-data`) and drove it with AdaL's browser tools in a real Chrome 155 window, one action at a time | `screens/01…05` |
| Ran the repo's own scripted UI rehearsal `tests/e2e/offline-demo-ui.mjs` against that server | `offline_rehearsal_script.log` (exit 0) |
| Cross-checked the live-mission claims in `mission.json` | section 3 |

**Not done (recommendations only):** no live-web run, no Claude call (no key is configured and I did not look for one), no headed-browser takeover test, no edits to the other docs, and no commit or push. The patch file `urlSafety_fix.patch.txt` is `git diff` of the whole file, so it also contains your earlier uncommitted `allowOnlyOrigins` change.

## 1. Status of each requirement

My classification uses the four labels you asked for. Where it differs from the team's label, the right-hand column says so.

| # | Requirement | My status | Team's label | Basis |
|---|---|---|---|---|
| 1 | Natural-language multi-step task | **Partially verified** | Verified (rule-based) | Instruction becomes a validated 12-step plan and runs (I watched it). But "natural language" is handled by a rule-based parser, and Claude planning has only been run against a stand-in API. Fine for a deterministic demo, thin for an "AI-native" claim. |
| 2 | Real browser / tool execution | **Verified** | Verified | I saw real Chromium capture 9 of 10 fixture pages (the tenth is the planted 403). The live-web run is recorded in `mission.json` (6/6 sources 200, `fathom.video` → `www.fathom.ai`). I did not re-run live. |
| 3 | Outcome verification | **Verified** | Verified | 38/38 checks, 5/5 artifacts re-downloaded with matching SHA-256 (rehearsal log). Limits are stated in the UI. |
| 4 | Transparent progress and errors | **Verified** | Verified | Live step list, "Completed with warnings", the 403 shown as a failed source. 0 console errors in my browser session and in the rehearsal. |
| 5 | Approval, stop, takeover | **Partially verified** | Verified / not fully verified | Approval gate, Pause/Take over → Resume, and Stop → `cancelled` with 0 artifacts all worked. Takeover is pause-only. The UI says so in headless mode. In-page clicking is untested, as the team states. |
| 6 | Capability orchestration | **Verified** | Verified | Allowlisted tool registry with no shell or eval, 10 tools. It is a fixed graph, not model-chosen tools, as the docs say. |
| 7 | Multimodal (image / audio / video) | **Partially verified** (image, stand-in only) / **Incomplete** (audio, video) | same | No real image-model call has ever been made. |
| 8 | Coding / debugging / testing | **Partially verified** | Verified (browser testing) / Incomplete | The product tests its own generated HTML. It does not code or debug for the user. |
| 9 | Market research and GTM | **Verified** (rule-based) | Verified | Five artifacts, plus a landing-page concept labelled "no AI, not market-validated". |
| 10 | Security and safe failure | **Partially verified** | Verified | Strong coverage, but I found a real SSRF gap (section 2), now fixed. Some limits have no tests (section 3). |
| 11 | Working prototype / video | **Verified** prototype · **Blocked** video | same | I ran the prototype. No recording exists. |
| 12 | Source code and setup | **Blocked** (publishing) | Verified / Blocked | Everything is uncommitted and the repo has no remote. I did not follow the README from scratch on a clean machine. |
| 13 | Architecture overview | **Verified** | Verified | The document matches the code layout I read. |
| 14 | Success and failure test cases | **Verified** | Verified | 158 tests pass. Failure cases (403, missing price, blocked redirect, Stop) are exercised. |
| 15 | Users, value, future | **Verified** (document only) | Verified | The document does not claim measured outcomes. |
| 16 | Genuine AdaL workflow evidence | **Partially verified** | Incomplete | Earlier session `b4f50c11` is in `docs/ADAL.md`. This folder adds a second one. I cannot attest to the earlier session from here. |

## 2. The genuine bug I found and fixed

**Issue.** `isPrivateIp()` in `server/security/urlSafety.ts` accepted IPv6 literals that embed a private IPv4 address, except for the IPv4-mapped form. The URL parser rewrites `[64:ff9b::127.0.0.1]` to `[64:ff9b::7f00:1]`. The old code matched NAT64 only with a dotted-quad regex, so that branch could never fire for a parsed URL.

**Reproduced (before the fix):** these all passed `checkUrlStructure` with no error:

- `http://[64:ff9b::a9fe:a9fe]/`, which is NAT64 to the cloud-metadata address 169.254.169.254.
- `http://[64:ff9b::127.0.0.1]/`, NAT64 to loopback.
- `http://[::127.0.0.1]/` and `http://[::a9fe:a9fe]/`, IPv4-compatible.
- `http://[2002:7f00:1::]/`, `http://[2002:a9fe:a9fe::1]/`, 6to4.
- `http://[::ffff:0:127.0.0.1]/`, SIIT.

The same hole applied to AAAA records returned by DNS. The docs' SSRF row says "IPv4-mapped IPv6" and "every address must be public", which is true for the mapped form only.

**Real-world reach.** Exploitation needs a network that translates these prefixes (for example NAT64/DNS64 or 6to4 gateways). Many home networks do not. It is a defence-in-depth gap rather than a proven exploit, and I did not attempt to reach an internal service.

**Fix.** The fix replaces the dotted-quad regex with a small IPv6 parser plus an `embeddedIpv4()` helper. It covers:

- `::ffff:0:0/96` (mapped)
- `::ffff:0:0:0/96` (SIIT)
- `64:ff9b::/96` (NAT64)
- `2002::/16` (6to4)
- `::/96` (IPv4-compatible)

The embedded address goes back through the normal IPv4 rules. `64:ff9b:1::/48` (local-use NAT64) is blocked outright. Global IPv6 and translated addresses with a public IPv4 stay allowed. I did not block Teredo (`2001::/32`), because blocking it would be overblocking, but it is not checked either.

**Regression tests** (`tests/urlSafety.test.ts`, +12 cases): 10 blocked literals, one test that public-embedded and ordinary global IPv6 still pass, and one test for DNS-returned addresses.

**Result:** the new tests failed 11 times before the fix. After it, `urlSafety.test.ts` is 38/38, the full suite is 158/158 (from 146), and typecheck exits 0.

## 3. Independent inspection by area

| Area | What I checked | Finding |
|---|---|---|
| Natural-language execution | Clicked the "Signature mission" suggestion, "Draft plan", read the plan | A 12-step plan appeared with the state "Awaiting approval · nothing has run yet". Labelled "Rule-based planner". |
| Live browser research | Inspected `mission.json` of `msn_e8b87606bacb`; the live run itself was not repeated | 6 sources, all HTTP 200. `fathom.video` redirected to `www.fathom.ai`. 28 checks, all passed. 78 observations = 54 `observation` + 24 `inference`, so the "54/54 grounded" claim refers to the 54 observations, not all 78. That is consistent but easy to misread. |
| Verification | Verification tab and Judge Mode in my browser | 38 checks, 0 failed, 5/5 artifacts read back. The disclaimer that this proves integrity and not truth is shown. |
| Approval / stop / takeover | Approved, clicked Take over (status Paused), Resume, run completed. Script also ran Stop. | Works. The pause message says "Headless mode: there is no visible window to click in", which is accurate. |
| Security | Read `urlSafety.ts`, ran the suites, probed it | One real gap (fixed). The offline mode blocked `https://example.com` during manual browsing (rehearsal log). |
| Multimodal | Read docs and test list | Stand-in only. I did not run the paid vision path. |
| GTM workflow | Judge Mode and artifact list | Five artifacts (CSV, report, landing page, evidence JSON, verification report), fixture data labelled as such. |

**Judge Mode (inspected in the browser):** read-only (0 input fields, "Exit judge mode" only), offline-fixture and "no AI" badges, three cited price findings, an Atlas row "Not found. Missing, not $0", a 10-row feature matrix marked "Stated", and "34 unresolved review items". Escape returned to the workspace. 0 console errors.

## 4. Highest-risk untested behaviour, and claims that exceed the evidence

**Highest-risk untested behaviour**

1. **A real Claude call has never happened.** Planning, synthesis and vision are all verified against a local fake. If the real API shape or schema differs, the "AI-native" part fails on stage. This is the single biggest risk.
2. **Headed in-page takeover** (untested anywhere). The demo's takeover is pause plus an address bar.
3. **Runaway limits** (max 8 targets, 3 URLs per target, 40 steps, 64 KB body). The SECURITY table lists "—" under Tested in. I found the constants in `planner.ts` but did not find tests for the 8-target or 40-step caps.
4. **DNS rebinding for page subresources** relies on Chromium behaviour that the docs admit may not apply behind a proxy.

**Claims that exceed the evidence**

- **SECURITY:** the SSRF row implied full coverage of embedded-IPv4 IPv6 forms. It was incomplete until this fix. I did not edit that row.
- **REQUIREMENTS #10 "Verified"** for security is stronger than the evidence, given the gap above and the untested limits.
- **REQUIREMENTS #1 "Verified"** rests on a regex-style planner. "Natural language" is only lightly exercised.
- **Test counts in `EVIDENCE_INDEX.md`** (146 tests) are now out of date. With my change it is 158.
- **"54/54 observations grounded"** reads like all observations, but the mission has 78 records. 24 are inferences.
- **#12 setup instructions "Verified"**: I read them but did not follow them on a clean machine.

## 5. Recommendations (not done)

1. Make one real, approved Claude call and save the log. It moves #1, #7 and the Claude parts of #9 forward.
2. Add tests for the 8-target, 3-URL and 40-step limits.
3. Update `SECURITY.md` to mention the NAT64, 6to4 and IPv4-compatible coverage. Update the test counts in `EVIDENCE_INDEX.md`.
4. Record the demo video and commit and push (items 11 and 12).
5. Consider rewording #10 to "Verified with known residual risks".
6. Candidate next AdaL tasks from `SUBMISSION.md`: label Fathom by its final host, and split the large JS chunk.

## 6. Files in this folder

`REVIEW.md` (this file) · `screens/01-offline-home.jpg`, `02-plan-awaiting-approval.jpg`, `03-take-over-paused.jpg`, `04-completed-verification.jpg`, `05-judge-mode-full.jpg` (real captures from the browser session) · the logs listed in section 0.

The AdaL session transcript is in `~/.adal/sessions/fb2294d1-31b7-4a78-bb89-8f52ce99d14a/` and has not been copied here. It should be reviewed for secrets before being added.
