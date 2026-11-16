// Stage pool. Every stage is built only from the seeded rng, so every client builds the identical course.
// Race stages are chains of obstacle modules joined by checkpoint pads (courses run along +z). Bots follow
// the route nodes each module leaves behind. Survival stages and finals are hand-shaped arenas.
import { solid } from './world.js';

export const STAGES = {
  whirl: { name: 'Whirl Way', kind: 'race', icon: '🌀', desc: 'Spinning sweepers and swinging hammers. Jump the low bars, dive under the high ones.', time: 110, mods: ['sweepers', 'hammers', 'spinners'] },
  hop: { name: 'Gap Hop', kind: 'race', icon: '🦘', desc: 'Moving platforms over the slime. Time your jumps, dive to stretch them.', time: 120, mods: ['gaps', 'discs', 'rising'] },
  doors: { name: 'Door Dash', kind: 'race', icon: '🚪', desc: 'Rows of doors and some are fake. Bonk!', time: 110, mods: ['doors', 'punchers', 'doors2'] },
  climb: { name: 'Conveyor Climb', kind: 'race', icon: '⛰️', desc: 'Run up the belts while the punchers try to box you off.', time: 120, mods: ['conveyor', 'punchers', 'conveyor'] },
  tiles: { name: 'Tile Drop', kind: 'survival', icon: '🟪', desc: 'Tiles drop after you step on them. Three floors, then the slime. Keep moving!', time: 75 },
  sweep: { name: 'Sweep Out', kind: 'survival', icon: '🧹', desc: 'Two giant arms that keep speeding up. Jump the low one, dive under the high one.', time: 65 },
  crown: { name: 'Crown Summit', kind: 'final', icon: '👑', desc: 'Climb to the top of the tower and grab the crown first!', time: 150 },
  last: { name: 'Bean Arena', kind: 'final', icon: '🏟️', desc: 'Last bean standing on the spinning arena. The outer ring is falling away…', time: 100 },
};
export const RACES = ['whirl', 'hop', 'doors', 'climb'], SURVIVALS = ['tiles', 'sweep'], FINALS = ['crown', 'last'];

// ---------------------------------------------------------------- match plan + qualifying spots
// opts: {rounds: '3'|'4', pool: 'all'|'races'|'survival', final: 'random'|'crown'|'last'}
export function planMatch(rng, opts, N) {
  const R = opts.rounds === '4' ? 4 : 3;
  const F = finalists(N);
  const nonFinal = Math.max(1, Math.min(R - 1, N - F));
  let pool = opts.pool === 'races' ? [...RACES] : opts.pool === 'survival' ? [...SURVIVALS, ...rng.shuffle([...RACES]).slice(0, 2)] : [...RACES, ...SURVIVALS];
  rng.shuffle(pool);
  if (opts.pool === 'survival') pool.sort((a, b) => (SURVIVALS.includes(b) ? 1 : 0) - (SURVIVALS.includes(a) ? 1 : 0));
  // never open the show with a survival round unless asked: races teach the controls
  if (opts.pool !== 'survival') { const i = pool.findIndex((s) => STAGES[s].kind === 'race'); if (i > 0) pool.unshift(pool.splice(i, 1)[0]); }
  const list = [];
  while (list.length < nonFinal) list.push(pool[list.length % pool.length]);
  list.push(FINALS.includes(opts.final) ? opts.final : rng.pick(FINALS));
  return list;
}
export const finalists = (N) => (N <= 1 ? 1 : N >= 7 ? 3 : 2);
// how many of the n players in round k qualify (final: 1 winner)
export function quota(plan, k, n, N) {
  if (k >= plan.length - 1) return 1;
  const F = finalists(N);
  if (n <= F) return n;
  const left = plan.length - 1 - k;
  return Math.max(F, Math.min(n - 1, Math.floor(n - (n - F) / left)));
}

// ---------------------------------------------------------------- building blocks
const box = (x, y, z, hx, hy, hz, o = {}) => solid({ bx: x, by: y, bz: z, hx, hy, hz, ...o });
const slab = (x, top, z, hx, hz, o = {}) => box(x, top - 0.5, z, hx, 0.5, hz, o);      // platform: top surface at `top`
const cyl = (x, y, z, r, hy, o = {}) => solid({ shape: 'cyl', bx: x, by: y, bz: z, r, hy, ...o });
const TAU = Math.PI * 2, HALF = 7;

function builder(rng, kind) {
  const B = { rng, kind, solids: [], route: [], cps: [], dynN: 0, doors: [], minY: 0, maxY: 0 };
  B.add = (s) => { s.idx = B.solids.length; B.solids.push(s); B.minY = Math.min(B.minY, s.by - s.hy); B.maxY = Math.max(B.maxY, s.by + s.hy); return s; };
  B.node = (n) => { B.route.push({ w: 0, r: 1.3, ...n }); };
  B.dyn = () => B.dynN++;
  return B;
}

// ---- race modules: (B, z, y) -> {z, y} (z/y where the next pad starts)
const MODS = {
  sweepers(B, z, y) {
    const L = 26, r = B.rng;
    B.add(slab(0, y, z + L / 2, HALF, L / 2, { look: 'floor' }));
    [z + 7.5, z + 18.5].forEach((zz, i) => {
      B.add(cyl(0, y + 0.8, zz, 0.75, 0.8, { look: 'post' }));
      const w = r.range(1.25, 1.75) * (r() < 0.5 ? -1 : 1), ph = r.range(0, TAU);
      B.add(box(0, y + 0.5, zz, HALF - 0.2, 0.22, 0.22, { anim: { k: 'spin', w }, bry: ph, hit: 1.25, look: 'beam' }));
      if (i === 1) B.add(box(0, y + 1.55, zz, HALF - 0.2, 0.22, 0.22, { anim: { k: 'spin', w }, bry: ph + Math.PI / 2, hit: 1.25, look: 'beam', high: true }));
    });
    B.node({ x: 0, y, z: z + 3, w: 5, side: 1.6 }); B.node({ x: 0, y, z: z + 13, w: 5, side: 1.6 }); B.node({ x: 0, y, z: z + L - 1.5, w: 4.5, side: 1.6 });
    return { z: z + L, y };
  },
  hammers(B, z, y) {
    const L = 24, r = B.rng, xs = [-4.6, 0, 4.6];
    for (const x of xs) {
      B.add(slab(x, y, z + L / 2, 1.15, L / 2, { look: 'bridge' }));
      for (const zz of [z + 6.5 + r.range(-1, 1), z + 16 + r.range(-1, 1)]) {
        B.add(box(x, y + 7.2, zz, 0.7, 0.7, 1.0, { anim: { k: 'pend', L: 5.75, amp: 0.62, w: r.range(1.8, 2.5), ph: r.range(0, TAU), d: [1, 0] }, hit: 1.35, look: 'hammer', noHang: true }));
      }
    }
    B.node({ alts: xs, y, z: z + 0.6, r: 1.1 });
    for (const zz of [z + 4, z + 11, z + 18, z + L - 0.4]) B.node({ lane: true, y, z: zz, r: 0.8 });
    return { z: z + L, y };
  },
  spinners(B, z, y) {
    const L = 24, r = B.rng;
    B.add(slab(0, y, z + L / 2, HALF, L / 2, { look: 'floor' }));
    const w0 = r.range(1.1, 1.5) * (r() < 0.5 ? -1 : 1), p0 = r.range(0, TAU);
    B.add(cyl(0, y + 1.0, z + 7, 0.75, 1.0, { look: 'post' }));
    B.add(box(0, y + 0.5, z + 7, HALF - 0.2, 0.22, 0.22, { anim: { k: 'spin', w: w0 }, bry: p0, hit: 1.25, look: 'beam' }));
    B.add(box(0, y + 1.55, z + 7, HALF - 0.2, 0.22, 0.22, { anim: { k: 'spin', w: w0 }, bry: p0 + Math.PI / 2, hit: 1.25, look: 'beam', high: true }));
    for (const s of [-1, 1]) {
      const w = r.range(1.6, 2.1) * s, ph = r.range(0, TAU);
      B.add(cyl(s * 3.6, y + 0.8, z + 17, 0.5, 0.8, { look: 'post' }));
      B.add(box(s * 3.6, y + 0.5, z + 17, 3.3, 0.2, 0.2, { anim: { k: 'spin', w }, bry: ph, hit: 1.2, look: 'beam' }));
    }
    B.node({ x: 0, y, z: z + 3, w: 5, side: 1.6 }); B.node({ x: 0, y, z: z + 12, w: 1.2 }); B.node({ x: 0, y, z: z + L - 1.5, w: 1.5 });
    return { z: z + L, y };
  },
  gaps(B, z, y) {
    const r = B.rng, rows = 4;
    B.node({ x: 0, y, z: z - 0.9, w: 2 });
    for (let i = 0; i < rows; i++) {
      const zz = z + 3 + i * 5;
      const s = B.add(slab(0, y, zz, 1.9, 1.7, { anim: { k: 'slide', v: [r.range(3, 4.4), 0, 0], w: r.range(0.9, 1.35), ph: r.range(0, TAU) }, look: 'mover' }));
      B.node({ sid: s.idx, leap: true, y });
    }
    const L = 3 + (rows - 1) * 5 + 1.7 + 1.4;
    B.node({ x: 0, y, z: z + L + 1.5, w: 2, leap: true });
    return { z: z + L, y };
  },
  discs(B, z, y) {
    const r = B.rng, n = 3, xs = r() < 0.5 ? [-2.4, 2.4, -2.4] : [2.4, -2.4, 2.4];
    B.node({ x: 0, y, z: z - 0.9, w: 2 });
    for (let i = 0; i < n; i++) {
      const zz = z + 4 + i * 7.2;
      const s = B.add(cyl(xs[i], y - 0.4, zz, 3.0, 0.4, { anim: { k: 'spin', w: r.range(0.55, 1.0) * (i % 2 ? -1 : 1) }, look: 'disc' }));
      B.add(cyl(xs[i], y + 0.6, zz, 0.45, 0.6, { look: 'post', anim: { k: 'spin', w: 0 } }));
      B.node({ x: xs[i], y, z: zz, sid: s.idx, leap: true, r: 1.6, center: true });
    }
    const L = 4 + (n - 1) * 7.2 + 3 + 1.1;
    B.node({ x: 0, y, z: z + L + 1.5, w: 2, leap: true });
    return { z: z + L, y };
  },
  rising(B, z, y) {
    const r = B.rng, n = 5;
    B.node({ x: 0, y, z: z - 0.9, w: 1.5 });
    for (let i = 0; i < n; i++) {
      const zz = z + 3 + i * 4.5, top = y + 0.8 * (i + 1);
      const s = B.add(slab(r.range(-1.5, 1.5), top, zz, 2.2, 1.6, { anim: { k: 'slide', v: [0, 1.1, 0], w: r.range(1.0, 1.5), ph: r.range(0, TAU) }, look: 'lift' }));
      B.node({ sid: s.idx, leap: true, y: top });
    }
    const L = 3 + (n - 1) * 4.5 + 1.6 + 1.2, ny = y + 0.8 * n;
    B.node({ x: 0, y: ny, z: z + L + 1.5, w: 2, leap: true });
    return { z: z + L, y: ny };
  },
  doors(B, z, y, rows = 3) {
    const r = B.rng, L = rows * 7.5 + 1.5, HW = 7.2;
    B.add(slab(0, y, z + L / 2, HW, L / 2, { look: 'floor' }));
    for (const s of [-1, 1]) B.add(box(s * (HW + 0.3), y + 2.4, z + L / 2, 0.3, 2.4, L / 2, { look: 'wall', noHang: true }));
    for (let k = 0; k < rows; k++) {
      const zz = z + 4.5 + k * 7.5, real = new Set(r.shuffle([0, 1, 2, 3, 4]).slice(0, r() < 0.5 ? 2 : 3));
      const row = [];
      for (let i = 0; i <= 5; i++) B.add(box(-HW + 0.2 + i * 2.8, y + 2.4, zz, 0.2, 2.4, 0.35, { look: 'pillar', noHang: true }));
      for (let i = 0; i < 5; i++) {
        const x = -HW + 0.4 + 1.2 + i * 2.8, d = B.dyn();
        B.add(box(x, y + 2.2, zz, 1.2, 2.2, 0.28, { door: d, fake: !real.has(i), look: 'door', noHang: true }));
        row.push({ x, d, fake: !real.has(i) });
      }
      B.doors.push({ z: zz, y, row });
      B.node({ door: B.doors.length - 1, y, z: zz });
    }
    B.node({ x: 0, y, z: z + L - 0.6, w: 3 });
    return { z: z + L, y };
  },
  doors2(B, z, y) { return MODS.doors(B, z, y, 2); },
  punchers(B, z, y) {
    const r = B.rng, L = 24, HW = 4.2;
    B.add(slab(0, y, z + L / 2, HW, L / 2, { look: 'bridge' }));
    [4, 9.5, 15, 20.5].forEach((dz, i) => {
      const s = i % 2 ? 1 : -1;
      B.add(box(s * (HW + 1.1), y + 0.85, z + dz, 1.1, 0.85, 1.3, { anim: { k: 'piston', v: [-s * 5.0, 0, 0], f: r.range(0.35, 0.5), ph: r.range(0, 1) }, hit: 0.6, look: 'piston', noHang: true }));
    });
    for (const dz of [2, 7, 12.5, 18, L - 0.5]) B.node({ x: 0, y, z: z + dz, w: 1.2, r: 1.1 });
    return { z: z + L, y };
  },
  conveyor(B, z, y) {
    const r = B.rng, n = 4, HW = 5.6;
    let top = y;
    for (let i = 0; i < n; i++) {
      top += 0.45;
      const zz = z + 3 + i * 6;
      B.add(slab(0, top, zz, HW, 3, { belt: [0, -(2.8 + i * 0.45)], look: 'belt' }));
      if (i % 2 === 1) for (const s of [-1, 1]) if (r() < 0.75) B.add(box(s * (HW + 1.0), top + 0.8, zz + r.range(-1, 1), 1.0, 0.8, 1.0, { anim: { k: 'piston', v: [-s * 4.0, 0, 0], f: r.range(0.35, 0.5), ph: r.range(0, 1) }, hit: 0.6, look: 'piston', noHang: true }));
      B.node({ x: 0, y: top, z: zz, w: 3, r: 1.4 });
    }
    B.node({ x: 0, y: top, z: z + n * 6 + 1, w: 3 });
    return { z: z + n * 6, y: top };
  },
  tower(B, z, y) {
    const r = B.rng, cz = z + 9.5, R = 5.2, n = 8, da = 0.67;
    const dir = r() < 0.5 ? 1 : -1;
    B.add(cyl(0, y - 2, cz, 2.2, 10, { look: 'column' }));
    B.node({ x: 0, y, z: z - 0.9, w: 1 });
    for (let i = 0; i < n; i++) {
      const a = Math.PI + dir * i * da, top = y + 0.9 * (i + 1);
      const s = B.add(slab(Math.sin(a) * R, top, cz + Math.cos(a) * R, 1.3, 1.3, { bry: a, look: 'step' }));
      B.node({ sid: s.idx, leap: true, y: top, center: true });
    }
    B.add(box(0, y + 4.6, cz, 2.6, 0.24, 0.24, { ox: 4.8, anim: { k: 'spin', w: 0.85 * dir }, bry: r.range(0, TAU), hit: 1.2, look: 'beam' }));
    const sumTop = y + 0.9 * (n + 1);
    const sum = B.add(cyl(0, sumTop - 0.5, cz, 4.2, 0.5, { look: 'summit' }));
    B.node({ x: 0, y: sumTop, z: cz, sid: sum.idx, leap: true, center: true });
    B.crown = { x: 0, y: sumTop + 2.35, z: cz };
    B.node({ crown: true, x: 0, y: sumTop, z: cz, r: 0.6 });
    return { z: cz + 4.2, y: sumTop, end: true };
  },
};

function buildRace(rng, id, mods) {
  const B = builder(rng, 'race');
  B.add(slab(0, 0, -1.5, 9, 7.5, { look: 'start' }));
  B.spawns = [];
  for (let i = 0; i < 8; i++) B.spawns.push({ x: -5.25 + (i % 4) * 3.5, z: -5 + Math.floor(i / 4) * 3, face: 0 });
  rng.shuffle(B.spawns);
  B.node({ x: 0, y: 0, z: 4.5, w: 4 });
  let z = 6, y = 0;
  mods.forEach((m, i) => {
    if (i > 0) {
      B.add(slab(0, y, z + 2.5, 7.5, 2.5, { look: 'cp' }));
      B.cps.push({ x: 0, y, z: z + 2.5 });
      B.node({ x: 0, y, z: z + 2.5, w: 3 });
      z += 5;
    }
    ({ z, y } = MODS[m](B, z, y));
  });
  if (!B.crown) {
    B.add(slab(0, y, z + 6, 9, 6, { look: 'finish' }));
    B.finishZ = z + 1.6; B.finishY = y;
    B.node({ x: 0, y, z: z + 6, w: 4, dive: true });
  }
  B.len = z + 12;
  return B;
}

function buildTiles(rng) {
  const B = builder(rng, 'survival');
  B.layers = [0, -5, -10];
  const step = 2.05, rad = 5;
  B.layers.forEach((ly, li) => {
    for (let q = -rad; q <= rad; q++) for (let rr = -rad; rr <= rad; rr++) {
      if (Math.abs(q + rr) > rad) continue;
      const x = step * (q + rr / 2), z = step * rr * Math.sqrt(3) / 2;
      B.add(cyl(x, ly - 0.3, z, 1.02, 0.3, { tile: B.dyn(), look: 'tile', layer: li }));
    }
  });
  B.spawns = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; B.spawns.push({ x: Math.sin(a) * 6.5, z: Math.cos(a) * 6.5, face: a + Math.PI }); }
  B.arenaR = 11; B.len = 0;
  return B;
}
function buildSweep(rng) {
  const B = builder(rng, 'survival');
  B.add(cyl(0, -0.5, 0, 11, 0.5, { look: 'arena' }));
  B.add(cyl(0, 1.2, 0, 1.0, 1.2, { look: 'post', noHang: true }));
  const d = rng() < 0.5 ? 1 : -1, ph = rng.range(0, TAU);
  // low arm: jump it. High arm: passes over a standing bean but swats anyone who jumps at the wrong moment.
  B.add(box(0, 0.5, 0, 10.8, 0.24, 0.26, { anim: { k: 'spin', w: 0.95 * d, acc: 0.036 * d }, bry: ph, hit: 1.0, look: 'beam' }));
  B.add(box(0, 1.95, 0, 10.8, 0.24, 0.26, { anim: { k: 'spin', w: -0.65 * d, acc: -0.024 * d }, bry: ph + Math.PI / 2, hit: 1.0, look: 'beam', high: true }));
  B.spawns = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.35; B.spawns.push({ x: Math.sin(a) * 6, z: Math.cos(a) * 6, face: a + Math.PI }); }
  B.arenaR = 10; B.len = 0;
  return B;
}
function buildArena(rng) {
  const B = builder(rng, 'final');
  B.add(cyl(0, -0.5, 0, 7.4, 0.5, { anim: { k: 'spin', w: 0.32 }, look: 'disc' }));
  const order = rng.shuffle([...Array(12).keys()]);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    B.add(box(Math.sin(a) * 9.3, -0.5, Math.cos(a) * 9.3, 2.35, 0.5, 1.85, { bry: a, until: 22 + order.indexOf(i) * 4, look: 'ring' }));
  }
  const d = rng() < 0.5 ? 1 : -1;
  B.add(box(0, 0.5, 0, 11, 0.24, 0.26, { anim: { k: 'spin', w: 0.6 * d, acc: 0.016 * d }, bry: rng.range(0, TAU), hit: 0.7, look: 'beam' }));
  B.add(box(0, 6.5, 0, 0.75, 0.75, 1.0, { anim: { k: 'pend', L: 5.8, amp: 0.95, w: 1.15, ph: rng.range(0, TAU), d: [1, 0] }, hit: 1.4, look: 'hammer', noHang: true }));
  B.spawns = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; B.spawns.push({ x: Math.sin(a) * 5, z: Math.cos(a) * 5, face: a + Math.PI }); }
  B.arenaR = 10.5; B.len = 0;
  return B;
}

// stage id + seeded rng -> stage data {id, meta, solids, moving, route, cps, spawns, killY, dynN, ...}
export function buildStage(id, rng) {
  const meta = STAGES[id];
  let B;
  if (id === 'tiles') B = buildTiles(rng);
  else if (id === 'sweep') B = buildSweep(rng);
  else if (id === 'last') B = buildArena(rng);
  else if (id === 'crown') B = buildRace(rng, id, [rng() < 0.5 ? 'rising' : 'gaps', rng() < 0.5 ? 'sweepers' : 'punchers', 'tower']);
  else B = buildRace(rng, id, rng.shuffle([...meta.mods]));
  const solids = B.solids;
  return {
    id, meta, mode: id === 'crown' ? 'crown' : id === 'last' ? 'last' : meta.kind === 'race' ? 'race' : 'survive',
    solids, moving: solids.filter((s) => s.anim), route: B.route, cps: B.cps, spawns: B.spawns, doors: B.doors, layers: B.layers,
    dynN: B.dynN, killY: (id === 'tiles' ? -10 : B.minY) - 6, finishZ: B.finishZ, finishY: B.finishY, crown: B.crown, arenaR: B.arenaR, len: B.len, maxY: B.maxY,
  };
}
// world object for a stage (one per simulation: host, client prediction)
export function makeWorld(st) { return { solids: st.solids, moving: st.moving, dyn: new Uint8Array(st.dynN), t: 0, killY: st.killY }; }
// where a player (index i among this round's players) starts
export function spawnOf(st, i) { const s = st.spawns[i % st.spawns.length]; const k = Math.floor(i / st.spawns.length); return { x: s.x + k * 0.6, y: 0.05, z: s.z, face: s.face }; }
export function respawnOf(st, cp, i) {
  if (cp <= 0 || !st.cps[cp - 1]) { const s = spawnOf(st, i); return { ...s, y: 0.6 }; }
  const c = st.cps[cp - 1]; return { x: c.x + ((i % 5) - 2) * 1.8, y: c.y + 0.6, z: c.z - 0.5 + Math.floor(i / 5) * 1.2, face: 0 };
}
// race progress (bigger = further) used for standings / timeouts
export function progressOf(st, p) {
  if (st.mode === 'crown') return p.y * 4 + p.z;
  if (st.mode === 'race') return p.z + (p.cp || 0) * 0.01;
  return 0;
}
