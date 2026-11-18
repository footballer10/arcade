// RISING LAVA: shared rules. Pure logic, no three.js, so the host, every client and the headless balance
// script (tools in tests or node) all run exactly the same code.
//   - Levels are built from the round's seeded RNG (makeLevel) and are identical on every machine.
//   - Moving / blinking platforms are pure functions of the round clock t, so clients predict them exactly.
//   - Heat (basalt), sinking (pumice) and crumbling are host state, shipped as one byte per platform.

export const C = {
  // Movement is tuned to be forgiving, not twitchy: generous coyote/buffer time, a short guaranteed minimum
  // hop (MIN_JUMP_T) so even a quick tap of Space clears a gap, strong air control so you can correct a bad jump.
  G: 27, JUMP: 11.2, RUN: 7.8, ACC_G: 85, ACC_A: 50, PR: 0.42, PH: 1.6,
  COYOTE: 0.18, BUFFER: 0.22, FALL_MUL: 1.15, CUT_MUL: 1.4, MIN_JUMP_T: 0.16,
  DASH_V: 15.5, DASH_T: 0.16, DASH_CD: 0.9,
  SHOVE_CD: 0.75, SHOVE_R: 2.0, SHOVE_KB: 11.5, SHOVE_UP: 5.2, STUN: 0.38, BUMP_KB: 8,
  WALL_R: 15.2, LAND_LENIENCY: 0.26,
  // platforms
  HEAT_UP: 0.21, HEAT_CROWD: 0.14, COOL: 0.26, LAVA_HEAT: 0.14, CRUMBLE_T: 0.5, REGROW_T: 6.5,
  PUMICE_FLOAT: 0.42, PUMICE_SINK: 0.12, PUMICE_RISE: 0.1,
  // round clock: the lava never stops. It starts slow and keeps accelerating; new rock keeps rising out of it
  // (thinner, smaller and further apart as the round goes on) until GEN_T, when the volcano runs dry.
  LAVA_V0: 0.1, LAVA_ACC: 0.0024, GEN_T: 95, HARD_END: 40, ROUND_HARDER: 0.12,
  RISE_T: 2.2, WARN_T: 1.6,
  // volcano spirits (eliminated players lob lava bombs)
  BOMB_T: 1.35, BOMB_R: 1.9, BOMB_KB: 9.5, BOMB_UP: 7.5, BOMB_HEAT: 40, GHOST_CD: 6, GHOST_FIRST: 2,
  CROWN_WEIGHT: 1.6,
};
export const ST_CRUMBLE = 101, ST_GONE = 102;

export const LAYOUTS = {
  causeway: { name: 'Giant\'s Causeway', desc: 'A hill of basalt columns' },
  corkscrew: { name: 'Corkscrew', desc: 'Two spiral stairs and a lift' },
  archipelago: { name: 'Archipelago', desc: 'Islands, ferries and rafts' },
  ringfire: { name: 'Ring of Fire', desc: 'High rim, molten lake' },
};
export const LAYOUT_KEYS = Object.keys(LAYOUTS);
export const PATTERNS = {
  steady: { name: 'Steady Rise', icon: '🌋' },
  surge: { name: 'Surges', icon: '🌊' },
  tide: { name: 'Lava Tides', icon: '🌙' },
  rush: { name: 'Slow Burn → Rush', icon: '🔥' },
};
export const PATTERN_KEYS = Object.keys(PATTERNS);

const smooth = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const TAU = Math.PI * 2;

// Furthest horizontal distance a running jump covers to land dh higher (negative = lower). Used by bot AI and by
// level generation to GUARANTEE every platform it places is actually reachable, not just plausibly spaced.
export function jumpReach(dh) {
  const v = C.JUMP, g = C.G, disc = v * v - 2 * g * dh;
  if (disc < 0) return 0;
  return C.RUN * ((v + Math.sqrt(disc)) / (g * 1.05));
}

// ---------------------------------------------------------------- lava clock
// level at round time t (t < 0 = before the go). Every machine computes the same curve.
const lavaBase = (lv, t) => lv.from + lv.v0 * t + 0.5 * lv.acc * t * t + (t > lv.T ? lv.acc * (t - lv.T) * (t - lv.T) : 0);
export function lavaAt(lv, t) {
  if (t <= 0) return lv.from;
  switch (lv.pattern) {
    case 'surge': { const seg = 9, k = Math.floor(t / seg), fr = t / seg - k; return lavaBase(lv, k * seg + seg * smooth(0.4, 1, fr)); }
    case 'tide': return lavaBase(lv, t) + 0.75 * Math.sin((TAU * t) / 11) * Math.min(1, t / 8);
    default: return lavaBase(lv, t);
  }
}
// seconds until the next surge starts (for the warning rumble), or -1
export function surgeIn(lv, t) {
  if (lv.pattern !== 'surge' || t < 0) return -1;
  const seg = 9, fr = (t % seg) / seg;
  return fr < 0.4 ? (0.4 - fr) * seg : -1;
}

// ---------------------------------------------------------------- level generation
function poisson(rng, R, minD, tries = 900, seedPts = []) {
  const pts = [...seedPts];
  for (let i = 0; i < tries; i++) {
    const a = rng() * TAU, d = Math.sqrt(rng()) * R, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (pts.every((p) => Math.hypot(p.x - x, p.z - z) >= minD)) pts.push({ x, z });
  }
  return pts.slice(seedPts.length);
}
// cap heights so every column has a lower neighbour it can be climbed from
function relax(cols, step = 1.3, reach = 4.6) {
  const order = [...cols].sort((a, b) => a.top - b.top);
  const done = [];
  for (const c of order) {
    const lower = done.filter((o) => Math.hypot(o.x - c.x, o.z - c.z) - o.r - c.r < reach - 1.6);
    if (lower.length) c.top = Math.min(c.top, Math.max(...lower.map((o) => o.top)) + step);
    done.push(c);
  }
}
const gapOk = (list, x, z, r, pad = 0.35) => list.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + r + pad);

// Bridge every disconnected cluster of basalt onto the main one with stepping-stone columns, so the starting
// ground is always one jumpable group. Reachability uses jumpReach() with a comfortable margin (0.62), well
// inside what the game actually treats as "doable" (bots/level waves use 0.88) so a human has real room to spare.
const LEG = 0.62;
function connectBasalt(P, add, brg) {
  const cols = () => P.filter((o) => o.kind === 'basalt');
  const canJump = (a, b) => {
    const dh = b.top - a.top, gap = Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
    return gap <= jumpReach(dh) * LEG || gap <= jumpReach(-dh) * LEG;
  };
  function components() {
    const list = cols(), uf = new Map(list.map((o) => [o.id, o.id]));
    const find = (x) => { while (uf.get(x) !== x) { uf.set(x, uf.get(uf.get(x))); x = uf.get(x); } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) uf.set(ra, rb); };
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (canJump(list[i], list[j])) union(list[i].id, list[j].id);
    const groups = new Map();
    for (const o of list) { const r = find(o.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(o); }
    return [...groups.values()].sort((a, b) => b.length - a.length);
  }
  for (let guard = 0; guard < 12; guard++) {
    const groups = components();
    if (groups.length <= 1) return;
    const main = groups[0], stray = groups[1];
    // closest pair (one per side), weighting height difference more than flat distance (height is the scarce resource)
    let a = main[0], b = stray[0], bestCost = Infinity;
    for (const p of main) for (const q of stray) {
      const cost = Math.hypot(p.x - q.x, p.z - q.z) + Math.abs(p.top - q.top) * 2.2;
      if (cost < bestCost) { bestCost = cost; a = p; b = q; }
    }
    const flatReach = Math.max(1.5, jumpReach(0) * LEG), riseMax = Math.max(0.6, (C.JUMP * C.JUMP) / (2 * C.G) * LEG);
    const dx = b.x - a.x, dz = b.z - a.z, dist = Math.hypot(dx, dz), gap = dist - a.r - b.r, dh = b.top - a.top;
    const steps = Math.max(1, Math.ceil(Math.max(gap / flatReach, Math.abs(dh) / riseMax)));
    let prev = a;
    for (let k = 1; k < steps; k++) {
      const f = k / steps, r = brg.range(0.75, 0.95);
      let x = a.x + dx * f + (brg() - 0.5) * 0.6, z = a.z + dz * f + (brg() - 0.5) * 0.6;
      const rad = Math.hypot(x, z);
      if (rad > 13.4 - r) { x *= (13.4 - r) / rad; z *= (13.4 - r) / rad; }
      const top = a.top + dh * f;
      const stone = add({ kind: 'basalt', x, z, r, top, bot: -40 });
      prev = stone;
    }
    // if we only needed 0 intermediate stones, the pair itself already ought to connect; nudge `b` a hair closer
    // as a last resort so the union-find actually merges them (keeps guard loop from spinning on edge rounding)
    if (steps === 1 && !canJump(a, b)) { b.top = a.top + Math.sign(dh || 1) * Math.min(Math.abs(dh), riseMax * 0.9); }
  }
}

export function makeLevel(rng, layout, pattern, nPlayers, round = 0) {
  const P = [];
  const add = (o) => { o.id = P.length; P.push(o); return o; };
  const col = (x, z, r, top) => add({ kind: 'basalt', x, z, r, top, bot: -40 });
  const mover = (r, top, m) => add({ kind: 'mover', x: 0, z: 0, r, top, thick: 0.85, m });
  const glass = (x, z, r, top, per, ph) => add({ kind: 'glass', x, z, r, top, thick: 0.45, per, on: 0.62, ph });
  const pumice = (cx, cz, R, w, ph, r = 1.25) => add({ kind: 'pumice', x: cx, z: cz, r, top: 0, thick: 0.8, cx, cz, R, w, ph });

  if (layout === 'causeway') {
    const pts = poisson(rng, 12.6, 3.15);
    const peaks = [{ x: rng.range(-3, 3), z: rng.range(-3, 3), h: 7.2 }, { x: rng.range(-9, 9), z: rng.range(-9, 9), h: 4.5 }];
    for (const p of pts) {
      const r = rng.range(0.95, 1.32);
      if (!gapOk(P, p.x, p.z, r)) continue;
      let h = 0.6;
      for (const k of peaks) h = Math.max(h, k.h * Math.max(0, 1 - Math.hypot(p.x - k.x, p.z - k.z) / 12.5));
      col(p.x, p.z, r, h + rng.range(-0.5, 0.6));
    }
    relax(P.filter((o) => o.kind === 'basalt'));
    const top = Math.max(...P.map((o) => o.top));
    mover(1.25, top - 1.2, { type: 'orbit', cx: 0, cz: 0, R: 7.5, w: 0.32, ph: rng() * TAU });
    mover(1.25, top - 2.6, { type: 'orbit', cx: 0, cz: 0, R: 10.2, w: -0.24, ph: rng() * TAU });
    for (let i = 0; i < 2; i++) { const a = rng() * TAU; glass(Math.cos(a) * 4.5, Math.sin(a) * 4.5, 1.15, top + 1.1, 7, i * 3.5); }
    for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + rng(); pumice(Math.cos(a) * 11, Math.sin(a) * 11, 1.6, 0.12, rng() * TAU); }
  } else if (layout === 'corkscrew') {
    const arms = 2, rot = rng() * TAU;
    for (let a = 0; a < arms; a++) {
      let th = rot + (a * TAU) / arms, rad = 12.2, h = 0.9;
      while (rad > 3.6) {
        const r = rng.range(1.0, 1.25);
        const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
        if (gapOk(P, x, z, r, 0.3)) col(x, z, r, h);
        const step = rng.range(2.85, 3.3); th += step / rad; rad -= 0.42; h += rng.range(0.5, 0.78);
      }
    }
    // low stepping stones between the arms (they drown first)
    for (const p of poisson(rng, 12.8, 3.4, 500)) { const r = rng.range(0.85, 1.15); if (gapOk(P, p.x, p.z, r, 0.6) && Math.hypot(p.x, p.z) > 3.5) col(p.x, p.z, r, rng.range(0.4, 1.8)); }
    const top = Math.max(...P.map((o) => o.top));
    mover(1.35, 0, { type: 'lift', y0: 1.2, y1: top + 1.4, per: 9, ph: rng() * TAU, x: 0, z: 0 });
    for (let i = 0; i < 4; i++) { const a = rot + (i / 4) * TAU + 0.6; glass(Math.cos(a) * 7.2, Math.sin(a) * 7.2, 1.1, top - 1.8 - (i % 2) * 1.2, 6.5, i * 1.6); }
    pumice(0, 0, 9.5, 0.1, rng() * TAU); pumice(0, 0, 9.5, 0.1, rng() * TAU + Math.PI);
  } else if (layout === 'archipelago') {
    const n = 4, rot = rng() * TAU, isl = [{ x: 0, z: 0, h: rng.range(5.8, 7) }];
    for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU; isl.push({ x: Math.cos(a) * 9.2, z: Math.sin(a) * 9.2, h: [3.2, 5.4, 4.2, 6.2][i] + rng.range(-0.4, 0.4) }); }
    for (const I of isl) {
      const pts = poisson(rng, 3.4, 2.75, 300, []).map((p) => ({ x: p.x + I.x, z: p.z + I.z }));
      pts.unshift({ x: I.x, z: I.z });
      for (const p of pts) {
        const r = rng.range(0.9, 1.2);
        if (Math.hypot(p.x, p.z) > 13.2 || !gapOk(P, p.x, p.z, r, 0.3)) continue;
        col(p.x, p.z, r, Math.max(0.6, I.h - Math.hypot(p.x - I.x, p.z - I.z) * 0.62 + rng.range(-0.3, 0.3)));
      }
    }
    relax(P.filter((o) => o.kind === 'basalt'));
    // ferries between neighbouring islands + the middle
    for (let i = 1; i <= n; i++) {
      const A = isl[i], B = isl[(i % n) + 1], h = Math.min(A.h, B.h) - 0.6;
      mover(1.2, h, { type: 'slide', ax: A.x * 0.72 + B.x * 0.28, az: A.z * 0.72 + B.z * 0.28, bx: A.x * 0.28 + B.x * 0.72, bz: A.z * 0.28 + B.z * 0.72, per: 7 + i, ph: rng() * TAU });
    }
    for (let i = 1; i <= n; i += 2) { const A = isl[i]; mover(1.15, Math.min(A.h, isl[0].h) - 0.4, { type: 'slide', ax: A.x * 0.62, az: A.z * 0.62, bx: A.x * 0.3, bz: A.z * 0.3, per: 6.5, ph: rng() * TAU }); }
    for (let i = 0; i < 4; i++) { const a = rot + ((i + 0.5) / n) * TAU; pumice(Math.cos(a) * 7, Math.sin(a) * 7, 0.8, 0.5, rng() * TAU); }
    glass(0, 0, 1.0, isl[0].h + 1.25, 8, 0);
  } else { // ringfire
    const rot = rng() * TAU, cnt = 22;
    for (let i = 0; i < cnt; i++) {
      const a = rot + (i / cnt) * TAU, rad = 11.6 + rng.range(-0.5, 0.6), r = rng.range(1.05, 1.35);
      const h = 2.2 + 2.6 * (1 + Math.cos(2 * (a - rot))) * 0.5 + 1.6 * Math.max(0, Math.sin(3 * (a - rot) + 1)) + rng.range(-0.3, 0.3);
      if (gapOk(P, Math.cos(a) * rad, Math.sin(a) * rad, r, 0.3)) col(Math.cos(a) * rad, Math.sin(a) * rad, r, h);
    }
    // inner ring of low columns
    for (let i = 0; i < 9; i++) { const a = rot + (i / 9) * TAU + 0.2, rad = 7.6 + rng.range(-0.4, 0.4); col(Math.cos(a) * rad, Math.sin(a) * rad, rng.range(0.9, 1.15), rng.range(0.6, 2.4)); }
    relax(P.filter((o) => o.kind === 'basalt'), 1.35, 5.2);
    const top = Math.max(...P.map((o) => o.top));
    for (let i = 0; i < 3; i++) mover(1.2, 2.6 + i * 1.5, { type: 'orbit', cx: 0, cz: 0, R: 4.6 + i * 1.6, w: (i % 2 ? -1 : 1) * (0.42 - i * 0.07), ph: (i / 3) * TAU });
    glass(0, 0, 1.4, top + 0.6, 9, 0);
    for (let i = 0; i < 4; i++) pumice(0, 0, 2.6 + (i % 2) * 2.2, 0.22 * (i % 2 ? -1 : 1), (i / 4) * TAU, 1.2);
  }
  // the starting ground is only a launch pad: thin it out and keep it low, so new rock has room to rise
  const thinRng = rng.fork(0x7417);
  const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r < 1.9;
  const drop = new Set();
  for (const o of P) {
    if (o.kind !== 'basalt' || thinRng() > 0.33) continue;
    // only drop a column if every neighbour keeps at least two other close neighbours
    const nb = P.filter((q) => q !== o && q.kind === 'basalt' && !drop.has(q) && near(o, q));
    if (nb.length >= 3 && nb.every((q) => P.filter((w) => w !== q && w !== o && w.kind === 'basalt' && !drop.has(w) && near(q, w)).length >= 2)) drop.add(o);
  }
  const kept = P.filter((o) => !drop.has(o));
  P.length = 0; kept.forEach((o, i) => { o.id = i; if (o.kind === 'basalt') o.top = 1.6 + (o.top - 0.6) * 0.7; P.push(o); });
  for (const o of P) if (o.kind === 'mover' && o.m.type === 'lift') o.m.y1 = Math.min(o.m.y1, 7);
  // Guarantee the starting ground is one connected, jumpable group: thinning (and the layouts themselves, e.g.
  // Archipelago's separately-scattered islands) can rarely strand a few columns where no real jump reaches
  // anything else. Find every disconnected cluster and drop stepping-stone columns to bridge it to the rest, so
  // a player is never looking at ground they can see but can never actually reach.
  connectBasalt(P, add, rng.fork(0x6216));
  // spawns: mid-height basalt columns spread round the arena (greedy farthest-point)
  const cand = P.filter((o) => o.kind === 'basalt' && o.top > 2.2 && o.top < 5);
  const pool = cand.length >= nPlayers ? cand : P.filter((o) => o.kind === 'basalt');
  const spawns = [];
  let first = pool.reduce((b, o) => (Math.hypot(o.x, o.z) > Math.hypot(b.x, b.z) ? o : b), pool[0]);
  spawns.push(first);
  while (spawns.length < nPlayers) {
    let best = null, bd = -1;
    for (const o of pool) { if (spawns.includes(o) && spawns.length < pool.length) continue; const d = Math.min(...spawns.map((s) => Math.hypot(s.x - o.x, s.z - o.z))); if (d > bd) { bd = d; best = o; } }
    spawns.push(best);
  }
  const hard = 1 + C.ROUND_HARDER * round;   // the volcano gets angrier every round
  const lv = { from: -0.7, v0: C.LAVA_V0 * hard, acc: C.LAVA_ACC * hard, T: C.GEN_T, pattern };
  if (pattern === 'rush') { lv.v0 *= 0.45; lv.acc *= 1.7; }
  const drownAt = (top, t0) => { let t = Math.max(0, t0); while (t < 600 && lavaAt(lv, t) < top) t += 0.25; return t; };
  for (const o of P) { o.born = -1e9; o.until = o.kind === 'basalt' || o.kind === 'glass' ? drownAt(o.top, 0) : 1e9; }
  // ---- new rock: every few seconds a wave of columns rises out of the lava, above and around the highest rock,
  // so the climb never ends. Later waves are sparser, smaller and further apart.
  const waveRng = rng.fork(0x5EED);
  let tb = 1.2;
  while (tb < lv.T) {
    const d = Math.min(1, tb / lv.T);
    const Lnow = lavaAt(lv, tb), Lup = lavaAt(lv, tb + C.RISE_T + 2);
    const alive = P.filter((o) => (o.kind === 'basalt' || o.kind === 'glass') && o.born <= tb && o.until > tb + 3).sort((a, b) => b.top - a.top);
    const count = Math.max(1, Math.round((4.6 - 2.7 * d) * (0.7 + nPlayers * 0.08) + waveRng() * 0.8));
    for (let k = 0; k < count; k++) {
      for (let tries = 0; tries < 24; tries++) {
        const r = (1.25 - 0.38 * d) * waveRng.range(0.88, 1.1);
        let x, z, top;
        const anchor = alive.length ? alive[Math.floor(Math.pow(waveRng(), 1.4) * Math.min(alive.length, 14))] : null;
        if (anchor) {
          let a = waveRng() * TAU;
          if (layout === 'corkscrew') a = Math.atan2(anchor.z, anchor.x) + Math.PI / 2 + waveRng.range(-0.5, 0.5);   // keep spiralling round
          const gap = 0.45 + 1.7 * d + waveRng() * 0.9, dist = anchor.r + r + gap;
          x = anchor.x + Math.cos(a) * dist; z = anchor.z + Math.sin(a) * dist;
          top = anchor.top + waveRng.range(0.2, 1.1);
        } else { const a = waveRng() * TAU, rr = waveRng() * 8; x = Math.cos(a) * rr; z = Math.sin(a) * rr; top = Lup + 2; }
        top = Math.max(Lup + 1.3, Math.min(Lup + 5, top));
        const rad = Math.hypot(x, z);
        if (rad > 13.6 - r) continue;
        if (layout === 'ringfire' && rad < 6 && waveRng() < 0.7) continue;
        const until = drownAt(top, tb);
        if (!P.every((o) => o.kind === 'mover' || o.kind === 'pumice' || o.until <= tb || o.born >= until || Math.hypot(o.x - x, o.z - z) >= o.r + r + 0.35)) continue;
        if (waveRng() < 0.06 + 0.12 * d) add({ kind: 'glass', x, z, r, top, thick: 0.45, per: 6.5, on: 0.62, ph: waveRng() * 6.5, born: tb, until, y0: Lnow - 0.5 });
        else add({ kind: 'basalt', x, z, r, top, bot: -40, born: tb, until, y0: Lnow - 0.5 });
        alive.push(P[P.length - 1]);
        break;
      }
    }
    tb += 2.0 + d * 1.4 + waveRng() * 0.6;
  }
  return { layout, pattern, plats: P, spawns: spawns.map((s) => s.id), lv };
}

// Pick the per-round layout + rise pattern (each round different, seeded from the match seed).
export function roundPlan(rng, opt, rounds) {
  const L = rng.shuffle([...LAYOUT_KEYS]), Pt = rng.shuffle([...PATTERN_KEYS]);
  const out = [];
  for (let i = 0; i < rounds; i++) out.push({ layout: LAYOUTS[opt] ? opt : L[i % L.length], pattern: Pt[i % Pt.length] });
  return out;
}

// ---------------------------------------------------------------- platforms at time t
// st[i] = dynamic byte (basalt heat 0..100 / ST_CRUMBLE / ST_GONE, pumice sink in cm)
export function makeSolids(level) { return level.plats.map((p) => ({ id: p.id, kind: p.kind, x: p.x, z: p.z, r: p.r, top: p.top, bot: p.bot ?? p.top - (p.thick || 0.5), solid: true, vx: 0, vz: 0, vy: 0, ptop: p.top, warn: 0 })); }

function moverPos(m, t, out) {
  if (m.type === 'orbit') { const a = m.ph + m.w * t; out.x = m.cx + Math.cos(a) * m.R; out.z = m.cz + Math.sin(a) * m.R; }
  else if (m.type === 'slide') { const f = 0.5 - 0.5 * Math.cos((TAU * t) / m.per + m.ph); out.x = m.ax + (m.bx - m.ax) * f; out.z = m.az + (m.bz - m.az) * f; }
  else if (m.type === 'lift') { const f = 0.5 - 0.5 * Math.cos((TAU * t) / m.per + m.ph); out.x = m.x; out.z = m.z; out.top = m.y0 + (m.y1 - m.y0) * f; }
}
const tmp = { x: 0, z: 0, top: 0 };
// Update `S` (from makeSolids) to round time t. dt only used for platform velocities (carrying players).
export function updateSolids(level, S, st, t, lava, dt = 1 / 60) {
  const P = level.plats;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], s = S[i], px = s.x, pz = s.z, pt = s.top;
    s.ptop = pt;
    if (p.kind === 'basalt') {
      if (t < p.born) { s.solid = false; s.top = p.y0; }
      else { s.solid = st[i] !== ST_GONE; const k = (t - p.born) / C.RISE_T; s.top = k >= 1 ? p.top : p.y0 + (p.top - p.y0) * (1 - (1 - k) ** 3); }
      s.warn = st[i] === ST_CRUMBLE ? 1 : st[i] / 100;
    }
    else if (p.kind === 'mover') {
      tmp.top = p.top; moverPos(p.m, t, tmp); s.x = tmp.x; s.z = tmp.z; s.top = tmp.top; s.bot = s.top - p.thick;
    } else if (p.kind === 'glass') {
      const ph = ((t + p.ph) % p.per + p.per) % p.per, on = p.per * p.on;
      const k = (t - p.born) / C.RISE_T;
      s.top = k >= 1 ? p.top : p.y0 + (p.top - p.y0) * (1 - (1 - Math.max(0, k)) ** 3); s.bot = s.top - p.thick;
      s.solid = t >= p.born && (t < 0 || ph < on || k < 1.5); s.warn = s.solid && t >= 0 && k >= 1.5 && ph > on - 1.3 ? 1 : 0;
    } else if (p.kind === 'pumice') {
      const a = p.ph + p.w * t; s.x = p.cx + Math.cos(a) * p.R; s.z = p.cz + Math.sin(a) * p.R;
      s.top = lava + C.PUMICE_FLOAT - (st[i] || 0) / 100; s.bot = s.top - p.thick; s.warn = (st[i] || 0) / 100 / C.PUMICE_FLOAT;
    }
    if (dt > 0) { s.vx = (s.x - px) / dt; s.vz = (s.z - pz) / dt; s.vy = (s.top - pt) / dt; }
    if (Math.abs(s.vx) > 30 || Math.abs(s.vz) > 30 || Math.abs(s.vy) > 30) s.vx = s.vz = s.vy = 0;   // first frame / time jump
  }
}

// ---------------------------------------------------------------- players
export function newPlayer(id, plat) {
  return { id, x: plat ? plat.x : 0, y: plat ? plat.top : 3, z: plat ? plat.z : 0, vx: 0, vy: 0, vz: 0, face: plat ? Math.atan2(-plat.x, -plat.z) : 0,
    gr: plat ? plat.id : -1, coyote: 0, jbuf: 0, jumping: false, jumpT: 0, dashT: 0, dashCd: 0, airDash: false, dx: 0, dz: 0, shoveCd: 0, shoveT: 0, stun: 0,
    alive: true, lj: 0, ld: 0, ls: 0, bumped: null, landed: 0 };
}
export function syncCounters(p, inp) { p.lj = inp.j; p.ld = inp.d; p.ls = inp.s; }

// One fixed step for one player. inp = {mx, mz (world dir, |m|<=1), jh (jump held), j, d, s (press counters), face}
// Returns an events bitmask: 1 jump, 2 dash, 4 shove, 8 land.
export function stepPlayer(p, inp, dt, S) {
  let ev = 0;
  p.dashCd = Math.max(0, p.dashCd - dt); p.shoveCd = Math.max(0, p.shoveCd - dt); p.stun = Math.max(0, p.stun - dt);
  p.coyote = Math.max(0, p.coyote - dt); p.jbuf = Math.max(0, p.jbuf - dt); p.shoveT = Math.max(0, p.shoveT - dt);
  if (inp.j !== p.lj) { if (inp.j > p.lj) p.jbuf = C.BUFFER; p.lj = inp.j; }
  const ml = Math.hypot(inp.mx, inp.mz), mk = Math.min(1, ml), dirx = ml > 0.01 ? inp.mx / ml : 0, dirz = ml > 0.01 ? inp.mz / ml : 0;
  if (inp.d !== p.ld) {
    if (inp.d > p.ld && p.dashCd <= 0 && p.stun <= 0.12 && (p.gr >= 0 || !p.airDash)) {
      p.dashT = C.DASH_T; p.dashCd = C.DASH_CD; if (p.gr < 0) p.airDash = true;
      p.dx = ml > 0.01 ? dirx : Math.sin(p.face); p.dz = ml > 0.01 ? dirz : Math.cos(p.face); p.bumped = null; ev |= 2;
    }
    p.ld = inp.d;
  }
  if (inp.s !== p.ls) { if (inp.s > p.ls && p.shoveCd <= 0 && p.stun <= 0) { p.shoveCd = C.SHOVE_CD; p.shoveT = 0.22; ev |= 4; if (ml > 0.01) p.face = Math.atan2(dirx, dirz); } p.ls = inp.s; }
  // carried by the platform we stand on
  const g = p.gr >= 0 ? S[p.gr] : null;
  if (g) { p.x += g.vx * dt; p.z += g.vz * dt; }
  // horizontal control
  if (p.dashT > 0) {
    p.dashT -= dt; p.vx = p.dx * C.DASH_V; p.vz = p.dz * C.DASH_V; p.vy = 0;
    if (p.dashT <= 0) { p.vx = p.dx * C.RUN * 1.1; p.vz = p.dz * C.RUN * 1.1; }   // burst, not momentum: easy to aim
  } else {
    const acc = (p.gr >= 0 ? C.ACC_G : C.ACC_A) * (p.stun > 0 ? 0.15 : 1) * dt;
    const tx = dirx * C.RUN * mk, tz = dirz * C.RUN * mk;
    let ex = tx - p.vx, ez = tz - p.vz; const el = Math.hypot(ex, ez);
    if (el > acc) { ex *= acc / el; ez *= acc / el; }
    p.vx += ex; p.vz += ez;
  }
  // jump (buffered + coyote)
  if (p.jbuf > 0 && (p.gr >= 0 || p.coyote > 0) && p.stun <= 0) {
    p.vy = C.JUMP + (g && g.vy > 0 ? g.vy * 0.5 : 0); p.jbuf = 0; p.coyote = 0; p.gr = -1; p.jumping = true; p.jumpT = 0; ev |= 1;
  }
  // gravity (short hop when jump is released early, snappier falls)
  if (p.gr < 0 && p.dashT <= 0) {
    p.jumpT += dt;
    let gm = 1;
    if (p.vy > 0 && p.jumping && !inp.jh && p.jumpT > C.MIN_JUMP_T) gm = C.CUT_MUL; else if (p.vy < 0) gm = C.FALL_MUL;
    p.vy -= C.G * gm * dt;
    if (p.vy < -24) p.vy = -24;
  }
  const py = p.y;
  p.x += p.vx * dt; p.z += p.vz * dt; if (p.gr < 0) p.y += p.vy * dt;
  // collide with platforms
  let land = -1, landTop = -1e9;
  const wasGr = p.gr;
  for (let i = 0; i < S.length; i++) {
    const s = S[i]; if (!s.solid) continue;
    const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz);
    if (d > s.r + C.PR + 0.6) continue;
    const top = s.top;
    // standing / landing on the top face
    if (d < s.r + C.LAND_LENIENCY) {
      if (wasGr === s.id && p.y <= top + 0.25 && p.vy <= 0.01 + Math.max(0, s.vy)) { if (top > landTop) { land = s.id; landTop = top; } continue; }
      if (p.vy <= Math.max(0, s.vy) + 0.01 && py >= s.ptop - 0.08 && p.y <= top + 0.02) { if (top > landTop) { land = s.id; landTop = top; } continue; }
    }
    // sides
    if (p.y < top - 0.06 && p.y + C.PH > s.bot && d < s.r + C.PR) {
      if (p.vy > 0 && py + C.PH <= s.bot + 0.05 && d < s.r) { p.y = s.bot - C.PH; p.vy = 0; continue; }   // bonk a slab from below
      const n = d > 1e-4 ? 1 / d : 0, nx = d > 1e-4 ? dx * n : 1, nz = d > 1e-4 ? dz * n : 0;
      p.x = s.x + nx * (s.r + C.PR); p.z = s.z + nz * (s.r + C.PR);
      const vn = p.vx * nx + p.vz * nz; if (vn < 0) { p.vx -= vn * nx; p.vz -= vn * nz; }
    }
  }
  if (land >= 0) {
    if (wasGr < 0) { ev |= 8; p.landed = -p.vy; }
    p.gr = land; p.y = landTop; p.vy = 0; p.airDash = false; p.jumping = false;
  } else if (p.gr >= 0) { p.gr = -1; p.coyote = C.COYOTE; p.vy = Math.min(p.vy, 0) + (g ? Math.min(0, g.vy) : 0); }
  // crater wall
  const rr = Math.hypot(p.x, p.z);
  if (rr > C.WALL_R) { p.x *= C.WALL_R / rr; p.z *= C.WALL_R / rr; const nx = p.x / C.WALL_R, nz = p.z / C.WALL_R, vn = p.vx * nx + p.vz * nz; if (vn > 0) { p.vx -= vn * nx * 1.4; p.vz -= vn * nz * 1.4; } }
  if (p.stun <= 0 && ml > 0.05 && p.dashT <= 0) p.face = turn(p.face, Math.atan2(dirx, dirz), dt * 16);
  return ev;
}
function turn(a, b, k) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * Math.min(1, k); }

// soft push between two bodies (host + client prediction)
export function separate(a, b, both = true) {
  if (Math.abs(a.y - b.y) > 1.3) return;
  const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), min = C.PR * 2;
  if (d >= min || d < 1e-4) return;
  const push = (min - d) * (both ? 0.5 : 1), nx = dx / d, nz = dz / d;
  a.x += nx * push; a.z += nz * push;
  if (both) { b.x -= nx * push; b.z -= nz * push; }
}

// Host: who does a shove from p hit? returns [victim, dirx, dirz][]
export function shoveTargets(p, others) {
  const fx = Math.sin(p.face), fz = Math.cos(p.face), out = [];
  for (const o of others) {
    if (o === p || !o.alive) continue;
    const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz);
    if (d > C.SHOVE_R || Math.abs(o.y - p.y) > 1.4) continue;
    if (d > 0.5 && (dx * fx + dz * fz) / d < 0.35) continue;
    const nx = d > 0.3 ? dx / d : fx, nz = d > 0.3 ? dz / d : fz;
    out.push([o, nx * 0.6 + fx * 0.4, nz * 0.6 + fz * 0.4]);
  }
  return out;
}
export function knock(o, dx, dz, kb, up) {
  const l = Math.hypot(dx, dz) || 1;
  o.vx = (dx / l) * kb; o.vz = (dz / l) * kb; o.vy = up; o.gr = -1; o.stun = C.STUN; o.dashT = 0; o.jumping = false; o.coyote = 0;
}

// ---------------------------------------------------------------- host-only platform state
// occ[i] = number of live players standing on platform i this tick. timers = host-side regrow timers.
export function stepPlatforms(level, S, st, timers, occ, lava, dt, overtime) {
  const P = level.plats, ev = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (p.kind === 'basalt') {
      if (st[i] === ST_GONE || !S[i].solid) continue;                      // gone for good, or not risen yet
      if (p.top < lava - 0.2) { st[i] = ST_GONE; timers[i] = 0; continue; }   // drowned (p.top = height once fully risen)
      if (st[i] === ST_CRUMBLE) { timers[i] = (timers[i] || 0) + dt; if (timers[i] > C.CRUMBLE_T) { st[i] = ST_GONE; timers[i] = 0; ev.push([i, 'gone']); } continue; }
      let h = st[i] / 100;
      if (occ[i] > 0) h += dt * (C.HEAT_UP * Math.min(occ[i], 1) + C.HEAT_CROWD * Math.max(0, occ[i] - 1));
      else h -= dt * C.COOL;
      if (p.top - lava < 0.9) h += dt * C.LAVA_HEAT;
      h = Math.max(0, h);
      if (h >= 1) { st[i] = ST_CRUMBLE; timers[i] = 0; ev.push([i, 'crack']); }
      else st[i] = Math.round(h * 100);
    } else if (p.kind === 'pumice') {
      let s = (st[i] || 0) / 100;
      if (occ[i] > 0 || overtime) s += dt * C.PUMICE_SINK * Math.max(1, occ[i]); else s -= dt * C.PUMICE_RISE;
      st[i] = Math.round(Math.max(0, Math.min(2.5, s)) * 100);
    }
  }
  return ev;
}

// ---------------------------------------------------------------- binary snapshot
// header: u8 1, u8 round, u8 phase, f32 t, f32 phaseT, u8 nP, u16 nPlat
// player: u8 idx, u8 flags, i16 x,y,z (cm), i16 vx,vy,vz (cm/s), u8 face, u8 auth, i8 gr+1(low byte), u8 stun*100
export const PHASES = ['wait', 'intro', 'play', 'post', 'done'];
export function encodeSnap(s) {
  const nP = s.players.length, nS = s.st.length;
  const buf = new ArrayBuffer(16 + nP * 16 + nS), v = new DataView(buf);
  v.setUint8(0, 1); v.setUint8(1, s.round); v.setUint8(2, PHASES.indexOf(s.phase)); v.setFloat32(3, s.t); v.setFloat32(7, s.phaseT); v.setUint8(11, nP); v.setUint16(12, nS);
  let o = 16;
  const i16 = (x) => { v.setInt16(o, Math.max(-32767, Math.min(32767, Math.round(x * 100)))); o += 2; };
  for (const p of s.players) {
    v.setUint8(o++, p.idx);
    v.setUint8(o++, (p.alive ? 1 : 0) | (p.gr >= 0 ? 2 : 0) | (p.dashT > 0 ? 4 : 0) | (p.stun > 0 ? 8 : 0) | (p.shoveT > 0 ? 16 : 0));
    i16(p.x); i16(p.y); i16(p.z); i16(p.vx); i16(p.vy); i16(p.vz);
    v.setUint8(o++, Math.round((((p.face % TAU) + TAU) % TAU) / TAU * 255)); v.setUint8(o++, p.auth & 255);
  }
  for (let i = 0; i < nS; i++) v.setUint8(o++, Math.min(255, s.st[i]));
  return buf;
}
export function decodeSnap(buf) {
  const v = new DataView(buf);
  if (v.getUint8(0) !== 1) return null;
  const nP = v.getUint8(11), nS = v.getUint16(12);
  const s = { round: v.getUint8(1), phase: PHASES[v.getUint8(2)], t: v.getFloat32(3), phaseT: v.getFloat32(7), players: [], st: new Uint16Array(nS) };
  let o = 16;
  const i16 = () => { const x = v.getInt16(o) / 100; o += 2; return x; };
  for (let k = 0; k < nP; k++) {
    const idx = v.getUint8(o++), f = v.getUint8(o++);
    s.players.push({ idx, alive: !!(f & 1), grounded: !!(f & 2), dashing: !!(f & 4), stunned: !!(f & 8), shoving: !!(f & 16), x: i16(), y: i16(), z: i16(), vx: i16(), vy: i16(), vz: i16(), face: (v.getUint8(o++) / 255) * TAU, auth: v.getUint8(o++) });
  }
  for (let i = 0; i < nS; i++) s.st[i] = v.getUint8(o++);
  return s;
}

// highest standable surface under (x, z): platform top or the lava
export function groundAt(S, x, z, lava, below = 1e9) {
  let y = lava;
  for (const s of S) if (s.solid && s.top > y && s.top <= below && Math.hypot(s.x - x, s.z - z) < s.r) y = s.top;
  return y;
}
