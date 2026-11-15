// Mini-Golf Battle — procedural graphics: textures, materials, scenery, particles (no asset files)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as C from './course.js';

// ---------------------------------------------------------------- texture helpers
function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeat[0], repeat[1]);
  return t;
}
const rnd = (() => { let s = 1234567; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
function speckle(g, w, h, n, colors, size = 1) {
  for (let i = 0; i < n; i++) { g.fillStyle = colors[Math.floor(rnd() * colors.length)]; g.fillRect(rnd() * w, rnd() * h, size, size); }
}

// putting-green felt with mowing stripes along v (lateral = u)
const turfMap = canvasTex(256, 256, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, '#4fc24f'); grd.addColorStop(0.46, '#4fc24f'); grd.addColorStop(0.54, '#44b045'); grd.addColorStop(0.96, '#44b045'); grd.addColorStop(1, '#4fc24f');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 9000, ['rgba(255,255,255,.07)', 'rgba(0,40,0,.10)', 'rgba(180,255,120,.08)']);
});
const turfBump = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); speckle(g, w, h, 14000, ['#606060', '#a0a0a0', '#707070', '#909090']); }, { srgb: false });

const grassMap = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#4f8f36'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * w, y = rnd() * h, l = 3 + rnd() * 5;
    g.strokeStyle = ['#5ea341', '#457f2f', '#6aae49', '#3e7429'][Math.floor(rnd() * 4)];
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 2, y - l); g.stroke();
  }
}, { repeat: [90, 90] });

const woodMap = canvasTex(512, 128, (g, w, h) => {
  g.fillStyle = '#c08a52'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    const y = rnd() * h, a = 1 + rnd() * 3;
    g.strokeStyle = rnd() < 0.5 ? 'rgba(90,50,20,.25)' : 'rgba(255,220,170,.18)'; g.lineWidth = 1 + rnd() * 2;
    g.beginPath(); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.02 + i) * a); g.stroke();
  }
  g.fillStyle = 'rgba(70,35,10,.35)'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 2);
  for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(80,40,15,.35)'; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 6, 3, 0, 0, 7); g.fill(); }
});

const stoneMap = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#6d6a63'; g.fillRect(0, 0, w, h);
  const rowH = 32;
  for (let y = 0; y < h; y += rowH) {
    let x = -rnd() * 40;
    while (x < w) {
      const sw = 36 + rnd() * 40, v = 150 + Math.floor(rnd() * 50);
      g.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
      g.beginPath(); g.roundRect(x + 2, y + 2, sw - 4, rowH - 4, 5); g.fill();
      x += sw;
    }
  }
  speckle(g, w, h, 4000, ['rgba(0,0,0,.08)', 'rgba(255,255,255,.08)']);
});

const rubberMap = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#3f8a4a'; g.fillRect(0, 0, w, h); speckle(g, w, h, 3000, ['#357a40', '#4a9a55', '#2f6e39'], 2); g.strokeStyle = '#e8f5e0'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3); });

const waterMap = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#2f8fe0'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(200,240,255,.45)'; g.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const cx = rnd() * w, cy = rnd() * h, r = 8 + rnd() * 18;
    g.beginPath(); g.arc(cx, cy, r, rnd() * 6, rnd() * 6 + 2); g.stroke();
  }
}, { repeat: [0.6, 0.6] });

const stripeMap = canvasTex(128, 32, (g, w) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e23b3b'; g.fillRect(i * w / 8, 0, w / 8, 32); } });
const hazardMap = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#f5c518'; g.fillRect(0, 0, w, h); g.fillStyle = '#222';
  for (let i = -h; i < w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 + h, h); g.lineTo(i + h, h); g.fill(); }
});
const crateMap = canvasTex(128, 128, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#ffd84a'); grd.addColorStop(1, '#f59e0b');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#b45309'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  g.font = 'bold 84px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#7c2d12'; g.strokeText('?', 64, 70); g.fillStyle = '#fff'; g.fillText('?', 64, 70);
});
const dimpleBump = canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  const r = 6;
  for (let y = 0, row = 0; y < h + r; y += r * 1.7, row++) for (let x = (row % 2) * r; x < w + r; x += r * 2) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, '#888'); gr.addColorStop(1, '#fff');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 0.9, 0, 7); g.fill();
  }
}, { srgb: false });
const cupMap = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, '#000'); gr.addColorStop(0.75, '#1a1a1a'); gr.addColorStop(1, '#4a4a4a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
const glowMap = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,230,120,1)'); gr.addColorStop(1, 'rgba(255,200,50,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
const cloudMap = canvasTex(256, 128, (g) => {
  for (let i = 0; i < 14; i++) {
    const x = 50 + rnd() * 156, y = 50 + rnd() * 40, r = 22 + rnd() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  }
});

// ---------------------------------------------------------------- materials
export const M = {
  turf: new THREE.MeshStandardMaterial({ map: turfMap, bumpMap: turfBump, bumpScale: 0.6, roughness: 0.95, side: THREE.DoubleSide }),
  grass: new THREE.MeshStandardMaterial({ map: grassMap, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.7 }),
  paint: new THREE.MeshStandardMaterial({ color: '#f6f1e7', roughness: 0.5 }),
  stone: new THREE.MeshStandardMaterial({ map: stoneMap, roughness: 0.9 }),
  pit: new THREE.MeshStandardMaterial({ color: '#2a1d12', roughness: 1 }),
  rubber: new THREE.MeshStandardMaterial({ map: rubberMap, roughness: 1 }),
  water: new THREE.MeshStandardMaterial({ map: waterMap, color: '#9fd8ff', transparent: true, opacity: 0.88, roughness: 0.08, metalness: 0.15 }),
  bumperSide: new THREE.MeshStandardMaterial({ map: stripeMap, roughness: 0.4 }),
  bumperTop: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35 }),
  hazard: new THREE.MeshStandardMaterial({ map: hazardMap, roughness: 0.5 }),
  slider: new THREE.MeshStandardMaterial({ color: '#3b82f6', roughness: 0.45 }),
  crate: new THREE.MeshStandardMaterial({ map: crateMap, emissive: '#ffffff', emissiveMap: crateMap, emissiveIntensity: 0.35, roughness: 0.5 }),
  glass: new THREE.MeshPhysicalMaterial({ color: '#cfefff', transparent: true, opacity: 0.3, roughness: 0.05, transmission: 0, metalness: 0 }),
  cup: new THREE.MeshBasicMaterial({ map: cupMap }),
  white: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 }),
  red: new THREE.MeshStandardMaterial({ color: '#e23b3b', roughness: 0.5 }),
};
// stone/wood get world-scaled UVs per mesh, so one shared material works everywhere

let envTex = null;
export function initEnv(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  M.water.envMap = envTex; M.water.envMapIntensity = 0.6;
  M.glass.envMap = envTex;
}
export function ballMaterial(color) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15, bumpMap: dimpleBump, bumpScale: 0.35, envMap: envTex, envMapIntensity: 0.7 });
}

// scale BoxGeometry/RoundedBox UVs to world units (1 texture repeat per `scale` metres)
export function worldUV(geo, w, h, d, scale = 1) {
  const uv = geo.attributes.uv, nrm = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    let su, sv;
    if (nx > 0.5) { su = d; sv = h; } else if (ny > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
    uv.setXY(i, uv.getX(i) * su / scale, uv.getY(i) * sv / scale);
  }
  uv.needsUpdate = true; return geo;
}
export function box(w, h, d, mat, { round = 0, uvScale = 0 } = {}) {
  const g = round ? new RoundedBoxGeometry(w, h, d, 2, Math.min(round, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)) : new THREE.BoxGeometry(w, h, d);
  if (uvScale) worldUV(g, w, h, d, uvScale);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
}

// ---------------------------------------------------------------- sky, clouds, hills
export function buildSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#3f8fdc') }, mid: { value: new THREE.Color('#8cc6f0') }, bot: { value: new THREE.Color('#dcefff') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.7, h)) : mix(bot, mid, smoothstep(-0.05, 0.15, h)); gl_FragColor = vec4(c, 1.0); }',
  }));
  sky.renderOrder = -10; scene.add(sky);
  const clouds = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudMap, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
    const a = rnd() * Math.PI * 2, r = 260 + rnd() * 200;
    s.position.set(Math.cos(a) * r, 55 + rnd() * 70, Math.sin(a) * r); s.scale.set(110 + rnd() * 80, 45 + rnd() * 25, 1);
    clouds.add(s);
  }
  scene.add(clouds);
  const hills = new THREE.Group();
  const hm = new THREE.MeshLambertMaterial({ color: '#4c8a3c' });
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2 + rnd() * 0.3, r = 170 + rnd() * 60;
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), hm);
    h.scale.set(50 + rnd() * 40, 14 + rnd() * 16, 50 + rnd() * 40); h.position.set(Math.cos(a) * r, -8, Math.sin(a) * r);
    hills.add(h);
  }
  scene.add(hills);
  return { sky, clouds, hills };
}

// ---------------------------------------------------------------- scenery around the course
const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.3, 6).translate(0, 0.65, 0);
const roundGeo = new THREE.IcosahedronGeometry(1, 1);
const pineGeo = new THREE.ConeGeometry(1, 2.2, 7);
const bushGeo = new THREE.IcosahedronGeometry(0.55, 1);
const rockGeo = new THREE.DodecahedronGeometry(0.45, 0);
const flowerGeo = new THREE.SphereGeometry(0.08, 6, 4);
const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
const trunkMat = new THREE.MeshStandardMaterial({ color: '#6b4426', roughness: 1 });
const rockMat = new THREE.MeshStandardMaterial({ color: '#9a978f', roughness: 0.95, flatShading: true });
const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });

export function buildScenery(hole, groundY) {
  const g = new THREE.Group();
  const R = C.rng(hole.seed ^ 0x9e3779b9);
  const T = C.T;
  const near = (x, z, m) => hole.tiles.some(t => Math.abs(x - t.cx) < T / 2 + m && Math.abs(z - t.cz) < T / 2 + m);
  const xs = hole.tiles.map(t => t.cx), zs = hole.tiles.map(t => t.cz);
  const x0 = Math.min(...xs) - 26, x1 = Math.max(...xs) + 26, z0 = Math.min(...zs) - 26, z1 = Math.max(...zs) + 26;
  const pts = (n, margin, maxTries = n * 20) => { const out = []; for (let i = 0; i < maxTries && out.length < n; i++) { const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0); if (!near(x, z, margin)) out.push([x, z]); } return out; };
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  const inst = (geo, mat, list, f) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); im.count = list.length;
    im.castShadow = true; im.receiveShadow = true;
    list.forEach((p, i) => { f(p, i); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); if (im.instanceColor || f.color) im.setColorAt(i, col); });
    g.add(im); return im;
  };
  // trees
  const trees = pts(50, 3.5);
  const kinds = trees.map(() => R() < 0.45 ? 'pine' : 'round');
  const scales = trees.map(() => 0.8 + R() * 0.9);
  inst(trunkGeo, trunkMat, trees, ([x, z], i) => { dummy.position.set(x, groundY, z); dummy.scale.setScalar(scales[i]); dummy.rotation.set(0, R() * 6, 0); });
  const roundT = trees.map((p, i) => [p, i]).filter(([, i]) => kinds[i] === 'round');
  const fr = (() => { const f = ([[x, z], i]) => { const s = scales[i]; dummy.position.set(x, groundY + 1.9 * s, z); dummy.scale.set(1.2 * s, 1.1 * s, 1.2 * s); dummy.rotation.set(R(), R() * 6, 0); col.setHSL(0.27 + R() * 0.06, 0.55, 0.32 + R() * 0.1); }; f.color = true; return f; })();
  inst(roundGeo, leafMat, roundT, fr);
  const pineT = trees.map((p, i) => [p, i]).filter(([, i]) => kinds[i] === 'pine');
  for (const lvl of [0, 1]) {
    const f = ([[x, z], i]) => { const s = scales[i]; dummy.position.set(x, groundY + (1.7 + lvl * 1.0) * s, z); dummy.scale.set((1.05 - lvl * 0.3) * s, s, (1.05 - lvl * 0.3) * s); dummy.rotation.set(0, R() * 6, 0); col.setHSL(0.33 + R() * 0.04, 0.5, 0.22 + R() * 0.06); };
    f.color = true; inst(pineGeo, leafMat, pineT, f);
  }
  // bushes hugging the course edges
  const bushes = [];
  for (const t of hole.tiles) for (const [dx, dz] of C.DIRS) {
    const nb = hole.tiles.find(o => o.gx === t.gx + dx && o.gz === t.gz + dz); if (nb) continue;
    const n = 1 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) { const off = (R() - 0.5) * (T - 0.8); bushes.push([t.cx + dx * (T / 2 + 0.7) - dz * off, t.cz + dz * (T / 2 + 0.7) + dx * off]); }
  }
  const fb = ([x, z]) => { const s = 0.7 + R() * 0.7; dummy.position.set(x, groundY + 0.3 * s, z); dummy.scale.set(s, s * 0.8, s); dummy.rotation.set(0, R() * 6, 0); col.setHSL(0.26 + R() * 0.08, 0.5, 0.28 + R() * 0.1); };
  fb.color = true; inst(bushGeo, leafMat, bushes, fb);
  // rocks
  inst(rockGeo, rockMat, pts(18, 1.5), ([x, z]) => { const s = 0.5 + R() * 1.4; dummy.position.set(x, groundY + 0.1, z); dummy.scale.set(s, s * 0.6, s); dummy.rotation.set(R(), R() * 6, R()); });
  // flower patches
  const flowers = [];
  for (const [cx, cz] of pts(16, 1.2)) for (let k = 0; k < 14; k++) flowers.push([cx + (R() - 0.5) * 1.8, cz + (R() - 0.5) * 1.8]);
  const palette = ['#ff6fa8', '#ffe14d', '#ffffff', '#b07bff', '#ff8a3d'];
  const ff = ([x, z]) => { dummy.position.set(x, groundY + 0.12, z); dummy.scale.setScalar(0.8 + R() * 0.6); dummy.rotation.set(0, 0, 0); col.set(palette[Math.floor(R() * palette.length)]); };
  ff.color = true; inst(flowerGeo, flowerMat, flowers.filter(([x, z]) => !near(x, z, 0.5)), ff);
  return g;
}

// ---------------------------------------------------------------- flag (waving cloth)
export function makeFlag(holeNum) {
  const tex = canvasTex(128, 80, (g, w, h) => {
    g.fillStyle = '#e62e2e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = 'bold 52px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(holeNum), w / 2 - 6, h / 2 + 2);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const geo = new THREE.PlaneGeometry(0.72, 0.45, 12, 4).translate(0.36, -0.225, 0);
  const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
  flag.castShadow = true;
  const base = Float32Array.from(geo.attributes.position.array);
  flag.userData.wave = t => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = base[i * 3]; p.setZ(i, Math.sin(x * 7 - t * 5) * 0.07 * x / 0.72); }
    p.needsUpdate = true; geo.computeVertexNormals();
  };
  return flag;
}

export const glowSprite = () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.set(1.3, 1.3, 1); return s; };

// ---------------------------------------------------------------- player labels
export function makeLabel(text, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = '600 30px Fredoka, system-ui, sans-serif';
  const tw = Math.min(220, g.measureText(text).width), w = tw + 52, x0 = (256 - w) / 2;
  g.fillStyle = 'rgba(15,30,20,.72)'; g.beginPath(); g.roundRect(x0, 10, w, 44, 22); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(x0 + 22, 32, 10, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, x0 + 40, 33, 220);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(1.5, 0.375, 1); sp.renderOrder = 10;
  return sp;
}

// ---------------------------------------------------------------- particles
export class Particles {
  constructor(scene, cap = 900) {
    this.cap = cap; this.n = 0;
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.grav = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false; scene.add(this.points);
    for (let i = 0; i < cap; i++) this.pos[i * 3 + 1] = -9999;
    this.i = 0;
  }
  emit(x, y, z, count, colors, speed = 3, up = 3, life = 1, grav = 9.8) {
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const i = this.i; this.i = (this.i + 1) % this.cap;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * s, up * (0.5 + Math.random() * 0.8), Math.sin(a) * s], i * 3);
      c.set(colors[Math.floor(Math.random() * colors.length)]); this.col.set([c.r, c.g, c.b], i * 3);
      this.life[i] = life * (0.6 + Math.random() * 0.6); this.grav[i] = grav;
    }
    this.points.geometry.attributes.color.needsUpdate = true;
  }
  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.vel[i * 3] *= 0.985; this.vel[i * 3 + 2] *= 0.985;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export function animate(t) { waterMap.offset.set(t * 0.03, t * 0.02); }
