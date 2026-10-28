# Judge demo script (4 to 5 minutes)

The story is **understand → plan → execute → verify → deliver**. One successful workflow, one honest failure, and the evidence behind every number.

Two ways to run it:
- **Live web (recommended for the recorded video).** `npm start`, real vendor sites. This is what the script below follows.
- **Offline fixture (fallback, and the safest option on stage).** `npm run demo:offline`, five fictional vendors on this laptop. See "Fallback" at the end.

## Before you start (5 minutes)

```bash
cd ~/Developer/OmniPilot
NODE_ENV=development npm run build
ANTHROPIC_API_KEY= npm start            # rule-based mode, no paid calls
# or, to show the multimodal step:
npm start                               # with the key in .env; the UI shows "Claude connected"
```

- Open http://127.0.0.1:8787. Keep the finished live mission (`msn_e8b87606bacb`) in the sidebar as a fallback.
- Paste this instruction into a text editor, ready to copy:

  > Compare three AI meeting assistants using only their public pages: https://otter.ai/ https://otter.ai/pricing https://fireflies.ai/ https://fireflies.ai/pricing https://fathom.video/ https://fathom.video/pricing. Report main features and publicly listed pricing and plan limits with source URLs, and write a CSV and a report.

## The script

| Time | Do | Say | Expected on screen |
|---|---|---|---|
| 0:00–0:20 | Show the empty composer and the sidebar footer (mode, browser, tools) | "Most agents tell you they did something. OmniPilot shows you, and checks its own work before it reports." | Composer; mode badge says Claude connected or Deterministic |
| 0:20–0:45 | Paste the instruction, press **Draft plan** | "One plain-language instruction. Nothing has run yet: this is the plan." | Plan review: 3 targets (Otter.ai, Fireflies.ai, Fathom) with 2 URLs each, dependency stages, **Approve and run** |
| 0:45–1:00 | Point at the stages, press **Approve and run** | "Registered tools only, inputs validated, every URL checked. I approve, then it runs." | Status Running; the browser view starts loading the first page |
| 1:00–1:40 | Browser view and agent panel | "That's a real Chromium. Each page is saved as text with a SHA-256 hash, plus a screenshot." | Tabs for otter.ai and fireflies.ai; activity `browser.open → browser.extract → browser.screenshot` |
| 1:40–2:15 | **Failure workflow:** press **Take over**, type `http://192.168.1.1` in the address bar, press Enter, then type `https://fathom.video/pricing`, press **Resume agent** | "I can take over at any time. If I, or a web page, try to reach my private network, it's refused, and that holds for redirects too." | Red error: private address blocked. The public page opens normally. Agent resumes |
| 2:15–2:30 | Wait for **Completed** (or *Completed with warnings*) | "When a site blocks us, the run says *with warnings* rather than pretending." | Results tab opens by itself |
| 2:30–3:30 | Press **Judge mode** | "This is the read-only view for reviewers." Walk the page: objective, three findings with source links, limitations, conclusion label. Click a finding's **Evidence** | Executive summary; each finding has a source host and "Quote re-matched". The evidence dialog shows URL, capture time, the exact excerpt and the page screenshot |
| 3:30–3:50 | Scroll to **Publicly displayed pricing** and **Verification transparency** | "A missing price is *Not found*, never $0. A $0 shown here is printed on the page. These checks prove the files are intact and the quotes are real. They do not prove a vendor's claim is true, and the page says so." | Pricing table, verification stats and the integrity disclaimer |
| 3:50–4:20 | *(Only with Claude connected.)* **Exit judge mode** → Results → **Read N pricing screenshots with Claude** → confirm | "The multimodal companion. Claude reads the pricing screenshots and pairs each plan with its price. A pairing is kept only if both are printed in the captured text, and it's marked as needing review." | Vision panel shows "N kept / M discarded" and the cost; Judge mode pricing gains "Plans read from screenshot" |
| 4:20–4:45 | Deliverables: open `research-report.md`, download `competitor-analysis.csv` | "Real files, read back from disk and hash-checked." | Files open; verification badges green |
| 4:45–5:00 | Close | "Understand, plan, execute, verify, deliver. Every step leaves evidence you can audit." | n/a |

Without a key, skip 3:50–4:20 and say: "With a key, Claude also plans, writes the analysis and reads the screenshots. Here everything is rule-based, and the UI says so."

Each screenshot-reading run is a paid call: about $0.02 per screenshot, and once per mission. Every recording take that runs it spends again.

## Optional second failure (20 s)

Start a second mission, approve it, and press **Stop** after a few seconds. **Expected:** status *Cancelled*, browser pages closed, no artifacts written.

## Recording checklist

- [ ] Screen at 1440×900 or larger, browser zoom 100%, a single browser window with no bookmarks bar.
- [ ] Do Not Disturb on; close mail, chat and other tabs.
- [ ] Never show `.env`, the terminal environment or any API key. Start the server before you start recording.
- [ ] Run the script once as a rehearsal; check that otter.ai, fireflies.ai and fathom load on this network.
- [ ] Microphone check; record in one take if possible, 4–5 minutes.
- [ ] If a site fails during the take, keep going: the failure handling is part of the story.
- [ ] Export as MP4 and play it back once before uploading. Check that the URLs and numbers are readable.

## Fallback plan

| Problem | Do this |
|---|---|
| Venue or home network blocks the vendor sites | Use the offline demo: `ANTHROPIC_API_KEY= npm run demo:offline`, then **Signature mission → Draft plan → Approve**. It shows a redirect, a missing price ("Not found"), an HTTP 403 page and a prompt-injection page, all on fictional vendors and labelled as fixture data. In Take over, `https://example.com` is refused. |
| The live run is slow or stuck | Press **Stop**, then open the finished mission `msn_e8b87606bacb` from the sidebar and continue from Judge mode. |
| Claude call fails or there is no key | Skip the screenshot step. Rule-based mode is complete and labelled. |
| Anything else | Use the screenshots in `docs/screenshots/offline-demo/` and `docs/evidence/judge-dashboard-2026-10-28/`. |

More launch details, recovery tips and technical Q&A: [FINALE.md](FINALE.md).
