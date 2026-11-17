// Prop Hunt rendering: a cozy roofless "dollhouse" (ceilings only show from below), merged toon geometry with
// ink outlines, decoy objects, players (bean avatar, or the object they became), first-person seekers with a
// squeaky hammer, third-person hiders, particles (poofs, stars, music notes), name tags and the blindfold.
import * as THREE from 'three';
import { Batch, KINDS, kindGeometry, disposeKindCache } from './props.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CELL, WH, WT, rayWorld } from './level.js';
import { SKINS } from '../../core/avatar.js';

// hammer swing curve: u = 0..1 over the swing -> arm angle (wind up high, smash down, recover)
const ease = (x) => x * x * (3 - 2 * x);
function swingCurve(u, rest, up, down) {
  if (u < 0.38) return rest + (up - rest) * ease(u / 0.38);          // wind up
  if (u < 0.58) return up + (down - up) * ((u - 0.38) / 0.2) ** 2;     // smash (accelerating)
  return down + (rest - down) * ease((u - 0.58) / 0.42);               // recover
}

// warm cozy grade + soft vignette (High quality only)
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uFlash: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uFlash; varying vec2 vUv;
  void main(){
    vec4 c = texture2D(tDiffuse, vUv);
    float l = dot(c.rgb, vec3(.299,.587,.114));
    c.rgb = mix(vec3(l), c.rgb, 1.12);                       // a little more saturation
    c.rgb *= vec3(1.04, 1.0, .94);                           // warm
    vec2 d = vUv - .5; float v = smoothstep(.9, .3, length(d * vec2(1.15, 1.)));
    c.rgb *= mix(.72, 1., v);
    c.rgb += vec3(1., .95, .8) * uFlash;
    gl_FragColor = c;
  }`,
};

const INK = 0x17112e;
const shadeHex = (h, k) => new THREE.Color(h).multiplyScalar(k).getHex();
const GRAD = (() => { const t = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat); t.needsUpdate = true; return t; })();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), _ctr = new THREE.Vector3(), _mL = new THREE.Matrix4(), _qL = new THREE.Quaternion();

function comic(g, s, txt, fill, burst) {
  g.translate(s / 2, s / 2); g.beginPath();
  for (let i = 0; i < 24; i++) { const r = i % 2 ? s * 0.3 : s * 0.47, a = (i / 24) * Math.PI * 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.62); }
  g.closePath(); g.fillStyle = burst; g.fill(); g.lineWidth = s * 0.025; g.strokeStyle = '#17112e'; g.stroke();
  g.rotate(-0.12); g.font = `${s * 0.2}px "Lilita One", Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = s * 0.045; g.strokeStyle = '#17112e'; g.strokeText(txt, 0, 0); g.fillStyle = fill; g.fillText(txt, 0, 0);
}
// procedural floor textures (white-ish, tinted by the room color through the material)
function floorTex(style) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  let seed = style.length * 977; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  if (style === 'wood') {
    for (let y = 0; y < S; y += 32) {
      const off = r() * S; g.fillStyle = `rgba(120,70,30,${0.05 + r() * 0.08})`; g.fillRect(0, y, S, 32);
      for (let k = 0; k < 14; k++) { g.strokeStyle = `rgba(110,60,25,${0.08 + r() * 0.1})`; g.lineWidth = 1; g.beginPath(); const yy = y + 3 + r() * 26; g.moveTo(0, yy); g.bezierCurveTo(S * 0.3, yy + r() * 4 - 2, S * 0.6, yy + r() * 4 - 2, S, yy); g.stroke(); }
      g.fillStyle = 'rgba(70,35,15,.45)'; g.fillRect(0, y, S, 2); g.fillRect(off, y, 2, 32); g.fillRect((off + S / 2) % S, y + 0, 2, 32);
    }
  } else if (style === 'tile') {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,0)'; g.fillRect(x * 64, y * 64, 64, 64); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x * 64 + 6, y * 64 + 6, 20, 4); }
    g.fillStyle = 'rgba(80,80,100,.35)'; for (let i = 0; i <= 4; i++) { g.fillRect(i * 64 - 2, 0, 4, S); g.fillRect(0, i * 64 - 2, S, 4); }
  } else if (style === 'carpet') {
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.08})`; g.fillRect(r() * S, r() * S, 2, 2); }
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.12})`; g.fillRect(r() * S, r() * S, 2, 2); }
  } else {
    for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.1})`; g.fillRect(r() * S, r() * S, 2 + r() * 3, 2 + r() * 3); }
    g.strokeStyle = 'rgba(60,60,70,.35)'; g.lineWidth = 3; g.strokeRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
const FLOOR_STYLE = (r) => r.def.tile || r.type === 'kitchen' || r.type === 'bath' ? 'tile' : r.def.carpet || ['bedroom', 'kids', 'office', 'principal'].includes(r.type) ? 'carpet' : ['garage', 'storage'].includes(r.type) ? 'concrete' : 'wood';
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
  const ceilMat = M(new THREE.MeshToonMaterial({ color: 0xfff6e8, gradientMap: GRAD }));
  const lampMat = M(new THREE.MeshBasicMaterial({ color: 0xfff0c8, toneMapped: false }));
  const glowMat = M(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  const aoTex = spriteTex((g, S) => { const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(40,20,30,.42)'); gr.addColorStop(0.45, 'rgba(40,20,30,.12)'); gr.addColorStop(1, 'rgba(40,20,30,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); });
  const aoMat = M(new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false })); own.add(aoTex);
  const poolTex = spriteTex((g, S) => { const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); gr.addColorStop(0, 'rgba(255,220,150,.32)'); gr.addColorStop(0.5, 'rgba(255,200,120,.12)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }, 128);
  const poolMat = M(new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); own.add(poolTex);
  // sky dome + far hills + drifting clouds
  const skyMat = M(new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(0x4aa8ff) }, uLow: { value: new THREE.Color(0xffe2b8) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 uTop, uLow; varying vec3 vD; void main(){ float y = clamp(vD.y, 0., 1.); gl_FragColor = vec4(mix(uLow, uTop, pow(smoothstep(-0.05, 0.6, y), 0.8)), 1.); }' }));
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), skyMat); sky.renderOrder = -1; scene.add(sky); own.add(sky.geometry);
  const outdoor = (() => {
    const b = new Batch(0); let sd = 7; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2 + r() * 0.2, R = 85 + r() * 25; b.at(0, 0, 0).sph(Math.cos(a) * R, -4, Math.sin(a) * R, 18 + r() * 14, [0x7ccf6a, 0x6abf5e, 0x8fd87a][i % 3], { sy: 0.45 }); }
    const g1 = b.build(); const hills = new THREE.Mesh(g1.geo, toonV); scene.add(hills);
    const cb2 = new Batch(0); for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2, R = 60 + r() * 50, y = 28 + r() * 16; cb2.at(Math.cos(a) * R, y, Math.sin(a) * R, a); for (let k = 0; k < 4; k++) cb2.sph((k - 1.5) * 3.2, Math.sin(k * 2.1) * 0.8, r() * 1.5, 2.6 + r() * 1.6, 0xffffff, { sy: 0.6 }); }
    const g2 = cb2.build(); const clouds = new THREE.Mesh(g2.geo, M(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: GRAD, emissive: 0x666666 }))); scene.add(clouds);
    own.add(g1.geo); own.add(g2.geo);
    return { hills, clouds };
  })();
  const fireTex = spriteTex((g, s2) => { const gr = g.createRadialGradient(s2 / 2, s2 / 2, 0, s2 / 2, s2 / 2, s2 / 2); gr.addColorStop(0, 'rgba(255,200,90,.9)'); gr.addColorStop(0.4, 'rgba(255,120,40,.35)'); gr.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, s2, s2); });
  const fireMat = M(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); own.add(fireTex);
  const fireLight = new THREE.PointLight(0xff9a4a, 6, 7, 1.6); scene.add(fireLight);

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xfff1dc, 0x8a6a5a, 1.45); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.1); sun.position.set(14, 26, 9); scene.add(sun); scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xb8c8ff, 0.45); fill.position.set(-10, 12, -14); scene.add(fill);
  function applyQ() {
    const q = ctx.three.applyQuality(renderer, sun);
    sun.castShadow = q.shadows; renderer.shadowMap.enabled = q.shadows;
    return q;
  }
  let flash = 0, fovKick = 0;
  let composer = null, bloom = null, grade = null;
  function setupPost() {
    if (Q.effects && !composer) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.5, 0.86); composer.addPass(bloom);
      grade = new ShaderPass(GRADE); composer.addPass(grade);
      composer.addPass(new OutputPass());
      sizePost();
    } else if (!Q.effects && composer) disposePost();
  }
  function sizePost() { if (!composer) return; const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight; composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  function disposePost() { if (!composer) return; for (const p of composer.passes) p.dispose?.(); composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = bloom = grade = null; }
  let Q = applyQ();
  // dust motes floating in the warm light (High only)
  const DUST = 140, dustGeo = new THREE.BufferGeometry(), dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) { dustPos[i * 3] = (Math.random() - 0.5) * 12; dustPos[i * 3 + 1] = Math.random() * WH; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 12; }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3)); own.add(dustGeo);
  const dust = new THREE.Points(dustGeo, M(new THREE.PointsMaterial({ color: 0xfff0c8, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false })));
  dust.frustumCulled = false; scene.add(dust);

  // ---------------------------------------------------------------- level
  let level = null; const levelObjs = []; const decoys = []; const decoyMeshes = []; let highlighted = -1;
  const dm = new THREE.Object3D();
  const hiMesh = new THREE.Mesh(undefined, hiMat); hiMesh.visible = false; hiMesh.renderOrder = 2; scene.add(hiMesh);
  const selEl = ctx.ui.el('div', 'pr-sel'); selEl.style.display = 'none'; ctx.container.appendChild(selEl);
  function clearLevel() {
    for (const o of levelObjs) { o.removeFromParent(); if (!o.isSprite) o.geometry?.dispose(); }
    for (const m of levelMats) { m.map?.dispose(); m.dispose(); } levelMats.length = 0;
    levelObjs.length = 0;
    for (const m of decoyMeshes) { m.removeFromParent(); m.dispose(); }
    decoyMeshes.length = 0; decoys.length = 0; highlighted = -1; hiMesh.visible = false;
  }
  function buildLevel(L) {
    clearLevel(); level = L;
    const add = (geo, mat, shadow = true) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); levelObjs.push(m); return m; };
    add(L.geo.geo, toonV); const ol = add(L.geo.line, inkMat, false); if (ol) ol.receiveShadow = false;
    L.geo = { geo: null, line: null };             // the view owns these now (disposed with the level)
    // floors + ceilings + ground outside
    const fb = new Batch(0), cb = [], decal = [], pools = [], bulbs = [];
    const pend = new Batch(0.02);
    for (const r of L.rooms) {
      fb.box(r.x, -0.06, r.z, CELL, 0.1, CELL, shadeHex(r.def.floor, 0.8));
      // textured floor plane, tinted with the room color
      const st = FLOOR_STYLE(r);
      const fg = new THREE.PlaneGeometry(CELL, CELL); fg.rotateX(-Math.PI / 2); fg.translate(r.x, 0.001, r.z);
      const rep0 = st === 'wood' ? 3.2 : st === 'tile' ? 2.5 : 2; const uv = fg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rep0, uv.getY(i) * rep0);
      const fm = levelMat(new THREE.MeshToonMaterial({ color: r.def.floor, map: floorTex(st), gradientMap: GRAD }));
      const fl = new THREE.Mesh(fg, fm); fl.receiveShadow = true; scene.add(fl); levelObjs.push(fl);
      // soft contact shadow along the walls
      const hw = CELL / 2 - WT / 2;
      for (let side = 0; side < 4; side++) { const g = new THREE.PlaneGeometry(CELL - WT, 0.7); g.rotateX(-Math.PI / 2); g.translate(0, 0.004, -hw + 0.35); g.rotateY(-side * Math.PI / 2); g.translate(r.x, 0, r.z); decal.push(g); }
      // warm light pool under the pendant lamp
      const pg = new THREE.PlaneGeometry(4.2, 4.2); pg.rotateX(-Math.PI / 2); pg.translate(r.x, 0.006, r.z); pools.push(pg);
      const g = new THREE.PlaneGeometry(CELL, CELL); g.rotateX(Math.PI / 2); g.translate(r.x, WH, r.z); cb.push(g);
      // hanging pendant lamp: cord, colored shade, glowing bulb
      // flush ceiling dome lamp (stays out of the camera's way)
      pend.at(r.x, 0, r.z).cyl(0, WH - 0.03, 0, 0.38, 0.38, 0.06, shadeHex(r.def.wall, 0.8), { seg: 20 });
      const bg = new THREE.SphereGeometry(0.3, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); bg.scale(1, 0.4, 1); bg.translate(r.x, WH - 0.05, r.z); bulbs.push(bg);
    }
    const lampsGeo = bulbs;
    fb.box(0, -0.12, 0, 260, 0.1, 260, 0x7cc76a);
    const f = fb.build(); add(f.geo, toonV, false);
    const ceil = new THREE.Mesh(mergeList(cb), ceilMat); scene.add(ceil); levelObjs.push(ceil);
    const lampM = new THREE.Mesh(mergeList(lampsGeo), lampMat); scene.add(lampM); levelObjs.push(lampM);
    const pb = pend.build(); { const m1 = new THREE.Mesh(pb.geo, toonV); m1.castShadow = false; scene.add(m1); levelObjs.push(m1); const m2 = new THREE.Mesh(pb.line, inkMat); scene.add(m2); levelObjs.push(m2); }
    const ao = new THREE.Mesh(mergeList(decal, true), aoMat); ao.renderOrder = 1; scene.add(ao); levelObjs.push(ao);
    const pl = new THREE.Mesh(mergeList(pools, true), poolMat); pl.renderOrder = 1; scene.add(pl); levelObjs.push(pl);
    for (const g of [...cb, ...lampsGeo, ...decal, ...pools]) g.dispose();
    // glowing windows (sunny sky outside)
    const wb = new Batch(0);
    for (const w of L.windows) { wb.at(w.x, w.y, w.z, w.ry); wb.box(0, 0, 0, w.w, w.h, 0.012, 0xd8f4ff); wb.box(0, 0, 0.004, 0.05, w.h, 0.014, 0xfffaf0); wb.box(0, 0, 0.004, w.w, 0.05, 0.014, 0xfffaf0); }
    for (const sc of L.screens || []) { wb.at(sc.x, sc.y, sc.z, sc.ry); wb.box(0, 0, 0.02, 0.56, 0.4, 0.01, 0x7ae0ff); wb.box(-0.1, 0.05, 0.026, 0.12, 0.12, 0.004, 0xffe14a); wb.box(0.12, -0.08, 0.026, 0.16, 0.05, 0.004, 0xff6ec7); }
    const wg = wb.build(); if (wg.geo) { const wm = new THREE.Mesh(wg.geo, glowMat); scene.add(wm); levelObjs.push(wm); }
    // garden around the house: lawn details, trees, bushes, a fence (cosmetic only)
    const gb = new Batch(0.04); let sd = (L.w * 131 + L.d * 71 + L.rooms.length) | 0; const r1 = () => ((sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const hx = L.w / 2 + 0.2, hz = L.d / 2 + 0.2;
    for (let i = 0; i < 26; i++) {
      const a = r1() * Math.PI * 2, rr = 3 + r1() * 7, x = Math.cos(a) * (hx + rr), z = Math.sin(a) * (hz + rr);
      if (r1() < 0.55) { const h = 1.6 + r1() * 1.6; gb.at(x, 0, z).cyl(0, h / 2, 0, 0.16, 0.22, h, 0x8a5a3a); const c = [0x4cb85a, 0x5fd06a, 0x3fa05a][i % 3]; gb.sph(0, h + 0.5, 0, 1.0 + r1() * 0.5, c); gb.sph(0.5, h + 0.1, 0.2, 0.75, c, { shade: 0.92 }); gb.sph(-0.4, h + 0.2, -0.3, 0.7, c, { shade: 1.05 }); }
      else { const c = r1() < 0.3 ? 0xff8ab0 : 0x5fc86a; gb.at(x, 0, z).sph(0, 0.35, 0, 0.55 + r1() * 0.3, c, { sy: 0.75 }); }
    }
    gb.at(0, 0, 0);
    const fx0 = hx + 1.6, fz0 = hz + 1.6;
    for (let x = -fx0; x <= fx0 + 0.01; x += 1.2) for (const z of [-fz0, fz0]) gb.box(x, 0.45, z, 0.12, 0.9, 0.12, 0xfffaf0, { out: false });
    for (let z = -fz0; z <= fz0 + 0.01; z += 1.2) for (const x of [-fx0, fx0]) gb.box(x, 0.45, z, 0.12, 0.9, 0.12, 0xfffaf0, { out: false });
    for (const z of [-fz0, fz0]) for (const y of [0.35, 0.7]) gb.box(0, y, z, fx0 * 2, 0.08, 0.05, 0xfffaf0, { out: false });
    for (const x of [-fx0, fx0]) for (const y of [0.35, 0.7]) gb.box(x, y, 0, 0.05, 0.08, fz0 * 2, 0xfffaf0, { out: false });
    for (let i = 0; i < 9; i++) gb.box(0, -0.06, hz + 0.6 + i * 0.75, 0.9, 0.03, 0.5, 0xd8d0c0, { out: false });
    const gg = gb.build(); { const m1 = new THREE.Mesh(gg.geo, toonV); m1.castShadow = true; m1.receiveShadow = true; scene.add(m1); levelObjs.push(m1); const m2 = new THREE.Mesh(gg.line, inkMat); scene.add(m2); levelObjs.push(m2); }
    // fireplace glow + flicker light
    for (const g of L.glows) { const sp = new THREE.Sprite(fireMat); sp.position.set(g.x, g.y + 0.1, g.z); sp.scale.setScalar(1.6); scene.add(sp); levelObjs.push(sp); }
    fireLight.visible = !!L.glows.length && Q.effects; if (L.glows[0]) fireLight.position.set(L.glows[0].x, 0.8, L.glows[0].z);
    // decoys: one instanced mesh (+ outline) per kind -> ~2 draw calls per kind however stocked the shelves are
    const byKind = new Map();
    for (const d of L.decoys) { if (!byKind.has(d.k)) byKind.set(d.k, []); byKind.get(d.k).push(d); }
    for (const [k, list] of byKind) {
      const { geo, line } = kindGeometry(kindCache, k);
      const im = new THREE.InstancedMesh(geo, toonV, list.length); im.castShadow = true; im.receiveShadow = true;
      const il = new THREE.InstancedMesh(line, inkMat, list.length);
      list.forEach((d, j) => { dm.position.set(d.x, d.y, d.z); dm.rotation.set(0, d.ry, 0); dm.scale.set(1, 1, 1); dm.updateMatrix(); im.setMatrixAt(j, dm.matrix); il.setMatrixAt(j, dm.matrix); decoys[d.i] = { d, im, il, j, bounce: 0 }; });
      im.computeBoundingSphere(); il.computeBoundingSphere();
      scene.add(im, il); decoyMeshes.push(im, il);
    }
    // sun + shadow camera cover the building
    const ext = Math.max(L.w, L.d) / 2 + 2;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 80 });
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.background = null; skyMat.uniforms.uTop.value.setHex(L.map.sky[1]).multiplyScalar(0.85); skyMat.uniforms.uLow.value.setHex(L.map.sky[0]);
  }
  function mergeList(list, uvs = false) {
    // tiny local merge (planes/spheres share attributes)
    let n = 0; for (const g of list) n += (g.index ? g.index.count : g.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = uvs ? new Float32Array(n * 2) : null; let o = 0;
    for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if (uv) uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; if (g !== g0) g.dispose(); }
    const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return out;
  }
  // materials made for one level (floors): disposed with the level
  const levelMats = [];
  function levelMat(m) { levelMats.push(m); return m; }
  function setHighlight(i) {
    if (i === highlighted) return;
    highlighted = i; const D = decoys[i];
    hiMesh.visible = !!D;
    if (D) { hiMesh.geometry = kindGeometry(kindCache, D.d.k).line; hiMesh.position.set(D.d.x, D.d.y - 0.01, D.d.z); hiMesh.rotation.set(0, D.d.ry, 0); hiMesh.scale.setScalar(1.04); }
  }
  function setDecoyMatrix(D, sx, sy) { dm.position.set(D.d.x, D.d.y, D.d.z); dm.rotation.set(0, D.d.ry, 0); dm.scale.set(sx, sy, sx); dm.updateMatrix(); D.im.setMatrixAt(D.j, dm.matrix); D.il.setMatrixAt(D.j, dm.matrix); D.im.instanceMatrix.needsUpdate = true; D.il.instanceMatrix.needsUpdate = true; }

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
    // held in the right hand: grip at the bottom of the handle, pointing forward
    const arm = av.userData.arms?.[0];
    hammer.scale.setScalar(0.8);
    if (arm) { hammer.position.set(-0.05, -0.45, 0.06); hammer.rotation.set(Math.PI / 2 + 0.25, 0, 0); arm.add(hammer); }
    else { hammer.position.set(-0.45, 0.6, 0.15); hammer.rotation.x = 0.5; av.add(hammer); }
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
    // a sleeve in my party color, my hand gripping the bottom of the handle, the hammer itself
    const pl = ctx.player(ctx.myId) || {};
    const b = new Batch(0.02);
    b.cyl(0, -0.32, 0.04, 0.085, 0.1, 0.5, color, { rx: -0.35 }); b.sph(0, -0.02, 0, 0.1, SKINS[pl.skin ?? 1] ?? 0xf3c39b, { sy: 1.15 });
    b.cyl(0, 0.35, 0, 0.035, 0.035, 0.7, color, { shade: 0.85 }); b.cyl(0, 0.78, 0, 0.17, 0.17, 0.36, 0xff4d6a, { rz: Math.PI / 2, seg: 16 }); b.cyl(0, 0.78, 0, 0.175, 0.175, 0.08, 0xffd23f, { rz: Math.PI / 2, seg: 16 });
    const geo = b.build(); const g = new THREE.Group(), pivot = new THREE.Group();
    const m = new THREE.Mesh(geo.geo, toonV); pivot.add(m, new THREE.Mesh(geo.line, inkMat)); g.add(pivot);
    g.scale.setScalar(0.42); g.position.set(0.34, -0.5, -0.55); camera.add(g);
    vm = { g, pivot, geo, color, swing: 0 }; return vm;
  }

  // ---------------------------------------------------------------- particles
  const TEX = {
    puff: spriteTex((g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }),
    star: spriteTex((g, s) => { g.fillStyle = '#fff'; g.strokeStyle = '#17112e'; g.lineWidth = 4; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.2 : s * 0.45, a = (i / 10) * Math.PI * 2 - Math.PI / 2; g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r); } g.closePath(); g.stroke(); g.fill(); }),
    note: spriteTex((g, s) => { g.font = `${s * 0.8}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 5; g.strokeStyle = '#17112e'; g.strokeText('♪', s / 2, s / 2); g.fillStyle = '#fff'; g.fillText('♪', s / 2, s / 2); }),
    bonk: spriteTex((g, s) => { comic(g, s, 'BONK!', '#ffd23f', '#ff4d6a'); }, 256),
    nope: spriteTex((g, s) => { comic(g, s, 'NOPE!', '#ffffff', '#3ea6ff'); }, 256),
    conf: spriteTex((g, s) => { g.fillStyle = '#fff'; g.fillRect(s * 0.3, s * 0.15, s * 0.4, s * 0.7); }, 32),
    x: spriteTex((g, s) => { g.lineCap = 'round'; g.strokeStyle = '#17112e'; g.lineWidth = 16; g.beginPath(); g.moveTo(14, 14); g.lineTo(s - 14, s - 14); g.moveTo(s - 14, 14); g.lineTo(14, s - 14); g.stroke(); g.strokeStyle = '#ff4d5e'; g.lineWidth = 9; g.stroke(); }),
  };
  for (const t of Object.values(TEX)) own.add(t);
  const pool = [];
  function spawn(tex, x, y, z, o = {}) {
    let s = pool.find((q) => !q.visible);
    if (!s) { if (pool.length > 140) return; s = new THREE.Sprite(M(new THREE.SpriteMaterial({ depthWrite: false, transparent: true }))); scene.add(s); pool.push(s); }
    s.material.map = TEX[tex]; s.material.color.setHex(o.color ?? 0xffffff); s.material.opacity = 1; s.material.depthTest = o.depthTest !== false;
    s.position.set(x, y, z); s.visible = true;
    s.userData = { pop: !!o.pop, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, g: o.g ?? 0, life: o.life || 1, t: 0, s0: o.size || 0.4, s1: o.size1 ?? (o.size || 0.4), spin: o.spin || 0 };
    s.userData.aspect = o.aspect || 1; s.scale.set(s.userData.s0 * s.userData.aspect, s.userData.s0, 1); s.material.rotation = o.rot ?? Math.random() * 6;
  }
  function stepParticles(dt) {
    for (const s of pool) {
      if (!s.visible) continue; const u = s.userData; u.t += dt;
      if (u.t >= u.life) { s.visible = false; continue; }
      u.vy -= u.g * dt; s.position.x += u.vx * dt; s.position.y += u.vy * dt; s.position.z += u.vz * dt;
      const f = u.t / u.life, sc = u.s0 + (u.s1 - u.s0) * (u.pop ? Math.min(1, f * 6) : f); s.scale.set(sc * u.aspect, sc, 1); s.material.opacity = f > 0.6 ? 1 - (f - 0.6) / 0.4 : 1; s.material.rotation += u.spin * dt;
    }
  }
  let shakeA = 0;
  const fx = {
    poof(x, y, z, color = 0xffffff, n = 12) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, sp = 0.8 + Math.random() * 1.6; spawn('puff', x, y + 0.3, z, { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 0.6 + Math.random(), life: 0.7 + Math.random() * 0.4, size: 0.35, size1: 0.9, color }); } },
    stars(x, y, z, color = 0xffd23f, n = 14) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, sp = 2 + Math.random() * 2.5; spawn('star', x, y + 0.5, z, { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 3 + Math.random() * 3, g: 9, life: 1.1, size: 0.32, size1: 0.18, color, spin: 6 }); } },
    notes(x, y, z, color, big) { for (let i = 0; i < (big ? 9 : 5); i++) spawn('note', x + (Math.random() - 0.5) * 0.4, y + 0.4 + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.4, { vx: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2, vy: 1.2 + Math.random(), life: 1.4 + Math.random() * 0.5, size: big ? 0.5 : 0.36, color, spin: (Math.random() - 0.5) * 3 }); },
    oops(i) { const D = decoys[i]; if (!D) return; D.bounce = 1; spawn('x', D.d.x, D.d.y + 0.6, D.d.z, { vy: 0.8, life: 0.9, size: 0.45, size1: 0.7 }); fx.poof(D.d.x, D.d.y, D.d.z, 0xffffff, 5); },
    swing(id) { const B = bodies.get(id); if (B) B.swing = 1; if (id === ctx.myId && vm) vm.swing = 1; },
    shake(a) { shakeA = Math.max(shakeA, a); },
    pop(id) { const B = bodies.get(id); if (B) B.pop = 1; },
    punch(a) { fovKick = Math.max(fovKick, a); },
    flash(a) { flash = Math.max(flash, a); },
    // a hider was bonked: the disguise flies off spinning, BONK! burst, confetti in their color, dizzy stars
    found(m, color) {
      spawn('bonk', m.x, m.y + 1.0, m.z, { vy: 0.6, life: 1.1, size: 0.25, size1: 1.0, aspect: 1.6, rot: 0, pop: true, depthTest: false });
      for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, sp = 1.5 + Math.random() * 3; spawn('conf', m.x, m.y + 0.6, m.z, { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 3 + Math.random() * 3.5, g: 9, life: 1.4 + Math.random() * 0.6, size: 0.14, color: [color, 0xffd23f, 0xff6ec7, 0x3ea6ff, 0x4cd964][i % 5], spin: (Math.random() - 0.5) * 14 }); }
      if (m.k >= 0) {
        const { geo, line } = kindGeometry(kindCache, m.k);
        const g = new THREE.Mesh(geo, toonV); g.add(new THREE.Mesh(line, inkMat)); g.position.set(m.x, m.y, m.z); g.rotation.y = m.rot || 0; scene.add(g);
        flyers.push({ g, vx: (Math.random() - 0.5) * 2, vy: 7, vz: (Math.random() - 0.5) * 2, spin: 9 + Math.random() * 6, t: 0 });
      }
      const B = bodies.get(m.id); if (B) B.foundT = 2.2;
    },
    nope(i) { const D = decoys[i]; if (D) spawn('nope', D.d.x, D.d.y + 0.9, D.d.z, { vy: 0.5, life: 0.9, size: 0.2, size1: 0.75, aspect: 1.6, rot: 0, pop: true, depthTest: false }); },
    tauntHat(id) { const B = bodies.get(id); if (B) B.hatT = 1.3; },
  };
  const flyers = [];

  // ---------------------------------------------------------------- camera
  const cam = { yaw: 0, pitch: -0.25, dist: 3.4, mode: 'tp', intro: 0, x: 0, y: 1, z: 0 };
  function placeCamera(dt, focus, mode, now) {
    let px, py, pz;
    if (mode === 'fp') {
      px = focus.x; py = focus.y + 1.45; pz = focus.z;
      camera.position.set(px, py, pz); camera.rotation.set(cam.pitch, cam.yaw + Math.PI, 0);
      camera.fov += (72 + fovKick * 14 - camera.fov) * Math.min(1, dt * 10);
    } else {
      const k = Math.min(1, dt * 12);
      cam.x += (focus.x - cam.x) * k; cam.y += (focus.y + focus.h - cam.y) * Math.min(1, dt * 8); cam.z += (focus.z - cam.z) * k;
      const f = [Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)];
      // over-the-shoulder: shift the pivot to the right so my own body doesn't cover the crosshair
      const sh = focus.shoulder || 0, pv = [cam.x - Math.cos(cam.yaw) * sh, cam.y, cam.z + Math.sin(cam.yaw) * sh];
      const free = level ? rayWorld(level, [cam.x, cam.y, cam.z], [pv[0] - cam.x, 0, pv[2] - cam.z].map((v) => v / (sh || 1)), sh + 0.25) : sh + 1;
      const k2 = Math.max(0, Math.min(1, (free - 0.25) / (sh || 1)));
      const o = [cam.x + (pv[0] - cam.x) * k2, cam.y, cam.z + (pv[2] - cam.z) * k2], back = [-f[0], -f[1], -f[2]];
      let d = cam.dist;
      if (level) d = Math.min(d, rayWorld(level, o, back, d + 0.3) - 0.25);
      d = Math.max(0.08, d);
      const lift = d < 1.2 ? (1.2 - d) * 0.7 : 0;      // squeezed against a wall: rise above the prop instead
      px = o[0] + back[0] * d; py = Math.min(WH - 0.15, o[1] + back[1] * d + lift); pz = o[2] + back[2] * d;
      camera.position.set(px, py, pz); camera.lookAt(o[0] + f[0], o[1] + f[1], o[2] + f[2]);
      camera.fov += (62 + fovKick * 14 - camera.fov) * Math.min(1, dt * 10);
    }
    // intro: start high above the open dollhouse and swoop down
    if (cam.intro > 0 && level) {
      const e = cam.intro * cam.intro * (3 - 2 * cam.intro);
      const a = now / 7000, S = Math.max(level.w, level.d);
      v1.set(Math.sin(a) * S * 0.62, S * 0.62 + 4, Math.cos(a) * S * 0.62);
      camera.position.lerp(v1, e);
      const q0 = camera.quaternion.clone(); _mL.lookAt(camera.position, _ctr.set(0, 0, 0), camera.up); _qL.setFromRotationMatrix(_mL);
      camera.quaternion.slerpQuaternions(q0, _qL, e);
    }
    if (shakeA > 0) { camera.position.x += (Math.random() - 0.5) * shakeA * 0.15; camera.position.y += (Math.random() - 0.5) * shakeA * 0.15; shakeA = Math.max(0, shakeA - dt * 2.5); }
    camera.updateProjectionMatrix();
  }
  // ray from the screen center (what the crosshair points at)
  const _ray = new THREE.Raycaster();
  function rayFrom(nx, ny) { _ray.setFromCamera({ x: nx, y: ny }, camera); const o = _ray.ray.origin, d = _ray.ray.direction; return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] }; }
  function centerRay() { camera.getWorldDirection(v2); return { o: [camera.position.x, camera.position.y, camera.position.z], d: [v2.x, v2.y, v2.z] }; }

  // ---------------------------------------------------------------- per-frame update
  // st: { players: Map(id -> view), me, mode, focusId, highlight, showTag(id)->bool, phase }
  function update(dt, now, st) {
    const t = now / 1000;
    const live = new Set();
    for (const [id, p] of st.players) {
      const B = bodyFor(p); live.add(id);
      const meFp = id === st.me && st.mode === 'fp';
      B.foundT = Math.max(0, (B.foundT || 0) - dt); B.hatT = Math.max(0, (B.hatT || 0) - dt);
      const dizzy = !p.alive && B.foundT > 0 && st.phase !== 'post';
      const vis = p.alive || st.phase === 'post' || dizzy;
      B.root.visible = vis && !meFp;
      const showProp = p.role === 'H' && p.kind >= 0 && (p.alive || st.phase === 'post') && !dizzy;
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
        if (!B.hatMesh) { B.hatMesh = ctx.avatar.hat(ctx.player(p.id)?.hat || 'cap', ctx.player(p.id)?.colorHex ?? 0xffffff); B.propHolder.add(B.hatMesh); }
        B.hatMesh.visible = B.hatT > 0;
        if (B.hatT > 0) { const k = Math.sin(Math.min(1, (1.3 - B.hatT) * 4) * Math.PI / 2) * (B.hatT < 0.3 ? B.hatT / 0.3 : 1); B.hatMesh.position.set(0, KINDS[p.kind].size[1] + 0.15 + k * 0.25, 0); B.hatMesh.scale.setScalar(0.7 * k + 0.01); B.hatMesh.rotation.y = t * 4; }
        if (B.pop > 0) { B.pop = Math.max(0, B.pop - dt * 4); const k = 1 + Math.sin(B.pop * Math.PI) * 0.35; pr.scale.multiplyScalar(k); }
      } else {
        if (p.role === 'S') B.faceYaw = p.yaw;
        else if (sp > 0.3) { const want = Math.atan2(p.x - (B.px ?? p.x), p.z - (B.pz ?? p.z)); if (Number.isFinite(want) && sp > 0.3) B.faceYaw = want; }
        B.px = p.x; B.pz = p.z;
        B.root.rotation.y = B.faceYaw;
        B.av.userData.setPose({ run: Math.min(1, sp / 4.5), t });
        if (dizzy || (!p.alive && st.phase === 'post')) { B.av.rotation.z = Math.sin(t * 6) * 0.2; if (dizzy && Math.random() < dt * 8) spawn('star', p.x + Math.sin(t * 7) * 0.5, p.y + 1.9, p.z + Math.cos(t * 7) * 0.5, { life: 0.5, size: 0.18, size1: 0.05, color: 0xffd23f }); }
        else B.av.rotation.z = 0;
        // seekers carry the hammer: arm held forward, the whole arm swings it (wind up, smash, recover)
        const arm = B.av.userData.arms?.[0];
        if (arm && p.role === 'S') {
          B.swing = Math.max(0, B.swing - dt * 2.4);
          const u = B.swing > 0 ? 1 - B.swing : 1;
          arm.rotation.x = B.swing > 0 ? swingCurve(u, -0.45, -2.9, -0.05) : -0.45 + arm.rotation.x * 0.25;
          arm.rotation.z = -0.25;
        }
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
    for (const D of decoys) if (D && D.bounce > 0) { D.bounce = Math.max(0, D.bounce - dt * 2.2); const s = Math.sin(D.bounce * Math.PI * 3) * D.bounce; setDecoyMatrix(D, 1 - s * 0.2, 1 + s * 0.3); }
    setHighlight(st.highlight ?? -1);
    if (hiMesh.visible) {
      const D = decoys[highlighted], k = KINDS[D.d.k];
      hiMesh.scale.setScalar(1.06 + Math.sin(t * 8) * 0.03);
      v1.set(D.d.x, D.d.y + k.size[1] + 0.25, D.d.z).project(camera);
      if (selEl.dataset.k !== String(D.d.k)) { selEl.dataset.k = D.d.k; selEl.innerHTML = `<kbd>E</kbd> ${k.icon} ${k.name}`; }
      selEl.style.display = v1.z < 1 ? '' : 'none';
      selEl.style.transform = `translate(${((v1.x + 1) / 2) * ctx.container.clientWidth}px, ${((1 - v1.y) / 2) * ctx.container.clientHeight}px) translate(-50%, -130%)`;
    } else selEl.style.display = 'none';
    // camera
    const f = st.players.get(st.focusId);
    if (f) placeCamera(dt, { x: f.x, y: f.y, z: f.z, h: f.kind >= 0 && f.role === 'H' ? Math.max(0.35, KINDS[f.kind].size[1] * 0.7) : 1.2, shoulder: st.focusId === st.me ? (f.kind >= 0 && f.role === 'H' ? Math.max(0.3, KINDS[f.kind].size[0] * 0.8) : 0.6) : 0 }, st.mode, now);
    // seeker view model
    if (st.mode === 'fp' && cam.intro <= 0.02) { const m = viewModel(ctx.player(st.me)?.colorHex ?? 0xffffff); m.g.visible = true; m.swing = Math.max(0, m.swing - dt * 2.6);
      const u = m.swing > 0 ? 1 - m.swing : 1, bob = Math.sin(t * 8) * 0.012 * (st.moving ? 1 : 0);
      const rx = swingCurve(u, -0.35, 0.75, -1.45);                              // tilt: back over the shoulder, then down in front
      const lift = m.swing > 0 ? swingCurve(u, 0, 0.12, -0.06) : 0;
      m.g.rotation.set(rx, 0.3 - (m.swing > 0 ? 0.25 : 0), -0.25); m.g.position.set(0.34 - lift * 0.6, -0.5 + lift + bob, -0.55 - (rx < -0.6 ? 0.1 : 0)); }
    else if (vm) vm.g.visible = false;
    stepParticles(dt);
    fovKick = Math.max(0, fovKick - dt * 2.5); flash = Math.max(0, flash - dt * 3);
    for (let i = flyers.length - 1; i >= 0; i--) { const f2 = flyers[i]; f2.t += dt; f2.vy -= 14 * dt; f2.g.position.x += f2.vx * dt; f2.g.position.y += f2.vy * dt; f2.g.position.z += f2.vz * dt; f2.g.rotation.x += f2.spin * dt; f2.g.rotation.z += f2.spin * 0.7 * dt; f2.g.scale.setScalar(Math.max(0.01, 1 - Math.max(0, f2.t - 0.8) * 2)); if (f2.t > 1.3) { f2.g.removeFromParent(); flyers.splice(i, 1); if (Math.random() < 1) fx.poof(f2.g.position.x, f2.g.position.y - 0.3, f2.g.position.z, 0xffffff, 6); } }
    dust.visible = !!Q.effects;
    if (dust.visible) { const c = camera.position; for (let i = 0; i < DUST; i++) { let x = dustPos[i * 3] + Math.sin(t * 0.3 + i) * dt * 0.08, y = dustPos[i * 3 + 1] + dt * 0.03, z = dustPos[i * 3 + 2] + Math.cos(t * 0.27 + i * 1.7) * dt * 0.08; if (y > WH) y = 0; if (x - c.x > 6) x -= 12; if (c.x - x > 6) x += 12; if (z - c.z > 6) z -= 12; if (c.z - z > 6) z += 12; dustPos[i * 3] = x; dustPos[i * 3 + 1] = y; dustPos[i * 3 + 2] = z; } dustGeo.attributes.position.needsUpdate = true; }
    outdoor.clouds.rotation.y += dt * 0.006; sky.position.copy(camera.position);
    if (fireLight.visible) fireLight.intensity = 5 + Math.sin(t * 13) * 0.8 + Math.sin(t * 29) * 0.5;
    if (composer) { grade.uniforms.uFlash.value = flash * 0.35; composer.render(); }
    else renderer.render(scene, camera);
  }

  function resize() {
    const w = ctx.container.clientWidth || innerWidth, h = ctx.container.clientHeight || innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); sizePost();
  }
  setupPost();
  resize();

  return {
    renderer, scene, camera, cam, fx, buildLevel, update, resize, centerRay, rayFrom,
    applyQ() { Q = applyQ(); setupPost(); fireLight.visible = !!level?.glows.length && Q.effects; },
    dispose() {
      clearLevel(); hiMesh.removeFromParent(); disposePost();
      for (const f2 of flyers) f2.g.removeFromParent(); flyers.length = 0;
      for (const B of bodies.values()) { if (B.hatMesh) ctx.avatar.dispose(B.hatMesh); ctx.avatar.dispose(B.av); B.hg.geo.dispose(); B.hg.line.dispose(); B.root.removeFromParent(); B.tag.remove(); }
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
