# Verification report — mission msn_e8b87606bacb

Generated 2026-10-28T11:12:44.004Z. All figures are computed from execution records, not from model output.

**Data source: Live public web.**

## Summary

- 6 of 6 sources captured (0 failed).
- 3 of 3 competitors had at least one page captured.
- 3 product descriptions found.
- 3 competitors with publicly displayed prices; 0 unavailable.
- 54 of 54 observations re-grounded verbatim in stored captures (0 ungrounded).
- 24 inferred claims require human review.
- 28 checks passed, 0 failed, 0 warnings across 3 artifacts.

> Artifact checks prove the files are well-formed, complete and traceable to captured pages. They do not prove the vendors' claims are true or current.

## Checks

| Status | Scope | Artifact | Check | Detail |
|---|---|---|---|---|
| PASSED | integrity | competitor-analysis.csv | File exists | msn_e8b87606bacb/files/competitor-analysis.csv |
| PASSED | integrity | competitor-analysis.csv | Read back matches written bytes | 3,679 bytes, sha256 8ddcbe8a703d… |
| PASSED | integrity | competitor-analysis.csv | Parses as CSV | 3 data rows |
| PASSED | integrity | competitor-analysis.csv | Required columns present | 17 required columns |
| PASSED | coverage | competitor-analysis.csv | One row per competitor | 3 rows for 3 enabled targets |
| PASSED | integrity | competitor-analysis.csv | Data source labelled on every row | Every row says "Live public web" |
| PASSED | integrity | competitor-analysis.csv | No empty required cells | All required cells populated (Unknown/Not found used explicitly) |
| PASSED | integrity | competitor-analysis.csv | Valid pricing status values | All in {Found, Not found, Source inaccessible} |
| PASSED | integrity | competitor-analysis.csv | Missing prices not shown as zero | No zero placeholders for missing prices |
| PASSED | integrity | competitor-analysis.csv | Pricing status consistent with values | Found ⇔ prices listed |
| PASSED | coverage | competitor-analysis.csv | Description sources are captured pages | Every description URL is in the capture log |
| PASSED | coverage | competitor-analysis.csv | Evidence ids resolve | All evidence ids exist in the ledger |
| PASSED | integrity | research-report.md | File exists | msn_e8b87606bacb/files/research-report.md |
| PASSED | integrity | research-report.md | Read back matches written bytes | 7,806 bytes, sha256 43aa90762594… |
| PASSED | integrity | research-report.md | Required sections present | 7 sections found |
| PASSED | coverage | research-report.md | Every captured source cited | 6 sources cited in Evidence index |
| PASSED | coverage | research-report.md | Every competitor has a profile | 3 profiles |
| PASSED | integrity | research-report.md | Data source stated | Report states "Live public web" |
| PASSED | integrity | research-report.md | Observed / inferred / unknown labelling | Label legend present |
| PASSED | coverage | research-report.md | Inline citations resolve | 50 inline citations |
| PASSED | integrity | evidence.json | File exists | msn_e8b87606bacb/files/evidence.json |
| PASSED | integrity | evidence.json | Read back matches written bytes | 44,610 bytes, sha256 21f912ccbd37… |
| PASSED | integrity | evidence.json | Parses as JSON | Valid JSON |
| PASSED | integrity | evidence.json | Ledger shape | 6 sources, 78 observations |
| PASSED | coverage | evidence.json | Observations link to sources | Every observation links to a captured source |
| PASSED | grounding | — | Stored captures intact | 6 capture files hash-verified |
| PASSED | grounding | — | Observations grounded in captures | 54 grounded, 0 ungrounded |
| PASSED | render | — | Screenshot evidence for every captured page | 6 screenshots present, 6 pixel-checked non-blank, each linked to its capture step |

## Steps

- **succeeded** — Research otter.ai: 2/2 pages captured for otter.ai
- **succeeded** — Research fireflies.ai: 2/2 pages captured for fireflies.ai
- **succeeded** — Research fathom.video: 2/2 pages captured for fathom.video
- **succeeded** — Compare positioning and find market gaps: 3/3 competitors compared; 3 gaps inferred (rules)
- **succeeded** — Write competitor-analysis CSV: competitor-analysis.csv written (3,679 bytes)
- **succeeded** — Write evidence-backed research report: research-report.md written (7,806 bytes)
- **succeeded** — Export evidence ledger: evidence.json written (44,610 bytes)
- **succeeded** — Independently verify artifacts and evidence: 28/28 checks passed
- **running** — Compile verification report and mission summary
