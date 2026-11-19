// Ultimate Obstacle Course: three.js view. A bright, glossy game-show set: soft rounded foam platforms in candy
// colors (layered "cake" tops with patterns, ink outlines, striped support pillars down into a glossy pink slime
// sea), candy-striped sweepers, chunky hammers, inflatable start / checkpoint / finish arches, a stadium of
// bouncing fans with bunting and flags, sweeping spotlights, giant balloons and pinwheels, a sky with a glowing
// sun and puffy clouds. Bloom on High. Contestants are the hub's shared avatar (party color + hat) with squash &
// stretch, dives, belly slides, tumbles and hangs.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { pose, active, blinkU, lavaLevel, TILE_FALL } from './world.js';

const TAU = Math.PI * 2;
const GRAD = new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat); GRAD.needsUpdate = true;
// per-stage color moods: top / side of platforms, accent, second accent, sky top / horizon, slime
// stages that get their own scenery instead of the candy stadium
const ENV = { ruins: 'temple', volcano: 'lava', frostbite: 'ice', skyislands: 'meadow', jungle: 'meadow', tiptoe: 'meadow', mountain: 'meadow' };
const THEMES = {
  bumpers: { top: 0xffc266, side: 0xf08a1a, accent: 0xff4d5e, acc2: 0x3ea6ff, bridge: 0xffe07a, sky: [0x3a5cff, 0xffd8b0], slime: 0xc84fff },
  dodge: { top: 0x9ad8ff, side: 0x3a8fe0, accent: 0xff5ab0, acc2: 0xffd23f, bridge: 0xcfeaff, sky: [0x2a6cff, 0xcff6ff], slime: 0xff4fb3 },
  tiptoe: { top: 0xd0b0ff, side: 0x8a5cf0, accent: 0x2ee6d6, acc2: 0xff8fd0, bridge: 0xffd23f, sky: [0x5a4cff, 0xffc4e8], slime: 0x4fc8e0 },
  mountain: { top: 0xb0f0a0, side: 0x3ca84a, accent: 0xffcc33, acc2: 0xff5a5f, bridge: 0xfff0a8, sky: [0x2a7cff, 0xfff2c8], slime: 0xff5a3f },
  tiles: { top: 0xff8fd0, side: 0xc04fb8, accent: 0x2ee6d6, acc2: 0xffd23f, bridge: 0xffd23f, sky: [0x5163ff, 0xffc4e8], slime: 0xff3fa4 },
  sweep: { top: 0xffde5c, side: 0xf0a800, accent: 0xff4d5e, acc2: 0x3ea6ff, bridge: 0xffffff, sky: [0x2f7cff, 0xffe9a8], slime: 0xff4fb3 },
  crown: { top: 0xd4b4ff, side: 0x9466f0, accent: 0xffcc33, acc2: 0xff5ab0, bridge: 0xff9ad5, sky: [0x2a5cff, 0xffc7a8], slime: 0xff4fb3 },
  last: { top: 0x5cf0e2, side: 0x18b3a6, accent: 0xff5ab0, acc2: 0xffd23f, bridge: 0xffd23f, sky: [0x4252ff, 0xff9ed8], slime: 0xff3f9a },
  ruins: { top: 0xe2cc98, side: 0x9a7f52, accent: 0x3fae5a, acc2: 0xff8c42, bridge: 0xd8c08a, sky: [0x3a8cff, 0xd8f0c8], slime: 0x3fae8a },
  volcano: { top: 0xc8b8a8, side: 0x6a5560, accent: 0xff5a1a, acc2: 0xffd23f, bridge: 0xd8c8b8, sky: [0x6a2a4a, 0xff9a6a], slime: 0xff6a1a },
  frostbite: { top: 0xeaf8ff, side: 0x7ac8ee, accent: 0xb57bff, acc2: 0x6fdcff, bridge: 0xcfeaff, sky: [0x4a8cff, 0xeaf6ff], slime: 0x7ad8ff },
  factory: { top: 0xffb3d9, side: 0xe05aa0, accent: 0x2ee6b0, acc2: 0xffd23f, bridge: 0xffe0f0, sky: [0x5a4cff, 0xffc8e8], slime: 0xff4fb3 },
  skyislands: { top: 0xffe680, side: 0xf0a800, accent: 0xff5ab0, acc2: 0x6fdcff, bridge: 0xffd0e8, sky: [0x1a6cff, 0xffd6b0], slime: 0x6fb8ff },
  clockwork: { top: 0xb8c4ff, side: 0x5a6cf0, accent: 0xffb830, acc2: 0xff4d5e, bridge: 0xdfe4ff, sky: [0x2a2c8f, 0xffb88a], slime: 0xffb830 },
  jungle: { top: 0xa6e86c, side: 0x4a9a32, accent: 0xff8c42, acc2: 0xffd23f, bridge: 0xd8b878, sky: [0x2f9bff, 0xd8ffe0], slime: 0x3fc8a0 },
};
const TILE_COLS = [[0xff8fd0, 0xd85bb5], [0xc6a0ff, 0x8c5ce8], [0x7fd8ff, 0x3a9ae0]];
const CONF = [0xff5a5f, 0x3ea6ff, 0x4cd964, 0xffcc00, 0xb57bff, 0xff8c42, 0x2ee6d6, 0xff6ec7, 0xffffff];

function canvasTex(w, h, draw, rep = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
const shade = (hex, k) => { const c = new THREE.Color(hex); return k > 0 ? c.lerp(new THREE.Color(0xffffff), k).getHex() : c.lerp(new THREE.Color(0x1d1633), -k).getHex(); };

export function createView(ctx) {
  const renderer = ctx.three.createRenderer();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
  const hemi = new THREE.HemisphereLight(0xe6f4ff, 0xffc2e4, 0.82); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.6); sun.position.set(18, 34, -12); scene.add(sun); scene.add(sun.target);
  const rim = new THREE.DirectionalLight(0xffa6dc, 0.32); rim.position.set(-20, 12, 30); scene.add(rim);
  const keep = new Set();
  const K = (x) => { keep.add(x); return x; };
  let envTex = null, composer = null, bloom = null;
  function shadowQ() {
    const q = ctx.quality();
    sun.castShadow = q.shadows;
    if (q.shadows) { sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 140 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; }
  }
  function setupQuality() {
    const q = ctx.quality();
    shadowQ();
    // glossy plastic needs an environment to reflect; skipped on Low
    if (q.shadows && !envTex) { const pm = new THREE.PMREMGenerator(renderer); envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
    scene.environment = q.shadows ? envTex : null;
    if (q.effects && !composer) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.28, 0.35, 1.1); composer.addPass(bloom);
      composer.addPass(new OutputPass());
    } else if (!q.effects && composer) { composer.dispose(); bloom.dispose(); composer = bloom = null; }
  }

  // ---- textures (live for the whole game)
  const T = {
    dots: K(canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(40,0,80,0.09)'; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc(x * 32 + 16 + (y % 2) * 16, y * 32 + 16, 7, 0, TAU); g.fill(); } })),
    tiles: K(canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(40,0,80,0.13)'; g.lineWidth = 5; g.strokeRect(2, 2, w - 4, h - 4); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(10, 10, 40, 6); })),
    stripes: K(canvasTex(128, 64, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff2f6a'; for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 32, h); g.lineTo(i * 32 + 16, h); g.lineTo(i * 32 + 48, 0); g.lineTo(i * 32 + 32, 0); g.fill(); } })),
    hazard: K(canvasTex(128, 64, (g, w, h) => { g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d1633'; for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 32, h); g.lineTo(i * 32 + 16, h); g.lineTo(i * 32 + 48, 0); g.lineTo(i * 32 + 32, 0); g.fill(); } })),
    check: K(canvasTex(64, 64, (g) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#1d1633' : '#ffffff'; g.fillRect(x * 8, y * 8, 8, 8); } })),
    chevron: K(canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#3b3358'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffd23f'; g.lineWidth = 8; g.lineCap = 'round'; for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(10, 26 + i * 32 - 10); g.lineTo(32, 26 + i * 32); g.lineTo(54, 26 + i * 32 - 10); g.stroke(); } })),
    arrows: K(canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#1d1633'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round'; for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(14, 30 + i * 22); g.lineTo(32, 14 + i * 22); g.lineTo(50, 30 + i * 22); g.stroke(); } })),
    polka: K(canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.0)'; g.fillStyle = 'rgba(40,0,80,0.16)'; for (const [x, y] of [[16, 16], [48, 48]]) { g.beginPath(); g.arc(x, y, 9, 0, TAU); g.fill(); } })),
    wedge: K(canvasTex(256, 256, (g, w, h) => { g.translate(128, 128); for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#ffd7ec' : '#ffe39a'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 130, i * TAU / 12, (i + 1) * TAU / 12); g.fill(); } g.fillStyle = '#ff5ab0'; g.beginPath(); g.arc(0, 0, 30, 0, TAU); g.fill(); }, false)),
    star: K(canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd23f'; g.strokeStyle = '#1d1633'; g.lineWidth = 6; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 22 : 48, a = i * Math.PI / 5 - Math.PI / 2; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke(); }, false)),
    lava: K(canvasTex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 10, 64, 64, 90); gr.addColorStop(0, '#ffe680'); gr.addColorStop(0.5, '#ff8a1a'); gr.addColorStop(1, '#d8360a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,240,150,0.6)'; for (let i = 0; i < 14; i++) { g.beginPath(); g.arc((i * 37) % 128, (i * 61) % 128, 4 + (i % 4) * 3, 0, TAU); g.fill(); } })),
    bricks: K(canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(40,0,80,0.16)'; g.lineWidth = 5; for (let y = 0; y < 4; y++) { g.beginPath(); g.moveTo(0, y * 32); g.lineTo(w, y * 32); g.stroke(); for (let x = 0; x < 3; x++) { const xx = x * 48 + (y % 2) * 24; g.beginPath(); g.moveTo(xx, y * 32); g.lineTo(xx, y * 32 + 32); g.stroke(); } } })),
  };
  const textTex = (txt, bg = '#ffd23f', fg = '#1d1633', w = 512, h = 128) => canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 26); g.fill(); g.lineWidth = 8; g.strokeStyle = '#1d1633'; g.stroke();
    g.fillStyle = fg; g.font = `${Math.round(h * 0.6)}px "Lilita One", "Arial Black", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2 + 4);
  }, false);

  // ---- materials
  const lowQ = () => !ctx.quality().shadows;
  const plastic = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0, envMapIntensity: 0.45, ...o });
  const toon = (color, o = {}) => new THREE.MeshToonMaterial({ color, gradientMap: GRAD, ...o });
  const ink = K(new THREE.MeshBasicMaterial({ color: 0x1d1633, side: THREE.BackSide }));
  const M = {
    white: K(plastic(0xffffff)), ink: K(plastic(0x2b2350, { roughness: 0.6 })), chrome: K(plastic(0xdfe6ff, { metalness: 0.75, roughness: 0.22 })),
    beam: K(plastic(0xffffff, { map: T.stripes, roughness: 0.3 })), hazard: K(plastic(0xffffff, { map: T.hazard })), gold: K(plastic(0xffcc33, { metalness: 0.2, roughness: 0.35, emissive: 0x442a00 })),
    red: K(plastic(0xff4d5e)), yellow: K(plastic(0xffd23f)), shadow: K(new THREE.MeshBasicMaterial({ color: 0x1d1633, transparent: true, opacity: 0.3, depthWrite: false })),
    bulb: K(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6b0).multiplyScalar(2.2) })), glowBeam: K(new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })),
  };
  const blobGeo = K(new THREE.CircleGeometry(0.5, 24));

  // ---- sky dome (gradient + sun glow), clouds, slime sea
  const sunDir = new THREE.Vector3(0.35, 0.42, 0.84).normalize();
  const skyMat = K(new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { top: { value: new THREE.Color(0x3f8cff) }, bot: { value: new THREE.Color(0xffd3f2) }, sd: { value: sunDir } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bot; uniform vec3 sd; varying vec3 vp;
      void main(){ float k = smoothstep(-0.12, 0.65, vp.y); vec3 c = mix(bot, top, k);
        float s = max(dot(normalize(vp), sd), 0.0); c = min(c, vec3(0.97)); c += vec3(1.0,0.9,0.7) * (pow(s, 600.0) * 2.4 + pow(s, 12.0) * 0.22);
        gl_FragColor = vec4(c, 1.0); }` }));
  const sky = new THREE.Mesh(K(new THREE.SphereGeometry(800, 32, 16)), skyMat); scene.add(sky);
  const slimeMat = K(new THREE.ShaderMaterial({ uniforms: { t: { value: 0 }, col: { value: new THREE.Color(0xff4fb3) }, fogC: { value: new THREE.Color(0xffd3f2) } },
    vertexShader: 'uniform float t; varying vec2 vu; varying float vh; varying float vd; void main(){ vec3 p = position; float h = sin(p.x*0.16+t*1.3)*0.5 + cos(p.y*0.19+t*1.05)*0.5 + sin((p.x+p.y)*0.07+t*0.6)*0.4; p.z += h*0.5; vh = h; vu = p.xy; vec4 mv = modelViewMatrix * vec4(p,1.0); vd = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform vec3 col; uniform vec3 fogC; uniform float t; varying vec2 vu; varying float vh; varying float vd;
      void main(){ float s = smoothstep(0.62, 0.98, sin(vu.x*0.45+t*0.7)*0.5+0.5 + cos(vu.y*0.38-t*0.55)*0.32);
        float sp = smoothstep(0.93, 1.0, sin(vu.x*1.7+t*2.1)*sin(vu.y*1.5-t*1.7));
        vec3 c = col * (0.78 + vh*0.16) + vec3(1.0,0.86,0.96)*s*0.4 + vec3(1.0)*sp*0.55;
        c = mix(c, fogC, smoothstep(120.0, 420.0, vd)); gl_FragColor = vec4(c, 1.0); }` }));
  const slime = new THREE.Mesh(K(new THREE.PlaneGeometry(900, 900, 90, 90)), slimeMat); slime.rotation.x = -Math.PI / 2; scene.add(slime);
  const cloudGeo = K(new THREE.SphereGeometry(1, 14, 10)), cloudMat = K(new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x6a5a70 }));
  const clouds = new THREE.Group(); scene.add(clouds);
  const crand = mulberry(77);
  for (let i = 0; i < 30; i++) {
    const g = new THREE.Group(), n = 4 + Math.floor(crand() * 4);
    for (let k = 0; k < n; k++) { const m = new THREE.Mesh(cloudGeo, cloudMat); m.position.set(k * 3.2 - n * 1.6 + crand(), crand() * 1.8 - (k === 0 || k === n - 1 ? 0.8 : 0), crand() * 2.2); m.scale.setScalar(2.4 + crand() * 2.8 - (k === 0 || k === n - 1 ? 1 : 0)); m.scale.y *= 0.8; g.add(m); }
    const a = crand() * TAU, r = 170 + crand() * 230; g.position.set(Math.sin(a) * r, 30 + crand() * 70, Math.cos(a) * r + 60); g.userData.v = 0.4 + crand() * 0.8; g.scale.setScalar(1 + crand()); clouds.add(g);
  }
  const set = new THREE.Group(); scene.add(set);       // studio set (per stage)

  // ---- stage
  let stage = null, root = null, theme = THEMES.sweep, blastIdx = 0, envKind = null;
  const occ = [], ray = new THREE.Raycaster(), rayFrom = new THREE.Vector3(), rayDir = new THREE.Vector3(), OCC = new Set(['column', 'summit', 'bwall', 'wall', 'rushwall', 'pillar']);
  let occDist = 99;
  const spikeObjs = [], lavaObjs = [], bombObjs = [], swings = [], fanObjs = [], balls = [], arches = [], dyn = [], tiles = [], doors = [], belts = [], blinks = [], pads = [], spots = [], spinners = [], balloons = [];
  let crownObj = null, stageMats = [], geoCache = new Map(), crowd = null, flags = [];
  const SM = (m) => { stageMats.push(m); return m; };
  const geo = (key, make) => { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; };
  const rbox = (w, h, d, r = 0.3) => { const rr = Math.max(0.02, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01)); const seg = lowQ() ? 2 : 3; return geo(`rb${w.toFixed(2)},${h.toFixed(2)},${d.toFixed(2)},${rr.toFixed(2)},${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, rr)); };
  const outlines = () => !lowQ();
  // ink outline with even thickness on every side
  function outline(m, t = 0.07, dims = null) {
    if (!outlines()) return m;
    const o = new THREE.Mesh(m.geometry, ink);
    if (dims) o.scale.set(1 + 2 * t / dims[0], 1 + 2 * t / dims[1], 1 + 2 * t / dims[2]);
    else { m.geometry.computeBoundingSphere(); o.scale.setScalar(1 + t / Math.max(0.3, m.geometry.boundingSphere.radius)); }
    o.castShadow = false; m.add(o); return m;
  }
  // a "cake" platform: rounded foam body + patterned cushion on top (top surface at the solid's top)
  function cake(s, topCol, sideCol, map = T.dots, rep = 2.4) {
    const w = s.hx * 2, h = s.hy * 2, d = s.hz * 2;
    const body = outline(new THREE.Mesh(rbox(w, h, d, Math.min(0.45, h * 0.45)), SM(plastic(sideCol, { roughness: 0.62 }))), 0.07, [w, h, d]);
    const ct = Math.min(0.3, h * 0.4), inset = Math.min(0.35, Math.min(w, d) * 0.12);
    const mat = SM(plastic(new THREE.Color(topCol).multiplyScalar(0.9).getHex(), { map: map.clone(), roughness: 0.82, envMapIntensity: 0.2 })); mat.map.needsUpdate = true; mat.map.repeat.set(Math.max(1, (w - inset * 2) / rep), Math.max(1, (d - inset * 2) / rep));
    const top = new THREE.Mesh(rbox(w - inset * 2, ct, d - inset * 2, ct * 0.45), mat); top.position.y = s.hy - ct / 2 + 0.03; body.add(top);
    return body;
  }
  function pillarUnder(m, s, col) {
    if (!stage || s.anim) return;
    const bottom = s.y - s.hy, depth = bottom - (stage.killY + 3.2);
    if (depth < 1) return;
    const r = Math.max(0.5, Math.min(1.3, Math.min(s.hx, s.hz) * 0.35));
    const zs = s.hz > 6 ? [-s.hz * 0.55, s.hz * 0.55] : [0];
    for (const dz of zs) {
      const p = new THREE.Mesh(geo(`pil${r.toFixed(2)},${depth.toFixed(1)}`, () => new THREE.CylinderGeometry(r, r * 1.25, depth, lowQ() ? 10 : 18)), SM(plastic(col, { roughness: 0.55 })));
      p.position.set(0, -s.hy - depth / 2, dz); m.add(p);
      for (const k of [0.25, 0.6]) { const band = new THREE.Mesh(geo(`band${r.toFixed(2)}`, () => new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.35, lowQ() ? 10 : 18)), M.white); band.position.y = depth / 2 - depth * k; p.add(band); }
    }
  }
  function meshFor(s) {
    const th = theme;
    let m;
    switch (s.look) {
      case 'start': m = cake(s, 0xffe066, 0xf0a800, T.arrows, 2.2); arch(m, s, 'START', 0x3ea6ff, s.hz - 1.2); break;
      case 'cp': m = cake(s, 0x8ff5d2, 0x22b893, T.tiles, 2); arch(m, s, 'CHECKPOINT', 0x2ee6d6, -s.hz + 0.6, true); break;
      case 'finish': m = cake(s, 0xffffff, 0xff5ab0, T.check, 2); arch(m, s, 'FINISH', 0xff5ab0, -s.hz + 1.6); break;
      case 'floor': { const tops = [th.top, th.bridge, th.acc2, th.accent], c = tops[(s.pal || 0) % 4], mp = [T.dots, T.tiles, T.dots, T.arrows][(s.pal || 0) % 4]; m = cake(s, c, shade(c, -0.38), mp); break; }
      case 'terrace': { const c = [th.top, th.accent, th.bridge, th.acc2][(s.step || 0) % 4]; m = cake(s, c, shade(c, -0.4), T.tiles, 2.2); const lip = new THREE.Mesh(rbox(s.hx * 2 + 0.1, 0.3, 0.5, 0.12), M.hazard); lip.position.set(0, s.hy - 0.1, -s.hz + 0.2); m.add(lip); break; }
      case 'summit2': m = cake(s, 0xffd95c, 0xe09a00, T.wedge, 14); break;
      case 'ice': { m = cake(s, 0xdcf7ff, 0x6fc3ea, T.tiles, 2.4); const top = m.children[m.children.length - 1]; top.material.roughness = 0.12; top.material.envMapIntensity = 1.3; break; }
      case 'bridge': case 'beamwalk': case 'ring': m = cake(s, th.bridge, shade(th.bridge, -0.35), T.tiles, 2); break;
      case 'step': m = cake(s, th.accent, shade(th.accent, -0.3), T.tiles, 2); break;
      case 'mover': m = cake(s, th.accent, shade(th.accent, -0.35), T.arrows, 1.8); break;
      case 'lift': m = cake(s, 0x8ff5d2, 0x22b893, T.arrows, 1.8); break;
      case 'blink': { m = cake(s, th.acc2, shade(th.acc2, -0.35), T.star, 3.3); m.traverse((o) => { if (o.material && o.material !== ink) { o.material.transparent = true; } }); blinks.push(m); break; }
      case 'pad': {
        m = new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, Math.min(0.12, s.hy)), SM(plastic(0x58e05a, { map: T.arrows, emissive: 0x2a8a10, emissiveIntensity: 0.5 }))); outline(m, 0.04, [s.hx * 2, s.hy * 2, s.hz * 2]);
        const ring = new THREE.Mesh(geo('padring', () => new THREE.TorusGeometry(1, 0.08, 8, 32)), SM(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb6ff7a).multiplyScalar(1.8), transparent: true, opacity: 0.8 }))); ring.rotation.x = -Math.PI / 2; ring.position.y = s.hy + 0.04; m.add(ring);
        pads.push({ m, ring, s }); break;
      }
      case 'bar': case 'beam': {
        const len = s.hx * 2, r = Math.max(s.hy, s.hz) * 1.15;
        m = new THREE.Group();
        const bar = new THREE.Mesh(geo(`beam${len.toFixed(2)},${r.toFixed(2)}`, () => { const g = new THREE.CapsuleGeometry(r, len - r * 2, 4, 14); g.rotateZ(Math.PI / 2); return g; }), M.beam);
        M.beam.map.repeat.set(len / 1.2, 1);
        outline(bar, 0.05); m.add(bar);
        if (!s.ox) { const hub = new THREE.Mesh(geo('hubc', () => new THREE.CylinderGeometry(0.55, 0.55, 0.7, 20)), M.gold); m.add(hub); }
        if (s.high || s.look === 'bar') bar.material = M.hazard;
        if (s.look === 'bar') { for (const k of [-1, 1]) { const cap = new THREE.Mesh(geo('barcap', () => new THREE.SphereGeometry(0.42, 12, 8)), M.red); cap.position.x = k * (len / 2); m.add(cap); } m.children[1]?.removeFromParent?.(); }
        break;
      }
      case 'log': {
        const len = s.hx * 2, rad = s.hy * 1.1;
        m = outline(new THREE.Mesh(geo(`log${len.toFixed(2)},${rad.toFixed(2)}`, () => { const g = new THREE.CylinderGeometry(rad, rad, len, 20); g.rotateZ(Math.PI / 2); return g; }), SM(plastic(0xffb36b, { map: T.stripes.clone(), roughness: 0.5 }))), 0.06);
        m.material.map.needsUpdate = true; m.material.map.repeat.set(len / 2, 1);
        for (const k of [-1, 1]) { const cap = new THREE.Mesh(geo('logcap', () => new THREE.CylinderGeometry(rad * 1.05, rad * 1.05, 0.3, 20)), M.yellow); cap.rotation.z = Math.PI / 2; cap.position.x = k * len / 2; m.add(cap); }
        break;
      }
      case 'snowball': case 'ball': {
        const FR = s.look === 'snowball' ? ['#ffffff', '#dfefff'] : [['#3fbf4f', '#1f7a32'], ['#ff9f1c', '#e06a00'], ['#ff4d6d', '#b01e3f']][Math.abs(Math.round(s.bx * 7 + s.bz)) % 3];
        const tex = canvasTex(128, 64, (g, w, h) => { g.fillStyle = FR[0]; g.fillRect(0, 0, w, h); g.fillStyle = FR[1]; for (let i = 0; i < 8; i++) g.fillRect(i * 16 + 4, 0, 7, h); });
        m = new THREE.Group();
        const ball = outline(new THREE.Mesh(geo(`ball${s.r}`, () => new THREE.SphereGeometry(s.r, 28, 20)), SM(plastic(0xffffff, { map: tex, roughness: 0.35 }))), 0.07);
        m.add(ball); m.userData.ball = ball; balls.push({ m: ball, s, root: m });
        break;
      }
      case 'swing': {
        m = new THREE.Group();
        const hinge = new THREE.Group(); hinge.position.x = -s.hx; m.add(hinge);
        const panel = outline(new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, 0.2), SM(plastic(0xffd23f, { map: T.hazard.clone(), roughness: 0.4 }))), 0.06, [s.hx * 2, s.hy * 2, s.hz * 2]);
        panel.material.map.needsUpdate = true; panel.material.map.repeat.set(s.hx, 2); panel.position.x = s.hx; hinge.add(panel);
        const post = new THREE.Mesh(geo('gpost', () => new THREE.CylinderGeometry(0.28, 0.28, 3.6, 12)), M.red); post.position.set(-0.05, 0, 0); hinge.add(post);
        swings.push({ hinge, s, k: 0 });
        break;
      }
      case 'sqtile': {
        const A = [[0xc9a8ff, 0x9a6cf0], [0x9ee0ff, 0x4fb0e8]][s.checker || 0];
        const mat = plastic(A[1], { roughness: 0.55 }), topM = plastic(A[0], { roughness: 0.4 });
        m = new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, 0.22), mat);
        const top = new THREE.Mesh(rbox(s.hx * 2 - 0.3, 0.12, s.hz * 2 - 0.3, 0.05), topM); top.position.y = s.hy - 0.02; m.add(top);
        tiles.push({ m, s, base: s.by, fall: 0, mats: [mat, topM] }); break;
      }
      case 'gate': m = outline(new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, 0.12), SM(plastic(th.acc2, { map: T.polka, roughness: 0.3 }))), 0.05, [s.hx * 2, s.hy * 2, s.hz * 2]); break;
      case 'post': {
        m = outline(new THREE.Mesh(geo(`post${s.r},${s.hy}`, () => new THREE.CylinderGeometry(s.r, s.r * 1.1, s.hy * 2, lowQ() ? 12 : 22)), M.white), 0.05);
        const cap = new THREE.Mesh(geo(`pcap${s.r}`, () => new THREE.SphereGeometry(s.r * 1.05, 16, 10, 0, TAU, 0, Math.PI / 2)), M.red); cap.position.y = s.hy; m.add(cap); break;
      }
      case 'hammer': {
        const g = new THREE.Group(); g.position.set(s.bx, s.by, s.bz); g.rotation.y = s.bry;
        const swing = new THREE.Group(); g.add(swing);
        const L = s.anim.L;
        const arm = new THREE.Mesh(geo(`arm${L}`, () => new THREE.CylinderGeometry(0.14, 0.14, L, 10)), M.chrome); arm.position.y = -L / 2; swing.add(arm);
        const hr = s.hy * 1.12, hl = s.hz * 2.3;
        if (s.look === 'axe') {
          const blade = outline(new THREE.Mesh(geo('axeblade', () => { const sh = new THREE.Shape(); sh.moveTo(-1.2, 0.9); sh.quadraticCurveTo(0, 1.25, 1.2, 0.9); sh.lineTo(0.9, -0.9); sh.quadraticCurveTo(0, -1.35, -0.9, -0.9); sh.closePath(); const g = new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 }); g.translate(0, 0, -0.1); g.rotateY(Math.PI / 2); return g; }), M.chrome), 0.05);
          blade.position.y = -L; swing.add(blade);
          const edge = new THREE.Mesh(geo('axeedge', () => new THREE.BoxGeometry(0.24, 0.28, 2.3)), M.red); edge.position.y = -L + 0.95; swing.add(edge);
        } else {
        const head = outline(new THREE.Mesh(geo(`hh${hr},${hl}`, () => new THREE.CylinderGeometry(hr, hr, hl, lowQ() ? 14 : 26)), M.beam), 0.06); head.rotation.x = Math.PI / 2; head.position.y = -L; swing.add(head);
        for (const k of [-1, 1]) { const cap = new THREE.Mesh(geo(`hcap${hr}`, () => new THREE.CylinderGeometry(hr * 1.1, hr * 1.1, 0.28, lowQ() ? 14 : 26)), M.red); cap.position.y = k * hl / 2; head.add(cap); }
        }
        const hub = new THREE.Mesh(geo('hhub', () => new THREE.SphereGeometry(0.42, 14, 10)), M.gold); g.add(hub);
        const bar = new THREE.Mesh(geo('hbar', () => new RoundedBoxGeometry(0.5, 0.5, 4, 2, 0.15)), M.ink); g.add(bar);
        const pole = new THREE.Mesh(geo('hpole', () => new THREE.CylinderGeometry(0.12, 0.12, 30, 6)), M.chrome); pole.position.y = 15; g.add(pole);
        g.userData = { s, swing, kind: 'pend' };
        g.traverse((o) => { o.castShadow = true; });
        return g;
      }
      case 'disc': {
        m = outline(new THREE.Mesh(geo(`disc${s.r},${s.hy}`, () => new THREE.CylinderGeometry(s.r, s.r * 0.92, s.hy * 2, lowQ() ? 24 : 48)), SM(plastic(shade(th.accent, -0.2)))), 0.06);
        const top = new THREE.Mesh(geo(`disct${s.r}`, () => new THREE.CircleGeometry(s.r * 0.97, lowQ() ? 24 : 48)), SM(plastic(0xffffff, { map: T.wedge }))); top.rotation.x = -Math.PI / 2; top.position.y = s.hy + 0.02; m.add(top);
        const rr = new THREE.Mesh(geo(`discr${s.r}`, () => new THREE.TorusGeometry(s.r, 0.22, 10, lowQ() ? 24 : 48)), M.yellow); rr.rotation.x = Math.PI / 2; rr.position.y = s.hy; m.add(rr);
        break;
      }
      case 'arena': {
        m = outline(new THREE.Mesh(geo(`ar${s.r}`, () => new THREE.CylinderGeometry(s.r, s.r * 0.9, s.hy * 2, 64)), SM(plastic(th.side))), 0.08);
        const top = new THREE.Mesh(geo(`art${s.r}`, () => new THREE.CircleGeometry(s.r * 0.98, 64)), SM(plastic(0xffffff, { map: T.wedge }))); top.rotation.x = -Math.PI / 2; top.position.y = s.hy + 0.02; m.add(top);
        const ring = new THREE.Mesh(geo(`arr${s.r}`, () => new THREE.TorusGeometry(s.r, 0.35, 10, 64)), SM(plastic(th.accent))); ring.rotation.x = Math.PI / 2; ring.position.y = s.hy; m.add(ring);
        break;
      }
      case 'door': {
        const g = new THREE.Group(); g.position.set(s.bx, s.by - s.hy, s.bz); g.rotation.y = s.bry;
        const w = s.hx * 2, h = s.hy * 2, d = s.hz * 2;
        const dm = outline(new THREE.Mesh(rbox(w, h, d, 0.18), SM(plastic(0x3e6dff, { roughness: 0.35 }))), 0.06, [w, h, d]); dm.position.y = s.hy; g.add(dm);
        for (const side of [-1, 1]) {
          const st = new THREE.Mesh(geo('dstar', () => new THREE.PlaneGeometry(1.4, 1.4)), SM(new THREE.MeshStandardMaterial({ map: T.star, transparent: true, alphaTest: 0.5 }))); st.position.set(0, s.hy * 0.35, side * (s.hz + 0.02)); if (side < 0) st.rotation.y = Math.PI; dm.add(st);
          const kn = new THREE.Mesh(geo('dknob', () => new THREE.SphereGeometry(0.14, 10, 8)), M.gold); kn.position.set(s.hx * 0.65, -0.1, side * (s.hz + 0.08)); dm.add(kn);
        }
        g.userData = { s, kind: 'door', d: dm, open: 0 }; doors.push(g);
        g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
        return g;
      }
      case 'pillar': m = outline(new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, 0.12), M.white), 0.05, [s.hx * 2, s.hy * 2, s.hz * 2]); break;
      case 'wall': case 'rail': m = outline(new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, 0.18), SM(plastic(th.acc2, { map: T.tiles }))), 0.06, [s.hx * 2, s.hy * 2, s.hz * 2]); break;
      case 'bwall': { m = outline(new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, 0.25), SM(plastic(th.accent, { map: T.bricks.clone() }))), 0.07, [s.hx * 2, s.hy * 2, s.hz * 2]); m.material.map.needsUpdate = true; m.material.map.repeat.set(s.hx / 1.5, s.hy / 1.5); const trim = new THREE.Mesh(rbox(s.hx * 2 + 0.2, 0.3, s.hz * 2 + 0.2, 0.1), M.yellow); trim.position.y = s.hy; m.add(trim); break; }
      case 'rushwall': { m = outline(new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, 0.22), SM(plastic(0xff8c42, { map: T.polka.clone() }))), 0.07, [s.hx * 2, s.hy * 2, s.hz * 2]); m.material.map.needsUpdate = true; m.material.map.repeat.set(s.hx, s.hy); break; }
      case 'piston': case 'pusher': {
        const w = s.hx * 2, h = s.hy * 2, d = s.hz * 2;
        m = outline(new THREE.Mesh(rbox(w, h, d, 0.28), s.look === 'piston' ? M.red : SM(plastic(th.accent))), 0.07, [w, h, d]);
        const dir = s.anim.v[0] > 0 ? 1 : -1;
        const face = new THREE.Mesh(rbox(0.2, h * 0.8, d * 0.8, 0.08), M.hazard); face.position.x = dir * (s.hx + 0.04); m.add(face);
        if (s.look === 'piston') for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(geo('bel', () => new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14)), M.ink); b.rotation.z = Math.PI / 2; b.position.x = -dir * (s.hx + 0.25 + i * 0.4); m.add(b); }
        break;
      }
      case 'belt': {
        const mat = SM(plastic(0xffffff, { map: T.chevron.clone(), roughness: 0.6 })); mat.map.needsUpdate = true; mat.map.repeat.set(s.hx / 1.2, s.hz / 1.2);
        m = outline(new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, 0.15), mat), 0.06, [s.hx * 2, s.hy * 2, s.hz * 2]); belts.push({ mat, v: -s.belt[1] / 2.4 });
        break;
      }
      case 'tile': {
        const [c1, c2] = TILE_COLS[s.layer % 3];
        const mat = plastic(c2, { roughness: 0.45 }), topM = plastic(c1, { roughness: 0.3 });
        m = new THREE.Mesh(geo(`tile${s.r},${s.hy}`, () => new THREE.CylinderGeometry(s.r * 0.97, s.r * 0.86, s.hy * 2, 6)), mat); m.rotation.y = Math.PI / 6;
        const top = new THREE.Mesh(geo(`tilet${s.r}`, () => new THREE.CylinderGeometry(s.r * 0.86, s.r * 0.9, 0.12, 6)), topM); top.position.y = s.hy; m.add(top);
        tiles.push({ m, s, base: s.by, fall: 0, mats: [mat, topM] }); break;
      }
      case 'column': m = outline(new THREE.Mesh(geo(`col${s.r},${s.hy}`, () => new THREE.CylinderGeometry(s.r, s.r * 1.05, s.hy * 2, 28)), SM(plastic(0xfff1c4, { map: T.bricks.clone() }))), 0.06); m.material.map.needsUpdate = true; m.material.map.repeat.set(4, s.hy); break;
      case 'summit': {
        m = outline(new THREE.Mesh(geo(`sum${s.r}`, () => new THREE.CylinderGeometry(s.r, s.r * 0.8, s.hy * 2, 48)), M.gold), 0.07);
        const top = new THREE.Mesh(geo(`sumt${s.r}`, () => new THREE.CircleGeometry(s.r * 0.97, 48)), SM(plastic(0xffffff, { map: T.wedge }))); top.rotation.x = -Math.PI / 2; top.position.y = s.hy + 0.02; m.add(top);
        break;
      }
      case 'temple': m = cake(s, 0xe2cc98, 0x9a7f52, T.bricks, 2.4); break;
      case 'snow': m = cake(s, 0xf6fcff, 0x9cc8e4, T.dots, 2.4); break;
      case 'basalt': m = cake(s, 0x6a5560, 0x3a2c38, T.tiles, 2.6); break;
      case 'rock': { m = cake(s, 0xa08a70, 0x5e4c3c, T.tiles, 1.6); break; }
      case 'spike': {
        m = new THREE.Group();
        const base = new THREE.Mesh(rbox(s.hx * 2, 0.12, s.hz * 2, 0.05), SM(plastic(0x3a2c38, { roughness: 0.7 }))); base.position.y = -s.hy + 0.06; m.add(base);
        const spikes = new THREE.Group(); m.add(spikes);
        const nx = Math.max(2, Math.round(s.hx * 2 / 0.55)), nz = Math.max(2, Math.round(s.hz * 2 / 0.55));
        const cg = geo('spikecone', () => new THREE.ConeGeometry(0.17, 0.62, 8));
        for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) { const c = new THREE.Mesh(cg, M.chrome); c.position.set(-s.hx + (i + 0.5) * s.hx * 2 / nx, 0.05, -s.hz + (k + 0.5) * s.hz * 2 / nz); spikes.add(c); }
        const glow = new THREE.Mesh(geo(`spg${s.hx},${s.hz}`, () => new THREE.PlaneGeometry(s.hx * 2, s.hz * 2)), SM(new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0, depthWrite: false })));
        glow.rotation.x = -Math.PI / 2; glow.position.y = -s.hy + 0.14; m.add(glow);
        spikeObjs.push({ s, spikes, glow, k: 0 });
        break;
      }
      case 'speed': { const mat = SM(plastic(0x2ee6d6, { map: T.arrows.clone(), emissive: 0x18a0a0, emissiveIntensity: 0.6 })); mat.map.needsUpdate = true; m = new THREE.Mesh(rbox(s.hx * 2, s.hy * 2 + 0.02, s.hz * 2, 0.05), mat); belts.push({ mat, v: -1.4 }); break; }
      case 'hammerbar': { m = outline(new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, 0.14), M.beam), 0.05, [s.hx * 2, s.hy * 2, s.hz * 2]); for (const k of [-1, 1]) { const head = outline(new THREE.Mesh(geo('hbhead', () => new THREE.CylinderGeometry(0.55, 0.55, 1.0, 18)), M.red), 0.05); head.rotation.x = Math.PI / 2; head.position.x = k * (s.hx - 0.3); m.add(head); } break; }
      case 'clock': {
        const face = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#fff7e6'; g.beginPath(); g.arc(128, 128, 126, 0, TAU); g.fill(); g.fillStyle = '#1d1633'; for (let i = 0; i < 12; i++) { const a = i * TAU / 12; g.save(); g.translate(128 + Math.sin(a) * 104, 128 - Math.cos(a) * 104); g.rotate(a); g.fillRect(-5, -14, 10, 28); g.restore(); } g.strokeStyle = '#ff5ab0'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 120, 0, TAU); g.stroke(); }, false);
        m = outline(new THREE.Mesh(geo(`clock${s.r}`, () => new THREE.CylinderGeometry(s.r, s.r * 0.9, s.hy * 2, lowQ() ? 24 : 48)), SM(plastic(th.accent))), 0.06);
        const top = new THREE.Mesh(geo(`clockt${s.r}`, () => new THREE.CircleGeometry(s.r * 0.97, lowQ() ? 24 : 48)), SM(plastic(0xffffff, { map: face }))); top.rotation.x = -Math.PI / 2; top.position.y = s.hy + 0.02; m.add(top);
        break;
      }
      case 'swingblock': m = outline(new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, 0.35), SM(plastic(0xff7ac8, { map: T.polka.clone() }))), 0.07, [s.hx * 2, s.hy * 2, s.hz * 2]); m.material.map.needsUpdate = true; m.material.map.repeat.set(s.hx, s.hy); break;
      case 'dashfloor': m = cake(s, 0x9ad8ff, 0x3a6cf0, T.check, 4); break;
      case 'dashblock': { const cols = [0xff5a5f, 0xffcc00, 0x4cd964, 0x3ea6ff, 0xb57bff, 0xff8c42]; const c = cols[(s.wave || 0) % cols.length]; m = outline(new THREE.Mesh(rbox(s.hx * 2, s.hy * 2, s.hz * 2, 0.18), SM(plastic(c, { map: T.tiles }))), 0.06, [s.hx * 2, s.hy * 2, s.hz * 2]); break; }
      case 'btile': { m = new THREE.Mesh(geo(`bt${s.r}`, () => new THREE.CylinderGeometry(s.r * 0.97, s.r * 0.86, s.hy * 2, 6)), SM(plastic(0x7a6a8a, { roughness: 0.6 }))); m.rotation.y = Math.PI / 6; const top = new THREE.Mesh(geo(`btt${s.r}`, () => new THREE.CylinderGeometry(s.r * 0.86, s.r * 0.9, 0.12, 6)), SM(plastic(0xffd27a, { roughness: 0.4 }))); top.position.y = s.hy; m.add(top); break; }
      default: m = cake(s, th.top, th.side);
    }
    if (['floor', 'bridge', 'beamwalk', 'start', 'cp', 'finish', 'step', 'terrace', 'summit2', 'temple', 'basalt', 'dashfloor', 'ice'].includes(s.look)) pillarUnder(m, s, th.side);
    m.traverse((o) => { if (o.isMesh && o.material !== ink) { o.castShadow = true; o.receiveShadow = true; } });
    m.userData.s = s;
    return m;
  }
  // inflatable arch with a sign: START / CHECKPOINT / FINISH
  function arch(m, s, text, col, dz, small = false) {
    const g = new THREE.Group(); g.position.set(0, s.hy, dz); m.add(g); arches.push({ g, z: s.z + dz });
    const R = s.hx - 0.4, tube = small ? 0.5 : 0.8;
    const mat = SM(plastic(col, { map: T.stripes.clone(), roughness: 0.3 })); mat.map.needsUpdate = true; mat.map.repeat.set(10, 1);
    const a = outline(new THREE.Mesh(geo(`arch${R.toFixed(1)},${tube}`, () => new THREE.TorusGeometry(R, tube, lowQ() ? 10 : 16, lowQ() ? 24 : 48, Math.PI)), mat), 0.06);
    a.scale.y = small ? 0.55 : 0.75; g.add(a);
    const sign = SM(new THREE.MeshBasicMaterial({ map: textTex(text, small ? '#2ee6d6' : '#ffd23f'), transparent: true }));
    const sw = Math.min(R * 1.1, small ? 5.5 : 7.5), sh = sw / 4;
    for (const side of [1, -1]) { const p = new THREE.Mesh(geo(`sign${sw.toFixed(1)}`, () => new THREE.PlaneGeometry(sw, sh)), sign); p.position.set(0, R * a.scale.y + tube * 0.2, side * (tube + 0.05)); if (side < 0) p.rotation.y = Math.PI; g.add(p); }
    for (const k of [-1, 1]) { const b = new THREE.Mesh(geo('ball', () => new THREE.SphereGeometry(0.55, 14, 10)), M.yellow); b.position.set(k * R, 0.3, 0); g.add(b); }
  }

  function buildStage(st) {
    clearStage();
    stage = st; theme = THEMES[st.id] || THEMES.sweep;
    skyMat.uniforms.top.value.setHex(theme.sky[0]); skyMat.uniforms.bot.value.setHex(theme.sky[1]);
    scene.fog = new THREE.Fog(theme.sky[1], 140, 520);
    slimeMat.uniforms.col.value.setHex(theme.slime); slimeMat.uniforms.fogC.value.setHex(theme.sky[1]);
    slime.position.y = st.killY + 3.5;
    root = new THREE.Group(); scene.add(root);
    for (const s of st.solids) {
      const m = meshFor(s);
      if (!m.userData.kind) { m.position.set(s.x, s.y, s.z); m.rotation.y = s.ry; }
      root.add(m);
      if (OCC.has(s.look) && !s.anim) occ.push(m);
      if (s.anim || s.until) dyn.push(m);
    }
    if (st.crown) {
      crownObj = new THREE.Group(); crownObj.position.set(st.crown.x, st.crown.y, st.crown.z);
      const h = ctx.avatar.hat('crown', 0xffcc33); h.scale.setScalar(2.8); h.position.y = -0.4; crownObj.add(h);
      const glow = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.1, 8, 40), SM(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff27a).multiplyScalar(2) }))); glow.rotation.x = Math.PI / 2; crownObj.add(glow);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 80, 20, 1, true), M.glowBeam); beam.position.y = 40; crownObj.add(beam);
      root.add(crownObj);
    }
    for (const L of st.lavas || []) {
      const lm = new THREE.Mesh(geo(`lava${(L.x1 - L.x0).toFixed(0)},${(L.z1 - L.z0).toFixed(0)}`, () => new THREE.PlaneGeometry(L.x1 - L.x0, L.z1 - L.z0)), SM(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a1a).multiplyScalar(1.15), map: T.lava })));
      lm.rotation.x = -Math.PI / 2; lm.position.set((L.x0 + L.x1) / 2, L.y0, (L.z0 + L.z1) / 2); root.add(lm); lavaObjs.push({ m: lm, L });
    }
    for (let i = 0; i < Math.min(14, (st.blasts || []).length); i++) {
      const g = new THREE.Group();
      const bomb = outline(new THREE.Mesh(geo('bomb', () => new THREE.SphereGeometry(0.6, 16, 12)), M.ink), 0.05); g.add(bomb);
      const fuse = new THREE.Mesh(geo('fuse', () => new THREE.CylinderGeometry(0.06, 0.06, 0.4, 6)), M.gold); fuse.position.y = 0.7; g.add(fuse);
      const ring = new THREE.Mesh(geo('bring', () => new THREE.RingGeometry(0.85, 1, 40)), SM(new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })));
      ring.rotation.x = -Math.PI / 2; root.add(ring); root.add(g); g.visible = ring.visible = false;
      bombObjs.push({ g, ring });
    }
    for (const c of st.cannons || []) {
      const g = new THREE.Group(); g.position.set(c.x, c.y, c.z); g.rotation.y = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      const barrel = outline(new THREE.Mesh(geo('cbarrel', () => { const b = new THREE.CylinderGeometry(1.15, 1.35, 2.6, 20, 1, true); b.rotateX(Math.PI / 2); return b; }), SM(plastic(0x5a7cf0, { side: THREE.DoubleSide }))), 0.06); g.add(barrel);
      const ringc = new THREE.Mesh(geo('cring', () => new THREE.TorusGeometry(1.2, 0.18, 8, 24)), M.white); ringc.position.z = 1.3; g.add(ringc);
      const drop = c.y - (st.killY + 3.2);
      const pole = new THREE.Mesh(geo(`cpole${drop.toFixed(0)}`, () => new THREE.CylinderGeometry(0.45, 0.6, drop, 10)), M.chrome); pole.position.y = -drop / 2 - 0.8; g.add(pole);
      root.add(g);
    }
    blastIdx = 0;
    for (const f of st.fans || []) {
      const g = new THREE.Group(); g.position.set(f.x, f.y, f.z); g.rotation.y = f.dir > 0 ? Math.PI / 2 : -Math.PI / 2;      // blows along +z of the group = toward +x / -x
      const drop = f.y - (st.killY + 3.2);
      const pole = new THREE.Mesh(geo(`fpole${drop.toFixed(0)}`, () => new THREE.CylinderGeometry(0.35, 0.5, drop, 12)), M.chrome); pole.position.y = -drop / 2 - 0.3; g.add(pole);
      const ring = outline(new THREE.Mesh(geo('fring', () => new THREE.TorusGeometry(1.7, 0.28, 12, 32)), SM(plastic(theme.accent))), 0.06); g.add(ring);
      const hubM = new THREE.Mesh(geo('fhub', () => new THREE.SphereGeometry(0.42, 14, 10)), M.gold); g.add(hubM);
      const blades = new THREE.Group(); g.add(blades);
      for (let k = 0; k < 4; k++) { const bl = new THREE.Mesh(geo('fblade', () => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(0.7, 0.5, 0.5, 1.6); sh.quadraticCurveTo(-0.3, 1.0, 0, 0); return new THREE.ShapeGeometry(sh); }), SM(new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.4 }))); bl.rotation.z = k * Math.PI / 2; blades.add(bl); }
      root.add(g); fanObjs.push({ g, blades, f });
    }
    buildSet(st);
  }

  // ---- studio set: stands full of fans, bunting, light towers with sweeping spots, balloons, pinwheels, big sign
  function buildSet(st) {
    envKind = ENV[st.id] || null;
    if (envKind) { buildEnv(envKind, st); return; }
    const rr = mulberry(st.id.length * 99 + 3), q = lowQ();
    const len = st.len || 0, cz = len / 2, race = !!st.len;
    const baseY = st.killY + 3.5;
    const seatCols = [0xff5ab0, 0x3ea6ff, 0xffd23f, 0x2ee6d6, 0xb57bff];
    const standMat = SM(plastic(0x6a5cff, { roughness: 0.6 })), standTop = SM(plastic(0xffffff));
    const tiers = 4;
    // stands
    const crowdPos = [];
    if (race) {
      for (const side of [-1, 1]) for (let t = 0; t < tiers; t++) {
        const x = side * (40 + t * 3.2), h = 3 + t * 2.4, L = len + 40;
        const s = new THREE.Mesh(geo(`stand${t},${L.toFixed(0)}`, () => new RoundedBoxGeometry(3.4, h, L, 2, 0.4)), t % 2 ? standMat : SM(plastic(seatCols[(t + (side > 0 ? 1 : 0)) % 5], { roughness: 0.55 })));
        s.position.set(x, baseY + h / 2 - 1, cz); set.add(s);
        const n = q ? 30 : 70;
        for (let i = 0; i < n; i++) crowdPos.push([x, baseY + h - 0.4, cz - L / 2 + 2 + rr() * (L - 4), side]);
      }
    } else {
      for (let t = 0; t < tiers; t++) {
        const R = 34 + t * 3.2, h = 3 + t * 2.4;
        const s = new THREE.Mesh(geo(`ring${t}`, () => new THREE.CylinderGeometry(R + 1.6, R + 1.6, h, 64, 1, true)), SM(plastic(t % 2 ? 0x6a5cff : seatCols[t % 5], { side: THREE.DoubleSide, roughness: 0.55 })));
        s.position.y = baseY + h / 2 - 1; set.add(s);
        const n = q ? 50 : 110;
        for (let i = 0; i < n; i++) { const a = rr() * TAU; crowdPos.push([Math.sin(a) * (R + 0.8), baseY + h - 0.4, Math.cos(a) * (R + 0.8), a]); }
      }
    }
    // fans: instanced bouncing capsules facing the course
    const cg = geo('fan', () => new THREE.CapsuleGeometry(0.42, 0.55, 3, 8)), cm = SM(toon(0xffffff));
    crowd = new THREE.InstancedMesh(cg, cm, crowdPos.length); crowd.userData.base = [];
    const c = new THREE.Color(), m4 = new THREE.Matrix4();
    crowdPos.forEach(([x, y, z], i) => { crowd.userData.base.push([x, y, z, rr() * TAU, 0.7 + rr() * 0.6]); m4.makeTranslation(x, y, z); crowd.setMatrixAt(i, m4); crowd.setColorAt(i, c.setHSL(rr(), 0.8, 0.62)); });
    set.add(crowd);
    // light towers with sweeping spotlight cones
    const nT = race ? 10 : 8, tmat = SM(plastic(0xf3f0ff, { metalness: 0.3, roughness: 0.4 })), headM = SM(plastic(theme.accent));
    for (let i = 0; i < nT; i++) {
      let x, z;
      if (race) { x = (i % 2 ? 1 : -1) * 54; z = -14 + (Math.floor(i / 2) / (nT / 2 - 1)) * (len + 28); } else { const a = (i / nT) * TAU + 0.2; x = Math.sin(a) * 48; z = Math.cos(a) * 48; }
      const t = new THREE.Group(); t.position.set(x, baseY, z);
      const pole = new THREE.Mesh(geo('tpole', () => new THREE.CylinderGeometry(0.5, 0.9, 32, 10)), tmat); pole.position.y = 16; t.add(pole);
      const head = new THREE.Mesh(geo('thead', () => new RoundedBoxGeometry(4, 2, 1.4, 2, 0.4)), headM); head.position.y = 32.5; t.add(head);
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(geo('tbulb', () => new THREE.SphereGeometry(0.45, 10, 8)), M.bulb); b.position.set(-1.2 + k * 1.2, 32.5, 0.75); t.add(b); }
      t.lookAt(0, baseY, race ? cz : 0); set.add(t);
      if (!q) {
        const cone = new THREE.Mesh(geo('cone', () => { const g = new THREE.ConeGeometry(3, 46, 20, 1, true); g.translate(0, -23, 0); return g; }), M.glowBeam);
        cone.position.set(x, baseY + 32, z); set.add(cone); spots.push({ cone, ph: rr() * TAU, sp: 0.3 + rr() * 0.4, tx: race ? 0 : 0, tz: race ? z : 0 });
      }
    }
    // bunting strings of pennants between towers along each side
    if (race && !q) {
      const pg = geo('pennant', () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1, 0], 3)); g.computeVertexNormals(); return g; });
      const pm = SM(new THREE.MeshBasicMaterial({ vertexColors: false, side: THREE.DoubleSide, color: 0xffffff }));
      const count = 2 * 40, inst = new THREE.InstancedMesh(pg, pm, count);
      let k = 0;
      for (const side of [-1, 1]) for (let i = 0; i < 40; i++) {
        const z = -14 + (i / 39) * (len + 28), sag = Math.sin((i % 8) / 8 * Math.PI) * 2.5;
        m4.makeTranslation(side * 47, baseY + 26 - sag, z); inst.setMatrixAt(k, m4); inst.setColorAt(k, c.setHex(CONF[k % 8])); k++;
      }
      set.add(inst);
    }
    // giant balloons and pinwheels floating around the show
    const bCols = [0xff5ab0, 0x3ea6ff, 0xffd23f, 0x4cd964, 0xb57bff, 0xff8c42];
    const nb = q ? 4 : 9;
    for (let i = 0; i < nb; i++) {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(geo('balloon', () => { const s = new THREE.SphereGeometry(3, 20, 14); s.scale(1, 1.2, 1); return s; }), SM(plastic(bCols[i % 6], { roughness: 0.2 })));
      g.add(ball);
      const knot = new THREE.Mesh(geo('knot', () => new THREE.ConeGeometry(0.5, 0.8, 8)), ball.material); knot.position.y = -3.8; g.add(knot);
      const str = new THREE.Mesh(geo('string', () => new THREE.CylinderGeometry(0.05, 0.05, 16, 4)), M.white); str.position.y = -12; g.add(str);
      const side = i % 2 ? 1 : -1;
      if (race) g.position.set(side * (26 + rr() * 10), 14 + rr() * 16, -10 + rr() * (len + 20)); else { const a = rr() * TAU; g.position.set(Math.sin(a) * 26, 14 + rr() * 14, Math.cos(a) * 26); }
      g.userData.base = g.position.y; g.userData.ph = rr() * TAU;
      set.add(g); balloons.push(g);
    }
    const np = q ? 2 : 6;
    for (let i = 0; i < np; i++) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(geo('ppole', () => new THREE.CylinderGeometry(0.3, 0.4, 22, 8)), tmat); pole.position.y = 11; g.add(pole);
      const wheel = new THREE.Group(); wheel.position.set(0, 22, 0.6); g.add(wheel);
      for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(geo('blade', () => { const s = new THREE.BufferGeometry(); s.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 5, 0, 0, 5, 4, 0], 3)); s.computeVertexNormals(); return s; }), SM(new THREE.MeshBasicMaterial({ color: bCols[(i + k) % 6], side: THREE.DoubleSide }))); b.rotation.z = k * Math.PI / 2; wheel.add(b); }
      const side = i % 2 ? 1 : -1;
      if (race) g.position.set(side * 32, baseY - 2, 10 + (i / np) * len); else { const a = (i / np) * TAU; g.position.set(Math.sin(a) * 30, baseY - 2, Math.cos(a) * 30); }
      g.lookAt(race ? 0 : 0, baseY, race ? g.position.z : 0);
      set.add(g); spinners.push({ wheel, sp: (1 + rr()) * (rr() < 0.5 ? 1 : -1) });
    }
    // big show sign with the stage name
    const sign = new THREE.Mesh(geo('bigsign', () => new THREE.PlaneGeometry(22, 5.5)), SM(new THREE.MeshBasicMaterial({ map: textTex(`${st.meta.name.toUpperCase()}`, '#ff5ab0', '#ffffff', 1024, 256), transparent: true })));
    if (race) { sign.position.set(0, 22, len + 26); sign.rotation.y = Math.PI; } else { sign.position.set(0, 20, -40); }
    set.add(sign);
    set.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.material !== M.glowBeam) { o.castShadow = false; o.receiveShadow = false; } });
  }
  // themed scenery: ice peaks + pines, volcanoes, jungle ruins, or green hills, scattered around the course
  function buildEnv(kind, st) {
    const rr = mulberry(st.id.length * 131 + 7), q = lowQ();
    const len = st.len || 0, cz = len / 2, race = !!st.len, baseY = st.killY + 3.5;
    const spot = (near, far) => {             // a point beside the course (or around the arena)
      if (race) { const side = rr() < 0.5 ? -1 : 1; return [side * (near + rr() * (far - near)), -30 + rr() * (len + 60)]; }
      const a = rr() * TAU, d = near + rr() * (far - near); return [Math.sin(a) * d, Math.cos(a) * d];
    };
    const P = {
      snow: SM(plastic(0xffffff, { roughness: 0.9 })), rockI: SM(plastic(0x7a8cb0, { roughness: 0.8 })), pine: SM(toon(0x2f9a6a)), trunk: SM(toon(0x7a4a2a)),
      volc: SM(plastic(0x5a3a3a, { roughness: 0.9 })), glow: SM(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a1a).multiplyScalar(1.6) })), smoke: SM(new THREE.MeshLambertMaterial({ color: 0x9a8a8a, transparent: true, opacity: 0.55 })),
      stone: SM(plastic(0xcdb98a, { roughness: 0.85 })), moss: SM(toon(0x5fb04a)), leaf: SM(toon(0x3fbf5a)), hill: SM(toon(0x7fd65a)), hill2: SM(toon(0x5fc04a)), flower: SM(toon(0xff6ec7)), sail: SM(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide })),
    };
    const add = (m) => { set.add(m); return m; };
    const tree = (x, z, y, s = 1, round = false) => {
      const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s);
      const t = new THREE.Mesh(geo('trunk', () => new THREE.CylinderGeometry(0.35, 0.5, 3, 8)), P.trunk); t.position.y = 1.5; g.add(t);
      if (round) { for (const [dx, dy, r] of [[0, 4, 2.2], [1.2, 3.4, 1.5], [-1.1, 3.5, 1.6]]) { const b = new THREE.Mesh(geo('leafball', () => new THREE.IcosahedronGeometry(1, 1)), P.leaf); b.position.set(dx, dy, 0); b.scale.setScalar(r); g.add(b); } }
      else for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(geo('pinecone', () => new THREE.ConeGeometry(1.8, 2.6, 9)), P.pine); c.position.y = 3 + k * 1.3; c.scale.setScalar(1 - k * 0.22); g.add(c); }
      return add(g);
    };
    const nFar = q ? 8 : 16, nNear = q ? 14 : 34;
    if (kind === 'ice') {
      for (let i = 0; i < nFar; i++) { const [x, z] = spot(70, 160), h = 40 + rr() * 50, rad = 22 + rr() * 20; const m = add(new THREE.Mesh(geo('peak', () => new THREE.ConeGeometry(1, 1, 7)), P.rockI)); m.scale.set(rad, h, rad); m.position.set(x, baseY - 6 + h / 2, z); const cap = add(new THREE.Mesh(geo('peakcap', () => new THREE.ConeGeometry(1, 1, 7)), P.snow)); cap.scale.set(rad * 0.42, h * 0.42, rad * 0.42); cap.position.set(x, baseY - 6 + h - h * 0.21 + 0.3, z); }
      for (let i = 0; i < nNear; i++) { const [x, z] = spot(18, 60); const berg = add(new THREE.Mesh(geo('berg', () => new THREE.CylinderGeometry(1, 1.25, 1, 7)), P.snow)); const br = 3 + rr() * 4; berg.scale.set(br, 2.5, br); berg.position.set(x, baseY - 0.3, z); if (rr() < 0.8) tree(x, z, baseY + 0.9, 0.8 + rr() * 0.8); }
    } else if (kind === 'lava') {
      for (let i = 0; i < (q ? 4 : 8); i++) { const [x, z] = spot(55, 140), h = 30 + rr() * 35, rad = 20 + rr() * 14; const m = add(new THREE.Mesh(geo('volc', () => new THREE.CylinderGeometry(0.22, 1, 1, 10, 1)), P.volc)); m.scale.set(rad, h, rad); m.position.set(x, baseY - 4 + h / 2, z); const g = add(new THREE.Mesh(geo('volcglow', () => new THREE.CylinderGeometry(1, 1, 0.6, 10)), P.glow)); g.scale.set(rad * 0.2, 1, rad * 0.2); g.position.set(x, baseY - 4 + h, z); for (let k = 0; k < 4; k++) { const s = add(new THREE.Mesh(geo('smoke', () => new THREE.IcosahedronGeometry(1, 1)), P.smoke)); s.scale.setScalar(4 + k * 2); s.position.set(x + k * 2, baseY - 4 + h + 4 + k * 5, z); s.userData.smoke = k; } }
      for (let i = 0; i < nNear; i++) { const [x, z] = spot(16, 60); const m = add(new THREE.Mesh(geo('lrock', () => new THREE.DodecahedronGeometry(1, 0)), P.volc)); m.scale.set(2 + rr() * 4, 1.5 + rr() * 4, 2 + rr() * 4); m.rotation.y = rr() * 6; m.position.set(x, baseY, z); }
    } else if (kind === 'temple') {
      for (let i = 0; i < nNear; i++) { const [x, z] = spot(14, 55); if (rr() < 0.5) { const h = 4 + rr() * 9; const c = add(new THREE.Mesh(geo('ruin', () => new THREE.CylinderGeometry(1.2, 1.4, 1, 10)), P.stone)); c.scale.y = h; c.position.set(x, baseY + h / 2 - 1, z); const mo = add(new THREE.Mesh(geo('ruincap', () => new THREE.CylinderGeometry(1.5, 1.5, 0.7, 10)), P.moss)); mo.position.set(x, baseY + h - 1, z); } else tree(x, z, baseY - 1, 1.3 + rr() * 1.2, true); }
      for (let i = 0; i < (q ? 3 : 6); i++) { const [x, z] = spot(60, 130), s = 14 + rr() * 10; for (let k = 0; k < 4; k++) { const b = add(new THREE.Mesh(geo('pyr', () => new THREE.BoxGeometry(1, 1, 1)), P.stone)); const w = s * (1 - k * 0.22); b.scale.set(w, s * 0.22, w); b.position.set(x, baseY - 2 + k * s * 0.22 + s * 0.11, z); } }
    } else {
      for (let i = 0; i < nFar; i++) { const [x, z] = spot(60, 150), r2 = 25 + rr() * 30; const h = add(new THREE.Mesh(geo('hill', () => new THREE.SphereGeometry(1, 18, 10, 0, TAU, 0, Math.PI / 2)), i % 2 ? P.hill : P.hill2)); h.scale.set(r2, r2 * (0.35 + rr() * 0.3), r2); h.position.set(x, baseY - 3, z); }
      for (let i = 0; i < nNear; i++) { const [x, z] = spot(16, 60); const isl = add(new THREE.Mesh(geo('isle', () => new THREE.CylinderGeometry(1, 0.6, 1, 10)), P.hill)); const ir = 3 + rr() * 4; isl.scale.set(ir, 2, ir); isl.position.set(x, baseY - 0.6, z); tree(x, z, baseY + 0.4, 0.8 + rr() * 0.7, true); }
      for (let i = 0; i < (q ? 2 : 4); i++) { const [x, z] = spot(30, 55); const g = new THREE.Group(); g.position.set(x, baseY, z); const tw = new THREE.Mesh(geo('mill', () => new THREE.CylinderGeometry(1.2, 2.2, 14, 8)), P.snow); tw.position.y = 7; g.add(tw); const hub = new THREE.Group(); hub.position.set(0, 13.5, 2.3); g.add(hub); for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(geo('sail', () => new THREE.PlaneGeometry(1.8, 7)), P.sail); s.position.y = 3.6; const arm = new THREE.Group(); arm.rotation.z = k * Math.PI / 2; arm.add(s); hub.add(arm); } g.lookAt(0, baseY, race ? z : 0); add(g); spinners.push({ wheel: hub, sp: 0.6 }); }
    }
    set.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }
  function clearStage() {
    if (root) { root.traverse((o) => { if (o.isMesh && o.material === ink) return; }); root.removeFromParent(); root = null; }
    set.clear();
    for (const g of geoCache.values()) g.dispose();
    geoCache.clear();
    for (const m of stageMats) { if (m.map && !keep.has(m.map)) m.map.dispose(); m.dispose(); }
    stageMats = [];
    for (const t of tiles) for (const m of t.mats) m.dispose();
    if (crowd) { crowd.dispose(); crowd = null; }
    if (crownObj) { crownObj.traverse((o) => { if (o.geometry && o.geometry.type !== 'CylinderGeometry' && o.geometry.type !== 'TorusGeometry') return; o.geometry?.dispose(); }); }
    spikeObjs.length = 0; lavaObjs.length = 0; bombObjs.length = 0; swings.length = 0; fanObjs.length = 0; balls.length = 0; occ.length = 0; arches.length = 0; dyn.length = 0; tiles.length = 0; doors.length = 0; belts.length = 0; blinks.length = 0; pads.length = 0; spots.length = 0; spinners.length = 0; balloons.length = 0; crownObj = null;
  }

  // ---- players
  const beans = new Map();
  for (const p of ctx.players) {
    const a = ctx.avatar.build(p);
    a.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    if (!lowQ()) { const meshes = []; a.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.inkHull) meshes.push(o); }); for (const o of meshes) { o.geometry.computeBoundingSphere(); if (o.geometry.boundingSphere.radius < 0.14 || (o.material && o.material.transparent)) continue; const hull = new THREE.Mesh(o.geometry, ink); hull.userData.inkHull = true; hull.castShadow = false; hull.scale.setScalar(Math.min(1.18, 1 + 0.03 / o.geometry.boundingSphere.radius)); o.add(hull); } }
    const blob = new THREE.Mesh(blobGeo, M.shadow); blob.rotation.x = -Math.PI / 2; blob.renderOrder = 1; scene.add(blob);
    const tether = new THREE.Mesh(K(new THREE.CylinderGeometry(0.08, 0.08, 1, 6)), K(plastic(p.colorHex, { emissive: p.colorHex, emissiveIntensity: 0.4 }))); tether.visible = false; scene.add(tether);
    const ring = new THREE.Mesh(K(new THREE.RingGeometry(0.55, 0.72, 28)), K(new THREE.MeshBasicMaterial({ color: p.colorHex, transparent: true, opacity: 0.85, depthWrite: false }))); ring.rotation.x = -Math.PI / 2; ring.renderOrder = 2; ring.visible = false; scene.add(ring);
    a.visible = false; scene.add(a);
    beans.set(p.id, { a, blob, tether, ring, sq: 1, sqv: 0, spin: 0, lastGr: true, vis: 0 });
  }

  // ---- particles (one instanced mesh: confetti, dust, stars, slime drops)
  const PMAX = 1200;
  const pGeo = K(new THREE.BoxGeometry(0.2, 0.2, 0.05));
  const pMat = K(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const pMesh = new THREE.InstancedMesh(pGeo, pMat, PMAX); pMesh.frustumCulled = false; scene.add(pMesh);
  const P = []; const pm = new THREE.Matrix4(), pq = new THREE.Quaternion(), pe = new THREE.Euler(), ps = new THREE.Vector3(), pv = new THREE.Vector3(), pc = new THREE.Color();
  for (let i = 0; i < PMAX; i++) pMesh.setColorAt(i, pc.setHex(0xffffff));
  function emit(n, x, y, z, o = {}) {
    if (lowQ()) n = Math.ceil(n * 0.5);
    for (let i = 0; i < n; i++) {
      if (P.length >= PMAX) P.shift();
      const sp = o.speed ?? 4, a = Math.random() * TAU, el = (o.up ?? 0.6) + Math.random() * (o.upr ?? 0.6);
      const col = o.colors ? o.colors[Math.floor(Math.random() * o.colors.length)] : o.color ?? 0xffffff;
      const life = (o.life ?? 1) * (0.6 + Math.random() * 0.6);
      P.push({ x: x + (Math.random() - 0.5) * (o.spread ?? 0.4), y, z: z + (Math.random() - 0.5) * (o.spread ?? 0.4), vx: Math.cos(a) * sp * (0.4 + Math.random() * 0.6) + (o.vx || 0), vy: sp * el, vz: Math.sin(a) * sp * (0.4 + Math.random() * 0.6) + (o.vz || 0),
        life, max: life, g: o.g ?? 14, drag: o.drag ?? 0.9, size: (o.size ?? 1) * (0.6 + Math.random() * 0.8), col, rx: Math.random() * 6, ry: Math.random() * 6, spin: (o.spin ?? 8) * (Math.random() - 0.5), flutter: o.flutter || 0 });
    }
  }
  function stepParticles(dt, sec) {
    let n = 0;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.life -= dt; if (p.life <= 0) { P.splice(i, 1); continue; }
      p.vy -= p.g * dt; const d = Math.pow(p.drag, dt * 10); p.vx *= d; p.vz *= d; if (p.g < 5) p.vy *= d;
      if (p.flutter) { p.vx += Math.sin(sec * 6 + p.rx) * p.flutter * dt; p.vy = Math.max(p.vy, -2.2); }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rx += p.spin * dt; p.ry += p.spin * 0.7 * dt;
    }
    for (const p of P) {
      const k = Math.min(1, p.life / p.max * 3) * p.size;
      pm.compose(pv.set(p.x, p.y, p.z), pq.setFromEuler(pe.set(p.rx, p.ry, 0)), ps.set(k, k, k));
      pMesh.setMatrixAt(n, pm); pMesh.setColorAt(n, pc.setHex(p.col)); n++;
    }
    pMesh.count = n; pMesh.instanceMatrix.needsUpdate = true; if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
  }
  const fx = {
    shakeAmt: 0,
    shake(a) { fx.shakeAmt = Math.min(1.4, fx.shakeAmt + a); },
    dust(x, y, z, k = 1) { emit(Math.round(6 + 10 * k), x, y + 0.1, z, { color: 0xffffff, speed: 2 + 3 * k, up: 0.15, upr: 0.3, life: 0.5, g: 2, size: 1.5, spread: 0.6 }); },
    stars(x, y, z) { emit(16, x, y + 1, z, { colors: [0xfff27a, 0xffffff, 0xffcc33], speed: 6, up: 0.3, life: 0.7, g: 6, size: 1.5, spin: 14 }); },
    confetti(x, y, z, n = 60) { emit(n, x, y, z, { colors: CONF, speed: 8, up: 0.9, upr: 0.8, life: 3, g: 5, drag: 0.8, size: 1.2, spin: 16, spread: 1, flutter: 6 }); },
    cannons() { if (!stage?.finishZ) return; for (const k of [-1, 1]) emit(70, k * 7.5, stage.finishY + 1, stage.finishZ, { colors: CONF, speed: 9, up: 1.6, upr: 0.6, life: 3.2, g: 5, drag: 0.82, size: 1.2, spin: 16, vx: -k * 5, flutter: 6 }); },
    splash(x, y, z, col) { emit(30, x, y, z, { color: col ?? theme.slime, speed: 7, up: 1.1, life: 1.1, g: 20, size: 1.8 }); },
    firework(x, y, z) { const c = CONF[Math.floor(Math.random() * 8)]; emit(80, x, y, z, { colors: [c, 0xffffff, c], speed: 14, up: -0.3, upr: 1.4, life: 1.7, g: 4, drag: 0.8, size: 1.4, spin: 10 }); },
    poof(x, y, z, col) { emit(34, x, y + 0.8, z, { colors: [col, 0xffffff, 0xfff27a], speed: 5, up: 0.2, upr: 1, life: 1, g: 1, drag: 0.85, size: 1.6 }); },
  };

  // ---- camera rig
  const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0.34, dist: 9, intro: 0, introT: 0, mode: 'follow', orbit: 0 };
  const tmpV = new THREE.Vector3(), TMP = {};
  function resize() {
    const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (composer) { composer.setSize(w, h); composer.setPixelRatio(renderer.getPixelRatio()); bloom.resolution.set(w / 2, h / 2); }
  }
  setupQuality(); resize();

  // ---- per-frame
  function update(dt, now, S) {
    const t = S.t, W = S.W, sec = now / 1000;
    for (const m of dyn) {
      const s = m.userData.s;
      if (m.userData.kind === 'pend') { pose(s, t, TMP); m.userData.swing.rotation.z = TMP.th; continue; }
      if (s.until) { const gone = !active(s, W); if (gone) { m.userData.f = (m.userData.f || 0) + dt; m.position.y = s.y - m.userData.f * m.userData.f * 9; m.rotation.z = m.userData.f * 0.6; m.visible = m.userData.f < 2; } else if (t > s.until - 2.5) { m.position.x = s.x + Math.sin(sec * 50) * 0.07; m.position.y = s.y; m.visible = true; } continue; }
      pose(s, t, TMP); m.position.set(TMP.x, TMP.y, TMP.z); m.rotation.y = TMP.ry;
    }
    for (const b of balls) { pose(b.s, t, TMP); b.root.visible = active(b.s, W); if (Math.abs(b.s.anim.v[0]) > Math.abs(b.s.anim.v[2])) b.m.rotation.z = -Math.sign(b.s.anim.v[0]) * (TMP.rollA || 0); else b.m.rotation.x = TMP.rollA || 0; }
    for (const sw of swings) {
      const open = blinkU(sw.s, t) > sw.s.blink.on ? 1 : 0;
      sw.k += (open - sw.k) * Math.min(1, dt * 9);
      sw.hinge.rotation.y = -sw.k * 1.65;
    }
    for (const fo of fanObjs) {
      const f = fo.f, gust = f.on >= 1 || ((((t / f.p + f.ph) % 1) + 1) % 1) <= f.on;
      fo.spin = (fo.spin || 0) + dt * (gust ? 22 : 3);
      fo.blades.rotation.z = fo.spin;
      if (gust && Math.random() < dt * 28) emit(1, f.x + f.dir * 1.5, f.y + (Math.random() - 0.5) * 3, f.z + (Math.random() - 0.5) * 8.5, { color: 0xffffff, speed: 0.4, up: 0, upr: 0, vx: f.dir * 9, g: 0, drag: 1, life: 0.7, size: 0.9, spin: 0 });
    }
    for (const m of blinks) {
      const s = m.userData.s, u = blinkU(s, t), on = s.blink.on;
      let a = 1, sc = 1;
      if (u > on) { const k = Math.min(1, (u - on) / 0.04); a = 0.18; sc = 1 - 0.06 * k; }
      else if (u > on - 0.22) { a = Math.sin(sec * (24 + (u - on + 0.22) * 120)) > 0 ? 1 : 0.45; }
      else if (u < 0.04) { sc = 0.9 + u / 0.04 * 0.1; }
      m.scale.set(sc, 1, sc);
      m.traverse((o) => { if (o.material && o.material !== ink) { o.material.opacity = a; o.material.depthWrite = a > 0.5; } else if (o.material === ink) o.visible = a > 0.5; });
    }
    for (const p of pads) { const k = (Math.sin(sec * 6 + p.s.x) + 1) / 2; p.ring.scale.setScalar(p.s.hx * (0.6 + k * 0.5)); p.ring.material.opacity = 0.9 - k * 0.6; }
    for (const tl of tiles) {
      const st = W.dyn[tl.s.tile];
      if (st === 0) { tl.m.position.set(tl.s.x, tl.base, tl.s.z); tl.m.visible = true; tl.fall = 0; tl.mats[0].emissive.setHex(0); tl.mats[1].emissive.setHex(0); tl.m.scale.setScalar(1); }
      else if (st === 1) { if (!tl.shake) { tl.shake = sec; S.onTile?.(tl.s); } const k = Math.min(1, (sec - tl.shake) / TILE_FALL); tl.m.position.set(tl.s.x + Math.sin(sec * 60) * 0.05 * k, tl.base - k * 0.12, tl.s.z); tl.mats[1].emissive.setRGB(0.9 * k, 0.75 * k, 0.6 * k); tl.mats[0].emissive.setRGB(0.4 * k, 0.2 * k, 0.1 * k); }
      else { if (!tl.fall) S.onTileFall?.(tl.s); tl.fall += dt; tl.m.position.y = tl.base - tl.fall * tl.fall * 8; tl.m.rotation.z = tl.fall * 0.8; tl.m.scale.setScalar(Math.max(0.01, 1 - tl.fall * 0.6)); tl.m.visible = tl.fall < 1.5; tl.shake = 0; }
    }
    for (const g of doors) {
      const s = g.userData.s;
      if (!s.fake && W.dyn[s.door] === 1) { g.userData.open = Math.min(1, g.userData.open + dt * 5); g.rotation.x = -g.userData.open * 1.48 * (1 + Math.sin(g.userData.open * 9) * 0.05 * (1 - g.userData.open)); }
      else { g.userData.open = 0; g.rotation.x = Math.sin((g.userData.wob || 0) * 30) * 0.07 * (g.userData.wob || 0); g.userData.wob = Math.max(0, (g.userData.wob || 0) - dt * 2); }
    }
    for (const b of belts) b.mat.map.offset.y = (b.mat.map.offset.y + dt * b.v) % 1;
    if (crownObj) { crownObj.rotation.y = sec * 1.4; crownObj.position.y = stage.crown.y + Math.sin(sec * 2.2) * 0.15; crownObj.visible = !S.crownTaken; }
    slimeMat.uniforms.t.value = sec;
    for (const c of clouds.children) { c.position.x += c.userData.v * dt; if (c.position.x > 420) c.position.x = -420; }
    for (const s of spots) { const a = Math.sin(sec * s.sp + s.ph); s.cone.rotation.set(Math.PI + 0.55 + Math.cos(sec * s.sp * 0.7 + s.ph) * 0.25, 0, a * 0.6); s.cone.lookAt(s.tx + a * 14, -30, s.tz + Math.cos(sec * s.sp + s.ph) * 14); s.cone.rotateX(-Math.PI / 2); }
    for (const p of spinners) p.wheel.rotation.z += dt * p.sp * (1 + (S.hype || 0) * 2);
    for (const b of balloons) { b.position.y = b.userData.base + Math.sin(sec * 0.6 + b.userData.ph) * 1.4; b.rotation.z = Math.sin(sec * 0.5 + b.userData.ph) * 0.08; }
    if (crowd) {
      const hype = S.hype || 0, base = crowd.userData.base;
      for (let i = 0; i < base.length; i++) { const [x, y, z, ph, sp] = base[i]; pm.makeTranslation(x, y + Math.abs(Math.sin(sec * (4 + hype * 6) * sp + ph)) * (0.15 + hype * 0.9), z); crowd.setMatrixAt(i, pm); }
      crowd.instanceMatrix.needsUpdate = true;
    }
    // beans
    for (const [id, b] of beans) {
      const v = S.players.get(id);
      const show = !!v && v.visible;
      b.a.visible = show; b.blob.visible = show && v.groundY > -1e8; b.tether.visible = false; b.ring.visible = false;
      if (!show) continue;
      const a = b.a, rig = a.userData.rig;
      a.position.set(v.x, v.y, v.z);
      a.rotation.y = v.face;
      const hs = Math.hypot(v.vx || 0, v.vz || 0);
      const run = v.grounded && !v.down && !v.dive ? Math.min(1, hs / 7) : 0;
      a.userData.setPose({ run, t: sec + id.length, jump: !v.grounded && !v.dive && !v.down && !v.hang ? 1 : 0 });
      if (v.grounded && !b.lastGr) { const k = Math.min(1, (v.landV || 8) / 20); b.sqv -= 6 + k * 10; }
      if (!v.grounded && b.lastGr && (v.vy || 0) > 4) b.sqv += 7;
      b.lastGr = v.grounded;
      b.sqv += (1 - b.sq) * 260 * dt; b.sqv *= Math.pow(0.0008, dt); b.sq += b.sqv * dt;
      const sq = Math.max(0.65, Math.min(1.4, b.sq));
      rig.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      rig.rotation.x = 0; rig.rotation.z = 0; rig.position.z = 0;
      if (v.dive || v.slide) { rig.rotation.x = 1.35; rig.position.y = 0.45; rig.position.z = -0.35; }
      else if (v.down) { b.spin += dt * (v.grounded ? 3 : 11); rig.rotation.x = v.grounded ? 1.45 : b.spin; rig.rotation.z = v.grounded ? 0.3 : Math.sin(b.spin * 0.7) * 0.8; rig.position.y = v.grounded ? 0.4 : 0.8; }
      else if (v.hang) { rig.rotation.x = -0.25; rig.position.y = Math.sin(sec * 8) * 0.03; }
      else if (!v.grounded) { rig.rotation.x = Math.max(-0.35, Math.min(0.35, -(v.vy || 0) * 0.03)); b.spin = 0; }
      else b.spin = 0;
      if (v.groundY > -1e8) {
        b.blob.position.set(v.x, v.groundY + 0.04, v.z); const h = Math.max(0, v.y - v.groundY); b.blob.scale.setScalar(Math.max(0.35, 1.3 - h * 0.12));
        if (S.me === id || h > 1.2) { b.ring.visible = true; b.ring.position.set(v.x, v.groundY + 0.05, v.z); b.ring.scale.setScalar(Math.max(0.5, 1.1 - h * 0.06)); }
      }
      if (v.grabX != null) {
        const dx = v.grabX - v.x, dy = v.grabY - v.y, dz = v.grabZ - v.z, l = Math.hypot(dx, dy, dz);
        b.tether.visible = true; b.tether.position.set(v.x + dx / 2, v.y + 0.9 + dy / 2, v.z + dz / 2); b.tether.scale.set(1, l, 1);
        b.tether.lookAt(v.grabX, v.grabY + 0.9, v.grabZ); b.tether.rotateX(Math.PI / 2);
      }
    }
    for (const sp of spikeObjs) {
      const u = blinkU(sp.s, t), up = u <= sp.s.blink.on, warn = !up && u > 1 - 0.18;
      sp.k += ((up ? 1 : warn ? 0.18 : 0) - sp.k) * Math.min(1, dt * (up ? 30 : 10));
      sp.spikes.position.y = -0.45 + sp.k * 0.6; sp.spikes.visible = sp.k > 0.05;
      sp.glow.material.opacity = warn ? 0.35 + Math.sin(sec * 40) * 0.25 : up ? 0.25 : 0;
    }
    for (const lo of lavaObjs) { lo.m.position.y = lavaLevel(lo.L, t); lo.m.material.map.offset.set(sec * 0.03, sec * 0.05); }
    if (stage?.blasts?.length) {
      const bl = stage.blasts;
      while (blastIdx < bl.length && bl[blastIdx].t <= t) { const b = bl[blastIdx++]; if (t - b.t < 0.5) { emit(50, b.x, b.y + 0.5, b.z, { colors: [0xffd23f, 0xff8c42, 0xff4d2a, 0x444444], speed: 12, up: 0.4, upr: 1.2, life: 1.0, g: 8, size: 1.8 }); fx.shake(0.4); S.onBlast?.(b); } }
      let k = 0;
      for (let i = blastIdx; i < bl.length && k < bombObjs.length; i++) {
        const b = bl[i], lead = b.t - t; if (lead > 1.5) break;
        const o = bombObjs[k++], f = 1 - lead / 1.5;
        o.g.visible = o.ring.visible = true; o.g.position.set(b.x, b.y + 0.6 + (1 - f * f) * 16, b.z); o.g.rotation.x = sec * 6;
        o.ring.position.set(b.x, b.y + 0.06, b.z); o.ring.scale.setScalar(b.r * (0.6 + 0.4 * f)); o.ring.material.opacity = 0.35 + 0.5 * f * (0.6 + 0.4 * Math.sin(sec * 30));
      }
      for (; k < bombObjs.length; k++) bombObjs[k].g.visible = bombObjs[k].ring.visible = false;
    }
    if (envKind === 'ice' && Math.random() < dt * 40) emit(1, cam.x + (Math.random() - 0.5) * 40, cam.y + 14, cam.z + Math.random() * 30 - 5, { color: 0xffffff, speed: 0.6, up: -1, upr: 0, g: 0.6, drag: 0.98, life: 5, size: 0.7, spin: 2, flutter: 2 });
    if (envKind === 'lava' && Math.random() < dt * 25) emit(1, cam.x + (Math.random() - 0.5) * 30, stage.killY + 3.6, cam.z + Math.random() * 30 - 5, { colors: [0xffa63a, 0xff5a1a, 0xffe07a], speed: 0.8, up: 2, upr: 2, g: -1.5, drag: 0.97, life: 3, size: 0.5, spin: 3 });
    stepParticles(dt, sec);
    // camera
    const shake = fx.shakeAmt; fx.shakeAmt = Math.max(0, fx.shakeAmt - dt * 2.4);
    const sx = (Math.random() - 0.5) * shake * 0.5, sy = (Math.random() - 0.5) * shake * 0.5;
    if (cam.mode === 'intro' && stage) {
      const k = cam.introT, e = k * k * (3 - 2 * k);
      if (stage.len) {
        // sweep in from high above the finish, down the whole course, to behind the start line
        const z0 = stage.len + 10, z1 = cam.z - 10;
        tmpV.set(Math.sin(sec * 0.3) * 6 + 16 * (1 - e), 30 * (1 - e) + (cam.y + 6) * e, z0 + (z1 - z0) * e);
        camera.position.copy(tmpV); camera.lookAt(0, cam.y + 1 * e, z0 - 16 + (cam.z - z0 + 16) * e);
      } else {
        const a = cam.orbit + e * 2.4, r = 34 - 18 * e;
        camera.position.set(Math.sin(a) * r, 22 - 12 * e, Math.cos(a) * r); camera.lookAt(0, 0, 0);
      }
    } else {
      const cp = Math.cos(cam.pitch), spch = Math.sin(cam.pitch);
      const tx = cam.x - Math.sin(cam.yaw) * cp * cam.dist, tz = cam.z - Math.cos(cam.yaw) * cp * cam.dist, ty = cam.y + 1.4 + spch * cam.dist;
      // never let walls / the tower column sit between the camera and the bean: pull the camera in front of them
      rayFrom.set(cam.x, cam.y + 1.5, cam.z); rayDir.set(tx - cam.x, ty - (cam.y + 1.5), tz - cam.z);
      const full = rayDir.length(); rayDir.divideScalar(full || 1);
      let want = full;
      if (occ.length) {
        ray.set(rayFrom, rayDir); ray.far = full;
        const hit = ray.intersectObjects(occ, false)[0];
        if (hit) want = Math.max(1.8, hit.distance - 0.6);
      }
      occDist = want < occDist ? want : Math.min(want, occDist + dt * 14);          // snap in, ease back out
      const dd = Math.min(full, occDist);
      camera.position.set(rayFrom.x + rayDir.x * dd + sx, rayFrom.y + rayDir.y * dd + sy, rayFrom.z + rayDir.z * dd);
      camera.lookAt(cam.x + Math.sin(cam.yaw) * 2.5, cam.y + 1.3, cam.z + Math.cos(cam.yaw) * 2.5);
    }
    for (const a of arches) a.g.visible = Math.abs(camera.position.z - a.z) > (cam.mode === 'intro' ? 1.5 : 7);
    sun.position.set(cam.x + 18, cam.y + 34, cam.z - 12); sun.target.position.set(cam.x, cam.y, cam.z + 4);
    sky.position.copy(camera.position);
    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  function project(x, y, z) {
    tmpV.set(x, y, z).project(camera);
    if (tmpV.z > 1) return null;
    return [(tmpV.x * 0.5 + 0.5) * (ctx.container.clientWidth || innerWidth), (-tmpV.y * 0.5 + 0.5) * (ctx.container.clientHeight || innerHeight)];
  }
  function applyQ() { ctx.three.applyQuality(renderer, sun); setupQuality(); resize(); }
  function wobbleDoor(d) { const g = doors.find((x) => x.userData.s.door === d); if (g) g.userData.wob = 1; }
  return {
    renderer, scene, camera, cam, fx, buildStage, update, resize, project, applyQ, wobbleDoor, beans,
    dispose() {
      clearStage();
      for (const b of beans.values()) { ctx.avatar.dispose(b.a); b.blob.removeFromParent(); b.tether.removeFromParent(); b.ring.removeFromParent(); }
      if (composer) { composer.dispose(); bloom.dispose(); composer = bloom = null; }
      if (envTex) { envTex.dispose(); envTex = null; }
      scene.environment = null;
      ctx.three.dispose(scene, keep);
      for (const x of keep) x.dispose?.();
      keep.clear(); P.length = 0;
    },
  };
}
function mulberry(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
