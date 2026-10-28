import { Bot, ScanEye } from "lucide-react";
import type { Health, Mission } from "../lib/api";
import { isDisplayed, pricingScreenshots } from "../lib/dashboard";
import { host } from "../lib/format";
import { Badge, Button, SectionTitle } from "./ui";

/**
 * Workspace control for the multimodal companion: Claude reads the pricing screenshots this mission
 * captured. It is a paid call, so it only runs after the user confirms, and it is not offered when
 * Claude is not configured.
 */
export function VisionPanel({ mission, health, busy, onRead }: { mission: Mission; health?: Health; busy: boolean; onRead(): void }) {
  if (!isDisplayed(mission.status)) return null;
  const pages = pricingScreenshots(mission);
  const runs = mission.visionRuns ?? [];
  // The offline demo forces rule-based mode even when a key is present, and makes no Claude calls.
  const configured = Boolean(health?.reasoning.configured) && health?.reasoning.mode === "claude";
  const confirmAndRead = () => {
    const ok = window.confirm(
      `Send ${pages.length} pricing screenshot${pages.length === 1 ? "" : "s"} from this mission to Claude (${health?.reasoning.model ?? "Claude"})?\n\n` +
        `This is a paid API call: about $0.02 per screenshot, at most about $0.05 each. No web page is opened. ` +
        `Readings are kept only when the plan name and price also appear in the captured page text.`,
    );
    if (ok) onRead();
  };
  return (
    <section className="card vision-card" aria-label="Screenshot reading">
      <SectionTitle>Read pricing screenshots (multimodal)</SectionTitle>
      <p>
        Text matching finds prices but not which plan they belong to. Claude can read the captured pricing screenshots and pair plan names with prices and limits. Each pairing is checked against the captured page text and shown as an
        inference that needs review.
      </p>
      {runs.length > 0 ? (
        runs.map((r) => (
          <div key={r.id}>
            <div className="vision-row">
              <Badge tone="info" icon={Bot}>
                Read by {r.model}
              </Badge>
              <span className="cell-sub">
                {r.inputTokens.toLocaleString()} input + {r.outputTokens.toLocaleString()} output tokens{r.costUsd !== undefined ? ` · about $${r.costUsd.toFixed(3)}` : ""}
              </span>
            </div>
            <ul className="vision-pages">
              {r.pages.map((p) => (
                <li key={p.sourceId}>
                  <span className="mono">{host(p.url)}</span>
                  <span>{p.targetName}</span>
                  {p.error ? (
                    <Badge tone="danger">Failed: {p.error}</Badge>
                  ) : (
                    <>
                      <Badge tone={p.kept ? "success" : "neutral"}>{p.kept} kept</Badge>
                      {p.discarded.length > 0 && (
                        <span className="cell-sub" title={p.discarded.map((d) => `${d.plan} ${d.price}: ${d.reason}`).join("\n")}>
                          {p.discarded.length} discarded (not in the captured text)
                        </span>
                      )}
                      {p.pricingVisible === false && <span className="cell-sub">no pricing visible in the screenshot</span>}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : !configured ? (
        <div className="muted">Not available in rule-based mode. Start the server with ANTHROPIC_API_KEY set to use it.</div>
      ) : !pages.length ? (
        <div className="muted">This mission captured no pricing screenshots.</div>
      ) : (
        <div className="vision-row">
          <Button icon={ScanEye} onClick={confirmAndRead} loading={busy} disabled={busy}>
            Read {pages.length} pricing screenshot{pages.length === 1 ? "" : "s"} with Claude
          </Button>
          <span className="cell-sub">Paid: about $0.02 each. You confirm first.</span>
        </div>
      )}
    </section>
  );
}
