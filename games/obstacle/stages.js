// Stage pool. Every stage is built only from the seeded rng, so every client builds the identical course.
// Race stages are chains of obstacle modules joined by checkpoint pads (courses run along +z). Bots follow
// the route nodes each module leaves behind. Survival stages and finals are hand-shaped arenas.
import { solid } from './world.js';
import { MAPS, buildMap } from './maps.js';

export const STAGES = {
  ruins: { name: 'Temple of Doom', kind: 'race', icon: '🗿', desc: 'Spike causeways, axe-swept stepping stones, a split path, a boulder run and temple stairs to a wall of fake doors.', time: 180 },
  volcano: { name: 'Volcano Escape', kind: 'race', icon: '🌋', desc: 'Lava floods the pits, logs spin over a basalt bridge and rocks drift across a lava sea. Climb out of the crater!', time: 180 },
  frostbite: { name: 'Frostbite Peak', kind: 'race', icon: '🏔️', desc: 'Snowball cannons on sheer ice, zig-zag beams in a blizzard, spinning ice discs, and snowballs rolling down the peak.', time: 180 },
  factory: { name: 'Candy Factory', kind: 'race', icon: '🍭', desc: 'Backwards conveyors and punchers, spinning gears, a candy chute, crushing walls and flashing floor tiles.', time: 180 },
  skyislands: { name: 'Sky Islands', kind: 'race', icon: '☁️', desc: 'Trampolines over the clouds, a windy sky bridge, vanishing clouds, and hammers between floating islands.', time: 180 },
  clockwork: { name: 'Clockwork Tower', kind: 'race', icon: '⏰', desc: 'Clock hands sweep the islands, gates slam on a timer, pendulums guard a narrow alley, and bars drop up and down.', time: 180 },
  jungle: { name: 'Jungle River', kind: 'race', icon: '🌴', desc: 'Rolling logs, river stones, rope bridges with swinging logs, treadmill platforms and drifting rafts.', time: 180 },
  tiptoe: { name: 'Tip Toe', kind: 'race', icon: '🤫', desc: 'Only some tiles are safe, and fake ones drop as soon as you step on them. Remember the path!', time: 150 },
  blockdash: { name: 'Block Dash', kind: 'survival', icon: '🧱', desc: 'Walls of blocks sweep across the platform. Find the gap, jump the low ones, or get shoved off the end!', time: 75 },
  bombard: { name: 'Bombardment', kind: 'survival', icon: '💣', desc: 'Bombs rain down and blast holes in the floor. Watch the red circles and keep moving!', time: 75 },
  tiles: { name: 'Tile Drop', kind: 'survival', icon: '🟪', desc: 'Tiles drop after you step on them. Three floors, then the slime. Keep moving!', time: 75 },
  sweep: { name: 'Sweep Out', kind: 'survival', icon: '🧹', desc: 'Two giant arms that keep speeding up. Jump the low one, and don\'t jump into the high one!', time: 65 },
  bumpers: { name: 'Pinball Pit', kind: 'survival', icon: '🎱', desc: 'Giant bumpers sweep across the platform and a bar spins in the middle. Stay on!', time: 70 },
  dodge: { name: 'Dodge Dome', kind: 'survival', icon: '🛡️', desc: 'Walls sweep across the dome. Jump them or get swept off!', time: 70 },
  mountain: { name: 'Fall Mountain', kind: 'final', icon: '🏔️', desc: 'Race up the mountain past rolling balls, fans and trampolines, then climb to the crown!', time: 210, fixed: ['ballrun', 'fans', 'trampolines', 'turnstiles', 'summit'] },
  crown: { name: 'Crown Summit', kind: 'final', icon: '👑', desc: 'Fight through the course, climb the tower and grab the crown first!', time: 170 },
  last: { name: 'Bean Arena', kind: 'final', icon: '🏟️', desc: 'Last one standing on the spinning arena. The outer ring is falling away…', time: 100 },
};
// every obstacle section a race can draw from (each race = its 2 signature sections + 3 of these)
export const POOL = ['sweepers', 'hammers', 'spinners', 'gaps', 'discs', 'rising', 'punchers', 'conveyor', 'doors2', 'bouncers', 'blinkers', 'pushers', 'wallrush', 'turnstiles', 'zigzag', 'logroll', 'islands', 'ballrun', 'fans', 'iceslide', 'trampolines', 'gatecrash', 'spiketrail', 'axes', 'lavapools', 'updown', 'speedhammers', 'spinpads', 'cannons', 'clocks', 'swingers'];
export const RACES = ['ruins', 'volcano', 'frostbite', 'factory', 'skyislands', 'clockwork', 'jungle', 'tiptoe'], SURVIVALS = ['tiles', 'sweep', 'bumpers', 'dodge', 'blockdash', 'bombard'], FINALS = ['crown', 'last', 'mountain'];

// ---------------------------------------------------------------- match plan + qualifying spots
// opts: {rounds: '3'|'4', pool: 'all'|'races'|'survival', final: 'random'|'crown'|'last'}
export function planMatch(rng, opts, N) {
  const R = opts.rounds === '4' ? 4 : 3;
  if (N <= 1) return [FINALS.includes(opts.final) ? opts.final : 'crown'];          // a lone contestant: one short final, no marathon
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
// How many of the n players still in round k qualify. Every non-final round eliminates at least one player
// (however few are left); the final has exactly one winner.
export function quota(plan, k, n, N) {
  if (k >= plan.length - 1) return 1;
  if (n <= 1) return n;
  const left = plan.length - 1 - k;
  const F = Math.min(finalists(N), n - 1);
  return Math.max(1, Math.min(n - 1, Math.floor(n - (n - F) / left)));
}

// ---------------------------------------------------------------- building blocks
export const box = (x, y, z, hx, hy, hz, o = {}) => solid({ bx: x, by: y, bz: z, hx, hy, hz, ...o });
export const slab = (x, top, z, hx, hz, o = {}) => box(x, top - 0.5, z, hx, 0.5, hz, o);      // platform: top surface at `top`
export const cyl = (x, y, z, r, hy, o = {}) => solid({ shape: 'cyl', bx: x, by: y, bz: z, r, hy, ...o });
export const TAU = Math.PI * 2, HALF = 7;

export function builder(rng, kind) {
  const B = { rng, kind, solids: [], route: [], cps: [], dynN: 0, doors: [], minY: 0, maxY: 0, winds: [], fans: [], lavas: [], blasts: [], cannons: [], cur: 0 };
  B.add = (s) => { s.pal = B.cur; s.idx = B.solids.length; B.solids.push(s); B.minY = Math.min(B.minY, s.by - s.hy); B.maxY = Math.max(B.maxY, s.by + s.hy); return s; };
  B.node = (n) => { B.route.push({ w: 0, r: 1.3, ...n }); };
  B.dyn = () => B.dynN++;
  return B;
}

// ---- race modules: (B, z, y) -> {z, y} (z/y where the next pad starts)
export const MODS = {
  sweepers(B, z, y) {
    const L = 26, r = B.rng;
    B.add(slab(0, y, z + L / 2, HALF, L / 2, { look: 'floor' }));
    [z + 7.5, z + 18.5].forEach((zz, i) => {
      B.add(cyl(0, y + 0.8, zz, 0.75, 0.8, { look: 'post', noStand: true }));
      const w = r.range(1.5, 2.1) * (r() < 0.5 ? -1 : 1), ph = r.range(0, TAU);
      B.add(box(0, y + 0.5, zz, HALF - 0.2, 0.22, 0.22, { anim: { k: 'spin', w }, bry: ph, hit: 1.25, look: 'beam' }));
      B.add(box(0, y + (i === 1 ? 1.55 : 0.5), zz, HALF - 0.2, 0.22, 0.22, { anim: { k: 'spin', w }, bry: ph + Math.PI / 2, hit: 1.25, look: 'beam', high: i === 1 }));
    });
    B.node({ x: 0, y, z: z + 3, w: 5, side: 1.6 }); B.node({ x: 0, y, z: z + 13, w: 5, side: 1.6 }); B.node({ x: 0, y, z: z + L - 1.5, w: 4.5, side: 1.6 });
    return { z: z + L, y };
  },
  hammers(B, z, y) {
    const L = 24, r = B.rng, xs = [-4.6, 0, 4.6];
    for (const x of xs) {
      B.add(slab(x, y, z + L / 2, 1.0, L / 2, { look: 'bridge' }));
      for (const zz of [z + 6.5 + r.range(-1, 1), z + 16 + r.range(-1, 1)]) {
        B.add(box(x, y + 7.2, zz, 0.7, 0.7, 1.0, { anim: { k: 'pend', L: 5.75, amp: 0.68, w: r.range(2.0, 2.7), ph: r.range(0, TAU), d: [1, 0] }, hit: 1.35, look: 'hammer', noHang: true }));
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
    B.add(cyl(0, y + 1.0, z + 7, 0.75, 1.0, { look: 'post', noStand: true }));
    B.add(box(0, y + 0.5, z + 7, HALF - 0.2, 0.22, 0.22, { anim: { k: 'spin', w: w0 }, bry: p0, hit: 1.25, look: 'beam' }));
    B.add(box(0, y + 1.55, z + 7, HALF - 0.2, 0.22, 0.22, { anim: { k: 'spin', w: w0 }, bry: p0 + Math.PI / 2, hit: 1.25, look: 'beam', high: true }));
    for (const s of [-1, 1]) {
      const w = r.range(1.6, 2.1) * s, ph = r.range(0, TAU);
      B.add(cyl(s * 3.6, y + 0.8, z + 17, 0.5, 0.8, { look: 'post', noStand: true }));
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
      const s = B.add(slab(0, y, zz, 1.8, 1.6, { anim: { k: 'slide', v: [r.range(3.2, 4.4), 0, 0], w: r.range(1.0, 1.35), ph: r.range(0, TAU) }, look: 'mover' }));
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
      B.add(cyl(xs[i], y + 0.6, zz, 0.45, 0.6, { look: 'post', noStand: true, anim: { k: 'spin', w: 0 } }));
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
      const s = B.add(slab(r.range(-1.2, 1.2), top, zz, 2.7, 2.1, { anim: { k: 'slide', v: [0, 0.9, 0], w: r.range(0.9, 1.3), ph: r.range(0, TAU) }, look: 'lift' }));
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
      B.add(box(s * (HW + 1.1), y + 0.85, z + dz, 1.1, 0.85, 1.3, { anim: { k: 'piston', v: [-s * 5.0, 0, 0], f: r.range(0.35, 0.5), ph: r.range(0, 1) }, hit: 0.6, kmax: 8, look: 'piston', noHang: true }));
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
      if (i % 2 === 1) { const sd = lanes[fast] < 0 ? -1 : lanes[fast] > 0 ? 1 : (r() < 0.5 ? -1 : 1); B.add(box(sd * 6.6, y + 0.8, zz + r.range(-1, 1), 1.0, 0.8, 1.0, { anim: { k: 'piston', v: [-sd * 4.6, 0, 0], f: r.range(0.35, 0.5), ph: r.range(0, 1) }, hit: 0.6, kmax: 8, look: 'piston', noHang: true })); }
      B.node({ x: lanes[fast], y, z: zz, w: 0.8, r: 1.4 });
    }
    B.node({ x: 0, y, z: z + n * 6 + 1, w: 3 });
    return { z: z + n * 6, y };
  },
  // rolling logs sweep along the course: jump them
  logroll(B, z, y) {
    const r = B.rng, L = 26;
    B.add(slab(0, y, z + L / 2, HALF, L / 2, { look: 'floor' }));
    [6, 12, 18].forEach((dz, i) => B.add(box(0, y + 0.45, z + dz, HALF - 0.4, 0.45, 0.4, { anim: { k: 'slide', v: [0, 0, 3.6], w: r.range(1.9, 2.5) * (i % 2 ? -1 : 1), ph: r.range(0, TAU) }, hit: 0.65, look: 'log', noHang: true })));
    for (const dz of [2, 6, 12, 18, L - 1]) B.node({ x: 0, y, z: z + dz, w: 3, r: 1.4 });
    return { z: z + L, y };
  },
  // stepping-stone islands over the slime (static: pure jumping practice)
  islands(B, z, y) {
    const r = B.rng, n = 5, gap = 6.1;
    B.node({ x: 0, y, z: z - 0.9, w: 1.5 });
    for (let i = 0; i < n; i++) {
      const x = (i % 2 ? -1 : 1) * r.range(0.5, 1.5), zz = z + 3.4 + i * gap;
      const s = B.add(cyl(x, y - 0.4, zz, 2.3, 0.4, { look: 'disc' }));
      B.node({ sid: s.idx, leap: true, y, center: true });
    }
    const L = 3.4 + (n - 1) * gap + 2.3 + 1.6;
    B.node({ x: 0, y, z: z + L + 1.5, w: 2, leap: true });
    return { z: z + L, y };
  },
  // Lost Temple: rows of spike strips that pop up in a travelling wave
  spiketrail(B, z, y) {
    const r = B.rng, L = 27, HW = 6, rows = 5, P = r.range(2.2, 2.8);
    B.add(slab(0, y, z + L / 2, HW, L / 2, { look: 'temple' }));
    for (let k = 0; k < rows; k++) {
      const zz = z + 3.5 + k * 5, dir = r() < 0.5 ? 1 : -1;
      for (let i = 0; i < 6; i++) B.add(box(-HW + 1 + i * 2, y + 0.22, zz, 0.92, 0.22, 0.75, { spike: true, blink: { p: P, on: 0.45, ph: ((dir > 0 ? i : 5 - i) * 0.09 + k * 0.23) % 1 }, look: 'spike', noHang: true }));
      B.node({ x: 0, y, z: zz - 1.8, w: 4, r: 1.2, spikeRow: zz });
    }
    B.node({ x: 0, y, z: z + L - 1, w: 3 });
    return { z: z + L, y };
  },
  // Lost Temple: stepping stones over a chasm with axes swinging across each gap
  axes(B, z, y) {
    const r = B.rng, n = 4, gap = 5.4;
    B.node({ x: 0, y, z: z - 0.9, w: 1 });
    for (let i = 0; i < n; i++) {
      const zz = z + 2.6 + i * gap, x = (i % 2 ? -1 : 1) * r.range(0, 1.2);
      const s = B.add(slab(x, y, zz, 1.9, 1.6, { look: 'temple' }));
      B.node({ sid: s.idx, leap: true, y, center: true });
      B.add(box(x, y + 7.4, zz + gap / 2, 0.15, 0.9, 1.1, { anim: { k: 'pend', L: 6.2, amp: 0.85, w: r.range(1.45, 1.9), ph: r.range(0, TAU), d: [1, 0] }, hit: 1.3, look: 'axe', noHang: true }));
    }
    const L = 2.6 + (n - 1) * gap + 1.6 + 1.6;
    B.node({ x: 0, y, z: z + L + 1.5, w: 2, leap: true });
    return { z: z + L, y };
  },
  // Lost Temple: platforms with spikes popping up out of them, over the void
  spikeplats(B, z, y) {
    const r = B.rng, n = 4, gap = 6;
    B.node({ x: 0, y, z: z - 0.9, w: 1 });
    for (let i = 0; i < n; i++) {
      const zz = z + 3 + i * gap, s = B.add(slab(0, y, zz, 3.2, 2.2, { look: 'temple' })), ph = r.range(0, 1);
      for (const sx of [-2.15, 2.15]) B.add(box(sx, y + 0.22, zz, 1.0, 0.22, 2.0, { spike: true, blink: { p: 2.6, on: 0.5, ph: (ph + (sx > 0 ? 0.5 : 0)) % 1 }, look: 'spike', noHang: true }));   // a narrow safe strip down the middle
      B.node({ sid: s.idx, leap: true, y, center: true, spikePlat: true });
    }
    const L = 3 + (n - 1) * gap + 2.2 + 1.6;
    B.node({ x: 0, y, z: z + L + 1.5, w: 2, leap: true });
    return { z: z + L, y };
  },
  // Lava Rush: lava swells over the floor and drains; raised rocks stay dry
  lavapools(B, z, y) {
    const r = B.rng, L = 30, HW = HALF;
    B.add(slab(0, y - 1.2, z + L / 2, HW, L / 2, { look: 'basalt' }));         // the pit floor sits a step lower
    B.add(slab(0, y, z + 1.2, HW, 1.2, { look: 'basalt' }));
    B.add(slab(0, y, z + L - 1.2, HW, 1.2, { look: 'basalt' }));
    const p = r.range(4.2, 5.2), ph = r.range(0, 1);
    B.lavas.push({ x0: -HW, x1: HW, z0: z + 2.4, z1: z + L - 2.4, y0: y - 1.9, amp: 1.9, p, ph, floor: y - 1.2 });   // peaks just below the rocks
    B.node({ x: 0, y, z: z + 1.2, w: 3 });
    let side = r() < 0.5 ? 1 : -1;
    for (let k = 0; k < 4; k++) {
      side = -side;
      const zz = z + 6 + k * 5.6, x = side * r.range(1.2, 3.8);
      const rock = B.add(slab(x, y + 0.2, zz, 1.7, 1.5, { look: 'rock' }));
      B.node({ sid: rock.idx, y: y + 0.2, center: true, rock: B.lavas.length - 1 });
    }
    B.node({ x: 0, y, z: z + L - 1.2, w: 3, rock: B.lavas.length - 1, exitLava: true });
    return { z: z + L, y };
  },
  // Over & Under: bars slide up and down across the lane
  updown(B, z, y) {
    const r = B.rng, L = 26;
    B.add(slab(0, y, z + L / 2, HALF, L / 2, { look: 'floor' }));
    for (const dz of [5, 10.5, 16, 21.5]) B.add(box(0, y + 1.5, z + dz, HALF - 0.3, 0.3, 0.3, { anim: { k: 'slide', v: [0, 1.15, 0], w: r.range(1.6, 2.4), ph: r.range(0, TAU) }, hit: 0.8, kmax: 9, spike: true, look: 'bar', noHang: true }));
    for (const dz of [2, 7.5, 13, 18.5, L - 1]) B.node({ x: 0, y, z: z + dz, w: 4, r: 1.4 });
    return { z: z + L, y };
  },
  // Spin Go Round: speed pads into spinning hammers (arms spinning round posts at body height)
  speedhammers(B, z, y) {
    const r = B.rng, L = 28;
    B.add(slab(0, y, z + L / 2, HALF, L / 2, { look: 'floor' }));
    for (const x of [-4, 0, 4]) B.add(box(x, y - 0.06, z + 2.5, 1.3, 0.06, 1.3, { belt: [0, 11], look: 'speed' }));   // flush with the floor
    [[-3.5, 9], [3.5, 9], [0, 15.5], [-3.8, 22], [3.8, 22]].forEach(([x, dz]) => {
      const w = r.range(2.0, 2.8) * (r() < 0.5 ? 1 : -1), ph = r.range(0, TAU);
      B.add(cyl(x, y + 1.0, z + dz, 0.45, 1.0, { look: 'post', noStand: true }));
      B.add(box(x, y + 0.9, z + dz, 2.6, 0.42, 0.3, { anim: { k: 'spin', w }, bry: ph, hit: 1.1, kmax: 11, look: 'hammerbar', noHang: true }));
    });
    for (const dz of [4, 9, 12.5, 15.5, 19, 22, L - 1]) B.node({ x: 0, y, z: z + dz, w: 3.5, r: 1.4 });
    return { z: z + L, y };
  },
  // Spin Go Round: spinning pads with a spinning trap on each
  spinpads(B, z, y) {
    const r = B.rng, n = 3;
    B.node({ x: 0, y, z: z - 0.9, w: 1.5 });
    for (let i = 0; i < n; i++) {
      const zz = z + 4.2 + i * 8, x = (i % 2 ? -1 : 1) * r.range(0.5, 1.8), w = r.range(0.7, 1.1) * (i % 2 ? -1 : 1);
      const s = B.add(cyl(x, y - 0.4, zz, 3.8, 0.4, { anim: { k: 'spin', w }, look: 'disc' }));
      B.add(cyl(x, y + 0.6, zz, 0.45, 0.6, { look: 'post', noStand: true, anim: { k: 'spin', w: 0 } }));
      B.add(box(x, y + 0.45, zz, 3.4, 0.2, 0.2, { anim: { k: 'spin', w: -w * 1.6 }, bry: r.range(0, TAU), hit: 0.9, look: 'beam' }));
      B.node({ x, y, z: zz, sid: s.idx, leap: true, r: 1.6, center: true });
    }
    const L = 4.2 + (n - 1) * 8 + 3.6 + 1.2;
    B.node({ x: 0, y, z: z + L + 1.5, w: 2, leap: true });
    return { z: z + L, y };
  },
  // Spin Go Round finale: a giant spinning trap on a round platform, then one moving platform to the end
  bigspin(B, z, y) {
    const r = B.rng, R = 7.5, cz = z + R + 0.3;
    const d = B.add(cyl(0, y - 0.5, cz, R, 0.5, { look: 'arena' }));
    B.node({ x: 0, y, z: z + 1, w: 2 });
    const w = r.range(1.1, 1.4) * (r() < 0.5 ? 1 : -1), ph = r.range(0, TAU);
    B.add(cyl(0, y + 1, cz, 0.8, 1, { look: 'post', noStand: true }));
    for (let k = 0; k < 3; k++) B.add(box(0, y + 0.5, cz, 3.4, 0.24, 0.26, { ox: 3.9, anim: { k: 'spin', w }, bry: ph + k * TAU / 3, hit: 1.2, look: 'beam' }));
    B.node({ x: r() < 0.5 ? -4.5 : 4.5, y, z: cz, r: 1.5 });
    B.node({ x: 0, y, z: cz + R - 1.2, w: 2, r: 1.3 });
    const mz = cz + R + 3.4;
    const m = B.add(slab(0, y, mz, 1.8, 1.6, { anim: { k: 'slide', v: [4.5, 0, 0], w: r.range(1.0, 1.3), ph: r.range(0, TAU) }, look: 'mover' }));
    B.node({ sid: m.idx, leap: true, y });
    const L = mz + 1.6 + 1.6 - z;
    B.node({ x: 0, y, z: z + L + 1.5, w: 2, leap: true });
    return { z: z + L, y };
  },
  // Icy Heights: snowball cannons fire across an icy lane
  cannons(B, z, y) {
    const r = B.rng, L = 28, HW = 6.5, R = 1.0, spd = 8.5;
    B.add(slab(0, y, z + L / 2, HW, L / 2, { look: 'ice', ice: true }));
    [6, 13.5, 21].forEach((dz, i) => {
      const side = i % 2 ? 1 : -1, path = HW * 2 + 6, P = path / spd + r.range(0.8, 1.6);
      B.add(cyl(side * (HW + 3), y + R, z + dz, R, R, { anim: { k: 'roll', v: [-side * spd, 0, 0], P, ph: r.range(0, 1) }, hit: 1.5, kmax: 12, look: 'snowball', noHang: true }));
      B.cannons.push({ x: side * (HW + 3.2), y: y + 1.0, z: z + dz, dir: -side });
    });
    for (const dz of [3, 9.5, 17, 24, L - 1]) B.node({ x: 0, y, z: z + dz, w: 3, r: 1.5 });
    return { z: z + L, y };
  },
  // Humble Stumble: round islands with a clock-hand beam sweeping each
  clocks(B, z, y) {
    const r = B.rng, n = 3, gap = 8.2;
    B.node({ x: 0, y, z: z - 0.9, w: 1.5 });
    for (let i = 0; i < n; i++) {
      const zz = z + 3.9 + i * gap, x = (i % 2 ? -1 : 1) * r.range(0, 1.5);
      const s = B.add(cyl(x, y - 0.5, zz, 3.7, 0.5, { look: 'clock' }));
      B.add(cyl(x, y + 0.5, zz, 0.4, 0.5, { look: 'post', noStand: true }));
      B.add(box(x, y + 0.45, zz, 1.75, 0.2, 0.2, { ox: 1.85, anim: { k: 'spin', w: r.range(1.2, 1.6) * (i % 2 ? 1 : -1) }, bry: r.range(0, TAU), hit: 0.9, look: 'beam' }));
      if (i === n - 1) B.add(box(x, y + 1.55, zz, 1.4, 0.2, 0.2, { ox: 1.5, anim: { k: 'spin', w: r.range(0.6, 0.9) * (i % 2 ? -1 : 1) }, bry: r.range(0, TAU), hit: 0.9, look: 'beam', high: true }));
      B.node({ x, y, z: zz, sid: s.idx, leap: true, r: 1.6, center: true });
    }
    const L = 3.9 + (n - 1) * gap + 3.7 + 1.4;
    B.node({ x: 0, y, z: z + L + 1.5, w: 2, leap: true });
    return { z: z + L, y };
  },
  // Humble Stumble: treadmills pushing you back while giant platforms swing across
  swingers(B, z, y) {
    const r = B.rng, L = 28;
    for (const [x, hw, belt] of [[-4.6, 2.4, 0], [0, 2.2, -3.4], [4.6, 2.4, 0]]) B.add(slab(x, y, z + L / 2, hw, L / 2, belt ? { belt: [0, belt], look: 'belt' } : { look: 'floor' }));
    [6, 13, 20].forEach((dz, i) => B.add(box(0, y + 1.1, z + dz, 3.0, 1.1, 1.5, { anim: { k: 'slide', v: [5.2 * (i % 2 ? 1 : -1), 0, 0], w: r.range(1.0, 1.4), ph: r.range(0, TAU) }, hit: 0.75, kmax: 10, look: 'swingblock', noHang: true })));
    for (const dz of [2, 6, 9.5, 13, 16.5, 20, L - 1]) B.node({ x: 0, y, z: z + dz, w: 4.5, r: 1.4 });
    return { z: z + L, y };
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
        B.add(cyl(x, y + 1.0, z + dz, 0.35, 1.0, { look: 'post', noStand: true }));
        for (const a of [0, Math.PI / 2]) B.add(box(x, y + 0.9, z + dz, 3.1, 0.75, 0.16, { anim: { k: 'spin', w }, bry: ph + a, hit: 0.55, kmax: 9, look: 'gate', noHang: true }));
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
  // giant balls roll down the lane toward you (Fruit Chute / Fall Mountain): weave between them or jump the gaps
  ballrun(B, z, y) {
    const r = B.rng, L = 32, R = 1.2, spd = 7.6, path = L + 18, P = path / spd;
    B.add(slab(0, y, z + L / 2, HALF, L / 2, { look: 'floor' }));
    const xs = r.shuffle([-4.4, 0, 4.4]);
    xs.forEach((x, i) => B.add(cyl(x + r.range(-0.9, 0.9), y + R, z + L + 9, R, R, { anim: { k: 'roll', v: [0, 0, -spd], P, ph: i / 3 + r.range(0, 0.12) }, hit: 1.5, look: 'ball', noHang: true })));
    for (const dz of [11, 22]) B.add(cyl(r.range(-4.5, 4.5), y + 1, z + dz, 0.6, 1, { look: 'post', noStand: true }));
    for (const dz of [3, 9, 15, 21, 27, L - 1]) B.node({ x: 0, y, z: z + dz, w: 4, r: 1.5 });
    return { z: z + L, y };
  },
  // narrow bridge with big fans blasting gusts across it
  fans(B, z, y) {
    const r = B.rng, L = 32, HW = 2.9;
    B.add(slab(0, y, z + L / 2, HW, L / 2, { look: 'bridge' }));
    let flip = r() < 0.5 ? 1 : -1;
    for (let i = 0; i < 3; i++) {
      const z0 = z + 3 + i * 9.5, ph = r.range(0, 1); flip = -flip;
      B.winds.push({ x0: -HW - 1.5, x1: HW + 1.5, z0, z1: z0 + 8.5, y0: y - 1.5, y1: y + 6, fx: flip * 4.9, fz: 0, p: 3.6, on: 0.55, ph });
      B.fans.push({ x: -flip * (HW + 1.8), y: y + 1.5, z: z0 + 4.2, dir: flip, p: 3.6, on: 0.58, ph });
    }
    for (const dz of [2, 6, 11, 15, 20, 24, L - 1]) B.node({ x: 0, y, z: z + dz, w: 0.3, r: 0.9 });
    return { z: z + L, y };
  },
  // slippery ice with posts to slalom around
  iceslide(B, z, y) {
    const r = B.rng, L = 30;
    B.add(slab(0, y, z + L / 2, HALF, L / 2, { look: 'ice', ice: true }));
    let sx = r() < 0.5 ? 1 : -1;
    [6, 12, 18, 24].forEach((dz) => { sx = -sx; const px = sx * r.range(1.2, 3.4); B.add(cyl(px, y + 1, z + dz, 0.7, 1, { look: 'post', noStand: true })); B.node({ x: -sx * 3.0, y, z: z + dz - 1, w: 0.5, r: 1.3 }); B.node({ x: -sx * 3.0, y, z: z + dz + 1.4, w: 0.5, r: 1.3 }); });
    B.node({ x: 0, y, z: z + L - 1, w: 2, r: 1.5 });
    return { z: z + L, y };
  },
  // a field of trampolines over the slime: bounce from pad to pad
  trampolines(B, z, y) {
    const r = B.rng, n = 4, gap = 6.3, ids = [];
    B.node({ x: 0, y, z: z - 0.9, w: 1.5 });
    for (let i = 0; i < n; i++) {
      const x = (i % 2 ? -1 : 1) * r.range(0.8, 2.2), zz = z + 2.6 + i * gap;
      const p = B.add(box(x, y - 0.3, zz, 2.2, 0.3, 2.2, { bounce: 14.2, look: 'pad' }));
      B.node({ padAlts: [p.idx], y, z: zz, r: 1.2 });
    }
    const L = 2.6 + (n - 1) * gap + 2.2 + 2.2;
    B.node({ x: 0, y, z: z + L + 1.8, w: 2, leap: true });
    return { z: z + L, y };
  },
  // rows of swinging gates that open and slam shut: get through an open one
  gatecrash(B, z, y) {
    const r = B.rng, rows = 3, L = rows * 8.5 + 3, HW = 7.25;
    B.add(slab(0, y, z + L / 2, HW, L / 2, { look: 'floor' }));
    for (const s of [-1, 1]) B.add(box(s * (HW + 0.3), y + 0.7, z + L / 2, 0.3, 0.7, L / 2, { look: 'rail', noHang: true }));
    for (let k = 0; k < rows; k++) {
      const zz = z + 5.5 + k * 8.5, ids = [], p = r.range(3.0, 3.8);
      for (let i = 0; i < 5; i++) { const x = -HW + 1.45 + i * 2.9; ids.push(B.add(box(x, y + 1.7, zz, 1.4, 1.7, 0.3, { blink: { p, on: 0.58, ph: r.range(0, 1) }, look: 'swing', noHang: true })).idx); }
      B.node({ gates: ids, y, z: zz });
    }
    B.node({ x: 0, y, z: z + L - 0.8, w: 3 });
    return { z: z + L, y };
  },
  // Fall Mountain style summit: four wide terraces to jump up, giant balls rolling down from the top through all of
  // it, spinning bars on the middle terraces, and the crown floating above the plateau (jump to grab it)
  summit(B, z, y) {
    const r = B.rng, T = 4, rise = 1.5, depth = 7, W2 = HALF + 0.5;
    B.node({ x: 0, y, z: z - 0.8, w: 4 });
    let zz = z;
    for (let k = 1; k <= T; k++) {
      const top = y + rise * k;
      B.add(box(0, (y + top) / 2 - 0.5, zz + depth / 2, W2, (top - y) / 2 + 0.5, depth / 2, { look: 'terrace', step: k }));
      if (k === 2 || k === 3) {
        const w = r.range(1.3, 1.8) * (k % 2 ? 1 : -1), ph = r.range(0, TAU);
        B.add(cyl(0, top + 0.8, zz + depth / 2, 0.6, 0.8, { look: 'post', noStand: true }));
        B.add(box(0, top + 0.5, zz + depth / 2, W2 - 0.4, 0.22, 0.22, { anim: { k: 'spin', w }, bry: ph, hit: 1.2, look: 'beam' }));
      }
      B.node({ x: 0, y: top, z: zz + 1.6, w: 4.5, r: 1.6 });
      B.node({ x: 0, y: top, z: zz + depth - 1.0, w: 4.5, r: 1.6 });
      zz += depth;
    }
    const topY = y + rise * T, plat = 7;
    B.add(slab(0, topY, zz + plat, W2, plat, { look: 'summit2' }));
    B.add(box(0, topY + 0.5, zz + plat, 11, 0.22, 0.24, { anim: { k: 'spin', w: 0.9 * (r() < 0.5 ? 1 : -1) }, bry: r.range(0, TAU), hit: 1.0, look: 'beam' }));
    B.add(cyl(0, topY + 0.6, zz + plat, 1.2, 0.6, { look: 'post', noStand: true }));
    // giant balls roll from the back of the plateau all the way down the terraces
    const slope = rise * T / (T * depth), spd = 7.2, path = T * depth + plat * 2 + 10, P = path / spd;
    for (let i = 0; i < 4; i++) {
      const x = (i % 2 ? -1 : 1) * r.range(1.5, 5.5);
      B.add(cyl(x, topY + 1.2, zz + plat * 2 + 2, 1.25, 1.25, { anim: { k: 'roll', v: [0, -spd * slope * (T * depth) / path, -spd], P, ph: i / 4 + r.range(0, 0.08) }, hit: 1.4, kmax: 11, look: 'ball', noHang: true }));
    }
    B.crown = { x: 0, y: topY + 2.4, z: zz + plat - 2.2 };
    B.node({ x: 0, y: topY, z: zz + 2, w: 3 });
    B.node({ crown: true, x: 0, y: topY, z: B.crown.z, r: 0.6 });
    return { z: zz + plat * 2, y: topY, end: true };
  },
  // spiral staircase around a column (kept for reference; finals now use the summit) (walkable, no jumping needed), a spinning arm sweeping the stairs, crown on top
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
      const isCp = i % 2 === 0 || i === mods.length - 1;     // a checkpoint every second section: falls cost more
      B.add(slab(0, y, z + 2.5, 7.5, 2.5, { look: isCp ? 'cp' : 'floor' }));
      if (isCp) B.cps.push({ x: 0, y, z: z + 2.5 });
      B.node({ x: 0, y, z: z + 2.5, w: 3 });
      z += 5;
    }
    B.cur = i;
    const z0 = z;
    ({ z, y } = MODS[m](B, z, y));
    (B.sections ||= []).push({ m, z0, z1: z });
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
  B.add(cyl(0, 1.2, 0, 1.0, 1.2, { look: 'post', noStand: true, noHang: true }));
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
  // spinning core + two rings of floor that drop away (outer ring first), two crossing sweepers that speed up,
  // and two hammers swinging across the middle
  B.add(cyl(0, -0.5, 0, 4.4, 0.5, { anim: { k: 'spin', w: 0.5 }, look: 'disc' }));
  const inner = rng.shuffle([...Array(10).keys()]), outer = rng.shuffle([...Array(12).keys()]);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; B.add(box(Math.sin(a) * 6.3, -0.5, Math.cos(a) * 6.3, 2.0, 0.5, 1.9, { bry: a, until: 40 + inner.indexOf(i) * 2.6, look: 'ring' })); }
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + 0.26; B.add(box(Math.sin(a) * 10.1, -0.5, Math.cos(a) * 10.1, 2.6, 0.5, 1.85, { bry: a, until: 12 + outer.indexOf(i) * 1.9, look: 'ring' })); }
  const d = rng() < 0.5 ? 1 : -1, ph = rng.range(0, TAU);
  B.add(box(0, 0.5, 0, 12, 0.24, 0.26, { anim: { k: 'spin', w: 0.85 * d, acc: 0.03 * d }, bry: ph, hit: 0.9, look: 'beam' }));
  B.add(box(0, 0.5, 0, 12, 0.24, 0.26, { anim: { k: 'spin', w: -0.6 * d, acc: -0.022 * d }, bry: ph + Math.PI / 2, hit: 0.9, look: 'beam' }));
  B.add(cyl(0, 1.0, 0, 0.7, 1.0, { look: 'post', noStand: true, anim: { k: 'spin', w: 0 } }));
  B.add(box(0, 6.6, 0, 0.75, 0.75, 1.0, { anim: { k: 'pend', L: 5.8, amp: 1.05, w: 1.35, ph: rng.range(0, TAU), d: [1, 0] }, hit: 1.4, look: 'hammer', noHang: true }));
  B.add(box(0, 6.6, 0, 0.75, 0.75, 1.0, { anim: { k: 'pend', L: 5.8, amp: 1.05, w: 1.1, ph: rng.range(0, TAU), d: [0, 1] }, bry: Math.PI / 2, hit: 1.4, look: 'hammer', noHang: true }));
  B.spawns = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; B.spawns.push({ x: Math.sin(a) * 6.3, z: Math.cos(a) * 6.3, face: a + Math.PI }); }
  B.arenaR = 11.5; B.len = 0;
  return B;
}

function buildBumpers(rng) {
  const B = builder(rng, 'survival');
  B.add(cyl(0, -0.5, 0, 11, 0.5, { look: 'arena' }));
  const d = rng() < 0.5 ? 1 : -1, ph = rng.range(0, TAU);
  for (let i = 0; i < 4; i++) {
    const a = ph + i * Math.PI / 2, tx = Math.cos(a), tz = -Math.sin(a);
    B.add(box(Math.sin(a) * 3.4, 0.9, Math.cos(a) * 3.4, 1.5, 0.9, 1.1, { bry: a, anim: { k: 'slide', v: [tx * 6.5, 0, tz * 6.5], w: rng.range(0.9, 1.35), ph: rng.range(0, TAU) }, hit: 0.9, look: 'pusher', noHang: true }));
  }
  B.add(cyl(0, 1.0, 0, 0.8, 1.0, { look: 'post', noStand: true }));
  B.add(box(0, 0.5, 0, 6.5, 0.22, 0.24, { anim: { k: 'spin', w: 0.8 * d, acc: 0.02 * d }, bry: ph, hit: 0.9, look: 'beam' }));
  B.spawns = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.4; B.spawns.push({ x: Math.sin(a) * 8, z: Math.cos(a) * 8, face: a + Math.PI }); }
  B.arenaR = 11; B.len = 0;
  return B;
}
function buildDodge(rng) {
  const B = builder(rng, 'survival');
  B.add(cyl(0, -0.5, 0, 11.5, 0.5, { look: 'arena' }));
  [-6, -1.5, 3, 7.5].forEach((zz, i) => {
    const s = i % 2 ? -1 : 1;
    B.add(box(0, 0.55, zz, 4, 0.55, 0.35, { anim: { k: 'slide', v: [s * 11.5, 0, 0], w: rng.range(0.85, 1.25), ph: rng.range(0, TAU), }, hit: 0.65, look: 'rushwall', noHang: true }));
  });
  B.spawns = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; B.spawns.push({ x: Math.sin(a) * 7.5, z: Math.cos(a) * 7.5, face: a + Math.PI }); }
  B.arenaR = 11.5; B.len = 0;
  return B;
}

// Tip Toe: a grid of tiles with one hidden safe path; every other tile drops almost as soon as you step on it
function buildTiptoe(rng) {
  const B = builder(rng, 'race');
  B.add(slab(0, 0, -1.5, 9, 7.5, { look: 'start' }));
  B.spawns = [];
  for (let i = 0; i < 8; i++) B.spawns.push({ x: -5.25 + (i % 4) * 3.5, z: -5 + Math.floor(i / 4) * 3, face: 0 });
  rng.shuffle(B.spawns);
  B.node({ x: 0, y: 0, z: 4.5, w: 3 });
  const cols = 6, rows = 24, sx = 2.4, z0 = 7.6, xOf = (c) => (c - (cols - 1) / 2) * sx;
  const path = []; let c = rng.int(1, 4);
  for (let r = 0; r < rows; r++) {
    const c2 = Math.max(0, Math.min(cols - 1, c + rng.int(-2, 2)));
    for (let k = c; k !== c2; k += Math.sign(c2 - c)) path.push([r, k]);
    path.push([r, c2]); c = c2;
  }
  const safe = new Set(path.map(([r, k]) => r * 10 + k)), tileIdx = new Map();
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const t = B.add(slab(xOf(k), 0, z0 + r * sx, 1.12, 1.12, { tile: B.dyn(), safe: safe.has(r * 10 + k), look: 'sqtile', checker: (r + k) % 2 }));
    tileIdx.set(r * 10 + k, t.idx);
  }
  const seen = new Set();
  for (const [r, k] of path) { const key = r * 10 + k; if (seen.has(key)) continue; seen.add(key); B.node({ sid: tileIdx.get(key), y: 0, center: true, tip: [r, k] }); }
  B.tipIdx = tileIdx; B.tipCols = cols; B.tipRows = rows;
  const zEnd = z0 + rows * sx;
  B.add(slab(0, 0, zEnd + 6.5, 9, 6, { look: 'finish' }));
  B.finishZ = zEnd + 2.4; B.finishY = 0;
  B.node({ x: 0, y: 0, z: zEnd + 6, w: 4 });
  B.len = zEnd + 12; B.hasTiles = true; B.tileFall = 0.4;
  return B;
}

// Block Dash: walls of blocks sweep down the platform in waves; get shoved off the end and you're out
function buildBlockDash(rng) {
  const B = builder(rng, 'survival');
  const HW = 7, L = 22, cz = 0;
  B.add(slab(0, 0, cz, HW, L / 2, { look: 'dashfloor' }));
  const z0 = cz + L / 2 + 6, z1 = cz - L / 2 - 6, travel = z0 - z1;
  let t = 2.5, wave = 0;
  const cell = 2, cols = 7;
  while (t < 76) {
    const spd = Math.min(9.5, 5 + wave * 0.18), kind = rng.int(0, 4), dur = travel / spd;
    const add = (c, w, h, y0 = 0, dzOff = 0) => B.add(box(-HW + (c + w / 2) * cell, y0 + h / 2, z0 + dzOff, w * cell / 2 - 0.04, h / 2, 0.75, { anim: { k: 'wave', v: [0, 0, -spd], t0: t, t1: t + dur }, look: 'dashblock', noHang: true, wave }));
    if (kind === 0) { const gap = rng.int(0, cols - 1); for (let c = 0; c < cols; c++) if (c !== gap) add(c, 1, 3.2); }              // wall with one gap
    else if (kind === 1) { const g = rng.shuffle([...Array(cols).keys()]).slice(0, 2); for (let c = 0; c < cols; c++) if (!g.includes(c)) add(c, 1, 3.2); }   // two gaps
    else if (kind === 2) { for (let c = 0; c < cols; c++) add(c, 1, 0.75); }                                                      // low wall: jump it
    else if (kind === 3) { const gap = rng.int(1, cols - 2); for (let c = 0; c < cols; c++) if (Math.abs(c - gap) > 0) add(c, 1, c % 2 ? 0.75 : 3.2); }  // mixed high / low
    else { const g1 = rng.int(0, cols - 1); for (let c = 0; c < cols; c++) if (c !== g1) add(c, 1, 3.2); const g2 = rng.int(0, cols - 1); for (let c = 0; c < cols; c++) if (c !== g2) add(c, 1, 3.2, 0, 4.5); }  // double wall (maze)
    t += Math.max(2.1, 3.6 - wave * 0.07); wave++;
  }
  B.spawns = [];
  for (let i = 0; i < 8; i++) B.spawns.push({ x: -5.25 + (i % 4) * 3.5, z: -3 + Math.floor(i / 4) * 4, face: Math.PI });
  B.arenaR = 8; B.len = 0; B.dash = { HW, L, cz };
  return B;
}
// Bombardment: bombs land on a hex floor, knock everyone near them flying and blow holes in the floor
function buildBombard(rng) {
  const B = builder(rng, 'survival');
  const step = 2.05, rad = 5, tiles = [];
  for (let q = -rad; q <= rad; q++) for (let rr = -rad; rr <= rad; rr++) {
    if (Math.abs(q + rr) > rad) continue;
    tiles.push({ x: step * (q + rr / 2), z: step * rr * Math.sqrt(3) / 2 });
  }
  let t = 3;
  while (t < 76) {
    const n = 1 + Math.floor(t / 20);
    for (let k = 0; k < n; k++) { const T = tiles[rng.int(0, tiles.length - 1)]; B.blasts.push({ t: t + rng.range(0, 0.7), x: T.x + rng.range(-0.6, 0.6), z: T.z + rng.range(-0.6, 0.6), y: 0, r: 3.0 }); }
    t += Math.max(0.75, 1.9 - t * 0.016);
  }
  B.blasts.sort((a, b) => a.t - b.t);
  for (const T of tiles) {
    const hit = B.blasts.find((b) => Math.hypot(b.x - T.x, b.z - T.z) < 1.35);
    B.add(cyl(T.x, -0.3, T.z, 1.02, 0.3, { look: 'btile', until: hit ? hit.t + 0.05 : 0 }));
  }
  B.spawns = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; B.spawns.push({ x: Math.sin(a) * 6.5, z: Math.cos(a) * 6.5, face: a + Math.PI }); }
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
  else if (id === 'bumpers') B = buildBumpers(rng);
  else if (id === 'dodge') B = buildDodge(rng);
  else if (id === 'tiptoe') B = buildTiptoe(rng);
  else if (id === 'blockdash') B = buildBlockDash(rng);
  else if (id === 'bombard') B = buildBombard(rng);
  else if (mods) B = buildRace(rng, id, mods);
  else if (MAPS[id]) B = buildMap(id, rng);
  else if (id === 'crown') B = buildMap('crownclimb', rng);
  else if (id === 'mountain') B = buildMap('fallmountain', rng);
  else if (meta.fixed) B = buildRace(rng, id, meta.fixed);
  else if (id === 'crown') B = buildRace(rng, id, [...pickMods(rng, [rng() < 0.5 ? 'sweepers' : 'hammers'], 3), 'summit']);
  else B = buildRace(rng, id, pickMods(rng, meta.mods, 4));
  const solids = B.solids;
  return {
    id, meta, mode: (id === 'crown' || id === 'mountain') ? 'crown' : id === 'last' ? 'last' : meta.kind === 'race' ? 'race' : 'survive',
    solids, moving: solids.filter((s) => s.anim), route: B.route, cps: B.cps, spawns: B.spawns, doors: B.doors, layers: B.layers,
    dynN: B.dynN, killY: (id === 'tiles' ? -10 : Math.min(B.minY, 0)) - 6, dash: B.dash, finishZ: B.finishZ, finishY: B.finishY, crown: B.crown, arenaR: B.arenaR, len: B.len, maxY: B.maxY, winds: B.winds, fans: B.fans, lavas: B.lavas, blasts: B.blasts, cannons: B.cannons, sections: B.sections || [], spikes: B.solids.filter((q) => q.spike && q.blink).map((q) => q.idx), hasTiles: !!B.hasTiles, tileFall: B.tileFall,
  };
}
// world object for a stage (one per simulation: host, client prediction)
export function makeWorld(st) { return { solids: st.solids, moving: st.moving, dyn: new Uint8Array(st.dynN), t: 0, killY: st.killY, winds: st.winds, lavas: st.lavas, blasts: st.blasts }; }
// where a player (index i among this round's players) starts
export function spawnOf(st, i) { const s = st.spawns[i % st.spawns.length]; const k = Math.floor(i / st.spawns.length); return { x: s.x + k * 0.6, y: 0.05, z: s.z, face: s.face }; }
export function respawnOf(st, cp, i) {
  if (cp <= 0 || !st.cps[cp - 1]) { const s = spawnOf(st, i); return { ...s, y: 0.6 }; }
  const c = st.cps[cp - 1], sp = Math.min(1.8, Math.max(0, ((c.hx ?? 7.5) - 0.7) / 2));
  return { x: c.x + ((i % 5) - 2) * sp, y: c.y + 0.6, z: c.z - 0.5 + Math.floor(i / 5) * Math.min(1.2, (c.hz ?? 2.5) * 0.4), face: 0 };
}
// race progress (bigger = further) used for standings / timeouts
export function progressOf(st, p) {
  if (st.mode === 'crown') return p.y * 4 + p.z;
  if (st.mode === 'race') return p.z + (p.cp || 0) * 0.01;
  return 0;
}
