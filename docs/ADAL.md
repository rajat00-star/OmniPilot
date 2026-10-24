# AdaL by Sylph: development and testing evidence

**Status: not yet completed.** This file is intentionally a template. Nothing below has been filled in with invented activity.

## What happened so far
The MVP in this repository was built in a cloud development container that does not have AdaL by Sylph installed or signed in, so AdaL could not be used there. That blocker was reported at the start of the build. No AdaL sessions, recordings, Browser Use runs, screenshots or test results exist yet, and none are claimed.

## What to do to complete the requirement (on a machine with AdaL)
1. Clone this repository and run `npm install && npm run build && npm start`.
2. **Inspect:** ask AdaL to review the architecture (`docs/ARCHITECTURE.md`, `server/core/engine.ts`) and record its findings.
3. **Implement or debug:** have AdaL implement or fix at least one real item. Good candidates from `docs/CAPABILITIES.md`: plan-aware price extraction (associating prices with plan names), or headed-mode takeover UX.
4. **Browser Use testing:** have AdaL operate the running app at http://127.0.0.1:8787 with Browser Use: create a mission, edit a target, approve, pause/resume, open the Results, Evidence and Verification tabs, and download the CSV.
5. **Test:** have AdaL run `npm test` and `npm run e2e:ui` and record the output.
6. Save the genuine evidence below: session exports or logs, screen recordings, screenshots, commit hashes of AdaL-authored changes, and the exact commands and outputs.

## Evidence log
| Date | What AdaL did | Evidence (link or file) | Commit |
|---|---|---|---|
| | | | |
