import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileSearch, ImageIcon, Info, Lightbulb, XCircle } from "lucide-react";
import type { Analysis, Mission, Observation } from "../lib/api";
import { fileUrl } from "../lib/api";
import { bytes, clock, host } from "../lib/format";
import { Badge, Empty, SectionTitle, Stat } from "./ui";

function VerBadge({ v }: { v: string }) {
  if (v === "passed") return <Badge tone="success" icon={CheckCircle2}>Verified</Badge>;
  if (v === "failed") return <Badge tone="danger" icon={XCircle}>Failed checks</Badge>;
  if (v === "warning") return <Badge tone="warning" icon={AlertTriangle}>Warnings</Badge>;
  return <Badge>Unverified</Badge>;
}

export function ResultsView({ mission }: { mission: Mission }) {
  const a = mission.analysis as Analysis | undefined;
  const s = mission.summary;
  if (!a && !mission.artifacts.length) {
    return (
      <Empty icon={FileSearch} title="No results yet">
        Results appear once evidence has been collected and analysed.
      </Empty>
    );
  }
  const obs = (id?: string) => mission.observations.find((o) => o.id === id);
  const srcIndex = new Map(mission.sources.filter((x) => x.ok).map((x, i) => [x.id, i + 1]));
  const cite = (id?: string) => {
    const o = obs(id);
    const n = o?.sourceId ? srcIndex.get(o.sourceId) : undefined;
    return n ? (
      <a className="cite-ref" href={`#src-${n}`} title={`${o!.sourceUrl}\n“${o!.excerpt ?? ""}”`}>
        S{n}
      </a>
    ) : null;
  };

  return (
    <div className="results">
      <section className="card hero-card">
        <div className="eyebrow">Executive summary</div>
        <p className="summary-text">{mission.finalSummary ?? "Mission still in progress. Figures below update as steps complete."}</p>
        {s && (
          <div className="stat-grid">
            <Stat label="Sources captured" value={`${s.sourcesCaptured}/${s.sourcesAttempted}`} tone={s.sourcesFailed ? "warning" : "success"} sub={s.sourcesFailed ? `${s.sourcesFailed} failed` : "all captured"} />
            <Stat label="Descriptions found" value={`${s.descriptionsFound}/${s.targetsTotal}`} />
            <Stat label="Displayed prices" value={`${s.pricesFound}/${s.targetsTotal}`} sub={`${s.pricesUnavailable} unavailable`} tone={s.pricesUnavailable ? "warning" : undefined} />
            <Stat label="Observations grounded" value={`${s.observationsGrounded}/${s.observationsTotal}`} tone={s.observationsUngrounded ? "danger" : "success"} sub="re-matched on disk" />
            <Stat label="Need human review" value={s.claimsNeedingReview} sub="inferences" tone="info" />
            <Stat label="Artifact checks" value={`${s.checksPassed}/${s.checksPassed + s.checksFailed + s.checksWarned}`} tone={s.checksFailed ? "danger" : "success"} sub={s.checksFailed ? `${s.checksFailed} failed` : "passed"} />
          </div>
        )}
        {s && (
          <div className="callout subtle">
            <Info size={15} aria-hidden />
            <span>{s.integrityNote}</span>
          </div>
        )}
        {a && (
          <div className="mode-line">
            Analysis: {a.generatedBy === "claude" ? "Claude, evidence-cited" : "rule-based (deterministic mode, no AI reasoning)"}
            {a.rejectedModelClaims > 0 && ` · ${a.rejectedModelClaims} uncited model claims discarded`}
          </div>
        )}
      </section>

      <section className="card">
        <SectionTitle count={mission.artifacts.length}>Deliverables</SectionTitle>
        <div className="file-grid">
          {mission.artifacts.map((f) => (
            <div key={f.id} className="file">
              <div className="file-top">
                <span className="file-kind">{f.kind.toUpperCase()}</span>
                <VerBadge v={f.verification} />
              </div>
              <div className="file-name">{f.filename}</div>
              <div className="file-meta">
                {f.role} · {bytes(f.bytes)} · sha256 {f.sha256.slice(0, 10)}…
              </div>
              <div className="file-actions">
                <a className="btn btn-secondary btn-sm" href={fileUrl(mission.id, f.filename)} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} aria-hidden />
                  <span>Open</span>
                </a>
                <a className="btn btn-ghost btn-sm" href={fileUrl(mission.id, f.filename, true)}>
                  <Download size={14} aria-hidden />
                  <span>Download</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {a && (
        <section className="card">
          <SectionTitle count={a.profiles.length}>Competitor comparison</SectionTitle>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Competitor</th>
                  <th>Official description (observed)</th>
                  <th>Displayed pricing (observed)</th>
                  <th>Audience (inferred)</th>
                  <th>Positioning (inferred)</th>
                </tr>
              </thead>
              <tbody>
                {a.profiles.map((p) => (
                  <tr key={p.targetId}>
                    <td>
                      <div className="cell-strong">{p.name}</div>
                      <div className="cell-sub">
                        {p.status === "inaccessible" ? <Badge tone="danger">Inaccessible</Badge> : p.status === "partial" ? <Badge tone="warning">Partial</Badge> : <Badge tone="success">Captured</Badge>}
                      </div>
                    </td>
                    <td>{p.description ? <>“{p.description.value}” {cite(p.description.obsId)}</> : <span className="unknown">{p.status === "inaccessible" ? "Unknown" : "Not found"}</span>}</td>
                    <td>
                      {p.prices.length ? (
                        <div className="price-list">
                          {p.prices.slice(0, 6).map((x) => (
                            <span key={x.obsId} className="price" title={x.excerpt}>
                              {x.value}
                            </span>
                          ))}
                          {cite(p.prices[0].obsId)}
                        </div>
                      ) : (
                        <span className="unknown">{p.pricingStatus === "Source inaccessible" ? "Unknown" : "Not found"}</span>
                      )}
                    </td>
                    <td>{p.audiences.length ? p.audiences.map((x) => x.value).join(", ") : <span className="unknown">Unknown</span>}</td>
                    <td className="cell-sub-text">{p.positioning?.text ?? <span className="unknown">Unknown</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {a && (
        <section className="card">
          <SectionTitle count={a.gaps.length}>Potential market gaps</SectionTitle>
          {a.gaps.length === 0 && <div className="muted">No gaps could be inferred from the captured evidence.</div>}
          <ul className="gaps">
            {a.gaps.map((g) => (
              <li key={g.id}>
                <Lightbulb size={16} aria-hidden />
                <div>
                  <div className="gap-statement">{g.statement}</div>
                  <div className="gap-meta">
                    <Badge tone="info">Inferred</Badge>
                    <Badge tone={g.confidence === "medium" ? "accent" : "neutral"}>{g.confidence} confidence</Badge>
                    <span>
                      {g.by === "claude" ? "Claude" : "rules"} · based on {g.basis.length} observations
                    </span>
                  </div>
                  <div className="gap-rationale">{g.rationale}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <SectionTitle count={mission.sources.length}>Sources and citations</SectionTitle>
        <ol className="sources">
          {mission.sources.map((src) => {
            const n = srcIndex.get(src.id);
            return (
              <li key={src.id} id={n ? `src-${n}` : undefined} className={src.ok ? "" : "failed"}>
                <div className="src-thumb">
                  {src.screenshotFile ? <img src={fileUrl(mission.id, src.screenshotFile)} alt="" loading="lazy" /> : <ImageIcon size={18} aria-hidden />}
                </div>
                <div className="src-body">
                  <div className="src-top">
                    {n ? <span className="cite-ref static">S{n}</span> : <Badge tone="danger">Failed</Badge>}
                    <span className="src-target">{src.targetName}</span>
                    <span className="src-title">{src.title ?? host(src.requestedUrl)}</span>
                  </div>
                  <a className="src-url mono" href={src.finalUrl ?? src.requestedUrl} target="_blank" rel="noreferrer noopener">
                    {src.finalUrl ?? src.requestedUrl}
                  </a>
                  <div className="src-meta">
                    {src.ok ? (
                      <>
                        captured {clock(src.capturedAt)} · HTTP {src.httpStatus ?? "?"} · {src.textLength?.toLocaleString()} chars · sha256 {src.textSha256?.slice(0, 10)}…
                        {src.redirectChain.length > 0 && ` · ${src.redirectChain.length} redirect(s) validated`}
                        {src.textFile && (
                          <>
                            {" · "}
                            <a href={fileUrl(mission.id, src.textFile)} target="_blank" rel="noreferrer">
                              raw capture
                            </a>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="tone-danger-fg">{src.error}</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

const KIND_FILTERS = ["all", "observation", "inference", "unknown"] as const;

export function EvidenceView({ mission }: { mission: Mission }) {
  const [kind, setKind] = useState<(typeof KIND_FILTERS)[number]>("all");
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      mission.observations.filter(
        (o: Observation) => (kind === "all" || o.kind === kind) && (!q || `${o.targetName} ${o.field} ${o.value} ${o.excerpt ?? ""}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [mission.observations, kind, q],
  );
  if (!mission.observations.length) {
    return (
      <Empty icon={FileSearch} title="No evidence yet">
        Every value extracted from a page is recorded here with its source URL, capture time, excerpt and grounding status.
      </Empty>
    );
  }
  return (
    <div className="results">
      <section className="card">
        <div className="filters">
          {KIND_FILTERS.map((k) => (
            <button key={k} className={`chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>
              {k === "all" ? "All" : k[0].toUpperCase() + k.slice(1) + "s"}
              <span className="count">{k === "all" ? mission.observations.length : mission.observations.filter((o) => o.kind === k).length}</span>
            </button>
          ))}
          <input className="filter-input" placeholder="Filter evidence…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter evidence" />
        </div>
        <div className="table-wrap">
          <table className="table evidence">
            <thead>
              <tr>
                <th>Target</th>
                <th>Field</th>
                <th>Value</th>
                <th>Class</th>
                <th>Check</th>
                <th>Source and excerpt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="cell-strong">{o.targetName}</td>
                  <td>
                    <code>{o.field}</code>
                    <div className="cell-sub">{o.method}</div>
                  </td>
                  <td className="cell-value">{o.value}</td>
                  <td>
                    <Badge tone={o.kind === "observation" ? "success" : o.kind === "inference" ? "info" : "warning"}>{o.kind}</Badge>
                  </td>
                  <td>
                    <Badge tone={o.check === "grounded" ? "success" : o.check === "ungrounded" ? "danger" : o.check === "needs_review" ? "info" : "neutral"}>{o.check.replace("_", " ")}</Badge>
                    {o.checkNote && <div className="cell-sub">{o.checkNote}</div>}
                  </td>
                  <td className="cell-src">
                    {o.sourceUrl ? (
                      <>
                        <a className="mono" href={o.sourceUrl} target="_blank" rel="noreferrer noopener">
                          {host(o.sourceUrl)}
                        </a>
                        <span className="cell-sub"> · {clock(o.capturedAt)}</span>
                        {o.excerpt && <blockquote>“{o.excerpt}”</blockquote>}
                      </>
                    ) : o.basis?.length ? (
                      <span className="cell-sub">Derived from {o.basis.length} observations</span>
                    ) : (
                      <span className="cell-sub">No source</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function VerificationView({ mission }: { mission: Mission }) {
  if (!mission.checks.length) {
    return (
      <Empty icon={FileSearch} title="Verification has not run yet">
        After artifacts are written, each one is read back from disk, parsed, and checked for structure, coverage and citations. Quoted excerpts are re-matched against the stored page captures.
      </Empty>
    );
  }
  const byArtifact = new Map<string, typeof mission.checks>();
  for (const c of mission.checks) {
    const k = mission.artifacts.find((a) => a.id === c.artifactId)?.filename ?? "Evidence grounding and screenshots";
    byArtifact.set(k, [...(byArtifact.get(k) ?? []), c]);
  }
  const shot = mission.frames.find((f) => f.url.startsWith("artifact://"))?.screenshotFile;
  return (
    <div className="results">
      {[...byArtifact.entries()].map(([name, checks]) => (
        <section className="card" key={name}>
          <SectionTitle count={checks.length}>{name}</SectionTitle>
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.id} className={`check ${c.status}`}>
                {c.status === "passed" ? <CheckCircle2 size={15} aria-hidden /> : c.status === "failed" ? <XCircle size={15} aria-hidden /> : <AlertTriangle size={15} aria-hidden />}
                <span className="check-name">{c.name}</span>
                <span className="check-scope">{c.scope}</span>
                <span className="check-detail">{c.detail}</span>
              </li>
            ))}
          </ul>
          {name.endsWith(".html") && shot && (
            <figure className="render-shot">
              <img src={fileUrl(mission.id, shot)} alt="Offline render of the landing page concept" />
              <figcaption>Offline Chromium render captured by the verifier (network disabled, scripts disabled).</figcaption>
            </figure>
          )}
        </section>
      ))}
    </div>
  );
}
