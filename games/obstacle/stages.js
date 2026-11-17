// Stage pool. Every stage is built only from the seeded rng, so every client builds the identical course.
// Race stages are chains of obstacle modules joined by checkpoint pads (courses run along +z). Bots follow
// the route nodes each module leaves behind. Survival stages and finals are hand-shaped arenas.
import { solid } from './world.js';

export const STAGES = {
  whirl: { name: 'Whirl Way', kind: 'race', icon: '🌀', desc: 'Spinning sweepers, swinging hammers and a gauntlet of surprises. Jump the low bars, dive under the high ones.', time: 150, mods: ['sweepers', 'hammers'] },
  hop: { name: 'Gap Hop', kind: 'race', icon: '🦘', desc: 'Moving, blinking and spinning platforms over the slime. Time your jumps, dive to stretch them.', time: 150, mods: ['gaps', 'blinkers'] },
  doors: { name: 'Door Dash', kind: 'race', icon: '🚪', desc: 'Fake doors, moving walls with holes and a mix of traps. Bonk!', time: 150, mods: ['doors', 'wallrush'] },
  climb: { name: 'Conveyor Chaos', kind: 'race', icon: '🏭', desc: 'Pick the fast belt lane, dodge the punchers, then ride the lifts.', time: 150, mods: ['conveyor', 'rising'] },
  rotor: { name: 'Rotor Rumble', kind: 'race', icon: '🎡', desc: 'Everything spins: turnstiles, spinning discs and cross-sweepers. Keep your balance!', time: 150, mods: ['turnstiles', 'discs'] },
  bounce: { name: 'Bounce Castle', kind: 'race', icon: '🏰', desc: 'Bounce pads over castle walls, then wobbly zig-zag beams. Up, over and across!', time: 150, mods: ['bouncers', 'zigzag'] },
  tiles: { name: 'Tile Drop', kind: 'survival', icon: '🟪', desc: 'Tiles drop after you step on them. Three floors, then the slime. Keep moving!', time: 75 },
  sweep: { name: 'Sweep Out', kind: 'survival', icon: '🧹', desc: 'Two giant arms that keep speeding up. Jump the low one, and don\'t jump into the high one!', time: 65 },
  crown: { name: 'Crown Summit', kind: 'final', icon: '👑', desc: 'Fight through the course, climb the tower and grab the crown first!', time: 170 },
  last: { name: 'Bean Arena', kind: 'final', icon: '🏟️', desc: 'Last one standing on the spinning arena. The outer ring is falling away…', time: 100 },
};
// every obstacle section a race can draw from (each race = its 2 signature sections + 3 of these)
export const POOL = ['sweepers', 'hammers', 'spinners', 'gaps', 'discs', 'rising', 'punchers', 'conveyor', 'doors2', 'bouncers', 'blinkers', 'pushers', 'wallrush', 'turnstiles', 'zigzag'];
export const RACES = ['whirl', 'hop', 'doors', 'climb', 'rotor', 'bounce'], SURVIVALS = ['tiles', 'sweep'], FINALS = ['crown', 'last'];

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
  // flat conveyor lanes: some belts carry you forward, some drag you back, punchers guard the fast lanes
  conveyor(B, z, y) {
    const r = B.rng, n = 4, lanes = [-3.7, 0, 3.7];
    for (let i = 0; i < n; i++) {
      const zz = z + 3 + i * 6, fast = r.int(0, 2);
      lanes.forEach((x, li) => B.add(slab(x, y, zz, 1.85, 3, { belt: [0, li === fast ? 3.2 : -(2.4 + r.range(0, 1.8))], look: 'belt' })));
      if (i % 2 === 1) { const sd = lanes[fast] < 0 ? -1 : lanes[fast] > 0 ? 1 : (r() < 0.5 ? -1 : 1); B.add(box(sd * 6.6, y + 0.8, zz + r.range(-1, 1), 1.0, 0.8, 1.0, { anim: { k: 'piston', v: [-sd * 4.6, 0, 0], f: r.range(0.35, 0.5), ph: r.range(0, 1) }, hit: 0.6, look: 'piston', noHang: true })); }
      B.node({ x: lanes[fast], y, z: zz, w: 0.8, r: 1.4 });
    }
    B.node({ x: 0, y, z: z + n * 6 + 1, w: 3 });
    return { z: z + n * 6, y };
  },
  // jump pads in front of tall walls: bounce over (or jump, grab the top with E and climb)
  bouncers(B, z, y) {
    const r = B.rng, L = 24;
    B.add(slab(0, y, z + L / 2, HALF, L / 2, { look: 'floor' }));
    B.node({ x: 0, y, z: z + 2, w: 3 });
    for (const wz of [z + 8, z + 18]) {
      B.add(box(0, y + 1.6, wz, HALF, 1.6, 0.35, { look: 'bwall' }));
      const xs = r.shuffle([-4.6, 0, 4.6]);
      const pads = xs.map((x) => B.add(box(x, y - 0.08, wz - 2.3, 1.25, 0.08, 1.25, { bounce: 15.5, look: 'pad' })));   // pads are flush with the floor: no lip to trip on
      B.node({ padAlts: pads.map((p) => p.idx), y, z: wz - 2.3, r: 1.0 });
      B.node({ x: 0, y, z: wz + 2.4, w: 3, r: 2 });
    }
    return { z: z + L, y };
  },
  // platforms that blink in and out of existence, row by row
  blinkers(B, z, y) {
    const r = B.rng, rows = 5, ph0 = r.range(0, 1);
    B.node({ x: 0, y, z: z - 0.9, w: 1.5 });
    for (let i = 0; i < rows; i++) {
      const zz = z + 2.9 + i * 4.3, row = [];
      for (const x of [-3.8, 0, 3.8]) {
        const ph = (ph0 + i * 0.17 + (x + 3.8) * 0.06) % 1;
        row.push(B.add(slab(x, y, zz, 1.65, 1.65, { blink: { p: 3.6, on: 0.68, ph }, look: 'blink' })));
      }
      B.node({ sidAlts: row.map((s) => s.idx), leap: true, y });
    }
    const L = 2.9 + (rows - 1) * 4.3 + 1.65 + 1.3;
    B.node({ x: 0, y, z: z + L + 1.5, w: 2, leap: true });
    return { z: z + L, y };
  },
  // big blocks sliding across the lane: they shove you toward the edge
  pushers(B, z, y) {
    const r = B.rng, L = 24;
    B.add(slab(0, y, z + L / 2, HALF, L / 2, { look: 'floor' }));
    [4, 8.5, 13, 17.5].forEach((dz) => {
      const s = r() < 0.5 ? 1 : -1;
      B.add(box(s * 2.5, y + 0.9, z + dz, 1.7, 0.9, 1.1, { anim: { k: 'slide', v: [s * 5.2, 0, 0], w: r.range(1.3, 1.8), ph: r.range(0, TAU) }, hit: 0.7, look: 'pusher', noHang: true }));
    });
    for (const dz of [2, 8, 14, 20, L - 1]) B.node({ x: 0, y, z: z + dz, w: 3.5, r: 1.3 });
    return { z: z + L, y };
  },
  // hole-in-the-wall: walls glide toward you; get through the gap
  wallrush(B, z, y) {
    const r = B.rng, L = 26, HW = 6;
    B.add(slab(0, y, z + L / 2, HW, L / 2, { look: 'floor' }));
    for (const s of [-1, 1]) B.add(box(s * (HW + 0.3), y + 0.6, z + L / 2, 0.3, 0.6, L / 2, { look: 'rail', noHang: true }));
    [7, 17].forEach((dz) => {
      const gx = r.range(-3.2, 3.2), gw = 1.3, ph = r.range(0, TAU), w = r.range(1.0, 1.35), v = [0, 0, -4.5];
      const lw = (gx - gw) - (-HW), rw = HW - (gx + gw);
      const o = { anim: { k: 'slide', v, w, ph }, hit: 0.4, look: 'rushwall', noHang: true };
      if (lw > 0.2) B.add(box(-HW + lw / 2, y + 1.5, z + dz, lw / 2, 1.5, 0.45, o));
      if (rw > 0.2) B.add(box(HW - rw / 2, y + 1.5, z + dz, rw / 2, 1.5, 0.45, { ...o, anim: { ...o.anim } }));
      B.node({ x: gx, y, z: z + dz - 5, r: 1 });
      B.node({ x: gx, y, z: z + dz + 5, r: 1.2 });
    });
    B.node({ x: 0, y, z: z + L - 0.8, w: 3 });
    return { z: z + L, y };
  },
  // rotating cross gates: shove your way through
  turnstiles(B, z, y) {
    const r = B.rng, L = 22;
    B.add(slab(0, y, z + L / 2, HALF, L / 2, { look: 'floor' }));
    [6.5, 15.5].forEach((dz, i) => {
      for (const x of [-3.6, 3.6]) {
        const w = r.range(0.9, 1.3) * (x < 0 ? 1 : -1) * (i ? -1 : 1), ph = r.range(0, TAU);
        B.add(cyl(x, y + 1.0, z + dz, 0.35, 1.0, { look: 'post' }));
        for (const a of [0, Math.PI / 2]) B.add(box(x, y + 0.9, z + dz, 3.1, 0.75, 0.16, { anim: { k: 'spin', w }, bry: ph + a, hit: 0.35, soft: true, look: 'gate', noHang: true }));
      }
    });
    for (const dz of [2, 6.5, 11, 15.5, L - 1]) B.node({ x: 0, y, z: z + dz, w: 1.2, r: 1.3 });
    return { z: z + L, y };
  },
  // narrow zig-zag beams over the slime, with a swinging hammer on the way
  zigzag(B, z, y) {
    const r = B.rng, n = 4, segL = 6.2;
    let x = 0, zz = z;
    B.node({ x: 0, y, z: z - 0.8, w: 0.4 });
    for (let i = 0; i < n; i++) {
      const nx = (i % 2 ? -1 : 1) * r.range(2.2, 3.2), dx = nx - x, dz = segL;
      const len = Math.hypot(dx, dz), a = Math.atan2(dx, dz);
      B.add(slab(x + dx / 2, y, zz + dz / 2, 1.0, len / 2 + 0.7, { bry: a, look: 'beamwalk' }));
      B.node({ x: nx, y, z: zz + dz, r: 0.9, exact: true });
      if (i === 1 || i === 3) B.add(box(x + dx / 2, y + 7.2, zz + dz / 2, 0.65, 0.65, 0.9, { anim: { k: 'pend', L: 5.75, amp: 0.55, w: r.range(1.8, 2.3), ph: r.range(0, TAU), d: [Math.cos(a), -Math.sin(a)] }, bry: a, hit: 1.2, look: 'hammer', noHang: true }));
      x = nx; zz += dz;
    }
    B.add(slab(x / 2, y, zz + 1.5, Math.abs(x) / 2 + 1.5, 1.5, { look: 'bridge' }));
    B.node({ x: 0, y, z: zz + 2.5, w: 1 });
    return { z: zz + 3, y };
  },
  // spiral staircase around a column (walkable, no jumping needed), a spinning arm sweeping the stairs, crown on top
  tower(B, z, y) {
    const r = B.rng, cz = z + 9.5, R = 5.6, n = 18, da = 0.36, rise = 0.45;
    const dir = r() < 0.5 ? 1 : -1;
    B.add(cyl(0, y - 3, cz, 2.4, 12, { look: 'column' }));
    B.node({ x: 0, y, z: z - 0.9, w: 1 });
    for (let i = 0; i < n; i++) {
      const a = Math.PI + dir * i * da, top = y + rise * (i + 1);
      const s = B.add(slab(Math.sin(a) * R, top, cz + Math.cos(a) * R, 1.7, 1.25, { bry: a + Math.PI / 2, look: 'step' }));
      if (i % 2 === 0 || i === n - 1) B.node({ sid: s.idx, y: top, center: true });
    }
    B.add(box(0, y + 4.4, cz, 2.9, 0.24, 0.24, { ox: 5.3, anim: { k: 'spin', w: 0.8 * dir }, bry: r.range(0, TAU), hit: 1.1, look: 'beam' }));
    B.add(box(0, y + 6.9, cz, 2.9, 0.24, 0.24, { ox: 5.3, anim: { k: 'spin', w: -0.65 * dir }, bry: r.range(0, TAU), hit: 1.1, look: 'beam' }));
    const sumTop = y + rise * (n + 1);
    const sum = B.add(cyl(0, sumTop - 0.3, cz, 4.3, 0.3, { look: 'summit' }));
    B.node({ x: 0, y: sumTop, z: cz, sid: sum.idx, center: true });
    B.crown = { x: 0, y: sumTop + 2.35, z: cz };
    B.node({ crown: true, x: 0, y: sumTop, z: cz, r: 0.6 });
    return { z: cz + 4.3, y: sumTop, end: true };
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
// signature sections + n more from the pool (no repeats), shuffled so each seed plays differently;
// the stage's own two signatures are spread out (one early, one late)
function pickMods(rng, sig, n) {
  const extra = rng.shuffle(POOL.filter((m) => !sig.includes(m) && !(m === 'doors2' && sig.includes('doors')))).slice(0, n);
  const list = rng.shuffle([...extra]);
  list.splice(rng.int(0, 1), 0, sig[0]);
  if (sig[1]) list.splice(rng.int(list.length - 1, list.length), 0, sig[1]);
  return list;
}
export function buildStage(id, rng, mods = null) {
  const meta = STAGES[id];
  let B;
  if (id === 'tiles') B = buildTiles(rng);
  else if (id === 'sweep') B = buildSweep(rng);
  else if (id === 'last') B = buildArena(rng);
  else if (mods) B = buildRace(rng, id, mods);
  else if (id === 'crown') B = buildRace(rng, id, [...pickMods(rng, [rng() < 0.5 ? 'sweepers' : 'turnstiles'], 2), 'tower']);
  else B = buildRace(rng, id, pickMods(rng, meta.mods, 3));
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
