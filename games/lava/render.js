// Rising Lava rendering: a volcanic crater at sunset. Hex basalt columns that glow as they heat up, a flowing
// lava shader that lights the scene from below, floating slabs, obsidian blinkers, pumice rafts, the shared
// avatars, name tags, a chase camera with shake.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { C, ST_CRUMBLE, ST_GONE } from './world.js';

// Heat haze + warm grade + vignette (High quality only). Wobble is strongest low on the screen (near the lava).
const HAZE = {
  uniforms: { tDiffuse: { value: null }, uT: { value: 0 }, uAmt: { value: 0.5 }, uDanger: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uT, uAmt, uDanger; varying vec2 vUv;
  void main(){
    float k = (0.35 + 0.65 * smoothstep(0.75, 0.0, vUv.y)) * uAmt * 0.0035;
    vec2 o = vec2(sin(vUv.y * 70. + uT * 4.1) + sin(vUv.y * 31. - uT * 2.3), cos(vUv.x * 50. + uT * 3.3)) * k;
    vec4 c = texture2D(tDiffuse, vUv + o);
    vec2 d = vUv - .5; float v = smoothstep(.85, .25, length(d * vec2(1.1, 1.)));
    c.rgb *= mix(1., v, .55 + uDanger * .3);
    c.rgb += vec3(.5, .08, 0.) * (1. - v) * uDanger * .55;
    gl_FragColor = c;
  }`,
};

const INK = 0x17112e;
const TAU = Math.PI * 2;
const v3 = new THREE.Vector3(), c1 = new THREE.Color(), c2 = new THREE.Color();

const LAVA_VS = `uniform float uT; varying vec2 vP; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); w.y += sin(w.x * .55 + uT * 1.3) * .09 + sin(w.z * .7 - uT * 1.1) * .08 + sin((w.x + w.z) * 1.3 + uT * 2.) * .03; vP = w.xz; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
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
  float crack = 1. - smoothstep(.02, .1, cells);
  vec3 deep = vec3(.45, .04, .02), mid = vec3(.92, .26, .02), hot = vec3(1., .72, .2);
  vec3 col = mix(deep, mid, smoothstep(.38, .8, f));
  col = mix(col, hot, crack * .9);
  col *= .85 + .3 * sin(uT * 1.7 + f * 6.);
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
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
  const hemi = new THREE.HemisphereLight(0xffd2b0, 0xff6a2a, 1.05); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b8, 1.7); sun.position.set(-18, 34, 14);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 90 });
  sun.shadow.bias = -0.0008; scene.add(sun); scene.add(sun.target);
  const lavaLight = new THREE.PointLight(0xff6a1a, 4, 20, 1); scene.add(lavaLight);
  let low = false;
  const applyQ = () => { const q = ctx.quality(); low = !q.shadows; ctx.three.applyQuality(renderer, sun); sun.castShadow = q.shadows; if (q.shadowMap) sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); if (typeof setupPost === 'function' && wallReady) { setupPost(); sizePost(); } };
  let wallReady = false;
  applyQ();

  // ---- crater wall + distant mountains (static)
  const world = new THREE.Group(); scene.add(world);
  const wallGeo = new THREE.CylinderGeometry(17.5, 21, 90, 48, 18, true);
  { const pos = wallGeo.attributes.position; for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), a = Math.atan2(pos.getZ(i), pos.getX(i)); const k = 1 + 0.06 * Math.sin(a * 7 + y * 0.4) + 0.04 * Math.sin(a * 17); pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); if (y > 44) pos.setY(i, y + Math.sin(a * 5) * 2.4 + Math.sin(a * 11) * 1.2); } wallGeo.computeVertexNormals(); }
  const wall = new THREE.Mesh(wallGeo, toon(0x5a2f3a, { side: THREE.BackSide })); wall.position.y = 35; wall.receiveShadow = true; world.add(wall);
  const rimGeo = new THREE.TorusGeometry(19.5, 2.2, 6, 48); const rim = new THREE.Mesh(rimGeo, toon(0x4a2430)); rim.rotation.x = Math.PI / 2; rim.position.y = 80; world.add(rim);
  const mtnMat = toon(0x6b2a3c);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + 0.3, r = 110 + (i % 3) * 25, h = 30 + ((i * 37) % 30); const m = new THREE.Mesh(new THREE.ConeGeometry(28 + (i % 4) * 6, h, 7), mtnMat); m.position.set(Math.cos(a) * r, h / 2 - 12, Math.sin(a) * r); world.add(m); }

  // ---- lava
  const lavaMat = new THREE.ShaderMaterial({ vertexShader: LAVA_VS, fragmentShader: LAVA_FS, uniforms: { uT: { value: 0 }, uHot: { value: 0 } }, fog: false });
  const lava = new THREE.Mesh(new THREE.RingGeometry(0, 19, 72, 28), lavaMat); lava.rotation.x = -Math.PI / 2; scene.add(lava);
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
  // rocks glow orange where they meet the lava
  const lavaU = { value: 0 };
  const glowLine = (m) => { m.onBeforeCompile = (sh) => {
    sh.uniforms.uLavaY = lavaU;
    sh.vertexShader = 'varying float vWY;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = 'uniform float uLavaY; varying float vWY;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1.0, 0.33, 0.04) * (smoothstep(1.7, 0.0, vWY - uLavaY) * 0.75 + smoothstep(0.3, 0.0, abs(vWY - uLavaY)) * 1.3);');
  }; m.customProgramCacheKey = () => 'lavaglow'; return m; };
  glowLine(M.basalt); glowLine(M.mover); glowLine(wall.material);
  M.fade = toon(0x3d3a4e, { transparent: true, opacity: 0.22, depthWrite: false }); glowLine(M.fade);
  const keepGeo = new Set(Object.values(G)), keepMat = new Set([...Object.values(M)]);
  const levelGroup = new THREE.Group(); scene.add(levelGroup);
  let platMeshes = [], prevSt = null, level = null;

  function buildLevel(lv) {
    // dispose the previous round's per-platform materials
    for (const pm of platMeshes) for (const m of pm.own) m.dispose();
    levelGroup.clear(); platMeshes = []; level = lv;
    for (const id of [...bombs.keys()]) removeBomb(id);
    const q = ctx.quality();
    for (const p of lv.plats) {
      const g = new THREE.Group(); g.position.set(p.x, p.top, p.z);
      const pm = { p, g, own: [], fall: 0, shake: 0, cap: null, capMat: null, body: null, ol: null, gone: false, rise: 0, faded: false };
      if (p.kind === 'basalt') {
        const h = p.top + 14;
        const body = new THREE.Mesh(G.hex, M.basalt); body.scale.set(p.r, h, p.r); body.rotation.y = (p.id * 0.7) % TAU; body.castShadow = q.shadows; body.receiveShadow = true;
        const ol = new THREE.Mesh(G.hex, M.outline); ol.scale.set(p.r * 1.07, h, p.r * 1.07); ol.rotation.y = body.rotation.y; ol.position.y = 0.04;
        const capMat = toon(0x6e6a86, { emissive: 0x000000 }); pm.own.push(capMat);
        const cap = new THREE.Mesh(G.cap, capMat); cap.scale.set(p.r * 0.98, 1, p.r * 0.98); cap.rotation.y = body.rotation.y; cap.position.y = 0.02; cap.receiveShadow = true;
        g.add(body, ol, cap); pm.cap = cap; pm.capMat = capMat; pm.body = body; pm.ol = ol;
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
  const tags = new Map(), crowned = new Set();
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

  // ---- lava bombs (thrown by eliminated players) + the ghost aim cursor
  const bombGeo = new THREE.SphereGeometry(0.45, 14, 10), teleGeo = new THREE.RingGeometry(0.85, 1, 40), beamGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 6, 1, true);
  beamGeo.translate(0, 0.5, 0);
  const bombMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const bombs = new Map();
  function addBomb(b, colorHex, lavaY) {
    const a = Math.atan2(b.z, b.x) + (Math.random() - 0.5) * 0.8;
    const from = { x: Math.cos(a) * 15.5, z: Math.sin(a) * 15.5, y: lavaY };
    const m = new THREE.Mesh(bombGeo, bombMat);
    const ring = new THREE.Mesh(teleGeo, new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.scale.setScalar(C.BOMB_R);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0xff3a10, transparent: true, opacity: 0.25, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    scene.add(m, ring, fill);
    bombs.set(b.id, { b, m, ring, fill, from, col: new THREE.Color(colorHex) });
  }
  function removeBomb(id) { const e = bombs.get(id); if (!e) return; e.m.removeFromParent(); e.ring.material.dispose(); e.ring.removeFromParent(); e.fill.geometry.dispose(); e.fill.material.dispose(); e.fill.removeFromParent(); bombs.delete(id); }
  const aimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const aim = new THREE.Mesh(teleGeo, aimMat); aim.rotation.x = -Math.PI / 2; aim.visible = false; scene.add(aim);
  const beam = new THREE.Mesh(beamGeo, aimMat); beam.visible = false; scene.add(beam);
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2();

  // ---- falling basalt chunks (pooled)
  const chunkGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.4, 6);
  const chunks = [];
  for (let i = 0; i < 36; i++) { const m = new THREE.Mesh(chunkGeo, M.basalt); m.visible = false; scene.add(m); chunks.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 }); }
  let chunkI = 0;
  function debris(x, y, z, r, n = 7) {
    for (let i = 0; i < n; i++) { const c = chunks[chunkI++ % chunks.length]; const a = Math.random() * TAU; c.m.visible = true; c.m.position.set(x + Math.cos(a) * r * 0.6, y - Math.random() * 0.4, z + Math.sin(a) * r * 0.6); c.m.scale.setScalar(0.6 + Math.random() * 0.9); c.v.set(Math.cos(a) * (1 + Math.random() * 2.5), 2 + Math.random() * 4, Math.sin(a) * (1 + Math.random() * 2.5)); c.w.set(Math.random() * 8, Math.random() * 8, Math.random() * 8); c.life = 3; }
  }
  // geysers of fire from the lava (eruption at GO, splashes)
  const geysers = [];
  // ---- post-processing (High quality only)
  let composer = null, bloom = null, haze = null;
  function setupPost() {
    const q = ctx.quality();
    if (q.effects && !composer) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.45, 0.88); composer.addPass(bloom);
      haze = new ShaderPass(HAZE); composer.addPass(haze);
      composer.addPass(new OutputPass());
      sizePost();
    } else if (!q.effects && composer) disposePost();
  }
  function sizePost() { if (!composer) return; const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight; composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  function disposePost() { if (!composer) return; for (const p of composer.passes) p.dispose?.(); composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = bloom = haze = null; }

  // ---- camera rig
  const cam = { yaw: 0, pitch: 0.5, dist: 10, x: 0, y: 4, z: 0, shake: 0, intro: 0 };
  camera.position.set(0, 20, 26);

  function resize() { const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); pMat.uniforms.uScale.value = h * 0.6; sizePost(); }
  wallReady = true; setupPost(); resize();

  const tmpCol = new THREE.Color();
  function update(dt, now, s) {
    const t = now / 1000;
    lavaMat.uniforms.uT.value = t;
    lava.position.y = s.lava; lavaU.value = s.lava;
    lavaLight.position.set(cam.x, s.lava + 0.4, cam.z); lavaLight.intensity = 4 + Math.sin(t * 3) * 0.8;
    // platforms
    if (level && s.S) {
      for (let i = 0; i < platMeshes.length; i++) {
        const pm = platMeshes[i], p = pm.p, sl = s.S[i], st = s.st[i];
        const was = prevSt ? prevSt[i] : st;
        if ((p.kind === 'basalt' || p.kind === 'glass') && s.t < p.born) {
          // not risen yet: bubbling, glowing lava where the new rock is about to come up
          pm.g.visible = false;
          if (p.born - s.t < C.WARN_T && Math.random() < dt * (low ? 10 : 25)) { const a = Math.random() * TAU, rr = Math.random() * p.r; spawn(p.x + Math.cos(a) * rr, s.lava + 0.05, p.z + Math.sin(a) * rr, 0, 1.2 + Math.random() * 2, 0, 0.6, 0.7, SPARK, -2); }
          if (p.born - s.t < 0.05 && !pm.rose) { pm.rose = true; s.onRise?.(p); burst(p.x, s.lava, p.z, 14, 3, FIRE, 0.7, 0.7, 6); }
          continue;
        }
        if (p.kind === 'basalt') {
          if (st === ST_GONE && was !== ST_GONE) { pm.fall = 0.001; pm.goneTop = sl.top; if (sl.top > s.lava - 0.5) { burst(p.x, sl.top, p.z, 26, 4, FIRE, 0.9, 0.7, 5); debris(p.x, sl.top, p.z, p.r); s.onCrumble?.(p); } }
          if (st !== ST_GONE && was === ST_GONE) { pm.fall = 0; pm.rise = 1; }
          if (st === ST_CRUMBLE && was !== ST_CRUMBLE) s.onCrack?.(p);
          const heat = st === ST_CRUMBLE ? 1 : st === ST_GONE ? 1 : st / 100;
          c1.set(0x6e6a86); c2.set(0xff7a1a); tmpCol.copy(c1).lerp(c2, Math.min(1, heat * 1.15));
          pm.capMat.color.copy(tmpCol); pm.capMat.emissive.setRGB(heat * heat * 0.9, heat * heat * 0.28, 0);
          let y = sl.top, ox = 0, oz = 0;
          if (s.t - p.born < C.RISE_T && Math.random() < dt * 20) spawn(p.x + (Math.random() - 0.5) * p.r * 2, s.lava + 0.1, p.z + (Math.random() - 0.5) * p.r * 2, (Math.random() - 0.5) * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2, 0.8, 0.6, FIRE, -8);
          if (st === ST_CRUMBLE) { ox = (Math.random() - 0.5) * 0.14; oz = (Math.random() - 0.5) * 0.14; }
          else if (heat > 0.6) { const k = (heat - 0.6) * 0.06; ox = (Math.random() - 0.5) * k; oz = (Math.random() - 0.5) * k; }
          if (st === ST_GONE) { pm.fall += dt; y = (pm.goneTop ?? sl.top) - pm.fall * pm.fall * 9; pm.g.visible = y > s.lava - 3; }
          else pm.g.visible = y > s.lava - 3;
          pm.g.position.set(p.x + ox, y, p.z + oz);
          if (heat > 0.35 && Math.random() < heat * dt * 6) spawn(p.x + (Math.random() - 0.5) * p.r, sl.top + 0.1, p.z + (Math.random() - 0.5) * p.r, 0, 1.5 + Math.random(), 0, 0.9, 0.35, FIRE, 1);
        } else if (p.kind === 'mover') {
          pm.g.position.set(sl.x, sl.top, sl.z);
        } else if (p.kind === 'glass') {
          pm.g.visible = sl.solid && sl.top > s.lava - 1; pm.g.position.y = sl.top;
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
      b.a.userData.setPose({ run: p.grounded ? Math.min(1, Math.hypot(p.vx || 0, p.vz || 0) / C.RUN) : 0.3, t, jump: s.victory?.has(id) ? Math.abs(Math.sin(t * 7)) * 0.55 : 0 });
      if (s.victory?.has(id)) b.a.rotation.y = p.face + Math.sin(t * 3) * 0.6;
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
    for (const c of chunks) { if (!c.m.visible) continue; c.life -= dt; c.v.y -= 22 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += c.w.x * dt; c.m.rotation.z += c.w.z * dt; if (c.m.position.y < s.lava - 0.5 || c.life <= 0) { c.m.visible = false; if (c.life > 0) burst(c.m.position.x, s.lava, c.m.position.z, 3, 1.5, FIRE, 0.5, 0.4, 2); } }
    for (let i = geysers.length - 1; i >= 0; i--) { const g = geysers[i]; g.t -= dt; if (g.t <= 0) { geysers.splice(i, 1); continue; } const n = low ? 2 : 5; for (let k = 0; k < n; k++) spawn(g.x + (Math.random() - 0.5) * 0.8, s.lava, g.z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.5, g.v * (0.7 + Math.random() * 0.5), (Math.random() - 0.5) * 1.5, 1.1, 0.9 + Math.random() * 0.6, Math.random() < 0.4 ? SPARK : FIRE, -14); }
    // ambient embers rising off the lava
    if (Math.random() < dt * (low ? 12 : 30)) { const a = Math.random() * TAU, r = Math.random() * 15; spawn(Math.cos(a) * r, s.lava + 0.1, Math.sin(a) * r, (Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 0.6, 2.5 + Math.random() * 2, 0.25 + Math.random() * 0.25, SPARK, 0.3); }
    for (const [id, e] of bombs) {
      const p = Math.max(0, Math.min(1, 1 - (e.b.land - s.t) / C.BOMB_T));
      const gy = s.groundAt ? s.groundAt(e.b.x, e.b.z) : s.lava;
      e.m.position.set(e.from.x + (e.b.x - e.from.x) * p, e.from.y + (gy - e.from.y) * p + 10 * 4 * p * (1 - p), e.from.z + (e.b.z - e.from.z) * p);
      e.m.rotation.x += dt * 8;
      if (Math.random() < 0.9) spawn(e.m.position.x, e.m.position.y, e.m.position.z, (Math.random() - 0.5), 0.5, (Math.random() - 0.5), 0.5, 0.8, e.col, 0);
      e.ring.position.set(e.b.x, gy + 0.06, e.b.z); e.fill.position.set(e.b.x, gy + 0.05, e.b.z);
      e.ring.scale.setScalar(C.BOMB_R * (1.25 - 0.25 * p)); e.ring.material.opacity = 0.5 + 0.5 * Math.abs(Math.sin(t * (6 + p * 14)));
      e.fill.scale.setScalar(C.BOMB_R * p); e.fill.material.opacity = 0.15 + p * 0.3;
      if (p >= 1 && s.t > e.b.land + 0.5) removeBomb(id);
    }
    for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.t += dt; const k = r.t / (r.big ? 0.45 : 0.3); r.m.scale.setScalar(r.big ? 0.5 + k * C.BOMB_R * 1.6 : 1 + k * 1.6); r.m.material.opacity = Math.max(0, 0.9 * (1 - k)); if (k >= 1) { r.m.material.dispose(); r.m.removeFromParent(); rings.splice(i, 1); } }
    // camera
    cam.shake = Math.max(0, cam.shake - dt * 2.2);
    const sh = cam.shake * cam.shake * 0.6;
    if (cam.intro > 0) {
      // crane shot: high above the crater looking down at the lava, spiralling down to land behind the player
      const u = 1 - cam.intro, a = cam.introA + u * 1.7;
      const rad = 2.5 + u * 12, iy = 34 - u * 17;
      const ix = Math.cos(a) * rad, iz = Math.sin(a) * rad;
      const cp = Math.cos(cam.pitch);
      const tx = cam.x - Math.sin(cam.yaw) * cam.dist * cp, tz = cam.z - Math.cos(cam.yaw) * cam.dist * cp, ty = cam.y + 1.2 + Math.sin(cam.pitch) * cam.dist;
      const e = cam.intro < 0.4 ? 1 - cam.intro / 0.4 : 0, ee = e * e * (3 - 2 * e);
      camera.position.set(ix + (tx - ix) * ee, iy + (ty - iy) * ee, iz + (tz - iz) * ee);
      const lk = Math.min(1, u * 1.4);
      v3.set(cam.x * lk, (s.lava + 1) * (1 - lk) + (cam.y + 1.2) * lk, cam.z * lk); camera.lookAt(v3);
    } else {
      const cp = Math.cos(cam.pitch);
      camera.position.set(cam.x - Math.sin(cam.yaw) * cam.dist * cp, cam.y + 1.2 + Math.sin(cam.pitch) * cam.dist, cam.z - Math.cos(cam.yaw) * cam.dist * cp);
      // keep the camera out of the crater wall
      const rr = Math.hypot(camera.position.x, camera.position.z); if (rr > 16.5) { camera.position.x *= 16.5 / rr; camera.position.z *= 16.5 / rr; }
      camera.position.y = Math.max(camera.position.y, s.lava + 1.2);
      camera.lookAt(cam.x, cam.y + 1.2, cam.z);
    }
    if (sh > 0) { camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; }
    cam.kick = Math.max(0, (cam.kick || 0) - dt * 3);
    const fov = 58 + cam.kick * 8; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
    // fade columns that block the view of the player
    if (level && cam.intro <= 0) {
      const ax = camera.position.x, az = camera.position.z, ay = camera.position.y, bx = cam.x, bz = cam.z, by = cam.y + 0.8;
      const sx = bx - ax, sz = bz - az, L2 = sx * sx + sz * sz || 1;
      for (const pm of platMeshes) {
        if (pm.p.kind !== 'basalt') continue;
        const p = pm.p; let block = false;
        const u = ((p.x - ax) * sx + (p.z - az) * sz) / L2;
        if (u > 0 && u < 0.92) { const qx = ax + sx * u - p.x, qz = az + sz * u - p.z; if (qx * qx + qz * qz < (p.r + 0.25) * (p.r + 0.25) && p.top > ay + (by - ay) * u - 0.2) block = true; }
        if (block !== pm.faded) { pm.faded = block; pm.body.material = block ? M.fade : M.basalt; pm.ol.visible = !block; pm.body.castShadow = !block && !low; }
      }
    }
    sun.position.set(cam.x - 18, cam.y + 34, cam.z + 14); sun.target.position.set(cam.x, cam.y, cam.z);
    if (composer) { haze.uniforms.uT.value = t; haze.uniforms.uDanger.value = s.danger || 0; haze.uniforms.uAmt.value = 0.6 + (s.danger || 0) * 1.2; composer.render(); }
    else renderer.render(scene, camera);
  }

  // ghost aiming: screen point (ndc) -> ground point on the plane y = h. show=false hides the cursor
  function aimAt(nx, ny, h, show, ready, colorHex, groundY) {
    aim.visible = beam.visible = show;
    if (!show) return null;
    ndc.set(nx, ny); ray.setFromCamera(ndc, camera); plane.constant = -h;
    const hit = ray.ray.intersectPlane(plane, v3); if (!hit) { aim.visible = beam.visible = false; return null; }
    const r = Math.hypot(hit.x, hit.z); if (r > 14.5) { hit.x *= 14.5 / r; hit.z *= 14.5 / r; }
    const gy = groundY(hit.x, hit.z);
    aimMat.color.set(ready ? colorHex : 0x777777); aimMat.opacity = ready ? 0.9 : 0.4;
    aim.position.set(hit.x, gy + 0.08, hit.z); aim.scale.setScalar(C.BOMB_R * (ready ? 1 + Math.sin(performance.now() / 120) * 0.05 : 0.7));
    beam.position.set(hit.x, gy, hit.z); beam.scale.set(1, 12, 1);
    return { x: hit.x, z: hit.z };
  }
  return {
    renderer, scene, camera, cam, buildLevel, update, resize, applyQ, aimAt,
    fx: {
      shove(x, y, z, face, color) { shoveRing(x, y, z, face, color); },
      crown(set) { for (const [id, e] of tags) { const p = ctx.player(id); e.textContent = (set.has(id) ? '👑 ' : '') + p.name; } },
      hit(x, y, z) { burst(x, y + 0.9, z, 18, 6, SPARK, 0.4, 0.5, 3, -4); burst(x, y + 0.9, z, 6, 3, WHITE, 0.25, 0.9, 1, 0); },
      die(x, y, z) { burst(x, y, z, 50, 6, FIRE, 1.1, 0.9, 9, -10); burst(x, y, z, 24, 3, SPARK, 1.4, 0.5, 12, -12); },
      land(x, y, z, k) { burst(x, y + 0.05, z, Math.round(4 + k * 6), 2.5, new THREE.Color(0.6, 0.55, 0.6), 0.35, 0.35, 0.6, -2); },
      shake(k) { cam.shake = Math.max(cam.shake, k); },
      bomb(b, colorHex, lavaY) { addBomb(b, colorHex, lavaY); },
      kick(k = 1) { cam.kick = Math.max(cam.kick || 0, k); },
      erupt(lavaY) { for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + Math.random() * 0.5, r = 13 + Math.random() * 2; geysers.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, t: 1.2 + Math.random() * 0.6, v: 9 + Math.random() * 5 }); } cam.shake = Math.max(cam.shake, 0.6); },
      splash(x, y, z) { geysers.push({ x, z, t: 0.45, v: 8 }); const r = new THREE.Mesh(teleGeo, new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })); r.rotation.x = -Math.PI / 2; r.position.set(x, y + 0.08, z); scene.add(r); rings.push({ m: r, t: 0, big: true }); },
      boom(id, x, y, z) {
        removeBomb(id);
        burst(x, y + 0.2, z, 60, 8, FIRE, 0.9, 0.9, 7, -12); burst(x, y + 0.2, z, 20, 4, SPARK, 1.2, 0.5, 10, -14);
        const r = new THREE.Mesh(teleGeo, new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
        r.rotation.x = -Math.PI / 2; r.position.set(x, y + 0.1, z); scene.add(r); rings.push({ m: r, t: 0, big: true });
      },
    },
    dispose() {
      for (const pm of platMeshes) for (const m of pm.own) m.dispose();
      for (const r of rings) r.m.material.dispose();
      // dispose the whole scene WITH the avatars still in it: that also releases the renderer's listeners on the
      // avatars' shared materials / geometries (otherwise they keep this renderer and scene alive)
      ctx.three.dispose(scene);
      for (const b of bodies.values()) ctx.avatar.dispose(b.a);
      for (const c of chunks) c.m.removeFromParent();
      for (const g of keepGeo) g.dispose();
      for (const m of keepMat) m.dispose();
      for (const id of [...bombs.keys()]) removeBomb(id);
      disposePost(); chunkGeo.dispose(); M.fade.dispose();
      GRAD.dispose(); glowTex.dispose(); ringGeo.dispose(); bombGeo.dispose(); teleGeo.dispose(); beamGeo.dispose(); bombMat.dispose(); aimMat.dispose();
      tagLayer.remove();
    },
  };
}
