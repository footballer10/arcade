// Three.js rendering for Arena Royale: bright cartoon style (toon shading, outlines, chunky characters).
import * as THREE from 'three';
import { ARENA_R, OBSTACLES, HOLES, BUSHES, PORTALS, PORTAL_R, MAP, inBush, inHole, sweeperAngle, BLAST_R, SLAM_R, BOMB_R, BOMB_RANGE, MAX_AMMO } from './sim.js';

import { PALETTE } from '../../core/palette.js';
import { buildHat } from '../../core/avatar.js';
export const COLORS = PALETTE;   // party colors: players keep their color in every game
export const cssColor = (i) => '#' + COLORS[i % COLORS.length].toString(16).padStart(6, '0');
const PU_COLORS = { speed: 0xffe14d, shield: 0x4de1ff, dmg: 0xff4d6a, heal: 0x5dff7a, giant: 0xff9de0, cube: 0xffa531 };
// What each power-up does, at a glance: a floating glyph above the gem (so it reads from across the arena,
// not just from the tooltip-less pickup text that only flashes for the player who grabs it).
const PU_ICONS = { speed: '⚡', shield: '🛡', dmg: '🔥', heal: '➕', giant: '⬆', cube: '📦' };
const iconTexCache = new Map();
function iconTexture(glyph) {
  let t = iconTexCache.get(glyph);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '44px "Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(glyph, 32, 36);
  t = new THREE.CanvasTexture(c);
  iconTexCache.set(glyph, t);
  return t;
}
const SKY = 0x4cc3ff;
const WATER = 0x2ea8f0;

const THEMES = {
  meadow: { tileA: '#93d653', tileB: '#82c846', line: '#6fae3a', cliff: 0x9a6a3c, cliffTop: 0x6dbb3c, block: 0xd8954f, wall: 0xa7b0c4, bush: 0x2fa84a, bushDark: 0x228a3a, deco: 'flower' },
  desert: { tileA: '#f6cf86', tileB: '#ecc072', line: '#d9a85a', cliff: 0xc07a42, cliffTop: 0xe7b665, block: 0xe7a862, wall: 0x46b358, bush: 0x7cb342, bushDark: 0x5f9632, deco: 'crack' },
  candy:  { tileA: '#ffd9ea', tileB: '#ffc4dd', line: '#f59ac0', cliff: 0xb5651d, cliffTop: 0xff8fc0, block: 0xffe08a, wall: 0x9be0ff, bush: 0x3cc47c, bushDark: 0x2a9d60, deco: 'swirl' },
  ice:    { tileA: '#cfefff', tileB: '#bfe6fb', line: '#9fd4f2', cliff: 0x5f86c4, cliffTop: 0xe4f6ff, block: 0x8fd3ff, wall: 0x7f9ac4, bush: 0x2e9b62, bushDark: 0x1f7a4c, deco: 'crystal' },
  snow:   { tileA: '#eef6ff', tileB: '#dde9f8', line: '#c4d7ef', cliff: 0x7e93b8, cliffTop: 0xe9f3ff, block: 0x9fdcff, wall: 0x8e9bb0, bush: 0x2e9b62, bushDark: 0x1f7a4c, deco: 'snowflake' },
};

// 3-step toon ramp + inverted-hull outlines give the chunky cartoon look.
const GRAD = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter; GRAD.needsUpdate = true;
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: GRAD, ...extra });
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x1d1633, side: THREE.BackSide });
function outline(mesh, s = 1.08) {
  const o = new THREE.Mesh(mesh.geometry, OUTLINE);
  o.scale.setScalar(s);
  mesh.add(o);
  return mesh;
}
const basic = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

function tileTexture(th) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    g.fillStyle = (i + j) % 2 ? th.tileA : th.tileB;
    g.fillRect(i * 128, j * 128, 128, 128);
    g.strokeStyle = th.line; g.lineWidth = 6;
    g.strokeRect(i * 128 + 3, j * 128 + 3, 122, 122);
  }
  // a few flecks so the floor doesn't look flat, plus a theme motif so each arena reads as its own place
  g.fillStyle = th.line;
  for (let k = 0; k < 18; k++) { g.globalAlpha = 0.35; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 4, 0, 6.28); g.fill(); }
  g.globalAlpha = 1;
  for (let k = 0; k < 7; k++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    if (th.deco === 'flower') {
      g.fillStyle = ['#fff6b0', '#ff9ec7', '#ffffff'][k % 3];
      for (let p = 0; p < 5; p++) { const a = (p / 5) * 6.28; g.beginPath(); g.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3, 0, 6.28); g.fill(); }
      g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(x, y, 2.4, 0, 6.28); g.fill();
    } else if (th.deco === 'crack') {
      g.strokeStyle = th.line; g.lineWidth = 2; g.globalAlpha = 0.5;
      g.beginPath(); g.moveTo(x, y);
      let cx = x, cy = y;
      for (let s = 0; s < 3; s++) { cx += (Math.random() - 0.5) * 14; cy += (Math.random() - 0.5) * 14; g.lineTo(cx, cy); }
      g.stroke(); g.globalAlpha = 1;
    } else if (th.deco === 'swirl') {
      g.strokeStyle = ['#ff6fa8', '#ffffff'][k % 2]; g.lineWidth = 3; g.globalAlpha = 0.6;
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 1.5); g.stroke(); g.globalAlpha = 1;
    } else if (th.deco === 'crystal') {
      g.fillStyle = '#ffffff'; g.globalAlpha = 0.65;
      g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 4, y); g.lineTo(x, y + 7); g.lineTo(x - 4, y); g.closePath(); g.fill(); g.globalAlpha = 1;
    } else if (th.deco === 'snowflake') {
      g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.globalAlpha = 0.7;
      for (let p = 0; p < 3; p++) { const a = (p / 3) * Math.PI; g.beginPath(); g.moveTo(x - Math.cos(a) * 6, y - Math.sin(a) * 6); g.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6); g.stroke(); }
      g.globalAlpha = 1;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(ARENA_R * 2 / 5, ARENA_R * 2 / 5); // 2.5 m tiles
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Renderer {
  // renderer: the WebGLRenderer the hub created for this game (ctx.three.createRenderer)
  constructor(renderer, labelsEl) {
    this.labelsEl = labelsEl;
    this.renderer = renderer;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 45, 95);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camDist = 1;
    this.camTarget = new THREE.Vector3();
    this.shakeAmp = 0;
    this.freezeUntil = 0;
    this.pops = [];

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8fb0, 1.5));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    sun.position.set(-10, 30, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 80;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    // ocean + island
    const water = new THREE.Mesh(new THREE.CircleGeometry(160, 64), toon(WATER));
    water.rotation.x = -Math.PI / 2; water.position.y = -0.9; this.scene.add(water);
    this.foam = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R * 0.975, 0.28, 8, 96), basic(0xffffff, 0.85));
    this.foam.rotation.x = Math.PI / 2; this.foam.position.y = -0.85; this.scene.add(this.foam);
    this.cliffMat = toon(0x9a6a3c);
    const cliff = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_R, ARENA_R * 0.92, 2.2, 72), this.cliffMat);
    cliff.position.y = -1.1; cliff.receiveShadow = true; this.scene.add(cliff);
    this.floorMat = toon(0xffffff);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R, 96), this.floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.001; floor.receiveShadow = true; this.scene.add(floor);
    this.rimMat = toon(0x6dbb3c);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R - 0.15, 0.3, 8, 96), this.rimMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.02; rim.scale.z = 0.4; this.scene.add(rim);

    // poison gas zone: green-tinted ground + ring of puffy clouds
    this.zoneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { zoneR: { value: ARENA_R }, time: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float zoneR; uniform float time; varying vec2 vP; void main(){ float d=length(vP); if(d<zoneR) discard; float s=0.5+0.5*sin(vP.x*0.9+time*1.5)*sin(vP.y*0.9-time*1.2); gl_FragColor=vec4(0.36,0.86,0.2,0.42+0.15*s); }',
    });
    const zone = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R, 96), this.zoneMat);
    zone.rotation.x = -Math.PI / 2; zone.position.y = 0.04; this.scene.add(zone);
    this.cloudN = 72;
    this.clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 9), toon(0x67d13f, { transparent: true, opacity: 0.88 }), this.cloudN);
    this.clouds.frustumCulled = false;
    this.cloudSeeds = Array.from({ length: this.cloudN }, (_, i) => ({ a: (i / this.cloudN) * Math.PI * 2 * 2 + Math.random() * 0.2, ring: i % 2, s: 0.9 + Math.random() * 0.9, ph: Math.random() * 6.28 }));
    this.scene.add(this.clouds);
    this.tmpM = new THREE.Matrix4(); this.tmpQ = new THREE.Quaternion(); this.tmpV = new THREE.Vector3(); this.tmpS = new THREE.Vector3();

    this.mapGroup = new THREE.Group(); this.scene.add(this.mapGroup);
    this.mapKey = null;
    this.bushMeshes = [];
    this.buildMap();

    // aim guide (translucent strip / cone in front of the local player)
    const strip = new THREE.PlaneGeometry(1, 1); strip.rotateX(-Math.PI / 2); strip.translate(0.5, 0, 0);
    this.aimStrip = new THREE.Mesh(strip, basic(0xffffff, 0.22));
    this.aimStrip.position.y = 0.05; this.aimStrip.visible = false; this.scene.add(this.aimStrip);
    this.aimCones = {};
    for (const [k, arc, R] of [['brawler', 1.9, 2.8], ['trickster', 1.5, 2.4], ['ram', 1.7, 2.4], ['hook', 0.8, 3.4], ['frost', 0.55, 6.8]]) {
      const g = new THREE.CircleGeometry(1, 24, -arc / 2, arc); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, basic(0xffffff, 0.22)); m.position.y = 0.05; m.visible = false; this.scene.add(m);
      m.userData.R = R; this.aimCones[k] = m;
    }
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 24), basic(0xffffff, 0.8));
    this.reticle.rotation.x = -Math.PI / 2; this.reticle.position.y = 0.06; this.scene.add(this.reticle);
    this.bombRing = new THREE.Mesh(new THREE.RingGeometry(BOMB_R - 0.12, BOMB_R, 40), basic(0xffffff, 0.45));
    this.bombRing.rotation.x = -Math.PI / 2; this.bombRing.position.y = 0.06; this.bombRing.visible = false; this.scene.add(this.bombRing);
    this.tpPreview = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32), basic(0xffd23f, 0.7));
    this.tpPreview.rotation.x = -Math.PI / 2; this.tpPreview.position.y = 0.06; this.tpPreview.visible = false; this.scene.add(this.tpPreview);
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), basic(0xffd23f, 0.45));
    this.rangeRing.rotation.x = -Math.PI / 2; this.rangeRing.position.y = 0.05; this.rangeRing.visible = false; this.scene.add(this.rangeRing);

    this.players = new Map();
    this.projMeshes = new Map();
    this.puMeshes = new Map();
    this.wellMeshes = [];
    this.fxList = [];
    this.boltGeo = new THREE.SphereGeometry(0.26, 12, 10);
    this.bombGeo = new THREE.SphereGeometry(0.34, 14, 12);
    this.puGeo = new THREE.OctahedronGeometry(0.5);
    this.cubeGeo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.resize();
  }

  buildMap() {
    if (this.mapKey === MAP.key) return;
    this.mapKey = MAP.key;
    const th = THEMES[MAP.theme] || THEMES.meadow;
    if (this.floorMat.map) this.floorMat.map.dispose();
    this.floorMat.map = tileTexture(th); this.floorMat.needsUpdate = true;
    this.cliffMat.color.setHex(th.cliff);
    this.rimMat.color.setHex(th.cliffTop);
    for (const c of [...this.mapGroup.children]) this.mapGroup.remove(c);
    this.bushMeshes = [];
    const add = (m, shadow = true) => { m.castShadow = shadow; m.receiveShadow = true; this.mapGroup.add(m); return m; };

    OBSTACLES.forEach((o, i) => {
      const g = new THREE.Group(); g.position.set(o.x, 0, o.z); this.mapGroup.add(g);
      if (o.bumper) {
        const base = outline(new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.1, 0.5, 28), toon(0xff5fa2)), 1.06);
        base.position.y = 0.25; base.castShadow = true; g.add(base);
        const dome = outline(new THREE.Mesh(new THREE.SphereGeometry(o.r * 0.95, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xffa6cf)), 1.06);
        dome.position.y = 0.5; dome.scale.y = 0.45; g.add(dome);
        o._dome = dome;
        return;
      }
      const isHub = MAP.sweeper && Math.hypot(o.x, o.z) < 0.1;
      if (isHub) {
        for (let k = 0; k < 3; k++) {
          const seg = outline(new THREE.Mesh(new THREE.CylinderGeometry(o.r * (1 - k * 0.12), o.r * (1.05 - k * 0.12), 0.9, 20), toon([0xc0703a, 0xffb020, 0xd94b3a][k])), 1.05);
          seg.position.y = 0.45 + k * 0.9; seg.castShadow = true; g.add(seg);
        }
        return;
      }
      const big = o.r >= 1.35;
      if (MAP.theme === 'desert' && i % 2 === 1) {
        // cactus
        const trunk = outline(new THREE.Mesh(new THREE.CapsuleGeometry(o.r * 0.55, 1.6, 6, 14), toon(0x46b358)), 1.07);
        trunk.position.y = 1.2; trunk.castShadow = true; g.add(trunk);
        for (const s of [-1, 1]) {
          const arm = outline(new THREE.Mesh(new THREE.CapsuleGeometry(o.r * 0.28, 0.6, 4, 10), toon(0x46b358)), 1.1);
          arm.position.set(0, 1.2 + s * 0.2, s * o.r * 0.75); arm.castShadow = true; g.add(arm);
        }
        return;
      }
      const w = o.r * 1.75, h = big ? 1.9 : 1.4;
      const color = big ? th.wall : th.block;
      const box = outline(new THREE.Mesh(new THREE.BoxGeometry(w, h, w), toon(color)), 1.05);
      box.position.y = h / 2; box.castShadow = true; box.receiveShadow = true; g.add(box);
      if (!big && MAP.theme !== 'snow') {
        // crate planks: banded edges + a diagonal brace on two faces
        const plankMat = toon(new THREE.Color(color).multiplyScalar(0.68));
        for (const y of [h * 0.42, -h * 0.42]) for (const sd of [-1, 1]) {
          const a = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.16, 0.08), plankMat); a.position.set(0, y, sd * w / 2); box.add(a);
          const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, w * 1.02), plankMat); b2.position.set(sd * w / 2, y, 0); box.add(b2);
        }
        for (const sd of [-1, 1]) {
          const x1 = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(w, h) * 0.85, 0.16, 0.08), plankMat);
          x1.rotation.z = Math.atan2(h, w) * sd; x1.position.z = sd * (w / 2 + 0.01); box.add(x1);
        }
      } else {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, 0.22, w * 1.04), toon(MAP.theme === 'snow' ? 0xffffff : new THREE.Color(color).multiplyScalar(1.12)));
        cap.position.y = h / 2 + 0.05; box.add(cap);
      }
    });

    for (const h of HOLES) {
      const pit = new THREE.Mesh(new THREE.CircleGeometry(h.r, 40), toon(0x1b6fb8));
      pit.rotation.x = -Math.PI / 2; pit.position.set(h.x, 0.03, h.z); add(pit, false);
      const rimM = new THREE.Mesh(new THREE.TorusGeometry(h.r, 0.22, 8, 40), toon(0xffffff));
      rimM.rotation.x = Math.PI / 2; rimM.position.set(h.x, 0.05, h.z); rimM.scale.z = 0.5; add(rimM, false);
    }

    for (const b of BUSHES) {
      const g = new THREE.Group(); g.position.set(b.x, 0, b.z);
      const mat = toon(th.bush, { transparent: true, opacity: 1 });
      const mat2 = toon(th.bushDark, { transparent: true, opacity: 1 });
      const n = Math.round(b.r * 4);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, rr = k === 0 ? 0 : b.r * (0.45 + Math.random() * 0.3);
        const s = 0.55 + Math.random() * 0.35;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 10), k % 3 ? mat : mat2);
        ball.position.set(Math.cos(a) * rr, 0.75 + Math.random() * 0.35, Math.sin(a) * rr);
        ball.castShadow = true; g.add(ball);
        const blade = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 5), mat2);
        blade.position.set(ball.position.x * 1.15, 1.25 + Math.random() * 0.3, ball.position.z * 1.15); g.add(blade);
      }
      this.mapGroup.add(g);
      this.bushMeshes.push({ b, mats: [mat, mat2] });
    }

    for (const p of PORTALS) {
      const g = new THREE.Group(); g.position.set(p.x, 0, p.z);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(PORTAL_R, PORTAL_R * 1.1, 0.25, 28), toon(0x1b4a5c, { emissive: 0x3ff0c8, emissiveIntensity: 0.5 }));
      pad.position.y = 0.12; g.add(pad);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_R * 0.85, 0.09, 8, 32), basic(0x3ff0c8, 0.9));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3; g.add(ring);
      p._ring = ring;
      this.mapGroup.add(g);
    }

    this.beam = null;
    if (MAP.sweeper) {
      const sw = MAP.sweeper;
      const pivot = new THREE.Group();
      const len = sw.len - 1.4;
      const log = outline(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, len, 16), toon(0xa0612f)), 1.06);
      log.rotation.z = Math.PI / 2; log.position.set(1.4 + len / 2, 0.6, 0); log.castShadow = true; pivot.add(log);
      for (let x = 2.5; x < sw.len; x += 1.6) {
        for (const s of [-1, 1]) {
          const sp = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 6), toon(0xe8e8f0));
          sp.position.set(x, 0.6, s * 0.55); sp.rotation.x = s * Math.PI / 2; pivot.add(sp);
        }
      }
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.8), basic(0xffb020, 0.18));
      glow.rotation.x = -Math.PI / 2; glow.position.set(1.4 + len / 2, 0.05, 0); pivot.add(glow);
      this.mapGroup.add(pivot);
      this.beam = pivot;
    }
  }

  resize() {
    const host = this.renderer.domElement.parentElement;
    const w = host?.clientWidth || window.innerWidth, h = host?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  mouseToGround(nx, ny) {
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const v = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, v) ? v : null;
  }

  shake(a) { this.shakeAmp = Math.min(1.2, Math.max(this.shakeAmp, a)); }
  hitstop(ms) { this.freezeUntil = Math.max(this.freezeUntil, performance.now() + ms); }
  emote(id, txt) {
    const r = this.players.get(id);
    if (!r) return;
    r.emoteEl.textContent = txt; r.emoteEl.classList.remove('show'); void r.emoteEl.offsetWidth; r.emoteEl.classList.add('show');
    r.emoteUntil = performance.now() + 2200;
  }
  popText(x, z, text, cls) {
    const el = document.createElement('div');
    el.className = 'pop ' + (cls || '');
    el.textContent = text;
    el.style.opacity = '0';
    this.labelsEl.appendChild(el);
    this.pops.push({ el, x: x + (Math.random() - 0.5) * 0.6, z, t: 0 });
  }

  // ---------- characters (original designs, big heads + outlines) ----------
  makePlayer(p) {
    const accent = COLORS[p.color % COLORS.length];
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    const mats = [], outs = [];
    const part = (geo, color, x, y, z, s = 1.08) => {
      const m = toon(color); mats.push(m);
      const mesh = outline(new THREE.Mesh(geo, m), s);
      outs.push(mesh.children[0]);
      mesh.position.set(x, y, z); body.add(mesh); return mesh;
    };
    let head = null;
    const eyes = (hx, hy, hr) => {
      head = { hx, hy, hr };
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), basic(0xffffff));
        w.scale.set(0.55, 1.15, 0.85); w.position.set(hx + hr * 0.86, hy + 0.04, s * 0.17); body.add(w);
        const pu = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), basic(0x1d1633));
        pu.position.set(hx + hr * 0.86 + 0.06, hy + 0.04, s * 0.16); body.add(pu);
      }
    };
    const feet = (color) => { for (const s of [-1, 1]) part(new THREE.BoxGeometry(0.34, 0.2, 0.22), color, 0.06, 0.1, s * 0.22, 1.12); };
    const SKIN = 0xf3c08f;
    if (p.char === 'blaster') {
      feet(0x3a3550);
      part(new THREE.CylinderGeometry(0.4, 0.46, 0.65, 18), 0xff9a2e, 0, 0.55, 0);
      part(new THREE.TorusGeometry(0.43, 0.07, 8, 20), accent, 0, 0.38, 0, 1.15).rotation.x = Math.PI / 2;
      part(new THREE.SphereGeometry(0.5, 20, 16), 0xdfe7f2, 0, 1.25, 0);
      part(new THREE.BoxGeometry(0.16, 0.24, 0.62), 0x41e0ff, 0.42, 1.28, 0, 1.12);
      part(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6), 0x3a3550, 0, 1.85, 0, 1.3);
      part(new THREE.SphereGeometry(0.1, 10, 8), accent, 0, 2.05, 0, 1.2);
      const cannon = part(new THREE.CylinderGeometry(0.17, 0.2, 0.85, 14), 0x4a4f63, 0.42, 0.72, 0.46);
      cannon.rotation.z = -Math.PI / 2;
      part(new THREE.TorusGeometry(0.17, 0.06, 6, 14), accent, 0.86, 0.72, 0.46, 1.15).rotation.y = Math.PI / 2;
    } else if (p.char === 'brawler') {
      feet(0x2f2a40);
      part(new THREE.SphereGeometry(0.62, 20, 16), 0xd94b3a, 0, 0.72, 0).scale.set(0.95, 0.85, 1.08);
      part(new THREE.TorusGeometry(0.55, 0.08, 8, 22), accent, 0, 0.6, 0, 1.12).rotation.x = Math.PI / 2;
      part(new THREE.SphereGeometry(0.38, 18, 14), SKIN, 0.05, 1.42, 0);
      part(new THREE.TorusGeometry(0.36, 0.07, 6, 18), accent, 0.05, 1.55, 0, 1.12).rotation.x = Math.PI / 2;
      eyes(0.05, 1.42, 0.38);
      for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.33, 16, 12), 0xffd23f, 0.6, 0.78, s * 0.52);
    } else if (p.char === 'bomber') {
      feet(0x2f2a40);
      part(new THREE.SphereGeometry(0.55, 20, 16), 0x3fae5a, 0, 0.6, 0);
      part(new THREE.BoxGeometry(0.2, 0.22, 0.5), 0x8a5a2b, -0.42, 0.7, 0);
      part(new THREE.SphereGeometry(0.42, 18, 14), SKIN, 0, 1.28, 0);
      part(new THREE.SphereGeometry(0.44, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), accent, 0, 1.36, 0, 1.06);
      part(new THREE.SphereGeometry(0.12, 10, 8), 0xffffff, 0, 1.84, 0, 1.15);
      eyes(0, 1.24, 0.42);
      part(new THREE.SphereGeometry(0.27, 14, 12), 0x2a2a38, 0.55, 0.8, 0.38);
      const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), basic(0xffa020)); fuse.position.set(0.6, 1.12, 0.38); body.add(fuse);
    } else if (p.char === 'ranger') {
      feet(0x3b2a1a);
      part(new THREE.CylinderGeometry(0.3, 0.42, 0.8, 16), 0x2f8f5b, 0, 0.5, 0);
      part(new THREE.SphereGeometry(0.4, 18, 14), SKIN, 0, 1.2, 0);
      part(new THREE.ConeGeometry(0.46, 0.6, 16), 0x2f8f5b, -0.04, 1.62, 0, 1.06);
      part(new THREE.ConeGeometry(0.07, 0.5, 6), accent, -0.3, 1.75, 0.2, 1.3).rotation.z = 0.7;
      eyes(0, 1.16, 0.4);
      const bow = part(new THREE.TorusGeometry(0.48, 0.05, 6, 16, Math.PI), 0x8a5a2b, 0.55, 0.8, 0, 1.4);
      bow.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
      part(new THREE.BoxGeometry(0.16, 0.5, 0.16), accent, -0.38, 0.75, 0, 1.15);
    } else if (p.char === 'frost') {
      feet(0x3b5a8a);
      part(new THREE.SphereGeometry(0.5, 18, 14), 0x7fd4ff, 0, 0.58, 0).scale.set(1, 0.95, 1);
      part(new THREE.SphereGeometry(0.42, 18, 14), 0xeaf8ff, 0, 1.25, 0);
      for (const [dx, dz, rz] of [[0, 0, 0], [-0.18, 0.2, 0.5], [-0.18, -0.2, 0.5]]) {
        const sp = part(new THREE.ConeGeometry(0.13, 0.5, 6), 0xbff3ff, dx, 1.78, dz, 1.2); sp.rotation.z = rz;
      }
      part(new THREE.TorusGeometry(0.36, 0.09, 8, 18), accent, 0, 0.98, 0, 1.1).rotation.x = Math.PI / 2;
      eyes(0, 1.22, 0.42);
      part(new THREE.OctahedronGeometry(0.2), 0xbff3ff, 0.55, 0.8, 0.36, 1.2);
    } else if (p.char === 'ram') {
      feet(0x3a2a22);
      part(new THREE.SphereGeometry(0.66, 20, 16), 0x9a6b4f, -0.05, 0.75, 0).scale.set(1.1, 0.9, 1.05);
      part(new THREE.SphereGeometry(0.4, 18, 14), 0xb98a6a, 0.42, 1.2, 0);
      for (const sd of [-1, 1]) {
        const h = part(new THREE.TorusGeometry(0.22, 0.09, 8, 14, Math.PI * 1.5), 0xf2ead8, 0.42, 1.36, sd * 0.4, 1.2);
        h.rotation.set(0, sd * Math.PI / 2, 0);
      }
      part(new THREE.TorusGeometry(0.6, 0.08, 8, 22), accent, -0.05, 0.75, 0, 1.1).rotation.y = Math.PI / 2;
      eyes(0.42, 1.2, 0.4);
    } else if (p.char === 'hook') {
      feet(0x2a3550);
      part(new THREE.CylinderGeometry(0.42, 0.48, 0.75, 16), 0xffd23f, 0, 0.52, 0);
      part(new THREE.SphereGeometry(0.4, 18, 14), SKIN, 0, 1.22, 0);
      part(new THREE.CylinderGeometry(0.58, 0.62, 0.08, 18), 0xffd23f, 0, 1.46, 0, 1.06);
      part(new THREE.SphereGeometry(0.36, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xffd23f, 0, 1.46, 0, 1.06);
      part(new THREE.TorusGeometry(0.44, 0.07, 8, 18), accent, 0, 0.42, 0, 1.12).rotation.x = Math.PI / 2;
      eyes(0, 1.18, 0.4);
      part(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), 0x8a5a2b, 0.55, 0.85, 0.42, 1.4).rotation.z = -Math.PI / 2;
      const hk = part(new THREE.TorusGeometry(0.16, 0.05, 6, 12, Math.PI * 1.3), 0xdfe7f2, 1.2, 0.85, 0.42, 1.4); hk.rotation.x = Math.PI / 2;
    } else { // trickster
      feet(0x2a2440);
      part(new THREE.CylinderGeometry(0.24, 0.48, 0.85, 16), 0x6b4bd6, 0, 0.48, 0);
      part(new THREE.SphereGeometry(0.4, 18, 14), 0xc58d63, 0, 1.18, 0);
      part(new THREE.ConeGeometry(0.5, 0.95, 18), 0x6b4bd6, -0.06, 1.45, 0, 1.06).rotation.z = 0.25;
      part(new THREE.TorusGeometry(0.33, 0.1, 8, 18), accent, 0, 0.92, 0, 1.1).rotation.x = Math.PI / 2;
      eyes(0, 1.14, 0.4);
      for (const s of [-1, 1]) {
        const d = part(new THREE.BoxGeometry(0.7, 0.06, 0.14), 0xe6ecf5, 0.5, 0.7, s * 0.42, 1.15);
        d.rotation.y = s * 0.25;
      }
    }
    // blob shadow + team ring
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.72, 24), basic(0x000000, 0.28));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.025; g.add(shadow);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.9, 32), basic(accent, 0.95));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 14), basic(0x4de1ff, 0.28));
    shield.position.y = 0.95; shield.visible = false; g.add(shield);
    const tele = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    tele.rotation.x = -Math.PI / 2; tele.visible = false; this.scene.add(tele);
    const teleFill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), basic(0xffaa33, 0.22));
    teleFill.rotation.x = -Math.PI / 2; teleFill.visible = false; this.scene.add(teleFill);
    if (head && p.hat && p.hat !== 'none') {   // the player's party hat, so they look like themselves here too
      const hat = buildHat(p.hat, accent); hat.scale.setScalar(head.hr * 1.7); hat.rotation.y = Math.PI / 2;
      hat.position.set(head.hx - 0.02, head.hy + head.hr * 0.82, 0); body.add(hat);
    }
    g.scale.setScalar(1.15);
    this.scene.add(g);

    const label = document.createElement('div');
    label.className = 'plabel';
    label.innerHTML = `<div class="pname"></div><div class="hpbar"><div class="hpfill"></div><div class="shfill"></div><span class="hpnum"></span></div><div class="ammo"><i><b></b></i><i><b></b></i><i><b></b></i></div><div class="buffs"></div><div class="emote"></div>`;
    this.labelsEl.appendChild(label);
    const rec = { g, body, mats, outs, shadow, ammoEls: [...label.querySelectorAll('.ammo b')], emoteEl: label.querySelector('.emote'), ring, shield, tele, teleFill, label, nameEl: label.querySelector('.pname'), hpEl: label.querySelector('.hpfill'), shEl: label.querySelector('.shfill'), numEl: label.querySelector('.hpnum'), buffEl: label.querySelector('.buffs'), char: p.char, color: p.color, lastHp: '', lastBuff: '', isMe: null };
    rec.nameEl.textContent = p.name;
    rec.nameEl.style.color = cssColor(p.color);
    return rec;
  }

  removePlayer(id) {
    const r = this.players.get(id);
    if (!r) return;
    this.scene.remove(r.g); this.scene.remove(r.tele); this.scene.remove(r.teleFill); r.label.remove();
    this.players.delete(id);
  }
  clearPlayers() {
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    for (const m of this.projMeshes.values()) { this.scene.remove(m); if (m.userData.marker) this.scene.remove(m.userData.marker); if (m.userData.rope) this.scene.remove(m.userData.rope); }
    this.projMeshes.clear();
    for (const m of this.puMeshes.values()) this.scene.remove(m);
    this.puMeshes.clear();
    for (const p of this.pops) p.el.remove();
    this.pops = [];
  }

  render(view, localId, dt, camFocus, aimPt, showTp) {
    const nowMs = performance.now();
    const now = nowMs / 1000;
    this.buildMap();
    const frozen = nowMs < this.freezeUntil;
    if (!frozen) this.updateScene(view, localId, dt, now, aimPt, showTp);

    if (camFocus) this.camTarget.lerp(new THREE.Vector3(camFocus.x, 0, camFocus.z), Math.min(1, dt * 6));
    const off = new THREE.Vector3(0, 16.5, 9.5).multiplyScalar(this.camDist);
    this.camera.position.copy(this.camTarget).add(off);
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z - 1);
    if (this.shakeAmp > 0.01) {
      const a = this.shakeAmp;
      this.camera.position.x += (Math.random() - 0.5) * a; this.camera.position.y += (Math.random() - 0.5) * a * 0.5; this.camera.position.z += (Math.random() - 0.5) * a;
      this.shakeAmp *= Math.exp(-dt * 9);
    }
    this.renderer.render(this.scene, this.camera);
    if (!frozen) this.updateLabels();
  }

  updateScene(view, localId, dt, now, aimPt, showTp) {
    this.zoneMat.uniforms.zoneR.value = view.zoneR;
    this.zoneMat.uniforms.time.value = now;
    this.foam.scale.setScalar(1 + Math.sin(now * 1.5) * 0.004);
    this.updateClouds(view.zoneR, now);
    if (this.beam) this.beam.rotation.y = -sweeperAngle(view.t || 0);
    for (const o of OBSTACLES) if (o._dome) o._dome.scale.y = 0.45 + Math.sin(now * 5 + o.x) * 0.05;
    for (const p of PORTALS) if (p._ring) { p._ring.rotation.z = now * 1.5; p._ring.position.y = 0.3 + Math.sin(now * 3 + p.x) * 0.06; }

    const me = view.players.find((p) => p.id === localId && p.alive);
    // bushes go see-through when you're inside them
    for (const { b, mats } of this.bushMeshes) {
      const inside = me && Math.hypot(me.x - b.x, me.z - b.z) < b.r + 0.4;
      for (const m of mats) m.opacity += ((inside ? 0.45 : 1) - m.opacity) * Math.min(1, dt * 10);
    }

    const seen = new Set();
    for (const p of view.players) {
      seen.add(p.id);
      let r = this.players.get(p.id);
      if (r && (r.char !== p.char || r.color !== p.color)) { this.removePlayer(p.id); r = null; }
      if (!r) { r = this.makePlayer(p); this.players.set(p.id, r); }
      r.p = p;
      const isMe = p.id === localId;
      if (r.isMe !== isMe) { r.isMe = isMe; r.label.classList.toggle('me', isMe); r.ring.material.color.setHex(isMe ? 0x7dff5a : COLORS[p.color % COLORS.length]); }
      // hidden in a bush: enemies can't see you unless they're close or you just attacked / got hit
      r.hidden = !isMe && localId && inBush(p.x, p.z) && (!me || Math.hypot(me.x - p.x, me.z - p.z) > 3.5) && !(p.hitT > 0) && !(p.swingT > 0) && !(p.blastT > 0);
      const ghost = !p.alive && p.ghost;
      if (r.ghostOn !== ghost) {
        r.ghostOn = ghost;
        for (const m of r.mats) { m.transparent = ghost; m.opacity = ghost ? 0.62 : 1; m.needsUpdate = true; }
        for (const o of r.outs) o.visible = !ghost;
        r.label.classList.toggle('ghost', ghost);
      }
      const vis = (p.alive && !r.hidden) || ghost;
      r.g.visible = vis;
      r.ring.visible = r.shadow.visible = !ghost && !p.falling;
      if (!vis) { r.tele.visible = r.teleFill.visible = false; continue; }
      if (ghost) { // eliminated players float around as ghosts
        r.g.position.set(p.x, 0.5 + Math.sin(now * 3 + p.color) * 0.2, p.z);
        r.g.scale.setScalar(1.05);
        r.body.rotation.set(0, -p.aim, Math.sin(now * 2 + p.color) * 0.15); r.body.position.y = 0; r.body.scale.setScalar(1);
        r.shield.visible = r.tele.visible = r.teleFill.visible = false;
        for (const m of r.mats) m.emissive.setRGB(0.55, 0.6, 0.75);
        continue;
      }
      let sc = 1.15 * (p.giantT > 0 ? 1.5 : 1);
      if (p.falling) { // tumble off the edge into the sea, or get sucked down a pit
        const pit = inHole(p.x, p.z);
        r.fallSpin = (r.fallSpin || 0) + dt * 12;
        if (pit) sc *= Math.max(0.05, 1 + p.y / 2.7);
        r.g.position.set(p.x, pit ? p.y * 0.3 : p.y, p.z);
        r.g.scale.setScalar(sc);
        r.body.position.y = 0.7; r.body.scale.setScalar(1);
        r.body.rotation.set(r.fallSpin * 0.6, r.fallSpin, 0.4);
        r.shield.visible = r.tele.visible = r.teleFill.visible = false;
        for (const m of r.mats) m.emissive.setRGB(0, 0, 0);
        continue;
      }
      r.fallSpin = 0;
      r.g.scale.setScalar(sc);
      let hop = 0;
      if (p.slamT > 0) hop = Math.sin((1 - p.slamT / 0.35) * Math.PI) * 1.4;
      if ((view.phase === 'roundEnd' || view.phase === 'matchEnd') && view.roundWinner === p.id) hop += Math.abs(Math.sin(now * 7)) * 0.9; // victory hops
      r.g.position.set(p.x, p.y + hop, p.z);
      r.body.rotation.x = 0;
      r.body.rotation.y = -p.aim;
      // walk bob + squash & stretch
      const spd = Math.hypot(p.mvx || 0, p.mvz || 0);
      const walk = Math.min(1, spd / 6);
      const bob = Math.abs(Math.sin(now * 13 + p.color)) * 0.14 * walk;
      r.body.position.y = bob;
      const swing = p.swingT > 0 ? 1 + p.swingT * 1.6 : 1;
      const charge = p.blastT > 0 ? 1 + (1 - p.blastT / 0.18) * 0.3 : 1;
      const squash = 1 - bob * 0.5;
      r.body.scale.set(swing * charge * (1 + bob * 0.25), charge * squash, charge * (1 + bob * 0.25));
      r.body.rotation.z = -walk * 0.12;
      const flash = p.hitT > 0 ? 0.85 : p.invT > 0 ? 0.35 : p.blastT > 0 ? 0.45 : p.dmgT > 0 ? 0.12 + 0.1 * Math.sin(now * 12) : 0;
      const red = p.dmgT > 0 && p.hitT <= 0;
      for (const m of r.mats) m.emissive.setRGB(flash, red ? flash * 0.2 : flash, red ? flash * 0.2 : flash);
      if (p.hitT <= 0 && p.slowT > 0) for (const m of r.mats) m.emissive.setRGB(0.05, 0.3, 0.6);
      if (p.chargeT > 0) for (const m of r.mats) m.emissive.setRGB(0.55, 0.3, 0);
      r.shield.visible = p.shield > 0;
      if (p.shield > 0) r.shield.rotation.y = now;
      if (p.slamT > 0 || p.blastT > 0) {
        const R = p.slamT > 0 ? SLAM_R : BLAST_R;
        const k = p.slamT > 0 ? 1 - p.slamT / 0.35 : 1 - p.blastT / 0.18;
        const col = p.slamT > 0 ? 0xffaa33 : COLORS[p.color % COLORS.length];
        r.tele.visible = r.teleFill.visible = true;
        r.tele.material.color.setHex(col); r.teleFill.material.color.setHex(col);
        r.tele.position.set(p.x, 0.07, p.z); r.tele.scale.set(R, R, R);
        r.teleFill.position.set(p.x, 0.065, p.z); const fr = Math.max(0.05, R * k); r.teleFill.scale.set(fr, fr, fr);
      } else r.tele.visible = r.teleFill.visible = false;
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.removePlayer(id);

    // projectiles
    const ps = new Set();
    for (const b of view.proj) {
      ps.add(b.id);
      let m = this.projMeshes.get(b.id);
      if (!m) {
        if (b.kind === 2 || b.kind === 3 || b.kind === 4) {
          m = outline(new THREE.Mesh(this.boltGeo, basic([0, 0, 0xfff1c9, 0xbff3ff, 0xcfd6e4][b.kind])), 1.25);
          m.children[0].material = basic(COLORS[b.color % COLORS.length]);
          m.scale.set(...(b.kind === 2 ? [3.4, 0.5, 0.5] : b.kind === 3 ? [1.5, 0.6, 0.6] : [1.3, 1, 1]));
          if (b.kind === 4) { // rope back to the Angler
            const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x4a3a2a }));
            rope.frustumCulled = false; this.scene.add(rope); m.userData.rope = rope;
          }
        } else if (b.kind === 1 || b.kind === 5) {
          m = outline(new THREE.Mesh(this.bombGeo, toon(b.kind === 5 ? 0x7a1f2a : 0x2a2a38)), 1.12);
          if (b.kind === 5) m.scale.setScalar(1.5);
          const spark = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), basic(0xffb020)); spark.position.y = 0.4; m.add(spark);
          const mk = new THREE.Mesh(new THREE.CircleGeometry(BOMB_R, 40), basic(0xff3b4e, 0.25));
          mk.rotation.x = -Math.PI / 2; mk.position.set(b.tx, 0.07, b.tz);
          const mkRing = new THREE.Mesh(new THREE.RingGeometry(BOMB_R - 0.14, BOMB_R, 40), basic(0xff3b4e, 0.9));
          mk.add(mkRing);
          this.scene.add(mk); m.userData.marker = mk;
        } else {
          m = outline(new THREE.Mesh(this.boltGeo, basic(0xfff27a)), 1.25);
          m.children[0].material = basic(COLORS[b.color % COLORS.length]);
          m.scale.set(1.8, 0.85, 0.85);
        }
        this.scene.add(m); this.projMeshes.set(b.id, m);
      }
      if (b.kind === 1 || b.kind === 5) {
        const f = b.f;
        m.position.set(b.x, b.kind === 5 ? 0.5 + 18 * (1 - f) * (1 - f) : 0.9 + 4.5 * f * (1 - f) * Math.min(1.5, b.T * 2.2), b.z);
        m.rotation.x += dt * 8;
        m.userData.marker.material.opacity = 0.15 + 0.3 * f;
      } else {
        m.position.set(b.x, 0.85, b.z);
        m.rotation.y = -Math.atan2(b.vz, b.vx);
        if (m.userData.rope) {
          const o = view.players.find((q) => q.color === b.color && q.alive) || b;
          const pos = m.userData.rope.geometry.attributes.position;
          pos.setXYZ(0, o.x, 0.85, o.z); pos.setXYZ(1, b.x, 0.85, b.z); pos.needsUpdate = true;
        }
      }
    }
    for (const [id, m] of this.projMeshes) if (!ps.has(id)) { this.scene.remove(m); if (m.userData.marker) this.scene.remove(m.userData.marker); if (m.userData.rope) this.scene.remove(m.userData.rope); this.projMeshes.delete(id); }

    // gravity wells
    const wells = view.wells || [];
    while (this.wellMeshes.length < wells.length) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.15, 1, 48, 4), new THREE.MeshBasicMaterial({ color: 0xb57bff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, wireframe: true }));
      m.rotation.x = -Math.PI / 2; this.scene.add(m); this.wellMeshes.push(m);
    }
    this.wellMeshes.forEach((m, i) => {
      const w = wells[i];
      m.visible = !!w;
      if (!w) return;
      m.position.set(w.x, 0.08, w.z);
      const s = w.r * (0.9 + 0.1 * Math.sin(now * 10));
      m.scale.set(s, s, s); m.rotation.z = now * 4;
      m.material.color.setHex(COLORS[w.color % COLORS.length]);
      const bl = w.kind === 1; // blizzard: a frosty disc instead of a swirling well
      m.material.wireframe = !bl; m.material.opacity = bl ? 0.5 : 0.45;
      if (bl) { m.material.color.setHex(0xd8f4ff); m.scale.set(w.r, w.r, w.r); }
    });

    // power-ups: glowing gems with a colored pool of light
    const us = new Set();
    for (const u of view.pu) {
      us.add(u.id);
      let m = this.puMeshes.get(u.id);
      if (!m) {
        m = new THREE.Group();
        const geo = u.type === 'cube' ? this.cubeGeo : this.puGeo;
        const gem = outline(new THREE.Mesh(geo, toon(PU_COLORS[u.type], { emissive: PU_COLORS[u.type], emissiveIntensity: 0.45 })), 1.12);
        gem.castShadow = true; m.add(gem); m.userData.gem = gem;
        const pool = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), basic(PU_COLORS[u.type], 0.35));
        pool.rotation.x = -Math.PI / 2; pool.position.y = 0.05; m.add(pool);
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(PU_ICONS[u.type] || '?'), transparent: true, sizeAttenuation: true }));
        icon.scale.set(0.9, 0.9, 1); m.add(icon); m.userData.icon = icon;
        this.scene.add(m); this.puMeshes.set(u.id, m);
      }
      m.position.set(u.x, 0, u.z);
      m.userData.gem.position.y = 0.9 + Math.sin(now * 3 + u.id) * 0.2;
      m.userData.gem.rotation.y = now * 2;
      m.userData.icon.position.y = 2.0 + Math.sin(now * 3 + u.id) * 0.2;
    }
    for (const [id, m] of this.puMeshes) if (!us.has(id)) { this.scene.remove(m); this.puMeshes.delete(id); }

    this.fxList = this.fxList.filter((f) => {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { this.scene.remove(f.obj); return false; }
      f.update(k);
      return true;
    });

    // aim guide
    this.aimStrip.visible = false; this.bombRing.visible = false;
    for (const c of Object.values(this.aimCones)) c.visible = false;
    if (me && aimPt && !me.falling) {
      const ang = Math.atan2(aimPt.z - me.z, aimPt.x - me.x);
      if (me.char === 'blaster' || me.char === 'bomber' || me.char === 'ranger') {
        const len = me.char === 'blaster' ? 14 : me.char === 'ranger' ? 21 : Math.min(BOMB_RANGE, Math.hypot(aimPt.x - me.x, aimPt.z - me.z));
        this.aimStrip.visible = true;
        this.aimStrip.position.set(me.x, 0.05, me.z);
        this.aimStrip.rotation.y = -ang;
        this.aimStrip.scale.set(len, 1, me.char === 'blaster' ? 0.7 : me.char === 'ranger' ? 0.4 : 0.25);
        if (me.char === 'bomber') { this.bombRing.visible = true; this.bombRing.position.set(aimPt.x, 0.06, aimPt.z); }
      } else {
        const c = this.aimCones[me.char];
        if (c) { const R = c.userData.R; c.visible = true; c.position.set(me.x, 0.05, me.z); c.rotation.y = -ang; c.scale.set(R, 1, R); }
      }
    }
    if (aimPt && me) { this.reticle.visible = true; this.reticle.position.x = aimPt.x; this.reticle.position.z = aimPt.z; } else this.reticle.visible = false;
    if (showTp) { this.tpPreview.visible = true; this.tpPreview.position.x = showTp.x; this.tpPreview.position.z = showTp.z; const s = showTp.r || 1; this.tpPreview.scale.set(s, s, s); } else this.tpPreview.visible = false;
    const R = me && me.spCd <= 0 ? (me.char === 'blaster' ? BLAST_R : me.char === 'brawler' ? SLAM_R : 0) : 0;
    this.rangeRing.visible = R > 0;
    if (R) { this.rangeRing.position.x = me.x; this.rangeRing.position.z = me.z; this.rangeRing.scale.set(R, R, R); }
    this.dt = dt;
  }

  updateClouds(zoneR, now) {
    const show = zoneR < ARENA_R - 0.05;
    this.clouds.visible = show;
    if (!show) return;
    const zr = Math.max(0, zoneR);
    for (let i = 0; i < this.cloudN; i++) {
      const c = this.cloudSeeds[i];
      const r = zr + 0.8 + c.ring * 2.2 + Math.sin(now * 0.8 + c.ph) * 0.4;
      const a = c.a + now * 0.03 * (c.ring ? -1 : 1);
      const s = c.s * (1 + 0.12 * Math.sin(now * 2 + c.ph)) * (c.ring ? 1.4 : 1);
      this.tmpV.set(Math.cos(a) * r, 0.5 + c.ring * 0.4, Math.sin(a) * r);
      this.tmpS.set(s, s * 0.8, s);
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
      this.clouds.setMatrixAt(i, this.tmpM);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  updateLabels() {
    const W = window.innerWidth, H = window.innerHeight, v = new THREE.Vector3();
    for (const r of this.players.values()) {
      const p = r.p;
      if (!p) continue;
      const show = (p.alive && !p.falling && !r.hidden) || (!p.alive && p.ghost);
      if (r.emoteUntil && performance.now() > r.emoteUntil) { r.emoteUntil = 0; r.emoteEl.classList.remove('show'); }
      r.label.style.display = show ? '' : 'none';
      if (!show) continue;
      const hpKey = p.hp + '/' + p.shield;
      if (hpKey !== r.lastHp) {
        r.lastHp = hpKey;
        const f = Math.max(0, p.hp / p.maxHp);
        r.hpEl.style.width = (f * 100) + '%';
        r.shEl.style.width = Math.min(100, p.shield / 40 * 100) + '%';
        r.numEl.textContent = Math.ceil(p.hp * 10);
      }
      if (r.isMe && p.alive) { const ak = Math.round(p.ammo * 20); if (ak !== r.lastAmmo) { r.lastAmmo = ak; r.ammoEls.forEach((el, i) => { el.style.width = Math.max(0, Math.min(1, p.ammo - i)) * 100 + '%'; el.parentNode.classList.toggle('full', p.ammo >= i + 1); }); } }
      const bk = (p.speedT > 0 ? '⚡' : '') + (p.dmgT > 0 ? '🔥' : '') + (p.slowT > 0 ? '❄️' : '') + (!p.alive && p.ghost ? '👻' : '');
      if (bk !== r.lastBuff) { r.lastBuff = bk; r.buffEl.textContent = bk; }
      v.set(r.g.position.x, r.g.position.y + 2.5, r.g.position.z).project(this.camera);
      r.label.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px, ${(-v.y * 0.5 + 0.5) * H}px) translate(-50%, -100%)`;
    }
    const dt = this.dt || 0.016;
    this.pops = this.pops.filter((p) => {
      p.t += dt;
      if (p.t > 0.8) { p.el.remove(); return false; }
      v.set(p.x, 2.4 + p.t * 2.2, p.z).project(this.camera);
      p.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px, ${(-v.y * 0.5 + 0.5) * H}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.15 - p.t) * 4})`;
      p.el.style.opacity = String(Math.min(1, (0.8 - p.t) * 4));
      return true;
    });
  }

  addFx(e) {
    const col = (c) => COLORS[(c ?? 0) % COLORS.length];
    const push = (obj, life, update) => { this.scene.add(obj); this.fxList.push({ obj, life, t: 0, update }); };
    const ringFx = (x, z, r, color, life, y = 0.1) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.78, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
      push(m, life, (k) => { const s = r * (0.3 + 0.7 * k); m.scale.set(s, s, s); m.material.opacity = 1 - k; });
    };
    const puffs = (x, z, color, n, spread, life, size = 0.5) => {
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), toon(color, { transparent: true }));
        const a = Math.random() * 6.28, sp = spread * (0.5 + Math.random() * 0.7);
        push(m, life, (k) => { const e2 = 1 - (1 - k) * (1 - k); m.position.set(x + Math.cos(a) * sp * e2, 0.6 + k * 1.2, z + Math.sin(a) * sp * e2); const s = 1 + k * 0.8; m.scale.set(s, s, s); m.material.opacity = 1 - k; });
      }
    };
    const stars = (x, z, color, n, sp0, life) => {
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.2), basic(color, 0.99));
        const a = Math.random() * 6.28, sp = sp0 * (0.5 + Math.random()), vy = 3 + Math.random() * 4;
        push(m, life, (k) => { const t = k * life; m.position.set(x + Math.cos(a) * sp * t, Math.max(0.1, 0.9 + vy * t - 9 * t * t), z + Math.sin(a) * sp * t); m.rotation.set(t * 10, t * 7, 0); m.material.opacity = 1 - k; });
      }
    };
    if (e.k === 'ring') {
      ringFx(e.x, e.z, e.r, e.slam ? 0xffd23f : 0xffffff, 0.4);
      ringFx(e.x, e.z, e.r * 0.8, e.slam ? 0xff8c2a : col(e.c), 0.3, 0.12);
      puffs(e.x, e.z, e.slam ? 0xd9c4a0 : 0xffffff, 8, e.r * 0.8, 0.5, 0.45);
    } else if (e.k === 'boom') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), toon(0xffc23a, { transparent: true, emissive: 0xff7a1a, emissiveIntensity: 0.6 }));
      m.position.set(e.x, 0.6, e.z);
      push(m, 0.28, (k) => { const s = e.r * (0.4 + 0.7 * k); m.scale.set(s, s * 0.8, s); m.material.opacity = 1 - k; });
      puffs(e.x, e.z, 0x6b6577, 7, e.r, 0.7, 0.5);
      stars(e.x, e.z, 0xffd23f, 6, 5, 0.5);
    } else if (e.k === 'swing') {
      const m = new THREE.Mesh(new THREE.RingGeometry(e.r * 0.45, e.r, 20, 1, -e.arc / 2, e.arc), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = -e.a; m.position.set(e.x, 0.7, e.z);
      push(m, 0.16, (k) => { m.material.opacity = 0.75 * (1 - k); const s = 0.85 + 0.25 * k; m.scale.set(s, s, s); });
    } else if (e.k === 'hit' || e.k === 'sweep') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), basic(e.s ? 0x4de1ff : 0xffffff, 0.99));
      m.position.set(e.x, 0.9, e.z);
      push(m, 0.16, (k) => { const s = 0.6 + k * 1.3; m.scale.set(s, s, s); m.material.opacity = 1 - k; });
      stars(e.x, e.z, e.s ? 0x4de1ff : 0xffd23f, 4, 4, 0.35);
    } else if (e.k === 'spark') {
      stars(e.x, e.z, 0xffffff, 3, 3, 0.25);
    } else if (e.k === 'tp') {
      for (const [x, z] of [[e.x0, e.z0], [e.x1, e.z1]]) {
        puffs(x, z, 0xc9b3ff, 5, 1.2, 0.4, 0.4);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 3, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xd9b3ff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        m.position.set(x, 1.5, z);
        push(m, 0.35, (k) => { m.scale.set(1 - k, 1 + k, 1 - k); m.material.opacity = 0.8 * (1 - k); });
      }
    } else if (e.k === 'portal') {
      ringFx(e.x, e.z, 1.6, 0x3ff0c8, 0.4, 0.15);
      puffs(e.x, e.z, 0x3ff0c8, 6, 1.1, 0.4, 0.35);
    } else if (e.k === 'elim') {
      if (e.how === 'fall') { // SPLASH
        const wy = e.pit ? 0.06 : -0.85;
        ringFx(e.x, e.z, 2.2, 0xffffff, 0.45, wy + 0.02); ringFx(e.x, e.z, 3.8, 0xffffff, 0.8, wy + 0.02);
        const col = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.2, 12), toon(0xdff6ff, { transparent: true }));
        push(col, 0.5, (k) => { const h = Math.sin(k * Math.PI); col.scale.set(1 - k * 0.5, h, 1 - k * 0.5); col.position.set(e.x, wy + 1.6 * h, e.z); col.material.opacity = 1 - k * k; });
        for (let i = 0; i < 16; i++) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.14 + Math.random() * 0.14, 8, 6), basic(i % 3 ? 0xffffff : 0x9fe3ff, 0.99));
          const a = Math.random() * 6.28, sp = 1.5 + Math.random() * 3.5, vy = 6 + Math.random() * 6;
          push(m, 0.9, (k) => { const t = k * 0.9; m.position.set(e.x + Math.cos(a) * sp * t, wy + vy * t - 13 * t * t, e.z + Math.sin(a) * sp * t); m.material.opacity = 1 - k * k; });
        }
      } else {
        puffs(e.x, e.z, 0xffffff, 10, 2.2, 0.7, 0.55);
        stars(e.x, e.z, col(e.c), 10, 5, 0.8);
        stars(e.x, e.z, 0xffd23f, 6, 4, 0.8);
      }
    } else if (e.k === 'pickup') {
      ringFx(e.x, e.z, 3, PU_COLORS[e.type], 0.4);
      stars(e.x, e.z, PU_COLORS[e.type], 6, 3, 0.5);
    } else if (e.k === 'hooked') {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(e.x, 0.85, e.z), new THREE.Vector3(e.x1, 0.85, e.z1)]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true }));
      push(line, 0.35, (k) => { line.material.opacity = 1 - k; });
      stars(e.self ? e.x1 : e.x, e.self ? e.z1 : e.z, 0xffd23f, 5, 3, 0.35);
    } else if (e.k === 'boo') {
      ringFx(e.x, e.z, 2.8, 0xe8eeff, 0.35, 0.5);
      puffs(e.x, e.z, 0xe8eeff, 5, 2, 0.45, 0.35);
    } else if (e.k === 'bonk') {
      stars(e.x, e.z, 0xffd23f, 8, 4, 0.5);
    } else if (e.k === 'blizzard') {
      puffs(e.x, e.z, 0xffffff, 10, 3.5, 0.8, 0.4);
    } else if (e.k === 'stampede') {
      puffs(e.x, e.z, 0xd9c4a0, 6, 1.5, 0.5, 0.45);
    } else if (e.k === 'confetti') {
      for (const c of [0xff5a5f, 0x3ea6ff, 0x4cd964, 0xffcc00, 0xb57bff, 0xff6ec7]) stars(e.x, e.z, c, 6, 5, 1.1);
    } else if (e.k === 'bump') {
      ringFx(e.x, e.z, 1.8, 0xff5fa2, 0.25);
    } else if (e.k === 'dash') {
      puffs(e.x, e.z, 0xe8e2d0, 3, 0.8, 0.35, 0.3);
    }
  }
}
