// Mini-Golf Battle — procedural graphics in the party's cartoon style: toon shading, ink outlines, flat bold
// textures, themed worlds, scenery, weather, trails, particles and post-processing (no asset files)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as C from './course.js';

// ---------------------------------------------------------------- texture helpers
function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true, clamp = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeat[0], repeat[1]);
  return t;
}
const rnd = (() => { let s = 1234567; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
const dots = (g, w, h, n, color, r0, r1) => { g.fillStyle = color; for (let i = 0; i < n; i++) { g.beginPath(); g.arc(rnd() * w, rnd() * h, r0 + rnd() * (r1 - r0), 0, 7); g.fill(); } };

// Textures are near-white so each world tints them through material.color.
// felt: two crisp mowing stripes per repeat (the lane UVs repeat every 2.5 m, so 4 stripes across a 5 m lane)
const turfMap = canvasTex(128, 128, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, w, 0);   // two soft-edged mowing stripes per repeat (edges blurred so diagonals stay smooth)
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.42, '#ffffff'); grd.addColorStop(0.5, '#dedede'); grd.addColorStop(0.92, '#dedede'); grd.addColorStop(1, '#ffffff');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  dots(g, w, h, 70, 'rgba(0,0,0,.05)', 0.7, 1.5); dots(g, w, h, 50, 'rgba(255,255,255,.35)', 0.6, 1.3);
});
// grass: flat colour with sparse cartoon tufts and soft lighter patches
const groundMap = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#ececec'; g.fillRect(0, 0, w, h);
  // soft patches, drawn wrapped so the tile repeats seamlessly
  for (let i = 0; i < 9; i++) {
    const x = rnd() * w, y = rnd() * h, r = 40 + rnd() * 50;
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.fillStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.ellipse(x + ox, y + oy, r, r * 0.7, 0, 0, 7); g.fill(); }
  }
  g.fillStyle = '#d2d2d2';
  for (let i = 0; i < 8; i++) {
    const x = 20 + rnd() * (w - 40), y = 20 + rnd() * (h - 40);
    for (const [dx, lean, ht] of [[-6, -5, 14], [0, 0, 19], [6, 5, 14]]) { g.beginPath(); g.moveTo(x + dx - 3.5, y); g.quadraticCurveTo(x + dx, y - ht * 0.6, x + dx + lean, y - ht); g.quadraticCurveTo(x + dx + 1, y - ht * 0.5, x + dx + 3.5, y); g.fill(); }
  }
}, { repeat: [45, 45] });
// painted rail: flat colour, a bright top lip and one dark groove
const woodMap = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, 10);
  g.fillStyle = '#c9c9c9'; g.fillRect(0, h * 0.55, w, 4);
  g.fillStyle = '#d6d6d6'; g.fillRect(0, h - 8, w, 8);
});
// chunky cartoon bricks: big rounded blocks, dark grout, light top edges
const stoneMap = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, w, h);
  for (let y = 0, row = 0; y < h; y += 64, row++) {
    for (let x = row % 2 ? -56 : 0; x < w; x += 112) {
      const v = 228 + Math.floor(rnd() * 22);
      g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.roundRect(x + 4, y + 4, 104, 56, 12); g.fill();
      g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.roundRect(x + 10, y + 8, 92, 9, 5); g.fill();
    }
  }
});
const rubberMap = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#3cb04c'; g.fillRect(0, 0, w, h); g.fillStyle = '#35a045'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 8, h); g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); });
const sandMap = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#ffe2a0'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#f0c978'; g.lineWidth = 3;
  for (let y = 12; y < h; y += 26) { g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x / w * Math.PI * 4) * 4); g.stroke(); }
  dots(g, w, h, 30, '#e8b860', 1, 2.2);
});
const iceMap = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#cdeeff'; g.fillRect(0, 0, w, h);
  for (const [x, wd] of [[40, 34], [150, 20], [225, 42]]) {
    for (const ox of [-w, 0, w]) { const gr = g.createLinearGradient(x + ox, 0, x + ox + wd, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x + ox, 0, wd, h); }
  }
  g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 3; g.lineCap = 'round';
  for (const [x, y] of [[60, 70], [190, 150], [110, 215]]) { g.beginPath(); g.moveTo(x - 7, y); g.lineTo(x + 7, y); g.moveTo(x, y - 7); g.lineTo(x, y + 7); g.stroke(); }
});
const boostMap = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#ff7a1a'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#fff36b'; g.lineWidth = 10; g.lineJoin = 'round'; g.lineCap = 'round';
  for (const y of [14, 46]) { g.beginPath(); g.moveTo(10, y + 10); g.lineTo(32, y - 8); g.lineTo(54, y + 10); g.stroke(); }
});
// cartoon water: flat blue, white wave squiggles
const waterMap = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e6f6ff'; for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 32);
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 6; g.lineCap = 'round';
  for (let i = 0; i < 14; i++) { const x = rnd() * w, y = rnd() * h; g.beginPath(); g.arc(x, y, 9, Math.PI * 1.1, Math.PI * 1.9); g.arc(x + 16, y, 9, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
}, { repeat: [0.6, 0.6] });
const stripeMap = canvasTex(128, 32, (g, w) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#ff4d5e'; g.fillRect(i * w / 8, 0, w / 8, 32); } });
const hazardMap = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h); g.fillStyle = '#17112e';
  for (let i = -h; i < w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 + h, h); g.lineTo(i + h, h); g.fill(); }
});
const crateMap = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffe680'; g.fillRect(0, 0, w, h * 0.35);
  g.strokeStyle = '#17112e'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  g.font = "86px 'Lilita One', sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 12; g.lineJoin = 'round'; g.strokeStyle = '#17112e'; g.strokeText('?', 64, 70); g.fillStyle = '#fff'; g.fillText('?', 64, 70);
});
const cupMap = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, '#05030c'); gr.addColorStop(0.8, '#17112e'); gr.addColorStop(1, '#2b2350'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
const dotMap = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.62, '#fff'); gr.addColorStop(0.72, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, { clamp: true });
const glowMap = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, { clamp: true });
// puffy cartoon cloud: crisp overlapping circles, flat bottom, a soft shaded underside
const cloudMap = canvasTex(256, 128, (g) => {
  const puffs = [[70, 82, 34], [112, 60, 44], [160, 70, 38], [196, 86, 28], [128, 90, 30]];
  g.fillStyle = '#dfe9f7'; for (const [x, y, r] of puffs) { g.beginPath(); g.arc(x, y + 6, r, 0, 7); g.fill(); }
  g.fillStyle = '#ffffff'; for (const [x, y, r] of puffs) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  g.clearRect(0, 112, 256, 16);
}, { clamp: true });
// soft round shadow under each ball (reads on every quality level, even without shadow maps)
const blobMap = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, { clamp: true, srgb: false });
function swirlTex(c1, c2) {
  return canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, c1); gr.addColorStop(0.8, c2); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 6; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) { g.beginPath(); for (let a = 0; a < 5; a += 0.15) { const r = 6 + a * 10, x = 64 + Math.cos(a + k * 2.1) * r, y = 64 + Math.sin(a + k * 2.1) * r; a ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  }, { clamp: true });
}

// ---------------------------------------------------------------- toon materials (shared; tinted per theme)
const GRAD = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter; GRAD.needsUpdate = true;
export const toon = (o = {}) => new THREE.MeshToonMaterial({ gradientMap: GRAD, ...o });
export const M = {
  turf: toon({ map: turfMap, side: THREE.DoubleSide }),
  grass: toon({ map: groundMap }),
  wood: toon({ map: woodMap }),
  paint: toon({ color: '#fff7ea' }),
  stone: toon({ map: stoneMap }),
  pit: toon({ color: '#3a2a1c' }),
  rubber: toon({ map: rubberMap }),
  sand: toon({ map: sandMap }),
  ice: toon({ map: iceMap, transparent: true, opacity: 0.95 }),
  boost: toon({ map: boostMap, emissive: '#ffffff', emissiveMap: boostMap, emissiveIntensity: 0.55 }),
  water: toon({ map: waterMap, transparent: true, opacity: 0.92 }),
  bumperSide: toon({ map: stripeMap }),
  bumperTop: toon({ color: '#ffffff' }),
  hazard: toon({ map: hazardMap }),
  crate: toon({ map: crateMap, emissive: '#ffffff', emissiveMap: crateMap, emissiveIntensity: 0.3 }),
  glass: new THREE.MeshBasicMaterial({ color: '#cfefff', transparent: true, opacity: 0.28, depthWrite: false }),
  cup: new THREE.MeshBasicMaterial({ map: cupMap }),
  white: toon({ color: '#ffffff' }),
  red: toon({ color: '#ff4d5e' }),
  gold: toon({ color: '#ffcf3a', emissive: '#5a3c00', emissiveIntensity: 0.4 }),
  silver: toon({ color: '#dbe4ee', emissive: '#2a3340', emissiveIntensity: 0.3 }),
  bronze: toon({ color: '#ea9a5a', emissive: '#4a2008', emissiveIntensity: 0.3 }),
  portalA: new THREE.MeshBasicMaterial({ map: swirlTex('#5ad1ff', '#2f5bff'), transparent: true, depthWrite: false }),
  portalB: new THREE.MeshBasicMaterial({ map: swirlTex('#ffc04d', '#ff5a2f'), transparent: true, depthWrite: false }),
  ringA: new THREE.MeshBasicMaterial({ color: '#7fdcff' }),
  ringB: new THREE.MeshBasicMaterial({ color: '#ffb347' }),
  mine: toon({ color: '#3a3550' }),
  mineLight: new THREE.MeshBasicMaterial({ color: '#ff3030' }),
  blob: new THREE.MeshBasicMaterial({ map: blobMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
};

// ---------------------------------------------------------------- ink outlines (inverted hull)
// A back-face copy pushed out along smoothed normals, so long thin rails get an even line (a scaled copy wouldn't).
export const INK = '#17112e';
const inkMats = new Map();
function inkMat(w) {
  const k = Math.round(w * 1000);
  if (inkMats.has(k)) return inkMats.get(k);
  const m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  m.onBeforeCompile = (s) => { s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize(normal) * ${(k / 1000).toFixed(3)};`); };
  m.customProgramCacheKey = () => 'golf-ink-' + k;
  inkMats.set(k, m); M['ink' + k] = m;
  return m;
}
for (const w of [0.008, 0.012, 0.018, 0.025, 0.035, 0.05, 0.07]) inkMat(w);
export const SHARED = new Set([...Object.values(M)]);
export function hullGeo(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position);
  if (geo.index) g.setIndex(geo.index);
  const h = mergeVertices(g, 1e-3); h.computeVertexNormals();
  return h;
}
// outline a mesh; the width follows its smallest side so thin poles get thin lines
export function outline(mesh, maxW = 0.035) {
  const geo = mesh.geometry; if (!geo.boundingBox) geo.computeBoundingBox();
  const s = new THREE.Vector3(); geo.boundingBox.getSize(s);
  const want = Math.min(maxW, Math.max(0.008, Math.min(s.x, s.y, s.z) * 0.12));
  const w = [...inkMats.keys()].map((k) => k / 1000).reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
  const o = new THREE.Mesh(hullGeo(geo), inkMat(w));
  o.userData.ink = true; o.castShadow = false; o.receiveShadow = false;
  mesh.add(o);
  return o;
}
// materials whose meshes get an ink outline when the course is built
export const INKED = new Set([M.wood, M.paint, M.red, M.white, M.hazard, M.crate, M.bumperSide, M.mine, M.gold, M.silver, M.bronze, M.stone, M.rubber]);
export function inkCourse(root) {
  const list = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.ink || o.userData.noInk) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (INKED.has(m) || o.userData.inkMe) list.push(o);
  });
  for (const o of list) outline(o);
}

// ---------------------------------------------------------------- themes
export const THEMES = [
  { key: 'meadow', name: 'Sunny Meadow', turf: '#33cc66', turfGlow: '#000000', ground: '#9ad65a', wood: '#ff9b42', woodGlow: '#000000', stone: '#e3d7c1',
    sky: ['#2d7dff', '#6cc0ff', '#d4f0ff'], fog: ['#d4f0ff', 80, 260], sun: ['#fff6e0', 2.7, [18, 30, 12]], hemi: ['#f2f8ff', '#7fbf4a', 1.25],
    water: '#2fb2ff', waterGlow: '#000000', exposure: 1, bloom: 0, scenery: [['round', 24], ['pine', 16]], bush: '#4cc24a', rock: '#b7b1a6',
    flowers: ['#ff6fa8', '#ffe14d', '#ffffff', '#b07bff', '#ff8a3d'], hills: '#62c24e', weather: 'petals', clouds: 1, stars: 0 },
  { key: 'beach', name: 'Sunset Beach', turf: '#24cf9e', turfGlow: '#000000', ground: '#fff1cc', wood: '#ffffff', woodGlow: '#000000', stone: '#ffd3a0',
    sky: ['#3b5fe0', '#ff9a7a', '#ffd79a'], fog: ['#ffd2a6', 80, 260], sun: ['#ffdcb8', 2.6, [30, 18, 10]], hemi: ['#ffe9d6', '#e0b070', 1.35],
    water: '#1fd2ff', waterGlow: '#000000', exposure: 1, bloom: 0, scenery: [['palm', 30]], bush: '#5cc84a', rock: '#e0bf90',
    flowers: ['#ffffff', '#ffc9d6', '#ffe6a8'], hills: '#f2c27a', weather: 'none', clouds: 0.9, stars: 0 },
  { key: 'snow', name: 'Snowy Peaks', turf: '#28c4b0', turfGlow: '#000000', ground: '#f4f8ff', wood: '#e2543c', woodGlow: '#000000', stone: '#c9d8f0',
    sky: ['#4a92f0', '#a8d4ff', '#f2f8ff'], fog: ['#eaf3fc', 65, 210], sun: ['#ffffff', 2.3, [18, 30, 12]], hemi: ['#f4f9ff', '#c4d2e6', 1.35],
    water: '#6fd6ff', waterGlow: '#000000', exposure: 1, bloom: 0, scenery: [['snowpine', 40]], bush: '#e8f0fa', rock: '#a6b4c8',
    flowers: null, hills: '#ffffff', weather: 'snow', clouds: 1, stars: 0 },
  { key: 'canyon', name: 'Red Canyon', turf: '#55cc44', turfGlow: '#000000', ground: '#ee9a62', wood: '#ffcf4d', woodGlow: '#000000', stone: '#e07a4a',
    sky: ['#2a78e8', '#8fd0ff', '#ffe6c4'], fog: ['#f6d8b6', 80, 260], sun: ['#fff0d0', 2.7, [20, 32, 8]], hemi: ['#fff0dc', '#c0703c', 1.2],
    water: '#2fe0c8', waterGlow: '#000000', exposure: 1, bloom: 0, scenery: [['cactus', 26], ['mesa', 14]], bush: '#a6bf44', rock: '#c8643a',
    flowers: ['#ffd84a', '#ff7a4a'], hills: '#d07040', weather: 'dust', clouds: 0.7, stars: 0 },
  { key: 'neon', name: 'Neon Night', turf: '#12c4a4', turfGlow: '#06382f', ground: '#2a2460', wood: '#7c5cff', woodGlow: '#ff2fb0', stone: '#4c4794',
    sky: ['#05041c', '#1d1258', '#5a1f8a'], fog: ['#1d1258', 55, 180], sun: ['#a8b8ff', 1.7, [10, 30, 16]], hemi: ['#8a96ff', '#30205a', 1.3],
    water: '#3fffe0', waterGlow: '#0e6a5c', exposure: 1, bloom: 0.75, scenery: [['pine', 20], ['crystal', 30]], bush: '#2f7a8a', rock: '#45496a',
    flowers: ['#7dffea', '#ff7ad9', '#fff27a'], hills: '#1a1f44', weather: 'fireflies', clouds: 0, stars: 1 },
];

// Called once per game load (each load has a fresh renderer): flat, unclipped colours for the toon look.
export function initEnv(renderer) {
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
export function ballMaterial(color) {
  const m = toon({ color, transparent: true });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `
      vec3 bn = normalize(normal);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), smoothstep(0.915, 0.93, dot(bn, normalize(vec3(-0.45, 0.72, 0.52)))) * 0.95);
      gl_FragColor.rgb += pow(1.0 - clamp(bn.z, 0.0, 1.0), 3.0) * 0.14;
      #include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => 'golf-ball';
  return m;
}
export const blobGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);

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
  const g = round ? new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, Math.min(round, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))) : new THREE.BoxGeometry(w, h, d);
  if (uvScale) worldUV(g, w, h, d, uvScale);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
}

// ---------------------------------------------------------------- sky, sun, stars, clouds, hills
export function buildSky(scene) {
  const uniforms = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bot: { value: new THREE.Color() } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(bot, mid, smoothstep(-0.05, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
  }));
  sky.renderOrder = -10; scene.add(sky);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  sunSprite.scale.set(220, 220, 1); scene.add(sunSprite);
  const sp = []; for (let i = 0; i < 700; i++) { const a = rnd() * Math.PI * 2, e = Math.asin(0.05 + rnd() * 0.95); sp.push(Math.cos(a) * Math.cos(e) * 850, Math.sin(e) * 850, Math.sin(a) * Math.cos(e) * 850); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false }));
  scene.add(stars);
  const clouds = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudMap, transparent: true, fog: false, depthWrite: false }));
    const a = rnd() * Math.PI * 2, r = 240 + rnd() * 200, k = 70 + rnd() * 60;
    s.position.set(Math.cos(a) * r, 40 + rnd() * 70, Math.sin(a) * r); s.scale.set(k * 2, k, 1);
    clouds.add(s);
  }
  scene.add(clouds);
  const hillMat = toon({ color: '#62c24e' });
  const hills = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2 + rnd() * 0.3, r = 165 + rnd() * 60;
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), hillMat);
    h.scale.set(45 + rnd() * 40, 16 + rnd() * 20, 45 + rnd() * 40); h.position.set(Math.cos(a) * r, -8, Math.sin(a) * r);
    hills.add(h);
  }
  scene.add(hills);
  return { uniforms, sunSprite, stars, clouds, hills, hillMat };
}

// apply a theme to the shared materials, lights, sky, fog and post-processing
export function applyTheme(th, ctx) {
  M.turf.color.set(th.turf); M.turf.emissive.set(th.turfGlow);
  M.grass.color.set(th.ground);
  M.wood.color.set(th.wood); M.wood.emissive.set(th.woodGlow); M.wood.emissiveIntensity = th.key === 'neon' ? 0.38 : 0;
  M.stone.color.set(th.stone);
  M.water.color.set(th.water); M.water.emissive.set(th.waterGlow);
  const neon = th.key === 'neon';
  M.bumperSide.emissive.set(neon ? '#ff4040' : '#000000'); M.bumperSide.emissiveIntensity = 0.5;
  M.hazard.emissive.set(neon ? '#f5c518' : '#000000'); M.hazard.emissiveIntensity = 0.35;
  M.paint.emissive.set(neon ? '#3fd0ff' : '#000000'); M.paint.emissiveIntensity = 0.5;
  M.red.emissive.set(neon ? '#ff2020' : '#000000'); M.red.emissiveIntensity = 0.6;
  for (const m of inkMats.values()) m.color.set(neon ? '#05030f' : INK);
  const { sky, scene, sun, hemi, renderer } = ctx;
  sky.uniforms.top.value.set(th.sky[0]); sky.uniforms.mid.value.set(th.sky[1]); sky.uniforms.bot.value.set(th.sky[2]);
  scene.fog.color.set(th.fog[0]); scene.fog.near = th.fog[1]; scene.fog.far = th.fog[2];
  scene.background.set(th.sky[2]);
  sun.color.set(th.sun[0]); sun.intensity = th.sun[1];
  hemi.color.set(th.hemi[0]); hemi.groundColor.set(th.hemi[1]); hemi.intensity = th.hemi[2];
  const d = new THREE.Vector3(...th.sun[2]).normalize();
  sky.sunSprite.position.copy(d).multiplyScalar(800); sky.sunSprite.material.color.set(th.sun[0]);
  sky.sunSprite.material.opacity = neon ? 0.35 : 0.8; sky.sunSprite.scale.setScalar(neon ? 120 : 220);
  sky.stars.visible = !!th.stars;
  sky.clouds.children.forEach(c => { c.material.opacity = th.clouds; c.visible = th.clouds > 0; c.material.color.set(th.key === 'beach' ? '#ffe2d0' : '#ffffff'); });
  sky.hillMat.color.set(th.hills);
  renderer.toneMappingExposure = th.exposure;
  if (ctx.post) { ctx.post.bloom.strength = th.bloom; ctx.post.bloom.threshold = neon ? 0.55 : 0.98; }
  return d;
}

// ---------------------------------------------------------------- scenery (smooth toon shapes + ink outlines)
function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); g.deleteAttribute('uv');
  return g;
}
const part = (geo, color, x = 0, y = 0, z = 0) => colored(geo.translate(x, y, z), color);
const blob = (r, color, x, y, z, sy = 1) => part(new THREE.SphereGeometry(r, 16, 12).scale(1, sy, 1), color, x, y, z);
const trunk = (h = 1.3, color = '#8a5a34') => part(new THREE.CylinderGeometry(0.16, 0.24, h, 8), color, 0, h / 2, 0);
const TREES = {
  round: () => mergeGeometries([trunk(), blob(1.15, '#3fb84a', 0, 2.1, 0), blob(0.8, '#55cc5a', 0.55, 2.75, 0.25), blob(0.7, '#36a844', -0.6, 2.5, -0.2)]),
  pine: () => mergeGeometries([trunk(0.9), part(new THREE.ConeGeometry(1.15, 1.6, 10), '#2e9c4f', 0, 1.5, 0), part(new THREE.ConeGeometry(0.9, 1.4, 10), '#36ad58', 0, 2.35, 0), part(new THREE.ConeGeometry(0.6, 1.2, 10), '#40bd62', 0, 3.1, 0)]),
  snowpine: () => mergeGeometries([trunk(0.9), part(new THREE.ConeGeometry(1.15, 1.6, 10), '#2a8a66', 0, 1.5, 0), part(new THREE.ConeGeometry(0.9, 0.7, 10), '#ffffff', 0, 2.05, 0),
    part(new THREE.ConeGeometry(0.88, 1.4, 10), '#31996f', 0, 2.45, 0), part(new THREE.ConeGeometry(0.66, 0.7, 10), '#ffffff', 0, 2.9, 0), part(new THREE.ConeGeometry(0.5, 1.1, 10), '#ffffff', 0, 3.4, 0)]),
  palm: () => {
    const parts = [];
    for (let k = 0; k < 5; k++) parts.push(part(new THREE.CylinderGeometry(0.14 - k * 0.012, 0.17 - k * 0.012, 0.75, 8), k % 2 ? '#b07a44' : '#9a6a3a', k * k * 0.035, 0.36 + k * 0.7, 0));
    for (let k = 0; k < 7; k++) {
      const leaf = new THREE.SphereGeometry(1, 10, 6); leaf.scale(1.15, 0.12, 0.32); leaf.translate(1.0, -0.15, 0); leaf.rotateZ(-0.35); leaf.rotateY(k / 7 * Math.PI * 2);
      parts.push(part(leaf, k % 2 ? '#3fb84a' : '#52cc5a', 0.56, 3.55, 0));
    }
    for (let k = 0; k < 3; k++) parts.push(part(new THREE.SphereGeometry(0.14, 10, 8), '#7a4a26', 0.56 + Math.cos(k * 2.1) * 0.18, 3.32, Math.sin(k * 2.1) * 0.18));
    return mergeGeometries(parts);
  },
  cactus: () => {
    const arm = (s) => { const a = new THREE.CylinderGeometry(0.15, 0.15, 0.55, 10); a.rotateZ(Math.PI / 2); a.translate(s * 0.4, 0, 0); return a; };
    return mergeGeometries([part(new THREE.CylinderGeometry(0.3, 0.32, 2.2, 12), '#3fae5a', 0, 1.1, 0), part(new THREE.SphereGeometry(0.3, 12, 8), '#3fae5a', 0, 2.2, 0),
      part(arm(1), '#3aa253', 0, 1.0, 0), part(new THREE.CylinderGeometry(0.15, 0.15, 0.8, 10), '#3aa253', 0.62, 1.35, 0), part(new THREE.SphereGeometry(0.15, 10, 6), '#3aa253', 0.62, 1.75, 0),
      part(arm(-1), '#3aa253', 0, 1.4, 0), part(new THREE.CylinderGeometry(0.15, 0.15, 0.6, 10), '#3aa253', -0.62, 1.65, 0), part(new THREE.SphereGeometry(0.15, 10, 6), '#3aa253', -0.62, 1.95, 0),
      part(new THREE.SphereGeometry(0.12, 8, 6), '#ff6fa8', 0, 2.48, 0)]);
  },
  mesa: () => mergeGeometries([part(new THREE.CylinderGeometry(1.3, 1.7, 1.3, 9), '#c8643a', 0, 0.65, 0), part(new THREE.CylinderGeometry(0.95, 1.25, 1.0, 9), '#e07d4a', 0.1, 1.8, 0), part(new THREE.CylinderGeometry(0.6, 0.9, 0.8, 9), '#f29a62', 0.15, 2.7, 0)]),
  crystal: () => {
    const sh = (s, h, c, x, z, tilt) => { const g = new THREE.OctahedronGeometry(s, 0); g.scale(1, h, 1); g.rotateZ(tilt); return part(g, c, x, s * h * 0.8, z); };
    return mergeGeometries([sh(0.45, 2.6, '#6ff5ff', 0, 0, 0.1), sh(0.32, 2.2, '#ff6ae0', 0.5, 0.2, -0.35), sh(0.26, 1.8, '#b48cff', -0.4, -0.3, 0.4)]);
  },
};
const treeGeoCache = {}, hullCache = new Map();
const treeGeo = k => treeGeoCache[k] || (treeGeoCache[k] = TREES[k]());
const hullOf = (geo) => { let h = hullCache.get(geo); if (!h) { h = hullGeo(geo); hullCache.set(geo, h); keepGeos.add(h); } return h; };
const leafMat = toon({ vertexColors: true });
const glowLeafMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const bushGeo = new THREE.SphereGeometry(0.55, 14, 10);
const rockGeo = new THREE.DodecahedronGeometry(0.45, 0);
const flowerGeo = new THREE.SphereGeometry(0.09, 8, 6);
const bushMat = toon();
const rockMat = toon({ flatShading: true });
const flowerMat = toon();
const flowerGlowMat = new THREE.MeshBasicMaterial();
export const keepGeos = new Set([bushGeo, rockGeo, flowerGeo, blobGeo]);
export const keepMats = new Set([leafMat, glowLeafMat, bushMat, rockMat, flowerMat, flowerGlowMat]);

export function buildScenery(hole, groundY, th) {
  const g = new THREE.Group();
  const R = C.rng(hole.seed ^ 0x9e3779b9);
  const T = C.T;
  const near = (x, z, m) => hole.tiles.some(t => Math.abs(x - t.cx) < T / 2 + m && Math.abs(z - t.cz) < T / 2 + m);
  const xs = hole.tiles.map(t => t.cx), zs = hole.tiles.map(t => t.cz);
  const x0 = Math.min(...xs) - 28, x1 = Math.max(...xs) + 28, z0 = Math.min(...zs) - 28, z1 = Math.max(...zs) + 28;
  const pts = (n, margin) => { const out = []; for (let i = 0; i < n * 20 && out.length < n; i++) { const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0); if (!near(x, z, margin)) out.push([x, z]); } return out; };
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  // ink: false for tiny props; otherwise an outline InstancedMesh shares the instance matrices
  const inst = (geo, mat, list, f, { useColor = true, ink = 0.05 } = {}) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.castShadow = true; im.receiveShadow = true;
    list.forEach((p, i) => { col.set('#ffffff'); f(p, i); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); if (useColor) im.setColorAt(i, col); });
    g.add(im);
    if (ink) { const o = new THREE.InstancedMesh(hullOf(geo), inkMat(ink), list.length); o.instanceMatrix = im.instanceMatrix; o.userData.ink = true; g.add(o); }
  };
  for (const [kind, n] of th.scenery) {
    keepGeos.add(treeGeo(kind));
    inst(treeGeo(kind), kind === 'crystal' ? glowLeafMat : leafMat, pts(n, kind === 'mesa' ? 6 : 4.5), ([x, z]) => {
      const s = (kind === 'mesa' ? 1.2 : 0.8) + R() * (kind === 'mesa' ? 1.6 : 0.9);
      dummy.position.set(x, groundY - 0.05, z); dummy.scale.set(s, s * (0.85 + R() * 0.3), s); dummy.rotation.set(0, R() * 6.28, 0);
      const v = 0.92 + R() * 0.16; col.setRGB(v, v, v);
    }, { ink: kind === 'crystal' ? 0 : 0.05 });
  }
  // bushes hugging the course edges
  const bushes = [];
  for (const t of hole.tiles) for (const [dx, dz] of C.DIRS) {
    if (hole.tiles.some(o => o.gx === t.gx + dx && o.gz === t.gz + dz)) continue;
    const n = 1 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) { const off = (R() - 0.5) * (T - 0.8); bushes.push([t.cx + dx * (T / 2 + 0.75) - dz * off, t.cz + dz * (T / 2 + 0.75) + dx * off]); }
  }
  const bc = new THREE.Color(th.bush), hsl = {}; bc.getHSL(hsl);
  inst(bushGeo, bushMat, bushes, ([x, z]) => { const s = 0.7 + R() * 0.7; dummy.position.set(x, groundY + 0.3 * s, z); dummy.scale.set(s, s * 0.8, s); dummy.rotation.set(0, R() * 6, 0); col.setHSL(hsl.h + (R() - 0.5) * 0.05, hsl.s, hsl.l * (0.9 + R() * 0.2)); }, { ink: 0.035 });
  const rc = new THREE.Color(th.rock);
  inst(rockGeo, rockMat, pts(20, 1.5), ([x, z]) => { const s = 0.5 + R() * 1.6; dummy.position.set(x, groundY + 0.1, z); dummy.scale.set(s, s * 0.6, s); dummy.rotation.set(R(), R() * 6, R()); const v = 0.85 + R() * 0.3; col.copy(rc).multiplyScalar(v); }, { ink: 0.035 });
  if (th.flowers) {
    const flowers = [];
    for (const [cx, cz] of pts(18, 1.2)) for (let k = 0; k < 14; k++) flowers.push([cx + (R() - 0.5) * 1.8, cz + (R() - 0.5) * 1.8]);
    inst(flowerGeo, th.key === 'neon' ? flowerGlowMat : flowerMat, flowers.filter(([x, z]) => !near(x, z, 0.5)), ([x, z]) => { dummy.position.set(x, groundY + 0.12, z); dummy.scale.setScalar(0.8 + R() * 0.6); dummy.rotation.set(0, 0, 0); col.set(th.flowers[Math.floor(R() * th.flowers.length)]); }, { ink: 0 });
  }
  return g;
}
// ---------------------------------------------------------------- flag, glow, labels, bubbles
export function makeFlag(holeNum) {
  const tex = canvasTex(128, 80, (g, w, h) => {
    g.fillStyle = '#ff4d5e'; g.fillRect(0, 0, w, h); g.strokeStyle = '#17112e'; g.lineWidth = 8; g.strokeRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = "52px 'Lilita One', sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(holeNum), w / 2 - 6, h / 2 + 2);
  }, { clamp: true });
  const geo = new THREE.PlaneGeometry(0.72, 0.45, 12, 4).translate(0.36, -0.225, 0);
  const flag = new THREE.Mesh(geo, toon({ map: tex, side: THREE.DoubleSide }));
  flag.castShadow = true; flag.userData.ownMap = true;
  const base = Float32Array.from(geo.attributes.position.array);
  flag.userData.wave = t => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = base[i * 3]; p.setZ(i, Math.sin(x * 7 - t * 5) * 0.07 * x / 0.72); }
    p.needsUpdate = true; geo.computeVertexNormals();
  };
  return flag;
}
export function glowSprite(color = '#ffd84a', size = 1.3) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1); return s;
}
function spriteFromCanvas(cv, sx, sy) {
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(sx, sy, 1); sp.renderOrder = 10; sp.userData.ownMap = true;
  return sp;
}
export function makeLabel(text, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = "30px 'Lilita One', system-ui, sans-serif";
  const tw = Math.min(190, g.measureText(text).width), w = tw + 52, x0 = (256 - w) / 2;
  g.fillStyle = 'rgba(23,17,46,.82)'; g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.roundRect(x0, 10, w, 44, 22); g.fill(); g.stroke();
  g.fillStyle = color; g.beginPath(); g.arc(x0 + 22, 32, 10, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, x0 + 40, 33, 190);
  return spriteFromCanvas(cv, 1.5, 0.375);
}
export function makeBubble(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  g.font = "44px 'Lilita One', system-ui, sans-serif";
  const tw = Math.min(220, g.measureText(text).width), w = tw + 36, x0 = (256 - w) / 2;
  g.fillStyle = '#ffffff'; g.strokeStyle = '#17112e'; g.lineWidth = 7;
  g.beginPath(); g.roundRect(x0, 8, w, 76, 26); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(116, 82); g.lineTo(128, 112); g.lineTo(142, 82); g.fill(); g.stroke();
  g.fillStyle = '#ffffff'; g.fillRect(112, 74, 34, 10);
  g.fillStyle = '#17112e'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 48, 220);
  return spriteFromCanvas(cv, 1.7, 0.85);
}

// ---------------------------------------------------------------- particles
export class Particles {
  constructor(scene, cap = 1200) {
    this.cap = cap; this.i = 0;
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.grav = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.2, map: dotMap, alphaTest: 0.05, vertexColors: true, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false; scene.add(this.points);
    for (let i = 0; i < cap; i++) this.pos[i * 3 + 1] = -9999;
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

// ambient weather in a box that follows the camera target: snow, fireflies, dust, petals
export class Weather {
  constructor(scene, n = 320) {
    this.n = n; this.kind = 'none'; this.box = [38, 14, 38];
    this.pos = new Float32Array(n * 3); this.seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.pos.set([(Math.random() - 0.5) * 38, Math.random() * 14, (Math.random() - 0.5) * 38], i * 3); this.seed[i] = Math.random() * 100; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ size: 0.12, map: glowMap, transparent: true, depthWrite: false, fog: false });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.visible = false; scene.add(this.points);
  }
  set(kind) {
    this.kind = kind; this.points.visible = kind !== 'none';
    const cfg = { snow: ['#ffffff', 0.16, 0.9, THREE.NormalBlending], fireflies: ['#d8ff6a', 0.22, 1, THREE.AdditiveBlending], dust: ['#e8c9a0', 0.1, 0.5, THREE.NormalBlending], petals: ['#ffc4dc', 0.1, 0.7, THREE.NormalBlending] }[kind];
    if (cfg) { this.mat.color.set(cfg[0]); this.mat.size = cfg[1]; this.mat.opacity = cfg[2]; this.mat.blending = cfg[3]; this.mat.needsUpdate = true; }
  }
  update(dt, t, cx, cy, cz) {
    if (this.kind === 'none') return;
    const [bx, by, bz] = this.box, k = this.kind;
    for (let i = 0; i < this.n; i++) {
      const s = this.seed[i]; let x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      if (k === 'snow') { y -= (1.2 + (s % 1)) * dt; x += Math.sin(t + s) * 0.4 * dt; z += Math.cos(t * 0.7 + s) * 0.4 * dt; }
      else if (k === 'fireflies') { x += Math.sin(t * 0.6 + s) * 0.6 * dt; y += Math.sin(t * 0.9 + s * 2) * 0.3 * dt; z += Math.cos(t * 0.5 + s) * 0.6 * dt; }
      else if (k === 'dust') { x += (1.5 + (s % 1)) * dt; y += Math.sin(t + s) * 0.2 * dt; }
      else { y -= 0.5 * dt; x += Math.sin(t * 0.8 + s) * 0.7 * dt; z += 0.4 * dt; }
      // wrap around the box centred on the target
      const lx = ((x - cx + bx / 2) % bx + bx) % bx - bx / 2, lz = ((z - cz + bz / 2) % bz + bz) % bz - bz / 2;
      let ly = ((y - cy + 2) % by + by) % by - 2; if (k === 'fireflies') ly = Math.min(ly, 4) ;
      this.pos[i * 3] = cx + lx; this.pos[i * 3 + 1] = cy + ly; this.pos[i * 3 + 2] = cz + lz;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// fading ribbon behind a fast ball
export class Trail {
  constructor(parent, color) {
    this.N = 20; this.pts = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.N * 2 * 3); this.col = new Float32Array(this.N * 2 * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    const idx = []; for (let i = 0; i < this.N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx);
    this.c = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; parent.add(this.mesh);
  }
  update(x, y, z, r, speed, visible) {
    const last = this.pts[this.pts.length - 1];
    if (visible && speed > 2.5 && (!last || Math.hypot(x - last[0], z - last[2], y - last[1]) > 0.12)) {
      if (last && Math.hypot(x - last[0], z - last[2]) > 3) this.pts.length = 0; // teleported
      this.pts.push([x, y, z]);
    } else if (this.pts.length && (speed <= 2.5 || !visible)) this.pts.shift();
    while (this.pts.length > this.N) this.pts.shift();
    const n = this.pts.length;
    for (let i = 0; i < this.N; i++) {
      const p = this.pts[Math.min(i, n - 1)] || [x, y, z], q = this.pts[Math.min(i + 1, n - 1)] || p;
      let dx = q[0] - p[0], dz = q[2] - p[2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const f = n > 1 ? i / (n - 1) : 0, w = r * 0.85 * f;
      this.pos.set([p[0] - dz * w, p[1] + 0.03, p[2] + dx * w, p[0] + dz * w, p[1] + 0.03, p[2] - dx * w], i * 6);
      const a = i < n ? f * 0.55 : 0;
      this.col.set([this.c.r, this.c.g, this.c.b, a, this.c.r, this.c.g, this.c.b, a], i * 8);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.color.needsUpdate = true;
    this.mesh.visible = n > 1;
  }
}

// ---------------------------------------------------------------- post-processing (bloom + tone mapping, with MSAA)
export function makePost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.15, 0.6, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return { composer, bloom, setSize: (w, h) => composer.setSize(w, h) };
}

export function animate(t) {
  waterMap.offset.set(t * 0.03, t * 0.02);
  boostMap.offset.y = -t * 1.6;
  M.portalA.map.rotation = t * 2; M.portalB.map.rotation = -t * 2;
  M.mineLight.color.setScalar(0.5 + 0.5 * Math.sin(t * 10)); M.mineLight.color.g = M.mineLight.color.b = 0.1;
}
M.portalA.map.center.set(0.5, 0.5); M.portalB.map.center.set(0.5, 0.5);


// ---------------------------------------------------------------- smooth banked-corner wall, planter and rail contact shadows
// The banked corner's physics wall is 9 straight boxes; drawing it as one smooth ribbon (and the corner planter as a
// polar sector) removes the sawtooth along the curve.
export function bankWall(hole, arc) {
  const T = C.T, N = 36, g = new THREE.Group();
  const rin = T, rout = T + C.WALL_TH, [icx, icz] = arc.ic, y0 = arc.y0;
  const smp = [];
  for (let i = 0; i <= N; i++) {
    const a = arc.a0 + i / N * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    const hb = C.heightAt(hole, icx + c * (T - 0.2), icz + s * (T - 0.2));
    smp.push({ c, s, y1: (hb ?? arc.t.h0) + 0.38 });
  }
  const pos = [], uv = [], idx = [];
  const quad = (a, b, c, d) => { const k = pos.length / 3 - 4; idx.push(k + a, k + b, k + c, k + a, k + c, k + d); };
  const face = (rad, flip) => {   // vertical ring face
    for (let i = 0; i <= N; i++) { const p = smp[i]; pos.push(icx + p.c * rad, y0, icz + p.s * rad, icx + p.c * rad, p.y1, icz + p.s * rad); uv.push(i * 0.35, 0, i * 0.35, 0.5); }
    const k = pos.length / 3 - 2 * (N + 1);
    for (let i = 0; i < N; i++) { const a = k + i * 2; if (flip) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  };
  face(rin, false); face(rout, true);
  { // top
    for (let i = 0; i <= N; i++) { const p = smp[i]; pos.push(icx + p.c * rin, p.y1, icz + p.s * rin, icx + p.c * rout, p.y1, icz + p.s * rout); uv.push(i * 0.35, 0.5, i * 0.35, 0.7); }
    const k = pos.length / 3 - 2 * (N + 1);
    for (let i = 0; i < N; i++) { const a = k + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  for (const i of [0, N]) { // end caps
    const p = smp[i];
    pos.push(icx + p.c * rin, y0, icz + p.s * rin, icx + p.c * rout, y0, icz + p.s * rout, icx + p.c * rout, p.y1, icz + p.s * rout, icx + p.c * rin, p.y1, icz + p.s * rin);
    uv.push(0, 0, 0.2, 0, 0.2, 0.5, 0, 0.5);
    const k = pos.length / 3 - 4; if (i === 0) idx.push(k, k + 2, k + 1, k, k + 3, k + 2); else idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const rail = new THREE.Mesh(geo, M.wood); rail.castShadow = true; rail.receiveShadow = true; g.add(rail);

  // planter: flat stone top filling the tile corner behind the curve, bounded by the tile square
  const ppos = [], pidx = [], pu = [], top = arc.t.h0 + 0.5, M2 = 24;
  for (let i = 0; i <= M2; i++) {
    const phi = i / M2 * Math.PI / 2, a = arc.a0 + phi, c = Math.cos(a), s = Math.sin(a), rm = T / Math.max(Math.cos(phi), Math.sin(phi));
    ppos.push(icx + c * (T + 0.05), top, icz + s * (T + 0.05), icx + c * rm, top, icz + s * rm);
    pu.push((icx + c * (T + 0.05)) / 1.6, (icz + s * (T + 0.05)) / 1.6, (icx + c * rm) / 1.6, (icz + s * rm) / 1.6);
  }
  for (let i = 0; i < M2; i++) { const a = i * 2; pidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(ppos, 3)); pg.setAttribute('uv', new THREE.Float32BufferAttribute(pu, 2));
  pg.setIndex(pidx); pg.computeVertexNormals();
  const pm = new THREE.Mesh(pg, M.stone); pm.receiveShadow = true; pm.userData.noInk = true; g.add(pm);
  return g;
}

// A soft dark gradient on the turf beside every rail on flat ground: cheap ambient occlusion that also shows on Low.
const aoMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
M.ao = aoMat;
export function railShadows(hole) {
  const pos = [], col = [], idx = [], W = 0.55, A = 0.34;
  const flat = (x, z, h0) => { const h = C.heightAt(hole, x, z); return h !== null && Math.abs(h - h0) < 0.025; };
  for (const w of hole.walls) {
    if (w.kind === 'tunnel') continue;
    const alongX = w.hx > w.hz, L = alongX ? w.hx : w.hz, th = alongX ? w.hz : w.hx;
    for (const side of [-1, 1]) {
      const nx = alongX ? 0 : side, nz = alongX ? side : 0, ax = alongX ? 1 : 0, az = alongX ? 0 : 1;
      const px = w.x + nx * (th + 0.04), pz = w.z + nz * (th + 0.04);
      if (!C.tileAt(hole, px + nx * 0.3, pz + nz * 0.3)) continue;
      const h0 = C.heightAt(hole, px + nx * 0.2, pz + nz * 0.2); if (h0 === null) continue;
      if (![-0.95, -0.5, 0, 0.5, 0.95].every((f) => flat(px + nx * 0.2 + ax * L * f, pz + nz * 0.2 + az * L * f, h0))) continue;
      const k = pos.length / 3, y = h0 + 0.014;
      for (const e of [-1, 1]) {
        pos.push(px + ax * L * e, y, pz + az * L * e); col.push(0.04, 0.07, 0.12, A);
        pos.push(px + nx * W + ax * L * e, y, pz + nz * W + az * L * e); col.push(0.04, 0.07, 0.12, 0);
      }
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); geo.setIndex(idx);
  const m = new THREE.Mesh(geo, aoMat); m.renderOrder = 1; m.userData.noInk = true; m.frustumCulled = false;
  return m;
}
