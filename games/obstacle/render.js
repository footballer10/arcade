// Ultimate Obstacle Course: three.js view. Bright game-show set: candy-colored foam obstacles with ink outlines,
// a pink slime sea, a sunny sky with puffy clouds, studio lights and stands around the course. Bean contestants
// are the hub's shared avatar (party color + hat) with squash & stretch, dives, belly slides, tumbles and hangs.
import * as THREE from 'three';
import { pose, active, TILE_FALL } from './world.js';

const TAU = Math.PI * 2;
const GRAD = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat); GRAD.needsUpdate = true;
const THEMES = {
  whirl: { floor: 0xa98bff, alt: 0x8a6cf0, accent: 0xff4d8d, bridge: 0xff8fc8, sky: [0x3f8cff, 0xffd3f2], slime: 0xff4fb3 },
  hop: { floor: 0x5ad1ff, alt: 0x37b4ea, accent: 0xffd23f, bridge: 0x7cf0c8, sky: [0x2fa7ff, 0xc9f7ff], slime: 0xff59c0 },
  doors: { floor: 0xffb347, alt: 0xff9a1f, accent: 0x3e6dff, bridge: 0xffe07a, sky: [0x4b7bff, 0xffe1c4], slime: 0xff4fb3 },
  climb: { floor: 0x6fe08a, alt: 0x4cc66c, accent: 0xff5a5f, bridge: 0xb6f36b, sky: [0x3a9bff, 0xfff1b8], slime: 0xd65cff },
  tiles: { floor: 0xff7ac8, alt: 0xb57bff, accent: 0x2ee6d6, bridge: 0xffd23f, sky: [0x5b6dff, 0xffc4e8], slime: 0xff3fa4 },
  sweep: { floor: 0xffd23f, alt: 0xffb000, accent: 0xff4d5e, bridge: 0xffffff, sky: [0x3a86ff, 0xffe9a8], slime: 0xff4fb3 },
  crown: { floor: 0xc9a2ff, alt: 0xa77dff, accent: 0xffcc33, bridge: 0xff9ad5, sky: [0x2d6bff, 0xffc7a8], slime: 0xff4fb3 },
  last: { floor: 0x2ee6d6, alt: 0x1fc4b5, accent: 0xff5ab0, bridge: 0xffd23f, sky: [0x4a5cff, 0xff9ed8], slime: 0xff3f9a },
};
const TILE_COLS = [0xff6ec7, 0xb57bff, 0x3ea6ff];

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

export function createView(ctx) {
  const renderer = ctx.three.createRenderer();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 700);
  const hemi = new THREE.HemisphereLight(0xdff3ff, 0xffb8de, 1.55); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.3); sun.position.set(18, 34, -12); scene.add(sun); scene.add(sun.target);
  const rim = new THREE.DirectionalLight(0xff9ad5, 0.7); rim.position.set(-20, 10, 30); scene.add(rim);
  function shadowQ() {
    const q = ctx.quality();
    sun.castShadow = q.shadows;
    if (q.shadows) { sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 120 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; }
  }
  shadowQ();

  // ---- shared materials / textures (live for the whole game, disposed in dispose())
  const keep = new Set();
  const K = (x) => { keep.add(x); return x; };
  const toon = (color, extra = {}) => K(new THREE.MeshToonMaterial({ color, gradientMap: GRAD, ...extra }));
  const ink = K(new THREE.MeshBasicMaterial({ color: 0x1d1633, side: THREE.BackSide }));
  const stripeTex = K(canvasTex(128, 32, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff3d6e'; for (let i = -2; i < 8; i++) { g.beginPath(); g.moveTo(i * 24, h); g.lineTo(i * 24 + 12, h); g.lineTo(i * 24 + 28, 0); g.lineTo(i * 24 + 16, 0); g.fill(); } }));
  const checkTex = K(canvasTex(64, 64, (g) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#1d1633' : '#ffffff'; g.fillRect(x * 8, y * 8, 8, 8); } }));
  const beltTex = K(canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#3b3358'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffd23f'; g.lineWidth = 7; for (let i = 0; i < 2; i++) { g.beginPath(); g.moveTo(8, 28 + i * 32 - 12); g.lineTo(32, 28 + i * 32); g.lineTo(56, 28 + i * 32 - 12); g.stroke(); } }));
  const dotTex = K(canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.10)'; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc(x * 16 + 8 + (y % 2) * 8, y * 16 + 8, 3.2, 0, TAU); g.fill(); } }));
  const finishTex = K(canvasTex(512, 96, (g, w, h) => { g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d1633'; g.font = 'bold 70px "Lilita One", Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('FINISH', w / 2, h / 2 + 4); }));
  const M = {
    white: toon(0xffffff), ink: toon(0x2b2350), beam: toon(0xffffff, { map: stripeTex }), post: toon(0xfff0f8), gold: toon(0xffcc33, { emissive: 0x553a00 }),
    hammerHead: toon(0xff8c42), arm: toon(0x8a86a8), piston: toon(0xff4d5e), pistonFace: toon(0xffd23f), door: toon(0x3e6dff), check: toon(0xffffff, { map: checkTex }),
    belt: toon(0xffffff, { map: beltTex }), banner: new THREE.MeshBasicMaterial({ map: finishTex }), shadow: K(new THREE.MeshBasicMaterial({ color: 0x1d1633, transparent: true, opacity: 0.28, depthWrite: false })),
  };
  keep.add(M.banner);
  const tileMats = TILE_COLS.map((c) => toon(c));
  const blobGeo = K(new THREE.CircleGeometry(0.5, 20));

  // ---- sky dome (vertical gradient), clouds, slime sea, studio set
  const skyMat = K(new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { top: { value: new THREE.Color(0x3f8cff) }, bot: { value: new THREE.Color(0xffd3f2) } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying vec3 vp; void main(){ float k = smoothstep(-0.15, 0.6, vp.y); gl_FragColor = vec4(mix(bot, top, k), 1.0); }' }));
  const sky = new THREE.Mesh(K(new THREE.SphereGeometry(500, 24, 12)), skyMat); scene.add(sky);
  const slimeMat = K(new THREE.ShaderMaterial({ uniforms: { t: { value: 0 }, col: { value: new THREE.Color(0xff4fb3) } },
    vertexShader: 'uniform float t; varying vec2 vu; varying float vh; void main(){ vec3 p = position; float h = sin(p.x*0.18+t*1.3)*0.5 + cos(p.y*0.21+t*1.1)*0.5; p.z += h*0.45; vh = h; vu = p.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }',
    fragmentShader: 'uniform vec3 col; uniform float t; varying vec2 vu; varying float vh; void main(){ float s = smoothstep(0.55, 0.95, sin(vu.x*0.5+t*0.7)*0.5+0.5 + cos(vu.y*0.43-t*0.6)*0.3); vec3 c = col * (0.82 + vh*0.12) + vec3(1.0,0.85,0.95)*s*0.35; gl_FragColor = vec4(c, 1.0); }' }));
  const slime = new THREE.Mesh(K(new THREE.PlaneGeometry(700, 700, 70, 70)), slimeMat); slime.rotation.x = -Math.PI / 2; scene.add(slime);
  const cloudGeo = K(new THREE.SphereGeometry(1, 12, 8)), cloudMat = toon(0xffffff, { emissive: 0x332a3a });
  const clouds = new THREE.Group(); scene.add(clouds);
  const crand = mulberry(77);
  for (let i = 0; i < 26; i++) {
    const g = new THREE.Group(), n = 3 + Math.floor(crand() * 4);
    for (let k = 0; k < n; k++) { const m = new THREE.Mesh(cloudGeo, cloudMat); m.position.set(k * 3 - n * 1.5 + crand(), crand() * 1.5, crand() * 2); m.scale.setScalar(2 + crand() * 2.4); g.add(m); }
    const a = crand() * TAU, r = 120 + crand() * 160; g.position.set(Math.sin(a) * r, 25 + crand() * 50, Math.cos(a) * r + 60); g.userData.v = 0.4 + crand() * 0.8; clouds.add(g);
  }
  // studio set: light towers with bulbs + crowd stands around the course (rebuilt per stage bounds)
  const set = new THREE.Group(); scene.add(set);

  // ---- stage
  let stage = null, root = null, theme = THEMES.whirl;
  const dyn = []; const tiles = []; const doors = []; const belts = []; let crownObj = null;
  function outline(m, k = 0.06) {
    if (ctx.quality().pixelRatio <= 1 && !ctx.quality().shadows) return m;     // low: skip outlines
    const o = new THREE.Mesh(m.geometry, ink); const s = m.geometry.boundingSphere || (m.geometry.computeBoundingSphere(), m.geometry.boundingSphere);
    const r = Math.max(0.3, s.radius); o.scale.setScalar(1 + k / r * 1.4); m.add(o); return m;
  }
  function meshFor(s) {
    const T = theme;
    const box = (mat) => new THREE.Mesh(new THREE.BoxGeometry(s.hx * 2, s.hy * 2, s.hz * 2), mat);
    const cylm = (mat, seg = 32) => new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, s.hy * 2, seg), mat);
    let m;
    switch (s.look) {
      case 'start': m = box(toon(0xffd23f)); break;
      case 'cp': m = box(toon(0x7cf0c8)); flag(m, s); break;
      case 'finish': m = box(M.check); m.material = toon(0xffffff, { map: checkTex.clone() }); m.material.map.repeat.set(s.hx, s.hz); m.material.map.needsUpdate = true; arch(m, s); break;
      case 'floor': { const mat = toon(T.floor, { map: dotTex }); m = box(mat); break; }
      case 'bridge': m = box(toon(T.bridge)); break;
      case 'beam': m = new THREE.Mesh(new THREE.BoxGeometry(s.hx * 2, s.hy * 2, s.hz * 2, 8, 1, 1), M.beam); m.material = M.beam; { const mm = M.beam; mm.map.repeat.set(s.hx * 1.2, 1); } break;
      case 'post': m = cylm(M.post, 20); break;
      case 'hammer': {
        const g = new THREE.Group(); g.position.set(s.bx, s.by, s.bz); g.rotation.y = s.bry;
        const swing = new THREE.Group(); g.add(swing);
        const L = s.anim.L;
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, L, 8), M.arm); arm.position.y = -L / 2; swing.add(arm);
        const head = outline(new THREE.Mesh(new THREE.CylinderGeometry(s.hy * 1.05, s.hy * 1.05, s.hz * 2.2, 22), M.hammerHead)); head.rotation.x = Math.PI / 2; head.position.y = -L; swing.add(head);
        for (const k of [-1, 1]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(s.hy * 1.12, s.hy * 1.12, 0.18, 22), M.white); cap.position.y = k * s.hz * 1.05; head.add(cap); }
        const hub = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), M.ink); g.add(hub);
        const gantry = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 3), M.ink); g.add(gantry);
        g.userData = { s, swing, kind: 'pend' };
        g.traverse((o) => { o.castShadow = true; });
        return g;
      }
      case 'mover': m = box(toon(T.accent)); stripeTop(m, s); break;
      case 'lift': m = box(toon(0x7cf0c8)); stripeTop(m, s); break;
      case 'disc': { m = cylm(toon(T.accent), 40); const top = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.55, s.r * 0.55, s.hy * 2.04, 6), toon(0xffffff)); m.add(top); break; }
      case 'door': {
        const g = new THREE.Group(); g.position.set(s.bx, s.by - s.hy, s.bz); g.rotation.y = s.bry;
        const d = outline(box(M.door)); d.position.y = s.hy; g.add(d);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), M.gold); knob.position.set(s.hx * 0.6, 0, -s.hz - 0.05); d.add(knob);
        const k2 = knob.clone(); k2.position.z = s.hz + 0.05; d.add(k2);
        const star = new THREE.Mesh(new THREE.CircleGeometry(0.45, 5), M.white); star.position.set(0, s.hy * 0.35, -s.hz - 0.02); star.rotation.y = Math.PI; d.add(star);
        g.userData = { s, kind: 'door', d, open: 0 }; doors.push(g);
        g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
        return g;
      }
      case 'pillar': case 'wall': m = box(toon(0xffffff)); break;
      case 'piston': { m = box(M.piston); const face = new THREE.Mesh(new THREE.BoxGeometry(0.12, s.hy * 1.6, s.hz * 1.6), M.pistonFace); face.position.x = -Math.sign(s.anim.v[0]) * -s.hx; face.position.x = Math.sign(s.anim.v[0]) * (s.hx + 0.05); m.add(face); break; }
      case 'belt': { const mat = toon(0xffffff, { map: beltTex.clone() }); mat.map.needsUpdate = true; mat.map.repeat.set(s.hx / 1.2, s.hz / 1.2); m = box(mat); belts.push({ mat, v: -s.belt[1] / 2.4 }); const side = toon(T.floor); for (const k of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.3, s.hy * 2 + 0.2, s.hz * 2), side); r.position.x = k * (s.hx + 0.15); m.add(r); } break; }
      case 'tile': { m = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.98, s.r * 0.9, s.hy * 2, 6), tileMats[s.layer % 3].clone()); m.rotation.y = Math.PI / 6; tiles.push({ m, s, base: s.by, fall: 0 }); break; }
      case 'arena': { m = cylm(toon(T.floor, { map: dotTex }), 48); m.material.map = dotTex; const ring = new THREE.Mesh(new THREE.TorusGeometry(s.r, 0.35, 8, 48), toon(T.accent)); ring.rotation.x = Math.PI / 2; ring.position.y = s.hy; m.add(ring); break; }
      case 'ring': m = box(toon(THEMES.last.bridge)); stripeTop(m, s); break;
      case 'column': m = cylm(toon(0xffe9a8), 28); break;
      case 'step': m = box(toon(T.accent)); break;
      case 'summit': { m = cylm(toon(0xffcc33), 36); const r = new THREE.Mesh(new THREE.TorusGeometry(s.r, 0.3, 8, 36), toon(0xff5ab0)); r.rotation.x = Math.PI / 2; r.position.y = s.hy; m.add(r); break; }
      default: m = box(toon(T.floor));
    }
    if (s.look !== 'tile' && s.look !== 'beam') outline(m, s.look === 'post' ? 0.05 : 0.08);
    else if (s.look === 'beam') outline(m, 0.05);
    m.castShadow = true; m.receiveShadow = true;
    m.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    m.userData.s = s;
    return m;
  }
  function stripeTop(m, s) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(s.hx * 2 - 0.3, 0.04, 0.25), M.white); g.position.y = s.hy + 0.02; g.position.z = s.hz - 0.3; m.add(g);
    const g2 = g.clone(); g2.position.z = -s.hz + 0.3; m.add(g2);
  }
  function flag(m, s) {
    for (const k of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6), M.white); pole.position.set(k * (s.hx - 0.3), s.hy + 1.6, -s.hz + 0.3); m.add(pole);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), toon(0x2ee6d6, { side: THREE.DoubleSide })); f.position.set(-k * 0.55, 1.2, 0); pole.add(f);
    }
  }
  function arch(m, s) {
    const g = new THREE.Group(); g.position.set(0, s.hy, -s.hz + 1.6); m.add(g);
    const mat = toon(0xff5ab0);
    for (const k of [-1, 1]) { const p = outline(new THREE.Mesh(new THREE.BoxGeometry(0.7, 6, 0.7), mat)); p.position.set(k * (s.hx - 0.5), 3, 0); g.add(p); }
    const top = outline(new THREE.Mesh(new THREE.BoxGeometry(s.hx * 2, 1.2, 0.8), mat)); top.position.set(0, 6.3, 0); g.add(top);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(s.hx * 1.5, 1.0), M.banner); ban.position.set(0, 6.3, -0.42); ban.rotation.y = Math.PI; g.add(ban);
    const ban2 = ban.clone(); ban2.position.z = 0.42; ban2.rotation.y = 0; g.add(ban2);
  }

  function buildStage(st) {
    clearStage();
    stage = st; theme = THEMES[st.id] || THEMES.whirl;
    skyMat.uniforms.top.value.setHex(theme.sky[0]); skyMat.uniforms.bot.value.setHex(theme.sky[1]);
    scene.fog = new THREE.Fog(theme.sky[1], 90, 330);
    slimeMat.uniforms.col.value.setHex(theme.slime);
    slime.position.y = st.killY + 3.5;
    root = new THREE.Group(); scene.add(root);
    for (const s of st.solids) {
      const m = meshFor(s);
      if (!m.userData.kind) { m.position.set(s.x, s.y, s.z); m.rotation.y = s.ry; }
      root.add(m);
      if (s.anim || s.until) dyn.push(m);
    }
    if (st.crown) {
      crownObj = new THREE.Group(); crownObj.position.set(st.crown.x, st.crown.y, st.crown.z);
      const h = ctx.avatar.hat('crown', 0xffcc33); h.scale.setScalar(2.6); h.position.y = -0.35; crownObj.add(h);
      const glow = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.08, 8, 40), toon(0xfff27a, { emissive: 0xffd23f })); glow.rotation.x = Math.PI / 2; crownObj.add(glow);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 60, 20, 1, true), K(new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })));
      beam.position.y = 30; crownObj.add(beam);
      root.add(crownObj);
    }
    buildSet(st);
  }
  function buildSet(st) {
    set.clear();
    const len = st.len || 0, cz = len / 2, R = st.len ? Math.max(40, len * 0.6) : 34;
    const towerMat = toon(0xffffff), bulb = toon(0xfff27a, { emissive: 0xffc23f }), standMat = toon(0x6a5cff);
    const n = st.len ? 10 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.3;
      const x = st.len ? (i % 2 ? 1 : -1) * (46 + (i % 3) * 4) : Math.sin(a) * (R + 12), z = st.len ? -14 + (i / n) * (len + 28) : Math.cos(a) * (R + 12);
      const t = new THREE.Group(); t.position.set(x, st.killY + 3, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 26, 8), towerMat); pole.position.y = 13; t.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 1.2), toon(theme.accent)); head.position.y = 26.5; t.add(head);
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), bulb); b.position.set(-1 + k, 26.5, 0.65); t.add(b); }
      t.lookAt(0, st.killY + 3, cz); set.add(t);
    }
    // crowd stands (instanced bean-ish blobs that bounce)
    const count = 220, geo = new THREE.CapsuleGeometry(0.45, 0.5, 3, 8), mat = new THREE.MeshToonMaterial({ gradientMap: GRAD });
    const crowd = new THREE.InstancedMesh(geo, mat, count); crowd.userData.base = [];
    const c = new THREE.Color(), m4 = new THREE.Matrix4(), rr = mulberry(st.id.length * 99 + 3);
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1, row = Math.floor(rr() * 4);
      let x, z;
      if (st.len) { x = side * (34 + row * 2.2); z = -10 + rr() * (len + 20); } else { const a = rr() * TAU, r = 30 + row * 2.2; x = Math.sin(a) * r; z = Math.cos(a) * r; }
      const y = st.killY + 6 + row * 1.6;
      crowd.userData.base.push([x, y, z, rr() * TAU]);
      m4.makeTranslation(x, y, z); crowd.setMatrixAt(i, m4);
      crowd.setColorAt(i, c.setHSL(rr(), 0.75, 0.6));
    }
    const standGeo = st.len ? new THREE.BoxGeometry(9, 8, len + 24) : new THREE.CylinderGeometry(39, 36, 8, 40, 1, true);
    if (st.len) for (const side of [-1, 1]) { const s = new THREE.Mesh(standGeo, standMat); s.position.set(side * 38.5, st.killY + 2, cz); set.add(s); }
    else { const s = new THREE.Mesh(standGeo, toon(0x6a5cff, { side: THREE.DoubleSide })); s.position.y = st.killY + 2; set.add(s); }
    set.add(crowd); set.userData.crowd = crowd;
  }
  function clearStage() {
    if (root) { ctx.three.dispose(root, keep); root = null; }
    for (const o of [...set.children]) ctx.three.dispose(o, keep);
    set.clear(); dyn.length = 0; tiles.length = 0; doors.length = 0; belts.length = 0; crownObj = null;
  }

  // ---- players
  const beans = new Map();
  for (const p of ctx.players) {
    const a = ctx.avatar.build(p);
    a.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const blob = new THREE.Mesh(blobGeo, M.shadow); blob.rotation.x = -Math.PI / 2; blob.renderOrder = 1; scene.add(blob);
    const tether = new THREE.Mesh(K(new THREE.CylinderGeometry(0.07, 0.07, 1, 6)), toon(p.colorHex)); tether.visible = false; scene.add(tether);
    a.visible = false; scene.add(a);
    beans.set(p.id, { a, blob, tether, sq: 1, sqv: 0, spin: 0, lastGr: true, vis: 0, pop: 0 });
  }

  // ---- particles (one instanced mesh: confetti, dust, stars, slime drops)
  const PMAX = 900;
  const pGeo = K(new THREE.BoxGeometry(0.2, 0.2, 0.05));
  const pMat = K(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const pMesh = new THREE.InstancedMesh(pGeo, pMat, PMAX); pMesh.frustumCulled = false; scene.add(pMesh);
  const P = []; const pm = new THREE.Matrix4(), pq = new THREE.Quaternion(), pe = new THREE.Euler(), ps = new THREE.Vector3(), pv = new THREE.Vector3(), pc = new THREE.Color();
  for (let i = 0; i < PMAX; i++) pMesh.setColorAt(i, pc.setHex(0xffffff));
  function emit(n, x, y, z, o = {}) {
    const lowQ = !ctx.quality().shadows; if (lowQ) n = Math.ceil(n * 0.5);
    for (let i = 0; i < n; i++) {
      if (P.length >= PMAX) P.shift();
      const sp = o.speed ?? 4, a = Math.random() * TAU, el = (o.up ?? 0.6) + Math.random() * (o.upr ?? 0.6);
      const col = o.colors ? o.colors[Math.floor(Math.random() * o.colors.length)] : o.color ?? 0xffffff;
      P.push({ x: x + (Math.random() - 0.5) * (o.spread ?? 0.4), y, z: z + (Math.random() - 0.5) * (o.spread ?? 0.4), vx: Math.cos(a) * sp * (0.4 + Math.random() * 0.6), vy: sp * el, vz: Math.sin(a) * sp * (0.4 + Math.random() * 0.6),
        life: (o.life ?? 1) * (0.6 + Math.random() * 0.6), max: 1, g: o.g ?? 14, drag: o.drag ?? 0.9, size: (o.size ?? 1) * (0.6 + Math.random() * 0.8), col, rx: Math.random() * 6, ry: Math.random() * 6, spin: (o.spin ?? 8) * (Math.random() - 0.5) });
      P[P.length - 1].max = P[P.length - 1].life;
    }
  }
  function stepParticles(dt) {
    let n = 0;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.life -= dt; if (p.life <= 0) { P.splice(i, 1); continue; }
      p.vy -= p.g * dt; const d = Math.pow(p.drag, dt * 10); p.vx *= d; p.vz *= d; if (p.g < 5) p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rx += p.spin * dt; p.ry += p.spin * 0.7 * dt;
    }
    for (const p of P) {
      const k = Math.min(1, p.life / p.max * 3) * p.size;
      pm.compose(pv.set(p.x, p.y, p.z), pq.setFromEuler(pe.set(p.rx, p.ry, 0)), ps.set(k, k, k));
      pMesh.setMatrixAt(n, pm); pMesh.setColorAt(n, pc.setHex(p.col)); n++;
    }
    pMesh.count = n; pMesh.instanceMatrix.needsUpdate = true; if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
  }
  const CONF = [0xff5a5f, 0x3ea6ff, 0x4cd964, 0xffcc00, 0xb57bff, 0xff8c42, 0x2ee6d6, 0xff6ec7, 0xffffff];
  const fx = {
    shakeAmt: 0,
    shake(a) { fx.shakeAmt = Math.min(1.4, fx.shakeAmt + a); },
    dust(x, y, z, k = 1) { emit(Math.round(6 + 10 * k), x, y + 0.1, z, { color: 0xffffff, speed: 2 + 3 * k, up: 0.15, upr: 0.3, life: 0.45, g: 2, size: 1.3, spread: 0.6 }); },
    stars(x, y, z) { emit(14, x, y + 1, z, { colors: [0xfff27a, 0xffffff, 0xffcc33], speed: 6, up: 0.3, life: 0.6, g: 6, size: 1.4, spin: 14 }); },
    confetti(x, y, z, n = 60) { emit(n, x, y, z, { colors: CONF, speed: 7, up: 0.9, upr: 0.8, life: 2.6, g: 5, drag: 0.82, size: 1.1, spin: 16, spread: 1 }); },
    splash(x, y, z, col) { emit(26, x, y, z, { color: col ?? theme.slime, speed: 7, up: 1.1, life: 1.0, g: 20, size: 1.6 }); },
    firework(x, y, z) { const c = CONF[Math.floor(Math.random() * 8)]; emit(70, x, y, z, { colors: [c, 0xffffff, c], speed: 13, up: -0.3, upr: 1.4, life: 1.6, g: 4, drag: 0.8, size: 1.3, spin: 10 }); },
    poof(x, y, z, col) { emit(30, x, y + 0.8, z, { colors: [col, 0xffffff, 0xfff27a], speed: 5, up: 0.2, upr: 1, life: 0.9, g: 1, drag: 0.85, size: 1.5 }); },
  };

  // ---- camera rig
  const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0.36, dist: 9, intro: 0, introT: 0, mode: 'follow', orbit: 0 };
  const tmpV = new THREE.Vector3(), TMP = {};
  function resize() { const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  resize();

  // ---- per-frame
  function update(dt, now, S) {
    const t = S.t, W = S.W, sec = now / 1000;
    // moving obstacles (pure functions of the stage clock)
    for (const m of dyn) {
      const s = m.userData.s;
      if (m.userData.kind === 'pend') { pose(s, t, TMP); m.userData.swing.rotation.z = TMP.th; continue; }
      if (s.until) { const gone = !active(s, W); if (gone) { m.userData.f = (m.userData.f || 0) + dt; m.position.y = s.y - m.userData.f * m.userData.f * 9; m.visible = m.userData.f < 2; } else if (t > s.until - 2.5) { m.position.x = s.x + Math.sin(sec * 50) * 0.06; m.position.y = s.y; m.visible = true; } continue; }
      pose(s, t, TMP); m.position.set(TMP.x, TMP.y, TMP.z); m.rotation.y = TMP.ry;
    }
    for (const tl of tiles) {
      const st = W.dyn[tl.s.tile];
      if (st === 0) { tl.m.position.set(tl.s.x, tl.base, tl.s.z); tl.m.visible = true; tl.fall = 0; tl.m.material.emissive.setHex(0); tl.m.scale.setScalar(1); }
      else if (st === 1) { if (!tl.shake) { tl.shake = sec; S.onTile?.(tl.s); } const k = Math.min(1, (sec - tl.shake) / TILE_FALL); tl.m.position.set(tl.s.x + Math.sin(sec * 60) * 0.05 * k, tl.base - k * 0.12, tl.s.z); tl.m.material.emissive.setRGB(0.5 * k, 0.45 * k, 0.4 * k); }
      else { if (!tl.fall) S.onTileFall?.(tl.s); tl.fall += dt; tl.m.position.y = tl.base - tl.fall * tl.fall * 8; tl.m.scale.setScalar(Math.max(0.01, 1 - tl.fall * 0.6)); tl.m.visible = tl.fall < 1.5; tl.shake = 0; }
    }
    for (const g of doors) {
      const s = g.userData.s;
      if (!s.fake && W.dyn[s.door] === 1) { g.userData.open = Math.min(1, g.userData.open + dt * 5); g.rotation.x = -g.userData.open * 1.45 * (1 + Math.sin(g.userData.open * 9) * 0.04 * (1 - g.userData.open)); }
      else { g.userData.open = 0; g.rotation.x = Math.sin((g.userData.wob || 0) * 30) * 0.06 * (g.userData.wob || 0); g.userData.wob = Math.max(0, (g.userData.wob || 0) - dt * 2); }
    }
    for (const b of belts) b.mat.map.offset.y = (b.mat.map.offset.y + dt * b.v) % 1;
    if (crownObj) { crownObj.rotation.y = sec * 1.4; crownObj.position.y = stage.crown.y + Math.sin(sec * 2.2) * 0.12; crownObj.visible = !S.crownTaken; }
    slimeMat.uniforms.t.value = sec;
    for (const c of clouds.children) { c.position.x += c.userData.v * dt; if (c.position.x > 300) c.position.x = -300; }
    const crowd = set.userData.crowd;
    if (crowd) {
      const hype = S.hype || 0, base = crowd.userData.base;
      for (let i = 0; i < base.length; i++) { const [x, y, z, ph] = base[i]; pm.makeTranslation(x, y + Math.abs(Math.sin(sec * (4 + hype * 6) + ph)) * (0.15 + hype * 0.8), z); crowd.setMatrixAt(i, pm); }
      crowd.instanceMatrix.needsUpdate = true;
    }
    // beans
    for (const [id, b] of beans) {
      const v = S.players.get(id);
      const show = !!v && v.visible;
      b.vis = show ? 1 : 0;
      b.a.visible = show; b.blob.visible = show && v.groundY > -1e8; b.tether.visible = false;
      if (!show) continue;
      const a = b.a, rig = a.userData.rig;
      a.position.set(v.x, v.y, v.z);
      let face = v.face; a.rotation.y = face;
      const hs = Math.hypot(v.vx || 0, v.vz || 0);
      const run = v.grounded && !v.down && !v.dive ? Math.min(1, hs / 7) : 0;
      a.userData.setPose({ run, t: sec + id.length });
      // squash & stretch spring
      if (v.grounded && !b.lastGr) { const k = Math.min(1, (v.landV || 8) / 20); b.sqv -= 6 + k * 10; }
      if (!v.grounded && b.lastGr && (v.vy || 0) > 4) b.sqv += 7;
      b.lastGr = v.grounded;
      b.sqv += (1 - b.sq) * 260 * dt; b.sqv *= Math.pow(0.0008, dt); b.sq += b.sqv * dt;
      const sq = Math.max(0.6, Math.min(1.45, b.sq));
      rig.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      rig.rotation.x = 0; rig.rotation.z = rig.rotation.z || 0; rig.position.z = 0;
      if (v.dive || v.slide) { rig.rotation.x = 1.35; rig.position.y = 0.45; rig.position.z = -0.35; }
      else if (v.down) { b.spin += dt * (v.grounded ? 3 : 11); rig.rotation.x = v.grounded ? 1.45 : b.spin; rig.rotation.z = v.grounded ? 0.3 : Math.sin(b.spin * 0.7) * 0.8; rig.position.y = v.grounded ? 0.4 : 0.8; }
      else if (v.hang) { rig.rotation.x = -0.25; rig.position.y = Math.sin(sec * 8) * 0.03; }
      else if (!v.grounded) { rig.rotation.x = Math.max(-0.35, Math.min(0.35, -(v.vy || 0) * 0.03)); b.spin = 0; }
      else b.spin = 0;
      // blob shadow
      if (v.groundY > -1e8) { b.blob.position.set(v.x, v.groundY + 0.03, v.z); const h = Math.max(0, v.y - v.groundY); b.blob.scale.setScalar(Math.max(0.35, 1.25 - h * 0.12)); b.blob.material.opacity = 0.28; }
      // grab tether
      if (v.grabX != null) {
        const dx = v.grabX - v.x, dy = v.grabY - v.y, dz = v.grabZ - v.z, l = Math.hypot(dx, dy, dz);
        b.tether.visible = true; b.tether.position.set(v.x + dx / 2, v.y + 0.9 + dy / 2, v.z + dz / 2); b.tether.scale.set(1, l, 1);
        b.tether.lookAt(v.grabX, v.grabY + 0.9, v.grabZ); b.tether.rotateX(Math.PI / 2);
      }
    }
    stepParticles(dt);
    // camera
    const shake = fx.shakeAmt; fx.shakeAmt = Math.max(0, fx.shakeAmt - dt * 2.4);
    const sx = (Math.random() - 0.5) * shake * 0.5, sy = (Math.random() - 0.5) * shake * 0.5;
    if (cam.mode === 'intro' && stage) {
      const k = cam.introT; // 0..1
      const e = k * k * (3 - 2 * k);
      if (stage.len) {
        const z0 = stage.len + 6, z1 = cam.z - 10;
        tmpV.set(Math.sin(sec * 0.3) * 6 + 14 * (1 - e), 22 * (1 - e) + (cam.y + 6) * e, z0 + (z1 - z0) * e);
        camera.position.copy(tmpV); camera.lookAt(0, cam.y + 1 * e, z0 - 10 + (cam.z - z0 + 10) * e);
      } else {
        const a = cam.orbit + e * 2.2; const r = 28 - 12 * e;
        camera.position.set(Math.sin(a) * r, 18 - 8 * e, Math.cos(a) * r); camera.lookAt(0, 0, 0);
      }
    } else {
      const cp = Math.cos(cam.pitch), spch = Math.sin(cam.pitch);
      const tx = cam.x - Math.sin(cam.yaw) * cp * cam.dist, tz = cam.z - Math.cos(cam.yaw) * cp * cam.dist, ty = cam.y + 1.4 + spch * cam.dist;
      camera.position.set(tx + sx, ty + sy, tz);
      camera.lookAt(cam.x + Math.sin(cam.yaw) * 2, cam.y + 1.3, cam.z + Math.cos(cam.yaw) * 2);
    }
    // sun + shadow follow the action
    sun.position.set(cam.x + 18, cam.y + 34, cam.z - 12); sun.target.position.set(cam.x, cam.y, cam.z + 4);
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
  }
  // project a world point to container pixels (name tags); null when behind the camera
  function project(x, y, z) {
    tmpV.set(x, y, z).project(camera);
    if (tmpV.z > 1) return null;
    return [(tmpV.x * 0.5 + 0.5) * (ctx.container.clientWidth || innerWidth), (-tmpV.y * 0.5 + 0.5) * (ctx.container.clientHeight || innerHeight)];
  }
  function applyQ() { ctx.three.applyQuality(renderer, sun); shadowQ(); resize(); }
  function wobbleDoor(d) { const g = doors.find((x) => x.userData.s.door === d); if (g) g.userData.wob = 1; }
  return {
    renderer, scene, camera, cam, fx, buildStage, update, resize, project, applyQ, wobbleDoor, beans,
    dispose() {
      clearStage();
      for (const b of beans.values()) { ctx.avatar.dispose(b.a); b.blob.removeFromParent(); b.tether.material.dispose(); b.tether.removeFromParent(); }
      ctx.three.dispose(scene);
      for (const x of keep) { x.dispose?.(); }
      keep.clear(); P.length = 0;
    },
  };
}
function mulberry(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
