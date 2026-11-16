// Prop Hunt rendering: a cozy roofless "dollhouse" (ceilings only show from below), merged toon geometry with
// ink outlines, decoy objects, players (bean avatar, or the object they became), first-person seekers with a
// squeaky hammer, third-person hiders, particles (poofs, stars, music notes), name tags and the blindfold.
import * as THREE from 'three';
import { Batch, KINDS, kindGeometry, disposeKindCache } from './props.js';
import { CELL, WH, WT, rayWorld } from './level.js';

const INK = 0x17112e;
const GRAD = (() => { const t = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat); t.needsUpdate = true; return t; })();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

function spriteTex(draw, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createView(ctx) {
  const renderer = ctx.three.createRenderer();
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200); camera.rotation.order = 'YXZ';
  scene.add(camera);
  const own = new Set();                         // materials/geometries/textures to dispose at the end
  const M = (m) => { own.add(m); return m; };
  const toonV = M(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: GRAD }));
  const inkMat = M(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
  const hiMat = M(new THREE.MeshBasicMaterial({ color: 0xffe14a, side: THREE.BackSide }));
  const kindCache = new Map();

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xfff1dc, 0x8a6a5a, 1.45); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.1); sun.position.set(14, 26, 9); scene.add(sun); scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xb8c8ff, 0.45); fill.position.set(-10, 12, -14); scene.add(fill);
  function applyQ() {
    const q = ctx.three.applyQuality(renderer, sun);
    sun.castShadow = q.shadows; renderer.shadowMap.enabled = q.shadows;
    return q;
  }
  let Q = applyQ();

  // ---------------------------------------------------------------- level
  let level = null; const levelObjs = []; const decoys = []; let highlighted = -1;
  function clearLevel() {
    for (const o of levelObjs) { o.removeFromParent(); o.geometry?.dispose(); }
    levelObjs.length = 0;
    for (const d of decoys) d.removeFromParent();
    decoys.length = 0; highlighted = -1;
  }
  function buildLevel(L) {
    clearLevel(); level = L;
    const add = (geo, mat, shadow = true) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); levelObjs.push(m); return m; };
    add(L.geo.geo, toonV); const ol = add(L.geo.line, inkMat, false); if (ol) ol.receiveShadow = false;
    L.geo = { geo: null, line: null };             // the view owns these now (disposed with the level)
    // floors + ceilings + ground outside
    const fb = new Batch(0), cb = [];
    for (const r of L.rooms) {
      fb.box(r.x, -0.05, r.z, CELL, 0.1, CELL, r.def.floor);
      // simple pattern: planks / tiles as slightly darker strips
      const dark = new THREE.Color(r.def.floor).multiplyScalar(0.9).getHex();
      if (r.type === 'kitchen' || r.type === 'bath') { for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) if ((i + j) % 2 === 0) fb.box(r.x + i * 1.1, 0.002, r.z + j * 1.1, 1.1, 0.004, 1.1, dark, { out: false }); }
      else for (let i = -4; i <= 4; i++) fb.box(r.x + i * 1.1, 0.002, r.z, 0.03, 0.004, CELL, dark, { out: false });
      const g = new THREE.PlaneGeometry(CELL, CELL); g.rotateX(Math.PI / 2); g.translate(r.x, WH, r.z); cb.push(g);
      // ceiling light disc
      const lg = new THREE.CircleGeometry(0.35, 20); lg.rotateX(Math.PI / 2); lg.translate(r.x, WH - 0.01, r.z); cb.push(lg);
    }
    fb.box(0, -0.12, 0, L.w + 30, 0.1, L.d + 30, 0x7cc76a);
    const f = fb.build(); add(f.geo, toonV, false);
    const ceil = new THREE.Mesh(mergeList(cb), M(new THREE.MeshToonMaterial({ color: 0xfff6e8, gradientMap: GRAD }))); scene.add(ceil); levelObjs.push(ceil);
    for (const g of cb) g.dispose();
    // decoys
    for (const d of L.decoys) {
      const { geo, line } = kindGeometry(kindCache, d.k);
      const m = new THREE.Mesh(geo, toonV); m.castShadow = true; m.receiveShadow = true;
      const l = new THREE.Mesh(line, inkMat); m.add(l); m.userData.line = l;
      m.position.set(d.x, d.y, d.z); m.rotation.y = d.ry; m.userData.base = { y: d.y, ry: d.ry }; m.userData.bounce = 0;
      scene.add(m); decoys.push(m);
    }
    // sun + shadow camera cover the building
    const ext = Math.max(L.w, L.d) / 2 + 2;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 80 });
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.background = new THREE.Color(L.map.sky[1]);
  }
  function mergeList(list) {
    // tiny local merge (planes/circles share attributes)
    let n = 0; for (const g of list) n += (g.index ? g.index.count : g.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
    for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; if (g !== g0) g.dispose(); }
    const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return out;
  }
  function setHighlight(i) {
    if (i === highlighted) return;
    if (highlighted >= 0 && decoys[highlighted]) decoys[highlighted].userData.line.material = inkMat;
    highlighted = i;
    if (i >= 0 && decoys[i]) decoys[i].userData.line.material = hiMat;
  }

  // ---------------------------------------------------------------- players
  const bodies = new Map();
  function hammerGeo(color) {
    const b = new Batch(0.02);
    b.cyl(0, 0.35, 0, 0.035, 0.035, 0.7, color); b.cyl(0, 0.78, 0, 0.17, 0.17, 0.36, 0xff4d6a, { rz: Math.PI / 2, seg: 16 }); b.cyl(0, 0.78, 0, 0.175, 0.175, 0.08, 0xffd23f, { rz: Math.PI / 2, seg: 16 });
    return b.build();
  }
  function bodyFor(p) {
    let B = bodies.get(p.id); if (B) return B;
    const pl = ctx.player(p.id);
    const root = new THREE.Group();
    const av = ctx.avatar.build(pl); av.traverse((o) => { o.castShadow = true; }); root.add(av);
    const hg = hammerGeo(pl.colorHex);
    const hammer = new THREE.Group(); const hm = new THREE.Mesh(hg.geo, toonV); hm.castShadow = true; hammer.add(hm, new THREE.Mesh(hg.line, inkMat));
    hammer.position.set(-0.45, 0.6, 0.15); hammer.rotation.x = 0.5; av.add(hammer);
    const propHolder = new THREE.Group(); root.add(propHolder);
    const colorLine = M(new THREE.MeshBasicMaterial({ color: pl.colorHex, side: THREE.BackSide }));
    scene.add(root);
    const tag = ctx.ui.el('div', 'ph-tag'); tag.style.setProperty('--c', pl.colorCss); tag.textContent = pl.name; ctx.container.appendChild(tag);
    B = { root, av, hammer, hg, propHolder, kind: -2, prop: null, colorLine, tag, swing: 0, faceYaw: 0, hop: Math.random() * 6, pop: 0, lastX: p.x, lastZ: p.z };
    bodies.set(p.id, B); return B;
  }
  function setKind(B, k, mine) {
    if (B.kind === k) return; B.kind = k;
    if (B.prop) { B.prop.removeFromParent(); B.prop = null; }
    if (k >= 0) {
      const { geo, line } = kindGeometry(kindCache, k);
      const m = new THREE.Mesh(geo, toonV); m.castShadow = true; m.receiveShadow = true;
      m.add(new THREE.Mesh(line, mine ? B.colorLine : inkMat));
      B.propHolder.add(m); B.prop = m; B.pop = 1;
    }
  }

  // first-person hammer (seeker view model)
  let vm = null;
  function viewModel(color) {
    if (vm && vm.color === color) return vm;
    if (vm) { vm.g.removeFromParent(); vm.geo.geo.dispose(); vm.geo.line.dispose(); }
    const geo = hammerGeo(color); const g = new THREE.Group();
    const m = new THREE.Mesh(geo.geo, toonV); g.add(m, new THREE.Mesh(geo.line, inkMat));
    g.scale.setScalar(0.42); g.position.set(0.36, -0.42, -0.62); g.rotation.set(-0.45, 0.25, -0.2); camera.add(g);
    vm = { g, geo, color, swing: 0 }; return vm;
  }

  // ---------------------------------------------------------------- particles
  const TEX = {
    puff: spriteTex((g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }),
    star: spriteTex((g, s) => { g.fillStyle = '#fff'; g.strokeStyle = '#17112e'; g.lineWidth = 4; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.2 : s * 0.45, a = (i / 10) * Math.PI * 2 - Math.PI / 2; g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r); } g.closePath(); g.stroke(); g.fill(); }),
    note: spriteTex((g, s) => { g.font = `${s * 0.8}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 5; g.strokeStyle = '#17112e'; g.strokeText('♪', s / 2, s / 2); g.fillStyle = '#fff'; g.fillText('♪', s / 2, s / 2); }),
    x: spriteTex((g, s) => { g.lineCap = 'round'; g.strokeStyle = '#17112e'; g.lineWidth = 16; g.beginPath(); g.moveTo(14, 14); g.lineTo(s - 14, s - 14); g.moveTo(s - 14, 14); g.lineTo(14, s - 14); g.stroke(); g.strokeStyle = '#ff4d5e'; g.lineWidth = 9; g.stroke(); }),
  };
  for (const t of Object.values(TEX)) own.add(t);
  const pool = [];
  function spawn(tex, x, y, z, o = {}) {
    let s = pool.find((q) => !q.visible);
    if (!s) { if (pool.length > 140) return; s = new THREE.Sprite(M(new THREE.SpriteMaterial({ depthWrite: false, transparent: true }))); scene.add(s); pool.push(s); }
    s.material.map = TEX[tex]; s.material.color.setHex(o.color ?? 0xffffff); s.material.opacity = 1; s.material.depthTest = o.depthTest !== false;
    s.position.set(x, y, z); s.visible = true;
    s.userData = { vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, g: o.g ?? 0, life: o.life || 1, t: 0, s0: o.size || 0.4, s1: o.size1 ?? (o.size || 0.4), spin: o.spin || 0 };
    s.scale.setScalar(s.userData.s0); s.material.rotation = Math.random() * 6;
  }
  function stepParticles(dt) {
    for (const s of pool) {
      if (!s.visible) continue; const u = s.userData; u.t += dt;
      if (u.t >= u.life) { s.visible = false; continue; }
      u.vy -= u.g * dt; s.position.x += u.vx * dt; s.position.y += u.vy * dt; s.position.z += u.vz * dt;
      const f = u.t / u.life; s.scale.setScalar(u.s0 + (u.s1 - u.s0) * f); s.material.opacity = f > 0.6 ? 1 - (f - 0.6) / 0.4 : 1; s.material.rotation += u.spin * dt;
    }
  }
  let shakeA = 0;
  const fx = {
    poof(x, y, z, color = 0xffffff, n = 12) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, sp = 0.8 + Math.random() * 1.6; spawn('puff', x, y + 0.3, z, { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 0.6 + Math.random(), life: 0.7 + Math.random() * 0.4, size: 0.35, size1: 0.9, color }); } },
    stars(x, y, z, color = 0xffd23f, n = 14) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, sp = 2 + Math.random() * 2.5; spawn('star', x, y + 0.5, z, { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 3 + Math.random() * 3, g: 9, life: 1.1, size: 0.32, size1: 0.18, color, spin: 6 }); } },
    notes(x, y, z, color, big) { for (let i = 0; i < (big ? 9 : 5); i++) spawn('note', x + (Math.random() - 0.5) * 0.4, y + 0.4 + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.4, { vx: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2, vy: 1.2 + Math.random(), life: 1.4 + Math.random() * 0.5, size: big ? 0.5 : 0.36, color, spin: (Math.random() - 0.5) * 3 }); },
    oops(i) { const m = decoys[i]; if (!m) return; m.userData.bounce = 1; spawn('x', m.position.x, m.position.y + 0.6, m.position.z, { vy: 0.8, life: 0.9, size: 0.45, size1: 0.7 }); fx.poof(m.position.x, m.position.y, m.position.z, 0xffffff, 5); },
    swing(id) { const B = bodies.get(id); if (B) B.swing = 1; if (id === ctx.myId && vm) vm.swing = 1; },
    shake(a) { shakeA = Math.max(shakeA, a); },
    pop(id) { const B = bodies.get(id); if (B) B.pop = 1; },
  };

  // ---------------------------------------------------------------- camera
  const cam = { yaw: 0, pitch: -0.25, dist: 3.4, mode: 'tp', intro: 0, x: 0, y: 1, z: 0 };
  function placeCamera(dt, focus, mode, now) {
    let px, py, pz;
    if (mode === 'fp') {
      px = focus.x; py = focus.y + 1.45; pz = focus.z;
      camera.position.set(px, py, pz); camera.rotation.set(cam.pitch, cam.yaw + Math.PI, 0);
      camera.fov += (72 - camera.fov) * Math.min(1, dt * 6);
    } else {
      const k = Math.min(1, dt * 12);
      cam.x += (focus.x - cam.x) * k; cam.y += (focus.y + focus.h - cam.y) * Math.min(1, dt * 8); cam.z += (focus.z - cam.z) * k;
      const f = [Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)];
      const o = [cam.x, cam.y, cam.z], back = [-f[0], -f[1], -f[2]];
      let d = cam.dist;
      if (level) d = Math.min(d, rayWorld(level, o, back, d + 0.3) - 0.25);
      d = Math.max(0.35, d);
      px = o[0] + back[0] * d; py = Math.min(WH - 0.15, o[1] + back[1] * d); pz = o[2] + back[2] * d;
      camera.position.set(px, py, pz); camera.lookAt(cam.x + f[0], cam.y + f[1], cam.z + f[2]);
      camera.fov += (62 - camera.fov) * Math.min(1, dt * 6);
    }
    // intro: start high above the open dollhouse and swoop down
    if (cam.intro > 0 && level) {
      const e = cam.intro * cam.intro * (3 - 2 * cam.intro);
      const a = now / 9000;
      v1.set(Math.sin(a) * level.w * 0.55, 15 + level.w * 0.35, Math.cos(a) * level.d * 0.8 + 4);
      camera.position.lerp(v1, e);
      const q0 = camera.quaternion.clone(); const tmp = new THREE.Object3D(); tmp.position.copy(camera.position); tmp.lookAt(0, 0, 0);
      camera.quaternion.slerpQuaternions(q0, tmp.quaternion, e);
    }
    if (shakeA > 0) { camera.position.x += (Math.random() - 0.5) * shakeA * 0.15; camera.position.y += (Math.random() - 0.5) * shakeA * 0.15; shakeA = Math.max(0, shakeA - dt * 2.5); }
    camera.updateProjectionMatrix();
  }
  // ray from the screen center (what the crosshair points at)
  function centerRay() { camera.getWorldDirection(v2); return { o: [camera.position.x, camera.position.y, camera.position.z], d: [v2.x, v2.y, v2.z] }; }

  // ---------------------------------------------------------------- per-frame update
  // st: { players: Map(id -> view), me, mode, focusId, highlight, showTag(id)->bool, phase }
  function update(dt, now, st) {
    const t = now / 1000;
    const live = new Set();
    for (const [id, p] of st.players) {
      const B = bodyFor(p); live.add(id);
      const meFp = id === st.me && st.mode === 'fp';
      const vis = p.alive || st.phase === 'post';
      B.root.visible = vis && !meFp;
      const showProp = p.role === 'H' && p.kind >= 0 && (p.alive || st.phase === 'post');
      setKind(B, showProp ? p.kind : -1, id === st.me);
      B.av.visible = !showProp; B.hammer.visible = p.role === 'S';
      B.root.position.set(p.x, p.y, p.z);
      const sp = Math.hypot(p.x - B.lastX, p.z - B.lastZ) / Math.max(dt, 1e-3); B.lastX = p.x; B.lastZ = p.z;
      if (B.prop) {
        const pr = B.prop; pr.rotation.set(0, p.rot, 0); pr.position.set(0, 0, 0); pr.scale.set(1, 1, 1);
        if (!p.locked && p.alive) {
          if (p.moving || sp > 0.3) { B.hop += dt * 13; const s = Math.abs(Math.sin(B.hop)); pr.position.y = s * 0.13; pr.rotation.z = Math.sin(B.hop) * 0.13; pr.scale.set(1 + (1 - s) * 0.08, 1 - (1 - s) * 0.1, 1 + (1 - s) * 0.08); }
          else { pr.rotation.z = Math.sin(t * 3.1 + B.hop) * 0.04; pr.rotation.x = Math.sin(t * 2.3 + B.hop) * 0.025; }
        }
        if (B.pop > 0) { B.pop = Math.max(0, B.pop - dt * 4); const k = 1 + Math.sin(B.pop * Math.PI) * 0.35; pr.scale.multiplyScalar(k); }
      } else {
        if (p.role === 'S') B.faceYaw = p.yaw;
        else if (sp > 0.3) { const want = Math.atan2(p.x - (B.px ?? p.x), p.z - (B.pz ?? p.z)); if (Number.isFinite(want) && sp > 0.3) B.faceYaw = want; }
        B.px = p.x; B.pz = p.z;
        B.root.rotation.y = B.faceYaw;
        B.av.userData.setPose({ run: Math.min(1, sp / 4.5), t });
        if (!p.alive && st.phase === 'post') B.av.rotation.z = Math.sin(t * 6) * 0.2;
        else B.av.rotation.z = 0;
        if (B.swing > 0) { B.swing = Math.max(0, B.swing - dt * 4); B.hammer.rotation.x = 0.5 - Math.sin(B.swing * Math.PI) * 2.2; } else B.hammer.rotation.x = 0.5;
      }
      // name tag
      const show = vis && !meFp && st.showTag(id, p) && id !== st.me;
      if (show) {
        v1.set(p.x, p.y + (showProp ? KINDS[p.kind].size[1] + 0.35 : 2.0), p.z).project(camera);
        const W = ctx.container.clientWidth, Hh = ctx.container.clientHeight;
        const on = v1.z < 1 && Math.abs(v1.x) < 1.1 && Math.abs(v1.y) < 1.1;
        B.tag.style.display = on ? '' : 'none';
        if (on) B.tag.style.transform = `translate(${((v1.x + 1) / 2) * W}px, ${((1 - v1.y) / 2) * Hh}px) translate(-50%, -100%)`;
      } else B.tag.style.display = 'none';
    }
    for (const [id, B] of bodies) if (!live.has(id)) { B.root.visible = false; B.tag.style.display = 'none'; }
    // decoy bounce (wrongly bonked)
    for (const m of decoys) if (m.userData.bounce > 0) { const u = m.userData; u.bounce = Math.max(0, u.bounce - dt * 2.2); const s = Math.sin(u.bounce * Math.PI * 3) * u.bounce; m.scale.set(1 - s * 0.2, 1 + s * 0.3, 1 - s * 0.2); if (!u.bounce) m.scale.set(1, 1, 1); }
    setHighlight(st.highlight ?? -1);
    // camera
    const f = st.players.get(st.focusId);
    if (f) placeCamera(dt, { x: f.x, y: f.y, z: f.z, h: f.kind >= 0 && f.role === 'H' ? Math.max(0.35, KINDS[f.kind].size[1] * 0.7) : 1.2 }, st.mode, now);
    // seeker view model
    if (st.mode === 'fp') { const m = viewModel(ctx.player(st.me)?.colorHex ?? 0xffffff); m.g.visible = true; if (m.swing > 0) { m.swing = Math.max(0, m.swing - dt * 4.5); } const s = Math.sin(m.swing * Math.PI); m.g.rotation.set(-0.45 - s * 1.25, 0.25 - s * 0.2, -0.2 + s * 0.35); m.g.position.set(0.36 - s * 0.16, -0.42 + Math.sin(t * 8) * 0.012 * (st.moving ? 1 : 0) - s * 0.05, -0.62 - s * 0.12); }
    else if (vm) vm.g.visible = false;
    stepParticles(dt);
    renderer.render(scene, camera);
  }

  function resize() {
    const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();

  return {
    renderer, scene, camera, cam, fx, buildLevel, update, resize, centerRay, decoyMesh: (i) => decoys[i],
    applyQ() { Q = applyQ(); },
    dispose() {
      clearLevel();
      for (const B of bodies.values()) { ctx.avatar.dispose(B.av); B.hg.geo.dispose(); B.hg.line.dispose(); B.root.removeFromParent(); B.tag.remove(); }
      bodies.clear();
      if (vm) { vm.geo.geo.dispose(); vm.geo.line.dispose(); vm = null; }
      disposeKindCache(kindCache);
      ctx.three.dispose(scene);
      for (const o of own) o.dispose?.();
      own.clear(); pool.length = 0;
    },
  };
}
void WT;
