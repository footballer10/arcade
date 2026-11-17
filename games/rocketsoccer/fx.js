// Particles (pooled additive points), shockwave rings and screen-space helpers for Rocket Soccer.
import * as THREE from 'three';

const DOT = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

export class Particles {
  constructor(scene, max = 1200) {
    this.max = max; this.n = 0; this.cursor = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.c = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max); this.size = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3); this.col = new THREE.BufferAttribute(new Float32Array(max * 3), 3); this.sz = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.pos.setUsage(THREE.DynamicDrawUsage); this.col.setUsage(THREE.DynamicDrawUsage); this.sz.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos); this.geo.setAttribute('color', this.col); this.geo.setAttribute('size', this.sz);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: DOT }, scale: { value: 400 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      vertexShader: 'attribute float size; varying vec3 vC; uniform float scale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a < 0.02) discard; gl_FragColor = vec4(vC * t.a, t.a); }',
    });
    this.points = new THREE.Points(this.geo, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    this.tmp = new THREE.Color();
  }
  emit(x, y, z, vx, vy, vz, color, life = 0.8, size = 0.8, drag = 1.5, grav = 0) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    const c = this.tmp.set(color); this.c[i * 3] = c.r; this.c[i * 3 + 1] = c.g; this.c[i * 3 + 2] = c.b;
    this.life[i] = life; this.age[i] = 0; this.size[i] = size; this.drag[i] = drag; this.grav[i] = grav;
  }
  burst(x, y, z, n, color, speed = 10, life = 0.8, size = 0.8, opts = {}) {
    const { up = 0, grav = 0, drag = 1.6, spread = 1 } = opts;
    for (let k = 0; k < n; k++) {
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1; const l = Math.hypot(dx, dy, dz) || 1;
      const s = speed * (0.35 + Math.random() * 0.65) * spread;
      this.emit(x, y, z, (dx / l) * s, (dy / l) * s + up, (dz / l) * s, Array.isArray(color) ? color[k % color.length] : color, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), drag, grav);
    }
  }
  update(dt) {
    const P = this.pos.array, Cc = this.col.array, S = this.sz.array;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { if (S[i]) S[i] = 0; continue; }
      this.age[i] += dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt; this.v[i * 3 + 2] *= k;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const f = 1 - this.age[i] / this.life[i];
      P[i * 3] = this.p[i * 3]; P[i * 3 + 1] = this.p[i * 3 + 1]; P[i * 3 + 2] = this.p[i * 3 + 2];
      Cc[i * 3] = this.c[i * 3] * f; Cc[i * 3 + 1] = this.c[i * 3 + 1] * f; Cc[i * 3 + 2] = this.c[i * 3 + 2] * f;
      S[i] = this.size[i] * (0.4 + 0.6 * f);
    }
    this.pos.needsUpdate = true; this.col.needsUpdate = true; this.sz.needsUpdate = true;
  }
  setScale(h) { this.mat.uniforms.scale.value = h * 0.9; }
  dispose() { this.points.removeFromParent(); this.geo.dispose(); this.mat.dispose(); }
}

// expanding rings (goal shockwave, demolitions, big hits)
const RING_GEO = new THREE.RingGeometry(0.85, 1, 48);
export class Rings {
  constructor(scene) { this.scene = scene; this.list = []; }
  add(x, y, z, color, maxR = 20, life = 0.7, normal = null) {
    const m = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.set(x, y, z);
    if (normal) m.lookAt(x + normal.x, y + normal.y, z + normal.z); else m.rotation.x = -Math.PI / 2;
    m.renderOrder = 6; this.scene.add(m);
    this.list.push({ m, t: 0, life, maxR });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i]; r.t += dt; const f = r.t / r.life;
      if (f >= 1) { r.m.removeFromParent(); r.m.material.dispose(); this.list.splice(i, 1); continue; }
      const e = 1 - Math.pow(1 - f, 3);
      r.m.scale.setScalar(0.5 + e * r.maxR); r.m.material.opacity = 1 - f;
    }
  }
  dispose() { for (const r of this.list) { r.m.removeFromParent(); r.m.material.dispose(); } this.list.length = 0; }
}
