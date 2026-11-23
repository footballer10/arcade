// Hand-built race maps. Each is one designed course with its own theme and layout (paths that narrow, split,
// zig-zag and climb), not a chain of generic sections. Hazards overlap so there is no free lane: you have to time
// your runs and jumps. Only two checkpoints per map, so a fall costs real time. The seeded rng only varies timing
// (spin speeds, phases, which doors are real), never the shape, so every client builds the same map.
import { box, slab, cyl, builder, TAU, MODS } from './stages.js';

// ---------------------------------------------------------------- building helpers
function start(B) {
  B.add(slab(0, 0, -1.5, 9, 7.5, { look: 'start' }));
  B.spawns = [];
  for (let i = 0; i < 8; i++) B.spawns.push({ x: -5.25 + (i % 4) * 3.5, z: -5 + Math.floor(i / 4) * 3, face: 0 });
  B.rng.shuffle(B.spawns);
  B.node({ x: 0, y: 0, z: 4.5, w: 3 });
}
function cp(B, x, top, z, hx, hz) {
  B.add(slab(x, top, z, hx, hz, { look: 'cp' }));
  B.cps.push({ x, y: top, z, hx, hz });
  B.node({ x, y: top, z, w: Math.max(0, hx - 1.5) });
}
function finish(B, x, top, z) {
  B.add(slab(x, top, z + 6, 8, 6, { look: 'finish' }));
  B.finishZ = z + 1.6; B.finishY = top;
  B.node({ x, y: top, z: z + 6, w: 4 });
  B.len = z + 12;
}
const plat = (B, x, top, z, hx, hz, look = 'floor', o = {}) => B.add(slab(x, top, z, hx, hz, { look, ...o }));
// an extra checkpoint on a platform that is already there (no new geometry, bot route unchanged): an arch over it
// where you trigger it, respawns just past the arch
function mark(B, s, z, hz = 0.6) {
  const top = s.y + s.hy;
  s.cpArch = z - 2.2 - s.z;
  B.cps.push({ x: s.x, y: top, z, hx: s.hx, hz });
  return s;
}
// a straight walkway between two points (any direction)
function walk(B, x0, z0, x1, z1, top, hw, look = 'beamwalk', o = {}) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  return B.add(slab((x0 + x1) / 2, top, (z0 + z1) / 2, hw, len / 2 + 0.4, { bry: Math.atan2(dx, dz), look, ...o }));
}
// a bar spinning around a point (low = jump it; h > 1.5 = it passes over you, jumping into it hurts)
function sweeper(B, x, top, z, half, w, o = {}) {
  if (o.post) B.add(cyl(x, top + 0.8, z, 0.55, 0.8, { look: 'post', noStand: true }));
  const h = o.h ?? 0.5;
  return B.add(box(x, top + h, z, half, 0.22, 0.22, { ox: o.ox || 0, anim: { k: 'spin', w, acc: o.acc || 0 }, bry: o.ph ?? B.rng.range(0, TAU), hit: o.hit ?? 1.25, look: 'beam', high: h > 1.2 }));
}
// a pendulum swinging across dir ([1,0] = across x, [0,1] = along the path)
function hammer(B, x, top, z, o = {}) {
  const d = o.dir || [1, 0], axe = o.look === 'axe', L = o.L ?? 5.75;
  return B.add(box(x, top + L + 1.45, z, axe ? 0.15 : 0.7, axe ? 0.9 : 0.7, axe ? 1.1 : 1.0,
    { anim: { k: 'pend', L, amp: o.amp ?? 0.75, w: o.w ?? B.rng.range(1.9, 2.4), ph: o.ph ?? B.rng.range(0, TAU), d }, bry: Math.atan2(-d[1], d[0]), hit: 1.35, look: o.look || 'hammer', noHang: true }));
}
const mover = (B, x, top, z, hx, hz, v, w, look = 'mover') => B.add(slab(x, top, z, hx, hz, { anim: { k: 'slide', v, w, ph: B.rng.range(0, TAU) }, look }));
const spinDisc = (B, x, top, z, r, w, look = 'disc', o = {}) => B.add(cyl(x, top - 0.4, z, r, 0.4, { anim: { k: 'spin', w }, look, ...o }));
const spikes = (B, x, top, z, hx, hz, p, on, ph) => B.add(box(x, top + 0.22, z, hx, 0.22, hz, { spike: true, blink: { p, on, ph: ((ph % 1) + 1) % 1 }, look: 'spike', noHang: true }));
const piston = (B, side, edge, top, z, reach, f) => B.add(box(side * (edge + 1.1), top + 0.85, z, 1.1, 0.85, 1.3, { anim: { k: 'piston', v: [-side * reach, 0, 0], f, ph: B.rng.range(0, 1) }, hit: 0.6, kmax: 8.5, look: 'piston', noHang: true }));
const pusher = (B, x, top, z, amp, w, hx = 1.6) => B.add(box(x, top + 0.9, z, hx, 0.9, 1.1, { anim: { k: 'slide', v: [amp, 0, 0], w, ph: B.rng.range(0, TAU) }, hit: 0.75, kmax: 10, look: 'pusher', noHang: true }));
const bar = (B, x, top, z, half, w) => B.add(box(x, top + 1.5, z, half, 0.3, 0.3, { anim: { k: 'slide', v: [0, 1.15, 0], w, ph: B.rng.range(0, TAU) }, hit: 0.8, kmax: 9, spike: true, look: 'bar', noHang: true }));
const pad = (B, x, top, z, s, bounce = 14.5) => B.add(box(x, top - 0.3, z, s, 0.3, s, { bounce, look: 'pad' }));
const blinker = (B, x, top, z, hx, hz, p, on, ph) => B.add(slab(x, top, z, hx, hz, { blink: { p, on, ph: ((ph % 1) + 1) % 1 }, look: 'blink' }));
const belt = (B, x, top, z, hx, hz, vz) => B.add(slab(x, top, z, hx, hz, { belt: [0, vz], look: 'belt' }));
function balls(B, xs, top, zTop, zBot, spd, r, o = {}) {
  const path = zTop - zBot, P = path / spd, drop = o.drop ?? 0;   // one chute length per cycle, so a ball never rolls past zBot; drop: how far the slope falls
  xs.forEach((x, i) => B.add(cyl(x, top + r + drop, zTop, r, r, { anim: { k: 'roll', v: [0, -drop * spd / path, -spd], P, ph: i / xs.length + B.rng.range(0, 0.1) }, hit: 1.5, kmax: o.kmax ?? 13, look: o.look || 'ball', noHang: true })));
}
function cannon(B, side, edge, top, z, spd, r = 1.0) {
  const path = edge * 2 + 6, P = path / spd + B.rng.range(0.5, 1.1);
  B.add(cyl(side * (edge + 3), top + r, z, r, r, { anim: { k: 'roll', v: [-side * spd, 0, 0], P, ph: B.rng.range(0, 1) }, hit: 1.5, kmax: 8.5, look: 'snowball', noHang: true }));
  B.cannons.push({ x: side * (edge + 3.2), y: top + 1.0, z, dir: -side });
}
function wind(B, x0, x1, z0, z1, top, fx, o = {}) {
  const ph = B.rng.range(0, 1), p = o.p ?? 3.4, on = o.on ?? 0.55;
  B.winds.push({ x0, x1, z0, z1, y0: top - 1.5, y1: top + 6, fx, fz: 0, p, on, ph });
  B.fans.push({ x: fx > 0 ? x0 - 1.6 : x1 + 1.6, y: top + 1.5, z: (z0 + z1) / 2, dir: Math.sign(fx), p, on, ph });
}
function turnstile(B, x, top, z, w) {
  const ph = B.rng.range(0, TAU);
  B.add(cyl(x, top + 1.0, z, 0.35, 1.0, { look: 'post', noStand: true }));
  for (const a of [0, Math.PI / 2]) B.add(box(x, top + 0.9, z, 3.0, 0.75, 0.16, { anim: { k: 'spin', w }, bry: ph + a, look: 'gate', noHang: true, noStand: true }));
}
// a row of 5 doors across a 14.4-wide floor; some are fake and only bonk you back
function doorRow(B, z, top, real = 2) {
  const HW = 7.2, r = B.rng, ok = new Set(r.shuffle([0, 1, 2, 3, 4]).slice(0, real)), row = [];
  for (let i = 0; i <= 5; i++) B.add(box(-HW + 0.2 + i * 2.8, top + 2.4, z, 0.2, 2.4, 0.35, { look: 'pillar', noHang: true }));
  for (let i = 0; i < 5; i++) {
    const x = -HW + 1.6 + i * 2.8, d = B.dyn();
    B.add(box(x, top + 2.2, z, 1.2, 2.2, 0.28, { door: d, fake: !ok.has(i), look: 'door', noHang: true }));
    row.push({ x, d, fake: !ok.has(i) });
  }
  B.doors.push({ z, y: top, row });
  B.node({ door: B.doors.length - 1, y: top, z });
}
function gateRow(B, z, top) {
  const HW = 7.25, ids = [], p = B.rng.range(2.6, 3.2);
  for (let i = 0; i < 5; i++) ids.push(B.add(box(-HW + 1.45 + i * 2.9, top + 1.7, z, 1.4, 1.7, 0.3, { blink: { p, on: 0.55, ph: B.rng.range(0, 1) }, look: 'swing', noHang: true })).idx);
  B.node({ gates: ids, y: top, z });
}
function wallRush(B, z, top, hw, spd = 5.5) {
  const r = B.rng, gx = r.range(-hw + 2, hw - 2), gw = 1.2, ph = r.range(0, TAU), w = r.range(1.2, 1.6), v = [0, 0, -spd * 0.8];
  const lw = (gx - gw) + hw, rw = hw - (gx + gw), o = { anim: { k: 'slide', v, w, ph }, hit: 0.5, kmax: 9, look: 'rushwall', noHang: true };
  if (lw > 0.2) B.add(box(-hw + lw / 2, top + 1.5, z, lw / 2, 1.5, 0.45, o));
  if (rw > 0.2) B.add(box(hw - rw / 2, top + 1.5, z, rw / 2, 1.5, 0.45, { ...o, anim: { ...o.anim } }));
  B.node({ x: gx, y: top, z: z - 5, r: 1 });
  B.node({ x: gx, y: top, z: z + 5, r: 1.2 });
}
// a full-width wall with one gap that slides from side to side: the panels slide into housings at the track edges,
// it's too tall to jump, so you have to line up with the gap as it passes
function slideWall(B, z, top, hw, o = {}) {
  const g = o.gap ?? 1.05, a = hw - 1.4, L = (a + hw) / 2 + 0.4, w = o.w ?? B.rng.range(0.9, 1.25), ph = o.ph ?? B.rng.range(0, TAU);
  const anim = () => ({ k: 'slide', v: [a, 0, 0], w, ph });
  const P = { look: o.look || 'slidewall', noHang: true, noStand: true, hit: 0.5, kmax: 6.5, gapWall: true };
  const left = B.add(box(-g - L, top + 1.15, z, L, 1.15, 0.6, { ...P, anim: anim() }));
  B.add(box(g + L, top + 1.15, z, L, 1.15, 0.6, { ...P, anim: anim() }));
  const far = a + g + 2 * L + 0.3;
  for (const sd of [-1, 1]) B.add(box(sd * (hw + 0.2 + (far - hw - 0.2) / 2), top + 1.35, z, (far - hw - 0.2) / 2, 1.35, 0.95, { look: 'housing', noHang: true }));
  B.node({ slideGap: left.idx, off: g + L, hw, y: top, z });
}
function lava(B, x0, x1, z0, z1, floor, p) { B.lavas.push({ x0, x1, z0, z1, y0: floor - 0.7, amp: 1.9, p, ph: B.rng.range(0, 1), floor }); return B.lavas.length - 1; }
const lane = (B, zs, y, w = 0.3, r = 0.9) => { for (const z of zs) B.node({ x: 0, y, z, w, r }); };
const r2 = (B, a, b) => B.rng.range(a, b);

// ---------------------------------------------------------------- the maps
export const MAPS = {
  // TEMPLE OF DOOM: spike causeway, axe-swept stepping stones, a split path, a boulder run, temple stairs, fake doors
  ruins(B) {
    start(B);
    plat(B, 0, 0, 13, 2.8, 7, 'temple');
    for (let k = 0; k < 4; k++) spikes(B, 0, 0, 8.6 + k * 3.2, 2.8, 0.55, 2.0, 0.45, k * 0.24);
    lane(B, [7, 9.8, 13, 16.2, 19.4], 0, 0.2);
    mark(B, plat(B, 0, 0, 22.5, 3, 2.5, 'temple'), 23.4, 0.8);
    for (let i = 0; i < 5; i++) {
      const zz = 27.8 + i * 4.3, x = (i % 2 ? -1 : 1) * 1.3;
      const s = plat(B, x, 0, zz, 1.6, 1.45, 'temple');
      if (i < 4) hammer(B, 0, 0, zz + 2.15, { look: 'axe', w: r2(B, 1.5, 1.8), amp: 0.6 });
      B.node({ sid: s.idx, leap: true, y: 0, center: true });
    }
    cp(B, 0, 0, 49.5, 3.5, 2.5);
    plat(B, 0, 0, 53.5, 4.6, 1.5, 'temple');
    walk(B, -3.3, 55, -3.3, 74, 0, 1.15, 'beamwalk');
    hammer(B, -3.3, 0, 60, { look: 'axe', w: r2(B, 2.1, 2.5) }); hammer(B, -3.3, 0, 68, { look: 'axe', w: r2(B, 2.1, 2.5) });
    plat(B, 3.4, 0, 64.5, 1.75, 9.5, 'temple');
    for (const [k, zz] of [[0, 59], [1, 70]]) spikes(B, 3.4, 0, zz, 1.75, 0.6, 2.2, 0.5, k * 0.45);
    piston(B, 1, 5.15, 0, 64.5, 2.4, r2(B, 0.45, 0.6));
    B.node({ alts: [-3.3, 3.3], y: 0, z: 55.6, r: 1 });
    for (const zz of [58, 61.5, 65, 68.5, 72, 74.6]) B.node({ lane: true, y: 0, z: zz, r: 0.8 });
    mark(B, plat(B, 0, 0, 77, 6, 3, 'temple'), 78.4, 1);
    plat(B, 0, 0, 90, 6, 10, 'temple');
    balls(B, [-3.6, 0, 3.6], 0, 104, 76, 8.5, 1.15);
    lane(B, [82, 86, 90, 94, 98], 0, 3, 1.4);
    cp(B, 0, 0, 102.5, 4.6, 2.5);
    for (let k = 1; k <= 4; k++) {
      const top = 1.4 * k, z0 = 105 + (k - 1) * 5;
      B.add(box(0, top / 2 - 0.5, z0 + 2.5, 4.6, top / 2 + 0.5, 2.5, { look: 'terrace', step: k }));
      if (k >= 2) spikes(B, 0, top, z0 + 1.0, 4.6, 0.6, 2.4, 0.42, k * 0.27);
      if (k === 3) sweeper(B, 0, top, z0 + 3.4, 4.4, r2(B, 1.7, 2.1), { post: true });
      B.node({ x: 0, y: top, z: z0 + 2.2, w: 3, r: 1.5 });
    }
    mark(B, plat(B, 0, 5.6, 131, 7.2, 6, 'temple'), 126.6, 1.2);
    B.node({ x: 0, y: 5.6, z: 126, w: 3 });
    doorRow(B, 129, 5.6, 2);
    finish(B, 0, 5.6, 137);
    return B;
  },

  // VOLCANO ESCAPE: lava floods the pit, spinning logs over a basalt bridge, rocks drifting across a lava sea, a second
  // flooded pit with sliding boulders, then lifts up the crater wall
  volcano(B) {
    start(B);
    plat(B, 0, 0, 7.2, 5, 1.2, 'basalt');
    plat(B, 0, -1.2, 20, 5, 12, 'basalt');
    const L1 = lava(B, -5, 5, 8.4, 30.8, -1.2, r2(B, 3.6, 4.2));
    B.node({ x: 0, y: 0, z: 7.2, w: 2 });
    for (const [x, zz] of [[2.6, 13.5], [-2.6, 20.5], [2.2, 27]]) { const rk = plat(B, x, 0.2, zz, 1.15, 1.05, 'rock'); B.node({ sid: rk.idx, y: 0.2, center: true, rock: L1 }); }
    mark(B, plat(B, 0, 0, 32, 5, 1.2, 'basalt'), 32.7, 0.3);
    B.node({ x: 0, y: 0, z: 32, w: 3, rock: L1, exitLava: true });
    plat(B, 0, 0, 44.5, 1.7, 11.3, 'basalt');
    sweeper(B, 0, 0, 39, 3.4, r2(B, 2.1, 2.5)); sweeper(B, 0, 0, 49, 3.4, -r2(B, 2.3, 2.7));
    lane(B, [35.5, 41, 46, 51, 55], 0, 0.15);
    cp(B, 0, 0, 58.5, 3, 2.7);
    B.node({ x: 0, y: 0, z: 60.5, w: 0.8 });
    for (let i = 0; i < 5; i++) { const m = mover(B, 0, 0, 64.0 + i * 5.0, 1.7, 1.6, [r2(B, 2.6, 3.2), 0, 0], r2(B, 1.0, 1.25), 'rock'); B.node({ sid: m.idx, leap: true, y: 0 }); }
    mark(B, plat(B, 0, 0, 90.5, 3, 2, 'basalt'), 91.2, 0.6);
    B.node({ x: 0, y: 0, z: 91, w: 1.5, leap: true });
    plat(B, 0, -1.2, 105.5, 5, 13, 'basalt');
    const L2 = lava(B, -5, 5, 93, 116, -1.2, r2(B, 3.3, 3.8));
    for (const zz of [101, 107.5]) B.add(box(0, -1.2 + 0.9, zz, 1.3, 0.9, 1.0, { anim: { k: 'slide', v: [4, 0, 0], w: r2(B, 1.3, 1.7), ph: r2(B, 0, TAU) }, hit: 0.7, kmax: 9, look: 'pusher', noHang: true }));
    for (const [x, zz] of [[-2.6, 97.5], [2.6, 104.2], [-2.6, 110.8]]) { const rk = plat(B, x, 0.2, zz, 1.15, 1.05, 'rock'); B.node({ sid: rk.idx, y: 0.2, center: true, rock: L2 }); }
    plat(B, 0, 0, 117.3, 5, 1.2, 'basalt');
    B.node({ x: 0, y: 0, z: 117.3, w: 3, rock: L2, exitLava: true });
    cp(B, 0, 0, 121, 4, 2.5);
    B.node({ x: 0, y: 0, z: 122.7, w: 1 });
    for (let i = 0; i < 4; i++) { const top = 1.1 * (i + 1); const m = B.add(slab((i % 2 ? -1 : 1) * 1.2, top, 126.6 + i * 4.6, 1.7, 1.4, { anim: { k: 'slide', v: [0, 0.9, 0], w: r2(B, 1.0, 1.4), ph: r2(B, 0, TAU) }, look: 'rock' })); B.node({ sid: m.idx, leap: true, y: top }); }
    plat(B, 0, 5.0, 145, 4, 2, 'basalt');
    B.node({ x: 0, y: 5, z: 145, w: 2, leap: true });
    finish(B, 0, 5.0, 147);
    return B;
  },

  // FROSTBITE PEAK: snowball cannons over slippery ice, icy zig-zag beams in a blizzard, spinning ice discs,
  // a pusher lane, then icy terraces with snowballs rolling down at you
  frostbite(B) {
    start(B);
    plat(B, 0, 0, 19, 5.5, 13, 'snow');
    [[11, -1], [17.5, 1], [24, -1], [29.5, 1]].forEach(([zz, sd]) => cannon(B, sd, 5.5, 0, zz, r2(B, 8, 9.5)));
    lane(B, [8, 14, 20.5, 27, 31.5], 0, 2.5, 1.4);
    const pts = [[0, 32], [2.6, 37], [-2.6, 42], [2.6, 47], [0, 52]];
    for (let i = 0; i < pts.length - 1; i++) { walk(B, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0, 1.2, 'snow'); B.node({ x: pts[i + 1][0], y: 0, z: pts[i + 1][1], r: 0.9, exact: true }); }
    wind(B, -6, 6, 33, 41, 0, r2(B, 3.6, 4.2)); wind(B, -6, 6, 42, 51, 0, -r2(B, 3.6, 4.2));
    cp(B, 0, 0, 54.5, 3.5, 2.5);
    B.node({ x: 0, y: 0, z: 56.3, w: 1 });
    [[1.4, 61], [-1.4, 68.6], [1.4, 76.2]].forEach(([x, zz], i) => {
      const d = spinDisc(B, x, 0, zz, 3.2, (i % 2 ? -1 : 1) * r2(B, 0.7, 0.9), 'disc');
      B.node({ x, y: 0, z: zz, sid: d.idx, leap: true, r: 1.6, center: true });
    });
    mark(B, plat(B, 0, 0, 84, 3.5, 2, 'snow'), 84.8, 0.6);
    B.node({ x: 0, y: 0, z: 84, w: 1.5, leap: true });
    plat(B, 0, 0, 97, 4.5, 11, 'snow');
    lane(B, [88], 0, 2, 1.3);
    for (const zz of [90.5, 97.5, 104.5]) slideWall(B, zz, 0, 4.5, { look: 'icewall' });
    cannon(B, 1, 4.5, 0, 93.2, r2(B, 9, 10)); cannon(B, -1, 4.5, 0, 100.4, r2(B, 9, 10));
    lane(B, [107], 0, 2, 1.3);
    cp(B, 0, 0, 110.5, 4, 2.5);
    for (let k = 1; k <= 3; k++) { const top = 1.4 * k, z0 = 113 + (k - 1) * 6; B.add(box(0, top / 2 - 0.5, z0 + 3, 5, top / 2 + 0.5, 3, { look: 'terrace', step: k, ice: true })); B.node({ x: 0, y: top, z: z0 + 1.8, w: 3, r: 1.5 }); B.node({ x: 0, y: top, z: z0 + 5, w: 3, r: 1.5 }); }
    plat(B, 0, 4.2, 135, 5, 4, 'ice', { ice: true });
    balls(B, [-3, 0, 3], 0, 139, 108, 8.5, 1.1, { drop: 4.2, look: 'snowball', gap: 0.5 });
    finish(B, 0, 4.2, 139);
    return B;
  },

  // CANDY FACTORY: backwards conveyor lanes guarded by punchers, a chain of spinning gears, a candy chute on a
  // backwards belt, a wall-rush corridor, then a grid of flashing platforms over nothing
  factory(B) {
    start(B);
    [[-4, -2.4], [0, -3.4], [4, -2.4]].forEach(([x, v]) => belt(B, x, 0, 20, 1.95, 14, v));
    [[11, -1], [16, 1], [21, -1], [26, 1], [31, -1]].forEach(([zz, sd]) => piston(B, sd, 5.95, 0, zz, 4.8, r2(B, 0.5, 0.65)));
    lane(B, [9, 14, 19, 24, 29, 33.6], 0, 3.5, 1.4);
    [[1.2, 38], [-1.2, 45.6], [1.2, 53.2]].forEach(([x, zz], i) => {
      const d = spinDisc(B, x, 0, zz, 3.0, (i % 2 ? -1 : 1) * r2(B, 0.6, 0.85), 'disc');
      B.add(cyl(x, 0.6, zz, 0.45, 0.6, { look: 'post', noStand: true, anim: { k: 'spin', w: 0 } }));
      B.node({ x, y: 0, z: zz, sid: d.idx, leap: true, r: 1.6, center: true });
    });
    mark(B, plat(B, 0, 0, 58.2, 4.2, 2.0, 'floor'), 58.9, 0.6);
    B.node({ x: 0, y: 0, z: 58.4, w: 2.5, leap: true });
    belt(B, 0, 0, 73, 5.2, 13, -2.0);
    balls(B, [-3.4, 0, 3.4], 0, 90, 61.5, 8.5, 1.0);
    lane(B, [62, 66, 70, 74, 78, 82, 85.5], 0, 2.5, 1.3);
    cp(B, 0, 0, 88.5, 4, 2.5);
    plat(B, 0, 0, 103, 5, 12, 'floor');
    for (const s of [-1, 1]) B.add(box(s * 5.3, 0.6, 103, 0.3, 0.6, 12, { look: 'rail', noHang: true }));
    for (const zz of [96, 104, 112]) wallRush(B, zz, 0, 5, 6.5);
    cp(B, 0, 0, 117.5, 4, 2.5);
    B.node({ x: 0, y: 0, z: 119.4, w: 1.5 });
    for (let k = 0; k < 5; k++) {
      const zz = 122.6 + k * 4.2, row = [];
      for (const x of [-3.6, 0, 3.6]) row.push(blinker(B, x, 0, zz, 1.5, 1.5, 2.8, 0.58, k * 0.19 + (x + 3.6) * 0.07).idx);
      B.node({ sidAlts: row, leap: true, y: 0 });
    }
    plat(B, 0, 0, 142.5, 4, 2, 'floor');
    B.node({ x: 0, y: 0, z: 142.5, w: 2, leap: true });
    finish(B, 0, 0, 144.5);
    return B;
  },

  // SKY ISLANDS: a trampoline chain over the clouds, a fan-blasted sky bridge, vanishing cloud platforms, floating
  // islands with hammers swinging between them, and lifts up to the finish
  skyislands(B) {
    start(B);
    B.node({ x: 0, y: 0, z: 5.4, w: 1 });
    [[1.8, 9], [-1.8, 15.6], [1.8, 22.2], [-1.8, 28.8]].forEach(([x, zz]) => { const p = pad(B, x, 0, zz, 2.1, 14.6); B.node({ padAlts: [p.idx], y: 0, z: zz, r: 1.2 }); });
    mark(B, plat(B, 0, 0, 37.4, 3.2, 3.9, 'floor'), 39.6, 0.8);
    B.node({ x: 0, y: 0, z: 38.8, w: 1.5, leap: true });
    plat(B, 0, 0, 52.5, 1.5, 11.3, 'bridge');
    wind(B, -5, 5, 42, 49, 0, r2(B, 4.6, 5.4)); wind(B, -5, 5, 49.5, 56.5, 0, -r2(B, 4.6, 5.4)); wind(B, -5, 5, 57, 63.5, 0, r2(B, 4.6, 5.4));
    lane(B, [42, 46, 50, 54, 58, 62], 0, 0.2, 0.8);
    cp(B, 0, 0, 66.5, 3, 2.5);
    B.node({ x: 0, y: 0, z: 68.3, w: 1 });
    for (let k = 0; k < 5; k++) {
      const zz = 71.6 + k * 4.2, row = [];
      for (const x of [-1.8, 1.8]) row.push(blinker(B, x, 0, zz, 1.5, 1.5, 3.0, 0.64, k * 0.21 + (x > 0 ? 0.45 : 0)).idx);
      B.node({ sidAlts: row, leap: true, y: 0 });
    }
    mark(B, plat(B, 0, 0, 94.5, 3, 2.5, 'floor'), 95.6, 0.6);
    B.node({ x: 0, y: 0, z: 94.5, w: 1.5, leap: true });
    [[1.2, 100.5], [-1.2, 106.3], [1.2, 112.1], [-1.2, 117.9]].forEach(([x, zz], i) => {
      const d = B.add(cyl(x, -0.5, zz, 2.1, 0.5, { look: 'clock' }));
      if (i < 3) hammer(B, 0, 0, zz + 2.9, { w: r2(B, 2.0, 2.5), amp: 0.8 });
      B.node({ x, y: 0, z: zz, sid: d.idx, leap: true, r: 1.4, center: true });
    });
    cp(B, 0, 0, 122.5, 3.5, 2.5);
    B.node({ x: 0, y: 0, z: 124.3, w: 1 });
    for (let i = 0; i < 4; i++) { const top = 1.15 * (i + 1); const m = B.add(slab((i % 2 ? -1 : 1) * 1.4, top, 127.8 + i * 4.6, 1.6, 1.4, { anim: { k: 'slide', v: [r2(B, 1.2, 2), 0.9, 0], w: r2(B, 1.0, 1.4), ph: r2(B, 0, TAU) }, look: 'lift' })); B.node({ sid: m.idx, leap: true, y: top }); }
    plat(B, 0, 5.2, 146, 4, 2, 'floor');
    B.node({ x: 0, y: 5.2, z: 146, w: 2, leap: true });
    sweeper(B, 0, 5.2, 146, 3.8, r2(B, 1.8, 2.2));
    finish(B, 0, 5.2, 148);
    return B;
  },

  // CLOCKWORK TOWER: clock-face islands with sweeping hands, timed swinging gates with pendulums between them, a
  // narrow pendulum alley, a turnstile corridor, then bars dropping up and down
  clockwork(B) {
    start(B);
    B.node({ x: 0, y: 0, z: 5.4, w: 1 });
    [[0, 10], [1.5, 18.2], [-1.5, 26.4]].forEach(([x, zz], i) => {
      const d = B.add(cyl(x, -0.5, zz, 3.5, 0.5, { look: 'clock' }));
      B.add(cyl(x, 0.5, zz, 0.4, 0.5, { look: 'post', noStand: true }));
      sweeper(B, x, 0, zz, 1.6, (i % 2 ? 1 : -1) * r2(B, 1.1, 1.4), { ox: 1.8 });
      if (i === 1) sweeper(B, x, 0, zz, 1.4, (i % 2 ? -1 : 1) * r2(B, 0.6, 0.8), { ox: 1.5, h: 1.75 });
      B.node({ x, y: 0, z: zz, sid: d.idx, leap: true, r: 1.5, center: true });
    });
    mark(B, plat(B, 0, 0, 34, 7.25, 4.1, 'floor'), 36.4, 0.6);
    B.node({ x: 0, y: 0, z: 32, w: 3, leap: true });
    plat(B, 0, 0, 49, 7.25, 11, 'floor');
    gateRow(B, 40, 0); hammer(B, 0, 0, 44.5, { dir: [1, 0], w: r2(B, 1.8, 2.2), amp: 0.9 }); gateRow(B, 49, 0); hammer(B, 0, 0, 53.5, { dir: [1, 0], w: r2(B, 1.8, 2.2), amp: 0.9 }); gateRow(B, 58, 0);
    cp(B, 0, 0, 62.5, 3.5, 2.5);
    plat(B, 0, 0, 77, 1.35, 12, 'bridge');
    for (const zz of [69, 74.5, 80, 85.5]) hammer(B, 0, 0, zz, { w: r2(B, 2.2, 2.7), amp: 0.75 });
    lane(B, [66.5, 71.8, 77.2, 82.8, 88.2], 0, 0.1, 0.8);
    mark(B, plat(B, 0, 0, 104, 3.6, 15, 'floor'), 91.2, 0.5);
    for (const s of [-1, 1]) B.add(box(s * 3.9, 0.6, 104, 0.3, 0.6, 15, { look: 'rail', noHang: true }));
    turnstile(B, -1.6, 0, 95, r2(B, 1.2, 1.6)); turnstile(B, 1.6, 0, 101, -r2(B, 1.2, 1.6)); turnstile(B, -1.6, 0, 107, r2(B, 1.2, 1.6)); turnstile(B, 1.6, 0, 113, -r2(B, 1.2, 1.6));
    lane(B, [92, 98, 104, 110, 116, 118.5], 0, 1.2, 1.3);
    cp(B, 0, 0, 121.5, 3.5, 2.5);
    plat(B, 0, 0, 137, 3.2, 13, 'floor');
    for (const zz of [127, 131, 135, 139, 143, 147]) bar(B, 0, 0, zz, 3.0, r2(B, 2.0, 2.8));
    lane(B, [125, 129, 133, 137, 141, 145, 149.5], 0, 2, 1.3);
    finish(B, 0, 0, 150);
    return B;
  },

  // JUNGLE RIVER: logs rolling down the riverbank, river stones to hop, rope-bridge zig-zags with swinging logs,
  // swinging platforms over treadmills, and rafts drifting across the rapids
  jungle(B) {
    start(B);
    plat(B, 0, 0, 20, 5, 14, 'floor');
    [10, 15.5, 21, 26.5, 32].forEach((dz, i) => B.add(box(0, 0.45, dz, 4.7, 0.45, 0.4, { anim: { k: 'slide', v: [0, 0, 3.8], w: r2(B, 2.0, 2.6) * (i % 2 ? -1 : 1), ph: r2(B, 0, TAU) }, hit: 0.7, kmax: 10, look: 'log', noHang: true })));
    lane(B, [8, 13, 18.5, 24, 29.5, 33.5], 0, 3, 1.4);
    B.node({ x: 0, y: 0, z: 33.4, w: 1 });
    for (let i = 0; i < 6; i++) {
      const x = (i % 2 ? -1 : 1) * r2(B, 0.4, 1.3), zz = 37 + i * 4.6;
      const st = B.add(cyl(x, -0.4, zz, 1.7, 0.4, { look: 'disc' }));
      B.node({ sid: st.idx, leap: true, y: 0, center: true });
    }
    cp(B, 0, 0, 64.5, 3, 2.5);
    const pts = [[0, 67], [2.8, 72.5], [-2.8, 78], [2.8, 83.5], [0, 89]];
    for (let i = 0; i < pts.length - 1; i++) {
      walk(B, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0, 0.85, 'beamwalk');
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, mz = (pts[i][1] + pts[i + 1][1]) / 2, a = Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (i % 2 === 0) hammer(B, mx, 0, mz, { dir: [Math.cos(a), -Math.sin(a)], w: r2(B, 2.0, 2.4), amp: 0.6 });
      B.node({ x: pts[i + 1][0], y: 0, z: pts[i + 1][1], r: 0.9, exact: true });
    }
    for (const [x, hw, v] of [[-4.6, 2.4, 0], [0, 2.2, -3.8], [4.6, 2.4, 0]]) B.add(slab(x, 0, 105, hw, 13, v ? { belt: [0, v], look: 'belt' } : { look: 'floor' }));
    mark(B, plat(B, 0, 0, 90.5, 3.4, 1.5, 'floor'), 91.4, 0.3);
    lane(B, [93], 0, 3, 1.4);
    for (const dz of [96, 102.5, 109, 115.5]) slideWall(B, dz, 0, 7);
    lane(B, [116.5], 0, 1.2, 1.2);
    cp(B, 0, 0, 120.5, 3.5, 2.5);
    B.node({ x: 0, y: 0, z: 122.2, w: 0.8 });
    for (let i = 0; i < 5; i++) { const m = mover(B, 0, 0, 125.6 + i * 5.1, 1.7, 1.5, [r2(B, 3.4, 4.4), 0, 0], r2(B, 1.1, 1.4), 'rock'); B.node({ sid: m.idx, leap: true, y: 0 }); }
    plat(B, 0, 0, 150.5, 3.5, 2, 'floor');
    B.node({ x: 0, y: 0, z: 150.5, w: 1.5, leap: true });
    finish(B, 0, 0, 152.5);
    return B;
  },

  // CROWN CLIMB (final): a hammer-swept bridge, spinning bars, drifting platforms, then the terraced summit with
  // balls rolling down and the crown on top
  crownclimb(B) {
    start(B);
    plat(B, 0, 0, 18, 2.1, 12, 'bridge');
    for (const zz of [10, 17, 24]) hammer(B, 0, 0, zz, { w: r2(B, 1.9, 2.3), amp: 0.7 });
    sweeper(B, 0, 0, 13.5, 3.2, r2(B, 1.6, 1.9)); sweeper(B, 0, 0, 20.5, 3.2, -r2(B, 1.6, 1.9));
    lane(B, [7, 11.8, 15.2, 18.8, 22.4, 26, 29.5], 0, 0.3, 0.9);
    cp(B, 0, 0, 32.5, 3.5, 2.5);
    B.node({ x: 0, y: 0, z: 34.3, w: 0.8 });
    for (let i = 0; i < 4; i++) { const m = mover(B, 0, 0, 38 + i * 5.2, 1.7, 1.5, [r2(B, 3.4, 4.2), 0, 0], r2(B, 1.1, 1.4)); B.node({ sid: m.idx, leap: true, y: 0 }); }
    plat(B, 0, 0, 58.5, 4, 2.5, 'cp'); B.cps.push({ x: 0, y: 0, z: 58.5, hx: 4, hz: 2.5 });
    B.node({ x: 0, y: 0, z: 58.5, w: 2, leap: true });
    MODS.summit(B, 61, 0);
    B.len = 61 + 4 * 7 + 14 + 12;
    return B;
  },

  // FALL MOUNTAIN (final): giant balls down the slope, a fan-swept ridge, trampolines over the gap, the summit
  fallmountain(B) {
    start(B);
    plat(B, 0, 0, 20, 6, 14, 'floor');
    balls(B, [-4, -1.3, 1.3, 4], 0, 38, 2, 9, 1.25, { gap: 0.5 });
    for (const [x, zz] of [[-2.5, 14], [2.5, 22], [0, 29]]) B.add(cyl(x, 1, zz, 0.7, 1, { look: 'post', noStand: true }));
    lane(B, [8, 13, 18, 23, 28, 33], 0, 4, 1.5);
    plat(B, 0, 0, 46, 1.6, 12, 'bridge');
    wind(B, -5, 5, 35, 45, 0, r2(B, 4.4, 5)); wind(B, -5, 5, 46, 57, 0, -r2(B, 4.4, 5));
    for (const zz of [41, 47.5, 54]) hammer(B, 0, 0, zz, { w: r2(B, 1.9, 2.3), amp: 0.7 });
    lane(B, [36, 40, 44, 48, 52, 56.5], 0, 0.2, 0.8);
    cp(B, 0, 0, 60.5, 3.5, 2.5);
    B.node({ x: 0, y: 0, z: 62.3, w: 1 });
    [[2, 66], [-2, 73], [2, 80]].forEach(([x, zz]) => { const p = pad(B, x, 0, zz, 2.1, 14.4); B.node({ padAlts: [p.idx], y: 0, z: zz, r: 1.2 }); });
    plat(B, 0, 0, 86.8, 4, 3.2, 'cp'); B.cps.push({ x: 0, y: 0, z: 86.8, hx: 4, hz: 3.2 });
    B.node({ x: 0, y: 0, z: 86.8, w: 2, leap: true });
    MODS.summit(B, 90, 0);
    B.len = 90 + 4 * 7 + 14 + 12;
    return B;
  },
};

// stage id -> map builder (kept separate from the generic stages)
export function buildMap(id, rng) {
  const B = builder(rng, MAP_KIND[id] || 'race');
  return MAPS[id](B);
}
const MAP_KIND = { crownclimb: 'final', fallmountain: 'final' };
