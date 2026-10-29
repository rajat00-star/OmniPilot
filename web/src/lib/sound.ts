import { prefs } from "./prefs";

/**
 * Interface sound, synthesized with the Web Audio API: no audio files, nothing licensed.
 *
 * Off until the viewer turns it on. The AudioContext is created inside that click (or, when sound was left on,
 * inside the first click or key press of the visit), so autoplay rules are respected. Each cue has a minimum gap
 * and at most three cues overlap. Callers trigger cues from user actions and observed state transitions only.
 */

export type Cue = "ready" | "focus" | "submit" | "plan" | "engage" | "milestone" | "success" | "warning" | "error" | "cancel";

const MIN_GAP_MS: Record<Cue, number> = {
  ready: 1500,
  focus: 2500,
  submit: 600,
  plan: 800,
  engage: 800,
  milestone: 900,
  success: 2000,
  warning: 2000,
  error: 1200,
  cancel: 1000,
};

interface ToneOpts {
  f: number;
  to?: number;
  type?: OscillatorType;
  attack?: number;
  decay: number;
  peak: number;
  at?: number;
  lp?: number;
  lpTo?: number;
  wet?: number;
}

const NOTE = { C4s: 277.18, D4: 293.66, E4: 329.63, A4: 440, D5: 587.33, E5: 659.25, F5s: 739.99, A5: 880, C6: 1046.5, D6: 1174.66, E6: 1318.51, A6: 1760 };

function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private send: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = false;
  private last = new Map<Cue, number>();
  private active = 0;

  get available(): boolean {
    return typeof window !== "undefined" && typeof window.AudioContext === "function";
  }

  /** Creates or resumes the audio graph. Call from a user gesture. */
  async unlock(): Promise<boolean> {
    if (!this.available) return false;
    try {
      if (!this.ctx) {
        const ctx = new AudioContext({ latencyHint: "interactive" });
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.knee.value = 18;
        comp.ratio.value = 3.5;
        comp.attack.value = 0.004;
        comp.release.value = 0.2;
        const out = ctx.createGain();
        out.gain.value = 0.55;
        out.connect(comp);
        comp.connect(ctx.destination);
        const verb = ctx.createConvolver();
        verb.buffer = impulseResponse(ctx, 1.8, 2.6);
        const send = ctx.createGain();
        send.gain.value = 0.22;
        send.connect(verb);
        verb.connect(out);
        const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const nd = noise.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        this.ctx = ctx;
        this.out = out;
        this.send = send;
        this.noise = noise;
      }
      if (this.ctx.state !== "running") await this.ctx.resume();
      return this.ctx.state === "running";
    } catch {
      return false;
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on && this.ctx?.state === "running") this.ctx.suspend().catch(() => {});
  }

  play(cue: Cue) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || ctx.state !== "running") return;
    const now = performance.now();
    if (now - (this.last.get(cue) ?? -Infinity) < MIN_GAP_MS[cue]) return;
    if (this.active >= 3) return;
    this.last.set(cue, now);
    const seconds = this.cue(cue);
    this.active++;
    setTimeout(() => (this.active = Math.max(0, this.active - 1)), seconds * 1000);
  }

  private wire(node: AudioNode, gain: GainNode, wet = 0) {
    node.connect(gain);
    gain.connect(this.out!);
    if (wet > 0) {
      const w = this.ctx!.createGain();
      w.gain.value = wet;
      gain.connect(w);
      w.connect(this.send!);
      return w;
    }
    return null;
  }

  private tone(o: ToneOpts): number {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + 0.01 + (o.at ?? 0);
    const attack = o.attack ?? 0.01;
    const end = t0 + attack + o.decay;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + attack + o.decay * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    let src: AudioNode = osc;
    let filter: BiquadFilterNode | null = null;
    if (o.lp) {
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.7;
      filter.frequency.setValueAtTime(o.lp, t0);
      if (o.lpTo) filter.frequency.exponentialRampToValueAtTime(o.lpTo, end);
      osc.connect(filter);
      src = filter;
    }
    const w = this.wire(src, g, o.wet);
    osc.onended = () => [osc, filter, g, w].forEach((n) => n?.disconnect());
    osc.start(t0);
    osc.stop(end + 0.05);
    return end - ctx.currentTime;
  }

  private click(f: number, decay: number, peak: number, at = 0, q = 3): number {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + 0.01 + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    src.connect(bp);
    this.wire(bp, g);
    src.onended = () => [src, bp, g].forEach((n) => n.disconnect());
    src.start(t0);
    src.stop(t0 + decay + 0.02);
    return decay + at;
  }

  /** A soft FM bell: a sine carrier whose brightness fades as the modulation index decays. */
  private bell(f: number, ratio: number, index: number, decay: number, peak: number, at = 0, wet = 0.5): number {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + 0.01 + at;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const depth = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * ratio;
    depth.gain.setValueAtTime(f * index, t0);
    depth.gain.exponentialRampToValueAtTime(1, t0 + decay * 0.6);
    mod.connect(depth);
    depth.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    const w = this.wire(car, g, wet);
    car.onended = () => [car, mod, depth, g, w].forEach((n) => n?.disconnect());
    car.start(t0);
    mod.start(t0);
    car.stop(t0 + decay + 0.05);
    mod.stop(t0 + decay + 0.05);
    return decay + at;
  }

  /** Plays one cue and returns how long it lasts, in seconds. */
  private cue(c: Cue): number {
    const n = NOTE;
    switch (c) {
      case "ready":
        return Math.max(
          this.tone({ f: n.D4, attack: 0.25, decay: 1.4, peak: 0.05, wet: 0.5 }),
          this.tone({ f: n.A4, attack: 0.3, decay: 1.3, peak: 0.04, at: 0.06, wet: 0.5 }),
          this.tone({ f: n.F5s, type: "triangle", attack: 0.2, decay: 1.0, peak: 0.016, at: 0.18, lp: 2400, wet: 0.6 }),
          this.bell(n.D6, 2.01, 1.2, 0.9, 0.018, 0.32, 0.7),
        );
      case "focus":
        return Math.max(this.click(5200, 0.03, 0.045, 0, 4), this.tone({ f: n.E6, attack: 0.005, decay: 0.12, peak: 0.01, wet: 0.3 }));
      case "submit":
        return Math.max(
          this.tone({ f: 330, to: 660, type: "triangle", decay: 0.32, peak: 0.04, lp: 900, lpTo: 4200, wet: 0.35 }),
          this.click(2600, 0.04, 0.035, 0, 2),
          this.tone({ f: 990, decay: 0.25, peak: 0.014, at: 0.12, wet: 0.4 }),
        );
      case "plan":
        return Math.max(
          this.bell(n.D5, 2, 0.8, 0.5, 0.028, 0),
          this.bell(n.F5s, 2, 0.8, 0.5, 0.026, 0.08),
          this.bell(n.A5, 2, 0.8, 0.6, 0.024, 0.16),
          this.tone({ f: n.D4, attack: 0.12, decay: 0.9, peak: 0.022, wet: 0.5 }),
        );
      case "engage":
        return Math.max(
          this.tone({ f: 110, to: 55, decay: 0.35, peak: 0.07, attack: 0.005 }),
          this.tone({ f: n.A4, to: n.E5, type: "triangle", attack: 0.02, decay: 0.4, peak: 0.028, lp: 1200, lpTo: 5000, wet: 0.4, at: 0.03 }),
          this.click(1800, 0.08, 0.025, 0, 1.5),
        );
      case "milestone":
        return Math.max(this.bell(n.A5, 3.5, 1.6, 0.6, 0.026, 0, 0.5), this.bell(n.E6, 2, 0.6, 0.4, 0.011, 0.05, 0.5));
      case "success":
        return Math.max(
          this.tone({ f: n.D5, attack: 0.03, decay: 1.8, peak: 0.032, wet: 0.5 }),
          this.tone({ f: n.F5s, attack: 0.03, decay: 1.75, peak: 0.028, at: 0.05, wet: 0.5 }),
          this.tone({ f: n.A5, attack: 0.03, decay: 1.7, peak: 0.026, at: 0.1, wet: 0.5 }),
          this.tone({ f: n.D6, type: "triangle", attack: 0.03, decay: 1.4, peak: 0.014, at: 0.16, lp: 3000, wet: 0.6 }),
          this.bell(n.A6, 2, 1, 1.2, 0.013, 0.22, 0.7),
        );
      case "warning":
        return Math.max(
          this.tone({ f: n.D5, attack: 0.03, decay: 1.4, peak: 0.028, wet: 0.5 }),
          this.tone({ f: n.A5, attack: 0.03, decay: 1.3, peak: 0.024, at: 0.06, wet: 0.5 }),
          this.tone({ f: n.C6, type: "triangle", attack: 0.03, decay: 1.1, peak: 0.014, at: 0.12, lp: 2200, wet: 0.5 }),
        );
      case "error":
        return Math.max(
          this.tone({ f: n.E4, type: "triangle", decay: 0.28, peak: 0.038, lp: 1400, wet: 0.25 }),
          this.tone({ f: n.C4s, type: "triangle", decay: 0.42, peak: 0.036, lp: 1200, at: 0.16, wet: 0.25 }),
        );
      case "cancel":
        return this.tone({ f: 520, to: 260, decay: 0.35, peak: 0.028, lp: 1600, lpTo: 600, wet: 0.3 });
    }
  }
}

export const sound = new SoundEngine();
if (typeof window !== "undefined") {
  sound.setEnabled(prefs.get().sound);
  prefs.subscribe(() => sound.setEnabled(prefs.get().sound));
}

/** Turns sound on or off from a click, so the audio context can start, and confirms with the ready cue. */
export async function toggleSound(on: boolean) {
  prefs.set({ sound: on });
  if (on && (await sound.unlock())) sound.play("ready");
}
