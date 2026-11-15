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
  const step = 3, W = 210, cols = 110;
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
      const u = -1 + (2 * c) / cols, x = cx + W * (0.35 * u + 0.65 * u * u * u); // denser near the runs
      const y = groundH(x, z);
      pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
      const info = course.corridor(x, z);
      let cr, cg, cb;
      if (info.pipe) { const k = Math.min(1, Math.abs(x - course.cxMain(z)) / HW_MAIN); cr = 0.86 - 0.1 * k; cg = 0.96; cb = 1.0; }
      else if (info.groomed) { const stripe = (Math.floor(z / 6) % 2) ? 0.0 : 0.02; cr = 0.94 - stripe; cg = 0.96 - stripe; cb = 1.0; }
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
  // Shortcut flags + section signs
  const yMat = new THREE.MeshLambertMaterial({ color: 0xffd400, side: THREE.DoubleSide });
  for (const f of course.flags) {
    const pole = new THREE.Mesh(poleG, yMat); pole.position.set(f.x, groundH(f.x, f.z), f.z); group.add(pole);
  }
  const postM = new THREE.MeshLambertMaterial({ color: 0x222831 });
  for (const sg of course.signs) {
    const mat = new THREE.MeshBasicMaterial({ map: textTexture(sg.text, { bg: sg.bg, fg: sg.fg }), side: THREE.DoubleSide });
    if (sg.banner) {
      const w = HW_MAIN * 2 + 2, y = groundH(sg.x, sg.z);
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, 2.2), mat);
      ban.position.set(sg.x, y + 7, sg.z); ban.rotation.y = Math.PI; group.add(ban);
      for (const sgn of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), postM);
        post.position.set(sg.x + sgn * w * 0.3, groundH(sg.x + sgn * w * 0.3, sg.z) + 4, sg.z); group.add(post);
      }
    } else {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.6), mat);
      sign.position.set(sg.x, groundH(sg.x, sg.z) + 3.2, sg.z); sign.rotation.y = Math.PI; group.add(sign);
      const sp = new THREE.Mesh(poleG, postM); sp.position.set(sg.x, groundH(sg.x, sg.z), sg.z); group.add(sp);
    }
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

export function makeRider(cls, color, name, ghost = false) {
  const root = new THREE.Group();
  const tilt = new THREE.Group(); root.add(tilt);
  const spinG = new THREE.Group(); tilt.add(spinG);
  const inner = new THREE.Group(); spinG.add(inner);
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
  if (ghost) {
    root.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; } });
    shadow.visible = false;
  }
  if (name) {
    const tex = textTexture(name.slice(0, 12), { w: 256, h: 64, bg: null, fg: '#fff', font: 'bold 40px system-ui' });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(2.2, 0.55, 1); sp.position.y = 2.5; root.add(sp);
  }
  return { root, tilt, spinG, inner, body, shadow, cls, pitch: 0 };
}

// Place a rider mesh from an entity-like state
// slope = terrain drop per metre along the heading (positive = downhill)
export function poseRider(r, e, groundY, t, slope = 0, dt = 0.016, off = null) {
  r.root.position.set(e.x + (off ? off.x : 0), e.y + (off ? off.y : 0), e.z + (off ? off.z : 0));
  r.root.rotation.set(0, e.h, 0);
  const targetPitch = e.air || e.state === 'wipe' ? 0 : Math.atan(slope);
  r.pitch += (targetPitch - r.pitch) * Math.min(1, dt * 10);
  const lean = (e.air ? 0 : (e.lean || 0)) * 0.5 * Math.min(1, (e.v || 0) / 18);
  r.tilt.rotation.set(r.pitch, 0, lean, 'YXZ');
  r.spinG.rotation.set(0, e.spin || 0, 0);
  r.inner.rotation.set(e.flip || 0, 0, 0);
  r.body.scale.y = e.tuck ? 0.72 : 1;
  r.shadow.position.set(e.x, groundY + 0.06, e.z);
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
