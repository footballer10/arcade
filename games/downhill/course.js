// Course generation: deterministic from (seed, map) so every player gets the same mountain.
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
const window01 = (z, z0, len, e) => smooth(z0, z0 + e, z) * (1 - smooth(z0 + len - e, z0 + len, z));

export const HW_MAIN = 16;   // default half width (maps override with course.hw)
export const HW_SC = 5;
const HP_WALL = 5.5, HP_W = 7;
const BUCKET = 20;
const H_Z0 = -120, H_STEP = 1;

// ---------------- Maps ----------------
// sections: pool the generator draws from, in a shuffled order, between "filler" stretches.
export const MAPS = {
  alpine: {
    name: 'Alpine Classic', desc: 'Sunny groomers, two shortcuts, a half-pipe and a jump line.',
    L: 2650, hw: 16, curvy: 1.0, slope: 0.28, trees: 5, soft: false, fillerKickers: 0.55,
    sections: ['shortcut', 'halfpipe', 'jumpline', 'shortcut', 'rollers', 'pitch', 'rails', 'moguls'],
  },
  park: {
    name: 'Night Park', desc: 'Floodlit terrain park: jump lines, rail gardens and a superpipe.',
    L: 2850, hw: 21, curvy: 0.55, slope: 0.3, trees: 3, soft: false, fillerKickers: 0.9,
    sections: ['jumpline', 'rails', 'halfpipe', 'jumpline', 'rails', 'shortcut', 'jumpline', 'rollers'],
  },
  powder: {
    name: 'Powder Forest', desc: 'Snowy backcountry: tree glades, moguls, cliff drops and soft snow.',
    L: 2200, hw: 15, curvy: 1.35, slope: 0.31, trees: 8, soft: true, fillerKickers: 0.35,
    sections: ['trees', 'cliff', 'moguls', 'shortcut', 'trees', 'cliff', 'pitch', 'moguls', 'shortcut'],
  },
  glacier: {
    name: 'Sunset Glacier', desc: 'Wide, fast and open: huge kickers, cliffs and banked turns.',
    L: 3000, hw: 20, curvy: 0.85, slope: 0.3, trees: 1.2, soft: false, fillerKickers: 0.8, bigKickers: true,
    sections: ['cliff', 'jumpline', 'pitch', 'shortcut', 'cliff', 'rollers', 'jumpline', 'halfpipe'],
  },
};
export const MAP_IDS = Object.keys(MAPS);

const SEC_LEN = { shortcut: 360, halfpipe: 240, jumpline: 230, rails: 160, rollers: 110, pitch: 170, moguls: 160, cliff: 70, trees: 220 };

export function makeCourse(seed, mapId = 'alpine', opts = {}) {
  const map = MAPS[mapId] || MAPS.alpine;
  const R = mulberry32(seed ^ (MAP_IDS.indexOf(mapId) * 0x9e3779b1));
  const L = map.L, HW = map.hw;
  const p1 = R() * 6.28, p2 = R() * 6.28, p3 = R() * 6.28;
  const a1 = (22 + R() * 18) * map.curvy, a2 = (5 + R() * 7) * map.curvy;

  // --- Lay out sections along the run -----------------------------------
  const pool = [...map.sections];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const sections = [];
  let z = 170;
  let lastSide = R() < 0.5 ? -1 : 1;
  for (const type of pool) {
    const len = SEC_LEN[type];
    if (z + len > L - 130) continue;
    const s = { type, z0: z, len };
    if (type === 'shortcut') { lastSide = -lastSide; s.B = lastSide * (75 + R() * 25); s.kind = ['fast', 'rough', 'gap'][Math.floor(R() * 3)]; }
    if (type === 'cliff') s.drop = map.bigKickers ? 7 + R() * 3 : 5 + R() * 3;
    sections.push(s);
    z += len + 60 + R() * 90; // filler between sections
  }
  const of = (t) => sections.filter(s => s.type === t);
  const shortcuts = of('shortcut'), pipes = of('halfpipe'), rollers = of('rollers'), mogulSecs = of('moguls'), cliffs = of('cliff');
  const halfpipe = pipes[0] || null;
  const pitches = of('pitch').map(s => ({ z0: s.z0, len: s.len, ds: 0.16 }));
  for (const p of pipes) pitches.push({ z0: p.z0 - 10, len: p.len + 20, ds: 0.05 });
  for (const c of cliffs) pitches.push({ z0: c.z0 + 24, len: 4, ds: c.drop / 3, sharp: true }, { z0: c.z0 + 27, len: 32, ds: 0.16 });

  const cxBase = (zz) => smooth(0, 160, zz) * (a1 * Math.sin(zz / 190 + p1) + a2 * Math.sin(zz / 70 + p2));
  const bulge = (zz) => {
    let b = 0;
    for (const s of shortcuts) if (zz > s.z0 && zz < s.z0 + s.len) { const t = Math.sin(Math.PI * (zz - s.z0) / s.len); b += s.B * t * t; }
    return b;
  };
  const cxMain = (zz) => cxBase(zz) + bulge(zz);
  const scAt = (zz) => { for (const s of shortcuts) if (zz > s.z0 && zz < s.z0 + s.len) return s; return null; };
  const scActive = (zz) => !!scAt(zz);
  const hpW = (zz) => { let w = 0; for (const p of pipes) w = Math.max(w, window01(zz, p.z0, p.len, 30)); return w; };
  const mogulW = (zz) => { let w = 0; for (const m of mogulSecs) w = Math.max(w, window01(zz, m.z0, m.len, 20)); return w; };

  // --- Height profile along z ---------------------------------------------
  const n = Math.ceil((L + 320 - H_Z0) / H_STEP) + 2;
  const HT = new Float32Array(n);
  let h = 0;
  const z0Idx = Math.round(-H_Z0 / H_STEP);
  const slopeAt = (zz) => {
    let s = map.slope + 0.067 * Math.cos(zz / 210 + p3);
    for (const p of pitches) s += p.ds * window01(zz, p.z0, p.len, p.sharp ? 1 : 25);
    if (zz > L) s = 0.05 * (1 - smooth(L, L + 30, zz)) + s * (1 - smooth(L, L + 30, zz));
    return s;
  };
  for (let i = z0Idx; i < n; i++) { HT[i] = h; h -= slopeAt(H_Z0 + i * H_STEP) * H_STEP; }
  h = 0; for (let i = z0Idx; i >= 0; i--) { HT[i] = h; h += slopeAt(H_Z0 + i * H_STEP) * H_STEP; }
  function baseH(zz) {
    const f = (zz - H_Z0) / H_STEP, i = Math.max(0, Math.min(n - 2, Math.floor(f))), t = f - i;
    let y = HT[i] * (1 - t) + HT[i + 1] * t;
    for (const r of rollers) { const w = window01(zz, r.z0, r.len, 12); if (w > 0) y += w * 0.9 * Math.sin((zz - r.z0) * 2 * Math.PI / 18); }
    if (zz > L + 200) y += (zz - L - 200) * (zz - L - 200) * 0.05;
    return y;
  }

  function corridor(x, zz) {
    const dm = Math.abs(x - cxMain(zz)) - HW;
    const ds = scActive(zz) ? Math.abs(x - cxBase(zz)) - HW_SC : 1e9;
    return { d: Math.min(dm, ds), groomed: dm <= 0 && !map.soft, soft: map.soft, shortcut: ds <= 0 && dm > 0, pipe: dm <= 0 && hpW(zz) > 0.5, moguls: dm <= 0 && mogulW(zz) > 0.5 };
  }
  function corridorD(x, zz) {
    const dm = Math.abs(x - cxMain(zz)) - HW;
    if (!scActive(zz)) return dm;
    return Math.min(dm, Math.abs(x - cxBase(zz)) - HW_SC);
  }

  const ramps = [], pads = [], obstacles = [], gates = [], flags = [], signs = [], rails = [], lights = [];
  const rampBuckets = new Map(), obBuckets = new Map(), railBuckets = new Map();
  const addB = (m, za, zb, item) => {
    for (let b = Math.floor(za / BUCKET); b <= Math.floor(zb / BUCKET); b++) { if (!m.has(b)) m.set(b, []); m.get(b).push(item); }
  };
  const blocked = [];
  const isBlocked = (x, zz) => blocked.some(b => Math.abs(zz - b.z) < b.rz && Math.abs(x - b.x) < b.rx);
  const inSection = (zz, pad = 25) => sections.some(s => zz > s.z0 - pad && zz < s.z0 + s.len + pad);
  for (const s of sections) if (s.type !== 'shortcut') blocked.push({ x: 0, z: s.z0 + s.len / 2, rx: 999, rz: s.len / 2 + 15 });

  const sign = (zz, text, bg, fg, side = 1, banner = false) => signs.push({ x: cxMain(zz) + (banner ? 0 : side * (HW + 1)), z: zz, text, bg, fg, banner });

  // --- Section contents ----------------------------------------------------
  for (const s of sections) {
    const zs = s.z0, ze = s.z0 + s.len;
    if (s.type === 'shortcut') {
      const kind = s.kind || 'fast', sgn = Math.sign(s.B) || 1;
      // a discreet trailhead marker + a few sparse blazes — not a wall of flags shouting "shortcut"
      { const zz = zs + 16; signs.push({ x: cxBase(zz) + sgn * 7, z: zz, text: 'alt trail', bg: '#5b4632', fg: '#ffe2a6', small: true }); }
      for (const u of [0.22, 0.55, 0.85]) { const zz = zs + s.len * u; flags.push({ x: cxBase(zz) + sgn * (HW_SC + 0.7), z: zz, blaze: true }); }
      if (kind === 'fast') { // straight, groomed, a couple of boost pads — the reward is pure speed
        for (const u of [0.3, 0.7]) { const zz = zs + s.len * u; ramps.push({ type: 'kick', x: cxMain(zz), z0: zz, len: 8, w: 8, h: 3.4 }); }
        for (const u of [0.35, 0.8]) { const zz = zs + s.len * u; pads.push({ x: cxBase(zz), z: zz }); }
      } else if (kind === 'rough') { // same length, but rocks to dodge — no free speed, just a tighter line
        for (const u of [0.3, 0.7]) { const zz = zs + s.len * u; ramps.push({ type: 'kick', x: cxMain(zz), z0: zz, len: 8, w: 8, h: 3.4 }); }
        { const zz = zs + s.len * 0.5; ramps.push({ type: 'kick', x: cxBase(zz), z0: zz, len: 7, w: 7, h: 3.6 }); }
        for (let k = 0; k < 5; k++) { const zz = zs + 30 + R() * (s.len - 60), x = cxBase(zz) + (R() - 0.5) * HW_SC * 1.6;
          obstacles.push({ x, z: zz, r: 0.7 + R() * 0.4, h: 1.3, type: 'rock' }); }
      } else { // gap: tight tree-lined technical line
        for (const u of [0.25, 0.6]) { const zz = zs + s.len * u; ramps.push({ type: 'kick', x: cxMain(zz), z0: zz, len: 7, w: 7, h: 3.2 }); }
        for (let k = 0; k < 7; k++) { const zz = zs + 20 + k * (s.len - 40) / 7;
          obstacles.push({ x: cxBase(zz) + sgn * (HW_SC + 1.4), z: zz, r: 0.8, h: 9, s: 0.9, type: 'tree' }); }
      }
    } else if (s.type === 'halfpipe') {
      sign(zs - 15, 'HALF-PIPE', '#20d0d0', '#082030', 0, true);
      pads.push({ x: cxMain(zs + 8), z: zs + 8 });
      const zz = ze + 25; ramps.push({ type: 'kick', x: cxMain(zz), z0: zz, len: 10, w: 10, h: 5.5 });
    } else if (s.type === 'jumpline') {
      sign(zs - 15, 'JUMP LINE', '#ff3d7f', '#fff', 0, true);
      for (let k = 0; k < 3; k++) {
        const zz = zs + 10 + k * 72, big = map.bigKickers || k === 2;
        ramps.push({ type: 'table', x: cxMain(zz), z0: zz, len: big ? 9 : 8, w: 11, h: big ? 4.6 : 3.8, gap: big ? 14 : 11, land: big ? 30 : 26 });
      }
      // side rail alongside the line
      const rz = zs + 30, side = R() < 0.5 ? -1 : 1;
      rails.push({ type: 'rail', x: cxMain(rz) + side * (HW - 4), z0: rz, len: 24, h: 0.9, w: 0.14 });
    } else if (s.type === 'rails') {
      sign(zs - 15, 'RAIL GARDEN', '#7a5cff', '#fff', 0, true);
      const lanes = [-0.55, 0, 0.55];
      for (let k = 0; k < 4; k++) {
        const lane = lanes[k % 3] * HW, zz = zs + 12 + k * 36 + R() * 6;
        const box = k % 2 === 0;
        rails.push({ type: box ? 'box' : 'rail', x: cxMain(zz) + lane, z0: zz, len: box ? 16 : 20, h: box ? 0.7 : 1.0, w: box ? 0.9 : 0.14 });
      }
    } else if (s.type === 'rollers') {
      sign(zs - 12, 'ROLLERS', '#ff7a1a', '#fff', 1);
    } else if (s.type === 'pitch') {
      sign(zs, 'STEEP!', '#c01f3b', '#fff', -1);
    } else if (s.type === 'moguls') {
      sign(zs - 12, 'MOGULS', '#2f6fcf', '#fff', 1);
    } else if (s.type === 'cliff') {
      sign(zs, 'CLIFF DROP', '#111', '#ffd400', 0, true);
      for (let x = -HW; x <= HW; x += 4) flags.push({ x: cxMain(zs + 20) + x, z: zs + 20, small: true, hazard: true });
    } else if (s.type === 'trees') {
      sign(zs - 12, 'TREE RUN', '#2e7d4f', '#fff', -1);
      for (let k = 0; k < 18; k++) {
        const zz = zs + 15 + R() * (s.len - 30), x = cxMain(zz) + (R() - 0.5) * 2 * (HW - 1.5);
        obstacles.push({ x, z: zz, r: 0.75, h: 9, s: 0.85 + R() * 0.4, type: 'tree' });
      }
    }
  }

  // --- Filler: single kickers + pads where there is no section -------------
  for (let i = 0; i < 16; i++) {
    const zz = 200 + (i + R() * 0.6) * ((L - 380) / 16);
    if (inSection(zz, 30) || R() > map.fillerKickers) continue;
    const x = cxMain(zz) + (R() - 0.5) * HW * 1.1;
    const big = map.bigKickers ? R() < 0.7 : R() < 0.4;
    ramps.push({ type: 'kick', x, z0: zz, len: big ? 10 : 8, w: big ? 9 : 8, h: big ? 5.2 : 3.8 });
  }
  for (const r of ramps) {
    const total = r.len + (r.gap || 0) + (r.land || 0);
    r.total = total;
    addB(rampBuckets, r.z0, r.z0 + total, r);
    blocked.push({ x: r.x, z: r.z0 + total / 2, rx: r.w, rz: total / 2 + 30 });
  }
  for (let i = 0; i < 12; i++) {
    const zz = 150 + (i + R() * 0.7) * ((L - 250) / 12);
    if (inSection(zz, 5) || isBlocked(cxMain(zz), zz)) continue;
    pads.push({ x: cxMain(zz) + (R() - 0.5) * HW * 1.1, z: zz });
  }
  for (const p of pads) blocked.push({ x: p.x, z: p.z, rx: 5, rz: 22 });
  for (const r of rails) { addB(railBuckets, r.z0 - 1, r.z0 + r.len + 1, r); blocked.push({ x: r.x, z: r.z0 + r.len / 2, rx: 4, rz: r.len / 2 + 10 }); }

  // Gates along the main route
  let alt = 1;
  for (let zz = 80; zz < L - 40; zz += 115) {
    if (inSection(zz, 10) && !scActive(zz)) continue;
    const off = alt * 4.5; alt = -alt;
    gates.push({ x: cxMain(zz) + off, z: zz, hw: 6.5, color: alt > 0 ? 0xe5484d : 0x3e7bff });
    blocked.push({ x: cxMain(zz) + off, z: zz, rx: 8, rz: 10 });
  }
  blocked.push({ x: 0, z: 30, rx: 999, rz: 70 });
  blocked.push({ x: 0, z: L, rx: 999, rz: 40 });

  // Obstacles in the runs (rocks + lone trees)
  const addOb = (o) => { if (!obstacles.includes(o)) obstacles.push(o); addB(obBuckets, o.z - o.r, o.z + o.r, o); };
  for (const o of [...obstacles]) addOb(o);
  const nOb = map.soft ? 30 : 34;
  for (let i = 0; i < nOb; i++) {
    const zz = 120 + R() * (L - 200);
    const x = cxMain(zz) + (R() - 0.5) * 2 * (HW - 2);
    if (isBlocked(x, zz)) continue;
    const tree = R() < (map.trees > 2 ? 0.35 : 0.1);
    addOb({ x, z: zz, r: tree ? 0.9 : 0.9 + R() * 1.1, h: tree ? 9 : 1.4 + R() * 0.8, type: tree ? 'tree' : 'rock' });
  }
  for (const s of shortcuts) for (let i = 0; i < 5; i++) {
    const zz = s.z0 + 30 + R() * (s.len - 60);
    const x = cxBase(zz) + (R() - 0.5) * 2 * (HW_SC - 1.5);
    if (isBlocked(x, zz)) continue;
    addOb({ x, z: zz, r: 0.8 + R() * 0.5, h: 1.3, type: 'rock' });
  }

  // Forest lining the runs. Only the near ones are collidable.
  const forest = [];
  const perRow = map.trees;
  for (let zz0 = -40; zz0 < L + 220; zz0 += 3) {
    const lo = Math.min(cxMain(zz0), cxBase(zz0)) - HW - 50;
    const hi = Math.max(cxMain(zz0), cxBase(zz0)) + HW + 50;
    const cnt = Math.floor(perRow) + (R() < perRow % 1 ? 1 : 0);
    for (let k = 0; k < cnt; k++) {
      const x = lo + R() * (hi - lo);
      const zz = zz0 + R() * 3;
      const s = 0.7 + R() * 0.7;
      const d = corridorD(x, zz);
      if (d < 1.7 * s + hpW(zz) * 2) continue;
      const t = { x, z: zz, r: 0.8 * s, h: 9 * s, s, type: 'tree' };
      forest.push(t);
      if (d < 12) addB(obBuckets, zz - t.r, zz + t.r, t);
    }
  }
  // Floodlights for the night map; lift towers on every map
  const lifts = [];
  const liftSide = R() < 0.5 ? -1 : 1;
  for (let zz = 40; zz < L; zz += 90) lifts.push({ x: cxBase(zz) + liftSide * (HW + 38 + Math.abs(bulge(zz))), z: zz });
  if (mapId === 'park') for (let zz = 30, k = 0; zz < L + 20; zz += 55, k++) lights.push({ x: cxMain(zz) + (k % 2 ? 1 : -1) * (HW + 3), z: zz });

  function rampH(x, zz) {
    const list = rampBuckets.get(Math.floor(zz / BUCKET));
    if (!list) return 0;
    let hh = 0;
    for (const r of list) {
      const u = zz - r.z0;
      if (u < 0 || u > r.total) continue;
      const lx = Math.abs(x - r.x) - r.w / 2;
      if (lx > 0.6) continue;
      const sd = lx < 0 ? 1 : 1 - lx / 0.6;
      let v;
      if (u <= r.len) v = r.h * Math.pow(u / r.len, 1.25);
      else if (r.type !== 'table') v = 0;
      else if (u <= r.len + r.gap) v = r.h * 0.5;                                     // table deck
      else { const t = (u - r.len - r.gap) / r.land; v = r.h * 0.5 * (0.5 + 0.5 * Math.cos(Math.PI * t)); } // landing
      hh = Math.max(hh, v * sd);
    }
    return hh;
  }

  // banked turns: the outside of every bend is raised
  const bermAt = (x, zz, cx) => {
    const k = (cxMain(zz + 12) - 2 * cx + cxMain(zz - 12)) / 144;
    const amt = Math.min(1, Math.abs(k) * 900);
    if (amt < 0.05) return 0;
    const t = clamp01((-Math.sign(k) * (x - cx)) / HW);
    return amt * 3.2 * t * t * (1 - hpW(zz));
  };

  function groundH(x, zz) {
    let y = baseH(zz) + 0.45 * Math.sin(x * 0.11 + zz * 0.05) * Math.sin(zz * 0.07 - x * 0.03);
    const cx = cxMain(zz);
    const d = corridorD(x, zz);
    if (d > 0) y += 30 * (1 - Math.exp(-d * d / 450)) + 0.06 * d;
    y += bermAt(x, zz, cx);
    const w = hpW(zz);
    if (w > 0) { const t = clamp01((Math.abs(x - cx) - (HW - HP_W)) / HP_W); y += w * HP_WALL * t * t; }
    const mw = mogulW(zz);
    if (mw > 0) y += mw * 0.6 * Math.sin(x * 0.5 + zz * 0.12) * Math.sin(zz * 0.48 - x * 0.1) * clamp01(1 - d / 3);
    return y + rampH(x, zz);
  }

  // rails: height of the rail top (null if (x,z) is not on/next to it)
  function railTop(r, zz) { return groundH(r.x, zz) + r.h * Math.min(1, Math.max(0.25, (zz - r.z0) / 2.5)); }
  const railsNear = (zz) => railBuckets.get(Math.floor(zz / BUCKET)) || [];
  const obstaclesNear = (zz) => obBuckets.get(Math.floor(zz / BUCKET)) || [];

  // item boxes (party items): rows of three across the run
  const items = [], itemBuckets = new Map();
  if (opts.items !== false) {
    const RI = mulberry32(seed ^ 0x1234abcd);
    for (let zz = 140 + RI() * 60; zz < L - 120; zz += 190 + RI() * 60) {
      if (cliffs.some(c => zz > c.z0 + 10 && zz < c.z0 + 60)) continue;
      for (const lane of [-0.55, 0, 0.55]) {
        const x = cxMain(zz) + lane * HW, it = { i: items.length, x, z: zz, y: groundH(x, zz) + 1.1 };
        items.push(it); addB(itemBuckets, zz - 3, zz + 3, it);
      }
    }
  }
  const itemsNear = (zz) => itemBuckets.get(Math.floor(zz / BUCKET)) || [];

  // item box respawn state: a box hides for a while once grabbed, instead of being an infinite refill
  const BOX_RESPAWN = 9, BOX_POP = 0.35;
  const itemHiddenT = new Float32Array(items.length);
  const itemHidden = (i) => itemHiddenT[i] > 0.0001;
  const hideItem = (i) => { itemHiddenT[i] = BOX_RESPAWN; };
  const tickItems = (dt) => { for (let i = 0; i < itemHiddenT.length; i++) if (itemHiddenT[i] > 0) itemHiddenT[i] = Math.max(0, itemHiddenT[i] - dt); };
  // 0..1 instance scale: pops out when grabbed, pops back in just before it's live again
  const itemScale = (i) => {
    const t = itemHiddenT[i]; if (t <= 0) return 1;
    if (t > BOX_RESPAWN - BOX_POP) return Math.max(0, 1 - (BOX_RESPAWN - t) / BOX_POP);
    if (t < BOX_POP) return 1 - t / BOX_POP;
    return 0;
  };
  const hiddenIndices = () => { const out = []; for (let i = 0; i < itemHiddenT.length; i++) if (itemHiddenT[i] > 0) out.push(i); return out; };

  function nearestCenter(x, zz) {
    const m = cxMain(zz);
    if (scActive(zz)) { const s = cxBase(zz); if (Math.abs(x - s) < Math.abs(x - m)) return s; }
    return m;
  }

  return { seed, mapId, map, L, hw: HW, rampH, sections, shortcuts, halfpipe, pipes, pitches, rollers, mogulSecs, cliffs,
    cxMain, cxBase, scActive, scAt, hpW, mogulW, corridor, groundH, baseH, ramps, pads, obstacles, forest, gates, flags, signs,
    rails, railTop, railsNear, lifts, lights, obstaclesNear, nearestCenter, items, itemsNear,
    itemHidden, hideItem, tickItems, itemScale, hiddenIndices };
}
