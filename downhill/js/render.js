import * as THREE from 'three';
import { HW_MAIN } from './course.js';

export const COLORS = [0xff4d4d, 0x3e9bff, 0x30c46c, 0xffb020, 0xb44dff, 0xff6fd0, 0x20d0d0, 0xf0f0f0];

const HORIZON = 0xd6e6f5;

// ---------------- Renderer, sky, lights, backdrop ----------------
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 120, 520);
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 2600);

  // gradient sky dome with a soft sun glow
  const sunDir = new THREE.Vector3(-0.45, 0.55, 0.7).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4f8ad8) }, mid: { value: new THREE.Color(0xa5c8ec) }, bottom: { value: new THREE.Color(HORIZON) }, sun: { value: sunDir } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sun; varying vec3 vDir;
      void main(){ float h = vDir.y; vec3 c = mix(bottom, mid, smoothstep(-0.02, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
        float s = max(dot(normalize(vDir), sun), 0.0); c += vec3(1.0,0.95,0.8) * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -10;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xd8ecff, 0x8ea3bd, 1.25));
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
  scene.add(backdrop);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  });
  let quality = 'high';
  const env = {
    get quality() { return quality; },
    setQuality(qv) {
      quality = qv;
      const hi = qv === 'high';
      renderer.shadowMap.enabled = hi; sun.castShadow = hi;
      renderer.setPixelRatio(hi ? Math.min(window.devicePixelRatio, 1.5) : 1);
      renderer.setSize(window.innerWidth, window.innerHeight);
      scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
    },
    // keep the sun's shadow box and the backdrop centred on what the camera is looking at
    follow(x, y, z) {
      sun.position.set(x + sunDir.x * 150, y + sunDir.y * 150, z + sunDir.z * 150);
      sun.target.position.set(x, y, z);
      backdrop.position.set(camera.position.x, camera.position.y - 160, camera.position.z);
      sky.position.copy(camera.position);
    },
  };
  return { renderer, scene, camera, env };
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
      if (info.pipe) { const k = Math.min(1, Math.abs(x - course.cxMain(z)) / HW_MAIN); cr = 0.9 - 0.12 * k; cg = 0.97 - 0.04 * k; cb = 1.0; }
      else if (info.groomed) {
        const edge = Math.max(0, 1 - Math.abs(Math.abs(x - course.cxMain(z)) - HW_MAIN) / 2.5); // darker edge line
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
    fol.setColorAt(i, cc.setHSL(0.36 + k * 0.06, 0.45 + k * 0.15, 0.2 + k * 0.08));
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

  // ---- Kickers: packed-snow ramps with a coloured lip and side walls
  const rampMat = new THREE.MeshStandardMaterial({ color: 0xe8f1ff, roughness: 0.7, side: THREE.DoubleSide });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x3f7fd9, roughness: 0.8, side: THREE.DoubleSide });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6, side: THREE.DoubleSide });
  for (const r of course.ramps) {
    const nx = 6, nz = 12, pp = [], ii = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = r.x - r.w / 2 + (r.w * i) / nx, z = r.z0 + (r.len * j) / nz - (j === nz ? 0.01 : 0);
      pp.push(x, groundH(x, z) + 0.05, z);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i; ii.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
    g.setIndex(ii); g.computeVertexNormals();
    const top = new THREE.Mesh(g, rampMat); top.receiveShadow = true; top.castShadow = true; group.add(top);
    // side walls + lip face
    const quads = [], qm = [];
    const base = (x, z) => course.baseH(z) + 0.45 * Math.sin(x * 0.11 + z * 0.05) * Math.sin(z * 0.07 - x * 0.03) - 0.3;
    for (const sx of [-r.w / 2, r.w / 2]) for (let j = 0; j < nz; j++) {
      const x = r.x + sx, za = r.z0 + (r.len * j) / nz, zb = r.z0 + (r.len * (j + 1)) / nz - 0.01;
      quads.push([x, groundH(x - Math.sign(sx) * 0.01, za), za], [x, groundH(x - Math.sign(sx) * 0.01, zb), zb], [x, base(x, zb), zb], [x, base(x, za), za]);
    }
    const zl = r.z0 + r.len - 0.01;
    for (let i = 0; i < nx; i++) {
      const xa = r.x - r.w / 2 + (r.w * i) / nx, xb = r.x - r.w / 2 + (r.w * (i + 1)) / nx;
      qm.push([xa, groundH(xa, zl), zl], [xb, groundH(xb, zl), zl], [xb, base(xb, zl), zl], [xa, base(xa, zl), zl]);
    }
    const quadGeo = (list) => {
      const arr = [];
      for (let k = 0; k < list.length; k += 4) { const [a, b, c, d] = list.slice(k, k + 4); arr.push(...a, ...b, ...c, ...a, ...c, ...d); }
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); gg.computeVertexNormals(); return gg;
    };
    group.add(new THREE.Mesh(quadGeo(quads), sideMat), new THREE.Mesh(quadGeo(qm), sideMat));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(r.w + 0.1, 0.18, 0.35), lipMat);
    edge.position.set(r.x, groundH(r.x, zl) + 0.06, zl - 0.15);
    edge.rotation.x = -Math.atan(1.25 * r.h / r.len);
    group.add(edge);
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
      const w = HW_MAIN * 2 + 2, y = groundH(sg.x, sg.z);
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
    const cx = course.cxMain(z), w = HW_MAIN * 2 + 2, y = groundH(cx, z);
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
    const pg = new THREE.PlaneGeometry(HW_MAIN * 2, 2, 16, 1);
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
const capsule = (r, len, mat) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat); m.castShadow = true; return m; };
function limb(r, len, mat) {
  // pivot at the top, hangs down along -y
  const g = new THREE.Group(); const c = capsule(r, len, mat); c.position.y = -len / 2 - r * 0.5; g.add(c); return g;
}

export function makeRider(cls, color, name, ghost = false) {
  const root = new THREE.Group();
  const tilt = new THREE.Group(); root.add(tilt);
  const spinG = new THREE.Group(); tilt.add(spinG);
  const inner = new THREE.Group(); spinG.add(inner);
  const body = new THREE.Group(); inner.add(body);
  const jacket = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const pantsC = new THREE.Color(color).multiplyScalar(0.35);
  const pants = new THREE.MeshStandardMaterial({ color: pantsC, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf0c4a0, roughness: 0.8 });
  const helmetM = new THREE.MeshStandardMaterial({ color: 0xf5f7fb, roughness: 0.35 });
  const goggleM = new THREE.MeshStandardMaterial({ color: 0xff9a2e, roughness: 0.15, metalness: 0.6, emissive: 0x6a2a00, emissiveIntensity: 0.4 });

  // hips group bends for tuck / grabs
  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  const legL = limb(0.12, 0.62, pants), legR = limb(0.12, 0.62, pants);
  legL.position.set(-0.13, 0, 0); legR.position.set(0.13, 0, 0);
  body.add(legL, legR); legL.position.y = legR.position.y = 0.92;
  const torso = capsule(0.22, 0.42, jacket); torso.position.y = 0.32; hips.add(torso);
  const head = new THREE.Group(); head.position.y = 0.86; hips.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), skin); face.castShadow = true; head.add(face);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), helmetM); helmet.position.y = 0.02; head.add(helmet);
  const goggles = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.09, 14, 1, true, -1.1, 2.2), goggleM);
  goggles.position.y = 0.0; goggles.rotation.y = 0; head.add(goggles);
  const armL = limb(0.08, 0.48, jacket), armR = limb(0.08, 0.48, jacket);
  armL.position.set(-0.28, 0.55, 0); armR.position.set(0.28, 0.55, 0);
  hips.add(armL, armR);
  for (const a of [armL, armR]) { const glove = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), dark); glove.position.y = -0.68; a.add(glove); }

  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), roughness: 0.4 });
  if (cls === 'ski') {
    for (const sx of [-0.14, 0.14]) {
      const ski = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.04, 1.75), accent); ski.position.set(sx, 0.03, 0.05); ski.castShadow = true; inner.add(ski);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.04, 0.25), accent); tip.position.set(sx, 0.08, 0.98); tip.rotation.x = -0.5; inner.add(tip);
    }
    for (const a of [armL, armR]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.15), dark); pole.position.set(0, -0.68, -0.35); pole.rotation.x = -1.1; a.add(pole);
    }
  } else {
    const board = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 1.25, 4, 10), accent);
    board.rotation.x = Math.PI / 2; board.scale.set(1.25, 1, 0.22); board.position.y = 0.04; board.castShadow = true; inner.add(board);
    body.rotation.y = Math.PI / 2; // stands sideways on the board
    legL.position.x = -0.2; legR.position.x = 0.2;
  }
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16), new THREE.MeshBasicMaterial({ color: 0x0a1a33, transparent: true, opacity: 0.18, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  if (ghost) {
    root.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.32; o.material.depthWrite = false; o.castShadow = false; } });
    shadow.visible = false;
  }
  if (name) {
    const tex = textTexture(name.slice(0, 14), { w: 256, h: 64, bg: null, fg: '#fff', font: 'bold 34px system-ui' });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false }));
    sp.scale.set(0.13, 0.0325, 1); sp.position.y = 2.45; root.add(sp);
  }
  return { root, tilt, spinG, inner, body, hips, armL, armR, legL, legR, shadow, cls, pitch: 0, crouch: 0 };
}

// Grab poses: which arm reaches where (x = forward/back on the board, side = which hand)
const GRAB_POSE = [null,
  { arm: 'R', rx: 0.9, rz: 0.35, crouch: 1.0, hipTwist: 0.0 },   // Indy / Safety: back hand to toes
  { arm: 'L', rx: -0.7, rz: -0.6, crouch: 0.8, hipTwist: 0.5 },  // Method / Japan: arch back
  { arm: 'L', rx: 0.9, rz: -0.35, crouch: 1.0, hipTwist: 0.0 },  // Melon / Mute: front hand
  { arm: 'R', rx: -1.1, rz: 0.2, crouch: 0.9, hipTwist: -0.3 },  // Tail
];

// slope = terrain drop per metre along the heading (positive = downhill)
export function poseRider(r, e, groundY, t, slope = 0, dt = 0.016, off = null) {
  r.root.position.set(e.x + (off ? off.x : 0), e.y + (off ? off.y : 0), e.z + (off ? off.z : 0));
  r.root.rotation.set(0, e.h, 0);
  const targetPitch = e.air || e.state === 'wipe' ? 0 : Math.atan(slope);
  r.pitch += (targetPitch - r.pitch) * Math.min(1, dt * 10);
  const lean = (e.air ? 0 : (e.lean || 0)) * 0.55 * Math.min(1, (e.v || 0) / 18);
  r.tilt.rotation.set(r.pitch, 0, lean, 'YXZ');
  r.spinG.rotation.set(0, (e.stance || 0) + (e.spin || 0), 0);
  r.inner.rotation.set(e.flip || 0, 0, 0);
  const g = GRAB_POSE[e.grab || 0];
  const targetCrouch = g ? g.crouch : e.tuck ? 0.65 : e.air ? 0.35 : 0.15;
  r.crouch += (targetCrouch - r.crouch) * Math.min(1, dt * 12);
  const c = r.crouch;
  r.hips.position.y = 0.95 - c * 0.38;
  r.hips.rotation.set(c * 0.55, g ? g.hipTwist : 0, 0);
  r.legL.position.y = r.legR.position.y = 0.92 - c * 0.3;
  r.legL.rotation.x = r.legR.rotation.x = -c * 0.5;
  r.legL.scale.y = r.legR.scale.y = 1 - c * 0.25;
  // arms: relaxed, tucked forward, or grabbing
  let lx = 0.25 + c * 0.6, lz = -0.25, rx = 0.25 + c * 0.6, rz = 0.25;
  if (e.state === 'wipe') { lx = -2.5; rx = -2.2; lz = -1; rz = 1; }
  if (g) { if (g.arm === 'R') { rx = g.rx + 0.6; rz = g.rz; } else { lx = g.rx + 0.6; lz = g.rz; } }
  const k = Math.min(1, dt * 14);
  r.armL.rotation.x += (lx - r.armL.rotation.x) * k; r.armL.rotation.z += (lz - r.armL.rotation.z) * k;
  r.armR.rotation.x += (rx - r.armR.rotation.x) * k; r.armR.rotation.z += (rz - r.armR.rotation.z) * k;
  r.shadow.position.set(e.x + (off ? off.x : 0), groundY + 0.06, e.z + (off ? off.z : 0));
  const hgt = Math.max(0, e.y - groundY);
  r.shadow.scale.setScalar(Math.max(0.3, 1 - hgt * 0.08));
  r.root.visible = !(e.ghostT > 0 && Math.floor(t * 10) % 2 === 0);
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
  path(course.cxMain, course.halfpipe.z0, course.halfpipe.z0 + course.halfpipe.len, '#20d0d0', 5);
  for (const r of course.rollers) path(course.cxMain, r.z0, r.z0 + r.len, '#ff9a4a', 5);
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
