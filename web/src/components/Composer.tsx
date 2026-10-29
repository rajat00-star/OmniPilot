import { useEffect, useId, useRef, useState } from "react";
import { m } from "motion/react";
import { ArrowRight, ChevronDown, Cpu, FlaskConical, Sparkles } from "lucide-react";
import type { Health } from "../lib/api";
import { fade, press, rise, sequence } from "../lib/motion";
import { sound } from "../lib/sound";
import { CoreAnchor, useCore } from "./core/OmniCore";
import { Orbit } from "./ui";

const SIGNATURE =
  "Research five competing AI products. Find their official product descriptions and publicly displayed pricing. Compare their positioning, target audiences, and differentiators. Identify potential market gaps, create a structured competitor-analysis CSV, write an evidence-backed research report, and generate a landing-page concept for my hypothetical product. Verify every generated artifact and show me the evidence.";

const EXAMPLES = [
  { title: "Signature mission", body: "Five AI products: pricing, positioning, gaps, CSV, report and landing page", prompt: SIGNATURE },
  {
    title: "Named competitors",
    body: "Claude, Microsoft Copilot and GitHub Copilot, with displayed pricing",
    prompt:
      "Research Claude, Microsoft Copilot and GitHub Copilot. Find official product descriptions and publicly displayed pricing, compare positioning, target audiences and differentiators, identify market gaps, create a competitor-analysis CSV, write an evidence-backed report and generate a landing-page concept. Verify every artifact.",
  },
  {
    title: "Your own URLs",
    body: "Compare any public pages you paste in",
    prompt: "Compare these products and create a competitor-analysis CSV and an evidence-backed report: https://claude.com/pricing https://github.com/features/copilot/plans",
  },
  {
    title: "Coding assistants",
    body: "Three AI coding tools, CSV and report only",
    prompt: "Research three AI coding assistants. Capture official descriptions and displayed pricing, then create a competitor-analysis CSV and a research report with evidence.",
  },
];

const MIN_LENGTH = 8;

interface Props {
  health?: Health;
  busy: boolean;
  error?: string;
  initialPrompt?: string;
  coreLabel: string;
  onFocusChange(focused: boolean): void;
  onSubmit(prompt: string, productName: string, productPitch: string): void;
}

/** The home screen: the core, one question, the composer, a few examples. */
export function Composer({ health, busy, error, initialPrompt = "", coreLabel, onFocusChange, onSubmit }: Props) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [productName, setProductName] = useState("");
  const [pitch, setPitch] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const ids = { hint: useId(), adv: useId(), mode: useId() };
  const glow = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const mountedAt = useRef(0);
  const core = useCore();
  const tooShort = prompt.trim().length < MIN_LENGTH;
  const showHint = touched && tooShort;
  const fixture = health?.dataSource === "fixture";

  useEffect(() => {
    mountedAt.current = performance.now();
    // autoFocus does not always fire a React focus event, so take the initial state from the DOM.
    if (document.activeElement === area.current) {
      setFocused(true);
      onFocusChange(true);
    }
    return () => onFocusChange(false);
  }, [onFocusChange]);

  const submit = () => {
    setTouched(true);
    if (tooShort || busy) {
      if (tooShort) area.current?.focus();
      return;
    }
    sound.play("submit");
    onSubmit(prompt.trim(), productName.trim(), pitch.trim());
  };

  const focusIn = () => {
    setFocused(true);
    onFocusChange(true);
    // Autofocus on arrival is not the viewer's action, so it stays silent.
    if (performance.now() - mountedAt.current > 800) sound.play("focus");
  };

  return (
    <m.div className="home" data-focused={focused || undefined} data-busy={busy || undefined} variants={sequence(0.08, 0.9)} initial="hidden" animate="show">
      {/* The identity: one word in light, letter by letter, layered over the chamber. Decorative. */}
      <div className="home-wordmark" aria-hidden>
        {"OMNIPILOT".split("").map((ch, i) => (
          <m.span
            key={i}
            initial={{ opacity: 0, y: "38%", scaleY: 1.35 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            transition={{ delay: 0.35 + i * 0.065, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          >
            {ch}
          </m.span>
        ))}
      </div>
      <ol className="chapters" aria-label="How a mission runs">
        {["Describe", "Plan", "Execute", "Verify"].map((c, i) => (
          <m.li
            key={c}
            className={i === (busy ? 1 : 0) ? "on" : ""}
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.1 + i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="chapter-num">{String(i + 1).padStart(2, "0")}</span>
            <span className="chapter-name">{c}</span>
          </m.li>
        ))}
      </ol>
      <m.div className="home-core" variants={fade}>
        <CoreAnchor size="hero" label={coreLabel} />
      </m.div>
      <m.p className="home-kicker" variants={rise}>
        Plan · Execute · Verify
      </m.p>
      <m.h1 variants={rise}>What should OmniPilot do for you?</m.h1>
      <m.p className="home-lede" variants={rise}>
        Describe the outcome you need. OmniPilot plans it, carries it out in a real browser, and verifies every result before it reports back.
      </m.p>

      <m.form
        variants={rise}
        className={`composer ${focused ? "focused" : ""} ${busy ? "busy" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        onFocus={(e) => (e.target as Node) === area.current && focusIn()}
        onBlur={(e) => {
          if ((e.target as Node) !== area.current) return;
          setFocused(false);
          onFocusChange(false);
          if (prompt) setTouched(true);
        }}
      >
        <div ref={glow} className="composer-glow" aria-hidden />
        <label htmlFor="mission-prompt" className="sr-only">
          Mission instruction
        </label>
        <textarea
          ref={area}
          id="mission-prompt"
          value={prompt}
          placeholder="Compare the pricing and positioning of five AI assistants, find the gaps, and give me a CSV and a cited report…"
          onChange={(e) => setPrompt(e.target.value)}
          onInput={() => {
            core.impulse(0.07);
            glow.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 650, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
          }}
          rows={3}
          autoFocus
          readOnly={busy}
          aria-invalid={showHint || undefined}
          aria-describedby={`${ids.hint} ${ids.mode}`}
        />
        <div className="composer-bar">
          <button type="button" className="adv-toggle" aria-expanded={advanced} aria-controls={ids.adv} onClick={() => setAdvanced((v) => !v)}>
            <ChevronDown size={14} aria-hidden className="chev" />
            Advanced settings
            {!advanced && (productName || pitch) && <span className="adv-dot" aria-label="(values set)" />}
          </button>
          <span className="kbd-hint" aria-hidden>
            <kbd>Ctrl</kbd>
            <kbd>↵</kbd>
          </span>
          <m.button type="submit" className="btn btn-primary btn-lg launch" whileTap={busy ? undefined : press} disabled={busy} aria-describedby={ids.hint}>
            {busy ? (
              <>
                <Orbit size={16} />
                <span>Planning…</span>
              </>
            ) : (
              <>
                <span>Create plan</span>
                <ArrowRight size={16} aria-hidden />
              </>
            )}
          </m.button>
        </div>
        <div id={ids.adv} className="adv-panel" hidden={!advanced}>
          <div className="field">
            <label htmlFor={`${ids.adv}-name`}>Your product name (optional)</label>
            <input id={`${ids.adv}-name`} placeholder="Used in the landing-page concept" value={productName} maxLength={60} onChange={(e) => setProductName(e.target.value)} />
          </div>
          <div className="field grow">
            <label htmlFor={`${ids.adv}-pitch`}>One-line pitch (optional)</label>
            <input id={`${ids.adv}-pitch`} placeholder="What your product does, in one sentence" value={pitch} maxLength={400} onChange={(e) => setPitch(e.target.value)} />
          </div>
        </div>
        <div id={ids.hint} className={`command-hint ${showHint ? "show" : ""}`} aria-live="polite">
          {showHint ? `Add a little more detail: at least ${MIN_LENGTH} characters.` : ""}
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
      </m.form>

      <m.div className="suggestions" role="group" aria-label="Example missions" variants={rise}>
        {EXAMPLES.map((ex, i) => (
          <button
            key={ex.title}
            type="button"
            className="suggestion"
            disabled={busy}
            onClick={() => {
              setPrompt(ex.prompt);
              core.pulse(0.35);
              area.current?.focus();
            }}
          >
            <span className="suggestion-idx" aria-hidden>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="suggestion-title">{ex.title}</span>
            <span className="suggestion-body">{ex.body}</span>
          </button>
        ))}
      </m.div>

      <m.p id={ids.mode} className="mode-note" variants={fade}>
        {health?.reasoning.mode === "claude" ? <Sparkles size={13} aria-hidden /> : fixture ? <FlaskConical size={13} aria-hidden /> : <Cpu size={13} aria-hidden />}
        {!health
          ? "Connecting to the OmniPilot server…"
          : health.reasoning.mode === "claude"
            ? `Claude plans and synthesizes (${health.reasoning.model}). Every claim must cite captured evidence.`
            : fixture
              ? "Offline demo: a real browser and real verification against fictional fixture sites. Planning and analysis are rule-based, not AI."
              : "Deterministic mode: real browsing and verification. Planning and analysis are rule-based, not AI."}
      </m.p>
    </m.div>
  );
}
