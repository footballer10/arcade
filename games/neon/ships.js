// NEON RUSH — ship models (hover racer in the player's party colour, with the player's avatar in the cockpit),
// light trails, drift sparks, boost flames and name tags.
import * as THREE from 'three';
import { glowTex } from './render.js';

export const TIER_COLORS = [0xffffff, 0x38c8ff, 0xff4fd8, 0xffd23f];

// Shared hull geometry (built once per round, disposed with the round).
function hullGeometry() {
  // a sleek wedge: nose at -z, wide rear with two engine pods
  const v = [
    // x, y, z
    0, 0.28, -2.6,     // 0 nose top
    0, -0.05, -2.7,    // 1 nose bottom
    -0.95, 0.2, 0.4,   // 2 left shoulder top
    0.95, 0.2, 0.4,    // 3 right shoulder top
    -1.15, -0.1, 1.5,  // 4 left rear bottom
    1.15, -0.1, 1.5,   // 5 right rear bottom
    -0.8, 0.45, 1.6,   // 6 left rear top
    0.8, 0.45, 1.6,    // 7 right rear top
    0, 0.62, 0.6,      // 8 spine
    -0.9, -0.15, 0.3,  // 9 left belly
    0.9, -0.15, 0.3,   // 10 right belly
  ];
  const f = [
    0, 2, 8, 0, 8, 3, 2, 6, 8, 8, 7, 3, 6, 7, 8,           // top
    0, 1, 2, 0, 3, 1, 1, 9, 2, 1, 3, 10,                   // nose sides
    2, 9, 4, 2, 4, 6, 3, 5, 10, 3, 7, 5,                   // flanks
    1, 10, 9, 9, 10, 4, 10, 5, 4,                          // belly
    4, 5, 6, 5, 7, 6,                                      // rear
  ];
  const g = new THREE.BufferGeometry();
  const pos = [];
  for (let i = 0; i < f.length; i++) pos.push(v[f[i] * 3], v[f[i] * 3 + 1], v[f[i] * 3 + 2]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class ShipKit {
  constructor(ctx, scene) {
    this.ctx = ctx; this.scene = scene;
    this.hull = hullGeometry();
    this.pod = new THREE.CylinderGeometry(0.32, 0.38, 1.9, 10); this.pod.rotateX(Math.PI / 2);
    this.fin = new THREE.BoxGeometry(0.08, 0.6, 0.8);
    this.canopy = new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    this.flame = new THREE.ConeGeometry(0.3, 1.6, 10, 1, true); this.flame.rotateX(-Math.PI / 2); this.flame.translate(0, 0, 0.8);
    this.glowPlane = new THREE.PlaneGeometry(1, 1); this.glowPlane.rotateX(-Math.PI / 2);
    this.glow = glowTex();
    this.ink = new THREE.MeshBasicMaterial({ color: 0x120c26, side: THREE.BackSide });
    this.glass = new THREE.MeshPhongMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.35, shininess: 90, specular: 0xffffff, depthWrite: false });
    this.dark = new THREE.MeshLambertMaterial({ color: 0x1b1630 });
    this.mats = [this.ink, this.glass, this.dark];
    this.geos = [this.hull, this.pod, this.fin, this.canopy, this.flame, this.glowPlane];
  }
  build(player) {
    const col = new THREE.Color(player.colorHex);
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);          // body tilts / banks; root sits on the surface
    const hullMat = new THREE.MeshToonMaterial({ color: col, emissive: col.clone().multiplyScalar(0.12) });
    const stripeMat = new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.3) });
    const flameMat = new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.4), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowMat = new THREE.MeshBasicMaterial({ map: this.glow, color: col.clone().multiplyScalar(0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 });
    const hull = new THREE.Mesh(this.hull, hullMat); hull.castShadow = true; body.add(hull);
    const out = new THREE.Mesh(this.hull, this.ink); out.scale.setScalar(1.07); body.add(out);
    const pods = [];
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(this.pod, this.dark); p.position.set(sx * 1.05, 0.08, 1.0); p.castShadow = true; body.add(p);
      const ring = new THREE.Mesh(this.pod, stripeMat); ring.scale.set(1.08, 1.08, 0.12); ring.position.set(sx * 1.05, 0.08, 1.9); body.add(ring);
      const fl = new THREE.Mesh(this.flame, flameMat); fl.position.set(sx * 1.05, 0.08, 1.95); body.add(fl); pods.push(fl);
      const fin = new THREE.Mesh(this.fin, stripeMat); fin.position.set(sx * 0.7, 0.62, 1.35); fin.rotation.z = sx * 0.3; body.add(fin);
    }
    // pilot: the player's own avatar, small, in the cockpit, under a glass canopy
    const pilot = this.ctx.avatar.build(player); pilot.scale.setScalar(0.48); pilot.position.set(0, 0.05, -0.2);
    pilot.traverse((o) => { o.castShadow = false; });
    body.add(pilot);
    const can = new THREE.Mesh(this.canopy, this.glass); can.scale.set(0.9, 0.95, 1.25); can.position.set(0, 0.42, -0.25); body.add(can);
    // under-glow
    const glow = new THREE.Mesh(this.glowPlane, glowMat); glow.scale.set(3.6, 1, 5.5); glow.position.y = -0.55; glow.renderOrder = 2; root.add(glow);
    this.scene.add(root);
    return { root, body, pods, pilot, glow, hullMat, stripeMat, flameMat, glowMat, color: col };
  }
  disposeShip(s) {
    this.ctx.avatar.dispose(s.pilot);
    for (const m of [s.hullMat, s.stripeMat, s.flameMat, s.glowMat]) m.dispose();
    s.root.removeFromParent();
  }
  dispose() { for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); this.glow.dispose(); }
}

// Ribbon light trail behind a ship (two engine points per sample), fading out.
export class Trail {
  constructor(scene, color, n = 44) {
    this.n = n; this.count = 0;
    this.pts = new Float32Array(n * 6);
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3); this.pos.setUsage(THREE.DynamicDrawUsage);
    const a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const f = 1 - i / (n - 1); a[i * 2] = a[i * 2 + 1] = f * f; }
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(a, 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(color) }, boost: { value: 0 } },
      vertexShader: 'attribute float alpha; varying float va; void main(){ va = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float boost; varying float va; void main(){ gl_FragColor = vec4(color * (0.9 + boost * 0.8), va * (0.6 + boost * 0.4)); }',
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.last = null;
  }
  reset() { this.count = 0; this.last = null; }
  push(l, r) {
    // shift samples when the ship has moved far enough
    const p = this.pts;
    if (this.last && Math.hypot(l[0] - this.last[0], l[1] - this.last[1], l[2] - this.last[2]) > 15) this.reset();
    if (this.last && Math.hypot(l[0] - this.last[0], l[1] - this.last[1], l[2] - this.last[2]) < 0.8 && this.count) {
      p.set(l, 0); p.set(r, 3);
    } else {
      p.copyWithin(6, 0, (this.n - 1) * 6); p.set(l, 0); p.set(r, 3);
      this.count = Math.min(this.n, this.count + 1); this.last = [...l];
    }
    const a = this.pos.array;
    for (let i = 0; i < this.n; i++) {
      const j = Math.min(i, this.count - 1) * 6;
      a[i * 6] = p[j]; a[i * 6 + 1] = p[j + 1]; a[i * 6 + 2] = p[j + 2];
      a[i * 6 + 3] = p[j + 3]; a[i * 6 + 4] = p[j + 4]; a[i * 6 + 5] = p[j + 5];
    }
    this.pos.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); this.mesh.removeFromParent(); }
}

// Pooled additive point sparks (drift sparks, wall sparks, landing bursts, boost pops).
export class Sparks {
  constructor(scene, max = 600) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.col = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3); this.pa.setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.col, 3); this.ca.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pa); this.geo.setAttribute('color', this.ca);
    this.tex = glowTex();
    this.mat = new THREE.PointsMaterial({ size: 0.9, map: this.tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(this.geo, this.mat); this.points.frustumCulled = false;
    scene.add(this.points);
    this.c = new THREE.Color();
  }
  emit(p, v, color, life = 0.5, spread = 3) {
    const k = this.i; this.i = (this.i + 1) % this.max;
    this.pos[k * 3] = p[0]; this.pos[k * 3 + 1] = p[1]; this.pos[k * 3 + 2] = p[2];
    this.vel[k * 3] = v[0] + (Math.random() - 0.5) * spread; this.vel[k * 3 + 1] = v[1] + (Math.random() - 0.5) * spread; this.vel[k * 3 + 2] = v[2] + (Math.random() - 0.5) * spread;
    this.life[k] = life * (0.6 + Math.random() * 0.6);
    this.c.set(color); this.col[k * 3] = this.c.r; this.col[k * 3 + 1] = this.c.g; this.col[k * 3 + 2] = this.c.b;
  }
  update(dt) {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -1e5; this.col[k * 3] = this.col[k * 3 + 1] = this.col[k * 3 + 2] = 0; continue; }
      const f = Math.exp(-3 * dt);
      this.vel[k * 3] *= f; this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * f; this.vel[k * 3 + 2] *= f;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      const fade = Math.min(1, this.life[k] * 4);
      this.col[k * 3] *= 0.985 + 0.015 * fade; this.col[k * 3 + 1] *= 0.985 + 0.015 * fade; this.col[k * 3 + 2] *= 0.985 + 0.015 * fade;
    }
    this.pa.needsUpdate = true; this.ca.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); this.tex.dispose(); this.points.removeFromParent(); }
}
