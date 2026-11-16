// Rocket Soccer rendering: arena (one procedural rounded-box mesh + goal boxes, with a field shader that draws the
// pitch, glowing lines, team-tinted walls and a see-through upper wall), cars, ball, boost pads, sky and lights.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { sdRoom, glslArena } from './arena.js';
import { C } from './physics.js';

export const TEAM = [
  { name: 'BLUE', css: '#2f86ff', hex: 0x2f86ff, light: 0x7cc0ff, glow: 0x45a0ff, dark: 0x123a8a, emoji: '🔵' },
  { name: 'ORANGE', css: '#ff8a1f', hex: 0xff8a1f, light: 0xffc07a, glow: 0xff9a30, dark: 0x8a3a08, emoji: '🟠' },
];
const MOODS = {
  sunset: { skyTop: 0x2f6bff, skyMid: 0x8fb8ff, skyLow: 0xffb36b, sun: 0xffe2b0, grassA: 0x3fbf4f, grassB: 0x36ad45, fog: 0xbfc8ff, hemiSky: 0xcfe2ff, hemiGround: 0x4a7a3a, sunI: 2.1, hemiI: 1.25 },
  night: { skyTop: 0x0b1240, skyMid: 0x27306e, skyLow: 0x8a4fa0, sun: 0xd8e4ff, grassA: 0x2fa84a, grassB: 0x2a9a43, fog: 0x2b2f6a, hemiSky: 0x9fb4ff, hemiGround: 0x2a3a40, sunI: 1.6, hemiI: 1.1 },
};

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const GRAD = (() => { const t = new THREE.DataTexture(new Uint8Array([80, 160, 255]), 3, 1, THREE.RedFormat); t.needsUpdate = true; return t; })();
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: GRAD, ...extra });

// ------------------------------------------------------------------ arena geometry
function axisSamples(E, r, flat, curve) {
  const a = [];
  for (let k = 0; k <= curve; k++) a.push(-E + (r * k) / curve);
  const n = Math.max(1, Math.round((2 * (E - r)) / flat));
  for (let k = 1; k < n; k++) a.push(-E + r + ((2 * (E - r)) * k) / n);
  for (let k = curve; k >= 0; k--) a.push(E - (r * k) / curve);
  return a;
}
function roomGeometry(A) {
  const pos = [], nor = [], idx = [];
  const E = [A.W, A.H / 2, A.L];
  const S = [axisSamples(A.W, A.r, 4, 7), axisSamples(A.H / 2, A.r, 4, 7), axisSamples(A.L, A.r, 4, 7)];
  const b = [A.bx, A.by, A.bz], g = [0, 0, 0];
  for (let ax = 0; ax < 3; ax++) for (const s of [-1, 1]) {
    const u = (ax + 1) % 3, w = (ax + 2) % 3, base = pos.length / 3;
    const su = S[u], sw = S[w];
    for (let j = 0; j < sw.length; j++) for (let i = 0; i < su.length; i++) {
      const p = [0, 0, 0]; p[ax] = s * E[ax]; p[u] = su[i]; p[w] = sw[j];
      // round: clamp to the inner box, push out by r
      const c = p.map((v, k) => Math.max(-b[k], Math.min(b[k], v)));
      let dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2]; const l = Math.hypot(dx, dy, dz) || 1;
      const x = c[0] + (dx / l) * A.r, y = c[1] + (dy / l) * A.r + A.cy, z = c[2] + (dz / l) * A.r;
      pos.push(x, y, z);
      sdRoom(A, x, y, z, g); nor.push(-g[0], -g[1], -g[2]);
    }
    const nu = su.length;
    const faceIdx = [];
    for (let j = 0; j < sw.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a0 = base + j * nu + i, a1 = a0 + 1, a2 = a0 + nu, a3 = a2 + 1;
      faceIdx.push(a0, a2, a1, a1, a2, a3);
    }
    // make the face point inward (toward the free space)
    const t = faceIdx, P = (k) => v3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    const mid = Math.floor(t.length / 6) * 3;
    const n = P(t[mid + 1]).sub(P(t[mid])).cross(P(t[mid + 2]).sub(P(t[mid])));
    const want = v3(nor[t[mid] * 3], nor[t[mid] * 3 + 1], nor[t[mid] * 3 + 2]);
    if (n.dot(want) < 0) for (let k = 0; k < t.length; k += 3) { const tmp = t[k + 1]; t[k + 1] = t[k + 2]; t[k + 2] = tmp; }
    idx.push(...t);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}
// goal box interior for one side (s = -1 blue goal, +1 orange goal): floor, two sides, roof and the back net
function goalGeometry(A, s) {
  const pos = [], nor = [], idx = [];
  const z0 = A.gz0 * s, z1 = A.gz1 * s;
  const quad = (p0, p1, p2, p3, n, segU = 12, segV = 6) => {
    const base = pos.length / 3;
    for (let j = 0; j <= segV; j++) for (let i = 0; i <= segU; i++) {
      const u = i / segU, v = j / segV;
      const a = p0.clone().lerp(p1, u), bb = p3.clone().lerp(p2, u), p = a.lerp(bb, v);
      pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z);
    }
    const t = [];
    for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) { const a0 = base + j * (segU + 1) + i, a1 = a0 + 1, a2 = a0 + segU + 1, a3 = a2 + 1; t.push(a0, a2, a1, a1, a2, a3); }
    const P = (k) => v3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    const cn = P(t[1]).sub(P(t[0])).cross(P(t[2]).sub(P(t[0])));
    if (cn.dot(n) < 0) for (let k = 0; k < t.length; k += 3) { const tmp = t[k + 1]; t[k + 1] = t[k + 2]; t[k + 2] = tmp; }
    idx.push(...t);
  };
  const G = A.GW, H = A.GH;
  quad(v3(-G, 0, z0), v3(G, 0, z0), v3(G, 0, z1), v3(-G, 0, z1), v3(0, 1, 0), 12, 10);         // floor
  quad(v3(-G, H, z0), v3(G, H, z0), v3(G, H, z1), v3(-G, H, z1), v3(0, -1, 0), 12, 10);        // roof
  quad(v3(-G, 0, z0), v3(-G, 0, z1), v3(-G, H, z1), v3(-G, H, z0), v3(1, 0, 0), 12, 8);        // side
  quad(v3(G, 0, z0), v3(G, 0, z1), v3(G, H, z1), v3(G, H, z0), v3(-1, 0, 0), 12, 8);           // side
  quad(v3(-G, 0, z1), v3(G, 0, z1), v3(G, H, z1), v3(-G, H, z1), v3(0, 0, -s), 12, 8);         // back net
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}

const hex3 = (h) => { const c = new THREE.Color(h); return `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`; };
function fieldGLSL(A, mood) {
  const f = (v) => v.toFixed(2);
  return glslArena(A) + `
uniform float uTime; uniform float uPulseA; uniform float uPulseB;
float lineAA(float d, float w){ return 1.0 - smoothstep(w * 0.6, w, abs(d)); }
float hexEdge(vec2 p){
  p /= 2.6; vec2 r = vec2(1.0, 1.732); vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h; vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g); float e = max(q.x * 0.866 + q.y * 0.5, q.y);
  return smoothstep(0.40, 0.47, e);
}
void fieldColor(vec3 p, inout vec3 col, out vec3 em, out float alpha){
  em = vec3(0.0); alpha = 1.0;
  vec3 tA = ${hex3(TEAM[0].hex)}, tB = ${hex3(TEAM[1].hex)};
  float side = smoothstep(-6.0, 6.0, p.z);
  vec3 team = mix(tA, tB, side);
  float pulse = mix(uPulseA, uPulseB, side);
  if (p.y < 0.35) {
    // pitch: mowing stripes + glowing lines
    float st = step(0.5, fract(p.z / 7.0));
    col = mix(${hex3(mood.grassA)}, ${hex3(mood.grassB)}, st);
    float w = 0.28, ln = 0.0;
    ln = max(ln, lineAA(p.z, w));
    ln = max(ln, lineAA(length(p.xz) - 9.0, w));
    ln = max(ln, lineAA(length(p.xz), 0.9));
    float inF = step(abs(p.z), ${f(A.bz)}) * step(abs(p.x), ${f(A.bx)});
    ln = max(ln, lineAA(abs(p.x) - ${f(A.bx - 1)}, w) * step(abs(p.z), ${f(A.bz - 1)}));
    ln = max(ln, lineAA(abs(p.z) - ${f(A.bz - 1)}, w) * step(abs(p.x), ${f(A.bx - 1)}));
    float bxw = ${f(A.GW + 6)}, bz0 = ${f(A.bz - 13)};
    ln = max(ln, lineAA(abs(p.x) - bxw, w) * step(bz0, abs(p.z)) * step(abs(p.z), ${f(A.bz - 1)}));
    ln = max(ln, lineAA(abs(p.z) - bz0, w) * step(abs(p.x), bxw));
    vec3 lc = mix(vec3(1.0), team * 1.2 + 0.3, 0.25 + 0.75 * smoothstep(${f(A.bz - 16)}, ${f(A.bz - 2)}, abs(p.z)));
    col = mix(col, vec3(1.0), ln * 0.85);
    em += lc * ln * (0.55 + pulse * 1.5);
    // goal-mouth glow on the grass
    float gm = step(abs(p.x), ${f(A.GW)}) * smoothstep(${f(A.gz0 - 6)}, ${f(A.gz0)}, abs(p.z));
    em += team * gm * (0.25 + pulse);
    return;
  }
  // walls: team-tinted panels below the curve top, see-through hex glass above
  float hy = ${f(A.r)};
  vec3 base = mix(team * 0.55 + vec3(0.12), vec3(0.95), 0.18);
  if (p.y < hy + 0.2) {
    float pan = step(0.94, fract((p.x + p.z) / 6.0)) + step(0.94, fract(p.y / 3.5));
    col = mix(base, base * 0.75, clamp(pan, 0.0, 1.0));
    float trim = lineAA(p.y - hy, 0.35);
    em += team * trim * (1.6 + pulse * 2.0);
    col = mix(col, vec3(1.0), trim * 0.5);
    return;
  }
  float hx = hexEdge(abs(p.x) > ${f(A.W - 0.5)} ? p.zy : abs(p.z) > ${f(A.L - 0.5)} ? p.xy : p.xz);
  float top = smoothstep(${f(A.H - A.r * 0.6)}, ${f(A.H)}, p.y);
  col = mix(team * 0.5 + 0.25, vec3(1.0), hx * 0.6);
  alpha = mix(0.16, 0.6, hx) * (1.0 - top * 0.7);
  em += team * hx * (0.35 + pulse);
}
`;
}
function fieldMaterial(A, mood, kind, uniforms) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, side: THREE.FrontSide, depthWrite: true });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const keep = kind === 'room' ? 'if (inGoalCarve(vW)) discard;' : 'if (sdRoomG(vW) < -0.02) discard;';
    const net = kind === 'goal' ? `
      { float zz = abs(vW.z) - ${A.L.toFixed(2)};
        if (zz > 0.0) { vec2 q = abs(vW.z) > ${(A.gz1 - 0.05).toFixed(2)} ? vW.xy : (abs(abs(vW.x) - ${A.GW.toFixed(2)}) < 0.05 ? vec2(vW.z, vW.y) : vW.xz);
          float g = max(lineAA(fract(q.x / 1.1) - 0.5, 0.06) , lineAA(fract(q.y / 1.1) - 0.5, 0.06));
          vec3 tc = vW.z < 0.0 ? ${hex3(TEAM[0].hex)} : ${hex3(TEAM[1].hex)}; float pl = vW.z < 0.0 ? uPulseA : uPulseB;
          if (vW.y > 0.3) { diffuseColor.rgb = mix(tc * 0.25, vec3(1.0), g * 0.8); fEm = tc * (0.25 + g * (0.9 + pl * 2.5)); fA = 0.55 + g * 0.45; } } }` : '';
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;\n' + fieldGLSL(A, mood))
      .replace('#include <color_fragment>', `#include <color_fragment>\n${keep}\nvec3 fEm; float fA; fieldColor(vW, diffuseColor.rgb, fEm, fA);${net}\ndiffuseColor.a *= fA;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEm;');
  };
  mat.customProgramCacheKey = () => 'rs-field-' + kind + '-' + A.key + '-' + mood.grassA;
  return mat;
}

// ------------------------------------------------------------------ cars
const CAR_GEO = {
  body: new THREE.BoxGeometry(2.15, 0.55, 3.15),
  nose: new THREE.BoxGeometry(2.0, 0.32, 0.9),
  glass: new THREE.BoxGeometry(1.4, 0.36, 0.08),
  stripe: new THREE.BoxGeometry(0.42, 0.06, 3.18),
  wheel: new THREE.CylinderGeometry(0.44, 0.44, 0.38, 16),
  rim: new THREE.CylinderGeometry(0.22, 0.22, 0.4, 10),
  spoiler: new THREE.BoxGeometry(1.9, 0.08, 0.42),
  strut: new THREE.BoxGeometry(0.1, 0.32, 0.1),
  flame: new THREE.ConeGeometry(0.28, 1.6, 10, 1, true),
  shadow: new THREE.CircleGeometry(1, 20),
};
CAR_GEO.wheel.rotateZ(Math.PI / 2); CAR_GEO.rim.rotateZ(Math.PI / 2);
CAR_GEO.flame.rotateX(-Math.PI / 2); CAR_GEO.flame.translate(0, 0, -0.8); CAR_GEO.shadow.rotateX(-Math.PI / 2);
const SHARED = new Set(Object.values(CAR_GEO));
const INK = new THREE.MeshBasicMaterial({ color: 0x17112e, side: THREE.BackSide });
const DARK = toon(0x232033), GLASS = toon(0x1a2440, { emissive: 0x0a1630 });
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
for (const m of [INK, DARK, GLASS, SHADOW_MAT]) SHARED.add(m);

function outlined(geo, mat, s = 1.07) { const g = new THREE.Group(); const m = new THREE.Mesh(geo, mat); m.castShadow = true; const o = new THREE.Mesh(geo, INK); o.scale.setScalar(s); g.add(m, o); g.userData.mesh = m; return g; }

export function buildCar(ctx, r) {
  const team = TEAM[r.team];
  const own = [];
  const bodyM = toon(team.hex), accentM = toon(r.colorHex, { emissive: new THREE.Color(r.colorHex).multiplyScalar(0.25) }), lightM = toon(team.light);
  const flameM = new THREE.MeshBasicMaterial({ color: new THREE.Color(team.glow).lerp(new THREE.Color(0xffffff), 0.35), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  own.push(bodyM, accentM, lightM, flameM);
  const root = new THREE.Group();
  const rig = new THREE.Group(); root.add(rig);
  const body = outlined(CAR_GEO.body, bodyM, 1.06); body.position.set(0, -0.12, 0); rig.add(body);
  const nose = outlined(CAR_GEO.nose, lightM); nose.position.set(0, -0.2, 1.75); rig.add(nose);
  // open cockpit: a roll bar + windscreen, and the player's own avatar at the wheel (keeps their look in the car)
  const glass = new THREE.Mesh(CAR_GEO.glass, GLASS); glass.position.set(0, 0.32, 0.55); glass.rotation.x = -0.5; rig.add(glass);
  for (const sx of [-0.55, 0.55]) { const st = new THREE.Mesh(CAR_GEO.stripe, accentM); st.position.set(sx, 0.17, 0); rig.add(st); }
  const bar = outlined(CAR_GEO.spoiler, accentM); bar.scale.set(0.85, 1.2, 0.5); bar.position.set(0, 0.62, -0.62); rig.add(bar);
  for (const sx of [-0.72, 0.72]) { const s = new THREE.Mesh(CAR_GEO.strut, DARK); s.scale.set(1, 1.5, 1); s.position.set(sx, 0.38, -0.62); rig.add(s); }
  const sp = outlined(CAR_GEO.spoiler, accentM); sp.position.set(0, 0.48, -1.5); rig.add(sp);
  for (const sx of [-0.7, 0.7]) { const s = new THREE.Mesh(CAR_GEO.strut, DARK); s.position.set(sx, 0.28, -1.45); rig.add(s); }
  const driver = ctx.avatar.build(r); driver.scale.setScalar(0.62); driver.position.set(0, -0.62, -0.15); rig.add(driver);
  driver.userData.setPose?.({ run: 0, t: 0 });
  const wheels = [];
  for (const [x, z] of [[-1.05, 1.0], [1.05, 1.0], [-1.05, -1.05], [1.05, -1.05]]) {
    const w = new THREE.Group(); w.position.set(x, -0.42, z);
    const t = outlined(CAR_GEO.wheel, DARK, 1.08); const rim = new THREE.Mesh(CAR_GEO.rim, accentM);
    w.add(t, rim); rig.add(w); wheels.push(w);
  }
  const flames = [];
  for (const sx of [-0.45, 0.45]) { const f = new THREE.Mesh(CAR_GEO.flame, flameM); f.position.set(sx, -0.05, -1.6); f.visible = false; rig.add(f); flames.push(f); }
  rig.traverse((o) => { if (o.isMesh && o.material !== flameM && o.material.side !== THREE.BackSide) o.castShadow = true; });
  const shadow = new THREE.Mesh(CAR_GEO.shadow, SHADOW_MAT); shadow.scale.set(1.3, 1, 1.8); shadow.renderOrder = 1;
  return { root, rig, wheels, flames, flameM, shadow, driver, own, spin: 0 };
}
function disposeCar(ctx, v) {
  ctx.avatar.dispose(v.driver);
  for (const m of v.own) m.dispose();
  v.root.removeFromParent(); v.shadow.removeFromParent();
}

// ------------------------------------------------------------------ ball
function buildBall() {
  const geo = new THREE.IcosahedronGeometry(C.BALL_R, 5);
  const ico = new THREE.IcosahedronGeometry(1, 0), dirs = [];
  const pa = ico.getAttribute('position');
  for (let i = 0; i < pa.count; i++) { const d = v3(pa.getX(i), pa.getY(i), pa.getZ(i)).normalize(); if (!dirs.some((e) => e.distanceTo(d) < 1e-3)) dirs.push(d); }
  ico.dispose();
  const p = geo.getAttribute('position'), col = new Float32Array(p.count * 3), n = v3();
  for (let i = 0; i < p.count; i++) {
    n.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    let best = -1; for (const d of dirs) best = Math.max(best, n.dot(d));
    const dark = best > 0.94 ? 1 : 0, seam = best > 0.925 && best <= 0.94 ? 1 : 0;
    const c = dark ? [0.16, 0.13, 0.3] : seam ? [0.55, 0.55, 0.7] : [1, 1, 1];
    col.set(c, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = toon(0xffffff, { vertexColors: true, emissive: 0x222233 });
  const m = new THREE.Mesh(geo, mat); m.castShadow = true;
  const out = new THREE.Mesh(geo, INK); out.scale.setScalar(1.05); m.add(out);
  const g = new THREE.Group(); g.add(m);
  return { root: g, mesh: m, geo, mat };
}

// ------------------------------------------------------------------ world
export function createView(ctx, A, roster) {
  const mood = MOODS[A.mood] || MOODS.sunset;
  const renderer = ctx.three.createRenderer();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.3, 900);
  scene.fog = new THREE.Fog(mood.fog, 220, 560);
  const own = [];   // per-round geometries/materials to dispose
  const keep = new Set([...SHARED, ...Object.values(CAR_GEO)]);
  // sky: vertical gradient dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(mood.skyTop) }, mid: { value: new THREE.Color(mood.skyMid) }, low: { value: new THREE.Color(mood.skyLow) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top, mid, low; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(low, mid, smoothstep(-0.1, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), skyMat); sky.renderOrder = -1; scene.add(sky);
  own.push(sky.geometry, skyMat);
  // lights
  const hemi = new THREE.HemisphereLight(mood.hemiSky, mood.hemiGround, mood.hemiI); scene.add(hemi);
  const sun = new THREE.DirectionalLight(mood.sun, mood.sunI);
  sun.position.set(-40, 90, -30); sun.target.position.set(0, 0, 0); scene.add(sun, sun.target);
  const Q = ctx.quality();
  sun.castShadow = Q.shadows; sun.shadow.mapSize.set(Q.shadowMap || 1024, Q.shadowMap || 1024);
  Object.assign(sun.shadow.camera, { left: -A.W - 6, right: A.W + 6, top: A.L + 12, bottom: -A.L - 12, near: 10, far: 260 });
  sun.shadow.bias = -0.0008;
  // arena
  const uniforms = { uTime: { value: 0 }, uPulseA: { value: 0 }, uPulseB: { value: 0 } };
  const roomGeo = roomGeometry(A), roomMat = fieldMaterial(A, mood, 'room', uniforms);
  const room = new THREE.Mesh(roomGeo, roomMat); room.receiveShadow = true; room.renderOrder = 2; scene.add(room);
  own.push(roomGeo, roomMat);
  const goalMat = fieldMaterial(A, mood, 'goal', uniforms); own.push(goalMat);
  for (const s of [-1, 1]) { const gg = goalGeometry(A, s); own.push(gg); const gm = new THREE.Mesh(gg, goalMat); gm.receiveShadow = true; gm.renderOrder = 2; scene.add(gm); }
  // goal frames (posts + crossbar) glowing in the defending team's colour
  const postGeo = new THREE.CylinderGeometry(0.42, 0.42, A.GH, 12), barGeo = new THREE.CylinderGeometry(0.42, 0.42, A.GW * 2 + 0.84, 12);
  barGeo.rotateZ(Math.PI / 2); own.push(postGeo, barGeo);
  const frameMats = TEAM.map((t) => { const m = toon(t.light, { emissive: new THREE.Color(t.glow).multiplyScalar(0.9) }); own.push(m); return m; });
  [-1, 1].forEach((s) => {
    const m = frameMats[s < 0 ? 0 : 1];
    for (const x of [-A.GW, A.GW]) { const p = new THREE.Mesh(postGeo, m); p.position.set(x, A.GH / 2, s * A.L); scene.add(p); }
    const bar = new THREE.Mesh(barGeo, m); bar.position.set(0, A.GH, s * A.L); scene.add(bar);
  });
  // boost pads
  const padGeoS = new THREE.CylinderGeometry(0.9, 1.1, 0.12, 16), padGeoB = new THREE.CylinderGeometry(1.7, 2.0, 0.16, 20);
  const orbGeo = new THREE.SphereGeometry(0.9, 16, 10), orbGeoS = new THREE.SphereGeometry(0.42, 10, 8);
  own.push(padGeoS, padGeoB, orbGeo, orbGeoS);
  const padBase = toon(0x2b2350), orbOn = new THREE.MeshBasicMaterial({ color: 0xffd23f }), orbOnS = new THREE.MeshBasicMaterial({ color: 0xffe680 });
  own.push(padBase, orbOn, orbOnS);
  const pads = A.pads.map((pd) => {
    const g = new THREE.Group(); g.position.set(pd.x, 0.02, pd.z);
    const base = new THREE.Mesh(pd.big ? padGeoB : padGeoS, padBase); base.receiveShadow = true; g.add(base);
    const orb = new THREE.Mesh(pd.big ? orbGeo : orbGeoS, pd.big ? orbOn : orbOnS); orb.position.y = pd.big ? 1.5 : 0.5; g.add(orb);
    scene.add(g); return { g, orb, big: pd.big };
  });
  // ball
  const ball = buildBall(); own.push(ball.geo, ball.mat); scene.add(ball.root);
  const ballShadow = new THREE.Mesh(CAR_GEO.shadow, SHADOW_MAT); ballShadow.scale.setScalar(C.BALL_R * 0.95); scene.add(ballShadow);
  // cars
  const cars = roster.map((r) => { const v = buildCar(ctx, r); scene.add(v.root, v.shadow); return v; });

  // post-processing (High only): bloom on the glowing lines, boost and goal explosions
  let composer = null, bloom = null;
  function setupComposer() {
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); bloom?.dispose(); composer = null; bloom = null; }
    if (!ctx.quality().effects) return;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight;
    bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.55, 0.5, 0.86);
    composer.addPass(bloom); composer.addPass(new OutputPass());
    composer.setSize(w, h);
  }
  setupComposer();
  function resize() {
    const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); composer?.setSize(w, h);
  }
  resize();
  return {
    scene, camera, renderer, cars, ball, ballShadow, pads, uniforms, sun, mood,
    resize,
    setQuality() { ctx.three.applyQuality(renderer, sun); setupComposer(); resize(); },
    render() { if (composer) composer.render(); else renderer.render(scene, camera); },
    setBloom(k) { if (bloom) bloom.strength = k; },
    dispose() {
      if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); bloom?.dispose(); }
      for (const v of cars) disposeCar(ctx, v);
      ctx.three.dispose(scene, keep);
      for (const d of own) d.dispose?.();
    },
  };
}
