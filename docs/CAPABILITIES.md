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
* 91 automated tests, a Playwright UI end-to-end script and a live control-path script (`tests/e2e/live-controls.mjs`).

## Implemented but not yet exercised end to end
* **Claude mode.** The planner and synthesis code paths, schema conversion and error handling are implemented and unit-tested for missing credentials and schema handling, but no live Claude API call has been made from this build because no API key was available. Treat Claude mode as unverified until it has been run with a real key.

## Not implemented
* Electron desktop packaging (the workspace runs in a browser tab; Chromium can run as a visible window with `OMNIPILOT_HEADED=1`).
* Interactive in-UI remote control of the headless browser (manual takeover in headless mode is via the address bar; clicking in the page needs headed mode).
* Image understanding of screenshots. Visual checks measure pixels and rendered layout; no model interprets image content.
* Authenticated sites, form submission, publishing or messaging integrations.
* Multi-user access control. The server is a local single-user app bound to 127.0.0.1.

## Known limitations
* Price extraction is pattern-based. It finds currency amounts on the captured pages and quotes the line; it cannot tell which plan a price belongs to, and annual vs monthly framing must be read from the excerpt.
* Deterministic audience and gap inferences come from keyword counts and are weak evidence; they are labelled low-confidence and "needs review".
* Some vendors block automated browsers or render content only after interaction; such pages may be captured with little text or fail. Failures are reported per source.
* Pages whose CSS is served from a blocked host render unstyled in screenshots (seen with GitHub inside the restricted build container).
* The seed list of products and URLs can go stale; stale URLs show up as failed sources and can be edited in the plan.
* Verification proves integrity and traceability, not that vendor claims are true or current.
