# Claude-mode hardening patch and Claude API test (2026-10-28)

Repository: /Users/rajatsanger/Developer/OmniPilot, HEAD `8fceb93c7020943aea8994b58f023117a18e9766`. Nothing was committed, pushed, stashed, reset or deleted.

**Outcome: the patch is applied and re-verified with Claude switched off. The Claude test stopped at C0 on two of the brief's stop conditions: no API key is configured, and ANTHROPIC_BASE_URL is set. C1 and C2 were not run, so no Claude API call (free or paid) was made.**

## A. Patch

- Patch: `omnipilot-claude-mode-hardening.patch`, attached by the user in the project thread (saved at ~/.claude/uploads/…/a45d2e42-omnipilot-claude-mode-hardening.patch). It was not in ~/Downloads.
- Size and hash: 34,090 bytes, sha256 `15884cc76c4ca985ab6a1300bbf635764a478750a4316623328dbad1a1710c40`, matching the expected values. The patch touches 13 files.
- Before applying: `git apply --reverse --check` failed (not applied yet) and `git apply --check` passed (exit 0). Then `git apply`, with no --reject or --3way, exited 0. Afterwards `git apply --reverse --check` exits 0.
- Result:
  - New untracked files: scripts/claude-check.ts, tests/claudeMode.test.ts, tests/popupGuard.test.ts.
  - Newly modified files: server/config.ts, server/core/analysis.ts, server/index.ts, server/llm/claude.ts, server/tools/registry.ts.
  - Already-modified files that got more changes: package.json (now has `"claude:check": "tsx scripts/claude-check.ts"`), browserManager.ts, engine.ts, planner.ts, missionTools.ts.
  - Totals: 31 tracked files modified, `31 files changed, 357 insertions(+), 53 deletions(-)`. `git diff --check` exits 0.
- Status before and after: A1-status-before.txt and A3-apply.txt.

## B. Re-verification with Claude off (`ANTHROPIC_API_KEY=` on every process)

| Command | Exit | Result |
|---|---|---|
| `NODE_ENV=development npm run typecheck` | 0 | clean |
| `NODE_ENV=test npm test` | 0 | **15 files, 122 tests passed** (this morning: 13 / 118) |
| `NODE_ENV=development npm run build` | 0 | built |

Rehearsal: `npm run demo:offline` on the default ports 8787 / 41001–41005 (free this time), with data dir /tmp/omnipilot-claude-test-data. Health reported fixture / deterministic / 5 sites. The `offline-demo-ui.mjs` E2E exited 0 (B2-offline-demo-ui.txt):
- Completed with warnings (by design), mission msn_f7880a8985b8.
- 9/10 sources, 5/5 competitors, prices for 3, 38/38 grounded.
- **38 passed / 0 failed / 0 warnings**, **5/5 artifact sha256 matches**.
- Stop leaves the mission cancelled with 0 artifacts. **0 console errors**.

The isolation fix from this morning still holds: a rebind Host and a cross-site POST both get 403. The demo server (npm 8994 → tsx 9012 → node 9013 → 9014) received SIGTERM and logged "SIGTERM received, shutting down". 8787 and 41001–41005 are free, and no process I started is left running.

## C. Claude test

### C0 (no network): C0-preflight.txt, C0-claude-check.txt

| Question | Answer |
|---|---|
| ANTHROPIC_API_KEY in this shell | no |
| … in a fresh login shell (`zsh -ilc`) | no |
| … in .env | no (.env does not exist) |
| Same/different | n/a (no key set anywhere) |
| Key category OmniPilot would use | **none** |
| ANTHROPIC_BASE_URL | **set**, in this shell and in a fresh login shell. claude:check reports its host as api.anthropic.com |
| ANTHROPIC_AUTH_TOKEN / ANTHROPIC_CUSTOM_HEADERS / ANTHROPIC_LOG | not set / not set / not set |
| HTTPS_PROXY / HTTP_PROXY / https_proxy / http_proxy / NO_PROXY | all not set |
| ANTHROPIC_MODEL / NODE_ENV values | unset / unset |
| .env ignored by git | yes |
| `git ls-files .env` / `git log --all --oneline -- .env` | empty / empty |
| Leak scan paths (working tree, incl. untracked) | tests/claudeMode.test.ts only (the expected fake key) |
| Real-looking key hits: working tree / all history | 0 / 0 |
| Listening on 127.0.0.1:8787 | nothing |

`NODE_ENV=development npm run claude:check` exited 1, because no key is configured:

```
Claude configuration (values of secrets are never shown)
  ANTHROPIC_API_KEY set:        no
  model:                        claude-opus-5-5 (default)
  ANTHROPIC_BASE_URL override:  yes (api.anthropic.com)
  ANTHROPIC_AUTH_TOKEN set:     no (ignored: OmniPilot passes the API key explicitly)
  ANTHROPIC_CUSTOM_HEADERS set: no
  ANTHROPIC_LOG set:            no
  proxy variables set:          no
```

**Stopped before C1** on the brief's rules "no key" and "ANTHROPIC_BASE_URL set". C1 (free model check) and C2 (paid planning call) were **not run**.

Note: ANTHROPIC_BASE_URL points at api.anthropic.com itself, so it is probably harmless. But the brief lists it as a stop condition, and it is set even in a fresh login shell, so it comes from your shell profile and not only from this session. claude-check.ts would still allow it, because the host is api.anthropic.com.

## To continue (the user decides)

1. Provide a standard Anthropic API key (category "standard", not an OAuth token) in one place only. Either export it in the shell that will run the test, or put it in .env (which is git-ignored). Don't paste it into chat.
2. Decide on ANTHROPIC_BASE_URL. Either unset it for the test with `env -u ANTHROPIC_BASE_URL …`, or confirm that `https://api.anthropic.com` is acceptable.
3. Confirm the one paid call (C2) yourself in the project thread. C0 will then be re-run, followed by C1 and C2 once each.

## Confirmations

- No commit, push, stash, reset, checkout, clean or delete.
- No Claude/Anthropic API call of any kind.
- No public website opened by me. The only outside request was the UI page's Google Fonts request during the rehearsal, as this morning.
- docs/evidence/adal/ and the existing evidence folders are untouched.
- Every process I started has stopped.
- `grep -c` for the key prefix gives 0 in every text file in this folder (checked after writing this report).

---

## Update 10:52Z: re-run after "key added, yes, run the one paid Claude call"

The user confirmed the one paid call. The coordinator's update says ANTHROPIC_BASE_URL=api.anthropic.com is acceptable and no longer a stop condition.

### C0 re-run (no network): C0b-preflight-rerun.txt, C0b-claude-check.txt, C0c-key-shape.txt

| Question | Answer |
|---|---|
| Key in this shell / fresh login shell / .env | no / no / **yes** (.env only, as expected) |
| Same/different | n/a (only in .env) |
| **Key category** | **other**: it starts with the Anthropic key prefix but is **not** a standard API key (not `api`), not an OAuth token, not an admin key and not a claude.ai session cookie |
| Shape (structural only, no characters) | 1 line in .env; 1 ANTHROPIC_API_KEY line; no quotes, no whitespace, no non-ASCII, no CR; length bucket 90–129 |
| Other ANTHROPIC_* in .env | no |
| ANTHROPIC_BASE_URL | set (api.anthropic.com), now accepted |
| AUTH_TOKEN / CUSTOM_HEADERS / LOG / proxies / NO_PROXY | all not set |
| ANTHROPIC_MODEL / NODE_ENV | unset / unset |
| .env git-ignored / tracked / ever committed | yes / no / no |
| Leak scan | only tests/claudeMode.test.ts (fake key); real-looking hits 0 (working tree) and 0 (history) |
| 8787 | nothing listening |

`NODE_ENV=development npm run claude:check`: exit 0, "ANTHROPIC_API_KEY set: yes (from .env)", model claude-opus-5-5 (default), base URL override yes (api.anthropic.com), the other overrides no.

**Stopped again before C1**, on the stop rule "key not standard". C1 and C2 were **not run**, and there was **no Claude API call**. A key of an unrecognised type would most likely be rejected (401), and the brief says to stop rather than try.

### What the user should do

Check in the Claude Console (API keys page) that the key you copied is an ordinary API key. Those start with the prefix followed by `api`. Then replace the value in .env the same way as before (`read -rs`), so it isn't echoed. Don't paste it into chat. After that, tell me to go ahead and I'll re-run C0, then C1 and C2 once each. If you're sure this key type is right, say so explicitly and I'll run C1 (free) first; it will show whether the key is accepted before any paid call.

---

## Update 11:03Z: re-run after "i have fixed the isse lets go"

.env was rewritten at 11:00:20Z, so the key was replaced. C0 re-run (C0d-preflight-rerun3.txt):
- The key is in .env only (not in this shell or a login shell).
- **Category still "other".** After the Anthropic prefix there are 3 lowercase letters that are not api/oat/admin/sid, and they are not followed by the 2-digit version that standard keys have. Formatting is clean: 1 line, no quotes, whitespace or non-ASCII, length 90–129.
- The other settings are unchanged: BASE_URL set (api.anthropic.com, accepted); AUTH_TOKEN, CUSTOM_HEADERS, LOG, proxies and NO_PROXY not set; MODEL and NODE_ENV unset.
- .env is ignored, untracked and was never committed. Leak scan: only the fake key in tests/claudeMode.test.ts; real-looking hits 0 and 0. Nothing is listening on 8787.

**Stopped again before C1** ("key not standard"). There was no Claude API call.
