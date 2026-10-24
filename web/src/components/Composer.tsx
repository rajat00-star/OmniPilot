import { useState } from "react";
import { ArrowUp, Cpu, FileSpreadsheet, LayoutTemplate, Search, Sparkles } from "lucide-react";
import type { Health } from "../lib/api";
import { Button } from "./ui";

const SIGNATURE =
  "Research five competing AI products. Find their official product descriptions and publicly displayed pricing. Compare their positioning, target audiences, and differentiators. Identify potential market gaps, create a structured competitor-analysis CSV, write an evidence-backed research report, and generate a landing-page concept for my hypothetical product. Verify every generated artifact and show me the evidence.";

const EXAMPLES = [
  { icon: Sparkles, title: "Signature mission", body: "Five AI products: pricing, positioning, gaps, CSV, report and landing page", prompt: SIGNATURE },
  {
    icon: FileSpreadsheet,
    title: "Named competitors",
    body: "Claude, Microsoft Copilot and GitHub Copilot, with displayed pricing",
    prompt:
      "Research Claude, Microsoft Copilot and GitHub Copilot. Find official product descriptions and publicly displayed pricing, compare positioning, target audiences and differentiators, identify market gaps, create a competitor-analysis CSV, write an evidence-backed report and generate a landing-page concept. Verify every artifact.",
  },
  {
    icon: Search,
    title: "Your own URLs",
    body: "Compare any public pages you paste in",
    prompt: "Compare these products and create a competitor-analysis CSV and an evidence-backed report: https://claude.com/pricing https://github.com/features/copilot/plans",
  },
  {
    icon: LayoutTemplate,
    title: "Coding assistants",
    body: "Three AI coding tools, CSV and report only",
    prompt: "Research three AI coding assistants. Capture official descriptions and displayed pricing, then create a competitor-analysis CSV and a research report with evidence.",
  },
];

interface Props {
  health?: Health;
  busy: boolean;
  error?: string;
  onSubmit(prompt: string, productName: string, productPitch: string): void;
}

export function Composer({ health, busy, error, onSubmit }: Props) {
  const [prompt, setPrompt] = useState("");
  const [productName, setProductName] = useState("");
  const [pitch, setPitch] = useState("");
  const canSubmit = prompt.trim().length >= 8 && !busy;
  const submit = () => canSubmit && onSubmit(prompt.trim(), productName.trim(), pitch.trim());

  return (
    <div className="composer-wrap">
      <div className="composer-hero">
        <div className="eyebrow">New mission</div>
        <h1>What should OmniPilot do?</h1>
        <p className="lede">
          Describe the outcome. OmniPilot drafts a plan for your approval, operates a real browser on public pages, writes the files, and verifies every one of them
          before reporting back.
        </p>
      </div>

      <div className="composer">
        <label htmlFor="mission-prompt" className="sr-only">
          Mission instruction
        </label>
        <textarea
          id="mission-prompt"
          value={prompt}
          placeholder="e.g. Research five competing AI products, compare their pricing and positioning, and write a verified report…"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={5}
          autoFocus
        />
        <div className="composer-fields">
          <input aria-label="Your product name (optional)" placeholder="Your product name (optional)" value={productName} maxLength={60} onChange={(e) => setProductName(e.target.value)} />
          <input aria-label="One-line pitch (optional)" placeholder="One-line pitch for the landing page (optional)" value={pitch} maxLength={400} onChange={(e) => setPitch(e.target.value)} />
        </div>
        <div className="composer-bar">
          <div className="mode-note">
            {health?.reasoning.mode === "claude" ? <Sparkles size={14} aria-hidden /> : <Cpu size={14} aria-hidden />}
            {health?.reasoning.mode === "claude"
              ? `Claude plans and synthesizes (${health.reasoning.model}). Every claim must cite captured evidence.`
              : "Deterministic mode: real browsing and verification; planning and analysis are rule-based, not AI."}
          </div>
          <span className="kbd-hint">Ctrl ↵</span>
          <Button variant="primary" icon={ArrowUp} onClick={submit} disabled={!canSubmit} loading={busy}>
            Draft plan
          </Button>
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="examples">
        <div className="side-label">Suggested missions</div>
        <div className="example-grid">
          {EXAMPLES.map((ex) => (
            <button key={ex.title} className="example" onClick={() => setPrompt(ex.prompt)}>
              <ex.icon size={16} aria-hidden />
              <span className="example-title">{ex.title}</span>
              <span className="example-body">{ex.body}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
