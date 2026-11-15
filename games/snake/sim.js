// SNAKE ROYALE — shared rules. The HOST runs `HostSim`; clients use the same movement (`stepHead`) to predict
// their own snake, and the same `Trail` to rebuild every body from the head path they see.
// World: a flat disc in (x, y); angle a points along (cos a, sin a). Three.js maps y -> z.

export const C = {
  START_MASS: 24,
  SPEED: 9, BOOST_SPEED: 17.5, ACCEL: 7,
  TURN: 4.6,                 // rad/s for a fresh snake; big snakes turn slower
  BOOST_DRAIN: 7.5,          // mass per second while boosting
  BOOST_MIN: 14,             // can't boost below this
  BOOST_DROP: 0.16,          // seconds between orbs shed while boosting
  ORB_EAT: 1.15,             // head radius + this = eat distance
  ORB_PULL: 2.4,             // orbs within this (plus head radius) drift into your mouth
  DEATH_KEEP: 0.8,           // fraction of mass dropped as orbs on death
  TRAIL_STEP: 0.3,
  SNAP_HZ: 20,
  INTERP: 0.11,              // clients render others this far in the past (seconds)
};

export const radiusOf = (m) => 0.45 + 0.042 * Math.sqrt(Math.max(1, m));
export const lengthOf = (m) => 2 + 3.0 * Math.sqrt(Math.max(1, m));
export const spacingOf = (r) => Math.max(0.3, r * 0.5);
export const turnOf = (m) => C.TURN / (1 + 0.75 * (radiusOf(m) - radiusOf(C.START_MASS)));
export const orbSize = (v) => 0.16 + 0.085 * Math.sqrt(v);
export const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// Ring: holds, shrinks linearly, then holds at the final size for a frantic finish.
export function ringAt(t, cfg) {
  const { r0, r1, len } = cfg;
  const a = len * 0.12, b = len * 0.82;
  if (t <= a) return r0;
  if (t >= b) return r1;
  const f = (t - a) / (b - a);
  return r0 + (r1 - r0) * (f * (2 - f) * 0.35 + f * 0.65);   // a little faster early on
}
export const arenaCfg = (len, n) => ({ len, r0: 34 + 4.5 * Math.max(2, n), r1: 10 + 1.2 * n });

// ------------------------------------------------------------------ the body: a path behind the head
export class Trail {
  constructor() { this.x = []; this.y = []; }
  reset(x, y, a, len) {   // a straight body behind (x, y) facing a
    this.x.length = 0; this.y.length = 0;
    const n = Math.ceil(len / C.TRAIL_STEP) + 2;
    for (let i = n; i >= 0; i--) { this.x.push(x - Math.cos(a) * i * C.TRAIL_STEP); this.y.push(y - Math.sin(a) * i * C.TRAIL_STEP); }
  }
  setPoints(pts) { this.x.length = 0; this.y.length = 0; for (let i = 0; i < pts.length; i += 2) { this.x.push(pts[i]); this.y.push(pts[i + 1]); } }
  get hx() { return this.x[this.x.length - 1]; }
  get hy() { return this.y[this.y.length - 1]; }
  push(x, y) {
    const X = this.x, Y = this.y, n = X.length;
    if (n >= 2 && Math.hypot(x - X[n - 2], y - Y[n - 2]) < C.TRAIL_STEP) { X[n - 1] = x; Y[n - 1] = y; }
    else { X.push(x); Y.push(y); }
  }
  // drop points beyond `len` from the head (amortised: only splice in chunks)
  trim(len) {
    const X = this.x, Y = this.y;
    let acc = 0, i = X.length - 1;
    for (; i > 0; i--) { acc += Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]); if (acc > len + 1) break; }
    if (i > 48) { X.splice(0, i - 1); Y.splice(0, i - 1); }
  }
  // points every `sp` along the path from the head back to `len`. out = Float32Array [x0,y0,x1,y1,…]; returns count
  sample(len, sp, out, max) {
    const X = this.x, Y = this.y;
    let i = X.length - 1, n = 0;
    if (i < 0) return 0;
    out[0] = X[i]; out[1] = Y[i]; n = 1;
    let want = sp, acc = 0;
    while (i > 0 && n < max && want <= len) {
      const sx = X[i - 1] - X[i], sy = Y[i - 1] - Y[i], d = Math.hypot(sx, sy);
      if (acc + d >= want) {
        const f = d > 1e-6 ? (want - acc) / d : 0;
        out[n * 2] = X[i] + sx * f; out[n * 2 + 1] = Y[i] + sy * f; n++; want += sp;
      } else { acc += d; i--; }
    }
    return n;
  }
  // compact copy for full syncs (every ~0.6 units, 2 decimals)
  export(len) {
    const tmp = new Float32Array(2 * 600), n = this.sample(len + 0.5, 0.6, tmp, 600), out = [];
    for (let k = n - 1; k >= 0; k--) out.push(Math.round(tmp[k * 2] * 100) / 100, Math.round(tmp[k * 2 + 1] * 100) / 100);
    return out;
  }
}

// Movement shared by host and client prediction. s: {x, y, a, v, mass}
export function stepHead(s, ang, boost, dt) {
  const d = wrapA(ang - s.a), mt = turnOf(s.mass) * dt * (boost ? 0.85 : 1);
  s.a = wrapA(s.a + Math.max(-mt, Math.min(mt, d)));
  const target = boost ? C.BOOST_SPEED : C.SPEED;
  s.v += (target - s.v) * Math.min(1, dt * C.ACCEL);
  s.x += Math.cos(s.a) * s.v * dt; s.y += Math.sin(s.a) * s.v * dt;
}

// Spawn layout shared by everyone: evenly around a circle, all heading the same way round (no head-ons at GO).
export function spawnOf(i, n, r0) {
  const ang = (i / Math.max(1, n)) * Math.PI * 2 + 0.3;
  const rr = r0 * 0.58;
  return { x: Math.cos(ang) * rr, y: Math.sin(ang) * rr, a: ang + Math.PI / 2 };
}

// Seeded starting orbs (identical on all clients, ids 1..N). Host-spawned orbs get higher ids.
export function initialOrbs(rng, r0, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * (r0 - 1.5);
    out.push({ id: i + 1, x: Math.cos(a) * d, y: Math.sin(a) * d, v: rng() < 0.12 ? 3 : rng() < 0.4 ? 2 : 1, c: Math.floor(rng() * 8) });
  }
  return out;
}

// ------------------------------------------------------------------ spatial hash of body points (host)
const CELL = 3;
const key = (cx, cy) => (cx + 2048) * 4096 + (cy + 2048);
export class Grid {
  constructor() { this.m = new Map(); this.pool = []; }
  clear() { for (const a of this.m.values()) { a.length = 0; this.pool.push(a); } this.m.clear(); }
  add(x, y, r, owner, k) {
    const kk = key(Math.floor(x / CELL), Math.floor(y / CELL));
    let a = this.m.get(kk); if (!a) { a = this.pool.pop() || []; this.m.set(kk, a); }
    a.push(x, y, r, owner, k);
  }
  // calls fn(x, y, r, owner, k) for every point in cells overlapping the circle (x, y, rad)
  query(x, y, rad, fn) {
    const x0 = Math.floor((x - rad) / CELL), x1 = Math.floor((x + rad) / CELL), y0 = Math.floor((y - rad) / CELL), y1 = Math.floor((y + rad) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const a = this.m.get(key(cx, cy)); if (!a) continue;
      for (let i = 0; i < a.length; i += 5) if (fn(a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4]) === true) return true;
    }
    return false;
  }
}

export const orbGoal = (R, mul = 1) => Math.round(Math.min(420, 0.05 * Math.PI * R * R) * mul);

// placements best -> worst: survivors by size, then the fallen by how long they lasted. list: [{id, alive, mass, deathT}]
export function standingsOf(list) {
  const all = [...list];
  const alive = all.filter((s) => s.alive).sort((a, b) => b.mass - a.mass);
  const groups = [];
  for (const s of alive) { const g = groups[groups.length - 1]; if (g && g.alive && Math.floor(g.m) === Math.floor(s.mass)) g.ids.push(s.id); else groups.push({ alive: true, m: s.mass, ids: [s.id] }); }
  const dead = all.filter((s) => !s.alive).sort((a, b) => b.deathT - a.deathT);
  for (const s of dead) { const g = groups[groups.length - 1]; if (g && !g.alive && Math.abs(g.t - s.deathT) < 0.02) g.ids.push(s.id); else groups.push({ alive: false, t: s.deathT, ids: [s.id] }); }
  return groups.map((g) => (g.ids.length === 1 ? g.ids[0] : g.ids));
}

// ------------------------------------------------------------------ binary packets
const A16 = (a) => Math.round(((wrapA(a) + Math.PI) / (Math.PI * 2)) * 65535) & 65535;
const UA16 = (u) => (u / 65535) * Math.PI * 2 - Math.PI;
// snapshot: [1][f32 t][u8 n] + n * [u8 idx][u8 flags][i16 x][i16 y][u16 a][u16 mass*10][u16 ack][u8 kills][u16 aim]
export function encodeSnap(t, list) {
  const buf = new ArrayBuffer(6 + list.length * 16), dv = new DataView(buf);
  dv.setUint8(0, 1); dv.setFloat32(1, t); dv.setUint8(5, list.length);
  let o = 6;
  for (const s of list) {
    dv.setUint8(o, s.idx); dv.setUint8(o + 1, (s.alive ? 1 : 0) | (s.boost ? 2 : 0));
    dv.setInt16(o + 2, Math.round(Math.max(-650, Math.min(650, s.x)) * 50)); dv.setInt16(o + 4, Math.round(Math.max(-650, Math.min(650, s.y)) * 50));
    dv.setUint16(o + 6, A16(s.a)); dv.setUint16(o + 8, Math.min(65535, Math.round(s.mass * 10))); dv.setUint16(o + 10, s.ack & 65535);
    dv.setUint8(o + 12, Math.min(255, s.kills)); dv.setUint16(o + 13, A16(s.ang ?? s.a));
    o += 16;
  }
  return buf;
}
export function decodeSnap(buf) {
  const dv = new DataView(buf);
  if (dv.byteLength < 6 || dv.getUint8(0) !== 1) return null;
  const t = dv.getFloat32(1), n = dv.getUint8(5), list = [];
  let o = 6;
  for (let i = 0; i < n && o + 16 <= dv.byteLength; i++, o += 16) {
    const f = dv.getUint8(o + 1);
    list.push({ idx: dv.getUint8(o), alive: !!(f & 1), boost: !!(f & 2), x: dv.getInt16(o + 2) / 50, y: dv.getInt16(o + 4) / 50, a: UA16(dv.getUint16(o + 6)), mass: dv.getUint16(o + 8) / 10, ack: dv.getUint16(o + 10), kills: dv.getUint8(o + 12), aim: UA16(dv.getUint16(o + 13)) });
  }
  return { t, list };
}
// input: [2][u16 seq][u16 ang][u8 boost]
export function encodeInput(seq, ang, boost) {
  const buf = new ArrayBuffer(6), dv = new DataView(buf);
  dv.setUint8(0, 2); dv.setUint16(1, seq & 65535); dv.setUint16(3, A16(ang)); dv.setUint8(5, boost ? 1 : 0);
  return buf;
}
export function decodeInput(buf) {
  const dv = new DataView(buf);
  if (dv.byteLength < 6 || dv.getUint8(0) !== 2) return null;
  return { seq: dv.getUint16(1), ang: UA16(dv.getUint16(3)), boost: !!dv.getUint8(5) };
}
