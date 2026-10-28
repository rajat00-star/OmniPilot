import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bot, Check, ExternalLink, FileText, ImageIcon, Info, Minus, Quote, ShieldCheck, X } from "lucide-react";
import type { Analysis, Mission } from "../lib/api";
import { fileUrl } from "../lib/api";
import { INTEGRITY_DISCLAIMER, buildDashboard, evidenceIndex, type CompetitorCard, type Dashboard, type Evidence, type PricingCell } from "../lib/dashboard";
import { host, type Tone } from "../lib/format";
import { Badge, SectionTitle, Stat } from "./ui";

type Open = (e: Evidence) => void;

const CHECK_LABEL: Record<Evidence["check"], { label: string; tone: Tone }> = {
  grounded: { label: "Quote re-matched", tone: "success" },
  ungrounded: { label: "Quote not re-matched", tone: "danger" },
  needs_review: { label: "Needs human review", tone: "info" },
  unverified: { label: "Not re-matched", tone: "neutral" },
};

function KindBadge({ e }: { e: Evidence }) {
  if (e.kind === "inference") return <Badge tone="info">Inference</Badge>;
  if (e.kind === "unknown") return <Badge tone="warning">Unknown</Badge>;
  return <Badge tone="success">Quoted from page</Badge>;
}

function EvidenceButton({ e, onOpen, label = "Evidence" }: { e: Evidence; onOpen: Open; label?: string }) {
  return (
    <button type="button" className="ev-btn" onClick={() => onOpen(e)} aria-label={`${label}: ${e.targetName} ${e.field.replace(/_/g, " ")}`} title={e.sourceUrl ?? "Show evidence"}>
      <Quote size={12} aria-hidden />
      {label}
    </button>
  );
}

const STATUS_BADGE: Record<CompetitorCard["status"], { label: string; tone: Tone }> = {
  captured: { label: "Captured", tone: "success" },
  partial: { label: "Partial", tone: "warning" },
  inaccessible: { label: "Inaccessible", tone: "danger" },
};

/** The judge-facing summary of a finished mission. Read-only: it renders the stored record and opens evidence. */
export function ResearchDashboard({ mission }: { mission: Mission }) {
  const dash = useMemo(() => buildDashboard(mission), [mission]);
  const index = useMemo(() => evidenceIndex(mission), [mission]);
  const [open, setOpen] = useState<Evidence>();
  if (!dash) return null;
  return (
    <div className="dashboard" data-testid="research-dashboard">
      <ExecutiveSummary dash={dash} onOpen={setOpen} />
      <CompetitorCards mission={mission} cards={dash.cards} onOpen={setOpen} />
      <FeatureMatrix dash={dash} onOpen={setOpen} />
      <PricingTable cards={dash.cards} onOpen={setOpen} />
      <VerificationPanel mission={mission} dash={dash} index={index} onOpen={setOpen} />
      {open && <EvidenceDialog mission={mission} e={open} index={index} onOpen={setOpen} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

function ExecutiveSummary({ dash, onOpen }: { dash: Dashboard; onOpen: Open }) {
  const { conclusion } = dash;
  return (
    <section className="card hero-card dash-summary" aria-labelledby="dash-exec">
      <div className="dash-summary-top">
        <h2 className="eyebrow" id="dash-exec">
          Executive summary
        </h2>
        <div className="dash-tags">
          <Badge tone={dash.dataSource === "fixture" ? "warning" : "accent"}>{dash.dataSource === "fixture" ? "Offline fixture data" : "Live web capture"}</Badge>
          <Badge tone={dash.analysisBy === "claude" ? "accent" : "neutral"}>{dash.analysisBy === "claude" ? "Analysis: Claude, evidence-cited" : "Analysis: rule-based, no AI"}</Badge>
          {dash.capturedAt && <span className="dash-meta">Captured {new Date(dash.capturedAt).toLocaleString()}</span>}
        </div>
      </div>
      <div className="dash-objective">
        <span className="dash-label">Objective</span>
        <p>{dash.objective}</p>
      </div>

      <div className="dash-label">Key findings from captured pages</div>
      {dash.findings.length ? (
        <ol className="findings">
          {dash.findings.map((f) => (
            <li key={f.evidence.obsId}>
              <div className="finding-text">{f.text}</div>
              <div className="finding-meta">
                <a className="mono" href={f.evidence.sourceUrl} target="_blank" rel="noreferrer noopener">
                  {host(f.evidence.sourceUrl ?? "")}
                </a>
                <Badge tone={CHECK_LABEL[f.evidence.check].tone}>{CHECK_LABEL[f.evidence.check].label}</Badge>
                <EvidenceButton e={f.evidence} onOpen={onOpen} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="unknown">No finding could be backed by a quoted excerpt from a captured page, so none is shown.</p>
      )}

      <div className="dash-cols">
        <div>
          <div className="dash-label">Limitations and open questions</div>
          <ul className="limitations">
            {dash.limitations.map((l) => (
              <li key={l}>
                <AlertTriangle size={14} aria-hidden />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={`conclusion by-${conclusion.by}`}>
          <div className="dash-label">
            Conclusion
            {conclusion.by === "claude" ? (
              <Badge tone="accent" icon={Bot}>
                AI-generated by Claude · inference
              </Badge>
            ) : (
              <Badge tone="neutral">Rule-based · computed from the record</Badge>
            )}
          </div>
          <p>{conclusion.text}</p>
        </div>
      </div>
    </section>
  );
}

function CompetitorCards({ mission, cards, onOpen }: { mission: Mission; cards: CompetitorCard[]; onOpen: Open }) {
  return (
    <section className="card" aria-label="Competitors">
      <SectionTitle count={cards.length}>Competitors</SectionTitle>
      <div className="comp-grid">
        {cards.map((c) => {
          const self = c.description ?? c.headline;
          return (
            <article key={c.targetId} className={`comp-card status-${c.status}`} data-testid="competitor-card">
              <div className="comp-shot">
                {c.screenshotFile ? <img src={fileUrl(mission.id, c.screenshotFile)} alt={`Captured page of ${c.name}`} loading="lazy" /> : <ImageIcon size={20} aria-label="No screenshot captured" />}
              </div>
              <div className="comp-body">
                <div className="comp-head">
                  <h4>{c.name}</h4>
                  <Badge tone={STATUS_BADGE[c.status].tone}>{STATUS_BADGE[c.status].label}</Badge>
                </div>
                <a className="mono comp-url" href={c.primaryUrl} target="_blank" rel="noreferrer noopener">
                  {host(c.primaryUrl)}
                </a>
                <div className="comp-pages">
                  {c.pagesCaptured} of {c.pagesAttempted} pages captured
                </div>
                {self ? (
                  <p className="comp-desc">
                    “{self.value}” <EvidenceButton e={self} onOpen={onOpen} />
                  </p>
                ) : (
                  <p className="unknown">{c.status === "inaccessible" ? "Unknown: no page captured." : "No description found on captured pages."}</p>
                )}
                <dl className="comp-facts">
                  <dt>Pricing</dt>
                  <dd>
                    <PricingSummary p={c.pricing} />
                  </dd>
                  <dt>Stated features</dt>
                  <dd>{c.features.length ? `${c.features.length} vendor headings quoted` : <span className="unknown">None captured</span>}</dd>
                  <dt>Audience</dt>
                  <dd>
                    {c.audiences.length ? (
                      <>
                        {c.audiences.map((a) => a.value).join(", ")} <Badge tone="info">Inferred</Badge>
                      </>
                    ) : (
                      <span className="unknown">Unknown</span>
                    )}
                  </dd>
                </dl>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PricingSummary({ p }: { p: PricingCell }) {
  if (p.state === "inaccessible") return <span className="unknown">Unknown: source inaccessible</span>;
  if (p.state === "not_found") return <span className="unknown">No price on captured pages{p.freeOption ? " · free option shown" : ""}</span>;
  return (
    <>
      {p.prices.length} displayed {p.prices.length === 1 ? "price" : "prices"}
      {p.freeOption && " · free option shown"}
    </>
  );
}

function FeatureMatrix({ dash, onOpen }: { dash: Dashboard; onOpen: Open }) {
  const cards = dash.cards;
  return (
    <section className="card" aria-label="Feature comparison">
      <SectionTitle count={dash.features.length}>Feature comparison</SectionTitle>
      <p className="dash-note">
        Rows are feature headings quoted from vendor pages. A tick means the heading appears on that competitor's captured pages. A dash means it was not seen there, which does not mean the product lacks it.
      </p>
      {dash.features.length ? (
        <div className="table-wrap">
          <table className="table matrix">
            <thead>
              <tr>
                <th scope="col">Vendor-stated feature</th>
                {cards.map((c) => (
                  <th key={c.targetId} scope="col">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dash.features.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className="cell-strong">
                    {r.label}
                  </th>
                  {cards.map((c) => {
                    const e = r.cells[c.targetId];
                    return (
                      <td key={c.targetId} className="matrix-cell">
                        {e ? (
                          <button type="button" className="matrix-hit" onClick={() => onOpen(e)} aria-label={`${c.name} states “${e.value}”. Show evidence`} title={e.excerpt}>
                            <Check size={14} aria-hidden />
                            Stated
                          </button>
                        ) : c.status === "inaccessible" ? (
                          <span className="unknown">Unknown</span>
                        ) : (
                          <span className="matrix-miss" aria-label="Not seen on captured pages">
                            <Minus size={14} aria-hidden />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="unknown">No feature headings were captured.</p>
      )}
    </section>
  );
}

function PricingTable({ cards, onOpen }: { cards: CompetitorCard[]; onOpen: Open }) {
  const anyPlans = cards.some((c) => c.pricing.plans.length > 0);
  return (
    <section className="card" aria-label="Pricing">
      <SectionTitle>Publicly displayed pricing</SectionTitle>
      <p className="dash-note">Prices are copied as the captured page displays them. Missing pricing is shown as missing, never as free or $0.</p>
      <div className="table-wrap">
        <table className="table pricing">
          <thead>
            <tr>
              <th scope="col">Competitor</th>
              <th scope="col">Pricing status</th>
              <th scope="col">Displayed prices</th>
              <th scope="col">Free option</th>
              {anyPlans && <th scope="col">Plans read from screenshot</th>}
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => {
              const p = c.pricing;
              return (
                <tr key={c.targetId} data-pricing-state={p.state}>
                  <th scope="row" className="cell-strong">
                    {c.name}
                  </th>
                  <td>
                    {p.state === "prices" ? (
                      <Badge tone="success">Prices displayed</Badge>
                    ) : p.state === "not_found" ? (
                      <Badge tone="warning">Not found</Badge>
                    ) : (
                      <Badge tone="danger">Source inaccessible</Badge>
                    )}
                  </td>
                  <td>
                    {p.prices.length ? (
                      <div className="price-list">
                        {p.prices.map((x) => (
                          <button key={x.obsId} type="button" className="price price-btn" onClick={() => onOpen(x)} title={x.excerpt} aria-label={`${c.name} price ${x.value}. Show evidence`}>
                            {x.value}
                          </button>
                        ))}
                        {p.zeroPrices.length > 0 && <span className="cell-sub">$0 amounts are shown exactly as the page displays them.</span>}
                      </div>
                    ) : (
                      <span className="unknown">{p.state === "inaccessible" ? "Unknown: no page captured" : "No price displayed on captured pages. Missing, not $0."}</span>
                    )}
                  </td>
                  <td>
                    {p.freeOption ? (
                      <span className="free-line">
                        “{p.freeOption.excerpt ?? p.freeOption.value}” <EvidenceButton e={p.freeOption} onOpen={onOpen} />
                      </span>
                    ) : (
                      <span className="muted">{p.state === "inaccessible" ? "Unknown" : "None seen"}</span>
                    )}
                  </td>
                  {anyPlans && (
                    <td>
                      {p.plans.length ? (
                        <ul className="plan-list">
                          {p.plans.map((x) => (
                            <li key={x.obsId}>
                              <span>{x.value}</span> <EvidenceButton e={x} onOpen={onOpen} label="Basis" />
                            </li>
                          ))}
                          <li>
                            <Badge tone="info" icon={Bot}>
                              Claude vision · needs review
                            </Badge>
                          </li>
                        </ul>
                      ) : (
                        <span className="muted">None read</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VerificationPanel({ mission, dash, index, onOpen }: { mission: Mission; dash: Dashboard; index: Map<string, Evidence>; onOpen: Open }) {
  const v = dash.verification;
  const review = mission.observations.filter((o) => o.check === "needs_review").map((o) => index.get(o.id)!);
  const gaps = (mission.analysis as Analysis | undefined)?.gaps ?? [];
  const checksTotal = v.checksPassed + v.checksFailed + v.checksWarned;
  return (
    <section className="card" aria-label="Verification">
      <SectionTitle>Verification transparency</SectionTitle>
      <div className="stat-grid">
        <Stat label="Pages captured" value={`${v.pagesCaptured}/${v.pagesAttempted}`} tone={v.pagesCaptured < v.pagesAttempted ? "warning" : "success"} sub={v.pagesCaptured < v.pagesAttempted ? `${v.pagesAttempted - v.pagesCaptured} not captured` : "all captured"} />
        <Stat label="Artifacts verified" value={`${v.artifactsVerified}/${v.artifactsTotal}`} tone={v.artifactsVerified < v.artifactsTotal ? "warning" : "success"} sub="read back from disk" />
        <Stat label="Artifact checks passed" value={`${v.checksPassed}/${checksTotal}`} tone={v.checksFailed ? "danger" : v.checksWarned ? "warning" : "success"} sub={`${v.checksFailed} failed · ${v.checksWarned} warnings`} />
        <Stat label="Quotes re-matched" value={`${v.observationsGrounded}/${v.observationsTotal}`} tone={v.observationsUngrounded ? "danger" : undefined} sub={`${v.observationsUngrounded} not re-matched`} />
        <Stat label="Unresolved review items" value={v.needsReview + gaps.length} tone="info" sub={`${v.needsReview} inferences · ${gaps.length} market gaps`} />
        {v.vision && (
          <Stat
            label="Screenshot readings kept"
            value={`${v.vision.kept}/${v.vision.kept + v.vision.discarded}`}
            tone="info"
            sub={`${v.vision.pagesRead} screenshots · Claude vision${v.vision.failed ? ` · ${v.vision.failed} failed` : ""}${v.vision.costUsd !== undefined ? ` · about $${v.vision.costUsd.toFixed(3)}` : ""}`}
          />
        )}
      </div>
      <div className="callout subtle integrity" role="note">
        <ShieldCheck size={15} aria-hidden />
        <span>
          <strong>What these checks mean.</strong> {INTEGRITY_DISCLAIMER} Inferences and market gaps are heuristics until a person reviews them.
          {v.vision && " A screenshot reading is kept only when its plan name and price both appear in the captured page text; readings that fail that check are discarded."}
        </span>
      </div>
      {(review.length > 0 || gaps.length > 0) && (
        <details className="review-items">
          <summary>Show the {review.length + gaps.length} unresolved review items</summary>
          <ul>
            {review.map((e) => (
              <li key={e.obsId}>
                <Badge tone="info">Inference</Badge>
                <span>
                  {e.targetName}: {e.field.replace(/_/g, " ")} “{e.value}”
                </span>
                <EvidenceButton e={e} onOpen={onOpen} label="Basis" />
              </li>
            ))}
            {gaps.map((g) => (
              <li key={g.id}>
                <Badge tone="info">Market gap</Badge>
                <span>{g.statement}</span>
                <span className="cell-sub">
                  {g.by === "claude" ? "Claude" : "rules"} · {g.confidence} confidence · {g.basis.length} observations
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function EvidenceDialog({ mission, e, index, onOpen, onClose }: { mission: Mission; e: Evidence; index: Map<string, Evidence>; onOpen: Open; onClose(): void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), [e.obsId]);
  const basis = e.basis.map((id) => index.get(id)).filter((x): x is Evidence => Boolean(x));
  const check = CHECK_LABEL[e.check];
  return (
    <div className="ev-backdrop" onClick={onClose}>
      <div
        className="ev-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ev-title"
        onClick={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          if (ev.key === "Escape") {
            ev.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="ev-head">
          <div>
            <div className="eyebrow">
              {e.targetName} · {e.field.replace(/_/g, " ")}
            </div>
            <h3 id="ev-title">{e.value}</h3>
          </div>
          <button ref={close} type="button" className="icon-btn" onClick={onClose} aria-label="Close evidence">
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="ev-badges">
          <KindBadge e={e} />
          <Badge tone={check.tone}>{check.label}</Badge>
          <span className="cell-sub">{e.method}</span>
        </div>
        {e.checkNote && <div className="cell-sub">{e.checkNote}</div>}
        {e.check === "ungrounded" && (
          <div className="callout warn-inline" role="alert">
            <AlertTriangle size={15} aria-hidden />
            <span>This value could not be re-matched against the stored capture. Treat it as unsupported.</span>
          </div>
        )}
        {e.kind === "inference" && (
          <div className="callout subtle">
            <Info size={15} aria-hidden />
            <span>
              This is a heuristic inference, not a vendor statement.{" "}
              {basis.length ? `It rests on the ${basis.length} observations listed below` : e.sourceUrl ? "It comes from keyword matches on the source page below" : "No observation is recorded behind it"}, and it needs human review.
            </span>
          </div>
        )}
        {e.sourceUrl ? (
          <dl className="ev-facts">
            <dt>Source</dt>
            <dd>
              <a className="mono" href={e.sourceUrl} target="_blank" rel="noreferrer noopener">
                {e.sourceUrl} <ExternalLink size={12} aria-hidden />
              </a>
            </dd>
            {e.pageTitle && (
              <>
                <dt>Page title</dt>
                <dd>{e.pageTitle}</dd>
              </>
            )}
            {e.capturedAt && (
              <>
                <dt>Captured</dt>
                <dd>{new Date(e.capturedAt).toLocaleString()}</dd>
              </>
            )}
          </dl>
        ) : (
          !basis.length && <p className="unknown">No source is recorded for this item.</p>
        )}
        {e.excerpt && (
          <blockquote className="ev-quote">
            <span className="dash-label">Captured excerpt</span>“{e.excerpt}”
          </blockquote>
        )}
        {basis.length > 0 && (
          <div>
            <div className="dash-label">Based on</div>
            <ul className="ev-basis">
              {basis.map((b) => (
                <li key={b.obsId}>
                  <button type="button" className="link-btn" onClick={() => onOpen(b)}>
                    {b.targetName}: {b.field.replace(/_/g, " ")} “{b.value.length > 90 ? `${b.value.slice(0, 89)}…` : b.value}”
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(e.screenshotFile || e.textFile) && (
          <div className="ev-capture">
            {e.screenshotFile && (
              <a href={fileUrl(mission.id, e.screenshotFile)} target="_blank" rel="noreferrer" className="ev-shot">
                <img src={fileUrl(mission.id, e.screenshotFile)} alt={`Screenshot of the captured page ${e.pageTitle ?? e.sourceUrl ?? ""}`} loading="lazy" />
              </a>
            )}
            {e.textFile && (
              <a className="btn btn-secondary btn-sm" href={fileUrl(mission.id, e.textFile)} target="_blank" rel="noreferrer">
                <FileText size={14} aria-hidden />
                <span>Open captured page text</span>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
