# Verification report — mission msn_08ec6071164c

Generated 2026-10-25T04:41:00.289Z. All figures are computed from execution records, not from model output.

## Summary

- 10 of 10 sources captured (0 failed).
- 5 of 5 competitors had at least one page captured.
- 5 product descriptions found.
- 3 competitors with publicly displayed prices; 2 unavailable.
- 76 of 76 observations re-grounded verbatim in stored captures (0 ungrounded).
- 35 inferred claims require human review.
- 36 checks passed, 0 failed, 0 warnings across 4 artifacts.

> Artifact checks prove the files are well-formed, complete and traceable to captured pages. They do not prove the vendors' claims are true or current.

## Checks

| Status | Scope | Artifact | Check | Detail |
|---|---|---|---|---|
| PASSED | integrity | competitor-analysis.csv | File exists | msn_08ec6071164c/files/competitor-analysis.csv |
| PASSED | integrity | competitor-analysis.csv | Read back matches written bytes | 6,152 bytes, sha256 7f17a359804e… |
| PASSED | integrity | competitor-analysis.csv | Parses as CSV | 5 data rows |
| PASSED | integrity | competitor-analysis.csv | Required columns present | 16 required columns |
| PASSED | coverage | competitor-analysis.csv | One row per competitor | 5 rows for 5 enabled targets |
| PASSED | integrity | competitor-analysis.csv | No empty required cells | All required cells populated (Unknown/Not found used explicitly) |
| PASSED | integrity | competitor-analysis.csv | Valid pricing status values | All in {Found, Not found, Source inaccessible} |
| PASSED | integrity | competitor-analysis.csv | Missing prices not shown as zero | No zero placeholders for missing prices |
| PASSED | integrity | competitor-analysis.csv | Pricing status consistent with values | Found ⇔ prices listed |
| PASSED | coverage | competitor-analysis.csv | Description sources are captured pages | Every description URL is in the capture log |
| PASSED | coverage | competitor-analysis.csv | Evidence ids resolve | All evidence ids exist in the ledger |
| PASSED | integrity | research-report.md | File exists | msn_08ec6071164c/files/research-report.md |
| PASSED | integrity | research-report.md | Read back matches written bytes | 11,692 bytes, sha256 36ee927e6746… |
| PASSED | integrity | research-report.md | Required sections present | 7 sections found |
| PASSED | coverage | research-report.md | Every captured source cited | 10 sources cited in Evidence index |
| PASSED | coverage | research-report.md | Every competitor has a profile | 5 profiles |
| PASSED | integrity | research-report.md | Observed / inferred / unknown labelling | Label legend present |
| PASSED | coverage | research-report.md | Inline citations resolve | 71 inline citations |
| PASSED | integrity | landing-page-concept.html | File exists | msn_08ec6071164c/files/landing-page-concept.html |
| PASSED | integrity | landing-page-concept.html | Read back matches written bytes | 5,530 bytes, sha256 1bad8247ae51… |
| PASSED | integrity | landing-page-concept.html | HTML structure | title=yes, h1=yes, sections=3 |
| PASSED | integrity | landing-page-concept.html | Concept disclaimer present | Banner states it is an unvalidated concept |
| PASSED | coverage | landing-page-concept.html | Evidence attributes resolve | 22 evidence references |
| PASSED | integrity | landing-page-concept.html | No scripts in generated page | 0 script tags |
| PASSED | render | landing-page-concept.html | Renders in browser | Rendered offline in Chromium, 1512 chars visible, screenshot saved |
| PASSED | render | landing-page-concept.html | Screenshot is not blank | 1280×900px, luminance σ=37.1, 34.0% non-background pixels |
| PASSED | render | landing-page-concept.html | Headline and call to action above the fold | viewport 1280×900: headline visible, CTA visible |
| PASSED | render | landing-page-concept.html | Text contrast meets WCAG AA | headline 15.71:1 (≥3), body 7.3:1 (≥4.5), CTA 4.04:1 (≥3) |
| PASSED | integrity | evidence.json | File exists | msn_08ec6071164c/files/evidence.json |
| PASSED | integrity | evidence.json | Read back matches written bytes | 68,383 bytes, sha256 cc46ad07353f… |
| PASSED | integrity | evidence.json | Parses as JSON | Valid JSON |
| PASSED | integrity | evidence.json | Ledger shape | 10 sources, 113 observations |
| PASSED | coverage | evidence.json | Observations link to sources | Every observation links to a captured source |
| PASSED | grounding | — | Stored captures intact | 10 capture files hash-verified |
| PASSED | grounding | — | Observations grounded in captures | 76 grounded, 0 ungrounded |
| PASSED | render | — | Screenshot evidence for every captured page | 10 screenshots present, 10 pixel-checked non-blank, each linked to its capture step |

## Steps

- **succeeded** — Research ChatGPT: 2/2 pages captured for ChatGPT
- **succeeded** — Research Claude: 2/2 pages captured for Claude
- **succeeded** — Research Google Gemini: 2/2 pages captured for Google Gemini
- **succeeded** — Research Microsoft Copilot: 2/2 pages captured for Microsoft Copilot
- **succeeded** — Research Mistral Le Chat: 2/2 pages captured for Mistral Le Chat
- **succeeded** — Compare positioning and find market gaps: 5/5 competitors compared; 4 gaps inferred (rules)
- **succeeded** — Write competitor-analysis CSV: competitor-analysis.csv written (6,152 bytes)
- **succeeded** — Write evidence-backed research report: research-report.md written (11,692 bytes)
- **succeeded** — Generate landing-page concept: landing-page-concept.html written (5,530 bytes)
- **succeeded** — Export evidence ledger: evidence.json written (68,383 bytes)
- **succeeded** — Independently verify artifacts and evidence: 36/36 checks passed
- **running** — Compile verification report and mission summary
