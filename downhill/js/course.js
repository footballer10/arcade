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

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const HW_MAIN = 16;   // half width of the groomed main run
export const HW_SC = 5;      // half width of the shortcut
const BUCKET = 20;

export function makeCourse(seed) {
  const R = mulberry32(seed);
  const L = 2750;
  const p1 = R() * 6.28, p2 = R() * 6.28, p3 = R() * 6.28;
  const a1 = 22 + R() * 18, a2 = 5 + R() * 7;
  const scLen = 380;
  const scZ0 = Math.round(L * (0.33 + R() * 0.22));
  const scB = (R() < 0.5 ? -1 : 1) * (80 + R() * 20);

  const cxBase = (z) => smooth(0, 160, z) * (a1 * Math.sin(z / 190 + p1) + a2 * Math.sin(z / 70 + p2));
  const bulge = (z) => {
    if (z <= scZ0 || z >= scZ0 + scLen) return 0;
    const s = Math.sin(Math.PI * (z - scZ0) / scLen);
    return scB * s * s;
  };
  const cxMain = (z) => cxBase(z) + bulge(z);
  const scActive = (z) => z > scZ0 && z < scZ0 + scLen;

  const HL = -(0.3 * L + 14 * Math.sin(L / 210 + p3) - 14 * Math.sin(p3));
  function baseH(z) {
    if (z <= L) return -(0.3 * z + 14 * Math.sin(z / 210 + p3) - 14 * Math.sin(p3));
    let h = HL - 0.05 * (z - L);
    if (z > L + 200) h += (z - L - 200) * (z - L - 200) * 0.05; // end wall of the runout
    return h;
  }

  // Returns signed distance outside the nearest corridor (<=0 means inside a run).
  function corridor(x, z) {
    const dm = Math.abs(x - cxMain(z)) - HW_MAIN;
    let ds = 1e9;
    if (scActive(z)) ds = Math.abs(x - cxBase(z)) - HW_SC;
    return { d: Math.min(dm, ds), groomed: dm <= 0, shortcut: ds <= 0 && dm > 0 };
  }
  function corridorD(x, z) {
    const dm = Math.abs(x - cxMain(z)) - HW_MAIN;
    if (!scActive(z)) return dm;
    return Math.min(dm, Math.abs(x - cxBase(z)) - HW_SC);
  }

  const ramps = [], pads = [], obstacles = [], gates = [], flags = [];
  const rampBuckets = new Map(), obBuckets = new Map();
  const addB = (map, z0, z1, item) => {
    for (let b = Math.floor(z0 / BUCKET); b <= Math.floor(z1 / BUCKET); b++) {
      if (!map.has(b)) map.set(b, []);
      map.get(b).push(item);
    }
  };
  const blocked = []; // z/x regions where obstacles should not spawn
  const isBlocked = (x, z) => blocked.some(b => Math.abs(z - b.z) < b.rz && Math.abs(x - b.x) < b.rx);

  // Jumps
  const nR = 9;
  for (let i = 0; i < nR; i++) {
    const z = 220 + (i + R() * 0.6) * ((L - 400) / nR);
    if (z > scZ0 - 30 && z < scZ0 + scLen + 30) continue;
    const x = cxMain(z) + (R() - 0.5) * HW_MAIN * 1.1;
    const big = R() < 0.4;
    ramps.push({ x, z0: z, len: big ? 9 : 7, w: big ? 9 : 8, h: big ? 3.6 : 2.6 });
  }
  // two ramps on the main route through the shortcut section, and one on the shortcut
  for (const u of [0.3, 0.7]) {
    const z = scZ0 + scLen * u;
    ramps.push({ x: cxMain(z), z0: z, len: 7, w: 8, h: 2.4 });
  }
  ramps.push({ x: cxBase(scZ0 + scLen * 0.45), z0: scZ0 + scLen * 0.45, len: 8, w: 7, h: 3.2 });
  for (const r of ramps) {
    addB(rampBuckets, r.z0, r.z0 + r.len, r);
    blocked.push({ x: r.x, z: r.z0, rx: r.w, rz: 35 });
  }

  // Boost pads
  for (let i = 0; i < 11; i++) {
    const z = 150 + (i + R() * 0.7) * ((L - 250) / 11);
    const x = cxMain(z) + (R() - 0.5) * HW_MAIN * 1.2;
    pads.push({ x, z });
  }
  for (const u of [0.2, 0.75, 0.92]) { const z = scZ0 + scLen * u; pads.push({ x: cxBase(z), z }); }
  for (const p of pads) blocked.push({ x: p.x, z: p.z, rx: 5, rz: 22 });

  // Gates along the main route
  let alt = 1;
  for (let z = 80; z < L - 40; z += 115) {
    const off = alt * 4.5; alt = -alt;
    gates.push({ x: cxMain(z) + off, z, hw: 6.5, color: alt > 0 ? 0xe5484d : 0x3e7bff });
    blocked.push({ x: cxMain(z) + off, z, rx: 8, rz: 10 });
  }
  // Yellow flags along the shortcut
  for (let z = scZ0 + 40; z < scZ0 + scLen - 20; z += 30) {
    flags.push({ x: cxBase(z) - HW_SC - 0.5, z }, { x: cxBase(z) + HW_SC + 0.5, z });
  }
  blocked.push({ x: 0, z: 30, rx: 999, rz: 70 });       // start area clear
  blocked.push({ x: 0, z: L, rx: 999, rz: 40 });         // finish clear

  // Obstacles in the runs (rocks + lone trees)
  const addOb = (o) => { obstacles.push(o); addB(obBuckets, o.z - o.r, o.z + o.r, o); };
  for (let i = 0; i < 34; i++) {
    const z = 120 + R() * (L - 200);
    const x = cxMain(z) + (R() - 0.5) * 2 * (HW_MAIN - 2);
    if (isBlocked(x, z)) continue;
    const tree = R() < 0.35;
    addOb({ x, z, r: tree ? 0.9 : 0.9 + R() * 1.1, h: tree ? 9 : 1.4 + R() * 0.8, type: tree ? 'tree' : 'rock' });
  }
  for (let i = 0; i < 6; i++) {
    const z = scZ0 + 30 + R() * (scLen - 60);
    const x = cxBase(z) + (R() - 0.5) * 2 * (HW_SC - 1.5);
    if (isBlocked(x, z)) continue;
    addOb({ x, z, r: 0.8 + R() * 0.5, h: 1.3, type: 'rock' });
  }
  // Forest lining the runs (outside corridors). Only near ones are collidable.
  const forest = [];
  for (let z = -40; z < L + 220; z += 3) {
    let lo = Math.min(cxMain(z), cxBase(z)) - HW_MAIN - 45;
    let hi = Math.max(cxMain(z), cxBase(z)) + HW_MAIN + 45;
    for (let k = 0; k < 5; k++) {
      const x = lo + R() * (hi - lo);
      const zz = z + R() * 3;
      const d = corridorD(x, zz);
      const s = 0.7 + R() * 0.7;
      if (d < 1.7 * s) continue;
      const t = { x, z: zz, r: 0.8 * s, h: 9 * s, s, type: 'tree' };
      forest.push(t);
      if (d < 12) addB(obBuckets, zz - t.r, zz + t.r, t);
    }
  }

  function rampH(x, z) {
    const list = rampBuckets.get(Math.floor(z / BUCKET));
    if (!list) return 0;
    let h = 0;
    for (const r of list) {
      const u = (z - r.z0) / r.len;
      if (u < 0 || u > 1) continue;
      const lx = Math.abs(x - r.x) - r.w / 2;
      if (lx > 0.6) continue;
      const side = lx < 0 ? 1 : 1 - lx / 0.6;
      h = Math.max(h, r.h * Math.pow(u, 1.25) * side);
    }
    return h;
  }

  function groundH(x, z) {
    let h = baseH(z) + 0.45 * Math.sin(x * 0.11 + z * 0.05) * Math.sin(z * 0.07 - x * 0.03);
    const d = corridorD(x, z);
    if (d > 0) h += d * d * 0.035 + d * 0.25;
    return h + rampH(x, z);
  }

  function obstaclesNear(z) {
    return obBuckets.get(Math.floor(z / BUCKET)) || [];
  }

  // Centre of the nearest run (used for respawn and bots)
  function nearestCenter(x, z) {
    const m = cxMain(z);
    if (scActive(z)) { const s = cxBase(z); if (Math.abs(x - s) < Math.abs(x - m)) return s; }
    return m;
  }

  return { seed, L, scZ0, scLen, scB, cxMain, cxBase, scActive, corridor, groundH, baseH,
    ramps, pads, obstacles, forest, gates, flags, obstaclesNear, nearestCenter };
}
