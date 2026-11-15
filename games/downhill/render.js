import * as THREE from 'three';
import { buildHat } from '../../core/avatar.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Per-map look: sky, light, fog, bloom, weather, tree colours
export const THEMES = {
  alpine: { top: 0x4f8ad8, mid: 0xa5c8ec, bottom: 0xd6e6f5, fog: [0xd6e6f5, 120, 520], sun: [0xfff1dc, 2.4], sunDir: [-0.45, 0.55, 0.7],
    hemi: [0xd8ecff, 0x8ea3bd, 1.25], exposure: 1.0, mtn: 0xffffff, bloom: [0.22, 0.4, 0.92], snow: 0, night: 0, tree: [0.36, 0.45, 0.2], sunGlow: 1 },
  park: { top: 0x030716, mid: 0x0d1a3c, bottom: 0x22325a, fog: [0x1b2746, 90, 460], sun: [0xa9c0ff, 0.9], sunDir: [0.35, 0.75, -0.45],
    hemi: [0x5a72b0, 0x151b2a, 1.0], exposure: 1.25, mtn: 0x2f4268, bloom: [0.45, 0.4, 0.88], snow: 900, night: 1, tree: [0.42, 0.35, 0.15], sunGlow: 0 },
  powder: { top: 0x93a3b6, mid: 0xbcc7d4, bottom: 0xd6dde6, fog: [0xd1d8e1, 30, 290], sun: [0xffffff, 0.9], sunDir: [-0.3, 0.8, 0.4],
    hemi: [0xe8eef6, 0x9aa6b6, 1.75], exposure: 1.0, mtn: 0xd0d8e4, bloom: [0.08, 0.3, 0.97], snow: 2600, night: 0, tree: [0.4, 0.3, 0.16], sunGlow: 0.2 },
  glacier: { top: 0x23366e, mid: 0xd98a6c, bottom: 0xffc590, fog: [0xf2c3a4, 160, 680], sun: [0xffc08a, 2.4], sunDir: [-0.25, 0.2, 0.95],
    hemi: [0xdfe4ff, 0x5d6d96, 1.2], exposure: 1.05, mtn: 0xffd9c4, bloom: [0.35, 0.5, 0.85], snow: 0, night: 0, tree: [0.33, 0.4, 0.18], sunGlow: 1.4 },
};
const HW_DEFAULT = 16;

export const COLORS = [0xff4d4d, 0x3e9bff, 0x30c46c, 0xffb020, 0xb44dff, 0xff6fd0, 0x20d0d0, 0xf0f0f0];

const HORIZON = 0xd6e6f5;
const W0 = (r) => r.domElement.parentElement?.clientWidth || window.innerWidth, H0 = (r) => r.domElement.parentElement?.clientHeight || window.innerHeight;

// ---------------- Renderer, sky, lights, backdrop ----------------
// Takes the WebGLRenderer the hub created for this game (ctx.three.createRenderer) and builds sky, lights, backdrop, bloom.
export function createRenderer(renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 120, 520);
  const camera = new THREE.PerspectiveCamera(72, W0(renderer) / H0(renderer), 0.1, 2600);

  // gradient sky dome with a soft sun glow
  const sunDir = new THREE.Vector3(-0.45, 0.55, 0.7).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4f8ad8) }, mid: { value: new THREE.Color(0xa5c8ec) }, bottom: { value: new THREE.Color(HORIZON) }, sun: { value: sunDir }, night: { value: 0 }, glow: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sun; uniform float night; uniform float glow; varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main(){ float h = vDir.y; vec3 c = mix(bottom, mid, smoothstep(-0.02, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
        float s = max(dot(normalize(vDir), sun), 0.0); c += vec3(1.0,0.92,0.78) * glow * (pow(s, 600.0) * 1.5 + pow(s, 10.0) * 0.22);
        if (night > 0.5) { vec3 q = floor(normalize(vDir) * 420.0); float st = step(0.9975, hash(q)) * smoothstep(0.05, 0.3, h); c += vec3(st) * (0.6 + 0.4 * hash(q + 1.0));
          c += vec3(0.85,0.9,1.0) * pow(s, 900.0) * 2.0; }
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -10;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x8ea3bd, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -50; sc.right = 50; sc.top = 50; sc.bottom = -50; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // distant mountain range that travels with the camera
  const backdrop = new THREE.Group();
  const mtnMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false });
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rockC = new THREE.Color(0x93a8c4), snowC = new THREE.Color(0xf2f6fc), farC = new THREE.Color(HORIZON);
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd() * 0.25 + ring * 0.14, dist = (ring ? 1750 : 1250) + rnd() * 250;
    const hgt = (ring ? 520 : 300) + rnd() * 380, rad = 280 + rnd() * 280;
    const g = new THREE.ConeGeometry(rad, hgt, 11, 6).toNonIndexed();
    const pa = g.attributes.position, cols = new Float32Array(pa.count * 3);
    // jitter vertices (same position -> same offset so faces stay closed)
    const jit = (x, y, z) => { const k = Math.sin(x * 0.013 + y * 0.021 + z * 0.017 + i * 3.1) * 43758.5; return (k - Math.floor(k)) - 0.5; };
    for (let v = 0; v < pa.count; v++) {
      const x = pa.getX(v), y = pa.getY(v), z = pa.getZ(v), t = (y + hgt / 2) / hgt;
      const amp = (1 - t) * rad * 0.22 * (t > 0.98 ? 0 : 1);
      pa.setXYZ(v, x + jit(x, y, z) * amp, y + jit(z, x, y) * hgt * 0.06 * (t < 0.02 || t > 0.98 ? 0 : 1), z + jit(y, z, x) * amp);
    }
    g.computeVertexNormals();
    for (let f = 0; f < pa.count; f += 3) {
      const ty = (pa.getY(f) + pa.getY(f + 1) + pa.getY(f + 2)) / 3 / hgt + 0.5;
      const ny = g.attributes.normal.getY(f);
      const snowy = ty > 0.55 - ny * 0.25 + jit(f, ty, i) * 0.1;
      const c = (snowy ? snowC : rockC).clone().lerp(farC, ring ? 0.55 : 0.3);
      for (let k = 0; k < 3; k++) cols.set([c.r, c.g, c.b], (f + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const m = new THREE.Mesh(g, mtnMat);
    m.position.set(Math.sin(a) * dist, hgt / 2 - 60, Math.cos(a) * dist); m.rotation.y = rnd() * 6;
    backdrop.add(m);
  }
  // soft clouds (hidden at night)
  const cloudMat = new THREE.SpriteMaterial({ map: dotTexture(), transparent: true, opacity: 0.5, depthWrite: false, fog: false });
  const clouds = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = 900 + rnd() * 700, sp = new THREE.Sprite(cloudMat);
    sp.position.set(Math.sin(a) * d, 330 + rnd() * 320, Math.cos(a) * d); sp.scale.set(420 + rnd() * 500, 110 + rnd() * 90, 1); clouds.add(sp);
  }
  backdrop.add(clouds);
  scene.add(backdrop);

  // bloom post-processing (high quality only)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W0(renderer), H0(renderer)), 0.2, 0.4, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // a soft light that follows your rider (so you can read your pose at night)
  const riderLight = new THREE.PointLight(0xfff0dd, 0, 18, 1.5);
  scene.add(riderLight);
  const snowfall = new Snowfall(scene);

  const W = () => renderer.domElement.parentElement?.clientWidth || window.innerWidth, H = () => renderer.domElement.parentElement?.clientHeight || window.innerHeight;
  let quality = 'high', theme = THEMES.alpine;
  const env = {
    get quality() { return quality; },
    setQuality(qv) {
      quality = qv;
      const hi = qv === 'high';
      renderer.shadowMap.enabled = hi; sun.castShadow = hi;
      renderer.setPixelRatio(hi ? Math.min(window.devicePixelRatio, 1.5) : 1);
      renderer.setSize(W(), H());
      composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(W(), H());
      scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
    },
    // keep the sun's shadow box and the backdrop centred on what the camera is looking at
    follow(x, y, z, dt = 0.016) {
      sun.position.set(x + sunDir.x * 150, y + sunDir.y * 150, z + sunDir.z * 150);
      sun.target.position.set(x, y, z);
      backdrop.position.set(camera.position.x, camera.position.y - 160, camera.position.z);
      sky.position.copy(camera.position);
      riderLight.position.set(x, y + 4, z - 12);
      snowfall.update(dt, camera.position);
    },
    get theme() { return theme; },
    applyMap(mapId) {
      theme = THEMES[mapId] || THEMES.alpine;
      const t = theme, u = sky.material.uniforms;
      u.top.value.set(t.top); u.mid.value.set(t.mid); u.bottom.value.set(t.bottom); u.night.value = t.night; u.glow.value = t.sunGlow;
      sunDir.set(...t.sunDir).normalize(); u.sun.value.copy(sunDir);
      scene.background.set(t.bottom); scene.fog.color.set(t.fog[0]); scene.fog.near = t.fog[1]; scene.fog.far = t.fog[2];
      sun.color.set(t.sun[0]); sun.intensity = t.sun[1];
      hemi.color.set(t.hemi[0]); hemi.groundColor.set(t.hemi[1]); hemi.intensity = t.hemi[2];
      renderer.toneMappingExposure = t.exposure;
      mtnMat.color.set(t.mtn);
      clouds.visible = !t.night; cloudMat.opacity = t.snow > 1000 ? 0.75 : 0.5; cloudMat.color.set(t.fog[0]).lerp(new THREE.Color(0xffffff), 0.6);
      bloom.strength = t.bloom[0]; bloom.radius = t.bloom[1]; bloom.threshold = t.bloom[2];
      riderLight.intensity = t.night ? 6 : 0;
      snowfall.setCount(t.snow);
    },
    render() { if (quality === 'high') composer.render(); else renderer.render(scene, camera); },
    resize() { renderer.setSize(W(), H()); composer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); },
    dispose() { bloom.dispose(); composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); for (const p of composer.passes) p.dispose?.(); snowfall.dispose?.(); },
  };
  return { renderer, scene, camera, env };
}

// ---------------- Falling snow (follows the camera) ----------------
class Snowfall {
  constructor(scene) {
    this.max = 2600; this.count = 0;
    this.pos = new Float32Array(this.max * 3); this.vel = new Float32Array(this.max);
    for (let i = 0; i < this.max; i++) { this.pos[i * 3] = (Math.random() - 0.5) * 120; this.pos[i * 3 + 1] = Math.random() * 60 - 20; this.pos[i * 3 + 2] = (Math.random() - 0.5) * 120; this.vel[i] = 2 + Math.random() * 3; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setDrawRange(0, 0);
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, map: dotTexture(), transparent: true, opacity: 0.9, depthWrite: false }));
    this.points.frustumCulled = false; scene.add(this.points);
    this.t = 0;
  }
  setCount(n) { this.count = Math.min(this.max, n); this.geo.setDrawRange(0, this.count); this.points.visible = n > 0; }
  update(dt, cam) {
    if (!this.count) return;
    this.t += dt;
    const wind = Math.sin(this.t * 0.3) * 1.5;
    this.points.position.copy(cam);
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.pos[k] += (wind + Math.sin(this.t + i) * 0.4) * dt; this.pos[k + 1] -= this.vel[i] * dt;
      if (this.pos[k + 1] < -25) { this.pos[k + 1] += 50; this.pos[k] = (Math.random() - 0.5) * 120; this.pos[k + 2] = (Math.random() - 0.5) * 120; }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const gg = c.getContext('2d'); const grd = gg.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  gg.fillStyle = grd; gg.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// ---------------- Ski / board tracks in the snow ----------------
export class Trails {
  constructor(scene, max = 5000) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 6 * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x8fa6c4, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.last = new Map();
  }
  clear() { this.pos.fill(0); this.geo.attributes.position.needsUpdate = true; this.last.clear(); }
  // offsets: lateral offsets of each track (two skis or one board), width of each
  add(id, x, y, z, h, offsets, width, onGround) {
    const L = this.last.get(id);
    if (!onGround) { this.last.delete(id); return; }
    if (L && (x - L.x) ** 2 + (z - L.z) ** 2 < 0.5) return;
    if (L && (x - L.x) ** 2 + (z - L.z) ** 2 < 25) {
      const sx = Math.cos(h), sz = -Math.sin(h), lsx = Math.cos(L.h), lsz = -Math.sin(L.h);
      for (const o of offsets) {
        const a = [L.x + lsx * (o - width), L.y + 0.03, L.z + lsz * (o - width)], b = [L.x + lsx * (o + width), L.y + 0.03, L.z + lsz * (o + width)];
        const c = [x + sx * (o + width), y + 0.03, z + sz * (o + width)], d = [x + sx * (o - width), y + 0.03, z + sz * (o - width)];
        this.pos.set([...a, ...b, ...c, ...a, ...c, ...d], this.i * 18);
        this.i = (this.i + 1) % this.max;
      }
      this.geo.attributes.position.needsUpdate = true;
    }
    this.last.set(id, { x, y, z, h });
  }
}

function textTexture(text, { w = 512, h = 128, bg = '#123', fg = '#fff', font = 'bold 72px system-ui' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Fine snow grain so the slope doesn't look like flat plastic
function snowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const n = 232 + Math.random() * 23 - (Math.random() < 0.02 ? 25 : 0);
    img.data[i * 4] = n; img.data[i * 4 + 1] = n + 2; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // soft wind ripples
  g.globalAlpha = 0.06; g.strokeStyle = '#7f9cc0';
  for (let i = 0; i < 40; i++) { g.beginPath(); const y = Math.random() * 256; g.moveTo(0, y); g.bezierCurveTo(80, y + 10, 170, y - 10, 256, y + Math.random() * 6); g.lineWidth = 1 + Math.random() * 2; g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Merge several non-indexed geometries (position + normal only)
function merge(geos) {
  const parts = geos.map(g => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
const cone = (r, h, y, seg = 8) => { const g = new THREE.ConeGeometry(r, h, seg, 1); g.translate(0, y, 0); return g; };

export function buildCourse(course) {
  const group = new THREE.Group();
  const { groundH } = course;
  const HW = course.hw || HW_DEFAULT;
  const theme = THEMES[course.mapId] || THEMES.alpine;

  // ---- Terrain strip that follows the course
  const step = 3, W = 460, cols = 130;
  const z0 = -60, z1 = course.L + 260;
  const rows = Math.ceil((z1 - z0) / step) + 1;
  const pos = new Float32Array(rows * (cols + 1) * 3);
  const col = new Float32Array(rows * (cols + 1) * 3);
  const uv = new Float32Array(rows * (cols + 1) * 2);
  const idx = [];
  let p = 0, q2 = 0;
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * step;
    const cx = (course.cxBase(z) + course.cxMain(z)) / 2;
    for (let c = 0; c <= cols; c++) {
      const u = -1 + (2 * c) / cols, x = cx + W * (0.18 * u + 0.82 * u * u * u * u * u); // denser near the runs
      const y = groundH(x, z);
      pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
      uv[q2] = x / 9; uv[q2 + 1] = z / 9; q2 += 2;
      const info = course.corridor(x, z);
      let cr, cg, cb;
      if (info.pipe) { const k = Math.min(1, Math.abs(x - course.cxMain(z)) / HW); cr = 0.9 - 0.12 * k; cg = 0.97 - 0.04 * k; cb = 1.0; }
      else if (info.groomed) {
        const edge = Math.max(0, 1 - Math.abs(Math.abs(x - course.cxMain(z)) - HW) / 2.5); // darker edge line
        const cord = (Math.floor((x - course.cxMain(z)) / 1.6) % 2) ? 0.015 : 0;              // corduroy
        cr = 1 - cord - edge * 0.08; cg = 1 - cord - edge * 0.06; cb = 1;
      }
      else if (info.shortcut) { cr = 0.97; cg = 0.96; cb = 0.93; }
      else { const k = Math.min(1, info.d / 45); cr = 0.93 - 0.18 * k; cg = 0.95 - 0.13 * k; cb = 1.0 - 0.04 * k; }
      col[p] = cr; col[p + 1] = cg; col[p + 2] = cb;
      p += 3;
    }
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  { // exposed rock on steep faces (cliffs), not in the pipe
    const nrm = geo.attributes.normal, rock = new THREE.Color(0x5d6675);
    for (let i = 0; i < nrm.count; i++) {
      const ny = Math.abs(nrm.getY(i)); if (ny > 0.7) continue; // (terrain winding makes normals point down; DoubleSide hides it)
      const x = pos[i * 3], z = pos[i * 3 + 2];
      if (course.hpW(z) > 0.1 && Math.abs(x - course.cxMain(z)) < HW + 2) continue;
      const k = Math.min(1, (0.7 - ny) / 0.2);
      col[i * 3] += (rock.r - col[i * 3]) * k; col[i * 3 + 1] += (rock.g - col[i * 3 + 1]) * k; col[i * 3 + 2] += (rock.b - col[i * 3 + 2]) * k;
    }
  }
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: snowTexture(), roughness: 0.82, metalness: 0, side: THREE.DoubleSide }));
  terrain.receiveShadow = true;
  group.add(terrain);

  // ---- Trees: three tiers of foliage with snow on top, instanced
  const trees = [...course.forest, ...course.obstacles.filter(o => o.type === 'tree')];
  const foliageG = merge([cone(2.0, 3.4, 2.9), cone(1.6, 3.0, 4.6), cone(1.1, 2.6, 6.2)]);
  const snowG = merge([cone(1.55, 1.3, 3.95), cone(1.2, 1.2, 5.5), cone(0.75, 1.2, 7.0)]);
  const trunkG = new THREE.CylinderGeometry(0.28, 0.4, 2.0, 6); trunkG.translate(0, 1.0, 0);
  const fol = new THREE.InstancedMesh(foliageG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), trees.length);
  const snw = new THREE.InstancedMesh(snowG, new THREE.MeshStandardMaterial({ color: 0xf6f9ff, roughness: 0.75, flatShading: true }), trees.length);
  const trk = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x5b3d27, roughness: 1 }), trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), cc = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0);
  trees.forEach((t, i) => {
    const sc = (t.s || 1.1) * 0.95;
    q.setFromAxisAngle(yAxis, (t.x * 13.7 + t.z * 7.1) % 6.28);
    m.compose(v.set(t.x, groundH(t.x, t.z) - 0.3, t.z), q, s.set(sc, sc * (0.9 + ((t.x * 3.3) % 1 + 1) % 1 * 0.3), sc));
    fol.setMatrixAt(i, m); snw.setMatrixAt(i, m); trk.setMatrixAt(i, m);
    const k = ((t.z * 1.7 + t.x) % 1 + 1) % 1;
    fol.setColorAt(i, cc.setHSL(theme.tree[0] + k * 0.06, theme.tree[1] + k * 0.15, theme.tree[2] + k * 0.08));
  });
  for (const im of [fol, snw, trk]) { im.castShadow = true; im.receiveShadow = true; }
  group.add(fol, snw, trk);

  // ---- Rocks with snow caps
  const rocks = course.obstacles.filter(o => o.type === 'rock');
  const rockG = new THREE.DodecahedronGeometry(1, 1);
  { const a = rockG.attributes.position; for (let i = 0; i < a.count; i++) { const f = 0.85 + ((Math.sin(i * 12.9898) * 43758.5) % 1 + 1) % 1 * 0.3; a.setXYZ(i, a.getX(i) * f, a.getY(i) * f, a.getZ(i) * f); } rockG.computeVertexNormals(); }
  const capG = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
  const n = Math.max(1, rocks.length);
  const rockM = new THREE.InstancedMesh(rockG, new THREE.MeshStandardMaterial({ color: 0x6f7a89, roughness: 0.95, flatShading: true }), n);
  const capM = new THREE.InstancedMesh(capG, new THREE.MeshStandardMaterial({ color: 0xf6f9ff, roughness: 0.8 }), n);
  rocks.forEach((r, i) => {
    q.setFromEuler(new THREE.Euler(r.x * 0.3, r.z, 0));
    m.compose(v.set(r.x, groundH(r.x, r.z) + r.h * 0.25, r.z), q, s.set(r.r, r.h * 0.7, r.r));
    rockM.setMatrixAt(i, m);
    m.compose(v.set(r.x, groundH(r.x, r.z) + r.h * 0.45, r.z), new THREE.Quaternion(), s.set(r.r * 0.85, r.h * 0.4, r.r * 0.85));
    capM.setMatrixAt(i, m);
  });
  rockM.count = capM.count = rocks.length;
  rockM.castShadow = capM.castShadow = true;
  group.add(rockM, capM);

  // ---- Kickers / tables: packed-snow ramps with a coloured lip and side walls
  const rampMat = new THREE.MeshStandardMaterial({ color: 0xeef4ff, roughness: 0.7, side: THREE.DoubleSide });
  const sideMat = new THREE.MeshStandardMaterial({ color: course.mapId === 'park' ? 0x6a4cff : 0x3f7fd9, roughness: 0.8, side: THREE.DoubleSide });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6, emissive: course.mapId === 'park' ? 0x662200 : 0x000000, side: THREE.DoubleSide });
  const base = (x, z) => course.groundH(x, z) - course.rampH(x, z) - 0.3;
  for (const r of course.ramps) {
    const total = r.total || r.len;
    const nx = 6, nz = Math.max(12, Math.round(total / 0.8)), pp = [], ii = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = r.x - r.w / 2 + (r.w * i) / nx, z = r.z0 + (total * j) / nz - (j === nz ? 0.01 : 0);
      pp.push(x, groundH(x, z) + 0.05, z);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i; ii.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
    g.setIndex(ii); g.computeVertexNormals();
    const top = new THREE.Mesh(g, rampMat); top.receiveShadow = true; top.castShadow = true; group.add(top);
    const quads = [];
    for (const sx of [-r.w / 2, r.w / 2]) for (let j = 0; j < nz; j++) {
      const x = r.x + sx, za = r.z0 + (total * j) / nz, zb = r.z0 + (total * (j + 1)) / nz - 0.01;
      quads.push([x, groundH(x - Math.sign(sx) * 0.01, za), za], [x, groundH(x - Math.sign(sx) * 0.01, zb), zb], [x, base(x, zb), zb], [x, base(x, za), za]);
    }
    const zl = r.z0 + r.len - 0.01;
    if (r.type !== 'table') for (let i = 0; i < nx; i++) {
      const xa = r.x - r.w / 2 + (r.w * i) / nx, xb = r.x - r.w / 2 + (r.w * (i + 1)) / nx;
      quads.push([xa, groundH(xa, zl), zl], [xb, groundH(xb, zl), zl], [xb, base(xb, zl), zl], [xa, base(xa, zl), zl]);
    } else for (let i = 0; i < nx; i++) { // drop from lip to the table deck
      const xa = r.x - r.w / 2 + (r.w * i) / nx, xb = r.x - r.w / 2 + (r.w * (i + 1)) / nx;
      quads.push([xa, groundH(xa, zl), zl], [xb, groundH(xb, zl), zl], [xb, groundH(xb, zl + 0.02), zl + 0.02], [xa, groundH(xa, zl + 0.02), zl + 0.02]);
    }
    const arr = [];
    for (let k = 0; k < quads.length; k += 4) { const [qa, qb, qc, qd] = quads.slice(k, k + 4); arr.push(...qa, ...qb, ...qc, ...qa, ...qc, ...qd); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); sg.computeVertexNormals();
    group.add(new THREE.Mesh(sg, sideMat));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(r.w + 0.1, 0.18, 0.35), lipMat);
    edge.position.set(r.x, groundH(r.x, zl) + 0.06, zl - 0.15);
    edge.rotation.x = -Math.atan(1.25 * r.h / r.len);
    group.add(edge);
    if (r.type === 'table') { // landing knuckle marker
      const kz = r.z0 + r.len + r.gap;
      const mk = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.05, 0.25), lipMat); mk.position.set(r.x, groundH(r.x, kz) + 0.06, kz); group.add(mk);
    }
  }

  // ---- Rails and boxes
  const railMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.25, metalness: 0.8, emissive: course.mapId === 'park' ? 0x332200 : 0 });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xff3d7f, roughness: 0.4, metalness: 0.2 });
  const boxTopMat = new THREE.MeshStandardMaterial({ color: 0xe8edf5, roughness: 0.25, metalness: 0.6 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a313d, roughness: 0.7, metalness: 0.5 });
  const seg = (a, b, mk) => { // place a unit-length mesh between two points
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const m = mk(len); m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()); m.castShadow = true; group.add(m); return m;
  };
  for (const r of course.rails) {
    const pts = [];
    for (let z = r.z0; z <= r.z0 + r.len + 0.01; z += r.len / 8) pts.push(new THREE.Vector3(r.x, course.railTop(r, z), z));
    for (let k = 0; k < pts.length - 1; k++) {
      if (r.type === 'rail') seg(pts[k], pts[k + 1], (len) => { const g = new THREE.CylinderGeometry(0.07, 0.07, len, 10); g.rotateX(Math.PI / 2); return new THREE.Mesh(g, railMat); });
      else {
        seg(pts[k], pts[k + 1], (len) => new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.1, len + 0.02), boxTopMat)).position.y -= 0.05;
        seg(pts[k].clone().setY(pts[k].y - 0.35), pts[k + 1].clone().setY(pts[k + 1].y - 0.35), (len) => new THREE.Mesh(new THREE.BoxGeometry(r.w * 0.96, 0.6, len + 0.02), boxMat));
      }
    }
    if (r.type === 'rail') for (let z = r.z0 + 1.5; z < r.z0 + r.len; z += 4) {
      const top = course.railTop(r, z), gy = groundH(r.x, z);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, top - gy + 0.3, 6), legMat); leg.position.set(r.x, (top + gy) / 2 - 0.15, z); group.add(leg);
    }
  }

  // ---- Chairlift: towers, cables and chairs
  if (course.lifts.length > 1) {
    const tw = new THREE.MeshStandardMaterial({ color: 0x59606c, roughness: 0.6, metalness: 0.6 });
    const pts = [];
    for (const l of course.lifts) {
      const gy = groundH(l.x, l.z), H = 13;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, H, 8), tw); pole.position.set(l.x, gy + H / 2, l.z); pole.castShadow = true; group.add(pole);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 0.35), tw); bar.position.set(l.x, gy + H, l.z); group.add(bar);
      pts.push(new THREE.Vector3(l.x, gy + H - 0.2, l.z));
    }
    const cableMat = new THREE.LineBasicMaterial({ color: 0x2a2f38 });
    for (const off of [-2.2, 2.2]) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => p.clone().setX(p.x + off))), cableMat));
    const chairM = new THREE.MeshStandardMaterial({ color: 0x2b5fd9, roughness: 0.6 });
    for (let k = 0; k < pts.length - 1; k++) for (let t = 0.15; t < 1; t += 0.3) {
      const p = pts[k].clone().lerp(pts[k + 1], t), off = (k + Math.round(t * 3)) % 2 ? -2.2 : 2.2;
      const chair = new THREE.Group(); chair.position.set(p.x + off, p.y - 2.2, p.z);
      const hang = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.08), tw); hang.position.y = 1.1; chair.add(hang);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.15, 0.7), chairM); chair.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 0.12), chairM); back.position.set(0, 0.4, -0.35); chair.add(back);
      group.add(chair);
    }
  }

  // ---- Floodlights (night map): pole, glowing head, light cone and a pool of light on the snow
  if (course.lights.length) {
    const poleM = new THREE.MeshStandardMaterial({ color: 0x30353f, roughness: 0.6, metalness: 0.5 });
    const headM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 3 });
    const coneM = new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const poolTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g2 = c.getContext('2d'); const gr = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,240,205,0.4)'); gr.addColorStop(0.5, 'rgba(255,235,195,0.16)'); gr.addColorStop(1, 'rgba(255,235,195,0)'); g2.fillStyle = gr; g2.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
    const poolM = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    for (const l of course.lights) {
      const gy = groundH(l.x, l.z), H = 16, inward = Math.sign(course.cxMain(l.z) - l.x);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, H, 8), poleM); pole.position.set(l.x, gy + H / 2, l.z); group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.2), headM); head.position.set(l.x + inward * 1.2, gy + H, l.z); head.rotation.z = inward * 0.4; group.add(head);
      const tx = l.x + inward * 9;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(11, H, 20, 1, true), coneM);
      cone.position.set((head.position.x + tx) / 2, gy + H / 2, l.z); cone.rotation.z = -inward * 0.45; group.add(cone);
      const pg = new THREE.PlaneGeometry(36, 36, 8, 8); const pa = pg.attributes.position;
      for (let i = 0; i < pa.count; i++) { const lx = pa.getX(i), lz = -pa.getY(i); pa.setXYZ(i, tx + lx, groundH(tx + lx, l.z + lz) + 0.1, l.z + lz); }
      group.add(new THREE.Mesh(pg, poolM));
    }
  }

  // ---- Orange safety netting along park sections and cliffs
  {
    const netPts = [], postPts = [];
    for (const sct of course.sections) {
      if (!['jumpline', 'rails', 'cliff', 'halfpipe'].includes(sct.type)) continue;
      for (const sgn of [-1, 1]) for (let z = sct.z0 - 10; z < sct.z0 + sct.len + 10; z += 5) {
        const x0 = course.cxMain(z) + sgn * (HW + 1.5), x1 = course.cxMain(z + 5) + sgn * (HW + 1.5);
        const y0 = groundH(x0, z), y1 = groundH(x1, z + 5);
        netPts.push(x0, y0 + 1.1, z, x1, y1 + 1.1, z + 5, x0, y0 + 0.5, z, x1, y1 + 0.5, z + 5);
        postPts.push(x0, y0, z, x0, y0 + 1.2, z);
      }
    }
    if (netPts.length) {
      const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute([...netPts, ...postPts], 3));
      group.add(new THREE.LineSegments(ng, new THREE.LineBasicMaterial({ color: 0xff6a00 })));
    }
  }

  // ---- Boost pads
  const padTex = textTexture('>>>', { w: 256, h: 128, bg: '#00c8ff', fg: '#ffffff', font: 'bold 90px system-ui' });
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.92 });
  for (const pd of course.pads) {
    const pg = new THREE.PlaneGeometry(4.4, 6.4, 2, 3);
    const a = pg.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const lx = a.getX(i), lz = -a.getY(i);
      a.setXYZ(i, pd.x + lx, groundH(pd.x + lx, pd.z + lz) + 0.08, pd.z + lz);
    }
    const uvs = pg.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setXY(i, 1 - uvs.getY(i), uvs.getX(i));
    pg.computeVertexNormals();
    group.add(new THREE.Mesh(pg, padMat));
  }

  // ---- Gates: poles with triangular pennants
  const poleG = new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6); poleG.translate(0, 1.7, 0);
  const pennant = new THREE.BufferGeometry();
  pennant.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -1.1, 0, 1.5, -0.55, 0], 3)); pennant.computeVertexNormals();
  for (const gt of course.gates) {
    const mat = new THREE.MeshStandardMaterial({ color: gt.color, roughness: 0.6, side: THREE.DoubleSide });
    for (const sgn of [-1, 1]) {
      const x = gt.x + sgn * gt.hw, y = groundH(x, gt.z);
      const pole = new THREE.Mesh(poleG, mat); pole.position.set(x, y, gt.z); pole.castShadow = true; group.add(pole);
      const flag = new THREE.Mesh(pennant, mat); flag.position.set(x, y + 3.35, gt.z); flag.scale.x = -sgn; flag.castShadow = true; group.add(flag);
    }
  }
  // ---- Shortcut flags + section signs
  const yMat = new THREE.MeshStandardMaterial({ color: 0xffd400, roughness: 0.6, side: THREE.DoubleSide });
  for (const f of course.flags) {
    const y = groundH(f.x, f.z);
    const pole = new THREE.Mesh(poleG, yMat); pole.position.set(f.x, y, f.z); group.add(pole);
    const fl = new THREE.Mesh(pennant, yMat); fl.position.set(f.x, y + 3.35, f.z); fl.scale.setScalar(0.7); group.add(fl);
  }
  const postM = new THREE.MeshStandardMaterial({ color: 0x2a313d, roughness: 0.8 });
  for (const sg of course.signs) {
    const mat = new THREE.MeshBasicMaterial({ map: textTexture(sg.text, { bg: sg.bg, fg: sg.fg }), side: THREE.DoubleSide });
    if (sg.banner) {
      const w = HW * 2 + 2, y = groundH(sg.x, sg.z);
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, 2.2), mat);
      ban.position.set(sg.x, y + 7, sg.z); ban.rotation.y = Math.PI; group.add(ban);
      for (const sgn of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), postM);
        post.position.set(sg.x + sgn * w * 0.3, groundH(sg.x + sgn * w * 0.3, sg.z) + 4, sg.z); post.castShadow = true; group.add(post);
      }
    } else {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.6), mat);
      sign.position.set(sg.x, groundH(sg.x, sg.z) + 3.2, sg.z); sign.rotation.y = Math.PI; group.add(sign);
      const sp = new THREE.Mesh(poleG, postM); sp.position.set(sg.x, groundH(sg.x, sg.z), sg.z); group.add(sp);
    }
  }

  // ---- Start + finish arches (inflatable-style)
  const arch = (z, text, bg, color) => {
    const cx = course.cxMain(z), w = HW * 2 + 2, y = groundH(cx, z);
    const tubeM = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
    for (const sgn of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 9, 12), tubeM);
      post.position.set(cx + sgn * w / 2, groundH(cx + sgn * w / 2, z) + 4.5, z); post.castShadow = true; group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, w, 14), tubeM);
    beam.rotation.z = Math.PI / 2; beam.position.set(cx, y + 9, z); beam.castShadow = true; group.add(beam);
    const tex = textTexture(text, { bg, w: 1024, h: 128, font: 'italic 900 88px system-ui' });
    for (const zz of [z - 1.05, z + 1.05]) {
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, 1.9), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      ban.position.set(cx, y + 9, zz); ban.rotation.y = zz < z ? Math.PI : 0; group.add(ban);
    }
  };
  arch(0, 'DOWNHILL RUSH  ·  START', '#1b3f8f', 0x2b5fd9);
  arch(course.L, 'FINISH', '#c01f3b', 0xe5484d);
  {
    const c = document.createElement('canvas'); c.width = 256; c.height = 32;
    const g = c.getContext('2d');
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 8, j * 8, 8, 8); }
    const t = new THREE.CanvasTexture(c);
    const pg = new THREE.PlaneGeometry(HW * 2, 2, 16, 1);
    const a = pg.attributes.position; const cx = course.cxMain(course.L);
    for (let i = 0; i < a.count; i++) { const lx = a.getX(i), lz = -a.getY(i); a.setXYZ(i, cx + lx, groundH(cx + lx, course.L + lz) + 0.05, course.L + lz); }
    group.add(new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: t })));
  }
  return group;
}

export function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(mm => { if (mm.map) mm.map.dispose(); mm.dispose(); });
  });
}

// ---------------- Riders ----------------
// Chunky, readable characters. FRONT: goggles, chest stripe, bright ski tips / board nose.
// BACK: dark backpack with a white stripe. That makes facing obvious in the air.
const RS = 1.18; // overall rider scale
const mk = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };
function limb(r, len, mat) { // pivot at the top, hangs down along -y
  const g = new THREE.Group(); g.add(mk(new THREE.CapsuleGeometry(r, len, 4, 10), mat, 0, -len / 2 - r * 0.4, 0)); return g;
}

export function makeRider(cls, color, name, ghost = false, hat = null) {
  const root = new THREE.Group();
  const tilt = new THREE.Group(); root.add(tilt);
  const spinG = new THREE.Group(); tilt.add(spinG);
  const inner = new THREE.Group(); spinG.add(inner); inner.scale.setScalar(RS);
  const body = new THREE.Group(); inner.add(body);
  const col = new THREE.Color(color);
  const jacket = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const pants = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.28).lerp(new THREE.Color(0x1a2233), 0.4), roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151a24, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.5 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c6a2, roughness: 0.8 });
  const bright = new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.25), roughness: 0.4, emissive: col.clone().multiplyScalar(0.25) });
  const goggleM = new THREE.MeshStandardMaterial({ color: 0xffa22e, roughness: 0.1, metalness: 0.7, emissive: 0x803000, emissiveIntensity: 0.6 });

  // legs: thigh + shin so knees can bend
  const mkLeg = (x) => {
    const thigh = limb(0.115, 0.3, pants); thigh.position.set(x, 0.86, 0);
    const shin = limb(0.1, 0.28, pants); shin.position.y = -0.4; thigh.add(shin);
    shin.add(mk(new THREE.BoxGeometry(0.2, 0.18, 0.34), dark, 0, -0.42, 0.04)); // boot
    body.add(thigh); return { thigh, shin };
  };
  const legL = mkLeg(-0.14), legR = mkLeg(0.14);

  const hips = new THREE.Group(); hips.position.y = 0.88; body.add(hips);
  hips.add(mk(new THREE.SphereGeometry(0.21, 12, 10), pants, 0, 0.03, 0));
  const torso = mk(new THREE.CapsuleGeometry(0.2, 0.32, 4, 12), jacket, 0, 0.36, 0); torso.scale.set(1.18, 1, 0.92); hips.add(torso);
  hips.add(mk(new THREE.BoxGeometry(0.44, 0.09, 0.02), white, 0, 0.44, 0.19));          // chest stripe (front)
  const pack = mk(new THREE.BoxGeometry(0.3, 0.38, 0.16), dark, 0, 0.4, -0.25); hips.add(pack); // backpack (back)
  pack.add(mk(new THREE.BoxGeometry(0.31, 0.06, 0.17), white, 0, 0.06, 0));
  const head = new THREE.Group(); head.position.y = 0.82; hips.add(head);
  head.add(mk(new THREE.SphereGeometry(0.175, 16, 12), skin, 0, 0, 0));
  const helmet = mk(new THREE.SphereGeometry(0.205, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), jacket, 0, 0.02, -0.01); head.add(helmet);
  const gog = mk(new THREE.BoxGeometry(0.29, 0.1, 0.12), goggleM, 0, 0.03, 0.13); head.add(gog);
  head.add(mk(new THREE.BoxGeometry(0.4, 0.045, 0.34), dark, 0, 0.03, -0.01));             // goggle strap
  const mkArm = (x) => {
    const upper = limb(0.085, 0.24, jacket); upper.position.set(x, 0.56, 0);
    const fore = limb(0.075, 0.22, jacket); fore.position.y = -0.32; upper.add(fore);
    fore.add(mk(new THREE.SphereGeometry(0.09, 10, 8), dark, 0, -0.33, 0));                // mitten
    hips.add(upper); return { upper, fore };
  };
  const armL = mkArm(-0.3), armR = mkArm(0.3);

  let poles = null;
  if (cls === 'ski') {
    for (const sx of [-0.15, 0.15]) {
      inner.add(mk(new THREE.BoxGeometry(0.11, 0.035, 1.5), dark, sx, 0.03, -0.1));
      const tip = mk(new THREE.BoxGeometry(0.11, 0.035, 0.42), bright, sx, 0.07, 0.83); tip.rotation.x = -0.28; inner.add(tip);
    }
    poles = [armL, armR].map((a) => {
      const pg = new THREE.Group(); pg.position.y = -0.33; a.fore.add(pg);
      const geo = new THREE.CylinderGeometry(0.014, 0.014, 1.05, 6); geo.translate(0, -0.5, 0);
      pg.add(mk(geo, dark)); pg.add(mk(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8), bright, 0, -0.98, 0));
      return pg;
    });
  } else {
    const deck = mk(new THREE.CapsuleGeometry(0.15, 1.2, 4, 12), dark, 0, 0.04, 0);
    deck.rotation.x = Math.PI / 2; deck.scale.set(1.3, 1, 0.2); inner.add(deck);
    const nose = mk(new THREE.CapsuleGeometry(0.152, 0.34, 4, 12), bright, 0, 0.045, 0.5);
    nose.rotation.x = Math.PI / 2; nose.scale.set(1.3, 1, 0.22); inner.add(nose);       // bright nose = forward
    body.rotation.y = Math.PI / 2 - 0.25; // stands sideways, shoulders slightly open
    legL.thigh.position.x = -0.24; legR.thigh.position.x = 0.24;
  }
  // shield bubble (items)
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 12), new THREE.MeshBasicMaterial({ color: 0x35c6ff, transparent: true, opacity: 0.2, depthWrite: false }));
  shield.position.y = 1.0; shield.visible = false; inner.add(shield);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0x0a1a33, transparent: true, opacity: 0.2, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  if (ghost) {
    root.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.32; o.material.depthWrite = false; o.castShadow = false; } });
    shadow.visible = false;
  }
  if (name) {
    const tex = textTexture(name.slice(0, 14), { w: 256, h: 64, bg: null, fg: '#fff', font: 'bold 34px system-ui' });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false }));
    sp.scale.set(0.13, 0.0325, 1); sp.position.y = 2.8; root.add(sp);
  }
  if (hat && hat !== 'none' && !ghost) { const h = buildHat(hat, color); h.scale.setScalar(0.5); h.position.set(0, 0.19, -0.01); head.add(h); }   // party hat: you look like you everywhere
  return { root, tilt, spinG, inner, body, hips, head, armL, armR, legL, legR, poles, shield, shadow, cls, pitch: 0, crouch: 0, ghost };
}

// Arm targets: [upper.x, upper.z, fore.x]  (negative x = forward)
const GRAB_POSE = [null,
  { arm: 'R', a: [-0.5, 0.25, -0.9], crouch: 1.0, twist: 0.0, lean: 0.35 },   // Indy / Safety
  { arm: 'L', a: [0.9, -0.5, 0.6], crouch: 0.75, twist: 0.55, lean: -0.3 },   // Method / Japan (arched back)
  { arm: 'L', a: [-0.5, -0.25, -0.9], crouch: 1.0, twist: 0.0, lean: 0.35 },  // Melon / Mute
  { arm: 'R', a: [1.0, 0.3, 0.3], crouch: 0.9, twist: -0.4, lean: -0.1 },     // Tail
  { arm: 'L', a: [-1.5, -0.2, -0.4], crouch: 0.9, twist: 0.35, lean: 0.6 },   // Nose / Truck Driver
  { arm: 'R', a: [0.7, 0.45, 0.9], crouch: 1.0, twist: -0.6, lean: -0.25 },   // Stalefish / Critical
];
const damp = (obj, key, target, k) => { obj[key] += (target - obj[key]) * k; };

// slope = terrain drop per metre along the heading (positive = downhill)
export function poseRider(r, e, groundY, t, slope = 0, dt = 0.016, off = null) {
  r.root.position.set(e.x + (off ? off.x : 0), e.y + (off ? off.y : 0), e.z + (off ? off.z : 0));
  r.root.rotation.set(0, e.h, 0);
  const grind = e.grind >= 0;
  const targetPitch = e.air || grind || e.state === 'wipe' ? 0 : Math.atan(slope);
  r.pitch += (targetPitch - r.pitch) * Math.min(1, dt * 10);
  const lean = (e.air ? 0 : (e.lean || 0)) * 0.55 * Math.min(1, (e.v || 0) / 18) + (e.hitT > 0 ? Math.sin(t * 30) * 0.35 : 0);
  r.tilt.rotation.set(r.pitch, 0, lean, 'YXZ');
  const butter = e.butterT > 0 ? (e.butterT / 0.35) * Math.PI : 0;
  r.spinG.rotation.set(0, (e.stance || 0) + (e.spin || 0) + (e.slideAng || 0) + butter, 0);
  r.inner.rotation.set(e.flip || 0, 0, 0);
  const g = GRAB_POSE[e.grab || 0];
  const targetCrouch = g ? g.crouch : e.tuck ? 0.8 : e.air ? 0.4 : grind ? 0.45 : 0.22 + Math.abs(e.lean || 0) * 0.25;
  const k = Math.min(1, dt * 12);
  r.crouch += (targetCrouch - r.crouch) * k;
  const c = r.crouch;
  // knees bend, hips drop, torso leans forward
  const knee = c * 1.15;
  const hipY = 0.91 * Math.cos(knee * 0.75) - 0.05;
  for (const L of [r.legL, r.legR]) { L.thigh.rotation.x = -knee * 0.75; L.shin.rotation.x = knee * 1.5; L.thigh.position.y = hipY; }
  r.hips.position.y = hipY + 0.02; r.hips.position.z = -c * 0.06;
  damp(r.hips.rotation, 'x', c * 0.75 + (g ? g.lean : 0), k); damp(r.hips.rotation, 'y', g ? g.twist : 0, k);
  r.head.rotation.x = -c * 0.5;
  // arms
  let L = [-0.45, -0.22, -0.55], R = [-0.45, 0.22, -0.55];               // relaxed: hands forward and low
  if (e.tuck && !g) { L = [-1.35, 0.25, -0.5]; R = [-1.35, -0.25, -0.5]; }  // tuck: fists together in front
  else if (e.air && !g) { L = [-0.2, -0.9, -0.3]; R = [-0.2, 0.9, -0.3]; }  // air: arms out for balance
  if (e.state === 'wipe') { L = [-2.6, -1, 0]; R = [-2.2, 1, 0]; }
  if (g) { if (g.arm === 'R') { R = g.a; L = [-0.3, -1.2, -0.2]; } else { L = g.a; R = [-0.3, 1.2, -0.2]; } }
  const ka = Math.min(1, dt * 14);
  damp(r.armL.upper.rotation, 'x', L[0], ka); damp(r.armL.upper.rotation, 'z', L[1], ka); damp(r.armL.fore.rotation, 'x', L[2], ka);
  damp(r.armR.upper.rotation, 'x', R[0], ka); damp(r.armR.upper.rotation, 'z', R[1], ka); damp(r.armR.fore.rotation, 'x', R[2], ka);
  if (r.poles) { // poles trail behind the hands at a steady angle whatever the arms do
    const want = e.tuck ? 1.45 : e.air ? 1.25 : 1.0;
    r.poles[0].rotation.x = want - (r.armL.upper.rotation.x + r.armL.fore.rotation.x) - r.hips.rotation.x;
    r.poles[1].rotation.x = want - (r.armR.upper.rotation.x + r.armR.fore.rotation.x) - r.hips.rotation.x;
    r.poles[0].rotation.z = -r.armL.upper.rotation.z; r.poles[1].rotation.z = -r.armR.upper.rotation.z;
  }
  r.shield.visible = e.shieldT > 0 && !r.ghost;
  if (r.shield.visible) r.shield.scale.setScalar(1 + Math.sin(t * 6) * 0.04);
  r.shadow.position.set(e.x + (off ? off.x : 0), groundY + 0.06, e.z + (off ? off.z : 0));
  const hgt = Math.max(0, e.y - groundY);
  r.shadow.scale.setScalar(Math.max(0.3, 1 - hgt * 0.08));
  r.root.visible = !(e.ghostT > 0 && Math.floor(t * 10) % 2 === 0);
}

// ---------------- Air guide: which way you face vs. which way you're travelling ----------------
export class AirGuide {
  constructor(scene) {
    const g = new THREE.Group(); g.visible = false; g.renderOrder = 5; scene.add(g); this.group = g;
    const flat = (pts, color, op) => {
      const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) sh.lineTo(p[0], p[1]);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = Math.PI / 2; m.renderOrder = 5; return m; // shape y -> world +z
    };
    // travel direction: long thin white track; good-landing wedges (forward + switch)
    this.travel = new THREE.Group(); g.add(this.travel);
    this.travel.add(flat([[-0.12, 0.6], [0.12, 0.6], [0.12, 5], [0.32, 5], [0, 5.9], [-0.32, 5], [-0.12, 5]], 0xffffff, 0.55));
    this.travel.add(flat([[-0.12, -0.6], [0.12, -0.6], [0.12, -3], [-0.12, -3]], 0xffffff, 0.25));
    // facing arrow (rotates with your body); colour = what the landing would be right now
    this.face = flat([[-0.5, 0.2], [0.5, 0.2], [0.5, 2.2], [1.0, 2.2], [0, 3.6], [-1.0, 2.2], [-0.5, 2.2]], 0xffffff, 0.85);
    this.faceHold = new THREE.Group(); this.faceHold.add(this.face); g.add(this.faceHold);
    this.faceHold.scale.setScalar(0.62); this.travel.scale.setScalar(0.8);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.9, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = Math.PI / 2; this.ring.renderOrder = 5; g.add(this.ring);
  }
  update(show, x, groundY, z, h, facing, q) {
    this.group.visible = show; if (!show) return;
    this.group.position.set(x, groundY + 0.25, z);
    this.travel.rotation.y = h; this.faceHold.rotation.y = facing;
    const c = q < 0 ? 0xff4d5e : q > 0.85 ? 0x4dff9a : q > 0.5 ? 0xb8ff5c : 0xffc94d;
    this.face.material.color.set(c); this.ring.material.color.set(c);
  }
}

// ---------------- Party items: boxes on the course + snowballs ----------------
export function buildItemBoxes(course) {
  const n = course.items.length; if (!n) return null;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 64, 64); gr.addColorStop(0, '#ff5ad1'); gr.addColorStop(0.5, '#ffd23f'); gr.addColorStop(1, '#3ee6ff'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff'; g.font = '900 48px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 32, 35);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.7, roughness: 0.3, transparent: true, opacity: 0.92 }), n);
  im.userData.items = course.items; im.frustumCulled = false;
  return im;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
export function spinItemBoxes(im, t) {
  if (!im) return;
  im.userData.items.forEach((it, i) => {
    _q.setFromEuler(_e.set(t * 1.3 + i, t * 1.9 + i * 2, 0));
    _m.compose(_p.set(it.x, it.y + Math.sin(t * 2 + i) * 0.15, it.z), _q, _s); im.setMatrixAt(i, _m);
  });
  im.instanceMatrix.needsUpdate = true;
}
export class Snowballs {
  constructor(scene, n = 16) {
    this.meshes = [];
    const geo = new THREE.IcosahedronGeometry(0.4, 1), mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fdcff, emissiveIntensity: 0.5, roughness: 0.6 });
    for (let i = 0; i < n; i++) { const m = new THREE.Mesh(geo, mat); m.visible = false; m.castShadow = true; scene.add(m); this.meshes.push(m); }
  }
  update(list, t) {
    this.meshes.forEach((m, i) => { const p = list[i]; m.visible = !!p; if (p) { m.position.set(p[0], p[1], p[2]); m.rotation.set(t * 9, t * 7, 0); } });
  }
}

// ---------------- Snow spray particles ----------------
export class Spray {
  constructor(scene, max = 900) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.life = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo = g;
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const gg = c.getContext('2d'); const grd = gg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    gg.fillStyle = grd; gg.fillRect(0, 0, 32, 32);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.9, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;
  }
  emit(x, y, z, vx, vy, vz, spread, count) {
    for (let i = 0; i < count; i++) {
      const k = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      this.pos[k * 3] = x + (Math.random() - 0.5) * 0.6; this.pos[k * 3 + 1] = y + 0.1; this.pos[k * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
      this.vel[k * 3] = vx + (Math.random() - 0.5) * spread; this.vel[k * 3 + 1] = vy + Math.random() * spread * 0.6; this.vel[k * 3 + 2] = vz + (Math.random() - 0.5) * spread;
      this.life[k] = 0.5 + Math.random() * 0.5;
    }
  }
  update(dt) {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -1e5; continue; }
      this.life[k] -= dt;
      const d = Math.exp(-2.5 * dt);
      this.vel[k * 3] *= d; this.vel[k * 3 + 2] *= d; this.vel[k * 3 + 1] -= 9 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
  clear() { this.life.fill(0); }
}

// ---------------- Minimap (2D canvas) ----------------
export function makeMinimap(course, w, h) {
  const bg = document.createElement('canvas'); bg.width = w; bg.height = h;
  const g = bg.getContext('2d');
  const pad = 10, zMin = -20, zMax = course.L + 30;
  let xMin = 1e9, xMax = -1e9;
  for (let z = zMin; z < zMax; z += 10) { for (const x of [course.cxMain(z), course.cxBase(z)]) { xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); } }
  xMin -= 25; xMax += 25;
  const sx = (x) => pad + (x - xMin) / (xMax - xMin) * (w - 2 * pad);
  const sy = (z) => pad + (z - zMin) / (zMax - zMin) * (h - 2 * pad);
  g.fillStyle = 'rgba(10,20,40,0.55)'; g.fillRect(0, 0, w, h);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const path = (fx, z0, z1, color, width) => {
    g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    for (let z = z0; z <= z1; z += 8) { const X = sx(fx(z)), Y = sy(z); z === z0 ? g.moveTo(X, Y) : g.lineTo(X, Y); }
    g.stroke();
  };
  path(course.cxMain, 0, course.L, '#e8f0ff', 5);
  for (const s of course.shortcuts) path(course.cxBase, s.z0, s.z0 + s.len, '#ffd400', 2.5);
  const secCol = { halfpipe: '#20d0d0', rollers: '#ff9a4a', jumpline: '#ff3d7f', rails: '#a98bff', moguls: '#6fa8ff', cliff: '#222831', trees: '#3fbf6f', pitch: '#ff5b5b' };
  for (const sct of course.sections) if (secCol[sct.type]) path(course.cxMain, sct.z0, sct.z0 + sct.len, secCol[sct.type], 5);
  g.fillStyle = '#ff4d6d'; g.fillRect(sx(course.cxMain(course.L)) - 8, sy(course.L) - 2, 16, 4);
  return {
    draw(ctx, dots) {
      ctx.clearRect(0, 0, w, h); ctx.drawImage(bg, 0, 0);
      for (const d of dots) {
        ctx.fillStyle = d.color; ctx.globalAlpha = d.alpha ?? 1;
        ctx.beginPath(); ctx.arc(sx(d.x), sy(d.z), d.me ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
        if (d.me) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    },
  };
}
