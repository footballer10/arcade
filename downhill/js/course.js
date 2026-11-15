// Course generation: deterministic from a seed so every player gets the same mountain.
// Coordinates: +z is downhill (forward), y is up. Start line z=0, finish z=course.L.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// 0 outside [z0, z0+len], 1 inside, smooth edges of width e
const window01 = (z, z0, len, e) => smooth(z0, z0 + e, z) * (1 - smooth(z0 + len - e, z0 + len, z));

export const HW_MAIN = 16;   // half width of the groomed main run
export const HW_SC = 5;      // half width of a shortcut
const HP_WALL = 5, HP_W = 7; // half-pipe wall height and wall width
const BUCKET = 20;
const H_Z0 = -120, H_STEP = 1;

export function makeCourse(seed) {
  const R = mulberry32(seed);
  const L = 2700;
  const p1 = R() * 6.28, p2 = R() * 6.28, p3 = R() * 6.28;
  const a1 = 22 + R() * 18, a2 = 5 + R() * 7;

  // --- Sections -----------------------------------------------------------
  const side = R() < 0.5 ? -1 : 1;
  const shortcuts = [
    { z0: Math.round(L * (0.22 + R() * 0.08)), len: 380, B: side * (80 + R() * 20) },
    { z0: Math.round(L * (0.64 + R() * 0.06)), len: 320, B: -side * (70 + R() * 20) },
  ];
  const sc1End = shortcuts[0].z0 + shortcuts[0].len;
  const halfpipe = { z0: Math.round(sc1End + 70 + R() * 40), len: 240 };
  // steep pitches (+) and flats (-) avoid the start, the shortcuts and the finish
  const pitches = [];
  const freeZones = [[180, shortcuts[0].z0 - 40], [halfpipe.z0 + halfpipe.len + 30, shortcuts[1].z0 - 30], [shortcuts[1].z0 + shortcuts[1].len + 30, L - 120]];
  const rollers = [];
  for (const [a, b] of freeZones) {
    if (b - a < 160) continue;
    const len = Math.min(170, b - a - 20);
    const z0 = a + R() * (b - a - len);
    pitches.push({ z0, len, ds: 0.16 });             // steep pitch…
    if (b - (z0 + len) > 140) rollers.push({ z0: z0 + len + 20, len: 110 }); // …then rollers to run it out
    else if (z0 - a > 140) rollers.push({ z0: a + 10, len: 110 });
  }
  pitches.push({ z0: halfpipe.z0 - 10, len: halfpipe.len + 20, ds: 0.05 }); // a little steeper in the pipe

  const cxBase = (z) => smooth(0, 160, z) * (a1 * Math.sin(z / 190 + p1) + a2 * Math.sin(z / 70 + p2));
  const bulge = (z) => {
    let b = 0;
    for (const s of shortcuts) if (z > s.z0 && z < s.z0 + s.len) { const t = Math.sin(Math.PI * (z - s.z0) / s.len); b += s.B * t * t; }
    return b;
  };
  const cxMain = (z) => cxBase(z) + bulge(z);
  const scAt = (z) => { for (const s of shortcuts) if (z > s.z0 && z < s.z0 + s.len) return s; return null; };
  const scActive = (z) => !!scAt(z);
  const hpW = (z) => window01(z, halfpipe.z0, halfpipe.len, 30);

  // --- Height profile along z (precomputed, includes pitches + rollers) -----
  const n = Math.ceil((L + 320 - H_Z0) / H_STEP) + 2;
  const HT = new Float32Array(n);
  let h = 0;
  const z0Idx = Math.round(-H_Z0 / H_STEP);
  const slopeAt = (z) => {
    let s = 0.28 + 0.067 * Math.cos(z / 210 + p3);
    for (const p of pitches) s += p.ds * window01(z, p.z0, p.len, 25);
    if (z > L) s = 0.05 * (1 - smooth(L, L + 30, z)) + s * (1 - smooth(L, L + 30, z));
    return s;
  };
  for (let i = z0Idx; i < n; i++) { HT[i] = h; h -= slopeAt(H_Z0 + i * H_STEP) * H_STEP; }
  h = 0; for (let i = z0Idx; i >= 0; i--) { HT[i] = h; h += slopeAt(H_Z0 + i * H_STEP) * H_STEP; }
  function baseH(z) {
    const f = (z - H_Z0) / H_STEP, i = Math.max(0, Math.min(n - 2, Math.floor(f))), t = f - i;
    let y = HT[i] * (1 - t) + HT[i + 1] * t;
    for (const r of rollers) { const w = window01(z, r.z0, r.len, 12); if (w > 0) y += w * 0.9 * Math.sin((z - r.z0) * 2 * Math.PI / 18); }
    if (z > L + 200) y += (z - L - 200) * (z - L - 200) * 0.05; // end wall of the runout
    return y;
  }

  // signed distance outside the nearest corridor (<=0 means inside a run)
  function corridor(x, z) {
    const dm = Math.abs(x - cxMain(z)) - HW_MAIN;
    const ds = scActive(z) ? Math.abs(x - cxBase(z)) - HW_SC : 1e9;
    return { d: Math.min(dm, ds), groomed: dm <= 0, shortcut: ds <= 0 && dm > 0, pipe: dm <= 0 && hpW(z) > 0.5 };
  }
  function corridorD(x, z) {
    const dm = Math.abs(x - cxMain(z)) - HW_MAIN;
    if (!scActive(z)) return dm;
    return Math.min(dm, Math.abs(x - cxBase(z)) - HW_SC);
  }

  const ramps = [], pads = [], obstacles = [], gates = [], flags = [], signs = [];
  const rampBuckets = new Map(), obBuckets = new Map();
  const addB = (map, z0, z1, item) => {
    for (let b = Math.floor(z0 / BUCKET); b <= Math.floor(z1 / BUCKET); b++) {
      if (!map.has(b)) map.set(b, []);
      map.get(b).push(item);
    }
  };
  const blocked = [];
  const isBlocked = (x, z) => blocked.some(b => Math.abs(z - b.z) < b.rz && Math.abs(x - b.x) < b.rx);
  const inSpecial = (z, pad = 30) => shortcuts.some(s => z > s.z0 - pad && z < s.z0 + s.len + pad) ||
    (z > halfpipe.z0 - pad && z < halfpipe.z0 + halfpipe.len + pad) || rollers.some(r => z > r.z0 - 15 && z < r.z0 + r.len + 15);
  blocked.push({ x: 0, z: halfpipe.z0 + halfpipe.len / 2, rx: 999, rz: halfpipe.len / 2 + 20 });
  for (const r of rollers) blocked.push({ x: 0, z: r.z0 + r.len / 2, rx: 999, rz: r.len / 2 + 5 });

  // Jumps
  const nR = 11;
  for (let i = 0; i < nR; i++) {
    const z = 220 + (i + R() * 0.6) * ((L - 400) / nR);
    if (inSpecial(z)) continue;
    const x = cxMain(z) + (R() - 0.5) * HW_MAIN * 1.1;
    const big = R() < 0.4;
    ramps.push({ x, z0: z, len: big ? 9 : 7, w: big ? 9 : 8, h: big ? 3.6 : 2.6 });
  }
  for (const s of shortcuts) {
    for (const u of [0.3, 0.7]) { const z = s.z0 + s.len * u; ramps.push({ x: cxMain(z), z0: z, len: 7, w: 8, h: 2.4 }); }
    const z = s.z0 + s.len * 0.45; ramps.push({ x: cxBase(z), z0: z, len: 8, w: 7, h: 3.2 });
  }
  { const z = halfpipe.z0 + halfpipe.len + 25; ramps.push({ x: cxMain(z), z0: z, len: 9, w: 10, h: 3.8 }); } // pipe exit kicker
  for (const r of ramps) { addB(rampBuckets, r.z0, r.z0 + r.len, r); blocked.push({ x: r.x, z: r.z0, rx: r.w, rz: 35 }); }

  // Boost pads
  for (let i = 0; i < 12; i++) {
    const z = 150 + (i + R() * 0.7) * ((L - 250) / 12);
    if (z > halfpipe.z0 && z < halfpipe.z0 + halfpipe.len) continue;
    const x = cxMain(z) + (R() - 0.5) * HW_MAIN * 1.2;
    pads.push({ x, z });
  }
  for (const s of shortcuts) for (const u of [0.2, 0.75, 0.92]) { const z = s.z0 + s.len * u; pads.push({ x: cxBase(z), z }); }
  pads.push({ x: cxMain(halfpipe.z0 + 8), z: halfpipe.z0 + 8 });
  for (const p of pads) blocked.push({ x: p.x, z: p.z, rx: 5, rz: 22 });

  // Gates along the main route
  let alt = 1;
  for (let z = 80; z < L - 40; z += 115) {
    if (z > halfpipe.z0 && z < halfpipe.z0 + halfpipe.len) continue;
    const off = alt * 4.5; alt = -alt;
    gates.push({ x: cxMain(z) + off, z, hw: 6.5, color: alt > 0 ? 0xe5484d : 0x3e7bff });
    blocked.push({ x: cxMain(z) + off, z, rx: 8, rz: 10 });
  }
  for (const s of shortcuts) {
    for (let z = s.z0 + 40; z < s.z0 + s.len - 20; z += 30) flags.push({ x: cxBase(z) - HW_SC - 0.5, z }, { x: cxBase(z) + HW_SC + 0.5, z });
    const z = s.z0 + 40; signs.push({ x: cxBase(z) + Math.sign(s.B) * 9, z, text: 'SHORTCUT', bg: '#ffd400', fg: '#111' });
  }
  signs.push({ x: cxMain(halfpipe.z0 - 15), z: halfpipe.z0 - 15, text: 'HALF-PIPE', bg: '#20d0d0', fg: '#082030', banner: true });
  for (const r of rollers) signs.push({ x: cxMain(r.z0 - 12) + HW_MAIN + 1, z: r.z0 - 12, text: 'ROLLERS', bg: '#ff7a1a', fg: '#fff' });
  for (const p of pitches) if (p.ds > 0.1) signs.push({ x: cxMain(p.z0) - HW_MAIN - 1, z: p.z0, text: 'STEEP!', bg: '#c01f3b', fg: '#fff' });
  blocked.push({ x: 0, z: 30, rx: 999, rz: 70 });
  blocked.push({ x: 0, z: L, rx: 999, rz: 40 });

  // Obstacles in the runs (rocks + lone trees)
  const addOb = (o) => { obstacles.push(o); addB(obBuckets, o.z - o.r, o.z + o.r, o); };
  for (let i = 0; i < 38; i++) {
    const z = 120 + R() * (L - 200);
    const x = cxMain(z) + (R() - 0.5) * 2 * (HW_MAIN - 2);
    if (isBlocked(x, z)) continue;
    const tree = R() < 0.35;
    addOb({ x, z, r: tree ? 0.9 : 0.9 + R() * 1.1, h: tree ? 9 : 1.4 + R() * 0.8, type: tree ? 'tree' : 'rock' });
  }
  for (const s of shortcuts) for (let i = 0; i < 5; i++) {
    const z = s.z0 + 30 + R() * (s.len - 60);
    const x = cxBase(z) + (R() - 0.5) * 2 * (HW_SC - 1.5);
    if (isBlocked(x, z)) continue;
    addOb({ x, z, r: 0.8 + R() * 0.5, h: 1.3, type: 'rock' });
  }
  // Forest lining the runs. Only the near ones are collidable.
  const forest = [];
  for (let z = -40; z < L + 220; z += 3) {
    const lo = Math.min(cxMain(z), cxBase(z)) - HW_MAIN - 45;
    const hi = Math.max(cxMain(z), cxBase(z)) + HW_MAIN + 45;
    for (let k = 0; k < 5; k++) {
      const x = lo + R() * (hi - lo);
      const zz = z + R() * 3;
      const s = 0.7 + R() * 0.7;
      const d = corridorD(x, zz);
      if (d < 1.7 * s + hpW(zz) * 2) continue;
      const t = { x, z: zz, r: 0.8 * s, h: 9 * s, s, type: 'tree' };
      forest.push(t);
      if (d < 12) addB(obBuckets, zz - t.r, zz + t.r, t);
    }
  }

  function rampH(x, z) {
    const list = rampBuckets.get(Math.floor(z / BUCKET));
    if (!list) return 0;
    let hh = 0;
    for (const r of list) {
      const u = (z - r.z0) / r.len;
      if (u < 0 || u > 1) continue;
      const lx = Math.abs(x - r.x) - r.w / 2;
      if (lx > 0.6) continue;
      const sd = lx < 0 ? 1 : 1 - lx / 0.6;
      hh = Math.max(hh, r.h * Math.pow(u, 1.25) * sd);
    }
    return hh;
  }

  function groundH(x, z) {
    let y = baseH(z) + 0.45 * Math.sin(x * 0.11 + z * 0.05) * Math.sin(z * 0.07 - x * 0.03);
    const d = corridorD(x, z);
    if (d > 0) y += d * d * 0.035 + d * 0.25;
    const w = hpW(z);
    if (w > 0) {
      const ax = Math.abs(x - cxMain(z)), t = clamp01((ax - (HW_MAIN - HP_W)) / HP_W);
      y += w * HP_WALL * t * t;
    }
    return y + rampH(x, z);
  }

  const obstaclesNear = (z) => obBuckets.get(Math.floor(z / BUCKET)) || [];

  function nearestCenter(x, z) {
    const m = cxMain(z);
    if (scActive(z)) { const s = cxBase(z); if (Math.abs(x - s) < Math.abs(x - m)) return s; }
    return m;
  }

  return { seed, L, shortcuts, halfpipe, pitches, rollers, cxMain, cxBase, scActive, scAt, hpW, corridor, groundH, baseH,
    ramps, pads, obstacles, forest, gates, flags, signs, obstaclesNear, nearestCenter };
}
