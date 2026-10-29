import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMedia, usePrefs } from "../../lib/prefs";
import type { ChamberRenderer as CoreRenderer, CoreMode } from "./chamber-renderer";

export type { CoreMode };
type Engine = "pending" | "webgl" | "css";

export interface CoreApi {
  setMode(mode: CoreMode): void;
  setProgress(fraction: number, steps: number, visible: boolean): void;
  /** A real mission event. */
  pulse(strength?: number): void;
  /** Typing in the composer. */
  impulse(strength?: number): void;
  celebrate(): void;
}

interface CoreCtx extends CoreApi {
  engine: Engine;
  register(el: HTMLElement): void;
  unregister(el: HTMLElement): void;
}

interface CoreView {
  mode: CoreMode;
  progress: number;
  steps: number;
  progressVisible: boolean;
}

const CoreContext = createContext<CoreCtx | null>(null);
const CoreViewContext = createContext<CoreView>({ mode: "idle", progress: 0, steps: 0, progressVisible: false });

const noop: CoreApi = { setMode() {}, setProgress() {}, pulse() {}, impulse() {}, celebrate() {} };

export function useCore(): CoreApi & { engine: Engine } {
  return useContext(CoreContext) ?? { ...noop, engine: "css" };
}

function lowPowerDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
}

/**
 * Owns the single core canvas. WebGL2 on capable desktops; a CSS rendition on phones, touch-first devices,
 * without WebGL2, after a lost context, or when the viewer chooses reduced effects in Settings.
 */
export function CoreProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const { effects } = usePrefs();
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const small = useMedia("(max-width: 760px), (pointer: coarse)");
  const [failed, setFailed] = useState(false);
  const [engine, setEngine] = useState<Engine>("pending");
  const [view, setView] = useState<CoreView>({ mode: "idle", progress: 0, steps: 0, progressVisible: false });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<CoreRenderer | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const latest = useRef(view);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const wantGL = enabled && effects === "full" && !small && !failed;

  useEffect(() => {
    if (!wantGL) {
      setEngine("css");
      return;
    }
    let cancelled = false;
    let r: CoreRenderer | null = null;
    setEngine("pending");
    import("./chamber-renderer")
      .then((mod) => {
        if (cancelled || !canvasRef.current) return;
        if (!mod.supportsWebGL2()) return setEngine("css");
        try {
          r = new mod.ChamberRenderer(canvasRef.current, { reducedMotion: reducedRef.current, lowPower: lowPowerDevice(), onContextLost: () => setFailed(true) });
        } catch {
          return setEngine("css");
        }
        renderer.current = r;
        const v = latest.current;
        r.setMode(v.mode);
        r.setProgress(v.progress, v.steps, v.progressVisible);
        r.setAnchor(anchor.current);
        setEngine("webgl");
      })
      .catch(() => !cancelled && setEngine("css"));
    return () => {
      cancelled = true;
      r?.dispose();
      renderer.current = null;
    };
  }, [wantGL]);

  useEffect(() => renderer.current?.setReducedMotion(reduced), [reduced]);

  const ctx = useMemo<CoreCtx>(() => {
    const orbs = () => (reducedRef.current ? [] : Array.from(document.querySelectorAll<HTMLElement>(".css-core-orb")));
    const update = (patch: Partial<CoreView>) => {
      latest.current = { ...latest.current, ...patch };
      setView(latest.current);
    };
    return {
      engine: "pending",
      setMode(mode) {
        if (latest.current.mode !== mode) update({ mode });
        renderer.current?.setMode(mode);
      },
      setProgress(progress, steps, progressVisible) {
        const v = latest.current;
        if (v.progress !== progress || v.steps !== steps || v.progressVisible !== progressVisible) update({ progress, steps, progressVisible });
        renderer.current?.setProgress(progress, steps, progressVisible);
      },
      pulse(strength = 0.7) {
        if (renderer.current) return renderer.current.pulse(strength);
        orbs().forEach((o) => o.animate([{ transform: "scale(1)" }, { transform: `scale(${1 + 0.06 * strength})` }, { transform: "scale(1)" }], { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }));
      },
      impulse(strength = 0.12) {
        renderer.current?.impulse(strength);
      },
      celebrate() {
        if (renderer.current) return renderer.current.celebrate();
        orbs().forEach((o) => o.animate([{ transform: "scale(1)", filter: "brightness(1)" }, { transform: "scale(1.14)", filter: "brightness(1.6)" }, { transform: "scale(1)", filter: "brightness(1)" }], { duration: 1100, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }));
      },
      register(el) {
        anchor.current = el;
        renderer.current?.setAnchor(el);
      },
      unregister(el) {
        if (anchor.current !== el) return;
        anchor.current = null;
        renderer.current?.setAnchor(null);
      },
    };
  }, []);

  const value = useMemo(() => ({ ...ctx, engine }), [ctx, engine]);

  return (
    <CoreContext.Provider value={value}>
      <CoreViewContext.Provider value={view}>
        {wantGL && <canvas ref={canvasRef} className="core-canvas" data-ready={engine === "webgl" || undefined} aria-hidden tabIndex={-1} />}
        {children}
      </CoreViewContext.Provider>
    </CoreContext.Provider>
  );
}

/** Marks where the core sits. The WebGL core is drawn behind this box; the CSS core renders inside it. */
export function CoreAnchor({ size, label }: { size: "hero" | "compact"; label: string }) {
  const ctx = useContext(CoreContext);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!ctx || !el) return;
    ctx.register(el);
    return () => ctx.unregister(el);
  }, [ctx]);
  return (
    <div ref={ref} className={`core-anchor ${size}`} data-core-size={size} role="img" aria-label={label}>
      {ctx?.engine === "css" && <CssCore />}
    </div>
  );
}

function CssCore() {
  const { mode, progress, progressVisible } = useContext(CoreViewContext);
  return (
    <div className="css-core" data-mode={mode} style={{ "--progress": progress } as CSSProperties}>
      <div className="css-core-halo" />
      <div className="css-core-rings">
        <span />
        <span />
        <span />
      </div>
      <div className="css-core-orb" />
      {progressVisible && <div className="css-core-progress" />}
    </div>
  );
}
