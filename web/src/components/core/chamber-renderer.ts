import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * The OmniPilot command chamber: one three.js scene behind the whole interface.
 *
 * A dark, fogged chamber lit by a single great halo behind a central intelligence structure: a glowing core,
 * three shells of a neural lattice whose pathways carry light, particles travelling those pathways, orbital rings,
 * monoliths rim-lit by the halo, a reflective floor with a fine grid, light shafts and drifting dust, all through
 * a bloom pass. Everything is procedural; there are no model, texture or video assets.
 *
 * It only eases toward targets set from real application state (mode, finished steps, activity events). It runs at
 * 30 fps when calm and 60 fps while something changes, stops while the tab is hidden, draws only on change under
 * reduced motion, lowers resolution and drops bloom on weaker devices, and disposes every GPU resource.
 */

export type CoreMode = "idle" | "focus" | "planning" | "review" | "executing" | "paused" | "verifying" | "success" | "warning" | "error" | "cancelled";

interface Knobs {
  energy: number;
  alert: number;
  organize: number;
  speed: number;
  warn: number;
  err: number;
  ok: number;
  dim: number;
  dolly: number;
}

const KNOBS: Record<CoreMode, Knobs> = {
  idle: { energy: 0.32, alert: 0, organize: 0.25, speed: 0.12, warn: 0, err: 0, ok: 0, dim: 0, dolly: 0 },
  focus: { energy: 0.5, alert: 1, organize: 0.4, speed: 0.18, warn: 0, err: 0, ok: 0, dim: 0, dolly: 0.55 },
  planning: { energy: 0.85, alert: 0.4, organize: 1, speed: 0.75, warn: 0, err: 0, ok: 0, dim: 0, dolly: 0.85 },
  review: { energy: 0.55, alert: 0, organize: 1, speed: 0.25, warn: 0, err: 0, ok: 0, dim: 0, dolly: 0.3 },
  executing: { energy: 0.9, alert: 0, organize: 1, speed: 0.6, warn: 0, err: 0, ok: 0, dim: 0, dolly: 0.45 },
  paused: { energy: 0.35, alert: 0, organize: 1, speed: 0.03, warn: 0.6, err: 0, ok: 0, dim: 0, dolly: 0.3 },
  verifying: { energy: 0.95, alert: 0, organize: 1, speed: 0.8, warn: 0, err: 0, ok: 0, dim: 0, dolly: 0.55 },
  success: { energy: 0.6, alert: 0, organize: 1, speed: 0.18, warn: 0, err: 0, ok: 1, dim: 0, dolly: 0 },
  warning: { energy: 0.55, alert: 0, organize: 1, speed: 0.16, warn: 0.45, err: 0, ok: 0.5, dim: 0, dolly: 0 },
  error: { energy: 0.28, alert: 0, organize: 0.5, speed: 0.04, warn: 0, err: 1, ok: 0, dim: 0, dolly: -0.2 },
  cancelled: { energy: 0.18, alert: 0, organize: 0.55, speed: 0.03, warn: 0, err: 0, ok: 0, dim: 0.65, dolly: -0.3 },
};
const KEYS = Object.keys(KNOBS.idle) as (keyof Knobs)[];

const CYAN = new THREE.Color(0x3fd8ff);
const ICE = new THREE.Color(0xbfe6ff);
const VIOLET = new THREE.Color(0x8f7dff);
const AMBER = new THREE.Color(0xffb35c);
const RED = new THREE.Color(0xff5470);
const TEAL = new THREE.Color(0x3ee6b0);

export function supportsWebGL2(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

export interface ChamberOptions {
  reducedMotion: boolean;
  lowPower: boolean;
  onContextLost(): void;
}

/** Seeded random, so the chamber is the same on every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(200,240,255,0.75)");
  grad.addColorStop(0.45, "rgba(63,216,255,0.22)");
  grad.addColorStop(1, "rgba(63,216,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const shared = {
  uTime: { value: 0 },
  uFlow: { value: 0 },
  uEnergy: { value: 0.3 },
  uOrganize: { value: 0.2 },
  uColA: { value: CYAN.clone() },
  uColB: { value: ICE.clone() },
  uColC: { value: VIOLET.clone() },
  uEnv: { value: 1 },
  uPixel: { value: 1 },
  uDrift: { value: 0 },
};

const LATTICE_VERT = /* glsl */ `
attribute float aT;
attribute float aSeed;
varying float vT;
varying float vSeed;
varying float vDepth;
void main() {
  vT = aT;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const LATTICE_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uFlow;
uniform float uEnergy;
uniform float uOrganize;
varying float vT;
varying float vSeed;
varying float vDepth;
void main() {
  float head = fract(uFlow * (0.25 + vSeed * 0.35) + vSeed * 7.0);
  float dd = fract(vT - head + 0.5) - 0.5;
  float pulse = exp(-dd * dd * 260.0) * step(0.55, fract(vSeed * 3.7));
  float base = mix(0.035, 0.14, uOrganize) * (0.55 + 0.45 * uEnergy);
  float a = base + pulse * (0.2 + 1.1 * uEnergy) * (0.35 + 0.65 * uOrganize);
  float fog = exp(-max(vDepth - 6.0, 0.0) * 0.08);
  gl_FragColor = vec4(mix(uColA, uColB, fract(vSeed * 5.1)) * a * fog, 1.0);
}`;

const NODE_VERT = /* glsl */ `
attribute float aSize;
attribute float aSeed;
uniform float uTime;
uniform float uEnergy;
uniform float uPixel;
varying float vSeed;
varying float vA;
void main() {
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.65 + 0.35 * sin(uTime * (0.6 + aSeed) + aSeed * 40.0);
  vA = tw * (0.45 + 0.55 * uEnergy) * exp(-max(-mv.z - 6.0, 0.0) * 0.06);
  gl_PointSize = aSize * uPixel * (60.0 / -mv.z) * (0.85 + 0.3 * uEnergy);
  gl_Position = projectionMatrix * mv;
}`;

const POINT_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
varying float vSeed;
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = (exp(-d * 5.0) + exp(-d * 24.0) * 0.8) * vA;
  vec3 col = mix(uColA, uColB, fract(vSeed * 7.3));
  if (fract(vSeed * 13.1) > 0.86) col = mix(col, uColC, 0.7);
  gl_FragColor = vec4(col * a, 1.0);
}`;

// Dust drifts slowly; when the system is working it streams toward the viewer, which reads as forward motion.
const DUST_VERT = /* glsl */ `
attribute float aSize;
attribute float aSeed;
uniform float uTime;
uniform float uDrift;
uniform float uPixel;
uniform float uEnv;
varying float vSeed;
varying float vA;
void main() {
  vSeed = aSeed;
  vec3 p = position;
  p.z = mod(p.z + 18.0 + uDrift * (0.6 + aSeed), 24.0) - 18.0;
  p.x += sin(uTime * 0.1 + aSeed * 30.0) * 0.3;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float tw = 0.6 + 0.4 * sin(uTime * (0.5 + aSeed) + aSeed * 40.0);
  vA = tw * 0.5 * uEnv * smoothstep(-18.0, -12.0, p.z) * (1.0 - smoothstep(3.0, 6.0, p.z));
  gl_PointSize = aSize * uPixel * (60.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FLOW_VERT = /* glsl */ `
attribute vec3 aEnd;
attribute float aSeed;
uniform float uFlow;
uniform float uEnergy;
uniform float uOrganize;
uniform float uPixel;
varying float vSeed;
varying float vA;
void main() {
  vSeed = aSeed;
  float t = fract(uFlow * (0.4 + aSeed * 0.6) + aSeed * 11.0);
  vec3 p = mix(position, aEnd, t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vA = sin(t * 3.14159) * (0.15 + 0.85 * uEnergy) * (0.3 + 0.7 * uOrganize);
  gl_PointSize = (1.6 + aSeed * 2.2) * uPixel * (60.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const CORE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vP = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const CORE_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform float uFlow;
uniform float uEnergy;
uniform float uFlash;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  float facing = max(dot(normalize(vN), vV), 0.0);
  float fres = pow(1.0 - facing, 2.4);
  vec3 p = normalize(vP);
  float w = sin(p.y * 9.0 + uFlow * 1.7 + sin(p.x * 5.0 + uFlow * 0.9) * 2.0) * sin(p.z * 7.0 - uFlow * 1.3);
  float bands = smoothstep(0.35, 1.0, w * 0.5 + 0.5);
  vec3 deep = vec3(0.01, 0.04, 0.12);
  vec3 col = mix(deep, mix(uColC, uColA, 0.6), bands * 0.85) * (0.35 + 0.9 * uEnergy);
  col += mix(uColA, vec3(1.0), 0.3) * pow(facing, 4.0) * (0.25 + 0.4 * uEnergy + uFlash);
  col += uColB * fres * (0.7 + 0.6 * uEnergy + uFlash);
  gl_FragColor = vec4(col, 1.0);
}`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uEnergy;
uniform float uEnv;
uniform float uFlare;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float rim = exp(-pow((d - 0.9) * 16.0, 2.0));
  float inner = smoothstep(1.0, 0.0, d);
  vec3 col = vec3(0.015, 0.04, 0.11) * inner * 1.2 + mix(uColA, uColB, 0.4) * rim * (0.32 + 0.25 * uEnergy + uFlare);
  col += uColA * pow(inner, 3.0) * 0.08 * (1.0 + uFlare * 3.0);
  gl_FragColor = vec4(col * uEnv, 1.0);
}`;

const UV_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vW = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GRID_FRAG = /* glsl */ `
uniform vec3 uColB;
uniform float uEnv;
uniform float uTravel;
uniform float uEnergy;
varying vec3 vW;
void main() {
  vec2 g = vW.xz * 0.9 + vec2(0.0, uTravel);
  vec2 gw = fwidth(g);
  vec2 l = abs(fract(g - 0.5) - 0.5) / max(gw, vec2(1e-4));
  float line = 1.0 - min(min(l.x, l.y), 1.0);
  float dist = length(vW.xz);
  float fade = exp(-dist * 0.09);
  float pool = exp(-dist * 0.35) * 0.5;
  gl_FragColor = vec4(uColB * line * (0.05 + pool * 0.25) * fade * (0.6 + 0.6 * uEnergy) * uEnv, 1.0);
}`;

const SHAFT_FRAG = /* glsl */ `
uniform vec3 uColB;
uniform float uEnergy;
uniform float uEnv;
varying vec2 vUv;
void main() {
  float a = pow(1.0 - vUv.y, 1.5) * smoothstep(0.0, 0.25, vUv.y) * (1.0 - abs(vUv.x - 0.5) * 1.6);
  gl_FragColor = vec4(uColB * max(a, 0.0) * 0.014 * (0.6 + 0.6 * uEnergy) * uEnv, 1.0);
}`;

const PROGRESS_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uProgress;
uniform float uSteps;
uniform float uVis;
varying vec2 vUv;
void main() {
  vec2 q = vUv - 0.5;
  float a01 = fract(atan(q.x, q.y) / 6.2831853 + 1.0);
  float steps = max(uSteps, 1.0);
  float sp = fract(a01 * steps);
  float gap = steps > 1.5 ? smoothstep(0.0, 0.06, sp) * smoothstep(1.0, 0.94, sp) : 1.0;
  float lit = step(a01, uProgress);
  vec3 col = mix(uColB * 0.18, uColA * 1.6, lit) * gap;
  gl_FragColor = vec4(col * uVis, 1.0);
}`;

const additive = (m: THREE.Material) => {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  return m;
};

export class ChamberRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private structure = new THREE.Group();
  private lattice = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private env = new THREE.Group();
  private envMaterials: THREE.Material[] = [];
  private coreMat: THREE.ShaderMaterial;
  private haloMat: THREE.ShaderMaterial;
  private gridMat: THREE.ShaderMaterial;
  private progressMat: THREE.ShaderMaterial;
  private progressMesh: THREE.Mesh;
  private shock: THREE.Mesh;
  private glow: THREE.Sprite;
  private coreLight: THREE.PointLight;
  private dust: THREE.Points;
  private glowTex: THREE.CanvasTexture;

  private reduced: boolean;
  private lowPower: boolean;
  private raf = 0;
  private lastDraw = 0;
  private lastFrame = 0;
  private runUntil = 0;
  private disposed = false;

  private mode: CoreMode = "idle";
  private cur: Knobs = { ...KNOBS.idle };
  private target: Knobs = { ...KNOBS.idle };
  private time = 0;
  private flow = 0;
  private spin = 0;
  private travel = 0;
  private intro = 0;
  private pulseAge = 1;
  private pulseStrength = 0;
  private burstAge = -1;
  private type = 0;
  private progress = 0;
  private progressTarget = 0;
  private steps = 0;
  private progVis = 0;
  private progVisTarget = 0;
  private sceneMix = 0;
  private pointer = new THREE.Vector2();
  private pointerTarget = new THREE.Vector2();
  private pointerUntil = 0;
  private anchor: HTMLElement | null = null;
  private glideUntil = 0;
  private view = { x: 0, y: 0, r: 100 };
  private hasView = false;
  private w = 1;
  private h = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: ChamberOptions,
  ) {
    this.reduced = opts.reducedMotion;
    this.lowPower = opts.lowPower;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x02040a, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.035);
    this.scene.background = new THREE.Color(0x02040a);
    this.glowTex = glowTexture();

    const r = rng(11);
    this.scene.add(this.structure, this.env);
    this.structure.add(this.lattice);

    // --- Neural lattice: three shells of nodes joined by light-carrying pathways ---
    const shells = [
      { r: 1.05, detail: 1 },
      { r: 1.7, detail: 2 },
      { r: 2.45, detail: 2 },
    ];
    const nodes: { p: THREE.Vector3; s: number }[] = [];
    for (let si = 0; si < shells.length; si++) {
      const g = new THREE.IcosahedronGeometry(shells[si].r, shells[si].detail);
      const pos = g.getAttribute("position");
      const seen = new Set<string>();
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        const k = v.toArray().map((n) => n.toFixed(3)).join();
        if (seen.has(k)) continue;
        seen.add(k);
        v.multiplyScalar(1 + (r() - 0.5) * 0.08);
        nodes.push({ p: v, s: si });
      }
      g.dispose();
    }
    const edgePos: number[] = [];
    const edgeT: number[] = [];
    const edgeSeed: number[] = [];
    const flowStart: number[] = [];
    const flowEnd: number[] = [];
    const flowSeed: number[] = [];
    const addEdge = (a: THREE.Vector3, b: THREE.Vector3) => {
      const seed = r();
      const segs = 6;
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs;
        const t1 = (k + 1) / segs;
        // Pathways bow slightly outward, so the structure reads as curved filaments rather than a wireframe.
        const p0 = a.clone().lerp(b, t0).multiplyScalar(1 + Math.sin(t0 * Math.PI) * 0.05);
        const p1 = a.clone().lerp(b, t1).multiplyScalar(1 + Math.sin(t1 * Math.PI) * 0.05);
        edgePos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        edgeT.push(t0, t1);
        edgeSeed.push(seed, seed);
      }
      if (r() < 0.55) {
        flowStart.push(a.x, a.y, a.z);
        flowEnd.push(b.x, b.y, b.z);
        flowSeed.push(r());
      }
    };
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const near = nodes
        .map((b, j) => ({ j, d: a.p.distanceTo(b.p), b }))
        .filter((x) => x.j > i && ((x.b.s === a.s && x.d < shells[a.s].r * 0.72) || (x.b.s === a.s + 1 && x.d < 0.9)))
        .sort((x, y) => x.d - y.d)
        .slice(0, a.s === 0 ? 3 : 2);
      near.forEach((x) => addEdge(a.p, x.b.p));
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute("position", new THREE.Float32BufferAttribute(edgePos, 3));
    eg.setAttribute("aT", new THREE.Float32BufferAttribute(edgeT, 1));
    eg.setAttribute("aSeed", new THREE.Float32BufferAttribute(edgeSeed, 1));
    const em = additive(new THREE.ShaderMaterial({ uniforms: shared, vertexShader: LATTICE_VERT, fragmentShader: LATTICE_FRAG }));
    this.lattice.add(new THREE.LineSegments(eg, em));

    const ng = new THREE.BufferGeometry();
    ng.setAttribute("position", new THREE.Float32BufferAttribute(nodes.flatMap((n) => n.p.toArray()), 3));
    ng.setAttribute("aSize", new THREE.Float32BufferAttribute(nodes.map((n) => (n.s === 0 ? 3.4 : 2.4) + r() * 2), 1));
    ng.setAttribute("aSeed", new THREE.Float32BufferAttribute(nodes.map(() => r()), 1));
    this.lattice.add(new THREE.Points(ng, additive(new THREE.ShaderMaterial({ uniforms: shared, vertexShader: NODE_VERT, fragmentShader: POINT_FRAG }))));

    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.Float32BufferAttribute(flowStart, 3));
    fg.setAttribute("aEnd", new THREE.Float32BufferAttribute(flowEnd, 3));
    fg.setAttribute("aSeed", new THREE.Float32BufferAttribute(flowSeed, 1));
    const flowPoints = new THREE.Points(fg, additive(new THREE.ShaderMaterial({ uniforms: shared, vertexShader: FLOW_VERT, fragmentShader: POINT_FRAG })));
    flowPoints.frustumCulled = false;
    this.lattice.add(flowPoints);

    // --- The core ---
    this.coreMat = new THREE.ShaderMaterial({ uniforms: { ...shared, uFlash: { value: 0 } }, vertexShader: CORE_VERT, fragmentShader: CORE_FRAG });
    this.structure.add(new THREE.Mesh(new THREE.SphereGeometry(0.62, 96, 96), this.coreMat));
    this.glow = new THREE.Sprite(additive(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x9fe6ff, fog: false })) as THREE.SpriteMaterial);
    this.glow.scale.setScalar(4.2);
    this.structure.add(this.glow);
    this.coreLight = new THREE.PointLight(0x3fd8ff, 4, 18, 2);
    this.structure.add(this.coreLight);

    // --- Orbital rings ---
    const ringSpec = [
      { R: 2.9, tilt: 1.2, roll: -0.35, color: 0x7fe6ff },
      { R: 3.4, tilt: 1.32, roll: 0.3, color: 0x8f7dff },
      { R: 3.95, tilt: 1.08, roll: 0.06, color: 0x3fd8ff },
    ];
    for (const s of ringSpec) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(s.R, 0.008, 6, 320), additive(new THREE.MeshBasicMaterial({ color: s.color, opacity: 0.6, fog: false })));
      m.rotation.set(s.tilt, 0, s.roll);
      this.rings.push(m);
      this.structure.add(m);
      for (let b = 0; b < 2; b++) {
        const bead = new THREE.Sprite(additive(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xd8f6ff, fog: false })) as THREE.SpriteMaterial);
        bead.scale.setScalar(0.32);
        bead.userData = { R: s.R, phase: b * Math.PI + r() * 2 };
        m.add(bead);
      }
    }

    // --- Shockwave for real events and completion ---
    this.shock = new THREE.Mesh(new THREE.RingGeometry(0.98, 1, 160), additive(new THREE.MeshBasicMaterial({ color: 0xbfe6ff, opacity: 0, side: THREE.DoubleSide, fog: false })));
    this.structure.add(this.shock);

    // --- Progress ring: one segment per plan step (missions only) ---
    this.progressMat = additive(
      new THREE.ShaderMaterial({
        uniforms: { uColA: shared.uColA, uColB: shared.uColB, uProgress: { value: 0 }, uSteps: { value: 1 }, uVis: { value: 0 } },
        vertexShader: UV_VERT,
        fragmentShader: PROGRESS_FRAG,
      }),
    ) as THREE.ShaderMaterial;
    this.progressMesh = new THREE.Mesh(new THREE.RingGeometry(4.35, 4.42, 256, 1), this.progressMat);
    this.structure.add(this.progressMesh);

    // --- The chamber: halo, monoliths, floor, grid, shafts, dust ---
    this.haloMat = additive(new THREE.ShaderMaterial({ uniforms: { ...shared, uFlare: { value: 0 } }, vertexShader: UV_VERT, fragmentShader: HALO_FRAG })) as THREE.ShaderMaterial;
    const halo = new THREE.Mesh(new THREE.CircleGeometry(10.5, 160), this.haloMat);
    halo.position.set(0, 2.2, -22);
    this.env.add(halo);

    const mono = new THREE.MeshStandardMaterial({ color: 0x060a14, metalness: 0.7, roughness: 0.38, transparent: true });
    const edge = new THREE.LineBasicMaterial({ color: 0x3fd8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
    this.envMaterials.push(mono, edge);
    for (let i = 0; i < 14; i++) {
      const side = i % 2 ? 1 : -1;
      const k = Math.floor(i / 2);
      const height = 5 + r() * 7;
      const box = new THREE.BoxGeometry(0.7 + r() * 0.6, height, 0.7 + r() * 0.6);
      const m = new THREE.Mesh(box, mono);
      const x = side * (5.2 + k * 1.7 + r() * 0.6);
      const z = -4 - k * 2.4 - r() * 1.5;
      m.position.set(x, -2.2 + height / 2, z);
      m.rotation.y = r() * 0.6 - 0.3;
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(box), edge);
      m.add(lines);
      this.env.add(m);
    }

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: 0x03060c, metalness: 0.85, roughness: 0.55, transparent: true }));
    this.envMaterials.push(floor.material as THREE.Material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.2;
    this.env.add(floor);
    this.gridMat = additive(new THREE.ShaderMaterial({ uniforms: { ...shared, uTravel: { value: 0 } }, vertexShader: UV_VERT, fragmentShader: GRID_FRAG })) as THREE.ShaderMaterial;
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), this.gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -2.19;
    this.env.add(grid);

    const shaftMat = additive(new THREE.ShaderMaterial({ uniforms: shared, vertexShader: UV_VERT, fragmentShader: SHAFT_FRAG, side: THREE.DoubleSide }));
    for (const [x, rz] of [
      [-3.2, 0.22],
      [3.4, -0.2],
    ]) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 2.6, 11, 48, 1, true), shaftMat);
      shaft.position.set(x, 4.2, -1.5);
      shaft.rotation.z = rz;
      this.env.add(shaft);
    }

    const dustN = this.lowPower ? 600 : 1500;
    const dp = new Float32Array(dustN * 3);
    const ds = new Float32Array(dustN);
    const dz = new Float32Array(dustN);
    for (let i = 0; i < dustN; i++) {
      dp[i * 3] = (r() - 0.5) * 30;
      dp[i * 3 + 1] = -2 + r() * 11;
      dp[i * 3 + 2] = -18 + r() * 24;
      ds[i] = 0.8 + r() * 1.6;
      dz[i] = r();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(dp, 3));
    dg.setAttribute("aSize", new THREE.BufferAttribute(ds, 1));
    dg.setAttribute("aSeed", new THREE.BufferAttribute(dz, 1));
    this.dust = new THREE.Points(dg, additive(new THREE.ShaderMaterial({ uniforms: shared, vertexShader: DUST_VERT, fragmentShader: POINT_FRAG })));
    this.dust.frustumCulled = false;
    this.env.add(this.dust);

    this.scene.add(new THREE.AmbientLight(0x1a2a55, 0.25));
    const back = new THREE.DirectionalLight(0x6fd0ff, 0.9);
    back.position.set(0, 3, -12);
    this.scene.add(back);

    if (!this.lowPower) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.4, 0.72);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    canvas.addEventListener("webglcontextlost", this.onLost);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    window.addEventListener("scroll", this.onScroll, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
    this.intro = this.reduced ? 1 : 0;
    this.start(3200);
  }

  setMode(mode: CoreMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.target = { ...KNOBS[mode] };
    this.start(1600);
  }

  setProgress(fraction: number, steps: number, visible: boolean) {
    this.progressTarget = Math.max(0, Math.min(1, fraction));
    this.steps = steps;
    this.progVisTarget = visible ? 1 : 0;
    this.start(900);
  }

  pulse(strength = 0.7) {
    this.pulseStrength = Math.min(1, Math.max(strength, this.pulseAge < 0.5 ? this.pulseStrength : 0));
    this.pulseAge = 0;
    this.start(1300);
  }

  impulse(strength = 0.12) {
    this.type = Math.min(1, this.type + strength);
    this.start(500);
  }

  celebrate() {
    if (this.reduced) return;
    this.burstAge = 0;
    this.start(3200);
  }

  setAnchor(el: HTMLElement | null) {
    if (el === this.anchor) return;
    this.anchor = el;
    if (el && this.hasView) this.glideUntil = performance.now() + 1300;
    this.start(1500);
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    if (reduced) {
      this.burstAge = -1;
      this.intro = 1;
    }
    this.start(500);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointermove", this.onPointer);
    window.removeEventListener("scroll", this.onScroll);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((x) => x.dispose());
    });
    this.glowTex.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.opts.onContextLost();
  };
  private onResize = () => {
    this.resize();
    this.start(300);
  };
  private onScroll = () => this.start(250);
  private onPointer = (e: PointerEvent) => {
    if (this.reduced || e.pointerType === "touch") return;
    this.pointerTarget.set((e.clientX / this.w) * 2 - 1, (e.clientY / this.h) * 2 - 1);
    this.pointerUntil = performance.now() + 800;
    this.start(800);
  };
  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else {
      this.lastFrame = performance.now();
      this.start(400);
    }
  };

  private resize() {
    this.w = Math.max(1, window.innerWidth);
    this.h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.lowPower ? 1 : 1.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(this.w, this.h);
    this.bloom?.setSize(Math.round(this.w * dpr * 0.5), Math.round(this.h * dpr * 0.5));
    shared.uPixel.value = dpr;
  }

  private start(ms: number) {
    if (this.disposed) return;
    this.runUntil = Math.max(this.runUntil, performance.now() + (this.reduced ? Math.min(ms, 500) : ms));
    if (!this.raf && !document.hidden) {
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  private busy(now: number) {
    if (now < this.runUntil || now < this.pointerUntil || now < this.glideUntil) return true;
    if (this.pulseAge < 1 || (this.burstAge >= 0 && this.burstAge < 1) || this.type > 0.01 || this.intro < 0.999) return true;
    for (const k of KEYS) if (Math.abs(this.cur[k] - this.target[k]) > 0.002) return true;
    return this.cur.energy > 0.7;
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed || document.hidden) return;
    if (this.reduced) {
      this.step(1, now, true);
      this.draw();
      if (now < this.runUntil) this.raf = requestAnimationFrame(this.frame);
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
    const minGap = this.busy(now) ? 0 : this.sceneMix > 0.5 ? 48 : 33;
    if (now - this.lastDraw < minGap) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.lastDraw = now;
    this.step(dt, now, false);
    this.draw();
  };

  private step(dt: number, now: number, instant: boolean) {
    const ease = (rate: number) => (instant ? 1 : 1 - Math.exp(-dt * rate));
    for (const k of KEYS) this.cur[k] += (this.target[k] - this.cur[k]) * (k === "organize" ? ease(1.4) : k === "dolly" ? ease(1.6) : ease(2.4));
    this.progress += (this.progressTarget - this.progress) * ease(3);
    this.progVis += (this.progVisTarget - this.progVis) * ease(2.5);
    const sceneTarget = this.anchor?.dataset.coreSize === "compact" ? 1 : 0;
    this.sceneMix += (sceneTarget - this.sceneMix) * ease(2);
    if (!instant) {
      this.time += dt;
      this.flow += dt * (0.08 + this.cur.energy * 0.55);
      this.spin += dt * this.cur.speed;
      this.travel += dt * Math.max(0, this.cur.energy - 0.45) * 1.4;
      shared.uDrift.value += dt * (0.15 + Math.max(0, this.cur.energy - 0.4) * 6 + this.cur.dolly * 1.5);
      this.intro = Math.min(1, this.intro + dt / 2.6);
      this.pulseAge = Math.min(1, this.pulseAge + dt / 1.2);
      if (this.burstAge >= 0) this.burstAge = this.burstAge + dt / 2.6 >= 1 ? -1 : this.burstAge + dt / 2.6;
      this.type *= Math.exp(-dt * 5);
      this.pointer.lerp(this.pointerTarget, ease(2.5));
    } else {
      this.pulseAge = 1;
      this.type = 0;
      this.intro = 1;
    }
    if (this.anchor) {
      const rect = this.anchor.getBoundingClientRect();
      const compact = this.anchor.dataset.coreSize === "compact";
      const t = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: compact ? Math.min(rect.width, rect.height) / 2 : Math.min(rect.width / 2.2, rect.height / 1.25) };
      if (!this.hasView || instant || now >= this.glideUntil) {
        this.view = t;
        this.hasView = true;
      } else {
        const k = ease(4.5);
        this.view = { x: this.view.x + (t.x - this.view.x) * k, y: this.view.y + (t.y - this.view.y) * k, r: this.view.r + (t.r - this.view.r) * k };
      }
    }
  }

  private draw() {
    if (!this.hasView || this.renderer.getContext().isContextLost()) return;
    const c = this.cur;
    const burstEnv = this.burstAge >= 0 ? Math.pow(1 - this.burstAge, 2) : 0;
    const introE = 1 - Math.pow(1 - this.intro, 3);

    // Status colour: cyan normally, teal on success, amber when held or warned, red on failure.
    const a = CYAN.clone().lerp(TEAL, c.ok * 0.5).lerp(AMBER, c.warn * 0.7).lerp(RED, c.err * 0.75);
    const b = ICE.clone().lerp(AMBER, c.warn * 0.35).lerp(RED, c.err * 0.4);
    const dimK = 1 - c.dim * 0.6;
    shared.uColA.value.copy(a).multiplyScalar(dimK);
    shared.uColB.value.copy(b).multiplyScalar(dimK);
    shared.uColC.value.copy(VIOLET).lerp(RED, c.err * 0.5).multiplyScalar(dimK);
    shared.uTime.value = this.time;
    shared.uFlow.value = this.flow;
    shared.uEnergy.value = (c.energy + this.type * 0.3 + burstEnv * 0.6) * introE;
    shared.uOrganize.value = Math.min(1, c.organize * introE + burstEnv * 0.5);
    shared.uEnv.value = (1 - this.sceneMix * 0.85) * introE;
    this.gridMat.uniforms.uTravel.value = this.travel;
    this.coreMat.uniforms.uFlash.value = ((1 - this.pulseAge) * this.pulseStrength * 0.8 + burstEnv * 1.5 + this.type * 0.4) * (1 - this.sceneMix * 0.6);
    this.haloMat.uniforms.uFlare.value = (burstEnv * 1.2 + c.alert * 0.15) * (1 - this.sceneMix);
    for (const m of this.envMaterials) (m as THREE.Material & { opacity: number }).opacity = (m instanceof THREE.LineBasicMaterial ? 0.12 : 1) * shared.uEnv.value;

    // The structure breathes, tightens as it organises, and expands on completion.
    const breath = 1 + Math.sin(this.time * 0.8) * 0.015 * (0.5 + c.energy);
    const s = breath * (1.06 - c.organize * 0.06) * (1 + burstEnv * 0.25) * (0.6 + 0.4 * introE);
    this.structure.scale.setScalar(s);
    this.lattice.rotation.y = this.spin * 0.6;
    this.lattice.rotation.x = Math.sin(this.spin * 0.3) * 0.15;
    this.rings.forEach((ring, i) => {
      ring.rotation.z += 0;
      const dir = i === 1 ? -1 : 1;
      ring.children.forEach((bead) => {
        const u = bead.userData as { R: number; phase: number };
        const ang = this.spin * (1.1 + i * 0.3) * dir + u.phase;
        bead.position.set(Math.cos(ang) * u.R, Math.sin(ang) * u.R, 0);
        (bead as THREE.Sprite).material.opacity = (0.3 + 0.9 * c.organize) * introE;
      });
      (ring.material as THREE.MeshBasicMaterial).opacity = (0.18 + 0.55 * c.organize) * introE * (0.6 + 0.4 * c.energy);
    });
    this.glow.material.opacity = Math.min(1, (0.28 + 0.3 * c.energy + burstEnv * 0.7) * introE * (1 - this.sceneMix * 0.75));
    this.glow.scale.setScalar(3.2 * (1 + burstEnv * 0.8 + (1 - this.pulseAge) * this.pulseStrength * 0.25));
    this.coreLight.intensity = (2.5 + 5 * c.energy + burstEnv * 14) * introE;
    this.coreLight.color.copy(a);

    // One shockwave per real event; a larger one on completion.
    const shockAge = this.burstAge >= 0 ? this.burstAge : this.pulseAge;
    const shockAmp = this.burstAge >= 0 ? 1 : this.pulseStrength * 0.7;
    this.shock.scale.setScalar(0.7 + shockAge * (this.burstAge >= 0 ? 9 : 4.5));
    (this.shock.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - shockAge) * shockAmp);
    (this.shock.material as THREE.MeshBasicMaterial).color.copy(b);

    this.progressMat.uniforms.uProgress.value = this.progress;
    this.progressMat.uniforms.uSteps.value = this.steps;
    this.progressMat.uniforms.uVis.value = this.progVis * this.sceneMix;

    // Camera: a slow reveal on arrival, a dolly toward the composer on focus and work, pointer parallax.
    const aspect = this.w / this.h;
    this.camera.aspect = aspect;
    const dist = 12.5 - c.dolly * 2.4 + (1 - introE) * 10 + burstEnv * 1.2;
    const px = this.pointer.x * 0.9;
    const py = this.pointer.y * 0.45;
    this.camera.position.set(px + Math.sin(this.time * 0.07) * 0.25, 0.9 - py + c.alert * -0.2, dist);
    this.camera.lookAt(0, 0.15 + c.alert * -0.15, 0);
    this.camera.rotation.z = Math.sin(this.time * 0.05) * 0.008;
    this.shock.quaternion.copy(this.camera.quaternion);
    this.progressMesh.quaternion.copy(this.camera.quaternion);

    // Frame the structure on its DOM anchor: shift the projection centre there and scale to the anchor's size.
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const pxPerUnit = this.h / 2 / (Math.tan(fovRad / 2) * dist);
    const natural = 2.45 * pxPerUnit;
    this.camera.zoom = Math.max(0.2, Math.min(3, (this.view.r / natural) * (this.sceneMix > 0.5 ? 0.62 : 1)));
    this.camera.setViewOffset(this.w, this.h, this.w / 2 - this.view.x, this.h / 2 - this.view.y, this.w, this.h);
    this.camera.updateProjectionMatrix();

    if (this.bloom) this.bloom.strength = (0.55 + c.energy * 0.3 + burstEnv * 1.1) * (1 - this.sceneMix * 0.55);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
