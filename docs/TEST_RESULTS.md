# Tests

> Current results: [EVIDENCE_INDEX.md](EVIDENCE_INDEX.md) (2026-10-28). Earlier: [VALIDATION.md](VALIDATION.md) (2026-10-24 15:xx UTC): 91 tests passed, live missions and control-path checks re-run. The record below is the original build run.

## How to run

```bash
npm test              # Vitest: unit + integration (launches headless Chromium against a local fixture site)
npm run typecheck     # TypeScript, server + UI
npm run build         # production UI build
npm start &           # then, in another shell:
npm run e2e:ui        # Playwright drives the real UI through a full mission and saves screenshots to docs/screenshots
npm run mission       # headless signature mission through the real engine, printing the live activity log
```

The engine tests use a local fixture HTTP server. Loopback access is enabled for them through an explicit `allowLoopback` policy that exists only in code; it cannot be enabled from the UI, the API or environment variables.

## Results recorded on 2026-10-24 (cloud build container, Node 22.22, Chromium via Playwright 1.63)

`npm test`: **9 files, 84 tests, all passed.** `npm run typecheck`: no errors. `npm run build`: succeeded.

```
 ✓ tests/verifier.test.ts > artifact verification > passes well-formed artifacts and grounds observations
 ✓ tests/verifier.test.ts > artifact verification > detects missing files
 ✓ tests/verifier.test.ts > artifact verification > detects post-write tampering via read-back hash
 ✓ tests/verifier.test.ts > artifact verification > detects missing CSV columns, empty required cells and fake zero prices
 ✓ tests/verifier.test.ts > artifact verification > detects malformed CSV
 ✓ tests/verifier.test.ts > artifact verification > detects missing report sections and uncited sources
 ✓ tests/verifier.test.ts > artifact verification > flags observations whose excerpt is not in the stored capture
 ✓ tests/verifier.test.ts > artifact verification > detects a modified capture file
 ✓ tests/verifier.test.ts > artifact verification > checks landing page structure and dangling evidence references
 ✓ tests/verifier.test.ts > artifact verification > reports an artifact the writer never produced
 ✓ tests/api.test.ts > HTTP API > reports health without secrets
 ✓ tests/api.test.ts > HTTP API > validates mission input
 ✓ tests/api.test.ts > HTTP API > creates a plan that waits for approval, and rejects unsafe target edits
 ✓ tests/api.test.ts > HTTP API > confines file access to the mission artifact directory
 ✓ tests/api.test.ts > HTTP API > streams mission snapshots over SSE
 ✓ tests/planner.test.ts > instruction parsing > reads target counts, deliverables, product names and URLs
 ✓ tests/planner.test.ts > deterministic planner > builds a valid dependency graph for the signature mission
 ✓ tests/planner.test.ts > deterministic planner > uses URLs from the instruction as user targets
 ✓ tests/planner.test.ts > deterministic planner > rejects unsafe URLs embedded in the instruction
 ✓ tests/planner.test.ts > plan validation rejects invalid model plans > rejects unknown tool names
 ✓ tests/planner.test.ts > plan validation rejects invalid model plans > rejects malformed tool inputs
 ✓ tests/planner.test.ts > plan validation rejects invalid model plans > rejects dangling dependencies and cycles
 ✓ tests/planner.test.ts > plan validation rejects invalid model plans > rejects duplicate ids, empty plans and references to unknown targets
 ✓ tests/planner.test.ts > plan validation rejects invalid model plans > rejects private-network target URLs
 ✓ tests/planner.test.ts > plan validation rejects invalid model plans > produces a valid graph when targets are disabled
 ✓ tests/urlSafety.test.ts > URL validation > accepts public http and https URLs
 ✓ tests/urlSafety.test.ts > URL validation > blocks file:///etc/passwd (scheme)
 ✓ tests/urlSafety.test.ts > URL validation > blocks javascript:alert(1) (scheme)
 ✓ tests/urlSafety.test.ts > URL validation > blocks ftp://example.com/x (scheme)
 ✓ tests/urlSafety.test.ts > URL validation > blocks data:text/html,hi (scheme)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://localhost:8787/api (internal_host)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://127.0.0.1/ (private_ip)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://10.0.0.5/ (private_ip)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://192.168.1.1/ (private_ip)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://172.20.0.1/ (private_ip)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://169.254.169.254/latest/meta-data/ (private_ip)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://metadata.google.internal/computeMetadata/v1/ (internal_host)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://[::1]/ (private_ip)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://[fd00:ec2::254]/ (private_ip)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://[::ffff:127.0.0.1]/ (private_ip)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://2130706433/ (private_ip)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://0x7f000001/ (private_ip)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://0177.0.0.1/ (private_ip)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://router.local/ (internal_host)
 ✓ tests/urlSafety.test.ts > URL validation > blocks http://intranet/ (internal_host)
 ✓ tests/urlSafety.test.ts > URL validation > blocks https://user:pass@example.com/ (credentials)
 ✓ tests/urlSafety.test.ts > URL validation > blocks not a url (invalid)
 ✓ tests/urlSafety.test.ts > URL validation > blocks hostnames that resolve to private addresses (DNS rebinding style)
 ✓ tests/urlSafety.test.ts > URL validation > revalidates every hop of a redirect chain
 ✓ tests/urlSafety.test.ts > URL validation > only allows loopback when the test policy explicitly enables it
 ✓ tests/extraction.test.ts > extraction > finds displayed prices with their source line
 ✓ tests/extraction.test.ts > extraction > detects free tiers and ignores long paragraphs
 ✓ tests/extraction.test.ts > extraction > never invents a price or description when the page has none
 ✓ tests/extraction.test.ts > extraction > classifies audiences as inferences needing review and quotes evidence
 ✓ tests/extraction.test.ts > extraction > filters page furniture from vendor claims
 ✓ tests/paths.test.ts > artifact path confinement > resolves safe names inside the root
 ✓ tests/paths.test.ts > artifact path confinement > rejects "../escape.md"
 ✓ tests/paths.test.ts > artifact path confinement > rejects "sources/../../x"
 ✓ tests/paths.test.ts > artifact path confinement > rejects "/etc/passwd"
 ✓ tests/paths.test.ts > artifact path confinement > rejects "a/b/c.txt"
 ✓ tests/paths.test.ts > artifact path confinement > rejects ".."
 ✓ tests/paths.test.ts > artifact path confinement > rejects ".hidden"
 ✓ tests/paths.test.ts > artifact path confinement > rejects "a\\b"
 ✓ tests/paths.test.ts > artifact path confinement > rejects "x\u0000.md"
 ✓ tests/paths.test.ts > artifact path confinement > rejects ""
 ✓ tests/paths.test.ts > artifact path confinement > validates mission ids
 ✓ tests/llm.test.ts > missing API credentials > reports deterministic mode without exposing anything secret
 ✓ tests/llm.test.ts > missing API credentials > refuses structured calls with a typed error instead of using ambient credentials
 ✓ tests/llm.test.ts > missing API credentials > falls back to the deterministic planner with a visible warning
 ✓ tests/llm.test.ts > missing API credentials > reports the key as configured only when present, never echoing it
 ✓ tests/llm.test.ts > structured output schema > closes every object and strips unsupported keywords
 ✓ tests/llm.test.ts > structured output schema > wraps untrusted page text and neutralises tag spoofing
 ✓ tests/stateMachine.test.ts > task state machine > allows the normal mission lifecycle
 ✓ tests/stateMachine.test.ts > task state machine > supports pause/resume and cancellation from active states
 ✓ tests/stateMachine.test.ts > task state machine > rejects skipping approval and leaving terminal states
 ✓ tests/stateMachine.test.ts > task state machine > guards step transitions
 ✓ tests/engine.test.ts > mission engine with a real browser > runs a full mission: navigation, extraction, artifacts, read-back verification
 ✓ tests/engine.test.ts > mission engine with a real browser > reports extraction failures and blocked redirects honestly and degrades the mission
 ✓ tests/engine.test.ts > mission engine with a real browser > fails the mission when no evidence at all can be captured
 ✓ tests/engine.test.ts > mission engine with a real browser > cancels a running mission, closing in-flight navigation
 ✓ tests/engine.test.ts > mission engine with a real browser > pauses between browser actions and resumes
 ✓ tests/engine.test.ts > mission engine with a real browser > requires explicit approval for consequential tools and honours denial
 ✓ tests/engine.test.ts > mission engine with a real browser > refuses to run consequential tools ad hoc and validates ad-hoc input
 ✓ tests/engine.test.ts > mission engine with a real browser > treats injected page instructions as data
 Test Files  9 passed (9)
      Tests  84 passed (84)
```

## End-to-end runs (real public websites)

These were executed, not simulated. The build container's network policy only allows a few public hosts, which shaped the results:

| Run | Targets | Outcome |
|---|---|---|
| Signature mission, seed-list targets (`npm run mission`) | Perplexity, Notion AI, Jasper, Grammarly, ChatGPT | **failed (honestly):** 0/10 pages reachable (`ERR_TUNNEL_CONNECTION_FAILED` from the container's egress proxy). Every source failure is listed; artifacts were still written with every field marked Unknown and passed integrity checks; the mission is marked failed because no evidence exists. |
| Named competitors (`npm run mission -- "Research Claude, Microsoft Copilot and GitHub Copilot ..."`) | Claude, Microsoft Copilot, GitHub Copilot | **completed:** 6/6 pages captured, 3/3 descriptions and displayed prices found, every quoted observation re-grounded in its stored capture, 32/32 artifact checks passed. |
| UI end-to-end (`npm run e2e:ui`) | Same three, driven through the browser UI | **Completed**, zero browser console errors. Screenshots in `docs/screenshots/`. |

On an unrestricted network the seed-list signature mission reaches the vendors' sites directly; some vendors block automated browsers, and those failures are reported per source, not hidden.
