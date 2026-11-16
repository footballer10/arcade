// NEON RUSH — track definitions and the track builder.
// Pure math, no three.js: the same code builds the track for physics, bots, rendering and the node tuning scripts.
//
// A track is a closed "main" path plus optional shortcut paths. Every path is sampled once per unit of length with a
// frame (P position, T tangent, U surface-up incl. bank/corkscrew roll, R right) and per-sample attributes
// (half width, wall-ride pipes, walls, jump gaps). Physics runs in TRACK SPACE: (s along the path, d across the
// surface, y above it), so loops, corkscrews and wall-rides are just different frames — the ship never "falls off" a loop.
//
// Ops (turtle style, + angle = right turn):
//   ['straight', len, o]  ['turn', deg, radius, o]  ['loop', radius, o]  ['corkscrew', len, o]  ['close', o]
// o: { rise (height change over the op), bank (deg), hw (half width), pipe: 'L'|'R'|'LR', open: 'L'|'R'|'LR',
//      pads: [[frac, d, len]], jump: {at, gap}, shift (loop side offset), dir (corkscrew ±1) }
export const DS = 1;                 // sample spacing (units)
export const ENTRY = 46;             // length of a shortcut's side-by-side entry lane
export const PIPE_R = 6;             // wall-ride pipe radius (quarter pipe up to vertical)
export const RAMP = 14;              // jump kicker length before the lip

export const TRACKS = {
  sunset: {
    name: 'Sunset Boulevard', desc: 'Wide and flowing. Learn to chain drifts.',
    hw: 11, sky: 'sunset',
    ops: [
      ['straight', 200, { pads: [[0.55, -4.5, 16], [0.55, 4.5, 16]] }],
      ['turn', 90, 90, { bank: 10 }],
      ['straight', 160, { rise: 20 }],
      ['turn', -60, 45, { bank: -12 }],
      ['turn', 60, 45, { bank: 12 }],
      ['straight', 70, { pads: [[0.4, 0, 16]] }],
      ['turn', 90, 36, { bank: 8, pipe: 'L' }],
      ['straight', 220, { rise: -20, jump: { at: 0.45, gap: 26 } }],
      ['turn', 60, 50, { bank: 12 }],
      ['turn', -60, 50, { bank: -12 }],
      ['straight', 150, { pads: [[0.5, -5, 16]] }],
      ['turn', 180, 80, { bank: 14, open: 'R' }],
      ['turn', -90, 40, { bank: -12, pipe: 'R' }],
      ['straight', 170],
      ['turn', 90, 45, { bank: 12 }],
      ['close', {}],
    ],
    sc: [{ a: [11, 0.02], b: [12, 0.5], side: 1, lift: 7, hump: 14, hw: 5.5 }],
  },
  helix: {
    name: 'Helix Heights', desc: 'A loop, a corkscrew and a big jump. Hold on.',
    hw: 10, sky: 'violet',
    ops: [
      ['straight', 220, { pads: [[0.75, 0, 18]] }],
      ['loop', 34, { shift: 24 }],
      ['straight', 80],
      ['turn', 90, 60, { bank: 8, pipe: 'L' }],
      ['straight', 100, { rise: 30 }],
      ['corkscrew', 160, { dir: 1, pads: [[0.45, 0, 14]] }],
      ['turn', 90, 45, { bank: 16 }],
      ['straight', 360, { rise: -30, jump: { at: 0.45, gap: 30 }, pads: [[0.15, 0, 16]] }],
      ['turn', 90, 55, { bank: 12 }],
      ['straight', 60],
      ['turn', -90, 40, { bank: -14, pipe: 'R' }],
      ['straight', 50],
      ['turn', 90, 40, { bank: 14 }],
      ['straight', 40, { pads: [[0.1, 0, 16]] }],
      ['turn', 90, 40, { bank: 14 }],
      ['straight', 50],
      ['turn', -90, 40, { bank: -14, pipe: 'L' }],
      ['straight', 14],
      ['turn', 90, 60, { bank: 10 }],
      ['close', {}],
    ],
    sc: [{ a: [9, 0.0], b: [16, 0.85], side: -1, lift: 5, hump: 12, hw: 4.5 }],
  },
};
export const TRACK_IDS = Object.keys(TRACKS);

// ---------------------------------------------------------------- small vector helpers (arrays [x,y,z])
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// rotate v about unit axis k by angle a (Rodrigues)
function rot(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
// rotation that takes unit a to unit b, applied to v
function transport(v, a, b) {
  const ax = cross(a, b), sl = len(ax);
  if (sl < 1e-9) return v;
  return rot(v, mul(ax, 1 / sl), Math.atan2(sl, dot(a, b)));
}
const smooth = (t) => t * t * (3 - 2 * t);
const SIDE = (str, side) => !!str && str.includes(side);

// ---------------------------------------------------------------- generation (turtle -> polyline with attributes)
function generate(def) {
  const pts = [];
  let x = 0, y = 0, z = 0, yaw = 0;
  const opRanges = [];
  const STEP = 1;
  const attrs = (o, extra = {}) => ({
    bank: o.bank || 0, hw: o.hw || def.hw,
    pl: SIDE(o.pipe, 'L') ? 1 : 0, pr: SIDE(o.pipe, 'R') ? 1 : 0,
    wl: SIDE(o.open, 'L') ? 0 : 1, wr: SIDE(o.open, 'R') ? 0 : 1, roll: 0, ...extra,
  });
  pts.push({ p: [0, 0, 0], ...attrs({}) });
  let roll = 0;
  for (const op of def.ops) {
    const type = op[0];
    const o = (typeof op[op.length - 1] === 'object' ? op[op.length - 1] : {}) || {};
    const i0 = pts.length - 1;
    const rise = o.rise || 0;
    let baseY = y;
    if (type === 'straight' || type === 'corkscrew' || type === 'turn') {
      const L = type === 'turn' ? Math.abs(op[1]) * Math.PI / 180 * op[2] : op[1];
      const n = Math.max(1, Math.ceil(L / STEP));
      const dyaw = type === 'turn' ? (op[1] * Math.PI / 180) / n : 0;
      const turns = type === 'corkscrew' ? (o.turns || 1) * (o.dir || 1) : 0;
      const roll0 = roll;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const hy = yaw + dyaw * 0.5;
        x += Math.sin(hy) * L / n; z -= Math.cos(hy) * L / n; yaw += dyaw;
        y = baseY + rise * smooth(t);
        if (turns) roll = roll0 + turns * Math.PI * 2 * smooth(t);
        pts.push({ p: [x, y, z], ...attrs(o), roll });
      }
    } else if (type === 'loop') {
      const r = op[1], shift = o.shift ?? def.hw * 2.4;
      const h = [Math.sin(yaw), 0, -Math.cos(yaw)], side = [Math.cos(yaw), 0, Math.sin(yaw)];
      const p0 = [x, y, z];
      const n = Math.ceil(Math.PI * 2 * r / STEP);
      for (let i = 1; i <= n; i++) {
        const th = (i / n) * Math.PI * 2;
        const q = add(add(p0, mul(h, r * Math.sin(th))), add([0, r * (1 - Math.cos(th)), 0], mul(side, shift * smooth(i / n))));
        [x, y, z] = q;
        pts.push({ p: q, ...attrs(o), roll });
      }
    } else if (type === 'close') {
      // Hermite curve back to the start point / start tangent
      const p0 = [x, y, z], p1 = [0, 0, 0];
      const t0 = [Math.sin(yaw), 0, -Math.cos(yaw)], t1 = [0, 0, -1];
      const D = len(sub(p1, p0)), k = D * 1.0;
      const n = Math.max(2, Math.ceil(D * 1.15 / STEP));
      const rollEnd = Math.round(roll / (Math.PI * 2)) * Math.PI * 2, roll0 = roll;
      for (let i = 1; i < n; i++) {
        const t = i / n, t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        const q = add(add(mul(p0, h00), mul(t0, h10 * k)), add(mul(p1, h01), mul(t1, h11 * k)));
        roll = roll0 + (rollEnd - roll0) * smooth(t);
        pts.push({ p: q, ...attrs(o), roll });
      }
    }
    opRanges.push([i0, pts.length - 1]);
  }
  return { pts, opRanges };
}

// ---------------------------------------------------------------- path object
function makePath(n, closed) {
  const f = () => new Float32Array(n * 3);
  return {
    n, closed, L: n * DS, P: f(), T: f(), U: f(), R: f(),
    k: new Float32Array(n), hw: new Float32Array(n), pl: new Float32Array(n), pr: new Float32Array(n),
    wl: new Uint8Array(n), wr: new Uint8Array(n), gap: new Uint8Array(n), bank: new Float32Array(n),
    pads: [], jumps: [], shortcuts: [],
  };
}
const get3 = (A, i) => [A[i * 3], A[i * 3 + 1], A[i * 3 + 2]];
const set3 = (A, i, v) => { A[i * 3] = v[0]; A[i * 3 + 1] = v[1]; A[i * 3 + 2] = v[2]; };

// resample a polyline (with attributes) to uniform spacing; returns {path, cum(original index -> s)}
function resample(pts, closed) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i].p, pts[i - 1].p)));
  let total = cum[cum.length - 1];
  if (closed) total += len(sub(pts[0].p, pts[pts.length - 1].p));
  const n = Math.max(4, Math.round(total / DS));
  const step = total / n;
  const path = makePath(n, closed);
  const rollArr = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step;
    while (j < pts.length - 1 && cum[j + 1] < s) j++;
    const a = pts[j], b = j + 1 < pts.length ? pts[j + 1] : pts[0];
    const segL = (j + 1 < pts.length ? cum[j + 1] : total) - cum[j];
    const t = segL > 1e-6 ? Math.min(1, (s - cum[j]) / segL) : 0;
    set3(path.P, i, add(mul(a.p, 1 - t), mul(b.p, t)));
    path.bank[i] = a.bank * (1 - t) + b.bank * t; path.hw[i] = a.hw; path.pl[i] = a.pl; path.pr[i] = a.pr;
    path.wl[i] = a.wl; path.wr[i] = a.wr;
    rollArr[i] = a.roll * (1 - t) + b.roll * t;
  }
  path.L = total; path.ds = step;
  return { path, cum: cum.map((c) => c * (n / total) * step), roll: rollArr };
}

// circular / clamped moving average
function blur(arr, w, closed) {
  const n = arr.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0, c = 0;
    for (let k = -w; k <= w; k++) {
      let j = i + k;
      if (closed) j = (j + n) % n; else if (j < 0 || j >= n) continue;
      acc += arr[j]; c++;
    }
    out[i] = acc / c;
  }
  return out;
}

function computeFrames(path, roll, upStart = null, upEnd = null) {
  const { n, closed } = path;
  const idx = (i) => closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i));
  for (let i = 0; i < n; i++) set3(path.T, i, norm(sub(get3(path.P, idx(i + 1)), get3(path.P, idx(i - 1)))));
  // parallel-transport the up vector along the curve
  const U = new Array(n);
  let u = upStart || [0, 1, 0];
  const t0 = get3(path.T, 0);
  u = norm(sub(u, mul(t0, dot(u, t0))));
  U[0] = u;
  for (let i = 1; i < n; i++) {
    const a = get3(path.T, i - 1), b = get3(path.T, i);
    let v = transport(U[i - 1], a, b);
    v = norm(sub(v, mul(b, dot(v, b))));
    U[i] = v;
  }
  // close the twist: compare where transported up ends vs where it should be
  const target = closed ? transport(U[0], get3(path.T, 0), get3(path.T, 0)) : upEnd;
  if (target) {
    const iEnd = closed ? n - 1 : n - 1;
    const tEnd = get3(path.T, iEnd);
    let want = closed ? transport(U[0], get3(path.T, 0), tEnd) : target;
    want = norm(sub(want, mul(tEnd, dot(want, tEnd))));
    const have = U[iEnd];
    let twist = Math.atan2(dot(cross(have, want), tEnd), dot(have, want));
    for (let i = 1; i < n; i++) U[i] = rot(U[i], get3(path.T, i), twist * (i / (n - 1)));
  }
  for (let i = 0; i < n; i++) {
    const t = get3(path.T, i);
    const ang = roll[i] + path.bank[i] * Math.PI / 180;
    // positive roll/bank tilts up toward the right (right side lower)
    const r0 = cross(t, U[i]);
    const up = norm(add(mul(U[i], Math.cos(ang)), mul(r0, Math.sin(ang))));
    set3(path.U, i, up);
    set3(path.R, i, norm(cross(t, up)));
  }
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dT = sub(get3(path.T, idx(i + 1)), get3(path.T, idx(i - 1)));
    k[i] = dot(dT, get3(path.R, i)) / (2 * path.ds);
  }
  path.k = blur(k, 3, closed);
}

// ---------------------------------------------------------------- queries
export function wrapS(path, s) { if (!path.closed) return Math.max(0, Math.min(path.L - 1e-3, s)); const L = path.L; return ((s % L) + L) % L; }
// index + fraction at s
function at(path, s) {
  s = wrapS(path, s);
  const f = s / path.ds; let i = Math.floor(f); const t = f - i;
  if (i >= path.n) i = path.n - 1;
  const j = path.closed ? (i + 1) % path.n : Math.min(path.n - 1, i + 1);
  return [i, j, t];
}
export function sample(path, A, s, out = [0, 0, 0]) {
  const [i, j, t] = at(path, s);
  out[0] = A[i * 3] + (A[j * 3] - A[i * 3]) * t;
  out[1] = A[i * 3 + 1] + (A[j * 3 + 1] - A[i * 3 + 1]) * t;
  out[2] = A[i * 3 + 2] + (A[j * 3 + 2] - A[i * 3 + 2]) * t;
  return out;
}
export function scalar(path, A, s) { const [i, j, t] = at(path, s); return A[i] + (A[j] - A[i]) * t; }
export function idxAt(path, s) { return at(path, s)[0]; }

// Lateral extent at s: how far d may go each side before the wall/edge (flat half + pipe arc length).
export function extent(path, s, side) {
  const hw = scalar(path, path.hw, s);
  const p = scalar(path, side < 0 ? path.pl : path.pr, s);
  return hw + p * PIPE_R * Math.PI / 2;
}
// Cross-section: surface offset (lateral, up) and tilt angle for a lateral coordinate d at s.
export function profile(path, s, d) {
  const hw = scalar(path, path.hw, s), ad = Math.abs(d), sg = d < 0 ? -1 : 1;
  if (ad <= hw) return [d, 0, 0];
  const p = scalar(path, sg < 0 ? path.pl : path.pr, s);
  if (p <= 0.001) return [d, 0, 0];
  const e = ad - hw, maxA = p * Math.PI / 2;
  const th = Math.min(maxA, e / PIPE_R), arc = th * PIPE_R, rest = e - arc;
  const lat = hw + PIPE_R * Math.sin(th) + rest * Math.cos(th), up = PIPE_R * (1 - Math.cos(th)) + rest * Math.sin(th);
  return [sg * lat, up, sg * th];
}
// World position of track-space point (s, d, y); also writes the local up/right/forward if given.
const _p = [0, 0, 0], _u = [0, 0, 0], _r = [0, 0, 0], _t = [0, 0, 0];
export function worldPos(path, s, d, y, out = [0, 0, 0], frame = null) {
  sample(path, path.P, s, _p); sample(path, path.U, s, _u); sample(path, path.R, s, _r);
  const [lat, up, tilt] = profile(path, s, d);
  // surface normal tilts toward the track centre on a pipe
  const c = Math.cos(tilt), sn = Math.sin(tilt);
  const nx = _u[0] * c - _r[0] * sn, ny = _u[1] * c - _r[1] * sn, nz = _u[2] * c - _r[2] * sn;
  out[0] = _p[0] + _r[0] * lat + _u[0] * up + nx * y;
  out[1] = _p[1] + _r[1] * lat + _u[1] * up + ny * y;
  out[2] = _p[2] + _r[2] * lat + _u[2] * up + nz * y;
  if (frame) {
    sample(path, path.T, s, _t);
    frame.t[0] = _t[0]; frame.t[1] = _t[1]; frame.t[2] = _t[2];
    frame.u[0] = nx; frame.u[1] = ny; frame.u[2] = nz;
    frame.r[0] = _r[0] * c + _u[0] * sn; frame.r[1] = _r[1] * c + _u[1] * sn; frame.r[2] = _r[2] * c + _u[2] * sn;
  }
  return out;
}
export const gapAt = (path, s) => path.gap[idxAt(path, s)] === 1;

// ---------------------------------------------------------------- build
const cache = new Map();
export function clearTrackCache() { cache.clear(); }
export function buildTrack(id) {
  if (cache.has(id)) return cache.get(id);
  const def = TRACKS[id] || TRACKS[TRACK_IDS[0]];
  const { pts, opRanges } = generate(def);

  const { path: main, cum, roll } = resample(pts, true);
  main.bank = blur(main.bank, 30, true);
  main.hw = blur(main.hw, 20, true);
  main.pl = blur(main.pl, 22, true); main.pr = blur(main.pr, 22, true);
  computeFrames(main, roll);
  const opS = opRanges.map(([a, b]) => [cum[a] ?? 0, cum[Math.min(b, cum.length - 1)] ?? main.L]);
  const sAt = ([op, frac]) => opS[op][0] + (opS[op][1] - opS[op][0]) * frac;
  // features
  def.ops.forEach((op, i) => {
    const o = (typeof op[op.length - 1] === 'object' ? op[op.length - 1] : {}) || {};
    const [s0, s1] = opS[i];
    for (const [fr, d, l = 16] of o.pads || []) { const s = s0 + (s1 - s0) * fr; main.pads.push({ s0: s, s1: s + l, d0: d - 2.6, d1: d + 2.6 }); }
    if (o.jump) {
      const lip = s0 + (s1 - s0) * o.jump.at, end = lip + o.jump.gap;
      main.jumps.push({ lip, end, ramp: lip - RAMP });
      for (let s = Math.ceil(lip); s < end; s++) main.gap[idxAt(main, s)] = 1;
    }
  });
  const track = { id, def, name: def.name, main, paths: [main], opS, startS: 0 };
  // shortcuts
  for (const sc of def.sc || []) {
    const a = sAt(sc.a), b = sAt(sc.b), side = sc.side;
    const path = buildShortcut(main, a, b, side, sc);
    path.id = track.paths.length;
    path.parent = { a, b, side, hwSc: sc.hw, lift: sc.lift || 0 };
    main.shortcuts.push({ path: path.id, a, b, side, hwSc: sc.hw });
    // open the main wall along the entry lane
    for (let s = a - 2; s < a + ENTRY; s++) { const i = idxAt(main, s); if (side > 0) main.wr[i] = 0; else main.wl[i] = 0; }
    track.paths.push(path);
  }
  cache.set(id, track);
  return track;
}

function buildShortcut(main, a, b, side, sc) {
  const pts = [];
  const hwM = scalar(main, main.hw, a), off = side * (hwM + sc.hw);
  const tmp = [0, 0, 0];
  for (let t = 0; t <= ENTRY; t++) {
    worldPos(main, a + t, 0, 0, tmp);
    const r = sample(main, main.R, a + t);
    pts.push({ p: add([...tmp], mul(r, off)), bank: 0, hw: sc.hw, pl: 0, pr: 0, wl: side > 0 ? 1 : 0, wr: side > 0 ? 0 : 1, roll: 0 });
  }
  const pe = pts[pts.length - 1].p, te = norm(sample(main, main.T, a + ENTRY));
  const p1 = add(sample(main, main.P, b), mul(sample(main, main.U, b), sc.lift)), t1 = norm(sample(main, main.T, b));
  const D = len(sub(p1, pe)), k = D * 0.9;
  const n = Math.ceil(D * 1.3);
  for (let i = 1; i <= n; i++) {
    const t = i / n, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const q = add(add(mul(pe, h00), mul(te, h10 * k)), add(mul(p1, h01), mul(t1, h11 * k)));
    q[1] += (sc.hump || 0) * Math.sin(Math.PI * t);
    const walls = sc.walls ? 1 : 0;
    pts.push({ p: q, bank: 0, hw: sc.hw, pl: 0, pr: 0, wl: walls, wr: walls, roll: 0 });
  }
  const { path, roll } = resample(pts, false);
  computeFrames(path, roll, sample(main, main.U, a), sample(main, main.U, b));
  return path;
}

// progress along the main track (for race order) of a track-space position
export function mainS(track, pathId, s) {
  if (!pathId) return s;
  const p = track.paths[pathId], { a, b } = p.parent;
  let span = b - a; if (span < 0) span += track.main.L;
  return wrapS(track.main, a + (s / p.L) * span);
}
