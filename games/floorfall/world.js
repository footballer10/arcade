// FLOOR IS FALLING — shared rules. The host and every client run this same code, so the level built from the
// seed and the movement physics match everywhere. Nothing in here touches three.js or the network.
//
// The world is a stack of hexagon-tile layers (index 0 = bottom). Every tile has a drop time `at`:
//   at = Infinity      solid
//   t < at             cracking (someone touched it; it still holds you)
//   at <= t            gone (a hole you fall through)
// `t` is the round clock (seconds since the round started), shared through host snapshots.
export const C = {
  HEX: 1,                // tile size (center to corner)
  LAYER_H: 5,            // vertical distance between layers
  KILL_Y: -9,            // below the bottom layer: out
  R: 0.42,               // player radius
  SPEED: 5.6, ACC: 62, AIR_ACC: 20,
  JUMP: 8.4, G: 25, MAX_FALL: 30,
  DASH_V: 13.5, DASH_T: 0.16, DASH_CD: 1.6, DASH_LIFT: 3,
  BUMP: 8.5, BUMP_UP: 4, STUN: 0.4,
  COYOTE: 0.11,
  DELAYS: { casual: 0.8, normal: 0.52, fast: 0.32 },
  COLLAPSE_AT: 75,       // round clock when the collapse (sudden death) starts
};
export const SQ3 = Math.sqrt(3);
// Layer colors, bottom → top (the top layers use the last entries).
export const LAYER_COLORS = [0x37d6ff, 0x7dff6a, 0xffd23a, 0xff8a3d, 0xff4fa8];
export const LAYER_NAMES = ['Cyan', 'Lime', 'Gold', 'Tangerine', 'Rose'];

// ---------------------------------------------------------------- hex math (flat-top axial coordinates)
export const hexCenter = (q, r) => [1.5 * q * C.HEX, SQ3 * (r + q / 2) * C.HEX];
export const hexDist = (q, r) => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
export function pixelToHex(x, z) {
  const qf = (2 / 3) * x / C.HEX, rf = (-x / 3 + (SQ3 / 3) * z) / C.HEX, sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf); const s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
  return [q, r];
}
const GR = 12, GW = GR * 2 + 1;                       // lookup grid covers |q|,|r| <= 11
export const NEIGH = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function tileAt(L, x, z) {
  const [q, r] = pixelToHex(x, z);
  if (q < -GR || q > GR || r < -GR || r > GR) return -1;
  return L.grid[(q + GR) * GW + (r + GR)];
}
export const tileQR = (L, q, r) => (q < -GR || q > GR || r < -GR || r > GR) ? -1 : L.grid[(q + GR) * GW + (r + GR)];
export const solid = (L, i, t) => i >= 0 && L.at[i] > t;

// ---------------------------------------------------------------- level (built from the seed: identical everywhere)
const SHAPES = ['hex', 'ring', 'cross', 'swiss', 'islands'];
function inShape(shape, q, r, N, rng) {
  const d = hexDist(q, r); if (d > N) return false;
  const [x, z] = hexCenter(q, r);
  switch (shape) {
    case 'ring': return d >= N - 2 || d <= 1;
    case 'cross': return d <= 1 || Math.abs(x) < 1.6 || Math.abs(z) < 1.8;
    case 'swiss': return d <= 1 || d === N || ((q - r + 300) % 3 !== 0);
    case 'islands': {
      // a center island + six around it, separated by one-tile gaps (jump them)
      if (d <= 1) return true;
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.PI / 6, cx = Math.sin(a) * 5.2, cz = Math.cos(a) * 5.2; if (Math.hypot(x - cx, z - cz) < 2.1) return true; }
      return false;
    }
    default: return true;
  }
}

// opts: { layers, shape, players, delay }
export function makeLevel(rng, opts, round = 0) {
  const L = Math.max(3, Math.min(5, opts.layers | 0 || 4));
  const N0 = opts.players > 4 ? 9 : 8;
  const layers = [];
  for (let h = 0; h < L; h++) {
    const top = h === L - 1;
    let shape = opts.shape && opts.shape !== 'random' ? opts.shape : rng.pick(top ? ['hex', 'swiss', 'hex'] : SHAPES);
    if (shape === 'islands' && top) shape = 'hex';
    const N = top ? N0 - 1 : h === 0 ? N0 + 1 : N0;   // the bottom floor is the biggest, the top the smallest
    const xs = [], zs = [], qs = [], rs = [];
    const grid = new Int16Array(GW * GW).fill(-1);
    for (let q = -N; q <= N; q++) for (let r = -N; r <= N; r++) {
      if (!inShape(shape, q, r, N, rng)) continue;
      if (opts.shape === 'random' && !top && hexDist(q, r) > 1 && rng() < 0.035) continue;   // a few seeded holes
      const [x, z] = hexCenter(q, r);
      grid[(q + GR) * GW + (r + GR)] = xs.length; xs.push(x); zs.push(z); qs.push(q); rs.push(r);
    }
    const n = xs.length;
    layers.push({ h, y: h * C.LAYER_H, shape, N, n, xs: Float32Array.from(xs), zs: Float32Array.from(zs), qs: Int8Array.from(qs), rs: Int8Array.from(rs), grid,
      at: new Float64Array(n).fill(Infinity), who: new Uint8Array(n).fill(255), color: LAYER_COLORS[(h + (5 - L)) % 5] });
  }
  // spawns: spread around the top layer
  const T = layers[L - 1], spawns = [], used = new Set();
  const np = Math.max(1, opts.players | 0), off = rng() * Math.PI * 2, rad = Math.min(5.5, (T.N - 0.6) * 1.5 * 0.6);
  for (let i = 0; i < np; i++) {
    const a = off + (i / np) * Math.PI * 2, tx = Math.sin(a) * rad, tz = Math.cos(a) * rad;
    let best = -1, bd = 1e9;
    for (let j = 0; j < T.n; j++) {
      if (used.has(j)) continue;
      const d = Math.hypot(T.xs[j] - tx, T.zs[j] - tz); if (d < bd) { bd = d; best = j; }
    }
    if (best < 0) best = 0;
    used.add(best); spawns.push(best);
  }
  // later rounds of a match get a little faster (round 1: 100 %, round 2: 90 %, round 3+: 80 %, never below 70 %)
  const delay = (C.DELAYS[opts.delay] || C.DELAYS.normal) * Math.max(0.7, 1 - 0.1 * round);
  return { L, layers, spawns, delay, round, N0, hue: rng() };
}
export function resetLevel(lv) { for (const L of lv.layers) { L.at.fill(Infinity); L.who.fill(255); } }

// The edge tiles of a layer (solid tiles next to a hole or the rim): what erosion eats first.
export function edgeTiles(L, t) {
  const out = [];
  for (let i = 0; i < L.n; i++) {
    if (L.at[i] !== Infinity) continue;
    for (const [dq, dr] of NEIGH) { const j = tileQR(L, L.qs[i] + dq, L.rs[i] + dr); if (j < 0 || L.at[j] <= t + 0.3) { out.push(i); break; } }
  }
  return out;
}
export function solidCount(L, t) { let c = 0; for (let i = 0; i < L.n; i++) if (L.at[i] > t) c++; return c; }

// ---------------------------------------------------------------- players
export function newPlayer(id, lv, idx) {
  const T = lv.layers[lv.L - 1], i = lv.spawns[idx % lv.spawns.length];
  const x = T.xs[i], z = T.zs[i];
  return { id, x, y: T.y, z, vx: 0, vy: 0, vz: 0, g: true, l: lv.L - 1, face: Math.atan2(-x, -z), alive: true,
    dashT: 0, dashCd: 0, stun: 0, coy: 0, lj: 0, ld: 0, auth: 0, air: 0 };
}
// Remember the input counters so a new round / correction never fires an old press.
export function syncCounters(p, inp) { p.lj = inp.j; p.ld = inp.d; }

// One physics step (host and client prediction). inp = {mx, mz, j, d} (j/d are press counters).
// Returns what happened this step (for sounds / tile triggers).
export function stepPlayer(p, inp, dt, lv, t, ev = {}) {
  ev.land = -1; ev.ground = -1; ev.jump = false; ev.dash = false; ev.fell = false;
  if (!p.alive) return ev;
  const ml = Math.hypot(inp.mx, inp.mz), k = Math.min(1, ml), dx = ml > 1e-3 ? inp.mx / ml : 0, dz = ml > 1e-3 ? inp.mz / ml : 0;
  const ctl = p.stun > 0 ? 0.2 : 1;
  if (p.dashT <= 0) {
    const a = (p.g ? C.ACC : C.AIR_ACC) * ctl * dt, tvx = dx * C.SPEED * k, tvz = dz * C.SPEED * k;
    const ex = tvx - p.vx, ez = tvz - p.vz, el = Math.hypot(ex, ez);
    if (el <= a) { p.vx = tvx; p.vz = tvz; } else { p.vx += (ex / el) * a; p.vz += (ez / el) * a; }
  }
  if (inp.d !== p.ld) {
    p.ld = inp.d;
    if (p.dashCd <= 0 && p.stun <= 0) {
      const fx = k > 0.1 ? dx : Math.sin(p.face), fz = k > 0.1 ? dz : Math.cos(p.face);
      p.dashT = C.DASH_T; p.dashCd = C.DASH_CD; p.vx = fx * C.DASH_V; p.vz = fz * C.DASH_V;
      if (!p.g) p.vy = Math.max(p.vy, C.DASH_LIFT);
      ev.dash = true;
    }
  }
  if (inp.j !== p.lj) {
    p.lj = inp.j;
    if ((p.g || p.coy > 0) && p.stun <= 0.15) { p.vy = C.JUMP; p.g = false; p.coy = 0; ev.jump = true; }
  }
  if (p.dashT > 0) { p.dashT -= dt; if (p.dashT <= 0) { p.vx *= 0.45; p.vz *= 0.45; } }
  p.dashCd = Math.max(0, p.dashCd - dt); p.stun = Math.max(0, p.stun - dt);
  p.x += p.vx * dt; p.z += p.vz * dt;
  if (p.g) {
    const L = lv.layers[p.l], i = tileAt(L, p.x, p.z);
    if (!solid(L, i, t)) { p.g = false; p.coy = C.COYOTE; p.vy = 0; ev.fell = true; }
    else { p.y = L.y; p.vy = 0; ev.ground = i; p.air = 0; }
  }
  if (!p.g) {
    p.coy -= dt; p.air += dt;
    const py = p.y;
    p.vy = Math.max(-C.MAX_FALL, p.vy - C.G * dt); p.y += p.vy * dt;
    if (p.vy <= 0) {
      for (let h = lv.L - 1; h >= 0; h--) {
        const L = lv.layers[h];
        if (py >= L.y - 1e-4 && p.y <= L.y) {
          const i = tileAt(L, p.x, p.z);
          if (solid(L, i, t)) { p.y = L.y; ev.impact = -p.vy; p.vy = 0; p.g = true; p.l = h; ev.land = i; ev.ground = i; p.air = 0; break; }
        }
      }
    }
    if (p.y < C.KILL_Y) p.alive = false;
  }
  if (Math.hypot(p.vx, p.vz) > 0.6) p.face = Math.atan2(p.vx, p.vz);
  return ev;
}
// The layer a player is on / falling towards (for the HUD and camera).
export function layerOf(lv, y) { for (let h = lv.L - 1; h >= 0; h--) if (y >= lv.layers[h].y - 0.5) return h; return -1; }

// Player-vs-player: soft pushes, and dash hits that knock the other player flying. Host only.
export function collide(list, onHit) {
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const A = list[a], B = list[b];
    if (!A.alive || !B.alive || Math.abs(A.y - B.y) > 1.1) continue;
    let nx = B.x - A.x, nz = B.z - A.z; const d = Math.hypot(nx, nz), min = C.R * 2;
    if (d >= min) continue;
    if (d < 1e-4) { nx = 1; nz = 0; } else { nx /= d; nz /= d; }
    const push = (min - d) / 2; A.x -= nx * push; A.z -= nz * push; B.x += nx * push; B.z += nz * push;
    const aHit = A.dashT > 0 && A.vx * nx + A.vz * nz > 2, bHit = B.dashT > 0 && -(B.vx * nx + B.vz * nz) > 2;
    if (aHit || bHit) {
      if (aHit) knock(B, nx, nz, bHit ? 0.6 : 1);
      if (bHit) knock(A, -nx, -nz, aHit ? 0.6 : 1);
      if (aHit) { A.vx *= 0.2; A.vz *= 0.2; A.dashT = 0; }
      if (bHit) { B.vx *= 0.2; B.vz *= 0.2; B.dashT = 0; }
      onHit(aHit ? A : B, aHit ? B : A, (A.x + B.x) / 2, Math.max(A.y, B.y) + 0.8, (A.z + B.z) / 2, aHit && bHit);
    } else {
      // plain bump: trade a little velocity along the contact normal
      const rel = (A.vx - B.vx) * nx + (A.vz - B.vz) * nz;
      if (rel > 0) { const j = rel * 0.55; A.vx -= nx * j; A.vz -= nz * j; B.vx += nx * j; B.vz += nz * j; }
    }
  }
}
function knock(P, nx, nz, f) {
  P.vx = nx * C.BUMP * f; P.vz = nz * C.BUMP * f;
  P.vy = Math.max(P.vy, C.BUMP_UP * f); P.g = false; P.coy = 0; P.stun = C.STUN; P.dashT = 0;
}
