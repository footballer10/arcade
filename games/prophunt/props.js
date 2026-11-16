// Every object in Prop Hunt is built from colored primitives (no asset files): a Batch collects boxes,
// cylinders, spheres and cones with a per-vertex color, then merges them into ONE geometry (+ one ink outline
// geometry made of slightly larger back-faced copies). A whole level is 2 draw calls; each prop is 2.
//
// KINDS = the objects hiders can become (and the decoys scattered through the level). Origin = bottom center,
// front faces +z. `size` = [width, height, depth] used for collisions and bonk hit boxes. `cats` = where the
// object looks natural (matched against level slots: that is what makes a disguise plausible).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();

export class Batch {
  constructor(outline = 0.022) { this.parts = []; this.lines = []; this.t = outline; this.base = new THREE.Matrix4(); }
  // all following parts are placed relative to (x, y, z, rotation ry)
  at(x, y, z, ry = 0) { this.base.makeRotationY(ry).setPosition(x, y, z); return this; }
  _add(geo, outGeo, x, y, z, color, o) {
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _q.setFromEuler(_e); _s.set(o.sx || 1, o.sy || 1, o.sz || 1); _p.set(x, y, z);
    _m.compose(_p, _q, _s).premultiply(this.base);
    geo.deleteAttribute('uv'); geo.applyMatrix4(_m);
    const n = geo.attributes.position.count, col = new Float32Array(n * 3);
    _c.setHex(color); if (o.shade) _c.multiplyScalar(o.shade);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(geo.index ? geo.toNonIndexed() : geo);
    if (geo.index) geo.dispose();
    if (outGeo && this.t > 0 && o.out !== false) {
      outGeo.deleteAttribute('uv'); outGeo.deleteAttribute('normal'); outGeo.applyMatrix4(_m);
      this.lines.push(outGeo.index ? outGeo.toNonIndexed() : outGeo); if (outGeo.index) outGeo.dispose();
    } else if (outGeo) outGeo.dispose();
    return this;
  }
  box(x, y, z, w, h, d, color, o = {}) { const t = o.t ?? this.t; return this._add(new THREE.BoxGeometry(w, h, d), new THREE.BoxGeometry(w + t * 2, h + t * 2, d + t * 2), x, y, z, color, o); }
  cyl(x, y, z, rt, rb, h, color, o = {}) { const t = o.t ?? this.t, s = o.seg || 14; return this._add(new THREE.CylinderGeometry(rt, rb, h, s, 1, !!o.open), o.open ? null : new THREE.CylinderGeometry(rt + t, rb + t, h + t * 2, s), x, y, z, color, o); }
  sph(x, y, z, r, color, o = {}) { const t = o.t ?? this.t; return this._add(new THREE.SphereGeometry(r, o.seg || 14, o.segv || 10), new THREE.SphereGeometry(r + t / Math.max(o.sx || 1, o.sy || 1, o.sz || 1), o.seg || 14, o.segv || 10), x, y, z, color, o); }
  cone(x, y, z, r, h, color, o = {}) { const t = o.t ?? this.t; return this._add(new THREE.ConeGeometry(r, h, o.seg || 14), new THREE.ConeGeometry(r + t, h + t * 2, o.seg || 14), x, y, z, color, o); }
  tor(x, y, z, r, tube, color, o = {}) { const t = o.t ?? this.t; return this._add(new THREE.TorusGeometry(r, tube, 8, o.seg || 18, o.arc || Math.PI * 2), new THREE.TorusGeometry(r, tube + t, 8, o.seg || 18, o.arc || Math.PI * 2), x, y, z, color, o); }
  // merge into { geo, line } (either may be null) and free the parts
  build() {
    const geo = this.parts.length ? mergeGeometries(this.parts) : null;
    const line = this.lines.length ? mergeGeometries(this.lines) : null;
    for (const g of this.parts) g.dispose(); for (const g of this.lines) g.dispose();
    this.parts = []; this.lines = [];
    if (geo) geo.computeBoundingSphere(); if (line) line.computeBoundingSphere();
    return { geo, line };
  }
}

// ---------------------------------------------------------------------------------------------------- kinds
const W = 0xffffff, INK = 0x2a2140, CHROME = 0xd9dee8, DARK = 0x3a3550;
export const KINDS = [
  { id: 'toaster', name: 'Toaster', icon: '🍞', size: [0.36, 0.24, 0.22], cats: ['counter'], build(b) {
    b.box(0, 0.11, 0, 0.34, 0.2, 0.2, 0xff8a9a); b.box(0, 0.215, 0, 0.3, 0.03, 0.16, CHROME);
    for (const x of [-0.07, 0.07]) b.box(x, 0.25, 0, 0.035, 0.06, 0.13, 0xf2b25c, { out: false });
    b.box(0.185, 0.12, 0, 0.03, 0.03, 0.06, INK); b.box(0, 0.06, 0.105, 0.2, 0.02, 0.01, CHROME, { out: false }); } },
  { id: 'kettle', name: 'Kettle', icon: '🫖', size: [0.3, 0.3, 0.22], cats: ['counter'], build(b) {
    b.cyl(0, 0.11, 0, 0.1, 0.12, 0.22, 0x5ec8ff); b.sph(0, 0.22, 0, 0.1, 0x5ec8ff, { sy: 0.5 }); b.sph(0, 0.27, 0, 0.025, INK);
    b.cyl(0.13, 0.16, 0, 0.02, 0.03, 0.12, 0x5ec8ff, { rz: -0.9 }); b.tor(-0.1, 0.15, 0, 0.06, 0.015, INK, { rz: Math.PI / 2, arc: Math.PI }); } },
  { id: 'mug', name: 'Mug', icon: '☕', size: [0.16, 0.14, 0.12], cats: ['counter', 'table'], build(b) {
    b.cyl(0, 0.065, 0, 0.055, 0.055, 0.13, 0xffd84a); b.cyl(0, 0.128, 0, 0.045, 0.045, 0.01, 0x6b3b1f, { out: false }); b.tor(0.065, 0.065, 0, 0.032, 0.012, 0xffd84a, { rz: Math.PI / 2, arc: Math.PI, rx: 0 }); } },
  { id: 'microwave', name: 'Microwave', icon: '📦', size: [0.52, 0.3, 0.36], cats: ['counter'], build(b) {
    b.box(0, 0.15, 0, 0.52, 0.3, 0.36, 0xf4f1ea); b.box(-0.05, 0.15, 0.181, 0.32, 0.2, 0.01, 0x2a3a4a, { out: false }); b.box(0.19, 0.15, 0.181, 0.08, 0.22, 0.01, 0xbfc6d0, { out: false });
    b.box(0.19, 0.22, 0.188, 0.04, 0.02, 0.01, 0x7cff8c, { out: false }); } },
  { id: 'fruitbowl', name: 'Fruit bowl', icon: '🍎', size: [0.32, 0.18, 0.32], cats: ['counter', 'table'], build(b) {
    b.cyl(0, 0.04, 0, 0.16, 0.09, 0.08, 0x7ed0b0); for (const [x, z, c] of [[-0.05, 0, 0xff4b4b], [0.06, 0.03, 0xffd23f], [0, -0.06, 0x7ed957], [0.02, 0.07, 0xff9a2e]]) b.sph(x, 0.11, z, 0.055, c); } },
  { id: 'plant', name: 'Potted plant', icon: '🪴', size: [0.46, 0.85, 0.46], cats: ['floor'], build(b) {
    b.cyl(0, 0.16, 0, 0.18, 0.14, 0.32, 0xd9733a); b.cyl(0, 0.33, 0, 0.19, 0.19, 0.04, 0xb85c2c);
    for (const [x, y, z, r] of [[0, 0.58, 0, 0.2], [0.11, 0.5, 0.06, 0.13], [-0.1, 0.52, -0.05, 0.14], [0.02, 0.73, -0.02, 0.12]]) b.sph(x, y, z, r, 0x46b85a); } },
  { id: 'floorlamp', name: 'Floor lamp', icon: '💡', size: [0.4, 1.5, 0.4], cats: ['floor', 'lamp'], build(b) {
    b.cyl(0, 0.02, 0, 0.17, 0.18, 0.04, DARK); b.cyl(0, 0.7, 0, 0.022, 0.022, 1.36, DARK); b.cyl(0, 1.32, 0, 0.13, 0.2, 0.3, 0xffe9a8, { shade: 1.15 }); } },
  { id: 'tablelamp', name: 'Table lamp', icon: '💡', size: [0.26, 0.46, 0.26], cats: ['table', 'night'], build(b) {
    b.cyl(0, 0.03, 0, 0.09, 0.1, 0.06, 0x9a6bff); b.sph(0, 0.13, 0, 0.08, 0x9a6bff); b.cyl(0, 0.24, 0, 0.012, 0.012, 0.12, DARK); b.cyl(0, 0.36, 0, 0.08, 0.13, 0.17, 0xfff0b8, { shade: 1.15 }); } },
  { id: 'books', name: 'Book stack', icon: '📚', size: [0.3, 0.22, 0.22], cats: ['shelf', 'table', 'desk'], build(b) {
    const C = [0xff5a5f, 0x3ea6ff, 0x4cd964, 0xffcc00]; for (let i = 0; i < 4; i++) b.box((i % 2 ? 0.02 : -0.015), 0.027 + i * 0.054, 0, 0.27 - i * 0.02, 0.05, 0.2, C[i], { ry: (i - 1.5) * 0.08 }); } },
  { id: 'box', name: 'Cardboard box', icon: '📦', size: [0.58, 0.48, 0.58], cats: ['floor', 'storage'], build(b) {
    b.box(0, 0.24, 0, 0.56, 0.46, 0.56, 0xc8945a); b.box(0, 0.47, 0, 0.12, 0.01, 0.57, 0xe8d29a, { out: false }); b.box(0.18, 0.3, 0.282, 0.14, 0.1, 0.01, W, { out: false }); } },
  { id: 'trash', name: 'Trash can', icon: '🗑️', size: [0.4, 0.62, 0.4], cats: ['floor'], build(b) {
    b.cyl(0, 0.28, 0, 0.19, 0.16, 0.56, 0x8f9bb3); b.cyl(0, 0.585, 0, 0.2, 0.2, 0.05, 0x707b94); b.box(0, 0.62, 0, 0.12, 0.03, 0.04, DARK); } },
  { id: 'chair', name: 'Chair', icon: '🪑', size: [0.48, 0.92, 0.48], cats: ['chair'], build(b) {
    for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) b.box(x, 0.22, z, 0.05, 0.44, 0.05, 0xa8683a);
    b.box(0, 0.46, 0, 0.48, 0.05, 0.48, 0xc97f45); b.box(0, 0.7, -0.215, 0.46, 0.38, 0.05, 0xc97f45); b.box(0, 0.48, 0.02, 0.38, 0.03, 0.38, 0xff7aa0, { out: false }); } },
  { id: 'teddy', name: 'Teddy bear', icon: '🧸', size: [0.34, 0.44, 0.28], cats: ['bed', 'toy', 'sofa'], build(b) {
    const C = 0xc98b52; b.sph(0, 0.13, 0, 0.13, C, { sy: 1.05 }); b.sph(0, 0.32, 0, 0.1, C); for (const s of [-1, 1]) { b.sph(s * 0.075, 0.41, 0, 0.04, C); b.sph(s * 0.12, 0.17, 0.05, 0.05, C); b.sph(s * 0.07, 0.04, 0.08, 0.05, C); }
    b.sph(0, 0.3, 0.085, 0.04, 0xf2d0a4, { out: false }); for (const s of [-1, 1]) b.sph(s * 0.035, 0.345, 0.088, 0.013, INK, { out: false }); b.box(0, 0.24, 0.05, 0.16, 0.03, 0.08, 0xff5a5f, { out: false }); } },
  { id: 'clock', name: 'Clock', icon: '⏰', size: [0.24, 0.28, 0.12], cats: ['shelf', 'table', 'night'], build(b) {
    b.cyl(0, 0.13, 0, 0.11, 0.11, 0.08, 0xff6b4a, { rx: Math.PI / 2, seg: 20 }); b.cyl(0, 0.13, 0.042, 0.09, 0.09, 0.01, W, { rx: Math.PI / 2, out: false, seg: 20 });
    b.box(0, 0.16, 0.05, 0.012, 0.06, 0.006, INK, { out: false }); b.box(0.02, 0.13, 0.05, 0.05, 0.012, 0.006, INK, { out: false });
    for (const s of [-1, 1]) { b.sph(s * 0.07, 0.25, 0, 0.035, 0xffd23f); b.box(s * 0.06, 0.02, 0, 0.025, 0.04, 0.025, INK); } } },
  { id: 'vase', name: 'Flower vase', icon: '🌷', size: [0.22, 0.48, 0.22], cats: ['table', 'shelf'], build(b) {
    b.cyl(0, 0.1, 0, 0.06, 0.08, 0.2, 0x4f7cff); b.sph(0, 0.1, 0, 0.085, 0x4f7cff, { sy: 0.9 }); for (const [x, z, c] of [[0, 0, 0xff6ec7], [0.05, 0.03, 0xffd23f], [-0.05, -0.02, 0xff5a5f]]) { b.cyl(x * 0.6, 0.29, z * 0.6, 0.006, 0.006, 0.2, 0x3a9a4a, { out: false }); b.sph(x, 0.4, z, 0.045, c); } } },
  { id: 'duck', name: 'Rubber duck', icon: '🦆', size: [0.2, 0.2, 0.22], cats: ['bath', 'toy'], build(b) {
    b.sph(0, 0.06, 0, 0.09, 0xffd23f, { sz: 1.25, sy: 0.75 }); b.sph(0, 0.14, 0.05, 0.06, 0xffd23f); b.cone(0, 0.135, 0.12, 0.025, 0.05, 0xff8c42, { rx: Math.PI / 2 }); for (const s of [-1, 1]) b.sph(s * 0.03, 0.16, 0.09, 0.011, INK, { out: false }); } },
  { id: 'laundry', name: 'Laundry basket', icon: '🧺', size: [0.52, 0.44, 0.4], cats: ['floor', 'bath'], build(b) {
    b.box(0, 0.18, 0, 0.5, 0.36, 0.38, 0xe9d6a6); for (const [x, c] of [[-0.1, 0x3ea6ff], [0.08, 0xff6ec7], [0, 0x4cd964]]) b.sph(x, 0.36, x * 0.4, 0.11, c, { sy: 0.6 }); } },
  { id: 'pillow', name: 'Pillow', icon: '🛏️', size: [0.5, 0.16, 0.34], cats: ['bed', 'sofa'], build(b) {
    b.sph(0, 0.08, 0, 0.25, 0xfff4e0, { sy: 0.32, sz: 0.68 }); b.sph(0, 0.085, 0, 0.18, 0xffb6cf, { sy: 0.3, sz: 0.6, out: false }); } },
  { id: 'globe', name: 'Globe', icon: '🌍', size: [0.32, 0.5, 0.32], cats: ['desk', 'shelf'], build(b) {
    b.cyl(0, 0.02, 0, 0.1, 0.12, 0.04, DARK); b.cyl(0, 0.12, 0, 0.015, 0.015, 0.18, DARK); b.sph(0, 0.32, 0, 0.15, 0x3ea6ff, { seg: 16 }); b.sph(0.05, 0.36, 0.08, 0.08, 0x4cd964, { sy: 0.7, out: false }); b.sph(-0.08, 0.27, -0.06, 0.07, 0x4cd964, { sy: 0.8, out: false }); b.tor(0, 0.32, 0, 0.17, 0.01, 0xffcc33, { ry: 0.4, out: false }); } },
  { id: 'backpack', name: 'Backpack', icon: '🎒', size: [0.36, 0.46, 0.24], cats: ['floor', 'school'], build(b) {
    b.box(0, 0.21, 0, 0.34, 0.42, 0.2, 0x3ea6ff); b.sph(0, 0.42, 0, 0.17, 0x3ea6ff, { sy: 0.4, sz: 0.58 }); b.box(0, 0.15, 0.115, 0.24, 0.18, 0.05, 0xffcc00); b.box(0, 0.47, 0, 0.1, 0.03, 0.03, DARK); } },
  { id: 'ball', name: 'Basketball', icon: '🏀', size: [0.26, 0.26, 0.26], cats: ['gym'], build(b) {
    b.sph(0, 0.13, 0, 0.13, 0xff8c42, { seg: 16 }); b.tor(0, 0.13, 0, 0.131, 0.006, INK, { rx: Math.PI / 2, out: false }); b.tor(0, 0.13, 0, 0.131, 0.006, INK, { out: false }); } },
  { id: 'cone', name: 'Traffic cone', icon: '🚧', size: [0.36, 0.56, 0.36], cats: ['gym', 'floor2'], build(b) {
    b.box(0, 0.02, 0, 0.36, 0.04, 0.36, 0xff6a1a); b.cone(0, 0.3, 0, 0.14, 0.52, 0xff7a2a); b.cyl(0, 0.28, 0, 0.085, 0.1, 0.07, W, { out: false, t: 0 }); } },
  { id: 'microscope', name: 'Microscope', icon: '🔬', size: [0.24, 0.4, 0.26], cats: ['lab'], build(b) {
    b.box(0, 0.02, 0, 0.2, 0.04, 0.24, DARK); b.box(0, 0.14, -0.07, 0.05, 0.22, 0.05, 0xeef2f8); b.box(0, 0.12, 0.02, 0.14, 0.02, 0.12, DARK); b.cyl(0, 0.27, 0.0, 0.035, 0.03, 0.2, 0xeef2f8, { rx: 0.5 }); b.cyl(0, 0.36, -0.05, 0.02, 0.02, 0.06, DARK, { rx: 0.5 }); } },
  { id: 'melon', name: 'Watermelon', icon: '🍉', size: [0.42, 0.3, 0.32], cats: ['produce'], build(b) {
    b.sph(0, 0.15, 0, 0.16, 0x2f9a45, { sx: 1.3, sy: 0.95 }); for (const x of [-0.1, 0, 0.1]) b.sph(x, 0.15, 0, 0.162, 0x1f6b30, { sx: 0.2, sy: 0.95, out: false }); } },
  { id: 'pumpkin', name: 'Pumpkin', icon: '🎃', size: [0.4, 0.36, 0.4], cats: ['produce', 'floor2'], build(b) {
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.sph(Math.sin(a) * 0.07, 0.15, Math.cos(a) * 0.07, 0.13, 0xff8c2a, { sy: 0.85, out: i % 2 === 0 }); } b.cyl(0, 0.3, 0, 0.02, 0.03, 0.08, 0x3a9a4a); } },
  { id: 'can', name: 'Soup can', icon: '🥫', size: [0.16, 0.18, 0.16], cats: ['store'], build(b) {
    b.cyl(0, 0.09, 0, 0.07, 0.07, 0.18, CHROME); b.cyl(0, 0.09, 0, 0.072, 0.072, 0.11, 0xff4b4b, { out: false }); b.cyl(0, 0.09, 0, 0.073, 0.073, 0.03, W, { out: false }); } },
  { id: 'cereal', name: 'Cereal box', icon: '🥣', size: [0.3, 0.42, 0.12], cats: ['store'], build(b) {
    b.box(0, 0.21, 0, 0.28, 0.42, 0.1, 0xffcc00); b.box(0, 0.3, 0.051, 0.22, 0.1, 0.005, 0xff4b4b, { out: false }); b.sph(0.02, 0.15, 0.05, 0.07, W, { sz: 0.15, out: false }); b.sph(0.02, 0.16, 0.06, 0.03, 0xff8c42, { sz: 0.3, out: false }); } },
  { id: 'bottle', name: 'Soda bottle', icon: '🍾', size: [0.13, 0.42, 0.13], cats: ['store'], build(b) {
    b.cyl(0, 0.13, 0, 0.055, 0.055, 0.26, 0x3fd06a); b.cyl(0, 0.3, 0, 0.02, 0.055, 0.1, 0x3fd06a); b.cyl(0, 0.38, 0, 0.02, 0.02, 0.06, 0x3fd06a); b.cyl(0, 0.41, 0, 0.024, 0.024, 0.02, 0xff4b4b); b.cyl(0, 0.14, 0, 0.057, 0.057, 0.09, W, { out: false }); } },
  { id: 'bread', name: 'Bread loaf', icon: '🥖', size: [0.36, 0.16, 0.18], cats: ['bakery'], build(b) {
    b.sph(0, 0.07, 0, 0.17, 0xe0a050, { sy: 0.45, sz: 0.55 }); for (const x of [-0.08, 0, 0.08]) b.box(x, 0.13, 0, 0.02, 0.01, 0.1, 0xf3d29a, { ry: 0.5, out: false }); } },
  { id: 'basket', name: 'Shopping basket', icon: '🛒', size: [0.5, 0.3, 0.34], cats: ['floor3'], build(b) {
    b.box(0, 0.12, 0, 0.48, 0.24, 0.32, 0xff4b5e); b.box(0, 0.23, 0, 0.44, 0.02, 0.28, 0xb8243a, { out: false }); b.tor(0, 0.24, 0, 0.17, 0.015, DARK, { arc: Math.PI }); } },
  { id: 'wetfloor', name: 'Wet floor sign', icon: '⚠️', size: [0.36, 0.64, 0.34], cats: ['floor2', 'floor3'], build(b) {
    b.box(0, 0.32, 0.07, 0.34, 0.64, 0.03, 0xffd23f, { rx: -0.22 }); b.box(0, 0.32, -0.07, 0.34, 0.64, 0.03, 0xffd23f, { rx: 0.22 }); b.box(0, 0.32, 0.142, 0.14, 0.14, 0.005, INK, { rx: -0.22, out: false }); } },
];
export const KIND_INDEX = Object.fromEntries(KINDS.map((k, i) => [k.id, i]));

// One merged { geo, line } per kind, built on demand. Owned by the caller (call disposeKindCache at the end).
export function kindGeometry(cache, k) {
  if (!cache.has(k)) { const b = new Batch(0.016); KINDS[k].build(b); cache.set(k, b.build()); }
  return cache.get(k);
}
export function disposeKindCache(cache) { for (const { geo, line } of cache.values()) { geo?.dispose(); line?.dispose(); } cache.clear(); }
