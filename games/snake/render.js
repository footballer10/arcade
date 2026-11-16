// Rendering: a neon hex floor (one shader, which also draws the ring), instanced glowing snake bodies with ink
// outlines, heads with eyes + the player's hat, instanced orbs, additive particles, name tags, camera shake.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { radiusOf, lengthOf, spacingOf, orbSize } from './sim.js';

const MAX_SEG = 2600, MAX_ORBS = 1400, MAX_PART = 1800, PER_SNAKE = 320;
const INK = 0x17112e;
const tmpC2 = new THREE.Color(), tmpC3 = new THREE.Color();
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color(), WHITE = new THREE.Color(0xffffff);
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const SAMPLE = new Float32Array(PER_SNAKE * 2);

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const FLOOR_VS = `varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FLOOR_FS = `
uniform float uR, uT, uWarn; uniform vec3 uIn, uLine, uOut, uEdge; varying vec2 vP;
float hexEdge(vec2 p){ vec2 r = vec2(1., 1.7320508); vec2 h = r*.5; vec2 a = mod(p, r) - h; vec2 b = mod(p - h, r) - h; vec2 g = dot(a,a) < dot(b,b) ? a : b;
  g = abs(g); return .5 - max(dot(g, normalize(r)), g.x); }
void main(){
  float d = length(vP);
  float e = hexEdge(vP / 2.4);
  float line = 1. - smoothstep(.02, .07, e);
  float pulse = .5 + .5 * sin(d * .35 - uT * 2.2);
  vec3 col = uIn * (1.05 - d / (uR * 2.6)) + uLine * line * (.55 + .45 * pulse);
  // centre glow
  col += uLine * .25 * exp(-d * .05);
  // outside the ring: hazard
  float outside = smoothstep(uR - .2, uR + .4, d);
  float stripes = step(.5, fract((vP.x + vP.y) * .12 + uT * .4));
  vec3 oc = uOut * (.55 + .25 * stripes) + uEdge * line * .25;
  col = mix(col, oc, outside);
  // the ring itself
  float ring = exp(-abs(d - uR) * 2.2);
  col += uEdge * ring * (1.1 + uWarn * (.6 + .6 * sin(uT * 14.)));
  gl_FragColor = vec4(col, 1.);
}`;

export function createView(ctx, cfg) {
  const q = ctx.quality();
  const renderer = ctx.three.createRenderer();
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0820);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 600);
  camera.position.set(0, 60, 20); camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a1850, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-20, 40, 10); scene.add(sun);
  const keep = new Set();

  // ---- floor + ring
  const floorMat = new THREE.ShaderMaterial({
    vertexShader: FLOOR_VS, fragmentShader: FLOOR_FS,
    uniforms: { uR: { value: cfg.r0 }, uT: { value: 0 }, uWarn: { value: 0 }, uIn: { value: new THREE.Color(0x1a1240) }, uLine: { value: new THREE.Color(0x2e2170) }, uOut: { value: new THREE.Color(0x3a0a24) }, uEdge: { value: new THREE.Color(0xff3d7f) } },
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.scale.set(cfg.r0 * 2 + 160, cfg.r0 * 2 + 160, 1); scene.add(floor);

  // ---- rocks (Asteroid Belt): chunky faceted crystals with ink outlines and a magenta under-glow
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshToonMaterial({ color: 0x7a55d6, emissive: 0x2a1060 });
  const rockInk = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  const rockGlowMat = new THREE.MeshBasicMaterial({ color: 0xff3dd0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 });
  const rockQuad = new THREE.PlaneGeometry(1, 1);
  for (const r of cfg.rocks || []) {
    const m = new THREE.Mesh(rockGeo, rockMat); m.position.set(r.x, r.r * 0.35, r.y); m.scale.set(r.r * 1.05, r.r * 0.75, r.r * 1.05);
    m.rotation.set(r.seed * 3, r.seed * 7, r.seed * 5); scene.add(m);
    const o = new THREE.Mesh(rockGeo, rockInk); o.scale.setScalar(1.08); m.add(o);
  }

  // ---- Golden Bloom beacon: a pillar of light + pulsing floor ring
    const beacon = new THREE.Group(); beacon.visible = false; scene.add(beacon);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 30, 24, 1, true), beamMat); beam.position.y = 15; beacon.add(beam);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8, side: THREE.DoubleSide });
  const bRing = new THREE.Mesh(new THREE.RingGeometry(4.6, 5.4, 48), ringMat); bRing.rotation.x = -Math.PI / 2; bRing.position.y = 0.08; beacon.add(bRing);
  let bloomAt = 0, bloomEnd = 0;

  // ---- the King Snake's crown
  const crown = ctx.avatar.hat('crown', 0xffcc00); crown.visible = false; scene.add(crown);

  // ---- snakes (all bodies in three instanced meshes)
  const glowTex = glowTexture();
  rockGlowMat.map = glowTex;
  for (const r of cfg.rocks || []) { const g = new THREE.Mesh(rockQuad, rockGlowMat); g.rotation.x = -Math.PI / 2; g.position.set(r.x, 0.06, r.y); g.scale.setScalar(r.r * 3.4); scene.add(g); }
  const segGeo = new THREE.SphereGeometry(1, 16, 10);
  const bodyMat = new THREE.MeshToonMaterial({ color: 0xffffff });
  const body = new THREE.InstancedMesh(segGeo, bodyMat, MAX_SEG); body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.setColorAt(0, WHITE); body.frustumCulled = false; scene.add(body);
  const outline = new THREE.InstancedMesh(segGeo, new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }), MAX_SEG); outline.frustumCulled = false; scene.add(outline);
  const quad = new THREE.PlaneGeometry(1, 1);
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 });
  const glow = new THREE.InstancedMesh(quad, glowMat, MAX_SEG); glow.setColorAt(0, WHITE); glow.frustumCulled = false; glow.renderOrder = -1; scene.add(glow);

  // heads: eyes + hat per snake
  const eyeGeo = new THREE.SphereGeometry(1, 14, 10), eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff }), pupilMat = new THREE.MeshBasicMaterial({ color: INK });
  const heads = new Map();
  function head(p) {
    let h = heads.get(p.id); if (h) return h;
    const g = new THREE.Group(); scene.add(g);
    const eyes = [], pupils = [];
    for (const sd of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat); e.scale.setScalar(0.4); e.position.set(0.4, 0.5, sd * 0.44); g.add(e); eyes.push(e);
      const pp = new THREE.Mesh(eyeGeo, pupilMat); pp.scale.setScalar(0.22); g.add(pp); pupils.push([pp, sd]);
    }
    const hat = ctx.avatar.hat(p.hat || 'none', p.colorHex); hat.rotation.y = -Math.PI / 2; hat.position.set(-0.05, 0.62, 0); hat.scale.setScalar(1.15); g.add(hat);
    const tag = document.createElement('div'); tag.className = 'snk-tag'; tag.textContent = p.name; tag.style.setProperty('--c', p.colorCss); ctx.container.appendChild(tag);
    h = { g, eyes, pupils, hat, tag, crownT: 0 }; heads.set(p.id, h); return h;
  }

  // ---- orbs
  const orbGeo = new THREE.IcosahedronGeometry(1, 1);
  const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const orbs = new THREE.InstancedMesh(orbGeo, orbMat, MAX_ORBS); orbs.setColorAt(0, WHITE); orbs.frustumCulled = false; scene.add(orbs);
  const orbGlowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 });
  const orbGlow = new THREE.InstancedMesh(quad, orbGlowMat, MAX_ORBS); orbGlow.setColorAt(0, WHITE); orbGlow.frustumCulled = false; orbGlow.renderOrder = -1; scene.add(orbGlow);

  // ---- particles (additive points)
  const pPos = new Float32Array(MAX_PART * 3), pCol = new Float32Array(MAX_PART * 3), pSize = new Float32Array(MAX_PART);
  const pVel = new Float32Array(MAX_PART * 3), pLife = new Float32Array(MAX_PART), pMax = new Float32Array(MAX_PART), pBase = new Float32Array(MAX_PART);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: glowTex }, scale: { value: 400 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: 'attribute float size; varying vec3 vC; uniform float scale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a, t.a); }',
  });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
  let pNext = 0;
  function burst(x, y, color, n, speed = 8, size = 1.2, life = 0.8, up = 0) {
    tmpC.set(color);
    for (let i = 0; i < n; i++) {
      const k = pNext; pNext = (pNext + 1) % MAX_PART;
      const a = Math.random() * Math.PI * 2, sp = speed * (0.3 + Math.random() * 0.7);
      pPos[k * 3] = x; pPos[k * 3 + 1] = 0.6 + Math.random() * 0.4; pPos[k * 3 + 2] = y;
      pVel[k * 3] = Math.cos(a) * sp; pVel[k * 3 + 1] = up * Math.random(); pVel[k * 3 + 2] = Math.sin(a) * sp;
      pLife[k] = pMax[k] = life * (0.6 + Math.random() * 0.6); pBase[k] = size * (0.6 + Math.random() * 0.8);
      pCol[k * 3] = tmpC.r; pCol[k * 3 + 1] = tmpC.g; pCol[k * 3 + 2] = tmpC.b;
    }
  }
  function stepParticles(dt) {
    for (let k = 0; k < MAX_PART; k++) {
      if (pLife[k] <= 0) { pSize[k] = 0; continue; }
      pLife[k] -= dt;
      const drag = Math.exp(-dt * 3.5);
      pVel[k * 3] *= drag; pVel[k * 3 + 1] = pVel[k * 3 + 1] * drag - dt * 4; pVel[k * 3 + 2] *= drag;
      pPos[k * 3] += pVel[k * 3] * dt; pPos[k * 3 + 1] = Math.max(0.2, pPos[k * 3 + 1] + pVel[k * 3 + 1] * dt); pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
      pSize[k] = pBase[k] * Math.max(0, pLife[k] / pMax[k]);
    }
    pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = pGeo.attributes.size.needsUpdate = true;
  }

  // ---- shockwave rings (deaths, blooms, respawns)
  const shockGeo = new THREE.RingGeometry(0.82, 1, 64);
  const shocks = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.1; m.visible = false; m.userData.life = 0; scene.add(m); shocks.push(m);
  }
  let shockNext = 0;
  function shock(x, y, color, size = 8, life = 0.6) {
    const m = shocks[shockNext]; shockNext = (shockNext + 1) % shocks.length;
    m.position.set(x, 0.1, y); m.material.color.set(color); Object.assign(m.userData, { life, max: life, size }); m.visible = true;
  }
  function stepShocks(dt) {
    for (const m of shocks) {
      if (!m.visible) continue;
      const u = m.userData; u.life -= dt;
      if (u.life <= 0) { m.visible = false; continue; }
      const k = 1 - u.life / u.max;
      m.scale.setScalar(0.5 + u.size * (1 - (1 - k) * (1 - k)));
      m.material.opacity = (1 - k) * 0.9;
    }
  }

  // ---- post-processing (High only): bloom makes the neon actually glow
  let composer = null, bloomPass = null;
  function ensureComposer() {
    if (!ctx.quality().effects) return null;
    if (!composer) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 0.72);
      composer.addPass(bloomPass); composer.addPass(new OutputPass());
      sizeComposer();
    }
    return composer;
  }
  function sizeComposer() {
    if (!composer) return;
    const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight;
    composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
    bloomPass.resolution.set(w / 2, h / 2);
  }

  // ---- camera
  const cam = { x: 0, y: 0, h: cfg.r0 * 2.6, shake: 0, kick: 0, fov: 50 };
  const resize = () => {
    const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    pMat.uniforms.scale.value = h * 0.9;
    sizeComposer();
  };
  resize();

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
  // world point under the mouse
  function mouseWorld(mx, my) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((mx - r.left) / r.width) * 2 - 1, -((my - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(ground, hitP) ? { x: hitP.x, y: hitP.z } : null;
  }

  // ---- per frame
  // f: { t, dt, R, warn, snakes:[{p, x, y, a, aim, mass, alive, boost, trail, lead}], orbs: iterable, flying:[{x,y,v,c}], focus:{x,y,mass}, zoom }
  function draw(f) {
    const { dt } = f;
    floorMat.uniforms.uR.value = f.R; floorMat.uniforms.uT.value = f.t; floorMat.uniforms.uWarn.value = f.warn || 0;
    // snakes
    let n = 0;
    const seen = new Set();
    for (const s of f.snakes) {
      if (!s.alive || !s.trail || s.trail.x.length < 1) continue;
      seen.add(s.p.id);
      const r = radiusOf(s.mass), L = lengthOf(s.mass), sp = spacingOf(r);
      const cnt = s.trail.sample(L, sp, SAMPLE, Math.min(PER_SNAKE, MAX_SEG - n));
      const base = tmpC2.set(s.p.colorHex), skin = s.skin || 'stripes', ghost = s.ghost;
      const glowK = skin === 'neon' ? 4.4 : 3.4;
      // draw tail first so the head sits on top
      for (let k = cnt - 1; k >= 0; k--) {
        if (ghost && k % 2 && k > 0) continue;     // respawn ghost: see-through, flickery
        const x = SAMPLE[k * 2], y = SAMPLE[k * 2 + 1];
        const taper = k > cnt - 6 ? 0.55 + 0.45 * ((cnt - k) / 6) : 1;
        const rr = r * taper * (k === 0 ? 1.12 : 1);
        const yy = 0.5 + (cnt - k) * 0.0025;
        tmpP.set(x, yy, y); tmpS.set(rr, rr * 0.6, rr); tmpQ.identity();
        tmpM.compose(tmpP, tmpQ, tmpS); body.setMatrixAt(n, tmpM);
        tmpS.set(rr * 1.13, rr * 0.62, rr * 1.13); tmpP.y = yy - 0.02; tmpM.compose(tmpP, tmpQ, tmpS); outline.setMatrixAt(n, tmpM);
        tmpP.set(x, 0.05, y); tmpS.setScalar(rr * (s.boost ? glowK + 1.2 : glowK) * (ghost ? 0.5 : 1)); tmpM.compose(tmpP, FLAT, tmpS); glow.setMatrixAt(n, tmpM);
        // stripes + boost pulse running down the body
        let lum = skin === 'stripes' ? (k % 7 < 2 ? 0.25 : 0) : skin === 'dots' ? (k % 4 === 0 ? 0.45 : 0) : skin === 'neon' ? 0.12 + 0.1 * Math.sin(k * 0.5 - f.t * 6) : 0;
        if (s.boost) { const w = (k - f.t * 40) % 10; lum += (w < 0 ? w + 10 : w) < 2.5 ? 0.55 : 0.1; }
        if (ghost) lum += 0.45 + 0.3 * Math.sin(f.t * 30);
        tmpC3.copy(base);
        if (skin === 'bands' && k % 6 >= 3) tmpC3.multiplyScalar(0.55);
        body.setColorAt(n, tmpC3.lerp(WHITE, Math.min(1, lum))); glow.setColorAt(n, base);
        n++;
      }
      // head decorations
      const h = head(s.p);
      h.g.visible = true;
      h.g.position.set(s.x, 0.5 + cnt * 0.0025, s.y);
      h.g.rotation.y = -s.a;
      h.g.scale.setScalar(r * 1.12);
      const look = (s.aim ?? s.a) - s.a;
      for (const [pp, sd] of h.pupils) pp.position.set(0.47 + Math.cos(look) * 0.18, 0.72, sd * 0.44 + Math.sin(look) * 0.18);
    }
    body.count = outline.count = glow.count = n;
    body.instanceMatrix.needsUpdate = outline.instanceMatrix.needsUpdate = glow.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    for (const [id, h] of heads) if (!seen.has(id)) { h.g.visible = false; h.tag.style.display = 'none'; }
    const king = f.king && f.snakes.find((s) => s.p.id === f.king && s.alive);
    crown.visible = !!king;
    if (king) { const r = radiusOf(king.mass); crown.position.set(king.x, 2 + r * 1.6 + Math.sin(f.t * 4) * 0.3, king.y); crown.scale.setScalar(2.2 + r * 1.6); crown.rotation.y = f.t * 1.5; }
    if (f.bloom) {
      beacon.visible = true; beacon.position.set(f.bloom.x, 0, f.bloom.y);
      const left = f.bloom.at - f.simT, p = 0.5 + 0.5 * Math.sin(f.t * (left < 1 ? 26 : 12));
      beamMat.opacity = 0.18 + 0.25 * p; ringMat.opacity = 0.5 + 0.5 * p;
      const sc = 0.6 + Math.max(0, Math.min(1, left / 3)) * 0.9; bRing.scale.setScalar(sc);
    } else beacon.visible = false;
    // orbs
    let m = 0;
    const tt = f.t;
    const drawOrb = (o, sc = 1) => {
      if (m >= MAX_ORBS) return;
      const s0 = orbSize(o.v) * sc * (1 + 0.12 * Math.sin(tt * 4 + o.id));
      tmpP.set(o.x, 0.35, o.y); tmpS.setScalar(s0); tmpQ.identity(); tmpM.compose(tmpP, tmpQ, tmpS); orbs.setMatrixAt(m, tmpM);
      tmpP.y = 0.04; tmpS.setScalar(s0 * (o.k === 3 ? 8 : o.k === 1 ? 7 : 5.5)); tmpM.compose(tmpP, FLAT, tmpS); orbGlow.setMatrixAt(m, tmpM);
      tmpC.set(o.k === 3 ? 0xffd23f : o.k ? ctx.players[o.c]?.colorHex ?? PAL[o.c & 7] : PAL[o.c & 7]);
      orbGlow.setColorAt(m, tmpC); orbs.setColorAt(m, tmpC.lerp(WHITE, o.k === 3 ? 0.12 : 0.35));
      m++;
    };
    for (const o of f.orbs) drawOrb(o);
    for (const o of f.flying) drawOrb(o, Math.max(0.1, o.life / 0.18));
    orbs.count = orbGlow.count = m;
    orbs.instanceMatrix.needsUpdate = orbGlow.instanceMatrix.needsUpdate = true;
    if (orbs.instanceColor) orbs.instanceColor.needsUpdate = true;
    if (orbGlow.instanceColor) orbGlow.instanceColor.needsUpdate = true;
    stepParticles(dt); stepShocks(dt);
    // camera follows the focus, zooming out as it grows
    const fx = f.focus?.x ?? 0, fy = f.focus?.y ?? 0;
    const k = Math.min(1, dt * 5);
    cam.x += (fx - cam.x) * k; cam.y += (fy - cam.y) * k;
    let wantH = f.zoom ?? 34 + Math.sqrt(f.focus?.mass ?? 25) * 1.6;
    if (f.intro != null && f.intro < 1) {   // intro: the whole pit from high above, swooping down to your snake
      const e = 1 - Math.pow(1 - f.intro, 3);
      wantH = cfg.r0 * 2.6 + (wantH - cfg.r0 * 2.6) * e;
      cam.h = wantH; cam.x = fx * e; cam.y = fy * e;
    } else cam.h += (wantH - cam.h) * Math.min(1, dt * 2);
    const wantFov = 50 + (f.boost ? 7 : 0);
    if (Math.abs(wantFov - cam.fov) > 0.05) { cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 5); camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    cam.shake = Math.max(0, cam.shake - dt * 2.2);
    const sh = cam.shake * cam.shake * 1.6;
    camera.position.set(cam.x + (Math.random() - 0.5) * sh, cam.h, cam.y + cam.h * 0.32 + (Math.random() - 0.5) * sh);
    camera.lookAt(cam.x, 0, cam.y);
    const comp = ensureComposer();
    if (comp) comp.render(); else renderer.render(scene, camera);
    // name tags (after render, so the camera matrices are current)
    const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
    for (const s of f.snakes) {
      const h = heads.get(s.p.id); if (!h || !s.alive) continue;
      tmpP.set(s.x, 1.5, s.y).project(camera);
      const vis = tmpP.z < 1 && Math.abs(tmpP.x) < 1.1 && Math.abs(tmpP.y) < 1.1;
      h.tag.style.display = vis ? '' : 'none';
      if (vis) h.tag.style.transform = `translate(${((tmpP.x + 1) / 2) * W}px, ${((1 - tmpP.y) / 2) * H - 28}px) translate(-50%, -50%)`;
    }
  }
  const PAL = [0xff5a5f, 0x3ea6ff, 0x4cd964, 0xffcc00, 0xb57bff, 0xff8c42, 0x2ee6d6, 0xff6ec7];

  return {
    renderer, scene, camera, resize, draw, burst, shock, mouseWorld,
    setQuality() { ctx.three.applyQuality(renderer); if (!ctx.quality().effects && composer) { composer.dispose(); bloomPass.dispose(); composer = bloomPass = null; } resize(); },
    shake(v) { cam.shake = Math.min(1.2, Math.max(cam.shake, v)); },
    snapCamera(x, y) { cam.x = x; cam.y = y; },
    dispose() {
      for (const h of heads.values()) { ctx.avatar.dispose(h.hat); h.tag.remove(); }
      ctx.avatar.dispose(crown);
      if (composer) { composer.dispose(); bloomPass.dispose(); composer = bloomPass = null; }
      shockGeo.dispose();
      heads.clear();
      ctx.three.dispose(scene, keep);
      quad.dispose(); glowTex.dispose(); rockQuad.dispose(); eyeGeo.dispose(); pGeo.dispose(); pMat.dispose();
    },
  };
}
