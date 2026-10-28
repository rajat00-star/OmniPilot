# Live mission msn_e8b87606bacb: summary

Copied unchanged from data/missions/msn_e8b87606bacb on 2026-10-28; 17 files, scanned first for "sk-ant", "ANTHROPIC" and "Bearer" with 0 matches, so nothing was excluded. Source folder left in place.

| Field | Value |
|---|---|
| Status | completed |
| Data source | live |
| Reasoning mode | deterministic |
| Planner | deterministic |
| Created | 2026-10-28T11:12:06.271Z |
| Updated | 2026-10-28T11:12:44.006Z |

## Prompt

```
Compare three AI meeting assistants using only their public pages:

https://otter.ai/
https://otter.ai/pricing
https://fireflies.ai/
https://fireflies.ai/pricing
https://fathom.video/
https://fathom.video/pricing

Report their main features, publicly listed pricing, and plan limits. Include source URLs for every factual finding. Generate a CSV and a report. Mark inaccessible pages and missing information clearly; do not invent prices or features.
```

## Plan targets and URLs

- **otter.ai**: https://otter.ai/, https://otter.ai/pricing
- **fireflies.ai**: https://fireflies.ai/, https://fireflies.ai/pricing
- **fathom.video**: https://fathom.video/, https://fathom.video/pricing

## Sources captured

| Requested | Final URL | OK | Error |
|---|---|---|---|
| https://fireflies.ai/ | https://fireflies.ai/ | true |  |
| https://fireflies.ai/pricing | https://fireflies.ai/pricing | true |  |
| https://otter.ai/ | https://otter.ai/ | true |  |
| https://fathom.video/ | https://www.fathom.ai/ | true |  |
| https://otter.ai/pricing | https://otter.ai/pricing | true |  |
| https://fathom.video/pricing | https://www.fathom.ai/pricing | true |  |

## Summary counts (mission.summary)

```json
{
  "generatedAt": "2026-10-28T11:12:44.004Z",
  "sourcesAttempted": 6,
  "sourcesCaptured": 6,
  "sourcesFailed": 0,
  "targetsTotal": 3,
  "targetsWithAnyCapture": 3,
  "descriptionsFound": 3,
  "pricesFound": 3,
  "pricesUnavailable": 0,
  "observationsTotal": 54,
  "observationsGrounded": 54,
  "observationsUngrounded": 0,
  "inferences": 24,
  "claimsNeedingReview": 24,
  "artifactsChecked": 3,
  "checksPassed": 28,
  "checksFailed": 0,
  "checksWarned": 0,
  "integrityNote": "Artifact checks prove the files are well-formed, complete and traceable to captured pages. They do not prove the vendors' claims are true or current."
}
```

## Verification checks

Total 28: passed 28

Observations: 78. Artifacts: competitor-analysis.csv, research-report.md, evidence.json, verification-report.md. Warnings: none.
