# Final product validation — 2026-10-24

Validated from commit `9c6a150` (the saved bundle) in the cloud build container: Node 22.22, Playwright 1.63 Chromium, **no `ANTHROPIC_API_KEY`**, egress proxy that only reaches a few public hosts (claude.com, microsoft.com and github.com were reachable; chatgpt.com, gemini.google, mistral.ai, perplexity.ai, notion.com, cursor.com, jasper.ai were not).

Status key: **Verified** = executed here and passed. **Partial** = works with a stated gap. **Unverified** = implemented, not executed. **Not met** = missing.

## Mandatory track requirements

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | AI-native desktop browser or browser-integrated workspace | **Partial** | Browser-integrated web workspace driving real Chromium. No Electron shell. Without an API key the product runs no AI reasoning at all (deterministic mode, labelled as such). |
| 2 | Natural-language multi-step task execution | **Verified (deterministic)** / **Unverified (Claude)** | Signature instruction → 12-step plan with dependency stages → executed. Claude planning path never called live. |
| 3 | Real browser / authorized application interaction | **Verified** | Live captures of claude.com, anthropic.com, microsoft.com, github.com pages; screenshots and hashed text captures on disk. |
| 4 | Outcome verification | **Verified** | 36/36 checks on the live signature mission: read-back hashes, parsers, columns/sections, zero-price guard, citation resolution, excerpt re-grounding (39/39), offline render, visual checks. 11 tamper tests in `tests/verifier.test.ts`. |
| 5 | Transparent progress, actions, results, errors | **Verified** | SSE snapshots, live activity log, per-step status/timing, per-source errors with recovery suggestions; UI e2e run with zero console errors. |
| 6a | User approval | **Verified** | Plan approval gate (live: 409 on double approve, resume before approval). Consequential-step gate verified in tests only; no current plan or UI action produces a consequential step. |
| 6b | Cancellation | **Verified** | Live: cancel mid-run → `cancelled`, all steps cancelled, 0 artifacts written, stays cancelled. |
| 6c | Manual takeover | **Partial** | Live: Take over → paused; manual navigation to claude.com via address bar succeeded; resume continued. Clicking inside the page needs headed mode (`OMNIPILOT_HEADED=1`), not testable in this headless container. |
| 7 | End-to-end workflow combining multiple tools | **Verified** | browser.open → browser.extract → browser.screenshot → analysis.compare → artifact.write ×4 → verifier.check → report.finalize. |
| 8 | Active use of AdaL by Sylph | **Not met** | AdaL is not installed in this environment. No AdaL usage has occurred. |
| 9 | Genuine evidence of AdaL usage | **Not met** | `docs/ADAL.md` is an empty template. No evidence is claimed. |

## Signature mission

| Item | Status | Evidence |
|---|---|---|
| Visible structured plan with dependencies | Verified | Plan review UI, `docs/screenshots/02-plan-review.png` |
| Navigate real public websites with Playwright | Verified (2 of 5 vendors) | 4/10 pages captured; 6 blocked by this environment's network policy, each reported as a failed source |
| Extract content and record source URLs | Verified | `evidence.json`: URL, title, capture time, excerpt per observation |
| Separate observations, inferences, unknowns | Verified | 39 observations, 17 inferences (needs review), unknown rows for 3 inaccessible vendors |
| Real downloadable artifacts | Verified | CSV, report, landing page, evidence JSON, verification report |
| Independently inspect artifacts | Verified | 36/36 checks |
| Display verification results and unresolved failures | Verified | Verification tab, agent panel errors, report "Unknowns and failed sources" |
| Final report with evidence links and summary | Verified | `research-report.md` S-citations, `verification-report.md` computed counts |
| Five competitors fully researched | **Unverified** | Needs an unrestricted network; here the mission ends `completed_with_warnings` with 2/5 |

## Fixed during validation
1. **Signature mission picked the wrong competitors (critical).** The deterministic seed-list selector read the instruction verbs "Research…" and "write a report" as product topics and chose Perplexity, Notion AI, Jasper, Grammarly and ChatGPT. Topic words now count only when they describe the products ("coding assistants"); otherwise general AI assistants are chosen (ChatGPT, Claude, Gemini, Microsoft Copilot, Mistral Le Chat). Regression tests added.
2. Inaccessible competitors showed headline "Not found" in the CSV, implying the page was read; now "Unknown".

## Multimodal capability added
**Visual verification from screenshots (measurement, not image understanding).** The verifier now:
* computes pixel statistics of every source screenshot and the landing-page render (luminance spread and share of non-background pixels) and fails or warns on blank captures;
* checks that the landing page headline and call to action are visible above the fold in a 1280×900 viewport;
* computes WCAG contrast ratios for headline, body and CTA text from the rendered page;
* requires a screenshot for every captured page, linked to the step that took it.

Live result on the signature mission: render σ=34.6, 26.7% non-background pixels, hero and CTA above the fold, contrast 15.71 / 7.3 / 4.04:1, 4/4 source screenshots non-blank. Five new tests in `tests/visual.test.ts` / `tests/verifier.test.ts`. Claude vision over screenshots is the natural next step but needs an API key.

## Test results (executed)
* `npm test`: **10 files, 91 tests passed.**
* `npm run typecheck`: passed. `npm run build`: passed.
* `npm run mission` (signature): `completed_with_warnings`, 4/10 sources, 2/5 competitors, 36/36 checks.
* Named-competitor mission (Claude, Microsoft Copilot, GitHub Copilot): `completed`, 6/6 sources, 55/55 observations grounded.
* `node tests/e2e/live-controls.mjs`: all 17 control-path expectations met (404/400/409/422 errors, approval, takeover, manual browse, SSRF blocks, cancel, path traversal).
* `npm run e2e:ui`: mission completed through the UI, 0 console errors.
* Claude mode: **not run** (no API key).
