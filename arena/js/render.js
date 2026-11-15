// Three.js rendering for Arena Royale.
import * as THREE from 'three';
import { ARENA_R, OBSTACLES, HOLES, MAP, sweeperAngle, BLAST_R, SLAM_R, BOMB_R } from './sim.js';

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
    this.shakeAmp = 0;
    this.freezeUntil = 0;
    this.pops = [];

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x202030, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(12, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 80;
    this.scene.add(sun);

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

    this.mapGroup = new THREE.Group(); this.scene.add(this.mapGroup);
    this.mapKey = null;
    this.buildMap();

    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.reticle.rotation.x = -Math.PI / 2; this.reticle.position.y = 0.05; this.scene.add(this.reticle);
    this.tpPreview = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 24), new THREE.MeshBasicMaterial({ color: 0xb57bff, transparent: true, opacity: 0.5, depthWrite: false }));
    this.tpPreview.rotation.x = -Math.PI / 2; this.tpPreview.position.y = 0.04; this.tpPreview.visible = false; this.scene.add(this.tpPreview);
    // faint range ring around the local player while their special is ready (blast/slam reach)
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15, depthWrite: false }));
    this.rangeRing.rotation.x = -Math.PI / 2; this.rangeRing.position.y = 0.03; this.rangeRing.visible = false; this.scene.add(this.rangeRing);

    this.players = new Map();
    this.projMeshes = new Map();
    this.puMeshes = new Map();
    this.wellMeshes = [];
    this.fxList = [];
    this.boltGeo = new THREE.SphereGeometry(0.28, 10, 8);
    this.bombGeo = new THREE.SphereGeometry(0.36, 12, 10);
    this.puGeo = new THREE.OctahedronGeometry(0.55);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  buildMap() {
    if (this.mapKey === MAP.key) return;
    this.mapKey = MAP.key;
    for (const c of [...this.mapGroup.children]) this.mapGroup.remove(c);
    const obMat = new THREE.MeshStandardMaterial({ color: 0x8a92b8, roughness: 0.6 });
    const bumpMat = new THREE.MeshStandardMaterial({ color: 0xff5fa2, emissive: 0x661033, roughness: 0.4 });
    for (const o of OBSTACLES) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.08, o.bumper ? 1.2 : 2.4, 24), o.bumper ? bumpMat : obMat);
      m.position.set(o.x, o.bumper ? 0.6 : 1.2, o.z); m.castShadow = true; m.receiveShadow = true;
      this.mapGroup.add(m);
      if (o.bumper) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(o.r + 0.05, 0.12, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        ring.rotation.x = Math.PI / 2; ring.position.set(o.x, 1.2, o.z); this.mapGroup.add(ring);
        o._ring = ring;
      }
    }
    for (const h of HOLES) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(h.r, 40), new THREE.MeshBasicMaterial({ color: 0x05060d }));
      m.rotation.x = -Math.PI / 2; m.position.set(h.x, 0.03, h.z); this.mapGroup.add(m);
      const rim = new THREE.Mesh(new THREE.RingGeometry(h.r, h.r + 0.25, 40), new THREE.MeshBasicMaterial({ color: 0xff8c42 }));
      rim.rotation.x = -Math.PI / 2; rim.position.set(h.x, 0.035, h.z); this.mapGroup.add(rim);
    }
    this.beam = null;
    if (MAP.sweeper) {
      const sw = MAP.sweeper;
      const pivot = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sw.len - 1, 0.7, sw.width * 1.6), new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0x663300, roughness: 0.4 }));
      bar.position.set(1 + (sw.len - 1) / 2, 0.55, 0); bar.castShadow = true;
      pivot.add(bar);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(sw.len - 1, 2.2), new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.15, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2; glow.position.set(1 + (sw.len - 1) / 2, 0.04, 0);
      pivot.add(glow);
      this.mapGroup.add(pivot);
      this.beam = pivot;
    }
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

  shake(a) { this.shakeAmp = Math.min(1.2, Math.max(this.shakeAmp, a)); }
  hitstop(ms) { this.freezeUntil = Math.max(this.freezeUntil, performance.now() + ms); }
  popText(x, z, text, cls) {
    const el = document.createElement('div');
    el.className = 'pop ' + (cls || '');
    el.textContent = text;
    el.style.opacity = '0';
    this.labelsEl.appendChild(el);
    this.pops.push({ el, x: x + (Math.random() - 0.5) * 0.6, z, t: 0 });
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
    } else if (p.char === 'bomber') {
      add(new THREE.SphereGeometry(0.62, 18, 14), mat, 0, 0.7, 0);
      add(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 6), dark, 0, 1.45, 0);
      add(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffaa00 }), 0, 1.7, 0);
      add(new THREE.SphereGeometry(0.22, 10, 8), dark, 0.45, 0.9, 0.42);
    } else {
      add(new THREE.ConeGeometry(0.55, 1.6, 16), mat, 0, 0.8, 0);
      add(new THREE.SphereGeometry(0.28, 14, 10), mat, 0, 1.6, 0);
      add(new THREE.BoxGeometry(0.7, 0.05, 0.12), dark, 0.55, 0.8, 0.35);
      add(new THREE.BoxGeometry(0.7, 0.05, 0.12), dark, 0.55, 0.8, -0.35);
    }
    add(new THREE.ConeGeometry(0.15, 0.4, 8), dark, 0.75, 0.25, 0).rotation.z = -Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 14), new THREE.MeshBasicMaterial({ color: 0x4de1ff, transparent: true, opacity: 0.25, depthWrite: false }));
    shield.position.y = 0.8; shield.visible = false; g.add(shield);
    // wind-up telegraph (slam / blast): a ring on the ground that fills up
    const tele = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    tele.rotation.x = -Math.PI / 2; tele.visible = false; this.scene.add(tele);
    const teleFill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.18, depthWrite: false }));
    teleFill.rotation.x = -Math.PI / 2; teleFill.visible = false; this.scene.add(teleFill);
    this.scene.add(g);

    const label = document.createElement('div');
    label.className = 'plabel';
    label.innerHTML = `<div class="pname"></div><div class="hpbar"><div class="hpfill"></div><div class="shfill"></div></div><div class="buffs"></div>`;
    this.labelsEl.appendChild(label);
    const rec = { g, body, mat, ring, shield, tele, teleFill, label, nameEl: label.querySelector('.pname'), hpEl: label.querySelector('.hpfill'), shEl: label.querySelector('.shfill'), buffEl: label.querySelector('.buffs'), char: p.char, color: p.color, lastHp: '', lastBuff: '' };
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
    for (const m of this.projMeshes.values()) { this.scene.remove(m); if (m.userData.marker) this.scene.remove(m.userData.marker); }
    this.projMeshes.clear();
    for (const m of this.puMeshes.values()) this.scene.remove(m);
    this.puMeshes.clear();
    for (const p of this.pops) p.el.remove();
    this.pops = [];
  }

  // view: {players, proj, pu, wells, zoneR, t}
  render(view, localId, dt, camFocus, aimPt, showTp) {
    const nowMs = performance.now();
    const now = nowMs / 1000;
    this.buildMap();
    const frozen = nowMs < this.freezeUntil;
    if (!frozen) this.updateScene(view, localId, dt, now, aimPt, showTp);

    if (camFocus) this.camTarget.lerp(new THREE.Vector3(camFocus.x, 0, camFocus.z), Math.min(1, dt * 6));
    const off = new THREE.Vector3(0, 21, 14).multiplyScalar(this.camDist);
    this.camera.position.copy(this.camTarget).add(off);
    this.camera.lookAt(this.camTarget);
    if (this.shakeAmp > 0.01) {
      const a = this.shakeAmp;
      this.camera.position.x += (Math.random() - 0.5) * a; this.camera.position.y += (Math.random() - 0.5) * a * 0.5; this.camera.position.z += (Math.random() - 0.5) * a;
      this.shakeAmp *= Math.exp(-dt * 9);
    }
    this.renderer.render(this.scene, this.camera);
    if (!frozen) this.updateLabels(view);
  }

  updateScene(view, localId, dt, now, aimPt, showTp) {
    this.zoneMat.uniforms.zoneR.value = view.zoneR;
    this.zoneMat.uniforms.time.value = now;
    const zr = Math.max(0.01, Math.min(view.zoneR, ARENA_R));
    this.zoneWall.scale.set(zr, 1, zr);
    this.zoneWall.visible = view.zoneR < ARENA_R - 0.05;
    if (this.beam) this.beam.rotation.y = -sweeperAngle(view.t || 0);
    for (const o of OBSTACLES) if (o._ring) o._ring.position.y = 1.2 + Math.sin(now * 4 + o.x) * 0.05;

    const seen = new Set();
    for (const p of view.players) {
      seen.add(p.id);
      let r = this.players.get(p.id);
      if (r && (r.char !== p.char || r.color !== p.color)) { this.removePlayer(p.id); r = null; }
      if (!r) { r = this.makePlayer(p); this.players.set(p.id, r); }
      r.p = p;
      const vis = p.alive;
      r.g.visible = vis;
      if (!vis) { r.tele.visible = r.teleFill.visible = false; continue; }
      let hop = 0;
      if (p.slamT > 0) hop = Math.sin((1 - p.slamT / 0.35) * Math.PI) * 1.4;
      r.g.position.set(p.x, p.y + hop, p.z);
      r.body.rotation.y = -p.aim;
      const sw = p.swingT > 0 ? 1 + p.swingT * 2 : 1;
      const charge = p.blastT > 0 ? 1 + (1 - p.blastT / 0.18) * 0.25 : 1;
      r.body.scale.set(sw * charge, charge, charge);
      const flash = p.hitT > 0 ? 0.9 : p.invT > 0 ? 0.35 : p.blastT > 0 ? 0.5 : p.dmgT > 0 ? 0.15 + 0.1 * Math.sin(now * 12) : 0;
      const red = p.dmgT > 0 && p.hitT <= 0;
      r.mat.emissive.setRGB(flash, red ? flash * 0.2 : flash, red ? flash * 0.2 : flash);
      r.shield.visible = p.shield > 0;
      r.ring.material.color.setHex(p.id === localId ? 0xffffff : COLORS[p.color % COLORS.length]);
      // telegraphs
      if (p.slamT > 0 || p.blastT > 0) {
        const R = p.slamT > 0 ? SLAM_R : BLAST_R;
        const k = p.slamT > 0 ? 1 - p.slamT / 0.35 : 1 - p.blastT / 0.18;
        const col = p.slamT > 0 ? 0xffaa33 : COLORS[p.color % COLORS.length];
        r.tele.visible = r.teleFill.visible = true;
        r.tele.material.color.setHex(col); r.teleFill.material.color.setHex(col);
        r.tele.position.set(p.x, 0.06, p.z); r.tele.scale.set(R, R, R);
        r.teleFill.position.set(p.x, 0.05, p.z); const fr = Math.max(0.05, R * k); r.teleFill.scale.set(fr, fr, fr);
      } else r.tele.visible = r.teleFill.visible = false;
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.removePlayer(id);

    // projectiles (bolts fly flat, bombs arc with a landing marker)
    const ps = new Set();
    for (const b of view.proj) {
      ps.add(b.id);
      let m = this.projMeshes.get(b.id);
      if (!m) {
        if (b.kind === 1) {
          m = new THREE.Mesh(this.bombGeo, new THREE.MeshStandardMaterial({ color: 0x222233, emissive: COLORS[b.color % COLORS.length], emissiveIntensity: 0.5 }));
          const mk = new THREE.Mesh(new THREE.RingGeometry(BOMB_R - 0.15, BOMB_R, 40), new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
          mk.rotation.x = -Math.PI / 2; mk.position.set(b.tx, 0.06, b.tz);
          this.scene.add(mk); m.userData.marker = mk;
        } else m = new THREE.Mesh(this.boltGeo, new THREE.MeshBasicMaterial({ color: COLORS[b.color % COLORS.length] }));
        m.castShadow = true;
        this.scene.add(m); this.projMeshes.set(b.id, m);
      }
      if (b.kind === 1) {
        const f = b.f;
        m.position.set(b.x, 0.9 + 4.5 * f * (1 - f) * Math.min(1.5, b.T * 2.2), b.z);
        m.userData.marker.material.opacity = 0.3 + 0.6 * f;
      } else m.position.set(b.x, 0.85, b.z);
    }
    for (const [id, m] of this.projMeshes) if (!ps.has(id)) { this.scene.remove(m); if (m.userData.marker) this.scene.remove(m.userData.marker); this.projMeshes.delete(id); }

    // gravity wells
    const wells = view.wells || [];
    while (this.wellMeshes.length < wells.length) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 1, 48, 3), new THREE.MeshBasicMaterial({ color: 0xb57bff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, wireframe: true }));
      m.rotation.x = -Math.PI / 2; this.scene.add(m); this.wellMeshes.push(m);
    }
    this.wellMeshes.forEach((m, i) => {
      const w = wells[i];
      m.visible = !!w;
      if (!w) return;
      m.position.set(w.x, 0.07, w.z);
      const s = w.r * (0.9 + 0.1 * Math.sin(now * 10));
      m.scale.set(s, s, s); m.rotation.z = now * 4;
      m.material.color.setHex(COLORS[w.color % COLORS.length]);
    });

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

    this.fxList = this.fxList.filter((f) => {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { this.scene.remove(f.obj); return false; }
      f.update(k);
      return true;
    });

    if (aimPt) { this.reticle.visible = true; this.reticle.position.x = aimPt.x; this.reticle.position.z = aimPt.z; } else this.reticle.visible = false;
    if (showTp) { this.tpPreview.visible = true; this.tpPreview.position.x = showTp.x; this.tpPreview.position.z = showTp.z; const s = showTp.r || 1; this.tpPreview.scale.set(s, s, s); } else this.tpPreview.visible = false;
    const me = view.players.find((p) => p.id === localId);
    const R = me && me.alive && me.spCd <= 0 ? (me.char === 'blaster' ? BLAST_R : me.char === 'brawler' ? SLAM_R : 0) : 0;
    this.rangeRing.visible = R > 0;
    if (R) { this.rangeRing.position.x = me.x; this.rangeRing.position.z = me.z; this.rangeRing.scale.set(R, R, R); }
    this.dt = dt;
  }

  updateLabels(view) {
    const W = window.innerWidth, H = window.innerHeight, v = new THREE.Vector3();
    for (const r of this.players.values()) {
      const p = r.p;
      if (!p) continue;
      const show = p.alive && !p.falling;
      r.label.style.display = show ? '' : 'none';
      if (!show) continue;
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
      v.set(r.g.position.x, r.g.position.y + 2.3, r.g.position.z).project(this.camera);
      r.label.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px, ${(-v.y * 0.5 + 0.5) * H}px) translate(-50%, -100%)`;
    }
    const dt = this.dt || 0.016;
    this.pops = this.pops.filter((p) => {
      p.t += dt;
      if (p.t > 0.8) { p.el.remove(); return false; }
      v.set(p.x, 2.2 + p.t * 2.2, p.z).project(this.camera);
      p.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px, ${(-v.y * 0.5 + 0.5) * H}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.15 - p.t) * 4})`;
      p.el.style.opacity = String(Math.min(1, (0.8 - p.t) * 4));
      return true;
    });
  }

  addFx(e) {
    const col = (c) => COLORS[(c ?? 0) % COLORS.length];
    const push = (obj, life, update) => { this.scene.add(obj); this.fxList.push({ obj, life, t: 0, update }); };
    const ringFx = (x, z, r, color, life) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.1, z);
      push(m, life, (k) => { const s = r * (0.3 + 0.7 * k); m.scale.set(s, s, s); m.material.opacity = 1 - k; });
    };
    const burst = (x, z, color, n, sp0, life) => {
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshBasicMaterial({ color, transparent: true }));
        const a = Math.random() * 6.28, sp = sp0 * (0.5 + Math.random()), vy = 4 + Math.random() * 5;
        m.position.set(x, 0.8, z);
        push(m, life, (k) => { const t = k * life; m.position.set(x + Math.cos(a) * sp * t, Math.max(0.1, 0.8 + vy * t - 9 * t * t), z + Math.sin(a) * sp * t); m.material.opacity = 1 - k; });
      }
    };
    if (e.k === 'ring') {
      ringFx(e.x, e.z, e.r, e.slam ? 0xffaa33 : col(e.c), 0.4);
      if (e.slam) burst(e.x, e.z, 0xb0a080, 10, 6, 0.5);
    } else if (e.k === 'boom') {
      ringFx(e.x, e.z, e.r, 0xff7733, 0.35);
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, depthWrite: false }));
      m.position.set(e.x, 0.6, e.z);
      push(m, 0.3, (k) => { const s = e.r * (0.4 + 0.6 * k); m.scale.set(s, s * 0.7, s); m.material.opacity = 0.9 * (1 - k); });
      burst(e.x, e.z, 0x333333, 8, 5, 0.6);
    } else if (e.k === 'swing') {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.6, e.r, 20, 1, -e.arc / 2, e.arc), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = -e.a; m.position.set(e.x, 0.6, e.z);
      push(m, 0.15, (k) => { m.material.opacity = 0.6 * (1 - k); });
    } else if (e.k === 'hit' || e.k === 'spark' || e.k === 'sweep') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: e.s ? 0x4de1ff : e.k === 'sweep' ? 0xffb020 : 0xffffff, transparent: true, depthWrite: false }));
      m.position.set(e.x, 0.9, e.z);
      push(m, 0.2, (k) => { const s = 0.5 + k * 1.2; m.scale.set(s, s, s); m.material.opacity = 1 - k; });
    } else if (e.k === 'tp') {
      for (const [x, z] of [[e.x0, e.z0], [e.x1, e.z1]]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 3, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xd9b3ff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        m.position.set(x, 1.5, z);
        push(m, 0.35, (k) => { m.scale.set(1 - k, 1 + k, 1 - k); m.material.opacity = 0.8 * (1 - k); });
      }
    } else if (e.k === 'elim') {
      burst(e.x, e.z, col(e.c), 16, 5, 0.8);
    } else if (e.k === 'pickup') {
      ringFx(e.x, e.z, 3, PU_COLORS[e.type], 0.4);
    } else if (e.k === 'bump') {
      ringFx(e.x, e.z, 1.6, 0xff5fa2, 0.25);
    } else if (e.k === 'dash') {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(e.x, 0.05, e.z);
      push(m, 0.3, (k) => { m.material.opacity = 0.5 * (1 - k); });
    }
  }
}
