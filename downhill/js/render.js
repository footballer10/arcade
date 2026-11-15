import * as THREE from 'three';
import { HW_MAIN } from './course.js';

export const COLORS = [0xff4d4d, 0x3e9bff, 0x30c46c, 0xffb020, 0xb44dff, 0xff6fd0, 0x20d0d0, 0xf0f0f0];

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9cc8f0);
  scene.fog = new THREE.Fog(0x9cc8f0, 90, 420);
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 800);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x8a9ab0, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-60, 120, -40);
  scene.add(sun);
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  });
  return { renderer, scene, camera };
}

function textTexture(text, { w = 512, h = 128, bg = '#123', fg = '#fff', font = 'bold 72px system-ui' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCourse(course) {
  const group = new THREE.Group();
  const { groundH } = course;

  // Terrain strip that follows the course
  const step = 3, W = 210, cols = 84;
  const z0 = -60, z1 = course.L + 260;
  const rows = Math.ceil((z1 - z0) / step) + 1;
  const pos = new Float32Array(rows * (cols + 1) * 3);
  const col = new Float32Array(rows * (cols + 1) * 3);
  const idx = [];
  let p = 0;
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * step;
    const cx = (course.cxBase(z) + course.cxMain(z)) / 2;
    for (let c = 0; c <= cols; c++) {
      const x = cx - W + (2 * W * c) / cols;
      const y = groundH(x, z);
      pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
      const info = course.corridor(x, z);
      let cr, cg, cb;
      if (info.groomed) { const stripe = (Math.floor(z / 6) % 2) ? 0.0 : 0.02; cr = 0.94 - stripe; cg = 0.96 - stripe; cb = 1.0; }
      else if (info.shortcut) { cr = 0.98; cg = 0.95; cb = 0.85; }
      else { const k = Math.min(1, info.d / 40); cr = 0.86 - 0.25 * k; cg = 0.9 - 0.2 * k; cb = 0.98 - 0.1 * k; }
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
  geo.setIndex(idx); geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

  // Trees (instanced)
  const trees = [...course.forest, ...course.obstacles.filter(o => o.type === 'tree')];
  const coneG = new THREE.ConeGeometry(1.7, 6.5, 7); coneG.translate(0, 5.2, 0);
  const trunkG = new THREE.CylinderGeometry(0.35, 0.45, 2.2, 5); trunkG.translate(0, 1.1, 0);
  const cones = new THREE.InstancedMesh(coneG, new THREE.MeshLambertMaterial({ color: 0x2f6b45 }), trees.length);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x5a3b26 }), trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  trees.forEach((t, i) => {
    const sc = t.s || 1.1;
    m.compose(v.set(t.x, groundH(t.x, t.z) - 0.2, t.z), q, s.set(sc, sc, sc));
    cones.setMatrixAt(i, m); trunks.setMatrixAt(i, m);
  });
  group.add(cones, trunks);

  // Rocks
  const rocks = course.obstacles.filter(o => o.type === 'rock');
  const rockG = new THREE.DodecahedronGeometry(1, 0);
  const rockM = new THREE.InstancedMesh(rockG, new THREE.MeshLambertMaterial({ color: 0x6d7480, flatShading: true }), Math.max(1, rocks.length));
  rocks.forEach((r, i) => {
    q.setFromEuler(new THREE.Euler(r.x, r.z, 0));
    m.compose(v.set(r.x, groundH(r.x, r.z) + r.h * 0.3, r.z), q, s.set(r.r, r.h * 0.75, r.r));
    rockM.setMatrixAt(i, m);
  });
  rockM.count = rocks.length;
  group.add(rockM);

  // Ramps: small grid that follows the analytic ramp surface
  const rampMat = new THREE.MeshLambertMaterial({ color: 0x5ab0ff, side: THREE.DoubleSide });
  const lipMat = new THREE.MeshLambertMaterial({ color: 0xff7a1a, side: THREE.DoubleSide });
  for (const r of course.ramps) {
    const nx = 6, nz = 10, pp = [], ii = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = r.x - r.w / 2 + (r.w * i) / nx, z = r.z0 + (r.len * j) / nz - (j === nz ? 0.01 : 0);
      pp.push(x, groundH(x, z) + 0.06, z);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i; ii.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
    g.setIndex(ii); g.computeVertexNormals();
    group.add(new THREE.Mesh(g, rampMat));
    // lip face (vertical drop)
    const zl = r.z0 + r.len - 0.01, ztop = (x) => groundH(x, zl) + 0.06;
    const lp = [], li = [];
    for (let i = 0; i <= nx; i++) { const x = r.x - r.w / 2 + (r.w * i) / nx; lp.push(x, ztop(x), zl, x, course.groundH(x, zl + 0.3) - 0.2, zl + 0.02); }
    for (let i = 0; i < nx; i++) { const a = i * 2; li.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setIndex(li); lg.computeVertexNormals();
    group.add(new THREE.Mesh(lg, lipMat));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.15, 0.3), lipMat);
    edge.position.set(r.x, groundH(r.x, zl) + 0.1, zl - 0.1);
    group.add(edge);
  }

  // Boost pads
  const padTex = textTexture('>>>', { w: 256, h: 128, bg: '#00d8ff', fg: '#ffffff', font: 'bold 90px system-ui' });
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, opacity: 0.9 });
  for (const pd of course.pads) {
    const pg = new THREE.PlaneGeometry(4.4, 6.4, 2, 3);
    const a = pg.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const lx = a.getX(i), lz = -a.getY(i);
      a.setXYZ(i, pd.x + lx, groundH(pd.x + lx, pd.z + lz) + 0.08, pd.z + lz);
    }
    // rotate uv so arrows point downhill
    const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - uv.getY(i), uv.getX(i));
    pg.computeVertexNormals();
    group.add(new THREE.Mesh(pg, padMat));
  }

  // Gates
  const poleG = new THREE.CylinderGeometry(0.08, 0.08, 3.4, 6); poleG.translate(0, 1.7, 0);
  for (const gt of course.gates) {
    const mat = new THREE.MeshLambertMaterial({ color: gt.color, side: THREE.DoubleSide });
    for (const sgn of [-1, 1]) {
      const x = gt.x + sgn * gt.hw, y = groundH(x, gt.z);
      const pole = new THREE.Mesh(poleG, mat); pole.position.set(x, y, gt.z); group.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), mat);
      flag.position.set(x - sgn * 0.75, y + 2.8, gt.z); group.add(flag);
    }
  }
  // Shortcut flags + sign
  const yMat = new THREE.MeshLambertMaterial({ color: 0xffd400, side: THREE.DoubleSide });
  for (const f of course.flags) {
    const pole = new THREE.Mesh(poleG, yMat); pole.position.set(f.x, groundH(f.x, f.z), f.z); group.add(pole);
  }
  {
    const z = course.scZ0 + 40, sx = course.cxBase(z) + Math.sign(course.scB) * 9;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.8),
      new THREE.MeshBasicMaterial({ map: textTexture('SHORTCUT', { bg: '#ffd400', fg: '#111' }), side: THREE.DoubleSide }));
    sign.position.set(sx, groundH(sx, z) + 3.2, z); sign.rotation.y = Math.PI; group.add(sign);
    const sp = new THREE.Mesh(poleG, yMat); sp.position.set(sx, groundH(sx, z), z); group.add(sp);
  }

  // Start + finish arches
  const arch = (z, text, bg) => {
    const cx = course.cxMain(z), w = HW_MAIN * 2 + 2, y = groundH(cx, z);
    const postM = new THREE.MeshLambertMaterial({ color: 0x222831 });
    for (const sgn of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), postM);
      post.position.set(cx + sgn * w / 2, groundH(cx + sgn * w / 2, z) + 4, z); group.add(post);
    }
    const ban = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, 0.3), [postM, postM, postM, postM,
      new THREE.MeshBasicMaterial({ map: textTexture(text, { bg }) }), new THREE.MeshBasicMaterial({ map: textTexture(text, { bg }) })]);
    ban.position.set(cx, y + 8, z); group.add(ban);
  };
  arch(0, 'START', '#1b3f8f');
  arch(course.L, 'FINISH', '#c01f3b');
  // checkered finish line
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

export function makeRider(cls, color, name) {
  const root = new THREE.Group();
  const inner = new THREE.Group(); root.add(inner);
  const body = new THREE.Group(); inner.add(body);
  const suit = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c2230 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xf1c7a0 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.8, 0.3), dark); legs.position.y = 0.5;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.35), suit); torso.position.y = 1.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skin); head.position.y = 1.85;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), suit); helmet.position.y = 1.88;
  body.add(legs, torso, head, helmet);
  if (cls === 'ski') {
    for (const sx of [-0.15, 0.15]) {
      const ski = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 1.9), dark); ski.position.set(sx, 0.05, 0.1); inner.add(ski);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2), dark);
      pole.position.set(sx * 3, 0.8, -0.2); pole.rotation.x = 0.4; body.add(pole);
    }
  } else {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 1.6), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    board.position.y = 0.05; inner.add(board);
    body.rotation.y = Math.PI / 2; // stands sideways
  }
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  if (name) {
    const tex = textTexture(name.slice(0, 12), { w: 256, h: 64, bg: null, fg: '#fff', font: 'bold 40px system-ui' });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(2.2, 0.55, 1); sp.position.y = 2.5; root.add(sp);
  }
  return { root, inner, body, shadow, cls };
}

// Place a rider mesh from an entity-like state
export function poseRider(r, e, groundY, t) {
  r.root.position.set(e.x, e.y, e.z);
  r.root.rotation.set(0, e.h + (e.spin || 0), 0);
  r.inner.rotation.set(e.flip || 0, 0, 0);
  r.body.scale.y = e.tuck ? 0.72 : 1;
  r.shadow.position.set(e.x, groundY + 0.06, e.z);
  const hgt = Math.max(0, e.y - groundY);
  r.shadow.scale.setScalar(Math.max(0.3, 1 - hgt * 0.08));
  r.root.visible = !(e.ghostT > 0 && Math.floor(t * 10) % 2 === 0);
}
