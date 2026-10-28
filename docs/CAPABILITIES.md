# Capabilities and limitations

## Implemented and tested
* Natural-language mission → validated plan with dependency stages, editable targets, explicit approval.
* Real Chromium automation via Playwright: navigation, redirect capture, visible text, metadata, headings, screenshots, cleanup, cancellation of in-flight navigation.
* Extraction of official descriptions, headlines, vendor claims, displayed prices, free tiers and audience signals, each with source URL, title, capture time, excerpt and class.
* Rule-based analysis (deterministic mode) and Claude evidence-cited synthesis (when a key is configured), with uncited model claims discarded.
* Artifacts: competitor CSV, Markdown research report, HTML landing-page concept, JSON evidence ledger, verification report.
* Independent verification: read-back hashes, parsers, required columns/sections, malformed and empty records, zero-price placeholders, citation resolution, offline render, excerpt re-grounding.
* Live SSE event stream, pause, take over, resume, stop, consequential-action approval.
* URL, redirect and path security controls; untrusted-content handling.
* Visual verification from screenshots: pixel statistics flag blank captures, the landing-page render is checked for headline and CTA above the fold and WCAG text contrast, and every captured page must have a screenshot linked to its step.
* 146 automated tests (17 files), a Playwright UI end-to-end script, a live control-path script (`tests/e2e/live-controls.mjs`) and an offline-demo UI rehearsal (`tests/e2e/offline-demo-ui.mjs`).
* Offline demo mode (`npm run demo:offline`): five fictional vendor sites served locally, an exact-origin allowlist, and a data-source label in every artifact that the verifier checks.
* Judge Mode: a read-only dashboard of a finished mission, with quoted findings, competitor cards, a feature matrix, pricing states, verification facts and evidence on demand.
* Live web research: a real three-vendor mission (Otter.ai, Fireflies.ai, Fathom) captured 6/6 public pages on 2026-10-28.

## Implemented but not yet exercised end to end
* **Claude synthesis and screenshot reading.** Both are tested end to end against a local stand-in for the Claude API (`tests/claudeMode.test.ts`, `tests/vision.test.ts`): request shape, schema validation, deadlines, fallback, grounding and cost logging. No real Claude API call has been made from this project yet: the 2026-10-28 Claude test (`docs/evidence/claude-test-2026-10-28/REPORT.md`) stopped before the call each time because the configured key was not a standard API key. Synthesis and screenshot reading count as verified only once they have run against the real API; see `docs/REQUIREMENTS.md`.

## Not implemented
* Electron desktop packaging (the workspace runs in a browser tab; Chromium can run as a visible window with `OMNIPILOT_HEADED=1`).
* Interactive in-UI remote control of the headless browser (manual takeover in headless mode is via the address bar; clicking in the page needs headed mode).
* Image understanding beyond pricing screenshots. Claude reads pricing screenshots on request; other pages and images are not interpreted. Visual checks elsewhere measure pixels and rendered layout.
* Audio and video understanding.
* Authenticated sites, form submission, publishing or messaging integrations.
* Multi-user access control. The server is a local single-user app bound to 127.0.0.1.

## Known limitations
* Price extraction is pattern-based. It finds currency amounts on the captured pages and quotes the line; it cannot tell which plan a price belongs to (screenshot reading can, as a reviewed inference), and annual vs monthly framing must be read from the excerpt.
* Deterministic audience and gap inferences come from keyword counts and are weak evidence; they are labelled low-confidence and "needs review".
* Some vendors block automated browsers or render content only after interaction; such pages may be captured with little text or fail. Failures are reported per source.
* Pages whose CSS is served from a blocked host render unstyled in screenshots (seen with GitHub inside the restricted build container).
* The seed list of products and URLs can go stale; stale URLs show up as failed sources and can be edited in the plan.
* Verification proves integrity and traceability, not that vendor claims are true or current.
