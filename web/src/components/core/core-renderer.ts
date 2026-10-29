/**
 * The OmniPilot Core: one WebGL2 canvas behind the interface.
 *
 * Pass 1 is a full-screen shader: midnight atmosphere, a perspective floor grid (home) or dot lattice (missions),
 * and the core itself, a glass sphere of moving energy with filaments, a fresnel rim, volumetric shafts, three
 * orbital rings with travelling pulses, and a step-segmented progress ring. Pass 2 draws point-sprite particles
 * that orbit the core and a sparse dust field. Everything is analytic, so there are no textures or assets.
 *
 * The renderer only animates toward targets set from real application state (mode, step progress, events).
 * It runs at ~30 fps when calm and 60 fps when something is happening, stops while the tab is hidden, renders
 * single frames under reduced motion, and releases every GL object on dispose.
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
  scan: number;
}

const KNOBS: Record<CoreMode, Knobs> = {
  idle: { energy: 0.3, alert: 0, organize: 0.08, speed: 0.14, warn: 0, err: 0, ok: 0, dim: 0, scan: 0 },
  focus: { energy: 0.46, alert: 1, organize: 0.22, speed: 0.22, warn: 0, err: 0, ok: 0, dim: 0, scan: 0 },
  planning: { energy: 0.82, alert: 0.3, organize: 1, speed: 0.95, warn: 0, err: 0, ok: 0, dim: 0, scan: 0 },
  review: { energy: 0.52, alert: 0, organize: 1, speed: 0.3, warn: 0, err: 0, ok: 0, dim: 0, scan: 0 },
  executing: { energy: 0.86, alert: 0, organize: 1, speed: 0.72, warn: 0, err: 0, ok: 0, dim: 0, scan: 0 },
  paused: { energy: 0.32, alert: 0, organize: 1, speed: 0.03, warn: 0.55, err: 0, ok: 0, dim: 0, scan: 0 },
  verifying: { energy: 0.92, alert: 0, organize: 1, speed: 0.85, warn: 0, err: 0, ok: 0, dim: 0, scan: 1 },
  success: { energy: 0.5, alert: 0, organize: 1, speed: 0.2, warn: 0, err: 0, ok: 1, dim: 0, scan: 0 },
  warning: { energy: 0.46, alert: 0, organize: 1, speed: 0.18, warn: 0.42, err: 0, ok: 0.5, dim: 0, scan: 0 },
  error: { energy: 0.24, alert: 0, organize: 0.55, speed: 0.05, warn: 0, err: 1, ok: 0, dim: 0, scan: 0 },
  cancelled: { energy: 0.16, alert: 0, organize: 0.6, speed: 0.03, warn: 0, err: 0, ok: 0, dim: 0.65, scan: 0 },
};

const KNOB_KEYS = Object.keys(KNOBS.idle) as (keyof Knobs)[];

const VERT_FULL = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `
const float TAU = 6.28318530718;
const vec3 C_CYAN = vec3(0.25, 0.85, 1.0);
const vec3 C_ICE = vec3(0.76, 0.9, 1.0);
const vec3 C_VIOLET = vec3(0.58, 0.5, 1.0);
const vec3 C_AMBER = vec3(1.0, 0.72, 0.38);
const vec3 C_RED = vec3(1.0, 0.42, 0.48);
const vec3 C_TEAL = vec3(0.3, 0.95, 0.78);
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float ringR(float k) { return k < 0.5 ? 1.42 : (k < 1.5 ? 1.78 : 2.18); }
float ringInc(float k) { return k < 0.5 ? 1.15 : (k < 1.5 ? 1.26 : 1.04); }
float ringRoll(float k) { return k < 0.5 ? -0.36 : (k < 1.5 ? 0.27 : 0.07); }
float ringDir(float k) { return (k > 0.5 && k < 1.5) ? -1.0 : 1.0; }
`;

const FRAG_SCENE = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr, uTime;
uniform vec3 uCore;
uniform float uPresence, uEnergy, uAlert, uOrganize, uSpin, uFlow, uTravel;
uniform float uProgress, uSteps, uProgVis, uPulse, uPulseAge, uBurst;
uniform float uWarn, uErr, uOk, uDim, uScan, uScene, uType;
uniform vec2 uPointer;
out vec4 outColor;
${COMMON}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
// Distance from q to a tilted orbital ring, plus the angle along it and whether that point is on the far half.
float ringDist(vec2 q, float R, float inc, float roll, out float ang, out float back) {
  vec2 p = rot(q, -roll);
  float ci = max(cos(inc), 0.05);
  vec2 e = vec2(p.x, p.y / ci);
  float le = max(length(e), 1e-4);
  vec2 grad = vec2(e.x, e.y / ci) / le;
  ang = atan(e.y, e.x);
  back = step(e.y, 0.0);
  return abs(le - R) / max(length(grad), 1e-4);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 view = uRes / uDpr;
  vec2 uv = px / view;

  vec3 lightA = mix(C_CYAN, C_TEAL, uOk * 0.45);
  lightA = mix(lightA, C_AMBER, uWarn * 0.7);
  lightA = mix(lightA, C_RED, uErr * 0.75);
  vec3 lightB = mix(C_ICE, mix(C_ICE, C_AMBER, 0.45), uWarn * 0.6);
  lightB = mix(lightB, mix(C_ICE, C_RED, 0.5), uErr * 0.6);
  vec3 lightC = mix(C_VIOLET, C_RED, uErr * 0.5);

  // Atmosphere: near-black with a midnight-blue lift, light pooled behind the core, slow haze.
  vec3 col = mix(vec3(0.014, 0.022, 0.046), vec3(0.006, 0.009, 0.019), smoothstep(0.0, 1.0, uv.y));
  vec2 cq = (px - uCore.xy) / max(view.y, 1.0);
  col += lightA * 0.05 * exp(-dot(cq, cq) * 6.0) * (0.35 + uEnergy) * uPresence;
  col += C_VIOLET * 0.02 * exp(-pow((uv.y - 1.08) * 2.4, 2.0)) * (1.0 - uScene * 0.7);
  float haze = vnoise(px / 280.0 + vec2(uFlow * 0.035, -uFlow * 0.02)) * 0.6 + vnoise(px / 130.0 - vec2(uFlow * 0.025, 0.0)) * 0.4;
  col += vec3(0.03, 0.05, 0.11) * (haze - 0.5) * 0.35;

  // Perspective floor grid under the core (home); it drifts toward the viewer only while work runs.
  float dy = px.y - (uCore.y + uCore.z * 2.75);
  float fz = 260.0 / max(dy, 1.0);
  vec2 g = vec2((px.x - uCore.x) * fz / 230.0, fz + uTravel);
  vec2 gw = fwidth(g);
  vec2 gl = abs(fract(g - 0.5) - 0.5) / max(gw, vec2(1e-4));
  float gridLine = 1.0 - min(min(gl.x, gl.y), 1.0);
  float gridFade = smoothstep(6.0, 90.0, dy) * exp(-dy / (view.y * 0.85));
  float pool = 0.3 + 1.7 * exp(-abs(px.x - uCore.x) / (uCore.z * 3.4)) * exp(-max(dy, 0.0) / (uCore.z * 4.5));
  col += lightB * gridLine * 0.06 * gridFade * pool * (1.0 - uScene) * uPresence;
  // A quiet dot lattice behind mission pages.
  vec2 cell = fract(px / 28.0) - 0.5;
  col += lightB * smoothstep(0.055, 0.0, length(cell)) * 0.035 * uScene;

  // The core.
  vec2 q = (px - uCore.xy) / uCore.z;
  float burstEnv = uBurst >= 0.0 ? (1.0 - uBurst) * (1.0 - uBurst) : 0.0;
  float breath = 1.0 + (0.016 + 0.018 * uEnergy) * sin(uTime * 0.85) + 0.03 * uType + 0.07 * burstEnv;
  vec2 qs = q / breath;
  float r = length(qs);
  if (r < 3.8 && uPresence > 0.001) {
    vec3 core = vec3(0.0);
    float aa = 1.5 / uCore.z;
    if (r < 1.0 + aa) {
      float rr = min(r, 1.0);
      float z = sqrt(max(1.0 - rr * rr, 0.0));
      vec3 n = vec3(qs, z);
      n.xz = rot(n.xz, uSpin * 0.22 + uPointer.x * 0.12);
      n.yz = rot(n.yz, -uPointer.y * 0.1);
      float dens = 0.0;
      for (int i = 0; i < 3; i++) {
        float t = (float(i) + 0.5) / 3.0;
        vec3 sp = vec3(n.xy, mix(n.z, -n.z, t));
        dens += snoise(sp * 1.25 + vec3(0.0, uFlow * 0.22, uFlow * 0.31)) * 0.78 + snoise(sp * 2.9 - vec3(uFlow * 0.17, 0.0, 0.0)) * 0.22;
      }
      dens /= 3.0;
      float e = smoothstep(-0.6, 0.75, dens);
      vec3 deep = vec3(0.012, 0.04, 0.13);
      vec3 energy = mix(mix(deep, lightC * 0.55, smoothstep(0.05, 0.5, e)), lightA, smoothstep(0.45, 1.0, e));
      // Light comes from inside: bright toward the centre, falling off to a dark limb, then a thin rim.
      vec3 inner = energy * (0.16 + 0.75 * e * e) * (0.55 + 0.7 * uEnergy) * (0.35 + 0.65 * z);
      float hot = exp(-rr * rr * 2.6);
      inner += mix(lightA, vec3(0.9, 0.97, 1.0), 0.5) * hot * (0.36 + 0.42 * uEnergy + 0.35 * uType + 0.8 * burstEnv);
      inner += lightA * exp(-rr * rr * 9.0) * 0.35 * (0.6 + 0.4 * uEnergy);
      // Flowing filaments: ridged noise, warped, and kept sparse so they read as currents rather than cracks.
      float warp = snoise(n * 1.3 + vec3(0.0, uFlow * 0.25, 0.0));
      float ridge = 1.0 - abs(snoise(n * 1.8 + warp * 0.9 + vec3(uFlow * 0.1, 0.0, uSpin * 0.05)));
      float sparse = smoothstep(0.15, 0.65, snoise(n * 0.9 - vec3(uFlow * 0.07)) * 0.5 + 0.5);
      inner += mix(lightA, vec3(1.0), 0.3) * pow(ridge, 24.0) * sparse * (0.22 + 0.5 * uEnergy) * z;
      float fres = pow(1.0 - z, 2.6);
      float toward = 1.0 + uAlert * 0.7 * smoothstep(-0.3, 1.0, qs.y);
      inner += mix(lightA, C_VIOLET, 0.25) * fres * (0.75 + 0.5 * uEnergy + 0.4 * uAlert) * toward;
      float scanY = sin(uTime * 1.35) * 0.92;
      inner += lightA * exp(-pow((qs.y - scanY) * 14.0, 2.0)) * uScan * 0.6 * z;
      core += inner * (1.0 - smoothstep(1.0 - aa, 1.0 + aa, r));
    }

    float outside = max(r - 1.0, 0.0);
    float rim = smoothstep(1.0 - aa, 1.0 + aa, r);
    float halo = (exp(-outside * 3.2) * 0.55 + exp(-outside * 1.1) * 0.13) * (0.5 + 0.75 * uEnergy + 0.35 * uAlert + 0.7 * burstEnv);
    halo += exp(-length((qs - vec2(0.0, 1.3)) * vec2(1.4, 0.75)) * 2.4) * uAlert * 0.16;
    core += mix(lightA, lightB, 0.35) * halo * rim;

    float ang = atan(qs.y, qs.x);
    vec2 dir = vec2(cos(ang), sin(ang));
    float shafts = vnoise(dir * 3.2 + vec2(uFlow * 0.05, uSpin * 0.01)) * 0.65 + vnoise(dir * 7.0 - uFlow * 0.04) * 0.35;
    core += lightB * pow(shafts, 2.6) * exp(-outside * 1.25) * smoothstep(1.0, 1.3, r) * (0.08 + 0.12 * uEnergy);

    // Orbital rings: dashed while idle, continuous once organised; the far half passes behind the sphere.
    float w = max(1.1 / uCore.z, 0.007);
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float R = ringR(fk) * (1.0 + burstEnv * 0.25 * (fk + 1.0));
      float a2, back;
      float d = ringDist(qs, R, ringInc(fk) + uPointer.y * 0.08, ringRoll(fk) + uPointer.x * 0.08, a2, back);
      if (d > 0.5) continue;
      float dirk = ringDir(fk);
      float sa = a2 - uSpin * (0.35 + 0.15 * fk) * dirk;
      float fd = fract(sa / TAU * (12.0 + fk * 6.0));
      float dash = smoothstep(0.08, 0.16, fd) * (1.0 - smoothstep(0.62, 0.7, fd));
      float occl = mix(1.0, smoothstep(1.0, 1.07, r), back);
      float vis = mix(0.32, 1.0, uOrganize) * mix(dash, 1.0, uOrganize) * occl * mix(1.0, 0.42, back);
      float line = exp(-d * d / (w * w)) * 0.75 + exp(-d * d / (w * w * 42.0)) * 0.16;
      core += mix(lightB, lightA, 0.3 + 0.2 * fk) * line * vis * (0.5 + 0.6 * uEnergy);
      for (int j = 0; j < 2; j++) {
        float ph = uSpin * (0.9 + 0.35 * fk) * dirk + float(j) * 3.14159 + fk * 1.7;
        float da = abs(mod(a2 - ph + 3.14159, TAU) - 3.14159);
        float bead = exp(-da * da * 150.0) * exp(-d * d / (w * w * 7.0));
        core += mix(lightB, vec3(1.0), 0.5) * bead * occl * uOrganize * (0.3 + 1.2 * uEnergy) * 1.3;
      }
    }

    // Progress ring: one segment per real plan step, lit as steps finish.
    if (uProgVis > 0.001) {
      float dp = abs(r - 2.62);
      float a01 = fract(atan(qs.x, -qs.y) / TAU + 1.0);
      float steps = max(uSteps, 1.0);
      float sp = fract(a01 * steps);
      float gap = steps > 1.5 ? smoothstep(0.0, 0.05, sp) * smoothstep(1.0, 0.95, sp) : 1.0;
      float lit = step(a01, uProgress);
      core += lightB * exp(-dp * dp / (w * w)) * gap * (0.12 + 0.8 * lit) * uProgVis;
      core += lightA * exp(-dp * dp / (w * w * 30.0)) * gap * lit * 0.12 * uProgVis;
    }

    // A real event sends one wave outward; completion sends a larger one.
    core += lightB * exp(-pow((r - (1.0 + uPulseAge * 1.9)) * 9.0, 2.0)) * (1.0 - uPulseAge) * uPulse * 0.55;
    if (uBurst >= 0.0) core += mix(lightB, vec3(1.0), 0.3) * exp(-pow((r - (1.0 + uBurst * 3.2)) * 4.0, 2.0)) * burstEnv * 1.1;

    float lum = dot(core, vec3(0.299, 0.587, 0.114));
    core = mix(core, vec3(lum) * vec3(0.8, 0.88, 1.0), uDim * 0.7) * (1.0 - uDim * 0.55);
    col += core * uPresence;
  }

  vec2 vq = uv - 0.5;
  col *= 1.0 - dot(vq, vq) * 0.55;
  col = 1.0 - exp(-col * 1.15);
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`;

const VERT_POINTS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aA;
layout(location = 1) in vec4 aB;
uniform vec2 uView;
uniform float uDpr, uTime;
uniform vec3 uCore;
uniform float uPresence, uEnergy, uAlert, uOrganize, uSpin, uFlow, uPulse, uPulseAge, uBurst, uDim, uWarn, uErr, uOk, uScene;
uniform vec2 uPointer;
out vec3 vColor;
out float vAlpha;
${COMMON}
void main() {
  float shell = aB.z;
  float rnd = aB.w;
  vec3 lightA = mix(C_CYAN, C_TEAL, uOk * 0.45);
  lightA = mix(lightA, C_AMBER, uWarn * 0.7);
  lightA = mix(lightA, C_RED, uErr * 0.75);
  vec3 lightB = mix(C_ICE, mix(C_ICE, C_RED, 0.5), uErr * 0.6);
  vec3 color = mix(lightA, lightB, fract(rnd * 7.31));
  if (fract(rnd * 13.7) > 0.88) color = mix(color, C_VIOLET, 0.7);
  vec2 screen;
  float size;
  float alpha;
  if (shell > 2.5) {
    float depth = aA.z;
    vec2 p = vec2(aA.x * uView.x, mod(aA.y * uView.y - uFlow * 9.0 * aA.w, uView.y + 40.0) - 20.0);
    p.x += sin(uFlow * 0.3 * aA.w + rnd * TAU) * 14.0;
    p += uPointer * depth * vec2(-14.0, -10.0);
    screen = p;
    size = aB.x * (0.6 + depth * 0.7);
    alpha = aB.y * 0.2 * depth * (0.65 + 0.35 * sin(uTime * 0.6 + rnd * TAU)) * (1.0 - uScene * 0.35);
    color = mix(lightB, C_CYAN, 0.3);
  } else {
    float dirk = ringDir(shell);
    float th = aA.y + uSpin * 0.45 * aA.w * dirk;
    float ph = aA.z + sin(uFlow * 0.4 + rnd * 40.0) * 0.12;
    float rad = aA.x * (1.0 + 0.05 * sin(uFlow * 0.7 + rnd * 30.0));
    vec3 cloud = rad * vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th));
    float R = ringR(shell) + (fract(rnd * 3.7) - 0.5) * 0.07;
    float inc = ringInc(shell) + uPointer.y * 0.08;
    float a = aA.y + uSpin * (0.35 + 0.15 * shell) * dirk;
    vec3 ring = vec3(cos(a) * R, sin(a) * R * cos(inc), sin(a) * R * sin(inc));
    ring.xy = rot(ring.xy, ringRoll(shell) + uPointer.x * 0.08);
    vec3 pos = mix(cloud, ring, smoothstep(0.0, 1.0, uOrganize));
    float burstEnv = uBurst >= 0.0 ? (1.0 - uBurst) * (1.0 - uBurst) : 0.0;
    pos *= 1.0 + burstEnv * (0.6 + rnd * 1.4);
    pos.y += uAlert * (0.15 + 0.35 * rnd) * step(0.5, fract(rnd * 5.3));
    pos.xz = rot(pos.xz, uPointer.x * 0.12 * (1.0 - uOrganize));
    float persp = 1.0 / (1.0 - pos.z * 0.07);
    screen = uCore.xy + pos.xy * uCore.z * persp;
    float behind = (pos.z < 0.0 && length(pos.xy) < 1.02) ? 0.08 : 1.0;
    float front = smoothstep(-1.5, 1.5, pos.z);
    size = aB.x * (0.75 + 0.5 * front) * (0.85 + 0.35 * uEnergy) * clamp(uCore.z / 105.0, 0.6, 1.3);
    alpha = aB.y * behind * (0.25 + 0.75 * front) * (0.3 + 0.7 * uEnergy) * uPresence;
    float rr = length(pos.xy);
    alpha += uPulse * (1.0 - uPulseAge) * exp(-pow((rr - (1.0 + uPulseAge * 1.9)) * 5.0, 2.0)) * 0.9 * behind * uPresence;
    alpha *= 1.0 - uDim * 0.6;
  }
  vec2 clip = screen / uView * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = max(size * uDpr, 1.0);
  vColor = color;
  vAlpha = clamp(alpha, 0.0, 1.0);
}`;

const FRAG_POINTS = `#version 300 es
precision mediump float;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = (exp(-d * 4.0) * 0.85 + exp(-d * 18.0) * 0.6) * vAlpha;
  outColor = vec4(vColor * a, a);
}`;

const SCENE_UNIFORMS = [
  "uRes", "uDpr", "uTime", "uCore", "uPresence", "uEnergy", "uAlert", "uOrganize", "uSpin", "uFlow", "uTravel",
  "uProgress", "uSteps", "uProgVis", "uPulse", "uPulseAge", "uBurst", "uWarn", "uErr", "uOk", "uDim", "uScan", "uScene", "uType", "uPointer",
] as const;
const POINT_UNIFORMS = [
  "uView", "uDpr", "uTime", "uCore", "uPresence", "uEnergy", "uAlert", "uOrganize", "uSpin", "uFlow", "uPulse", "uPulseAge", "uBurst",
  "uDim", "uWarn", "uErr", "uOk", "uScene", "uPointer",
] as const;

type Loc<T extends readonly string[]> = Record<T[number], WebGLUniformLocation | null>;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("createShader failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return s;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("createProgram failed");
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Program link failed: ${gl.getProgramInfoLog(p)}`);
  return p;
}

function locations<T extends readonly string[]>(gl: WebGL2RenderingContext, p: WebGLProgram, names: T): Loc<T> {
  const out = {} as Loc<T>;
  for (const n of names) out[n as T[number]] = gl.getUniformLocation(p, n);
  return out;
}

/** Seeded so the particle field looks the same on every load. */
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

function particleData(core: number, dust: number): Float32Array {
  const r = rng(7);
  const data = new Float32Array((core + dust) * 8);
  for (let i = 0; i < core; i++) {
    const o = i * 8;
    data[o] = 1.2 + Math.pow(r(), 0.7) * 1.7;
    data[o + 1] = r() * Math.PI * 2;
    data[o + 2] = Math.acos(2 * r() - 1);
    data[o + 3] = 0.5 + r() * 0.9;
    data[o + 4] = 1.1 + Math.pow(r(), 3) * 2.6;
    data[o + 5] = 0.35 + r() * 0.65;
    data[o + 6] = i % 3;
    data[o + 7] = r();
  }
  for (let i = core; i < core + dust; i++) {
    const o = i * 8;
    data[o] = r();
    data[o + 1] = r();
    data[o + 2] = 0.3 + r() * 0.7;
    data[o + 3] = 0.5 + r();
    data[o + 4] = 0.8 + r() * 1.4;
    data[o + 5] = 0.25 + r() * 0.5;
    data[o + 6] = 3;
    data[o + 7] = r();
  }
  return data;
}

export function supportsWebGL2(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

export interface CoreRendererOptions {
  reducedMotion: boolean;
  lowPower: boolean;
  onContextLost(): void;
}

export class CoreRenderer {
  private gl: WebGL2RenderingContext;
  private scene: WebGLProgram;
  private points: WebGLProgram;
  private sceneLoc: Loc<typeof SCENE_UNIFORMS>;
  private pointLoc: Loc<typeof POINT_UNIFORMS>;
  private emptyVao: WebGLVertexArrayObject;
  private pointVao: WebGLVertexArrayObject;
  private pointBuf: WebGLBuffer;
  private pointCount: number;

  private reduced: boolean;
  private lowPower: boolean;
  private raf = 0;
  private lastFrame = 0;
  private lastDraw = 0;
  private disposed = false;
  private runUntil = 0;

  private mode: CoreMode = "idle";
  private cur: Knobs = { ...KNOBS.idle };
  private target: Knobs = { ...KNOBS.idle };
  private time = 0;
  private spin = 0;
  private flow = 0;
  private travel = 0;
  private presence = 0;
  private presenceTarget = 1;
  private progress = 0;
  private progressTarget = 0;
  private steps = 0;
  private progVis = 0;
  private progVisTarget = 0;
  private pulseStrength = 0;
  private pulseAge = 1;
  private burstAge = -1;
  private type = 0;
  private sceneMix = 0;
  private pointer = { x: 0, y: 0 };
  private pointerTarget = { x: 0, y: 0 };
  private pointerActiveUntil = 0;

  private anchor: HTMLElement | null = null;
  private glideUntil = 0;
  private corePos = { x: 0, y: 0, r: 0 };
  private hasPos = false;

  private cssW = 1;
  private cssH = 1;
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: CoreRendererOptions,
  ) {
    this.reduced = opts.reducedMotion;
    this.lowPower = opts.lowPower;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.scene = link(gl, VERT_FULL, FRAG_SCENE);
    this.points = link(gl, VERT_POINTS, FRAG_POINTS);
    this.sceneLoc = locations(gl, this.scene, SCENE_UNIFORMS);
    this.pointLoc = locations(gl, this.points, POINT_UNIFORMS);
    this.emptyVao = gl.createVertexArray()!;
    this.pointVao = gl.createVertexArray()!;
    this.pointBuf = gl.createBuffer()!;
    const coreN = this.lowPower ? 700 : 1500;
    const dustN = this.lowPower ? 110 : 240;
    this.pointCount = coreN + dustN;
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, particleData(coreN, dustN), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);

    canvas.addEventListener("webglcontextlost", this.onLost);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    window.addEventListener("scroll", this.onScroll, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resize();
    // First load: the core ignites from nothing.
    this.presence = 0;
    this.presenceTarget = 1;
    if (!this.reduced) this.burstAge = 0.35;
    this.start(1600);
  }

  setMode(mode: CoreMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.target = { ...KNOBS[mode] };
    this.start(1400);
  }

  setProgress(fraction: number, steps: number, visible: boolean) {
    this.progressTarget = Math.max(0, Math.min(1, fraction));
    this.steps = steps;
    this.progVisTarget = visible ? 1 : 0;
    this.start(900);
  }

  /** A real mission event: one wave travels outward from the core. */
  pulse(strength = 0.7) {
    this.pulseStrength = Math.min(1, Math.max(strength, this.pulseAge < 0.5 ? this.pulseStrength : 0));
    this.pulseAge = 0;
    this.start(1300);
  }

  /** Typing in the composer: a small, fast-decaying brightening. */
  impulse(strength = 0.12) {
    this.type = Math.min(1, this.type + strength);
    this.start(500);
  }

  /** Completion: a single expansion, then the core settles. */
  celebrate() {
    if (this.reduced) return;
    this.burstAge = 0;
    this.start(2600);
  }

  /** Where the core lives on the page. A new anchor after the first makes the core glide there. */
  setAnchor(el: HTMLElement | null) {
    if (el === this.anchor) return;
    this.anchor = el;
    this.presenceTarget = el ? 1 : 0;
    if (el && this.hasPos) this.glideUntil = performance.now() + 1100;
    this.start(1300);
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
    if (reduced) this.burstAge = -1;
    this.start(600);
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
    const gl = this.gl;
    if (!gl.isContextLost()) {
      gl.deleteBuffer(this.pointBuf);
      gl.deleteVertexArray(this.pointVao);
      gl.deleteVertexArray(this.emptyVao);
      gl.deleteProgram(this.scene);
      gl.deleteProgram(this.points);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
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

  private onScroll = () => this.start(200);

  private onPointer = (e: PointerEvent) => {
    if (this.reduced || e.pointerType === "touch") return;
    this.pointerTarget = { x: (e.clientX / this.cssW) * 2 - 1, y: (e.clientY / this.cssH) * 2 - 1 };
    this.pointerActiveUntil = performance.now() + 700;
    this.start(700);
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
    this.cssW = Math.max(1, window.innerWidth);
    this.cssH = Math.max(1, window.innerHeight);
    // Cap the pixel count: the scene is soft, and DOM text stays crisp regardless.
    const maxPixels = this.lowPower ? 1.1e6 : 2.6e6;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = this.cssW * this.cssH * dpr * dpr;
    if (px > maxPixels) dpr *= Math.sqrt(maxPixels / px);
    this.dpr = Math.max(0.5, dpr);
    const w = Math.round(this.cssW * this.dpr);
    const h = Math.round(this.cssH * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** Keep frames coming for at least `ms`; after that the loop idles at a lower rate or stops (reduced motion). */
  private start(ms: number) {
    if (this.disposed) return;
    this.runUntil = Math.max(this.runUntil, performance.now() + (this.reduced ? Math.min(ms, 500) : ms));
    if (!this.raf && !document.hidden && !this.gl.isContextLost()) {
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  private busy(now: number): boolean {
    if (now < this.runUntil || now < this.pointerActiveUntil || now < this.glideUntil) return true;
    if (this.pulseAge < 1 || (this.burstAge >= 0 && this.burstAge < 1) || this.type > 0.01) return true;
    if (Math.abs(this.presence - this.presenceTarget) > 0.002 || Math.abs(this.sceneMix - this.sceneTarget()) > 0.002) return true;
    for (const k of KNOB_KEYS) if (Math.abs(this.cur[k] - this.target[k]) > 0.002) return true;
    return this.cur.energy > 0.6;
  }

  private sceneTarget() {
    return this.anchor?.dataset.coreSize === "compact" ? 1 : 0;
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed || document.hidden) return;
    const busy = this.busy(now);
    if (this.reduced) {
      // Reduced motion: no ambient animation; state changes land as single re-renders.
      this.step(1, now, true);
      this.draw();
      if (now < this.runUntil) this.raf = requestAnimationFrame(this.frame);
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
    if (!busy && now - this.lastDraw < 33) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.lastDraw = now;
    this.step(dt, now, false);
    this.draw();
  };

  private step(dt: number, now: number, instant: boolean) {
    const ease = (rate: number) => (instant ? 1 : 1 - Math.exp(-dt * rate));
    const kKnob = ease(2.4);
    for (const k of KNOB_KEYS) this.cur[k] += (this.target[k] - this.cur[k]) * (k === "organize" ? ease(1.6) : kKnob);
    this.presence += (this.presenceTarget - this.presence) * ease(1.5);
    this.progress += (this.progressTarget - this.progress) * ease(3);
    this.progVis += (this.progVisTarget - this.progVis) * ease(2.5);
    this.sceneMix += (this.sceneTarget() - this.sceneMix) * ease(2.2);
    if (!instant) {
      this.time += dt;
      this.spin += dt * this.cur.speed;
      this.flow += dt * (0.1 + this.cur.energy * 0.5);
      this.travel += dt * Math.max(0, this.cur.energy - 0.4) * 1.1;
      this.pulseAge = Math.min(1, this.pulseAge + dt / 1.15);
      if (this.burstAge >= 0) this.burstAge = this.burstAge + dt / 2.2 >= 1 ? -1 : this.burstAge + dt / 2.2;
      this.type *= Math.exp(-dt * 5);
      const kp = ease(3);
      this.pointer.x += (this.pointerTarget.x - this.pointer.x) * kp;
      this.pointer.y += (this.pointerTarget.y - this.pointer.y) * kp;
    } else {
      this.pulseAge = 1;
      this.type = 0;
    }
    if (this.anchor) {
      const rect = this.anchor.getBoundingClientRect();
      const compact = this.anchor.dataset.coreSize === "compact";
      const r = compact ? Math.min(rect.width, rect.height) / 5.6 : Math.min(rect.width / 5, rect.height / 2.55);
      const t = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r };
      if (!this.hasPos || instant || now >= this.glideUntil) {
        this.corePos = t;
        this.hasPos = true;
      } else {
        const k = ease(5.5);
        this.corePos = { x: this.corePos.x + (t.x - this.corePos.x) * k, y: this.corePos.y + (t.y - this.corePos.y) * k, r: this.corePos.r + (t.r - this.corePos.r) * k };
      }
    }
  }

  private draw() {
    const gl = this.gl;
    if (gl.isContextLost() || !this.hasPos) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const c = this.cur;
    const burst = this.burstAge;
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.scene);
    const s = this.sceneLoc;
    gl.uniform2f(s.uRes, w, h);
    gl.uniform1f(s.uDpr, w / this.cssW);
    gl.uniform1f(s.uTime, this.time);
    gl.uniform3f(s.uCore, this.corePos.x, this.corePos.y, Math.max(this.corePos.r, 1));
    gl.uniform1f(s.uPresence, this.presence);
    gl.uniform1f(s.uEnergy, c.energy);
    gl.uniform1f(s.uAlert, c.alert);
    gl.uniform1f(s.uOrganize, c.organize);
    gl.uniform1f(s.uSpin, this.spin);
    gl.uniform1f(s.uFlow, this.flow);
    gl.uniform1f(s.uTravel, this.travel);
    gl.uniform1f(s.uProgress, this.progress);
    gl.uniform1f(s.uSteps, this.steps);
    gl.uniform1f(s.uProgVis, this.progVis * this.sceneMix);
    gl.uniform1f(s.uPulse, this.pulseStrength);
    gl.uniform1f(s.uPulseAge, this.pulseAge);
    gl.uniform1f(s.uBurst, burst);
    gl.uniform1f(s.uWarn, c.warn);
    gl.uniform1f(s.uErr, c.err);
    gl.uniform1f(s.uOk, c.ok);
    gl.uniform1f(s.uDim, c.dim);
    gl.uniform1f(s.uScan, c.scan);
    gl.uniform1f(s.uScene, this.sceneMix);
    gl.uniform1f(s.uType, this.type);
    gl.uniform2f(s.uPointer, this.pointer.x, this.pointer.y);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.points);
    const p = this.pointLoc;
    gl.uniform2f(p.uView, this.cssW, this.cssH);
    gl.uniform1f(p.uDpr, w / this.cssW);
    gl.uniform1f(p.uTime, this.time);
    gl.uniform3f(p.uCore, this.corePos.x, this.corePos.y, Math.max(this.corePos.r, 1));
    gl.uniform1f(p.uPresence, this.presence);
    gl.uniform1f(p.uEnergy, c.energy);
    gl.uniform1f(p.uAlert, c.alert);
    gl.uniform1f(p.uOrganize, c.organize);
    gl.uniform1f(p.uSpin, this.spin);
    gl.uniform1f(p.uFlow, this.flow);
    gl.uniform1f(p.uPulse, this.pulseStrength);
    gl.uniform1f(p.uPulseAge, this.pulseAge);
    gl.uniform1f(p.uBurst, burst);
    gl.uniform1f(p.uDim, c.dim);
    gl.uniform1f(p.uWarn, c.warn);
    gl.uniform1f(p.uErr, c.err);
    gl.uniform1f(p.uOk, c.ok);
    gl.uniform1f(p.uScene, this.sceneMix);
    gl.uniform2f(p.uPointer, this.pointer.x, this.pointer.y);
    gl.bindVertexArray(this.pointVao);
    gl.drawArrays(gl.POINTS, 0, this.pointCount);
    gl.bindVertexArray(null);
  }
}
