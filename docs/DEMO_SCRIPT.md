# Demo script (about 4 minutes)

**Setup before going on stage:** `npm run build && npm start`, open http://127.0.0.1:8787, and have one completed mission in the sidebar as a fallback. If you have an API key, set it in `.env` first so the sidebar shows "Claude connected". Check network access to the target sites.

## 1. The promise (20 s)
"Most AI agents tell you they did something. OmniPilot shows you what it did, and checks its own work before it reports."
Point at the sidebar footer: reasoning mode, browser, allowlisted tools, read-only mode.

## 2. One instruction (30 s)
Click **Signature mission**. Optionally type a product name ("VerityDesk"). Press **Draft plan**.
"Nothing has run yet. This is the plan."

## 3. Plan and control (40 s)
* Show the targets and their official URLs. "In deterministic mode these come from a reviewed seed list, and the UI says so. With Claude, Claude proposes them and OmniPilot validates every URL."
* Edit or disable one target, **Apply and rebuild plan**, and show the dependency stages: parallel research, then analysis, then the four writers, then verification, then the report.
* Press **Approve and run**.

## 4. Real execution (60 s)
* Browser view: tabs appear for each real page; screenshots come from Chromium; the address bar shows the real URL; "Agent driving" badge.
* Agent panel: current step, live tool activity (`browser.open → browser.extract → browser.screenshot`), progress.
* Press **Pause** or **Take over**: the agent holds; type a public URL in the address bar to show manual control; **Resume**.
* If a site is blocked or unreachable, point at the red tab and the error with a recovery suggestion. "It doesn't pretend."

## 5. Verified delivery (70 s)
* Results: summary figures computed from the run, with "prices unavailable" and "need human review" counts.
* Competitor comparison: observed description and prices with S-number citations; audiences and positioning marked inferred.
* Deliverables: open the CSV and the landing page; download the report.
* Evidence tab: filter to Inferences, then Observations; every row has URL, time, excerpt and a "grounded" badge.
* Verification tab: read-back hashes, parser checks, "missing prices not shown as zero", citation resolution, offline render screenshot of the landing page.
* "File checks prove integrity, not truth. The UI says that too."

## 6. Close (20 s)
"Understand, plan, execute, observe, verify, deliver. Every step leaves evidence you can audit."

## Fallbacks
* No network to vendor sites: use **Your own URLs** with reachable pages, or open the completed mission from the sidebar.
* No API key: deterministic mode is fully functional and labelled; do not describe it as AI reasoning.
