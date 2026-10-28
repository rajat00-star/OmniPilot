# Submission notes: users, value, future, and what the team still has to do

## Who it is for

| User | Job they need done | What OmniPilot gives them |
|---|---|---|
| Founders and product managers | "Who are we up against, what do they charge, and how do they position themselves?" before a pitch, a pricing decision or a launch | A competitor table, a cited report and a landing-page concept, built from the vendors' own pages in minutes, with every number traceable to a page capture |
| Product marketers and GTM teams | Messaging and positioning grounded in what competitors actually say | Vendor-stated features side by side, inferred gaps marked as inferences, and a draft landing page labelled "not market-validated" |
| Analysts, consultants and students | Desk research that must survive review | An evidence ledger (URL, capture time, verbatim excerpt, SHA-256 of the stored page) and a verification report that re-checks every quote |
| Anyone who has to trust an AI agent's output | "Did it really do that?" | Plan approval before anything runs, a live activity log, stop and take over at any time, and a Judge Mode that separates facts, inferences and missing data |

## Practical value

- **Faster, and checkable.** A five-competitor scan that takes an analyst an afternoon of tab-switching runs in a few minutes. Every figure links to the page and excerpt it came from, so a reviewer checks it rather than redoing it.
- **Honest about gaps.** A missing price is reported as "Not found", never as $0. A blocked page is a failed source, and the run ends "completed with warnings". Market gaps and audiences are labelled as inferences that need review.
- **Safe by default.** Research is read-only. It runs on public http(s) pages only, with private networks, redirects and pop-ups guarded. Page text is treated as data, never as instructions. Consequential actions need approval, and paid model calls need explicit confirmation.
- **Works without a model.** Deterministic mode does real browsing, extraction, artifacts and verification at zero API cost. Claude adds planning, synthesis and screenshot reading when a key is configured, and every model claim must cite captured evidence.

These are design properties shown in the demo and tests. They are not measured user outcomes: OmniPilot has not been used by external users yet.

## Future potential

1. **Deeper multimodal reading.** Full-page screenshots and plan tables read for every vendor, and charts or images in pages, all with the same ground-against-text rule.
2. **Scheduled monitoring.** Re-run a mission weekly and diff prices, plans and positioning against the last verified capture.
3. **More GTM deliverables.** A launch brief, a battlecard and an objection-handling sheet, each generated from the same cited evidence and checked by the verifier.
4. **Desktop shell.** Package the workspace with a visible, controllable browser pane (Electron or similar) so takeover means clicking in the page.
5. **Team use.** Authentication, shared mission history and reviewer sign-off on inferences.
6. **Authorised applications.** Signed-in tools such as CRMs and analytics, behind the existing approval gate and audit log.

## Still to do by the team (cannot be done by Claude Code)

| # | Task | Why |
|---|---|---|
| 1 | **Record the demo video** using [DEMO_SCRIPT.md](DEMO_SCRIPT.md) and its recording checklist | Required deliverable; no recording exists |
| 2 | **Commit and push** the finale work to the submission repository | Nothing is committed since `8fceb93`, and the Mac repository has no git remote |
| 3 | **Fill in team details** in the deck (`pitch/final/OmniPilot_Final_Submission.pptx` placeholders) and check them against the track's slide guide | Placeholders remain |
| 4 | **Approve or decline** the one paid screenshot-reading run on the live mission | Moves requirement 7 from "implemented" to "verified" |
| 5 | **Genuine AdaL sessions**, listed below | Requirement 16 |

## Genuine AdaL tasks to run yourselves

AdaL (CLI 1.11.0, installed on the developer Mac) must do these itself. Claude Code has not done them, and its work must not be presented as AdaL's.

1. **Checklist review.** In the repo, ask AdaL to review `docs/REQUIREMENTS.md` against the code and tests. It should confirm or dispute each status, citing files, and write its findings to `docs/evidence/adal/finale-review/REVIEW.md`. Keep its transcript.
2. **Browser check of the running product.** Start `npm run build && npm run demo:offline`. With AdaL's browser capability, open http://127.0.0.1:8787 and run the signature mission end to end: approve, Take over, Resume, Results, Judge mode, and the evidence drill-down. Have AdaL save its screenshots and a short pass/fail list.
3. **One real test or debug task.** Pick a genuine issue and let AdaL diagnose it, fix it and add a regression test. Candidates:
   - Fathom is labelled `fathom.video` while its captures show `fathom.ai`, because of a redirect. The target label could follow the final host.
   - The production build warns about a JavaScript chunk over 500 kB.
   Review the diff and commit it with AdaL named in the commit message, as with `f763ccd`.
4. **Capture the evidence.**
   - Copy the new AdaL session transcripts from `~/.adal/sessions/` into `docs/evidence/adal/sessions/`. Check them for keys or tokens first, and redact anything sensitive.
   - Screen-record at least one AdaL session.
   - Update the AdaL table in `docs/ADAL.md` with the session id, date, what AdaL did and the resulting commit.
5. **Optional: older evidence.** The 2026-10-25 session transcript (`~/.adal/sessions/conversation_b4f50c11-….jsonl`, 2.7 MB) matches the session documented in `docs/ADAL.md`. After a secrets review, adding it would turn requirement 16's "no session export" gap into real evidence.
