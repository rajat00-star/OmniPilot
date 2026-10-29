import { prefs } from "./prefs";

/**
 * OmniPilot's sound: an original palette synthesized live with the Web Audio API. No audio files.
 *
 * The voice is a fictional operating system in D: sub-bass impacts, FM glass and bells, detuned pads that
 * open through a filter, and filtered-noise sweeps that move across the stereo field. Everything runs through
 * gentle saturation, a stereo echo, a long synthetic reverb and a limiter, at the viewer's master volume.
 *
 * Off until the viewer turns it on; the context starts inside that click (or the first gesture of a later visit
 * when sound was left on), so nothing ever autoplays. Each cue has a minimum gap, at most three overlap, and the
 * dramatic ones hold the stage for their length. Callers fire cues only from user actions and observed state
 * transitions, never from renders.
 */

export type Cue = "ready" | "activate" | "focus" | "ui" | "submit" | "plan" | "engage" | "milestone" | "success" | "warning" | "error" | "cancel";

const MIN_GAP_MS: Record<Cue, number> = {
  ready: 2500,
  activate: 2500,
  focus: 2500,
  ui: 120,
  submit: 700,
  plan: 800,
  engage: 900,
  milestone: 700,
  success: 2500,
  warning: 2500,
  error: 1200,
  cancel: 1000,
};

/** Cues that own the moment: lesser cues are skipped while one plays. */
const DRAMATIC: Partial<Record<Cue, true>> = { activate: true, ready: true, success: true, warning: true };

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const D2 = 38;

function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // A short pre-delay, then a bright onset that darkens as it decays.
      d[i] = t < 0.012 ? 0 : (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (ch ? 0.92 : 1);
    }
  }
  return buf;
}

function saturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

interface Bus {
  out: AudioNode;
  verb: AudioNode;
  echo: AudioNode;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: Bus | null = null;
  private noise: AudioBuffer | null = null;
  private grit: WaveShaperNode | null = null;
  private enabled = false;
  private calm = false;
  private last = new Map<Cue, number>();
  private active = 0;
  private holdUntil = 0;

  get available(): boolean {
    return typeof window !== "undefined" && typeof window.AudioContext === "function";
  }

  /** Creates or resumes the audio graph. Call from a user gesture. */
  async unlock(): Promise<boolean> {
    if (!this.available) return false;
    try {
      if (!this.ctx) this.build();
      if (this.ctx!.state !== "running") await this.ctx!.resume();
      return this.ctx!.state === "running";
    } catch {
      return false;
    }
  }

  private build() {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 10;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = this.level();
    master.connect(limiter);
    const warm = ctx.createWaveShaper();
    warm.curve = saturationCurve(1.4);
    warm.oversample = "2x";
    warm.connect(master);
    // Long synthetic hall.
    const verb = ctx.createConvolver();
    verb.buffer = impulseResponse(ctx, 3.2, 3.2);
    const verbIn = ctx.createGain();
    verbIn.gain.value = 0.5;
    verbIn.connect(verb);
    verb.connect(master);
    // Stereo echo: left and right taps at different times, filtered, feeding back.
    const echoIn = ctx.createGain();
    echoIn.gain.value = 0.35;
    const dl = ctx.createDelay(1);
    const dr = ctx.createDelay(1);
    dl.delayTime.value = 0.23;
    dr.delayTime.value = 0.34;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    const pl = ctx.createStereoPanner();
    const pr = ctx.createStereoPanner();
    pl.pan.value = -0.7;
    pr.pan.value = 0.7;
    echoIn.connect(dl);
    dl.connect(dr);
    dr.connect(tone);
    tone.connect(fb);
    fb.connect(dl);
    dl.connect(pl);
    dr.connect(pr);
    pl.connect(master);
    pr.connect(master);
    const grit = ctx.createWaveShaper();
    grit.curve = saturationCurve(6);
    grit.connect(warm);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    this.master = master;
    this.bus = { out: warm, verb: verbIn, echo: echoIn };
    this.noise = noise;
    this.grit = grit;
  }

  private level() {
    return Math.max(0, Math.min(1, prefs.get().volume)) * 0.9;
  }

  setVolume() {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on && this.ctx?.state === "running") this.ctx.suspend().catch(() => {});
  }

  /** Reduced motion: no stereo movement and softer impacts. */
  setCalm(calm: boolean) {
    this.calm = calm;
  }

  play(cue: Cue) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || ctx.state !== "running") return;
    const now = performance.now();
    if (now - (this.last.get(cue) ?? -Infinity) < MIN_GAP_MS[cue]) return;
    // While a signature plays, only automatic cues wait; anything the viewer did still answers.
    if (now < this.holdUntil && (cue === "plan" || cue === "milestone")) return;
    if (this.active >= 3) return;
    this.last.set(cue, now);
    const seconds = this.cue(cue);
    if (DRAMATIC[cue]) this.holdUntil = now + Math.min(seconds, 2.5) * 1000;
    this.active++;
    setTimeout(() => (this.active = Math.max(0, this.active - 1)), seconds * 1000);
  }

  /** Plays the whole palette once, spaced out, for the Settings preview. */
  preview(): number {
    const order: Cue[] = ["activate", "ui", "submit", "plan", "milestone", "engage", "success", "error", "cancel"];
    const gaps = [0, 3.2, 3.8, 5.0, 6.2, 7.2, 8.6, 12.0, 13.4];
    order.forEach((c, i) => setTimeout(() => {
      this.last.delete(c);
      this.holdUntil = 0;
      this.play(c);
    }, gaps[i] * 1000));
    return 14.6;
  }

  // ---------- building blocks ----------

  private t0(at = 0) {
    return this.ctx!.currentTime + 0.01 + at;
  }

  private route(node: AudioNode, gain: GainNode, opts: { pan?: number; panTo?: number; dur?: number; verb?: number; echo?: number; grit?: boolean }) {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    const start = ctx.currentTime;
    p.pan.setValueAtTime(this.calm ? 0 : (opts.pan ?? 0), start);
    if (opts.panTo !== undefined && !this.calm) p.pan.linearRampToValueAtTime(opts.panTo, start + (opts.dur ?? 0.5));
    node.connect(gain);
    gain.connect(p);
    p.connect(opts.grit ? this.grit! : this.bus!.out);
    const sends: AudioNode[] = [p];
    if (opts.verb) {
      const v = ctx.createGain();
      v.gain.value = opts.verb;
      p.connect(v);
      v.connect(this.bus!.verb);
      sends.push(v);
    }
    if (opts.echo) {
      const e = ctx.createGain();
      e.gain.value = opts.echo;
      p.connect(e);
      e.connect(this.bus!.echo);
      sends.push(e);
    }
    return sends;
  }

  private env(g: GainNode, at: number, attack: number, hold: number, release: number, peak: number) {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, at + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
    return at + attack + hold + release;
  }

  private tone(o: { f: number; to?: number; type?: OscillatorType; at?: number; attack?: number; hold?: number; release: number; peak: number; lp?: number; lpTo?: number; q?: number; detune?: number; pan?: number; panTo?: number; verb?: number; echo?: number; grit?: boolean }) {
    const ctx = this.ctx!;
    const at = this.t0(o.at);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.detune.value = o.detune ?? 0;
    osc.frequency.setValueAtTime(o.f, at);
    const span = (o.attack ?? 0.01) + (o.hold ?? 0) + o.release;
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, at + span * 0.8);
    const g = ctx.createGain();
    const end = this.env(g, at, o.attack ?? 0.01, o.hold ?? 0, o.release, o.peak);
    let src: AudioNode = osc;
    let f: BiquadFilterNode | null = null;
    if (o.lp) {
      f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = o.q ?? 0.8;
      f.frequency.setValueAtTime(o.lp, at);
      if (o.lpTo) f.frequency.exponentialRampToValueAtTime(o.lpTo, at + span * 0.7);
      osc.connect(f);
      src = f;
    }
    const sends = this.route(src, g, { pan: o.pan, panTo: o.panTo, dur: span, verb: o.verb, echo: o.echo, grit: o.grit });
    osc.onended = () => [osc, f, g, ...sends].forEach((n) => n?.disconnect());
    osc.start(at);
    osc.stop(end + 0.05);
    return end - ctx.currentTime;
  }

  /** Filtered noise: a sweep when the band moves, a click when it is short. */
  private sweep(o: { from: number; to: number; at?: number; attack: number; release: number; peak: number; q?: number; pan?: number; panTo?: number; verb?: number; echo?: number }) {
    const ctx = this.ctx!;
    const at = this.t0(o.at);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = o.q ?? 1.2;
    bp.frequency.setValueAtTime(o.from, at);
    bp.frequency.exponentialRampToValueAtTime(o.to, at + o.attack + o.release * 0.6);
    src.connect(bp);
    const g = ctx.createGain();
    const end = this.env(g, at, o.attack, 0, o.release, o.peak);
    const sends = this.route(bp, g, { pan: o.pan, panTo: o.panTo, dur: o.attack + o.release, verb: o.verb, echo: o.echo });
    src.onended = () => [src, bp, g, ...sends].forEach((n) => n.disconnect());
    src.start(at);
    src.stop(end + 0.05);
    return end - ctx.currentTime;
  }

  /** FM glass: bright on the strike, purer as the modulation fades. */
  private bell(o: { f: number; ratio?: number; index?: number; at?: number; release: number; peak: number; pan?: number; verb?: number; echo?: number }) {
    const ctx = this.ctx!;
    const at = this.t0(o.at);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const depth = ctx.createGain();
    car.frequency.value = o.f;
    mod.frequency.value = o.f * (o.ratio ?? 2);
    depth.gain.setValueAtTime(o.f * (o.index ?? 1.2), at);
    depth.gain.exponentialRampToValueAtTime(1, at + o.release * 0.55);
    mod.connect(depth);
    depth.connect(car.frequency);
    const g = ctx.createGain();
    const end = this.env(g, at, 0.003, 0, o.release, o.peak);
    const sends = this.route(car, g, { pan: o.pan, verb: o.verb ?? 0.6, echo: o.echo });
    car.onended = () => [car, mod, depth, g, ...sends].forEach((n) => n.disconnect());
    car.start(at);
    mod.start(at);
    car.stop(end + 0.05);
    mod.stop(end + 0.05);
    return end - ctx.currentTime;
  }

  /** Sub-bass impact: a falling sine with a transient, slightly driven. */
  private impact(o: { at?: number; f?: number; peak?: number }) {
    const k = this.calm ? 0.55 : 1;
    return Math.max(
      this.tone({ f: o.f ?? 92, to: 30, at: o.at, attack: 0.004, release: 0.9, peak: (o.peak ?? 0.5) * k, grit: true, verb: 0.15 }),
      this.sweep({ from: 2600, to: 400, at: o.at, attack: 0.002, release: 0.12, peak: 0.12 * k, q: 0.8 }),
    );
  }

  /** A detuned pad chord that opens through a filter. */
  private pad(o: { notes: number[]; at?: number; attack: number; hold: number; release: number; peak: number; lp: number; lpTo: number; verb?: number }) {
    let end = 0;
    o.notes.forEach((m, i) => {
      for (const d of [-9, 9]) {
        end = Math.max(end, this.tone({ f: hz(m), type: "sawtooth", detune: d, at: o.at, attack: o.attack, hold: o.hold, release: o.release, peak: o.peak, lp: o.lp, lpTo: o.lpTo, q: 0.6, pan: (i / Math.max(1, o.notes.length - 1)) * 1.2 - 0.6, verb: o.verb ?? 0.7 }));
      }
    });
    return end;
  }

  // ---------- the palette ----------

  private cue(c: Cue): number {
    switch (c) {
      case "ready":
      case "activate":
        // System activation: a sub swell and a rising noise bed, a minor-ninth chord opening, then the
        // awakening: glass notes climbing across the stereo field.
        return Math.max(
          this.tone({ f: hz(D2 - 12), to: hz(D2), attack: 1.2, hold: 0.4, release: 1.6, peak: 0.42, lp: 220, verb: 0.2 }),
          this.sweep({ from: 180, to: 5200, attack: 1.3, release: 0.5, peak: 0.12, q: 0.9, pan: -0.6, panTo: 0.6 }),
          this.pad({ notes: [D2 + 12, D2 + 19, D2 + 26, D2 + 27, D2 + 34], at: 0.7, attack: 0.9, hold: 0.6, release: 2.2, peak: 0.022, lp: 300, lpTo: 3200 }),
          ...[62, 65, 69, 72, 76, 81].map((m, i) => this.bell({ f: hz(m), ratio: 2.01, index: 1.4, at: 1.35 + i * 0.12, release: 1.4, peak: 0.05, pan: -0.7 + i * 0.28, echo: 0.4 })),
          this.impact({ at: 1.3, f: 70, peak: 0.32 }),
        );
      case "focus":
        return Math.max(this.sweep({ from: 6000, to: 6000, attack: 0.002, release: 0.03, peak: 0.08, q: 6 }), this.bell({ f: hz(88), ratio: 3.01, index: 0.4, release: 0.25, peak: 0.018, verb: 0.3 }));
      case "ui":
        return Math.max(this.sweep({ from: 3200, to: 2400, attack: 0.001, release: 0.035, peak: 0.1, q: 3 }), this.tone({ f: hz(74), attack: 0.002, release: 0.06, peak: 0.02 }));
      case "submit":
        // An energy sweep that crosses the stereo field and lands on an impact.
        return Math.max(
          this.sweep({ from: 300, to: 7000, attack: 0.55, release: 0.35, peak: 0.16, q: 1.4, pan: -0.8, panTo: 0.8, verb: 0.4 }),
          this.tone({ f: hz(50), to: hz(74), type: "triangle", attack: 0.5, release: 0.35, peak: 0.06, lp: 600, lpTo: 4000, pan: -0.4, panTo: 0.4 }),
          this.impact({ at: 0.55, f: 84, peak: 0.36 }),
        );
      case "plan":
        // Structures organising: three layered pulses rising, each a glass blip over a sub tick.
        return Math.max(
          ...[0, 0.13, 0.26].map((t, i) => this.bell({ f: hz(69 + i * 5), ratio: 1.5, index: 2.2, at: t, release: 0.35, peak: 0.045, pan: [-0.5, 0, 0.5][i], echo: 0.35 })),
          ...[0, 0.13, 0.26].map((t) => this.tone({ f: hz(D2 + 12), to: hz(D2), at: t, attack: 0.002, release: 0.12, peak: 0.16 })),
          this.pad({ notes: [D2 + 24, D2 + 31], at: 0.3, attack: 0.25, hold: 0.2, release: 1.2, peak: 0.016, lp: 500, lpTo: 2400 }),
        );
      case "engage":
        // Approval: the heaviest impact in the palette, with a metallic strike.
        return Math.max(
          this.impact({ f: 100, peak: 0.55 }),
          this.bell({ f: hz(57), ratio: 1.41, index: 3.5, release: 1.6, peak: 0.06, verb: 0.8 }),
          this.sweep({ from: 900, to: 160, attack: 0.01, release: 0.9, peak: 0.08, q: 0.7, pan: 0.6, panTo: -0.6, verb: 0.5 }),
        );
      case "milestone":
        // A real execution milestone: a short electronic pulse, placed somewhere new in the field each time.
        return Math.max(
          this.bell({ f: hz([74, 76, 79, 81][Math.floor(Math.random() * 4)]), ratio: 3.5, index: 1.6, release: 0.5, peak: 0.04, pan: Math.random() * 1.2 - 0.6, echo: 0.45 }),
          this.tone({ f: hz(D2 + 12), to: hz(D2 + 5), attack: 0.002, release: 0.14, peak: 0.14 }),
        );
      case "success":
        // The success signature: a rising arpeggio that blooms into a major-ninth chord over an impact.
        return Math.max(
          ...[62, 66, 69, 74, 78, 81, 86].map((m, i) => this.bell({ f: hz(m), ratio: 2, index: 1.1, at: i * 0.085, release: 1.2, peak: 0.045, pan: -0.6 + i * 0.2, echo: 0.3 })),
          this.pad({ notes: [D2 + 12, D2 + 19, D2 + 24, D2 + 28, D2 + 33], at: 0.55, attack: 0.08, hold: 0.7, release: 2.4, peak: 0.024, lp: 800, lpTo: 5200 }),
          this.impact({ at: 0.55, f: 76, peak: 0.42 }),
          this.sweep({ from: 1200, to: 9000, at: 0.5, attack: 0.05, release: 1.4, peak: 0.05, q: 0.6, verb: 0.6 }),
        );
      case "warning":
        // Complete, with warnings: the same climb, resolving to a suspended chord.
        return Math.max(
          ...[62, 66, 69, 74].map((m, i) => this.bell({ f: hz(m), ratio: 2, index: 1, at: i * 0.1, release: 1, peak: 0.04, pan: -0.4 + i * 0.25, echo: 0.3 })),
          this.pad({ notes: [D2 + 12, D2 + 19, D2 + 26, D2 + 31], at: 0.4, attack: 0.1, hold: 0.5, release: 2, peak: 0.02, lp: 700, lpTo: 2800 }),
          this.impact({ at: 0.4, f: 70, peak: 0.3 }),
        );
      case "error":
        // Short and distinct: a driven down-chirp and a dull thud. No alarm.
        return Math.max(
          this.tone({ f: 420, to: 150, type: "sawtooth", attack: 0.004, release: 0.32, peak: 0.07, lp: 1800, lpTo: 500, grit: true, verb: 0.25 }),
          this.tone({ f: 466, to: 160, type: "square", attack: 0.004, release: 0.26, peak: 0.025, lp: 1400, grit: true, at: 0.05 }),
          this.impact({ at: 0.02, f: 64, peak: 0.3 }),
        );
      case "cancel":
        // Recovery: a reversed swell that powers down.
        return Math.max(
          this.sweep({ from: 5000, to: 220, attack: 0.25, release: 0.45, peak: 0.08, q: 1, pan: 0.5, panTo: -0.5, verb: 0.4 }),
          this.tone({ f: hz(69), to: hz(57), type: "triangle", attack: 0.2, release: 0.4, peak: 0.04, lp: 2200, lpTo: 500 }),
        );
    }
  }
}

export const sound = new SoundEngine();
if (typeof window !== "undefined") {
  sound.setEnabled(prefs.get().sound);
  prefs.subscribe(() => {
    sound.setEnabled(prefs.get().sound);
    sound.setVolume();
  });
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  sound.setCalm(mq.matches);
  mq.addEventListener("change", () => sound.setCalm(mq.matches));
}

/** Turns sound on or off from a click, so the audio context can start, and plays the activation sequence. */
export async function toggleSound(on: boolean) {
  prefs.set({ sound: on });
  if (on && (await sound.unlock())) sound.play("activate");
}
