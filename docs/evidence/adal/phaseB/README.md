# Phase B evidence: deterministic Signature mission on 10 approved vendor URLs

**Uncommitted draft for review.** Mission `msn_08ec6071164c`, run 2026-10-25 (local time) from commit `8fceb93`. Started with `env -u ANTHROPIC_API_KEY OMNIPILOT_DATA_DIR=/tmp/omnipilot-phaseB-data npm start`; reasoning mode deterministic (no model, no API key, no usage charge). Raw output stays in `/tmp/omnipilot-phaseB-data/missions/msn_08ec6071164c/`.

| File | What it is |
|---|---|
| `competitor-analysis.csv`, `research-report.md`, `landing-page-concept.html`, `evidence.json`, `verification-report.md` | The mission's artifacts, copied byte for byte |
| `sources/*.txt` | Stored visible-text capture of each of the 10 pages (SHA-256 recorded in `evidence.json`) |
| `screens/*.jpg`, `screens/landing-page-concept-render.png` | Screenshot of each captured page; offline render of the landing page |
| `validation_readback.txt` | Output of an independent validation script (hashes, excerpt grounding, price traceability, CSV parse) |
| `safety_watcher.log.txt` | Live safety-monitor log (verbatim transcription, labelled) |

Review notes before committing:
* The `sources/` and `screens/` files are copies of third-party public web pages. Decide whether the repository should carry them; `evidence.json` and the hashes are enough to describe them if not.
* Screenshots of the Gemini subscriptions page show the visitor's country (India) as served to this machine; no emails, tokens, IP addresses or home paths were found by a text scan of all files, and the 10 page screenshots were each viewed and show no personal data (the landing-page render is generated output and was not separately viewed). The Microsoft pages show a generic "ME" account button of a signed-out browser.
* `docs/ADAL.md` and `docs/VALIDATION.md` have not been updated for Phase B.
