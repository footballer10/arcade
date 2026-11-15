// Three.js rendering for Arena Royale.
import * as THREE from 'three';
import { ARENA_R, OBSTACLES } from './sim.js';

export const COLORS = [0xff5a5f, 0x3ea6ff, 0x4cd964, 0xffcc00, 0xb57bff, 0xff8c42, 0x2ee6d6, 0xff6ec7];
export const cssColor = (i) => '#' + COLORS[i % COLORS.length].toString(16).padStart(6, '0');
const PU_COLORS = { speed: 0xffe14d, shield: 0x4de1ff, dmg: 0xff4d4d };

export class Renderer {
  constructor(canvas, labelsEl) {
    this.labelsEl = labelsEl;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d1a);
    this.scene.fog = new THREE.Fog(0x0b0d1a, 40, 90);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camDist = 1;
    this.camTarget = new THREE.Vector3();
    this.camera.position.set(0, 24, 16);

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x202030, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(12, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 80;
    this.scene.add(sun);

    // arena platform
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_R, ARENA_R * 0.8, 3, 72),
      new THREE.MeshStandardMaterial({ color: 0x39405e, roughness: 0.9 }));
    plat.position.y = -1.5; plat.receiveShadow = true;
    this.scene.add(plat);
    const top = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R, 72), new THREE.MeshStandardMaterial({ color: 0x4a5378, roughness: 0.85 }));
    top.rotation.x = -Math.PI / 2; top.position.y = 0.001; top.receiveShadow = true;
    this.scene.add(top);
    const grid = new THREE.PolarGridHelper(ARENA_R, 16, 8, 72, 0x5d6894, 0x5d6894);
    grid.position.y = 0.01; this.scene.add(grid);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R, 0.12, 8, 96), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    edge.rotation.x = Math.PI / 2; this.scene.add(edge);

    // danger zone: shader-discarded disc + translucent wall
    this.zoneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { zoneR: { value: ARENA_R }, time: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float zoneR; uniform float time; varying vec2 vP; void main(){ float d=length(vP); if(d<zoneR) discard; float s=0.5+0.5*sin((d-time*3.0)*2.0); gl_FragColor=vec4(1.0,0.15,0.2,0.28+0.12*s); }',
    });
    const zone = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R, 96), this.zoneMat);
    zone.rotation.x = -Math.PI / 2; zone.position.y = 0.02; this.scene.add(zone);
    this.zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 96, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    this.zoneWall.position.y = 1.5; this.scene.add(this.zoneWall);

    // obstacles
    const obMat = new THREE.MeshStandardMaterial({ color: 0x8a92b8, roughness: 0.6 });
    for (const o of OBSTACLES) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.08, 2.4, 20), obMat);
      m.position.set(o.x, 1.2, o.z); m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    }

    // aim reticle for local player
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.reticle.rotation.x = -Math.PI / 2; this.reticle.position.y = 0.05; this.scene.add(this.reticle);
    this.tpPreview = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 24), new THREE.MeshBasicMaterial({ color: 0xb57bff, transparent: true, opacity: 0.5 }));
    this.tpPreview.rotation.x = -Math.PI / 2; this.tpPreview.position.y = 0.04; this.tpPreview.visible = false; this.scene.add(this.tpPreview);

    this.players = new Map();
    this.projMeshes = new Map();
    this.puMeshes = new Map();
    this.fxList = [];
    this.boltGeo = new THREE.SphereGeometry(0.28, 10, 8);
    this.puGeo = new THREE.OctahedronGeometry(0.55);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  mouseToGround(nx, ny) {
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const v = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, v) ? v : null;
  }

  makePlayer(p) {
    const color = COLORS[p.color % COLORS.length];
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: 0x000000 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.6 });
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    const add = (geo, m, x, y, z) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; body.add(mesh); return mesh; };
    if (p.char === 'blaster') {
      add(new THREE.CylinderGeometry(0.5, 0.55, 1.1, 16), mat, 0, 0.55, 0);
      add(new THREE.SphereGeometry(0.38, 16, 12), mat, 0, 1.35, 0);
      add(new THREE.BoxGeometry(0.9, 0.22, 0.22), dark, 0.6, 0.85, 0.3);
    } else if (p.char === 'brawler') {
      add(new THREE.BoxGeometry(1.15, 1.1, 0.95), mat, 0, 0.6, 0);
      add(new THREE.BoxGeometry(0.6, 0.5, 0.6), mat, 0, 1.4, 0);
      add(new THREE.SphereGeometry(0.3, 12, 10), dark, 0.55, 0.75, 0.62);
      add(new THREE.SphereGeometry(0.3, 12, 10), dark, 0.55, 0.75, -0.62);
    } else {
      add(new THREE.ConeGeometry(0.55, 1.6, 16), mat, 0, 0.8, 0);
      add(new THREE.SphereGeometry(0.28, 14, 10), mat, 0, 1.6, 0);
      add(new THREE.BoxGeometry(0.7, 0.05, 0.12), dark, 0.55, 0.8, 0.35);
      add(new THREE.BoxGeometry(0.7, 0.05, 0.12), dark, 0.55, 0.8, -0.35);
    }
    // facing nose
    add(new THREE.ConeGeometry(0.15, 0.4, 8), dark, 0.75, 0.25, 0).rotation.z = -Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 14), new THREE.MeshBasicMaterial({ color: 0x4de1ff, transparent: true, opacity: 0.25, depthWrite: false }));
    shield.position.y = 0.8; shield.visible = false; g.add(shield);
    this.scene.add(g);

    const label = document.createElement('div');
    label.className = 'plabel';
    label.innerHTML = `<div class="pname"></div><div class="hpbar"><div class="hpfill"></div><div class="shfill"></div></div><div class="buffs"></div>`;
    this.labelsEl.appendChild(label);
    const rec = { g, body, mat, ring, shield, label, nameEl: label.querySelector('.pname'), hpEl: label.querySelector('.hpfill'), shEl: label.querySelector('.shfill'), buffEl: label.querySelector('.buffs'), char: p.char, color: p.color, lastHp: '', lastBuff: '' };
    rec.nameEl.textContent = p.name;
    rec.nameEl.style.color = cssColor(p.color);
    return rec;
  }

  removePlayer(id) {
    const r = this.players.get(id);
    if (!r) return;
    this.scene.remove(r.g); r.label.remove();
    this.players.delete(id);
  }
  clearPlayers() { for (const id of [...this.players.keys()]) this.removePlayer(id); for (const m of this.projMeshes.values()) this.scene.remove(m); this.projMeshes.clear(); for (const m of this.puMeshes.values()) this.scene.remove(m); this.puMeshes.clear(); }

  // view: {players, proj, pu, zoneR}; localId; overrides: {id:{x,z,aim}}; camFocus {x,z}; aimPt
  render(view, localId, dt, camFocus, aimPt, showTp) {
    const now = performance.now() / 1000;
    this.zoneMat.uniforms.zoneR.value = view.zoneR;
    this.zoneMat.uniforms.time.value = now;
    const zr = Math.max(0.01, Math.min(view.zoneR, ARENA_R));
    this.zoneWall.scale.set(zr, 1, zr);
    this.zoneWall.visible = view.zoneR < ARENA_R - 0.05;

    const seen = new Set();
    for (const p of view.players) {
      seen.add(p.id);
      let r = this.players.get(p.id);
      if (r && (r.char !== p.char || r.color !== p.color)) { this.removePlayer(p.id); r = null; }
      if (!r) { r = this.makePlayer(p); this.players.set(p.id, r); }
      const vis = p.alive;
      r.g.visible = vis;
      r.label.style.display = vis && !p.falling ? '' : 'none';
      if (!vis) continue;
      let hop = 0;
      if (p.slamT > 0) hop = Math.sin((1 - p.slamT / 0.35) * Math.PI) * 1.4;
      r.g.position.set(p.x, p.y + hop, p.z);
      r.body.rotation.y = -p.aim;
      const sw = p.swingT > 0 ? 1 + p.swingT * 2 : 1;
      r.body.scale.set(sw, 1, 1);
      const flash = p.hitT > 0 ? 0.9 : p.invT > 0 ? 0.35 : p.dmgT > 0 ? 0.15 + 0.1 * Math.sin(now * 12) : 0;
      r.mat.emissive.setRGB(flash, p.dmgT > 0 && p.hitT <= 0 ? flash * 0.2 : flash, p.dmgT > 0 && p.hitT <= 0 ? flash * 0.2 : flash);
      r.shield.visible = p.shield > 0;
      r.ring.material.color.setHex(p.id === localId ? 0xffffff : COLORS[p.color % COLORS.length]);
      const hpKey = p.hp + '/' + p.shield;
      if (hpKey !== r.lastHp) {
        r.lastHp = hpKey;
        const f = Math.max(0, p.hp / p.maxHp);
        r.hpEl.style.width = (f * 100) + '%';
        r.hpEl.style.background = f > 0.5 ? '#4cd964' : f > 0.25 ? '#ffcc00' : '#ff3b30';
        r.shEl.style.width = Math.min(100, p.shield / 40 * 100) + '%';
      }
      const bk = (p.speedT > 0 ? '⚡' : '') + (p.dmgT > 0 ? '🔥' : '');
      if (bk !== r.lastBuff) { r.lastBuff = bk; r.buffEl.textContent = bk; }
      const sp = new THREE.Vector3(p.x, p.y + 2.3, p.z).project(this.camera);
      r.label.style.transform = `translate(${(sp.x * 0.5 + 0.5) * window.innerWidth}px, ${(-sp.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -100%)`;
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.removePlayer(id);

    // projectiles
    const ps = new Set();
    for (const b of view.proj) {
      ps.add(b.id);
      let m = this.projMeshes.get(b.id);
      if (!m) {
        m = new THREE.Mesh(this.boltGeo, new THREE.MeshBasicMaterial({ color: COLORS[b.color % COLORS.length] }));
        this.scene.add(m); this.projMeshes.set(b.id, m);
      }
      m.position.set(b.x, 0.85, b.z);
    }
    for (const [id, m] of this.projMeshes) if (!ps.has(id)) { this.scene.remove(m); this.projMeshes.delete(id); }

    // powerups
    const us = new Set();
    for (const u of view.pu) {
      us.add(u.id);
      let m = this.puMeshes.get(u.id);
      if (!m) {
        m = new THREE.Mesh(this.puGeo, new THREE.MeshStandardMaterial({ color: PU_COLORS[u.type], emissive: PU_COLORS[u.type], emissiveIntensity: 0.6 }));
        m.castShadow = true; this.scene.add(m); this.puMeshes.set(u.id, m);
      }
      m.position.set(u.x, 0.8 + Math.sin(now * 3 + u.id) * 0.2, u.z);
      m.rotation.y = now * 2;
    }
    for (const [id, m] of this.puMeshes) if (!us.has(id)) { this.scene.remove(m); this.puMeshes.delete(id); }

    // fx
    this.fxList = this.fxList.filter((f) => {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { this.scene.remove(f.obj); return false; }
      f.update(k);
      return true;
    });

    // reticle
    if (aimPt) { this.reticle.visible = true; this.reticle.position.x = aimPt.x; this.reticle.position.z = aimPt.z; } else this.reticle.visible = false;
    if (showTp) { this.tpPreview.visible = true; this.tpPreview.position.x = showTp.x; this.tpPreview.position.z = showTp.z; } else this.tpPreview.visible = false;

    // camera
    if (camFocus) this.camTarget.lerp(new THREE.Vector3(camFocus.x, 0, camFocus.z), Math.min(1, dt * 6));
    const off = new THREE.Vector3(0, 21, 14).multiplyScalar(this.camDist);
    this.camera.position.copy(this.camTarget).add(off);
    this.camera.lookAt(this.camTarget);
    this.renderer.render(this.scene, this.camera);
  }

  addFx(e, players) {
    const col = (c) => COLORS[(c ?? 0) % COLORS.length];
    const push = (obj, life, update) => { this.scene.add(obj); this.fxList.push({ obj, life, t: 0, update }); };
    if (e.k === 'ring') {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: e.slam ? 0xffaa33 : col(e.c), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(e.x, 0.1, e.z);
      push(m, 0.4, (k) => { const s = e.r * (0.3 + 0.7 * k); m.scale.set(s, s, s); m.material.opacity = 1 - k; });
    } else if (e.k === 'swing') {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.6, e.r, 20, 1, -e.arc / 2, e.arc), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = -e.a; m.position.set(e.x, 0.6, e.z);
      push(m, 0.15, (k) => { m.material.opacity = 0.6 * (1 - k); });
    } else if (e.k === 'hit' || e.k === 'spark') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: e.s ? 0x4de1ff : 0xffffff, transparent: true, depthWrite: false }));
      m.position.set(e.x, 0.9, e.z);
      push(m, 0.2, (k) => { const s = 0.5 + k * 1.2; m.scale.set(s, s, s); m.material.opacity = 1 - k; });
    } else if (e.k === 'tp') {
      for (const [x, z] of [[e.x0, e.z0], [e.x1, e.z1]]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 3, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xd9b3ff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        m.position.set(x, 1.5, z);
        push(m, 0.35, (k) => { m.scale.set(1 - k, 1 + k, 1 - k); m.material.opacity = 0.8 * (1 - k); });
      }
    } else if (e.k === 'elim') {
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), new THREE.MeshBasicMaterial({ color: col(e.c), transparent: true }));
        const a = Math.random() * 6.28, sp = 3 + Math.random() * 5, vy = 4 + Math.random() * 5;
        m.position.set(e.x, 0.8, e.z);
        push(m, 0.8, (k) => { const t = k * 0.8; m.position.set(e.x + Math.cos(a) * sp * t, 0.8 + vy * t - 9 * t * t, e.z + Math.sin(a) * sp * t); m.material.opacity = 1 - k; });
      }
    } else if (e.k === 'pickup') {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.6, 24), new THREE.MeshBasicMaterial({ color: PU_COLORS[e.type], transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(e.x, 0.2, e.z);
      push(m, 0.4, (k) => { const s = 1 + k * 3; m.scale.set(s, s, s); m.material.opacity = 1 - k; });
    } else if (e.k === 'dash') {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(e.x, 0.05, e.z);
      push(m, 0.3, (k) => { m.material.opacity = 0.5 * (1 - k); });
    }
  }
}
