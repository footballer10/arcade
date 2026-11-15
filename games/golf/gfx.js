// Mini-Golf Battle — procedural graphics: textures, materials, themed worlds, scenery, weather,
// trails, particles and post-processing (no asset files)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
function speckle(g, w, h, n, colors, size = 1) {
  for (let i = 0; i < n; i++) { g.fillStyle = colors[Math.floor(rnd() * colors.length)]; g.fillRect(rnd() * w, rnd() * h, size, size); }
}

// neutral (near-white) felt with mowing stripes — tinted per theme through material.color
const turfMap = canvasTex(256, 256, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.46, '#ffffff'); grd.addColorStop(0.54, '#dedede'); grd.addColorStop(0.96, '#dedede'); grd.addColorStop(1, '#ffffff');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 9000, ['rgba(255,255,255,.10)', 'rgba(0,0,0,.07)', 'rgba(0,0,0,.04)']);
});
const turfBump = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); speckle(g, w, h, 14000, ['#606060', '#a0a0a0', '#707070', '#909090']); }, { srgb: false });
const groundMap = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * w, y = rnd() * h, l = 3 + rnd() * 5;
    g.strokeStyle = ['#f6f6f6', '#cfcfcf', '#ffffff', '#c2c2c2'][Math.floor(rnd() * 4)];
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
  for (let y = 0; y < h; y += 32) {
    let x = -rnd() * 40;
    while (x < w) {
      const sw = 36 + rnd() * 40, v = 150 + Math.floor(rnd() * 50);
      g.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
      g.beginPath(); g.roundRect(x + 2, y + 2, sw - 4, 28, 5); g.fill();
      x += sw;
    }
  }
  speckle(g, w, h, 4000, ['rgba(0,0,0,.08)', 'rgba(255,255,255,.08)']);
});
const rubberMap = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#3f8a4a'; g.fillRect(0, 0, w, h); speckle(g, w, h, 3000, ['#357a40', '#4a9a55', '#2f6e39'], 2); g.strokeStyle = '#e8f5e0'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3); });
const sandMap = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#ecd6a0'; g.fillRect(0, 0, w, h); speckle(g, w, h, 5000, ['#d9bf85', '#f6e6ba', '#c9ad72', '#fff1cc'], 2); });
const iceMap = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#d9f3ff'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) { let x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
});
const boostMap = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#1b1f3a'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#ffe14d'; g.lineWidth = 9; g.lineJoin = 'miter';
  for (const y of [14, 46]) { g.beginPath(); g.moveTo(8, y + 10); g.lineTo(32, y - 8); g.lineTo(56, y + 10); g.stroke(); }
});
const waterMap = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#4aa3e8'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(220,245,255,.5)'; g.lineWidth = 2;
  for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(rnd() * w, rnd() * h, 8 + rnd() * 18, rnd() * 6, rnd() * 6 + 2); g.stroke(); }
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
const glowMap = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, { clamp: true });
const cloudMap = canvasTex(256, 128, (g) => {
  for (let i = 0; i < 14; i++) {
    const x = 50 + rnd() * 156, y = 50 + rnd() * 40, r = 22 + rnd() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  }
}, { clamp: true });
function swirlTex(c1, c2) {
  return canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, c1); gr.addColorStop(0.8, c2); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 4;
    for (let k = 0; k < 3; k++) { g.beginPath(); for (let a = 0; a < 5; a += 0.15) { const r = 6 + a * 10, x = 64 + Math.cos(a + k * 2.1) * r, y = 64 + Math.sin(a + k * 2.1) * r; a ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  }, { clamp: true });
}

// ---------------------------------------------------------------- materials (shared; tinted per theme)
const std = o => new THREE.MeshStandardMaterial(o);
export const M = {
  turf: std({ map: turfMap, bumpMap: turfBump, bumpScale: 0.6, roughness: 0.95, side: THREE.DoubleSide }),
  grass: std({ map: groundMap, roughness: 1 }),
  wood: std({ map: woodMap, roughness: 0.7 }),
  paint: std({ color: '#f6f1e7', roughness: 0.5 }),
  stone: std({ map: stoneMap, roughness: 0.9 }),
  pit: std({ color: '#2a1d12', roughness: 1 }),
  rubber: std({ map: rubberMap, roughness: 1 }),
  sand: std({ map: sandMap, roughness: 1 }),
  ice: std({ map: iceMap, color: '#a9dcff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.92 }),
  boost: std({ map: boostMap, emissive: '#ffffff', emissiveMap: boostMap, emissiveIntensity: 0.9, roughness: 0.4 }),
  water: std({ map: waterMap, color: '#9fd8ff', transparent: true, opacity: 0.88, roughness: 0.08, metalness: 0.15 }),
  bumperSide: std({ map: stripeMap, roughness: 0.4 }),
  bumperTop: std({ color: '#ffffff', roughness: 0.35 }),
  hazard: std({ map: hazardMap, roughness: 0.5 }),
  crate: std({ map: crateMap, emissive: '#ffffff', emissiveMap: crateMap, emissiveIntensity: 0.45, roughness: 0.5 }),
  glass: new THREE.MeshPhysicalMaterial({ color: '#cfefff', transparent: true, opacity: 0.3, roughness: 0.05 }),
  cup: new THREE.MeshBasicMaterial({ map: cupMap }),
  white: std({ color: '#ffffff', roughness: 0.4 }),
  red: std({ color: '#e23b3b', roughness: 0.5 }),
  gold: std({ color: '#f6c343', roughness: 0.3, metalness: 0.6 }),
  silver: std({ color: '#cfd6de', roughness: 0.3, metalness: 0.6 }),
  bronze: std({ color: '#c98a52', roughness: 0.35, metalness: 0.5 }),
  portalA: new THREE.MeshBasicMaterial({ map: swirlTex('#5ad1ff', '#2f5bff'), transparent: true, depthWrite: false }),
  portalB: new THREE.MeshBasicMaterial({ map: swirlTex('#ffc04d', '#ff5a2f'), transparent: true, depthWrite: false }),
  ringA: new THREE.MeshBasicMaterial({ color: '#7fdcff' }),
  ringB: new THREE.MeshBasicMaterial({ color: '#ffb347' }),
  mine: std({ color: '#30343c', roughness: 0.4, metalness: 0.5 }),
  mineLight: new THREE.MeshBasicMaterial({ color: '#ff3030' }),
};
export const SHARED = new Set([...Object.values(M)]);
// stone/wood get world-scaled UVs per mesh, so one shared material works everywhere

// ---------------------------------------------------------------- themes
export const THEMES = [
  { key: 'meadow', name: 'Sunny Meadow', turf: '#58c95a', turfGlow: '#000000', ground: '#5c9a3e', wood: '#ffffff', woodGlow: '#000000', stone: '#ffffff',
    sky: ['#3f8fdc', '#8cc6f0', '#dcefff'], fog: ['#cde6f5', 70, 230], sun: ['#fff3dc', 2.6, [18, 34, 12]], hemi: ['#d8eeff', '#5b7a3a', 1.1],
    water: '#9fd8ff', waterGlow: '#000000', exposure: 1.05, bloom: 0.14, scenery: [['round', 26], ['pine', 20]], bush: '#5fae48', rock: '#9a978f',
    flowers: ['#ff6fa8', '#ffe14d', '#ffffff', '#b07bff', '#ff8a3d'], hills: '#4c8a3c', weather: 'petals', clouds: 0.85, stars: 0 },
  { key: 'beach', name: 'Sunset Beach', turf: '#4fc98a', turfGlow: '#000000', ground: '#f6e6ba', wood: '#ffe6c4', woodGlow: '#000000', stone: '#fff0da',
    sky: ['#3a5fc4', '#f39a6a', '#ffdca4'], fog: ['#f6cfa4', 70, 230], sun: ['#ffb878', 2.6, [30, 15, 10]], hemi: ['#ffe2c8', '#c8a878', 1.25],
    water: '#8fe8ff', waterGlow: '#000000', exposure: 1.0, bloom: 0.3, scenery: [['palm', 36]], bush: '#6ab04c', rock: '#c9b79a',
    flowers: ['#ffffff', '#ffc9d6', '#ffe6a8'], hills: '#dcbc86', weather: 'none', clouds: 0.7, stars: 0 },
  { key: 'snow', name: 'Snowy Peaks', turf: '#5fcfa4', turfGlow: '#000000', ground: '#f4f8fc', wood: '#fff4e6', woodGlow: '#000000', stone: '#eaf2ff',
    sky: ['#5d9fe0', '#b9d8f2', '#f6fbff'], fog: ['#e8f1f9', 55, 190], sun: ['#ffffff', 2.4, [18, 30, 12]], hemi: ['#eef6ff', '#c8d4e0', 1.25],
    water: '#c8eeff', waterGlow: '#000000', exposure: 1.0, bloom: 0.2, scenery: [['snowpine', 46]], bush: '#f0f5fa', rock: '#aab4c0',
    flowers: null, hills: '#ffffff', weather: 'snow', clouds: 0.9, stars: 0 },
  { key: 'canyon', name: 'Red Canyon', turf: '#6cc64c', turfGlow: '#000000', ground: '#cf7d4e', wood: '#ffd9a8', woodGlow: '#000000', stone: '#ffcfa8',
    sky: ['#2f7fd6', '#9fd0f0', '#f8e2c2'], fog: ['#f0d2b0', 70, 230], sun: ['#ffe9c4', 2.9, [20, 36, 8]], hemi: ['#ffe8d0', '#a0623c', 1.0],
    water: '#7fe0d0', waterGlow: '#000000', exposure: 1.05, bloom: 0.14, scenery: [['cactus', 28], ['mesa', 16]], bush: '#98a850', rock: '#b5653f',
    flowers: ['#ffd84a', '#ff7a4a'], hills: '#b96a42', weather: 'dust', clouds: 0.5, stars: 0 },
  { key: 'neon', name: 'Neon Night', turf: '#27b89f', turfGlow: '#0b3d36', ground: '#1c2340', wood: '#5a4a8a', woodGlow: '#ff2fb0', stone: '#59608f',
    sky: ['#04051a', '#18124a', '#4a1f7a'], fog: ['#18124a', 50, 170], sun: ['#9fb4ff', 1.3, [10, 30, 16]], hemi: ['#7a88ff', '#2a1848', 1.0],
    water: '#3fffe0', waterGlow: '#0e6a5c', exposure: 1.15, bloom: 0.7, scenery: [['pine', 22], ['crystal', 34]], bush: '#2f6a7a', rock: '#3a3f5a',
    flowers: ['#7dffea', '#ff7ad9', '#fff27a'], hills: '#141a34', weather: 'fireflies', clouds: 0, stars: 1 },
];

let envTex = null;
// Called once per game load (each load has a fresh renderer); frees the previous load's environment map.
export function initEnv(renderer) {
  if (envTex) envTex.dispose();
  const pm = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  envTex = pm.fromScene(room, 0.04).texture;
  pm.dispose(); room.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
  M.water.envMap = envTex; M.water.envMapIntensity = 0.6;
  M.glass.envMap = envTex; M.ice.envMap = envTex; M.ice.envMapIntensity = 0.9;
  for (const k of ['gold', 'silver', 'bronze', 'mine']) { M[k].envMap = envTex; }
}
export function ballMaterial(color) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15, bumpMap: dimpleBump, bumpScale: 0.35, envMap: envTex, envMapIntensity: 0.7, transparent: true });
}

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
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.7, h)) : mix(bot, mid, smoothstep(-0.05, 0.15, h)); gl_FragColor = vec4(c, 1.0); }',
  }));
  sky.renderOrder = -10; scene.add(sky);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  sunSprite.scale.set(260, 260, 1); scene.add(sunSprite);
  const sp = []; for (let i = 0; i < 700; i++) { const a = rnd() * Math.PI * 2, e = Math.asin(0.05 + rnd() * 0.95); sp.push(Math.cos(a) * Math.cos(e) * 850, Math.sin(e) * 850, Math.sin(a) * Math.cos(e) * 850); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false }));
  scene.add(stars);
  const clouds = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudMap, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
    const a = rnd() * Math.PI * 2, r = 260 + rnd() * 200;
    s.position.set(Math.cos(a) * r, 55 + rnd() * 70, Math.sin(a) * r); s.scale.set(110 + rnd() * 80, 45 + rnd() * 25, 1);
    clouds.add(s);
  }
  scene.add(clouds);
  const hillMat = new THREE.MeshLambertMaterial({ color: '#4c8a3c' });
  const hills = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2 + rnd() * 0.3, r = 170 + rnd() * 60;
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), hillMat);
    h.scale.set(50 + rnd() * 40, 14 + rnd() * 16, 50 + rnd() * 40); h.position.set(Math.cos(a) * r, -8, Math.sin(a) * r);
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
  const { sky, scene, sun, hemi, renderer } = ctx;
  sky.uniforms.top.value.set(th.sky[0]); sky.uniforms.mid.value.set(th.sky[1]); sky.uniforms.bot.value.set(th.sky[2]);
  scene.fog.color.set(th.fog[0]); scene.fog.near = th.fog[1]; scene.fog.far = th.fog[2];
  scene.background.set(th.sky[2]);
  sun.color.set(th.sun[0]); sun.intensity = th.sun[1];
  hemi.color.set(th.hemi[0]); hemi.groundColor.set(th.hemi[1]); hemi.intensity = th.hemi[2];
  const d = new THREE.Vector3(...th.sun[2]).normalize();
  sky.sunSprite.position.copy(d).multiplyScalar(800); sky.sunSprite.material.color.set(th.sun[0]);
  sky.sunSprite.material.opacity = neon ? 0.35 : 0.9; sky.sunSprite.scale.setScalar(neon ? 120 : 260);
  sky.stars.visible = !!th.stars;
  sky.clouds.children.forEach(c => { c.material.opacity = th.clouds; c.visible = th.clouds > 0; c.material.color.set(th.key === 'beach' ? '#ffd9c0' : '#ffffff'); });
  sky.hillMat.color.set(th.hills);
  renderer.toneMappingExposure = th.exposure;
  if (ctx.post) ctx.post.bloom.strength = th.bloom;
  return d;
}

// ---------------------------------------------------------------- scenery
function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}
const part = (geo, color, x = 0, y = 0, z = 0) => colored(geo.translate(x, y, z), color);
const trunk = (h = 1.3) => part(new THREE.CylinderGeometry(0.14, 0.22, h, 6), '#6b4426', 0, h / 2, 0);
const TREES = {
  round: () => mergeGeometries([trunk(), part(new THREE.IcosahedronGeometry(1.2, 1), '#3f9a3a', 0, 2.0, 0), part(new THREE.IcosahedronGeometry(0.75, 1), '#55b04a', 0.6, 2.7, 0.3)]),
  pine: () => mergeGeometries([trunk(1.0), part(new THREE.ConeGeometry(1.1, 1.7, 7), '#2f7a3c', 0, 1.6, 0), part(new THREE.ConeGeometry(0.85, 1.5, 7), '#358544', 0, 2.5, 0), part(new THREE.ConeGeometry(0.55, 1.2, 7), '#3c914c', 0, 3.3, 0)]),
  snowpine: () => mergeGeometries([trunk(1.0), part(new THREE.ConeGeometry(1.1, 1.7, 7), '#2f6f50', 0, 1.6, 0), part(new THREE.ConeGeometry(0.9, 0.9, 7), '#ffffff', 0, 2.15, 0),
    part(new THREE.ConeGeometry(0.85, 1.5, 7), '#357a58', 0, 2.6, 0), part(new THREE.ConeGeometry(0.66, 0.8, 7), '#ffffff', 0, 3.05, 0), part(new THREE.ConeGeometry(0.5, 1.2, 7), '#ffffff', 0, 3.6, 0)]),
  palm: () => {
    const parts = [];
    for (let k = 0; k < 5; k++) parts.push(part(new THREE.CylinderGeometry(0.13 - k * 0.012, 0.16 - k * 0.012, 0.75, 6), k % 2 ? '#8a6a44' : '#7a5c3a', k * k * 0.035, 0.36 + k * 0.7, 0));
    for (let k = 0; k < 7; k++) {
      const leaf = new THREE.ConeGeometry(0.3, 2.1, 4); leaf.scale(1, 1, 0.22); leaf.rotateZ(-Math.PI / 2 - 0.4); leaf.translate(0.95, -0.25, 0); leaf.rotateY(k / 7 * Math.PI * 2);
      parts.push(part(leaf, k % 2 ? '#3fa04a' : '#4cb356', 0.56, 3.55, 0));
    }
    for (let k = 0; k < 3; k++) parts.push(part(new THREE.SphereGeometry(0.13, 6, 5), '#5a3d22', 0.56 + Math.cos(k * 2.1) * 0.18, 3.3, Math.sin(k * 2.1) * 0.18));
    return mergeGeometries(parts);
  },
  cactus: () => {
    const arm = (s) => { const a = new THREE.CylinderGeometry(0.14, 0.14, 0.55, 7); a.rotateZ(Math.PI / 2); a.translate(s * 0.4, 0, 0); return a; };
    return mergeGeometries([part(new THREE.CylinderGeometry(0.27, 0.3, 2.2, 8), '#3f9455', 0, 1.1, 0), part(new THREE.SphereGeometry(0.27, 8, 6), '#3f9455', 0, 2.2, 0),
      part(arm(1), '#3a8a4f', 0, 1.0, 0), part(new THREE.CylinderGeometry(0.14, 0.14, 0.8, 7), '#3a8a4f', 0.62, 1.35, 0), part(new THREE.SphereGeometry(0.14, 7, 5), '#3a8a4f', 0.62, 1.75, 0),
      part(arm(-1), '#3a8a4f', 0, 1.4, 0), part(new THREE.CylinderGeometry(0.14, 0.14, 0.6, 7), '#3a8a4f', -0.62, 1.65, 0), part(new THREE.SphereGeometry(0.14, 7, 5), '#3a8a4f', -0.62, 1.95, 0)]);
  },
  mesa: () => mergeGeometries([part(new THREE.CylinderGeometry(1.3, 1.7, 1.3, 7), '#b8603a', 0, 0.65, 0), part(new THREE.CylinderGeometry(0.95, 1.25, 1.0, 7), '#cf7a4c', 0.1, 1.8, 0), part(new THREE.CylinderGeometry(0.6, 0.9, 0.8, 7), '#e0935f', 0.15, 2.7, 0)]),
  crystal: () => {
    const sh = (s, h, c, x, z, tilt) => { const g = new THREE.OctahedronGeometry(s, 0); g.scale(1, h, 1); g.rotateZ(tilt); return part(g, c, x, s * h * 0.8, z); };
    return mergeGeometries([sh(0.45, 2.6, '#6ff5ff', 0, 0, 0.1), sh(0.32, 2.2, '#ff6ae0', 0.5, 0.2, -0.35), sh(0.26, 1.8, '#b48cff', -0.4, -0.3, 0.4)]);
  },
};
const treeGeoCache = {};
const treeGeo = k => treeGeoCache[k] || (treeGeoCache[k] = TREES[k]());
const leafMat = std({ roughness: 0.9, flatShading: true, vertexColors: true });
const glowLeafMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const bushGeo = new THREE.IcosahedronGeometry(0.55, 1);
const rockGeo = new THREE.DodecahedronGeometry(0.45, 0);
const flowerGeo = new THREE.SphereGeometry(0.08, 6, 4);
const bushMat = std({ roughness: 0.9, flatShading: true });
const rockMat = std({ roughness: 0.95, flatShading: true });
const flowerMat = std({ roughness: 0.6 });
const flowerGlowMat = new THREE.MeshBasicMaterial();
export const keepGeos = new Set([bushGeo, rockGeo, flowerGeo]);
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
  const inst = (geo, mat, list, f, useColor = true) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.castShadow = true; im.receiveShadow = true;
    list.forEach((p, i) => { col.set('#ffffff'); f(p, i); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); if (useColor) im.setColorAt(i, col); });
    g.add(im);
  };
  for (const [kind, n] of th.scenery) {
    keepGeos.add(treeGeo(kind));
    inst(treeGeo(kind), kind === 'crystal' ? glowLeafMat : leafMat, pts(n, kind === 'mesa' ? 5 : 3.5), ([x, z]) => {
      const s = (kind === 'mesa' ? 1.2 : 0.8) + R() * (kind === 'mesa' ? 1.6 : 0.9);
      dummy.position.set(x, groundY - 0.05, z); dummy.scale.set(s, s * (0.85 + R() * 0.3), s); dummy.rotation.set(0, R() * 6.28, 0);
      const v = 0.85 + R() * 0.3; col.setRGB(v, v, v);
    });
  }
  // bushes hugging the course edges
  const bushes = [];
  for (const t of hole.tiles) for (const [dx, dz] of C.DIRS) {
    if (hole.tiles.some(o => o.gx === t.gx + dx && o.gz === t.gz + dz)) continue;
    const n = 1 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) { const off = (R() - 0.5) * (T - 0.8); bushes.push([t.cx + dx * (T / 2 + 0.75) - dz * off, t.cz + dz * (T / 2 + 0.75) + dx * off]); }
  }
  const bc = new THREE.Color(th.bush), hsl = {}; bc.getHSL(hsl);
  inst(bushGeo, bushMat, bushes, ([x, z]) => { const s = 0.7 + R() * 0.7; dummy.position.set(x, groundY + 0.3 * s, z); dummy.scale.set(s, s * 0.8, s); dummy.rotation.set(0, R() * 6, 0); col.setHSL(hsl.h + (R() - 0.5) * 0.05, hsl.s, hsl.l * (0.85 + R() * 0.3)); });
  const rc = new THREE.Color(th.rock);
  inst(rockGeo, rockMat, pts(20, 1.5), ([x, z]) => { const s = 0.5 + R() * 1.6; dummy.position.set(x, groundY + 0.1, z); dummy.scale.set(s, s * 0.6, s); dummy.rotation.set(R(), R() * 6, R()); const v = 0.8 + R() * 0.4; col.copy(rc).multiplyScalar(v); });
  if (th.flowers) {
    const flowers = [];
    for (const [cx, cz] of pts(18, 1.2)) for (let k = 0; k < 14; k++) flowers.push([cx + (R() - 0.5) * 1.8, cz + (R() - 0.5) * 1.8]);
    inst(flowerGeo, th.key === 'neon' ? flowerGlowMat : flowerMat, flowers.filter(([x, z]) => !near(x, z, 0.5)), ([x, z]) => { dummy.position.set(x, groundY + 0.12, z); dummy.scale.setScalar(0.8 + R() * 0.6); dummy.rotation.set(0, 0, 0); col.set(th.flowers[Math.floor(R() * th.flowers.length)]); });
  }
  return g;
}

// ---------------------------------------------------------------- flag, glow, labels, bubbles
export function makeFlag(holeNum) {
  const tex = canvasTex(128, 80, (g, w, h) => {
    g.fillStyle = '#e62e2e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = 'bold 52px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(holeNum), w / 2 - 6, h / 2 + 2);
  }, { clamp: true });
  const geo = new THREE.PlaneGeometry(0.72, 0.45, 12, 4).translate(0.36, -0.225, 0);
  const flag = new THREE.Mesh(geo, std({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
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
  g.fillStyle = 'rgba(15,30,20,.72)'; g.beginPath(); g.roundRect(x0, 10, w, 44, 22); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(x0 + 22, 32, 10, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, x0 + 40, 33, 190);
  return spriteFromCanvas(cv, 1.5, 0.375);
}
export function makeBubble(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  g.font = '600 44px Fredoka, system-ui, sans-serif';
  const tw = Math.min(220, g.measureText(text).width), w = tw + 36, x0 = (256 - w) / 2;
  g.fillStyle = '#fffdf6'; g.strokeStyle = '#1d6b3a'; g.lineWidth = 5;
  g.beginPath(); g.roundRect(x0, 8, w, 76, 26); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(116, 82); g.lineTo(128, 112); g.lineTo(142, 82); g.fill(); g.stroke();
  g.fillStyle = '#fffdf6'; g.fillRect(112, 76, 34, 8);
  g.fillStyle = '#1f3a2a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 48, 220);
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
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, depthWrite: false }));
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
