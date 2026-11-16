// NEON RUSH — world rendering: renderer + bloom, synthwave sky, neon grid ground, procedural city, and the swept
// track meshes (surface, edge strips, energy walls, boost strips, start gate, pylons) built from the track frames.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { worldPos, extent, scalar, sample, ENTRY } from './tracks.js';

// Per-track moods: sky gradient, fog, accent colours for edges / walls / pads.
export const MOODS = {
  sunset: { top: 0x120a3a, mid: 0x6a1b7a, hor: 0xff6a3d, sun: [0xffe14d, 0xff2e88], fog: 0x3a1450, grid: 0xff2e88, edge: 0x2ef6ff, wall: 0xff3ea5, alt: 0xffd23f, surf: 0x1a1236, city: [0xff3ea5, 0x2ef6ff, 0xffd23f, 0xb06bff], sunDir: [0, 0.12, -1] },
  violet: { top: 0x05061c, mid: 0x2a0f5a, hor: 0x9b3dff, sun: [0x7af0ff, 0xb04bff], fog: 0x1c0c3c, grid: 0x7a5bff, edge: 0x7af0ff, wall: 0xb04bff, alt: 0x4dff9a, surf: 0x120f2e, city: [0x7af0ff, 0xb04bff, 0x4dff9a, 0xff4fd8], sunDir: [1, 0.1, 0.2] },
  harbor: { top: 0x02101e, mid: 0x063a4a, hor: 0x18c6a0, sun: [0xb9ff6a, 0x18c6a0], fog: 0x062634, grid: 0x18e6c0, edge: 0xb9ff6a, wall: 0x18e6c0, alt: 0xff8a3d, surf: 0x0b1a26, city: [0x18e6c0, 0xb9ff6a, 0xff8a3d, 0x3ea6ff], sunDir: [-1, 0.14, -0.3] },
  inferno: { top: 0x12030a, mid: 0x5a0a1e, hor: 0xff4a1c, sun: [0xffd04d, 0xff1c4a], fog: 0x3a0a14, grid: 0xff3a1c, edge: 0xffd04d, wall: 0xff2a4a, alt: 0x2ef6ff, surf: 0x1e0c14, city: [0xff2a4a, 0xffd04d, 0xff7a1c, 0x2ef6ff], sunDir: [0.4, 0.1, 1] },
};

// ---------------------------------------------------------------- canvas textures
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
const hexCss = (h, a = 1) => `rgba(${(h >> 16) & 255},${(h >> 8) & 255},${h & 255},${a})`;

function surfaceTex(mood) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = hexCss(mood.surf); g.fillRect(0, 0, w, h);
    // fine hex-ish panel noise
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 6); }
    g.strokeStyle = hexCss(mood.grid, 0.55); g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
    g.strokeStyle = hexCss(mood.grid, 0.18); g.lineWidth = 1;
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
}
function wallTex() {
  return canvasTex(64, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(8, h * 0.75); g.lineTo(32, h * 0.35); g.lineTo(56, h * 0.75); g.stroke();
  });
}
function chevronTex() {
  return canvasTex(64, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,1)';
    for (let k = 0; k < 2; k++) {
      const y = k * 64 + 8;
      g.beginPath(); g.moveTo(4, y + 40); g.lineTo(32, y + 8); g.lineTo(60, y + 40); g.lineTo(60, y + 54); g.lineTo(32, y + 22); g.lineTo(4, y + 54); g.closePath(); g.fill();
    }
  });
}
function checkerTex() {
  return canvasTex(64, 16, (g) => { for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); } });
}
function windowsTex(rng) {
  return canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#07061a'; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h - 4; y += 8) for (let x = 4; x < w - 4; x += 8) {
      const r = rng();
      if (r < 0.32) { g.fillStyle = r < 0.06 ? 'rgba(255,120,220,0.95)' : r < 0.12 ? 'rgba(90,240,255,0.9)' : 'rgba(255,220,150,0.75)'; g.fillRect(x, y, 5, 4); }
    }
  });
}
export function glowTex() {
  return canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, false);
}

// ---------------------------------------------------------------- view
export function createWorld(ctx, track, moodKey, rng) {
  const mood = MOODS[moodKey] || MOODS.sunset;
  const q = ctx.quality();
  const renderer = ctx.three.createRenderer({ antialias: q.antialias });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(mood.fog, 0.0011);
  scene.background = new THREE.Color(mood.top);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 5000);
  const disposables = [];
  const own = (x) => { disposables.push(x); return x; };

  // lights: cool moon + coloured fill. Toon/lambert ships read well against the dark track.
  const hemi = new THREE.HemisphereLight(0x9a8cff, 0x2a1030, 1.1); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xd8d0ff, 1.6); moon.position.set(60, 120, 40); scene.add(moon); scene.add(moon.target);
  moon.castShadow = !!q.shadows;
  moon.shadow.mapSize.set(q.shadowMap || 512, q.shadowMap || 512);
  Object.assign(moon.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 400 });
  moon.shadow.bias = -0.0008;

  // ---- sky dome (gradient + striped synthwave sun)
  const sunDir = new THREE.Vector3(...mood.sunDir).normalize();
  const skyMat = own(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(mood.top) }, mid: { value: new THREE.Color(mood.mid) }, hor: { value: new THREE.Color(mood.hor) },
      sunA: { value: new THREE.Color(mood.sun[0]) }, sunB: { value: new THREE.Color(mood.sun[1]) }, sunDir: { value: sunDir }, time: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 top, mid, hor, sunA, sunB, sunDir; uniform float time; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, h));
        c = mix(c, top, smoothstep(0.15, 0.6, h));
        c = mix(c, hor * 0.35, smoothstep(0.0, -0.25, h));
        // sun disc with horizontal cut stripes
        vec3 sd = normalize(vec3(sunDir.x, 0.0, sunDir.z));
        vec3 sdir = normalize(sd + vec3(0.0, sunDir.y, 0.0));
        float d = distance(normalize(vDir), sdir);
        float r = 0.2;
        if (d < r) {
          float y = (dot(vDir, vec3(0.0,1.0,0.0)) - sdir.y) / r;
          float stripes = step(0.0, sin((y + 1.0) * 26.0 + time * 0.6) + (y + 0.25) * 6.0);
          vec3 sc = mix(sunB, sunA, smoothstep(-1.0, 0.8, y));
          c = mix(c, sc * 1.6, smoothstep(r, r - 0.008, d) * (y > -0.15 ? 1.0 : stripes));
        }
        c += hor * 0.5 * pow(max(0.0, 1.0 - d * 1.4), 3.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  const sky = new THREE.Mesh(own(new THREE.SphereGeometry(4000, 32, 16)), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  // ---- stars
  if (q.pixelRatio > 1) {
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = rng() * Math.PI * 2, y = 0.15 + rng() * 0.85, r = Math.sqrt(1 - y * y); pos.set([Math.cos(a) * r * 3500, y * 3500, Math.sin(a) * r * 3500], i * 3); }
    const g = own(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, own(new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
    scene.add(stars);
  }

  // ---- bounds of the track (for ground + city)
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9;
  for (const p of track.paths) for (let i = 0; i < p.n; i++) { const x = p.P[i * 3], y = p.P[i * 3 + 1], z = p.P[i * 3 + 2]; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); minY = Math.min(minY, y); }
  const groundY = minY - 70;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  // ---- neon grid ground
  const gridMat = own(new THREE.ShaderMaterial({
    fog: false, transparent: false,
    uniforms: { col: { value: new THREE.Color(mood.grid) }, fogc: { value: new THREE.Color(mood.fog) }, base: { value: new THREE.Color(mood.top).multiplyScalar(0.6) }, camPos: { value: new THREE.Vector3() }, pulse: { value: 0 } },
    vertexShader: 'varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position,1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 col, fogc, base, camPos; uniform float pulse; varying vec3 wp;
      void main(){
        vec2 g = abs(fract(wp.xz / 40.0 - 0.5) - 0.5) / fwidth(wp.xz / 40.0);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float dist = length(wp.xz - camPos.xz);
        vec3 c = base + col * line * (1.2 + pulse * 0.9);
        float f = 1.0 - exp(-dist * 0.0009);
        gl_FragColor = vec4(mix(c, fogc, clamp(f, 0.0, 1.0)), 1.0);
      }`,
  }));
  gridMat.extensions = { derivatives: true };
  const ground = new THREE.Mesh(own(new THREE.PlaneGeometry(9000, 9000)), gridMat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx, groundY, cz); scene.add(ground);

  // ---- spatial hash of track samples (city placement + pylons)
  const cell = 24, hash = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const p of track.paths) for (let i = 0; i < p.n; i += 3) {
    const x = p.P[i * 3], y = p.P[i * 3 + 1], z = p.P[i * 3 + 2], k = key(x, z);
    if (!hash.has(k)) hash.set(k, []); hash.get(k).push([x, y, z]);
  }
  // lowest track height near (x,z) within r, or null if no track nearby
  function trackNear(x, z, r) {
    let low = null; const c0 = Math.floor((x - r) / cell), c1 = Math.floor((x + r) / cell), d0 = Math.floor((z - r) / cell), d1 = Math.floor((z + r) / cell);
    for (let a = c0; a <= c1; a++) for (let b = d0; b <= d1; b++) {
      const arr = hash.get(`${a},${b}`); if (!arr) continue;
      for (const [px, py, pz] of arr) if ((px - x) ** 2 + (pz - z) ** 2 < r * r) low = low == null ? py : Math.min(low, py);
    }
    return low;
  }

  // ---- city: instanced towers with window textures (+ neon roof strips)
  // windows are procedural in world space, so every tower gets correctly sized windows whatever its scale
  const towerMat = own(new THREE.ShaderMaterial({
    uniforms: { fogc: { value: new THREE.Color(mood.fog) }, lit: { value: new THREE.Color(mood.city[0]) }, lit2: { value: new THREE.Color(mood.city[1]) } },
    vertexShader: `varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vSeed;
      void main(){
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec4 w = modelMatrix * im * vec4(position, 1.0); vW = w.xyz;
        vN = normalize(mat3(modelMatrix * im) * normal);
        vC = vec3(0.3, 0.3, 0.5);
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #endif
        vSeed = im[3][0] * 0.13 + im[3][2] * 0.71;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `uniform vec3 fogc, lit, lit2; varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vSeed;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed) * 43758.5453); }
      void main(){
        vec3 c = vC * 0.07;
        if (abs(vN.y) < 0.5) {
          float u = abs(vN.x) > 0.5 ? vW.z : vW.x;
          vec2 g = vec2(u / 3.2, vW.y / 4.2);
          vec2 cell = floor(g), f = fract(g);
          float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.28, f.y) * step(f.y, 0.78);
          float r = h(cell + floor(vN.xz * 3.0));
          vec3 wc = r < 0.06 ? lit * 1.6 : r < 0.12 ? lit2 * 1.4 : vec3(1.0, 0.82, 0.55) * 0.9;
          c += win * step(r, 0.34) * wc;
          c += vC * 0.05 * (1.0 - f.y);
        } else c = vC * 0.1;
        float d = length(vW - cameraPosition);
        gl_FragColor = vec4(mix(c, fogc, 1.0 - exp(-d * 0.0011)), 1.0);
      }`,
  }));
  const boxGeo = own(new THREE.BoxGeometry(1, 1, 1)); boxGeo.translate(0, 0.5, 0);
  const towers = [];
  const span = Math.max(maxX - minX, maxZ - minZ) / 2 + 700;
  const step = q.pixelRatio > 1 ? 34 : 46;
  for (let x = cx - span; x < cx + span; x += step) for (let z = cz - span; z < cz + span; z += step) {
    if (rng() < 0.35) continue;
    const w = 14 + rng() * 22, d = 14 + rng() * 22;
    const px = x + (rng() - 0.5) * 12, pz = z + (rng() - 0.5) * 12;
    const distC = Math.hypot(px - cx, pz - cz) / span;
    let h = 30 + rng() * 120 + (1 - distC) * 80 + (rng() < 0.08 ? 160 : 0);
    const near = trackNear(px, pz, Math.max(w, d) * 0.75 + 34);
    if (near != null) { const maxH = near - groundY - 14; if (maxH < 12) continue; h = Math.min(h, maxH); }
    towers.push([px, pz, w, d, h]);
  }
  const tMesh = new THREE.InstancedMesh(boxGeo, towerMat, towers.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const roofs = [];
  towers.forEach(([x, z, w, d, h], i) => {
    m4.makeScale(w, h, d).setPosition(x, groundY, z); tMesh.setMatrixAt(i, m4);
    col.setHSL(0.68 + rng() * 0.12, 0.4, 0.35 + rng() * 0.25); tMesh.setColorAt(i, col);
    if (rng() < 0.45) roofs.push([x, z, w, d, h, mood.city[Math.floor(rng() * mood.city.length)]]);
  });
  tMesh.instanceMatrix.needsUpdate = true; if (tMesh.instanceColor) tMesh.instanceColor.needsUpdate = true;
  scene.add(tMesh);
  // neon rims on roofs (thin bright slabs)
  const rimMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }));
  const rMesh = new THREE.InstancedMesh(boxGeo, rimMat, roofs.length);
  roofs.forEach(([x, z, w, d, h, c], i) => { m4.makeScale(w + 0.7, 1.1, d + 0.7).setPosition(x, groundY + h - 2.6, z); rMesh.setMatrixAt(i, m4); rMesh.setColorAt(i, col.set(c)); });
  rMesh.instanceMatrix.needsUpdate = true; if (rMesh.instanceColor) rMesh.instanceColor.needsUpdate = true;
  scene.add(rMesh);

  // ---- holographic billboards on towers facing the track (neon signs with words, pulsing)
  const WORDS = ['NEON', 'RUSH', 'DRIFT', 'VOLT', 'HYPER', '24/7', 'NOVA', 'BOOST', 'ZOOM', 'GLOW'];
  const signs = [];
  {
    const cand = towers.map((tw, i) => ({ tw, i })).filter(({ tw: [x, z, w, d, h] }) => h > 70 && trackNear(x, z, Math.max(w, d) + 140) != null && trackNear(x, z, Math.max(w, d) + 40) == null);
    rng.shuffle(cand);
    const nSigns = Math.min(cand.length, q.pixelRatio > 1 ? 14 : 8);
    for (let k = 0; k < nSigns; k++) {
      const [x, z, w, d, h] = cand[k].tw;
      const word = WORDS[Math.floor(rng() * WORDS.length)], colr = mood.city[Math.floor(rng() * mood.city.length)];
      const tex = own(canvasTex(256, 96, (g, W, H) => {
        g.clearRect(0, 0, W, H);
        g.strokeStyle = hexCss(colr); g.lineWidth = 6; g.strokeRect(6, 6, W - 12, H - 12);
        g.font = 'bold 64px Lilita One, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.shadowColor = hexCss(colr); g.shadowBlur = 16; g.fillStyle = '#fff'; g.fillText(word, W / 2, H / 2 + 3);
        g.fillStyle = hexCss(colr, 0.9); g.fillText(word, W / 2, H / 2 + 3);
      }, false));
      const mat = own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.2, 1.2, 1.2) }));
      const sw = Math.min(w, d) * 1.6, sh = sw * 0.375;
      const m = new THREE.Mesh(own(new THREE.PlaneGeometry(sw, sh)), mat);
      // face the centre of the track bounds
      const ang = Math.atan2(cx - x, cz - z);
      m.position.set(x + Math.sin(ang) * (Math.max(w, d) / 2 + 1), groundY + h - sh * 0.9, z + Math.cos(ang) * (Math.max(w, d) / 2 + 1));
      m.rotation.y = ang;
      scene.add(m); signs.push({ m, mat, ph: rng() * 6 });
    }
  }

  // ---- track meshes
  const texSurf = own(surfaceTex(mood)), texWall = own(wallTex()), texChev = own(chevronTex()), texCheck = own(checkerTex());
  const surfMat = own(new THREE.MeshLambertMaterial({ map: texSurf, emissive: new THREE.Color(mood.grid), emissiveMap: texSurf, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
  const scSurfMat = own(new THREE.MeshLambertMaterial({ map: texSurf, color: 0x9a7aff, emissive: new THREE.Color(0x6a3aff), emissiveMap: texSurf, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
  const underMat = own(new THREE.MeshLambertMaterial({ color: 0x1a1430, emissive: 0x0a0618 }));
  const edgeMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(mood.edge).multiplyScalar(1.15), side: THREE.DoubleSide }));
  const edgeBase = edgeMat.color.clone();
  const wallMat = own(new THREE.MeshBasicMaterial({ map: texWall, color: new THREE.Color(mood.wall).multiplyScalar(0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.7 }));
  const padMat = own(new THREE.MeshBasicMaterial({ map: texChev, color: new THREE.Color(mood.alt).multiplyScalar(1.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const checkMat = own(new THREE.MeshBasicMaterial({ map: texCheck, polygonOffset: true, polygonOffsetFactor: -2 }));
  const trackGroup = new THREE.Group(); scene.add(trackGroup);
  const tmp = [0, 0, 0];

  function buildPath(path, isSc) {
    const RING = 2, n = Math.ceil(path.L / RING) + (path.closed ? 1 : 1);
    const PL = 6, PF = 4, NC = PL * 2 + PF + 1;        // cross-section: left pipe, flat, right pipe
    const pos = [], uv = [], idx = [], upos = [], uidx = [];
    const ds = [];
    for (let r = 0; r < n; r++) {
      const s = Math.min(r * RING, path.closed ? path.L : path.L - 0.01);
      const hw = scalar(path, path.hw, s), eL = extent(path, s, -1), eR = extent(path, s, 1);
      const cs = [];
      for (let j = 0; j < PL; j++) cs.push(-eL + (eL - hw) * (j / PL));
      for (let j = 0; j <= PF; j++) cs.push(-hw + 2 * hw * (j / PF));
      for (let j = 1; j <= PL; j++) cs.push(hw + (eR - hw) * (j / PL));
      for (const d of cs) {
        worldPos(path, s, d, 0, tmp); pos.push(tmp[0], tmp[1], tmp[2]); uv.push(d / 5, s / 10);
        worldPos(path, s, d, -0.9, tmp); upos.push(tmp[0], tmp[1], tmp[2]);
      }
      ds.push(s);
    }
    for (let r = 0; r < n - 1; r++) {
      const s = ds[r] + 1;
      if (path.gap[Math.min(path.n - 1, Math.floor(s / path.ds)) % path.n]) continue;
      for (let j = 0; j < NC - 1; j++) {
        const a = r * NC + j, b = a + 1, c = a + NC, d = c + 1;
        idx.push(a, c, b, b, c, d);
        uidx.push(a, b, c, b, d, c);
      }
      // side skirts
      for (const j of [0, NC - 1]) {
        const a = r * NC + j, c = a + NC;
        const base = pos.length / 3;
        // skirt quad: top a,c  bottom a',c' (from upos)
        pos.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2], upos[a * 3], upos[a * 3 + 1], upos[a * 3 + 2], upos[c * 3], upos[c * 3 + 1], upos[c * 3 + 2]);
        uv.push(0, 0, 0, 1, 1, 0, 1, 1);
        if (j === 0) idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3); else idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const surf = new THREE.Mesh(g, isSc ? scSurfMat : surfMat); surf.receiveShadow = true; trackGroup.add(surf);
    const ug = own(new THREE.BufferGeometry());
    ug.setAttribute('position', new THREE.Float32BufferAttribute(upos, 3)); ug.setIndex(uidx); ug.computeVertexNormals();
    trackGroup.add(new THREE.Mesh(ug, underMat));

    // edge strips (on the surface) and energy walls (rising from the edge)
    const strip = (dFn, w, lift, mat, filter, height = 0) => {
      const P = [], U = [], I = [];
      let run = 0;
      for (let r = 0; r < n; r++) {
        const s = ds[r];
        const ok = filter(s);
        const d = dFn(s);
        if (height) {
          const f = { t: [0, 0, 0], u: [0, 0, 0], r: [0, 0, 0] };
          worldPos(path, s, d, 0.02, tmp, f); const a = [...tmp];
          P.push(...a, a[0] + f.u[0] * height, a[1] + f.u[1] * height, a[2] + f.u[2] * height);
        } else {
          worldPos(path, s, d - w / 2, lift, tmp); P.push(...tmp); worldPos(path, s, d + w / 2, lift, tmp); P.push(...tmp);
        }
        U.push(0, s / 6, 1, s / 6);
        if (r > 0 && ok && run > 0 && !path.gap[Math.min(path.n - 1, Math.floor((s - 1) / path.ds))]) { const a = (r - 1) * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        run = ok ? run + 1 : 0;
      }
      const gg = own(new THREE.BufferGeometry());
      gg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); gg.setIndex(I);
      const m = new THREE.Mesh(gg, mat); trackGroup.add(m); return m;
    };
    const iAt = (s) => Math.min(path.n - 1, Math.floor(s / path.ds));
    const edgeCol = isSc ? null : edgeMat;
    strip((s) => -extent(path, s, -1) + 0.35, 0.5, 0.04, edgeCol || own(new THREE.MeshBasicMaterial({ color: 0xc89bff })), () => true);
    strip((s) => extent(path, s, 1) - 0.35, 0.5, 0.04, edgeCol || own(new THREE.MeshBasicMaterial({ color: 0xc89bff })), () => true);
    if (!isSc) { strip(() => 0, 0.25, 0.03, own(new THREE.MeshBasicMaterial({ color: new THREE.Color(mood.edge).multiplyScalar(0.5), transparent: true, opacity: 0.5 })), (s) => Math.floor(s / 6) % 2 === 0); }
    strip((s) => -extent(path, s, -1), 0, 0, wallMat, (s) => path.wl[iAt(s)] === 1, 1.7);
    strip((s) => extent(path, s, 1), 0, 0, wallMat, (s) => path.wr[iAt(s)] === 1, 1.7);

    // boost strips
    for (const p of path.pads) {
      const P = [], U = [], I = [];
      const n2 = Math.ceil((p.s1 - p.s0) / 2);
      for (let r = 0; r <= n2; r++) {
        const s = p.s0 + (p.s1 - p.s0) * (r / n2);
        worldPos(path, s, p.d0, 0.06, tmp); P.push(...tmp); worldPos(path, s, p.d1, 0.06, tmp); P.push(...tmp);
        U.push(0, -r / n2 * 2, 1, -r / n2 * 2);
        if (r) { const a = (r - 1) * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const gg = own(new THREE.BufferGeometry());
      gg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); gg.setIndex(I);
      trackGroup.add(new THREE.Mesh(gg, padMat));
    }
    // jump chevrons (warning stripes before the lip)
    for (const j of path.jumps) {
      const P = [], U = [], I = [];
      const hw = scalar(path, path.hw, j.lip);
      for (let r = 0; r <= 8; r++) {
        const s = j.ramp + (j.lip - j.ramp) * (r / 8);
        worldPos(path, s, -hw, 0.07, tmp); P.push(...tmp); worldPos(path, s, hw, 0.07, tmp); P.push(...tmp);
        U.push(0, -r / 2, hw / 2.5, -r / 2);
        if (r) { const a = (r - 1) * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const gg = own(new THREE.BufferGeometry());
      gg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); gg.setIndex(I);
      trackGroup.add(new THREE.Mesh(gg, padMat));
    }
  }
  for (const p of track.paths) buildPath(p, p !== track.main);

  // start / finish: checker strip + gate arch with glowing frame
  {
    const main = track.main, hw = scalar(main, main.hw, 0);
    const P = [], U = [], I = [];
    for (let r = 0; r <= 1; r++) { const s = -1.5 + r * 3; worldPos(main, s, -hw, 0.05, tmp); P.push(...tmp); worldPos(main, s, hw, 0.05, tmp); P.push(...tmp); U.push(0, r, hw / 2, r); }
    I.push(0, 2, 1, 1, 2, 3);
    const gg = own(new THREE.BufferGeometry()); gg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); gg.setIndex(I);
    trackGroup.add(new THREE.Mesh(gg, checkMat));
    const f = { t: [0, 0, 0], u: [0, 0, 0], r: [0, 0, 0] };
    const base = worldPos(main, 0, 0, 0, [0, 0, 0], f);
    const gate = new THREE.Group();
    const frameMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(mood.edge).multiplyScalar(1.2) }));
    const postGeo = own(new THREE.BoxGeometry(1, 12, 1)), barGeo = own(new THREE.BoxGeometry(2 * hw + 3, 1.6, 1));
    for (const sd of [-1, 1]) { const m = new THREE.Mesh(postGeo, frameMat); m.position.set(sd * (hw + 1.5), 6, 0); gate.add(m); }
    const bar = new THREE.Mesh(barGeo, own(new THREE.MeshBasicMaterial({ color: new THREE.Color(mood.wall).multiplyScalar(1.2) }))); bar.position.set(0, 12, 0); gate.add(bar);
    const mx = new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.r), new THREE.Vector3(...f.u), new THREE.Vector3(-f.t[0], -f.t[1], -f.t[2]));
    gate.quaternion.setFromRotationMatrix(mx); gate.position.set(...base);
    trackGroup.add(gate);
  }

  // pylons under upright sections
  {
    const pts = [];
    const main = track.main;
    for (let s = 20; s < main.L; s += 70) {
      const i = Math.floor(s / main.ds);
      if (main.U[i * 3 + 1] < 0.85 || main.gap[i]) continue;
      const y = main.P[i * 3 + 1] - 1, h = y - groundY;
      if (h < 6) continue;
      pts.push([main.P[i * 3], y, main.P[i * 3 + 2], h]);
    }
    const pg = own(new THREE.CylinderGeometry(1.4, 2.2, 1, 8)); pg.translate(0, -0.5, 0);
    const pm = own(new THREE.MeshLambertMaterial({ color: 0x2a2048, emissive: 0x0c0820 }));
    const im = new THREE.InstancedMesh(pg, pm, pts.length);
    pts.forEach(([x, y, z, h], i) => { m4.makeScale(1, h, 1).setPosition(x, y, z); im.setMatrixAt(i, m4); });
    im.instanceMatrix.needsUpdate = true; scene.add(im);
    // a glowing ring band near the top of each pylon
    const rg = own(new THREE.TorusGeometry(1.7, 0.18, 6, 16)); rg.rotateX(Math.PI / 2);
    const ri = new THREE.InstancedMesh(rg, own(new THREE.MeshBasicMaterial({ color: new THREE.Color(mood.edge).multiplyScalar(1.5) })), pts.length);
    pts.forEach(([x, y, z], i) => { m4.makeTranslation(x, y - 3, z); ri.setMatrixAt(i, m4); });
    ri.instanceMatrix.needsUpdate = true; scene.add(ri);
  }

  // ---- post-processing (High only): bloom makes the neon glow
  let composer = null, bloom = null;
  function setupComposer() {
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); bloom?.dispose(); composer = null; bloom = null; }
    if (!ctx.quality().effects) return;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight;
    bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.6, 0.45, 0.82);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setSize(w, h);
  }
  setupComposer();

  function resize() {
    const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    composer?.setSize(w, h);
  }
  resize();

  let t = 0;
  return {
    scene, camera, renderer, mood, moon, groundY, sky,
    resize,
    setQuality() { ctx.three.applyQuality(renderer, moon); setupComposer(); resize(); },
    update(dt, focus, beat = 0) {
      t += dt;
      // the track lights breathe with the music
      edgeMat.color.copy(edgeBase).multiplyScalar(1 + beat * 0.55);
      wallMat.opacity = 0.62 + beat * 0.3;
      gridMat.uniforms.pulse.value = beat;
      for (const sg of signs) sg.mat.opacity = 0.75 + 0.25 * Math.sin(t * 3 + sg.ph) * (Math.sin(t * 17 + sg.ph * 3) > -0.92 ? 1 : -2);
      skyMat.uniforms.time.value = t;
      gridMat.uniforms.camPos.value.copy(camera.position);
      sky.position.copy(camera.position);
      texWall.offset.y = -t * 0.6; texChev.offset.y = (t * 1.6) % 1;
      if (focus) { moon.position.set(focus.x + 60, focus.y + 120, focus.z + 40); moon.target.position.copy(focus); }
    },
    render() { if (composer) composer.render(); else renderer.render(scene, camera); },
    setBloom(k) { if (bloom) bloom.strength = k; },
    dispose() {
      if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); bloom?.dispose(); }
      ctx.three.dispose(scene);
      for (const d of disposables) d.dispose?.();
    },
  };
}
