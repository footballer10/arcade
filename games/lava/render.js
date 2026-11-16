// Rising Lava rendering: a volcanic crater at sunset. Hex basalt columns that glow as they heat up, a flowing
// lava shader that lights the scene from below, floating slabs, obsidian blinkers, pumice rafts, the shared
// avatars, name tags, a chase camera with shake.
import * as THREE from 'three';
import { C, ST_CRUMBLE, ST_GONE } from './world.js';

const INK = 0x17112e;
const TAU = Math.PI * 2;
const v3 = new THREE.Vector3(), c1 = new THREE.Color(), c2 = new THREE.Color();

const LAVA_VS = `varying vec2 vP; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vP = w.xz; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const LAVA_FS = `
uniform float uT, uHot; varying vec2 vP; varying vec3 vW;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a * n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
void main(){
  vec2 p = vP * .16;
  vec2 flow = vec2(fbm(p + uT * .05), fbm(p + 4.1 - uT * .04));
  float f = fbm(p * 1.7 + flow * 2.2 + vec2(uT * .03, -uT * .02));
  // cells of dark crust separated by bright cracks
  float cells = abs(fbm(p * 3.1 + flow * 1.5 - uT * .025) - .5) * 2.;
  float crack = 1. - smoothstep(.03, .2, cells);
  vec3 deep = vec3(.62, .07, .02), mid = vec3(1., .33, .03), hot = vec3(1., .86, .32);
  vec3 col = mix(deep, mid, smoothstep(.3, .75, f));
  col = mix(col, hot, crack * .9);
  col *= .85 + .3 * sin(uT * 1.7 + f * 6.);
  col += hot * uHot * .25;
  float rim = smoothstep(14.2, 16.4, length(vP));
  col = mix(col, col * .45, rim);
  gl_FragColor = vec4(col, 1.);
}`;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function gradTex(stops) {
  const d = new Uint8Array(stops); const t = new THREE.DataTexture(d, stops.length, 1, THREE.RedFormat); t.needsUpdate = true; return t;
}

export function createView(ctx) {
  const renderer = ctx.three.createRenderer();
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 400);
  const GRAD = gradTex([70, 150, 255]);
  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: GRAD, ...extra });

  // ---- sky: sunset gradient dome + far volcano silhouettes
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color(0x3a1650) }, uMid: { value: new THREE.Color(0xff6a3a) }, uLow: { value: new THREE.Color(0xffc46b) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 uTop, uMid, uLow; varying vec3 vD; void main(){ float y = vD.y; vec3 c = mix(uLow, uMid, smoothstep(-.05, .18, y)); c = mix(c, uTop, smoothstep(.18, .75, y)); gl_FragColor = vec4(c, 1.); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), skyMat); scene.add(sky);
  scene.fog = new THREE.Fog(0xb8463a, 60, 190);

  // ---- lights
  const hemi = new THREE.HemisphereLight(0xffd2b0, 0xff5a1a, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b8, 1.7); sun.position.set(-18, 34, 14);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 90 });
  sun.shadow.bias = -0.0008; scene.add(sun); scene.add(sun.target);
  const lavaLight = new THREE.PointLight(0xff6a1a, 60, 26, 1.6); scene.add(lavaLight);
  const applyQ = () => { const q = ctx.quality(); ctx.three.applyQuality(renderer, sun); sun.castShadow = q.shadows; if (q.shadowMap) sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); };
  applyQ();

  // ---- crater wall + distant mountains (static)
  const world = new THREE.Group(); scene.add(world);
  const wallGeo = new THREE.CylinderGeometry(17.5, 21, 26, 48, 6, true);
  { const pos = wallGeo.attributes.position; for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), a = Math.atan2(pos.getZ(i), pos.getX(i)); const k = 1 + 0.06 * Math.sin(a * 7 + y * 0.4) + 0.04 * Math.sin(a * 17); pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); if (y > 12) pos.setY(i, y + Math.sin(a * 5) * 2.4 + Math.sin(a * 11) * 1.2); } wallGeo.computeVertexNormals(); }
  const wall = new THREE.Mesh(wallGeo, toon(0x5a2f3a, { side: THREE.BackSide })); wall.position.y = 6; wall.receiveShadow = true; world.add(wall);
  const rimGeo = new THREE.TorusGeometry(19.5, 2.2, 6, 48); const rim = new THREE.Mesh(rimGeo, toon(0x4a2430)); rim.rotation.x = Math.PI / 2; rim.position.y = 19.5; world.add(rim);
  const mtnMat = toon(0x6b2a3c);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + 0.3, r = 110 + (i % 3) * 25, h = 30 + ((i * 37) % 30); const m = new THREE.Mesh(new THREE.ConeGeometry(28 + (i % 4) * 6, h, 7), mtnMat); m.position.set(Math.cos(a) * r, h / 2 - 12, Math.sin(a) * r); world.add(m); }

  // ---- lava
  const lavaMat = new THREE.ShaderMaterial({ vertexShader: LAVA_VS, fragmentShader: LAVA_FS, uniforms: { uT: { value: 0 }, uHot: { value: 0 } }, fog: false });
  const lava = new THREE.Mesh(new THREE.CircleGeometry(19, 64), lavaMat); lava.rotation.x = -Math.PI / 2; scene.add(lava);
  const glowTex = glowTexture();

  // ---- shared platform geometry / materials
  const G = { hex: new THREE.CylinderGeometry(1, 1, 1, 6), cap: new THREE.CylinderGeometry(1, 1, 0.12, 6), slab: new THREE.CylinderGeometry(1, 0.85, 1, 8), disc: new THREE.CylinderGeometry(1, 1, 1, 12), puff: new THREE.IcosahedronGeometry(1, 1) };
  G.hex.translate(0, -0.5, 0); G.slab.translate(0, -0.5, 0); G.disc.translate(0, -0.5, 0); G.cap.translate(0, -0.06, 0);
  const M = {
    basalt: toon(0x3d3a4e), outline: new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }),
    mover: toon(0xc98a4a), moverRim: toon(0xffd23f, { emissive: 0x553300 }), chain: new THREE.MeshBasicMaterial({ color: 0x2a1a22 }),
    glass: new THREE.MeshToonMaterial({ color: 0x8a5cff, gradientMap: GRAD, emissive: 0x2a0c66, transparent: true, opacity: 0.88 }),
    pumice: toon(0xd8c3a5),
  };
  const keepGeo = new Set(Object.values(G)), keepMat = new Set([...Object.values(M)]);
  const levelGroup = new THREE.Group(); scene.add(levelGroup);
  let platMeshes = [], prevSt = null, level = null;

  function buildLevel(lv) {
    // dispose the previous round's per-platform materials
    for (const pm of platMeshes) for (const m of pm.own) m.dispose();
    levelGroup.clear(); platMeshes = []; level = lv;
    const q = ctx.quality();
    for (const p of lv.plats) {
      const g = new THREE.Group(); g.position.set(p.x, p.top, p.z);
      const pm = { p, g, own: [], fall: 0, shake: 0, cap: null, capMat: null, body: null, gone: false, rise: 0 };
      if (p.kind === 'basalt') {
        const h = p.top + 14;
        const body = new THREE.Mesh(G.hex, M.basalt); body.scale.set(p.r, h, p.r); body.rotation.y = (p.id * 0.7) % TAU; body.castShadow = q.shadows; body.receiveShadow = true;
        const ol = new THREE.Mesh(G.hex, M.outline); ol.scale.set(p.r * 1.07, h, p.r * 1.07); ol.rotation.y = body.rotation.y; ol.position.y = 0.04;
        const capMat = toon(0x6e6a86, { emissive: 0x000000 }); pm.own.push(capMat);
        const cap = new THREE.Mesh(G.cap, capMat); cap.scale.set(p.r * 0.98, 1, p.r * 0.98); cap.rotation.y = body.rotation.y; cap.position.y = 0.02; cap.receiveShadow = true;
        g.add(body, ol, cap); pm.cap = cap; pm.capMat = capMat; pm.body = body;
      } else if (p.kind === 'mover') {
        const body = new THREE.Mesh(G.slab, M.mover); body.scale.set(p.r, p.thick, p.r); body.castShadow = q.shadows; body.receiveShadow = true;
        const ol = new THREE.Mesh(G.slab, M.outline); ol.scale.set(p.r * 1.08, p.thick * 1.15, p.r * 1.08); ol.position.y = 0.04;
        const rimM = new THREE.Mesh(G.disc, M.moverRim); rimM.scale.set(p.r * 1.02, 0.1, p.r * 1.02); rimM.position.y = 0.0;
        g.add(body, ol, rimM);
        if (p.m.type === 'lift') { const ch = new THREE.Mesh(G.disc, M.chain); ch.scale.set(0.08, 30, 0.08); ch.position.y = 30; g.add(ch); }
        pm.body = body;
      } else if (p.kind === 'glass') {
        const mat = M.glass.clone(); pm.own.push(mat);
        const body = new THREE.Mesh(G.hex, mat); body.scale.set(p.r, p.thick, p.r); body.castShadow = q.shadows;
        const ol = new THREE.Mesh(G.hex, M.outline); ol.scale.set(p.r * 1.08, p.thick * 1.2, p.r * 1.08); ol.position.y = 0.04;
        g.add(body, ol); pm.body = body; pm.capMat = mat;
      } else if (p.kind === 'pumice') {
        const mat = toon(0xd8c3a5, { emissive: 0x000000 }); pm.own.push(mat);
        const body = new THREE.Mesh(G.puff, mat); body.scale.set(p.r, p.thick * 0.7, p.r); body.position.y = -p.thick * 0.35; body.castShadow = q.shadows; body.receiveShadow = true;
        const ol = new THREE.Mesh(G.puff, M.outline); ol.scale.set(p.r * 1.07, p.thick * 0.78, p.r * 1.07); ol.position.y = body.position.y;
        g.add(body, ol); pm.body = body; pm.capMat = mat;
      }
      levelGroup.add(g); platMeshes.push(pm);
    }
    prevSt = null;
  }

  // ---- players
  const bodies = new Map();
  for (const p of ctx.players) {
    const a = ctx.avatar.build(p); a.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
    scene.add(a); bodies.set(p.id, { a, shadow, squash: 0, dead: 0, lastY: 0, spin: 0, shove: 0 });
  }
  // name tags
  const tagLayer = document.createElement('div'); tagLayer.className = 'lv-tags'; ctx.container.appendChild(tagLayer);
  const tags = new Map();
  for (const p of ctx.players) { const e = document.createElement('div'); e.className = 'lv-tag' + (p.id === ctx.myId ? ' me' : ''); e.style.setProperty('--c', p.colorCss); e.textContent = p.name; tagLayer.appendChild(e); tags.set(p.id, e); }

  // ---- particles (embers, sparks, smoke puffs): one additive Points cloud
  const MAXP = 700;
  const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pSize = new Float32Array(MAXP);
  const parts = [];
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3)); pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: glowTex }, uScale: { value: 300 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D uTex; varying vec3 vC; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC * t.a, t.a); }',
  });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
  function spawn(x, y, z, vx, vy, vz, life, size, col, grav = -6) { if (parts.length >= MAXP) parts.shift(); parts.push({ x, y, z, vx, vy, vz, life, max: life, size, r: col.r, g: col.g, b: col.b, grav }); }
  const FIRE = new THREE.Color(1, 0.55, 0.12), SPARK = new THREE.Color(1, 0.85, 0.4), WHITE = new THREE.Color(1, 1, 1);
  const burst = (x, y, z, n, speed, col, life = 0.8, size = 0.5, up = 4, grav = -9) => { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, s = Math.random() * speed; spawn(x, y, z, Math.cos(a) * s, up * (0.4 + Math.random()), Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), col, grav); } };

  // ---- shove rings
  const ringGeo = new THREE.RingGeometry(0.6, 0.85, 24, 1, -0.9, 1.8);
  const rings = [];
  function shoveRing(x, y, z, face, color) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, y + 0.8, z); m.rotation.set(-Math.PI / 2, 0, -face + Math.PI / 2); scene.add(m); rings.push({ m, t: 0 });
  }

  // ---- camera rig
  const cam = { yaw: 0, pitch: 0.5, dist: 10, x: 0, y: 4, z: 0, shake: 0, intro: 0 };
  camera.position.set(0, 20, 26);

  function resize() { const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); pMat.uniforms.uScale.value = h * 0.6; }
  resize();

  const tmpCol = new THREE.Color();
  function update(dt, now, s) {
    const t = now / 1000;
    lavaMat.uniforms.uT.value = t;
    lava.position.y = s.lava;
    lavaLight.position.set(cam.x, s.lava + 2.5, cam.z); lavaLight.intensity = 55 + Math.sin(t * 3) * 8;
    // platforms
    if (level && s.S) {
      for (let i = 0; i < platMeshes.length; i++) {
        const pm = platMeshes[i], p = pm.p, sl = s.S[i], st = s.st[i];
        const was = prevSt ? prevSt[i] : st;
        if (p.kind === 'basalt') {
          if (st === ST_GONE && was !== ST_GONE) { pm.fall = 0.001; if (sl.top > s.lava - 0.5) { burst(p.x, p.top, p.z, 26, 4, FIRE, 0.9, 0.7, 5); s.onCrumble?.(p); } }
          if (st !== ST_GONE && was === ST_GONE) { pm.fall = 0; pm.rise = 1; }
          if (st === ST_CRUMBLE && was !== ST_CRUMBLE) s.onCrack?.(p);
          const heat = st === ST_CRUMBLE ? 1 : st === ST_GONE ? 1 : st / 100;
          c1.set(0x6e6a86); c2.set(0xff7a1a); tmpCol.copy(c1).lerp(c2, Math.min(1, heat * 1.15));
          pm.capMat.color.copy(tmpCol); pm.capMat.emissive.setRGB(heat * heat * 0.9, heat * heat * 0.28, 0);
          let y = p.top, ox = 0, oz = 0;
          if (st === ST_CRUMBLE) { ox = (Math.random() - 0.5) * 0.14; oz = (Math.random() - 0.5) * 0.14; }
          else if (heat > 0.6) { const k = (heat - 0.6) * 0.06; ox = (Math.random() - 0.5) * k; oz = (Math.random() - 0.5) * k; }
          if (st === ST_GONE) { pm.fall += dt; y = p.top - pm.fall * pm.fall * 9; pm.g.visible = y > s.lava - 3; }
          else { pm.g.visible = true; if (pm.rise > 0) { pm.rise = Math.max(0, pm.rise - dt * 1.6); y = p.top - pm.rise * pm.rise * 4; } }
          pm.g.position.set(p.x + ox, y, p.z + oz);
          if (heat > 0.35 && Math.random() < heat * dt * 6) spawn(p.x + (Math.random() - 0.5) * p.r, p.top + 0.1, p.z + (Math.random() - 0.5) * p.r, 0, 1.5 + Math.random(), 0, 0.9, 0.35, FIRE, 1);
        } else if (p.kind === 'mover') {
          pm.g.position.set(sl.x, sl.top, sl.z);
        } else if (p.kind === 'glass') {
          pm.g.visible = sl.solid || (prevSt && false);
          const blink = sl.warn ? (Math.sin(t * 22) > 0 ? 1 : 0.35) : 1;
          pm.capMat.opacity = 0.88 * blink; pm.capMat.emissive.setRGB(0.16 + (sl.warn ? 0.5 * blink : 0), 0.05, 0.4);
        } else if (p.kind === 'pumice') {
          pm.g.position.set(sl.x, sl.top + Math.sin(t * 2 + i) * 0.03, sl.z);
          pm.g.rotation.y = t * 0.2 + i;
          const sink = Math.min(1, st / 100 / C.PUMICE_FLOAT);
          c1.set(0xd8c3a5); c2.set(0xff5a1a); pm.capMat.color.copy(c1).lerp(c2, sink); pm.capMat.emissive.setRGB(sink * 0.6, sink * 0.15, 0);
          pm.g.visible = sl.top > s.lava - 1.2;
        }
      }
      prevSt = Uint16Array.from(s.st);
    }
    // players
    const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
    for (const [id, b] of bodies) {
      const p = s.players.get(id), tag = tags.get(id);
      if (!p) { b.a.visible = false; b.shadow.visible = false; tag.style.display = 'none'; continue; }
      if (!p.alive) {
        if (b.dead === 0) b.dead = 0.0001;
        b.dead += dt;
        b.a.visible = b.dead < 1.4; b.shadow.visible = false; tag.style.display = 'none';
        if (b.a.visible) { b.a.position.y += dt * (3 - b.dead * 3); b.a.rotation.y += dt * 10; b.a.scale.setScalar(Math.max(0.01, 1 - b.dead * 0.7)); if (Math.random() < 0.6) spawn(b.a.position.x, b.a.position.y + 0.8, b.a.position.z, (Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2, 0.6, 0.6, FIRE, 2); }
        continue;
      }
      if (b.dead) { b.dead = 0; b.a.scale.setScalar(1); }
      b.a.visible = true;
      b.a.position.set(p.x, p.y, p.z);
      b.a.rotation.y = p.face;
      const air = !p.grounded;
      if (b.wasAir && !air) b.squash = 1;
      b.wasAir = air;
      b.squash = Math.max(0, b.squash - dt * 5);
      const sq = b.squash * 0.25, st2 = air ? Math.min(0.18, Math.abs(p.vy || 0) * 0.02) : 0;
      b.a.scale.set(1 + sq - st2 * 0.5, 1 - sq + st2, 1 + sq - st2 * 0.5);
      b.a.userData.setPose({ run: p.grounded ? Math.min(1, Math.hypot(p.vx || 0, p.vz || 0) / C.RUN) : 0.3, t, jump: 0 });
      b.a.userData.rig.rotation.x = p.shoving ? 0.35 : p.dashing ? 0.5 : p.stunned ? -0.3 : 0;
      if (p.stunned) b.a.userData.rig.rotation.z = Math.sin(t * 30) * 0.2;
      if (p.dashing && Math.random() < 0.8) spawn(p.x, p.y + 0.8, p.z, 0, 0.5, 0, 0.35, 0.7, WHITE, 0);
      // blob shadow on the highest solid below
      let gy = s.lava;
      if (s.S) for (const sl of s.S) { if (!sl.solid || sl.top > p.y + 0.05 || sl.top < gy) continue; if (Math.hypot(sl.x - p.x, sl.z - p.z) < sl.r) gy = sl.top; }
      b.shadow.visible = true; b.shadow.position.set(p.x, gy + 0.03, p.z); const hgt = p.y - gy; b.shadow.scale.setScalar(Math.max(0.4, 1 - hgt * 0.08)); b.shadow.material.opacity = Math.max(0.1, 0.4 - hgt * 0.03);
      // tag
      v3.set(p.x, p.y + 2.25, p.z).project(camera);
      if (v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1) { tag.style.display = ''; tag.style.transform = `translate(${((v3.x + 1) / 2) * W}px, ${((1 - v3.y) / 2) * H}px) translate(-50%, -100%)`; }
      else tag.style.display = 'none';
    }
    // particles
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.life -= dt; if (q.life <= 0) { parts.splice(i, 1); continue; }
      q.vy += q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }
    for (const q of parts) { const f = q.life / q.max; pPos[n * 3] = q.x; pPos[n * 3 + 1] = q.y; pPos[n * 3 + 2] = q.z; pCol[n * 3] = q.r * f; pCol[n * 3 + 1] = q.g * f; pCol[n * 3 + 2] = q.b * f; pSize[n] = q.size * (0.5 + f * 0.5); n++; }
    pGeo.setDrawRange(0, n); pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = pGeo.attributes.size.needsUpdate = true;
    // ambient embers rising off the lava
    if (Math.random() < dt * 30) { const a = Math.random() * TAU, r = Math.random() * 15; spawn(Math.cos(a) * r, s.lava + 0.1, Math.sin(a) * r, (Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 0.6, 2.5 + Math.random() * 2, 0.25 + Math.random() * 0.25, SPARK, 0.3); }
    for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.t += dt; const k = r.t / 0.3; r.m.scale.setScalar(1 + k * 1.6); r.m.material.opacity = Math.max(0, 0.9 * (1 - k)); if (k >= 1) { r.m.material.dispose(); r.m.removeFromParent(); rings.splice(i, 1); } }
    // camera
    cam.shake = Math.max(0, cam.shake - dt * 2.2);
    const sh = cam.shake * cam.shake * 0.6;
    if (cam.intro > 0) {
      const a = cam.introA + (1 - cam.intro) * 0.9;
      const k = Math.min(1, Math.max(0, (1 - cam.intro) * 1.0));
      const ix = Math.cos(a) * 14, iz = Math.sin(a) * 14, iy = 17 - k * 3;
      const tx = cam.x + Math.sin(cam.yaw) * -cam.dist * Math.cos(cam.pitch), tz = cam.z + Math.cos(cam.yaw) * -cam.dist * Math.cos(cam.pitch), ty = cam.y + 1.2 + Math.sin(cam.pitch) * cam.dist;
      const e = cam.intro < 0.35 ? 1 - cam.intro / 0.35 : 0, ee = e * e * (3 - 2 * e);
      camera.position.set(ix + (tx - ix) * ee, iy + (ty - iy) * ee, iz + (tz - iz) * ee);
      v3.set(cam.x * ee, (s.lava + 3) * (1 - ee) + (cam.y + 1.2) * ee, cam.z * ee); camera.lookAt(v3);
    } else {
      const cp = Math.cos(cam.pitch);
      camera.position.set(cam.x - Math.sin(cam.yaw) * cam.dist * cp, cam.y + 1.2 + Math.sin(cam.pitch) * cam.dist, cam.z - Math.cos(cam.yaw) * cam.dist * cp);
      // keep the camera out of the crater wall
      const rr = Math.hypot(camera.position.x, camera.position.z); if (rr > 16.5) { camera.position.x *= 16.5 / rr; camera.position.z *= 16.5 / rr; }
      camera.position.y = Math.max(camera.position.y, s.lava + 1.2);
      camera.lookAt(cam.x, cam.y + 1.2, cam.z);
    }
    if (sh > 0) { camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; }
    sun.position.set(cam.x - 18, cam.y + 34, cam.z + 14); sun.target.position.set(cam.x, cam.y, cam.z);
    renderer.render(scene, camera);
  }

  return {
    renderer, scene, camera, cam, buildLevel, update, resize, applyQ,
    fx: {
      shove(x, y, z, face, color) { shoveRing(x, y, z, face, color); },
      hit(x, y, z) { burst(x, y + 0.9, z, 18, 6, SPARK, 0.4, 0.5, 3, -4); burst(x, y + 0.9, z, 6, 3, WHITE, 0.25, 0.9, 1, 0); },
      die(x, y, z) { burst(x, y, z, 50, 6, FIRE, 1.1, 0.9, 9, -10); burst(x, y, z, 24, 3, SPARK, 1.4, 0.5, 12, -12); },
      land(x, y, z, k) { burst(x, y + 0.05, z, Math.round(4 + k * 6), 2.5, new THREE.Color(0.6, 0.55, 0.6), 0.35, 0.35, 0.6, -2); },
      shake(k) { cam.shake = Math.max(cam.shake, k); },
    },
    dispose() {
      for (const pm of platMeshes) for (const m of pm.own) m.dispose();
      for (const r of rings) r.m.material.dispose();
      for (const b of bodies.values()) { ctx.avatar.dispose(b.a); b.shadow.geometry.dispose(); b.shadow.material.dispose(); b.shadow.removeFromParent(); }
      ctx.three.dispose(scene);
      for (const g of keepGeo) g.dispose();
      for (const m of keepMat) m.dispose();
      GRAD.dispose(); glowTex.dispose(); ringGeo.dispose();
      tagLayer.remove();
    },
  };
}
