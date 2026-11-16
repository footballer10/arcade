// Floor Is Falling — the 3D view. Every layer is one InstancedMesh of glassy hex tiles (one draw call per layer,
// plus one for ink outlines), cracking tiles shake and flash in the color of whoever touched them, dropped
// tiles become tumbling debris that falls into the glowing void. Layers above the one you watch turn ghostly
// so the stack never hides you.
import * as THREE from 'three';
import { C, LAYER_COLORS, layerOf, tileAt, solid } from './world.js';

const TMP = new THREE.Object3D(), COL = new THREE.Color(), WHITE = new THREE.Color(0xffffff), INK = 0x1d1633;
// shared (module-level, never disposed): tile geometries
const tileGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.44, 6); tileGeo.rotateY(Math.PI / 6); tileGeo.translate(0, -0.22, 0);
const capGeo = new THREE.CylinderGeometry(0.62, 0.78, 0.06, 6); capGeo.rotateY(Math.PI / 6); capGeo.translate(0, 0.03, 0);
const lineGeo = new THREE.CylinderGeometry(0.97, 0.97, 0.52, 6); lineGeo.rotateY(Math.PI / 6); lineGeo.translate(0, -0.24, 0);
const KEEP = new Set([tileGeo, capGeo, lineGeo]);

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x8fd6ff) }, mid: { value: new THREE.Color(0xffd0e8) }, low: { value: new THREE.Color(0x6a3cc8) }, deep: { value: new THREE.Color(0x150a35) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, mid, low, deep; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.6, h)) : mix(mid, low, smoothstep(0.0, 0.25, -h));
        c = mix(c, deep, smoothstep(0.25, 0.85, -h)); gl_FragColor = vec4(c, 1.0); }`,
  });
}
function glowTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createView(ctx) {
  const renderer = ctx.three.createRenderer();
  
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
  const q0 = ctx.quality();
  scene.fog = new THREE.Fog(0x2a1460, 40, 110);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMaterial()); scene.add(sky);
  scene.add(new THREE.HemisphereLight(0xfff2ff, 0x5a3aa0, 1.5));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  sun.position.set(-12, 30, 14); sun.castShadow = q0.shadows;
  sun.shadow.mapSize.set(q0.shadowMap || 512, q0.shadowMap || 512);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 80 });
  sun.shadow.bias = -0.0015;
  scene.add(sun, sun.target);
  // the void: a glowing swirl far below
  const voidTex = glowTexture([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(160,240,255,0.95)'], [0.35, 'rgba(150,90,255,0.6)'], [0.7, 'rgba(90,30,200,0.18)'], [1, 'rgba(40,0,120,0)']]);
  const voidMat = new THREE.MeshBasicMaterial({ map: voidTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const voidDisc = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), voidMat); voidDisc.rotation.x = -Math.PI / 2; voidDisc.position.y = C.KILL_Y - 14; scene.add(voidDisc);
  const voidDisc2 = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), voidMat); voidDisc2.rotation.x = -Math.PI / 2; voidDisc2.position.y = C.KILL_Y - 10; scene.add(voidDisc2);
  const voidLight = new THREE.PointLight(0x9a6bff, 30, 45, 1.4); voidLight.position.set(0, C.KILL_Y - 4, 0); scene.add(voidLight);

  // ---------------------------------------------------------------- level
  let lv = null, layers = [];
  const lineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  function buildLevel(level) {
    clearLevel();
    lv = level;
    layers = lv.layers.map((L) => {
      const g = new THREE.Group(); g.position.y = L.y; scene.add(g);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0.05, emissive: L.color, emissiveIntensity: 0.18, transparent: true, opacity: 1 });
      const capMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(L.color).lerp(WHITE, 0.6), transparent: true, opacity: 0.4, depthWrite: false });
      const lm = lineMat.clone(); lm.transparent = true;
      const body = new THREE.InstancedMesh(tileGeo, mat, L.n), cap = new THREE.InstancedMesh(capGeo, capMat, L.n), line = new THREE.InstancedMesh(lineGeo, lm, L.n);
      body.castShadow = true; body.receiveShadow = true;
      const base = new THREE.Color(L.color);
      for (let i = 0; i < L.n; i++) {
        TMP.position.set(L.xs[i], 0, L.zs[i]); TMP.rotation.set(0, 0, 0); TMP.scale.set(1, 1, 1); TMP.updateMatrix();
        body.setMatrixAt(i, TMP.matrix); cap.setMatrixAt(i, TMP.matrix); line.setMatrixAt(i, TMP.matrix);
        COL.copy(base).offsetHSL(0, 0, (((i * 7919) % 13) / 13 - 0.5) * 0.07); body.setColorAt(i, COL);
      }
      body.frustumCulled = cap.frustumCulled = line.frustumCulled = false;
      g.add(line, body, cap);
      return { L, g, mat, capMat, lm, body, cap, line, base, shown: new Uint8Array(L.n), cracking: new Set(), fade: 1 };
    });
  }
  function clearLevel() {
    for (const y of layers) { ctx.three.dispose(y.g, KEEP); y.body.dispose(); y.cap.dispose(); y.line.dispose(); }
    layers = []; for (const d of debris) d.m.visible = false;
  }

  // ---------------------------------------------------------------- tumbling debris (pooled)
  const debris = [];
  const debrisMats = LAYER_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.2, emissive: c, emissiveIntensity: 0.35 }));
  const maxDebris = q0.effects ? 90 : 40;
  for (let i = 0; i < maxDebris; i++) { const m = new THREE.Mesh(tileGeo, debrisMats[0]); m.visible = false; scene.add(m); debris.push({ m, vx: 0, vy: 0, vz: 0, ax: 0, az: 0, life: 0 }); }
  let dIdx = 0;
  function spawnDebris(Ly, i, push) {
    if (Ly.fade < 0.5) return;            // tiles of the ghosted layers above me just vanish (no debris in my face)
    const d = debris[dIdx++ % debris.length];
    d.m.material = debrisMats[LAYER_COLORS.indexOf(Ly.L.color)] || debrisMats[0];
    d.m.position.set(Ly.L.xs[i], Ly.L.y, Ly.L.zs[i]); d.m.rotation.set(0, 0, 0); d.m.scale.setScalar(0.92); d.m.visible = true;
    d.vx = (Math.random() - 0.5) * 1.2 + (push?.x || 0); d.vz = (Math.random() - 0.5) * 1.2 + (push?.z || 0); d.vy = -1 - Math.random() * 2;
    d.ax = (Math.random() - 0.5) * 5; d.az = (Math.random() - 0.5) * 5; d.life = 2.6;
  }

  // ---------------------------------------------------------------- players
  const bodies = new Map(), shadows = new Map();
  const shadowGeo = new THREE.CircleGeometry(0.5, 20); shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.35, depthWrite: false });
  for (const p of ctx.players) {
    const a = ctx.avatar.build(p); a.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(a); bodies.set(p.id, a);
    const s = new THREE.Mesh(shadowGeo, shadowMat); s.renderOrder = 2; scene.add(s); shadows.set(p.id, s);
  }

  // ---------------------------------------------------------------- camera
  const cam = { x: 0, y: 0, z: 0, shake: 0, intro: 0 };
  function resize() {
    const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  function applyQ() { const q = ctx.three.applyQuality(renderer, sun); renderer.shadowMap.needsUpdate = true; return q; }

  // ---------------------------------------------------------------- per frame
  // st: { t, players: Map id -> {x,y,z,face,alive,g,run,air}, focus: {x,y,z} }
  function frame(dt, now, st) {
    const t = st.t;
    const focusY = st.focus.y, fl = lv ? layerOf(lv, focusY + 0.3) : 0;
    const fx = { cracks: 0, cracksNear: 0, drops: 0, dropsNear: 0 };
    const near = (L, i) => Math.abs(L.y - focusY) < 2.5 && Math.hypot(L.xs[i] - st.focus.x, L.zs[i] - st.focus.z) < 7;
    // tiles
    for (const Ly of layers) {
      const L = Ly.L;
      let dirty = false, cdirty = false;
      for (let i = 0; i < L.n; i++) {
        const at = L.at[i], s = at === Infinity ? 0 : at > t ? 1 : 2;
        if (s === Ly.shown[i] && s !== 1) continue;
        if (s === 2) {
          if (Ly.shown[i] !== 2) { hide(Ly, i); spawnDebris(Ly, i); dirty = true; Ly.cracking.delete(i); fx.drops++; if (near(L, i)) fx.dropsNear++; }
        } else if (s === 1) {
          if (Ly.shown[i] !== 1) { Ly.cracking.add(i); fx.cracks++; if (near(L, i)) fx.cracksNear++; const w = L.who[i]; COL.copy(w < ctx.players.length ? new THREE.Color(ctx.players[w].colorHex) : new THREE.Color(0xffffff)); Ly.body.setColorAt(i, COL.lerp(WHITE, 0.25)); cdirty = true; }
        } else if (Ly.shown[i] !== 0) { show(Ly, i); dirty = true; COL.copy(Ly.base); Ly.body.setColorAt(i, COL); cdirty = true; }
        Ly.shown[i] = s;
      }
      for (const i of Ly.cracking) {
        const left = L.at[i] - t, k = 1 - Math.min(1, left / Math.max(0.2, lv.delay * 1.8));
        const j = 0.03 + k * 0.09;
        TMP.position.set(L.xs[i] + (Math.random() - 0.5) * j, -k * 0.12 + (Math.random() - 0.5) * j, L.zs[i] + (Math.random() - 0.5) * j);
        TMP.rotation.set((Math.random() - 0.5) * j * 0.8, 0, (Math.random() - 0.5) * j * 0.8); TMP.scale.set(1, 1, 1); TMP.updateMatrix();
        Ly.body.setMatrixAt(i, TMP.matrix); Ly.cap.setMatrixAt(i, TMP.matrix); Ly.line.setMatrixAt(i, TMP.matrix);
        dirty = true;
      }
      if (dirty) { Ly.body.instanceMatrix.needsUpdate = true; Ly.cap.instanceMatrix.needsUpdate = true; Ly.line.instanceMatrix.needsUpdate = true; }
      if (cdirty && Ly.body.instanceColor) Ly.body.instanceColor.needsUpdate = true;
      // ghost the layers above the one I'm watching
      const target = L.h > fl + 1 ? 0 : L.h > fl ? 0.1 : 1;
      Ly.fade += (target - Ly.fade) * Math.min(1, dt * 6);
      const ghost = Ly.fade < 0.98;
      Ly.mat.opacity = Ly.fade; Ly.mat.depthWrite = !ghost; Ly.capMat.opacity = 0.4 * Ly.fade; Ly.g.visible = Ly.fade > 0.01; Ly.lm.opacity = Ly.fade; Ly.lm.visible = Ly.fade > 0.5;
      Ly.body.castShadow = !ghost;
    }
    // debris
    for (const d of debris) {
      if (!d.m.visible) continue;
      d.life -= dt; d.vy -= 18 * dt;
      d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt;
      d.m.rotation.x += d.ax * dt; d.m.rotation.z += d.az * dt;
      if (d.life < 0.6) d.m.scale.setScalar(Math.max(0.01, d.life / 0.6));
      if (d.life <= 0) d.m.visible = false;
    }
    // players
    for (const [id, a] of bodies) {
      const p = st.players.get(id), sh = shadows.get(id);
      a.visible = !!p && p.alive !== false && p.y > C.KILL_Y - 2; sh.visible = false;
      if (!a.visible) continue;
      a.position.set(p.x, p.y, p.z);
      let dr = p.face - a.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); a.rotation.y += dr * Math.min(1, dt * 14);
      a.userData.setPose({ run: p.g ? Math.min(1, p.run / C.SPEED) : 0.2, t: now / 1000 });
      const sc = p.stun > 0 ? 1 + Math.sin(now / 40) * 0.08 : 1; a.scale.set(sc, p.g ? 1 : 1.08, sc);
      // drop shadow on the floor I'd land on
      if (lv) for (let h = lv.L - 1; h >= 0; h--) {
        const L = lv.layers[h]; if (L.y > p.y + 0.05) continue;
        if (solid(L, tileAt(L, p.x, p.z), t)) { sh.visible = true; sh.position.set(p.x, L.y + 0.07, p.z); const s = Math.max(0.35, 1 - (p.y - L.y) / 8); sh.scale.setScalar(s); break; }
      }
    }
    // camera
    const f = st.focus, k = Math.min(1, dt * 5);
    cam.x += (f.x - cam.x) * k; cam.z += (f.z - cam.z) * k; cam.y += (f.y - cam.y) * Math.min(1, dt * 3.2);
    cam.shake = Math.max(0, cam.shake - dt * 2.5);
    const sx = (Math.random() - 0.5) * cam.shake * 0.6, sy = (Math.random() - 0.5) * cam.shake * 0.6;
    const dist = st.dist || 1;
    camera.position.set(cam.x * 0.75 + sx, cam.y + 13.5 * dist + sy, cam.z * 0.75 + 11 * dist);
    camera.lookAt(cam.x * 0.92, cam.y - 0.5, cam.z * 0.92 - 0.6);
    sun.position.set(cam.x - 12, cam.y + 30, cam.z + 14); sun.target.position.set(cam.x, cam.y, cam.z);
    voidDisc.rotation.z += dt * 0.15; voidDisc2.rotation.z -= dt * 0.3;
    renderer.render(scene, camera);
    return fx;
  }
  function hide(Ly, i) { TMP.position.set(0, -999, 0); TMP.scale.set(0, 0, 0); TMP.rotation.set(0, 0, 0); TMP.updateMatrix(); Ly.body.setMatrixAt(i, TMP.matrix); Ly.cap.setMatrixAt(i, TMP.matrix); Ly.line.setMatrixAt(i, TMP.matrix); }
  function show(Ly, i) { TMP.position.set(Ly.L.xs[i], 0, Ly.L.zs[i]); TMP.scale.set(1, 1, 1); TMP.rotation.set(0, 0, 0); TMP.updateMatrix(); Ly.body.setMatrixAt(i, TMP.matrix); Ly.cap.setMatrixAt(i, TMP.matrix); Ly.line.setMatrixAt(i, TMP.matrix); Ly.cracking.delete(i); }

  return {
    renderer, scene, camera, cam, buildLevel, frame, resize, applyQ,
    shake(a) { cam.shake = Math.min(1.2, cam.shake + a); },
    project(x, y, z, out) { const v = new THREE.Vector3(x, y, z).project(camera); out.x = (v.x * 0.5 + 0.5) * (ctx.container.clientWidth || innerWidth); out.y = (-v.y * 0.5 + 0.5) * (ctx.container.clientHeight || innerHeight); out.vis = v.z < 1; return out; },
    dispose() {
      clearLevel();
      for (const a of bodies.values()) ctx.avatar.dispose(a);
      for (const s of shadows.values()) s.removeFromParent();
      shadowGeo.dispose(); shadowMat.dispose(); lineMat.dispose();
      for (const d of debris) d.m.removeFromParent();
      for (const m of debrisMats) m.dispose();
      voidTex.dispose();
      ctx.three.dispose(scene, KEEP);
    },
  };
}
