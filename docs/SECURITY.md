# Security controls

| Risk | Control | Where | Tested in |
|---|---|---|---|
| SSRF to local or private services | Only `http:`/`https:`; no embedded credentials; blocks `localhost`, `.local`/`.internal`/single-label hosts, loopback, RFC 1918, CGNAT, link-local, multicast and documentation ranges, IPv6 ULA/link-local, IPv4-mapped IPv6, alternate numeric encodings (normalised by the URL parser), and cloud metadata hosts (`169.254.169.254`, `metadata.google.internal`, `fd00:ec2::254`). Hostnames are resolved and every address must be public. | `server/security/urlSafety.ts` | `tests/urlSafety.test.ts` |
| Unsafe redirects | Every hop of the redirect chain and the final URL are revalidated after navigation; a page reached through a blocked hop is discarded. Main-frame navigations and subresources are also filtered by a Playwright route. | `browserManager.ts` | `engine.test.ts` ("blocked redirects") |
| Arbitrary code or shell from model output | Steps can only name registered tools; inputs are Zod-validated; there is no shell or eval tool. Model output is parsed and schema-validated, never executed. | `tools/registry.ts`, `planner.ts`, `llm/claude.ts` | `planner.test.ts` |
| File writes outside the artifact directory | Filenames are regex-restricted; paths are resolved and must stay inside the mission's `files/` directory; at most one subdirectory segment. The file-serving route uses the same check. | `security/paths.ts`, `app.ts` | `paths.test.ts`, `api.test.ts` |
| Prompt injection from web pages | Page text is wrapped in `<untrusted>` tags with an explicit data-only policy; tag spoofing is stripped; the engine never derives tool calls from page content; verification is computed independently. | `llm/claude.ts`, `engine.ts` | `llm.test.ts`, `engine.test.ts` ("injected page instructions") |
| Consequential actions | Tools flagged `consequential` (currently `artifact.delete`) always stop for explicit approval; denial skips the step; they cannot run ad hoc. Research missions are read-only by default. | `engine.ts` | `engine.test.ts` |
| Runaway execution | Per-step timeout, per-navigation timeout, max 2 concurrent pages, max 8 targets and 3 URLs per target, max 40 steps, 64 KB JSON body limit. | `config.ts`, `planner.ts`, `app.ts` | — |
| Secret exposure | API key read server-side only; health endpoint reports presence, not value; key is never logged; `.env` is git-ignored. The Claude client uses only the explicitly configured key, not ambient credentials. | `config.ts`, `llm/claude.ts` | `llm.test.ts`, `api.test.ts` |
| Generated HTML executing | The landing page contains no scripts (checked by the verifier), is rendered offline with JavaScript disabled and network blocked, and artifact responses carry a sandboxing Content-Security-Policy. | `verifier.ts`, `browserManager.ts`, `app.ts` | `verifier.test.ts` |
| Fabricated success | Steps succeed only when tools return real results; the mission status is computed from step outcomes and check results; summaries are computed from records. | `engine.ts`, `verifier.ts` | `engine.test.ts`, `verifier.test.ts` |

Out of scope by design: OmniPilot does not log in to sites, bypass CAPTCHAs, paywalls or access controls, or submit forms. It uses public pages only.

The server binds to `127.0.0.1` and has no authentication: it is a single-user local workstation app and must not be exposed to a network as-is.
