// Mini-Golf Battle — course generation + ball physics (shared by host and clients)
// Balls roll on a height function (ramps, banks, hills, kickers, cup mounds), can go airborne,
// and interact with walls, bumpers, movers, surface zones (sand / ice / boost), portals and each other.
export const T = 5;            // tile size (world units)
export const BALL_R = 0.15;
export const BIG_R = 0.3;
export const CUP_R = 0.27;
export const WALL_TH = 0.25;
export const MAX_STROKES = 8;
export const G = 9.8;
// Ball feel (tunable: see tuning.js).
export const PHYS = { MAX_SPEED: 14, ROLL: 0.9, DAMP: 0.35, STOP: 0.12, CUP_SPEED: 4.6 };
const BANK_H = 0.55, KICK_H = 0.5, KICK_END = 1.5, GAP_END = 3.25;

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W
export const ITEMS = [null,
  { n: 'BIG BALL', i: '🔴', d: 'Huge + heavy for 12s' },
  { n: 'STICKY', i: '🟢', d: "Can't be pushed for 12s" },
  { n: 'SHOCKWAVE', i: '💥', d: 'Blast nearby balls away' },
  { n: 'MAGNET', i: '🧲', d: 'Cup pulls your ball for 12s' },
  { n: 'GHOST', i: '👻', d: 'Pass through balls & obstacles 10s' },
  { n: 'SWAP', i: '🔀', d: 'Swap places with the leader' },
  { n: 'ROCKET', i: '🚀', d: 'Re-launch while rolling' },
  { n: 'MINE', i: '💣', d: 'Drop a mine where you are' },
  { n: 'FREEZE', i: '❄️', d: 'Freeze everyone else 4s' },
];
export const MODS = {
  none: { name: '' },
  moon: { name: 'MOON GRAVITY', g: 0.35 },
  ice: { name: 'ICE RINK', fric: 0.45 },
  bigcup: { name: 'BIG CUP', cupR: 0.5 },
  bouncy: { name: 'SUPER BOUNCY', wallRest: 1.02 },
  turbo: { name: 'TURBO SHOTS', power: 1.35 },
  giant: { name: 'GIANT BALLS', baseR: 0.24 },
};
export const THEME_KEYS = ['meadow', 'beach', 'snow', 'canyon', 'neon'];

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (gx, gz) => gx + ',' + gz;
function dirIndex(dx, dz) { return DIRS.findIndex(d => d[0] === dx && d[1] === dz); }
const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

// opt: { theme: 0..4, mod: key of MODS, pickups: max power-up boxes }
export function generateHole(seed, idx, opt = {}) {
  const R = rng(seed);
  const theme = THEME_KEYS[(opt.theme | 0) % THEME_KEYS.length];
  const mod = MODS[opt.mod] ? opt.mod : 'none';
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const len = 5 + Math.floor(R() * 3) + Math.floor(idx / 3);

  // --- random walk path on a grid ---
  let path = null;
  for (let tries = 0; tries < 500 && !path; tries++) {
    const p = [{ gx: 0, gz: 0 }]; const used = new Set([key(0, 0)]); let dir = 0; let fail = false;
    for (let i = 1; i < len; i++) {
      const opts = (i === 1 || i === len - 1) ? [dir, dir, dir, (dir + 1) % 4, (dir + 3) % 4] : [dir, dir, (dir + 1) % 4, (dir + 3) % 4];
      const order = [...new Set(shuffle(opts.slice()))];
      let moved = false;
      for (const nd of order) {
        const g = { gx: p[i - 1].gx + DIRS[nd][0], gz: p[i - 1].gz + DIRS[nd][1] };
        if (!used.has(key(g.gx, g.gz))) { p.push(g); used.add(key(g.gx, g.gz)); dir = nd; moved = true; break; }
      }
      if (!moved) { fail = true; break; }
    }
    if (!fail) path = p;
  }

  const n = path.length;
  const tiles = path.map((p, i) => ({ ...p, i, cx: p.gx * T, cz: p.gz * T }));
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    const out = i < n - 1 ? dirIndex(tiles[i + 1].gx - t.gx, tiles[i + 1].gz - t.gz) : null;
    const inn = i > 0 ? dirIndex(t.gx - tiles[i - 1].gx, t.gz - tiles[i - 1].gz) : null;
    t.out = out ?? inn; t.inn = inn ?? out;
    t.d = DIRS[t.out]; t.din = DIRS[t.inn];
    t.straight = t.out === t.inn;
  }

  // --- assign piece types ---
  const weights = { plain: 0.4, ramp: 1.4, water: 1.3, slider: 1.0, spinner: 1.0, gate: 0.9, bumpers: 0.8, jump: 1.0, drop: 0.8, tunnel: 0.8, hill: 0.9, sand: 0.7, icepatch: 0.5, boost: 0.8 };
  if (theme === 'snow') { weights.icepatch = 1.8; weights.sand = 0.2; }
  if (theme === 'beach' || theme === 'canyon') { weights.sand = 1.8; weights.icepatch = 0.15; }
  if (theme === 'neon') { weights.boost = 1.6; weights.bumpers = 1.4; }
  const limits = { ramp: 2, jump: 1, drop: 1, tunnel: 1, hill: 1, icepatch: 1, boost: 1, sand: 2 };
  const count = {};
  let h = 0, prev = '';
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    t.h0 = h; t.h1 = h;
    if (i === 0) t.type = 'tee';
    else if (i === n - 1) { t.type = 'cup'; const r = R(); t.cupKind = r < 0.22 ? 'volcano' : r < 0.42 ? 'bowl' : 'flat'; }
    else if (t.straight) {
      let total = 0;
      const ent = Object.entries(weights).filter(([k]) => k !== prev && !((count[k] || 0) >= (limits[k] ?? 9)) && !(k === 'drop' && h <= -2) && !(k === 'jump' && i === 1));
      ent.forEach(([, w]) => total += w);
      let r = R() * total; t.type = ent[ent.length - 1][0];
      for (const [k, w] of ent) { if ((r -= w) < 0) { t.type = k; break; } }
      count[t.type] = (count[t.type] || 0) + 1;
      if (t.type === 'ramp') {
        const rise = h <= 0 ? 1 : h >= 2 ? -1 : (R() < 0.6 ? 1 : -1);
        t.h1 = h + rise; h = t.h1;
      } else if (t.type === 'drop') { t.h0 = t.h1 = h = h - 1; }
    } else { const r = R(); t.type = r < 0.45 ? 'bank' : r < 0.8 ? 'corner' : 'plain'; }
    prev = t.type;
    if (!t.straight) { // inner corner of the turn
      t.ic = [t.cx + (-t.din[0] + t.d[0]) * T / 2, t.cz + (-t.din[1] + t.d[1]) * T / 2];
    }
  }

  const m = MODS[mod];
  const hole = {
    seed, idx, theme, themeIdx: THEME_KEYS.indexOf(theme), mod, tiles, map: new Map(),
    walls: [], obbs: [], bumpers: [], movers: [], waters: [], pits: [], tees: [], pickups: [], tunnels: [], zones: [], portals: [], cup: null, par: 3,
    P: { g: m.g ?? 1, fric: m.fric ?? 1, cupR: m.cupR ?? CUP_R, wallRest: m.wallRest ?? 0.7, power: m.power ?? 1, baseR: m.baseR ?? BALL_R },
  };
  tiles.forEach(t => hole.map.set(key(t.gx, t.gz), t));

  const local = (t, a, l) => { const d = t.d; return [t.cx + d[0] * a - d[1] * l, t.cz + d[1] * a + d[0] * l]; };
  const localBox = (t, a, l, ha, hl) => { const [x, z] = local(t, a, l); return t.d[0] !== 0 ? { x, z, hx: ha, hz: hl } : { x, z, hx: hl, hz: ha }; };
  const tMin = t => Math.min(t.h0, t.h1) - (t.type === 'jump' ? 1.5 : t.cupKind === 'bowl' ? 0.25 : 0);
  const tMax = t => Math.max(t.h0, t.h1) + (t.type === 'bank' ? BANK_H : t.type === 'jump' ? 0.3 : 0);

  // --- border walls ---
  const wallSeen = new Map();
  for (const t of tiles) {
    for (let k = 0; k < 4; k++) {
      const [dx, dz] = DIRS[k];
      const nb = hole.map.get(key(t.gx + dx, t.gz + dz));
      if (nb && Math.abs(nb.i - t.i) === 1) continue;
      const x = t.cx + dx * T / 2, z = t.cz + dz * T / 2;
      const kk = x.toFixed(2) + ',' + z.toFixed(2);
      const y0 = tMin(t) - 0.25, y1 = tMax(t) + 0.35;
      if (wallSeen.has(kk)) { const w = wallSeen.get(kk); w.y0 = Math.min(w.y0, y0); w.y1 = Math.max(w.y1, y1); continue; }
      const w = dx !== 0 ? { x, z, hx: WALL_TH / 2, hz: T / 2 + WALL_TH / 2 } : { x, z, hx: T / 2 + WALL_TH / 2, hz: WALL_TH / 2 };
      w.y0 = y0; w.y1 = y1; w.kind = 'border';
      wallSeen.set(kk, w); hole.walls.push(w);
    }
  }

  // --- pieces ---
  const pickupCands = [], portalCands = [];
  for (const t of tiles) {
    const y = t.h0;
    if (t.type === 'water') {
      if (R() < 0.5) hole.waters.push({ ...localBox(t, 0, 0, 1.0, 1.1), y });
      else { const s = R() < 0.5 ? -1 : 1; hole.waters.push({ ...localBox(t, 0, s * 1.5, 1.5, 1.05), y }); pickupCands.push([t, 0, -s * 1.3]); }
    } else if (t.type === 'slider') {
      const cnt = R() < 0.5 ? 1 : 2;
      for (let j = 0; j < cnt; j++) {
        const a = cnt === 1 ? 0 : (j ? 1.0 : -1.0);
        const [x, z] = local(t, a, 0);
        const bx = localBox(t, 0, 0, 0.2, 0.6);
        hole.movers.push({ kind: 'slider', x, z, hx: bx.hx, hz: bx.hz, px: -t.d[1], pz: t.d[0], A: T / 2 - 0.6 - 0.2, w: Math.PI * 2 / (2.2 + R() * 1.6), ph: R() * 6.28, y });
      }
    } else if (t.type === 'spinner') {
      const w = (1.0 + R() * 1.0) * (R() < 0.5 ? -1 : 1);
      hole.movers.push({ kind: 'spinner', x: t.cx, z: t.cz, hx: 1.7, hz: 0.13, w, ph: R() * 6.28, y });
    } else if (t.type === 'gate') {
      const g = (R() * 2 - 1) * 1.4, gh = 0.62, L = T / 2;
      for (const [l0, l1] of [[-L, g - gh], [g + gh, L]]) {
        if (l1 - l0 < 0.05) continue;
        hole.walls.push({ ...localBox(t, 0, (l0 + l1) / 2, 0.12, (l1 - l0) / 2), y0: y - 0.1, y1: y + 0.35, kind: 'inner' });
      }
      pickupCands.push([t, 1.4, -g]);
    } else if (t.type === 'bumpers') {
      const cnt = 2 + Math.floor(R() * 2); const pts = [];
      for (let tries = 0; tries < 50 && pts.length < cnt; tries++) {
        const a = (R() * 2 - 1) * 1.5, l = (R() * 2 - 1) * 1.6;
        if (pts.every(p => Math.hypot(p[0] - a, p[1] - l) > 1.4)) pts.push([a, l]);
      }
      for (const [a, l] of pts) { const [x, z] = local(t, a, l); hole.bumpers.push({ x, z, r: 0.35, y }); }
    } else if (t.type === 'tunnel') {
      for (const s of [-1, 1]) hole.walls.push({ ...localBox(t, 0, s * 1.85, 1.8, 0.65), y0: y - 0.1, y1: y + 0.9, kind: 'tunnel' });
      hole.tunnels.push({ t, y });
      pickupCands.push([t, 0, 0]);
    } else if (t.type === 'jump') {
      hole.pits.push({ ...localBox(t, (KICK_END + GAP_END) / 2 - T / 2, 0, (GAP_END - KICK_END) / 2, T / 2), y });
    } else if (t.type === 'sand') {
      const s = R() < 0.5 ? 0 : (R() < 0.5 ? -0.9 : 0.9);
      hole.zones.push({ kind: 'sand', ...localBox(t, 0, s, 1.4, 1.5), y });
      pickupCands.push([t, 0, s > 0 ? -2.0 : 2.0]);
    } else if (t.type === 'icepatch') {
      hole.zones.push({ kind: 'ice', ...localBox(t, 0, 0, 1.9, T / 2 - 0.13), y });
      pickupCands.push([t, 0, (R() * 2 - 1) * 1.2]); portalCands.push(t);
    } else if (t.type === 'boost') {
      const l = (R() * 2 - 1) * 1.2;
      hole.zones.push({ kind: 'boost', ...localBox(t, -0.9, l, 0.7, 0.55), dx: t.d[0], dz: t.d[1], y });
    } else if (t.type === 'hill') {
      t.hc = local(t, 0, (R() * 2 - 1) * 0.5);
    } else if (t.type === 'drop' || t.type === 'plain') {
      pickupCands.push(t.straight ? [t, (R() * 2 - 1) * 1.2, (R() * 2 - 1) * 1.4] : [t, 0, 0]);
      portalCands.push(t);
    } else if (t.type === 'corner') {
      const di = t.din, dout = t.d, o = T / 2 - 0.8;
      hole.bumpers.push({ x: t.cx + (di[0] - dout[0]) * o, z: t.cz + (di[1] - dout[1]) * o, r: 0.5, y });
      portalCands.push(t);
    } else if (t.type === 'bank') {
      // curved outer wall: quarter circle (radius T) around the inner corner, made of rotated boxes
      const [icx, icz] = t.ic;
      const a0 = Math.atan2(t.cz - icz, t.cx - icx) - Math.PI / 4;
      const segs = 9, rad = T + WALL_TH / 2;
      for (let j = 0; j < segs; j++) {
        const a = a0 + (j + 0.5) / segs * Math.PI / 2;
        const hb = heightAtTile(t, icx + Math.cos(a) * (T - 0.2), icz + Math.sin(a) * (T - 0.2));
        hole.obbs.push({ x: icx + Math.cos(a) * rad, z: icz + Math.sin(a) * rad, hx: WALL_TH / 2, hz: rad * Math.PI / 4 / segs + 0.07, a, y0: y - 0.25, y1: hb + 0.38 });
      }
    } else if (t.type === 'cup') {
      const a = 0.6 + R() * 0.9, l = (R() * 2 - 1) * 1.3;
      const [x, z] = local(t, a, l);
      t.cc = [x, z];
      hole.cup = { x, z, y: heightAtTile(t, x, z) };
      if (t.cupKind === 'flat' && R() < 0.45) { const [bx, bz] = local(t, a - 1.1, l + (R() * 2 - 1) * 0.5); hole.bumpers.push({ x: bx, z: bz, r: 0.3, y }); }
      portalCands.push(t);
    } else if (t.type === 'tee') {
      for (let i = 0; i < 8; i++) {
        const row = Math.floor(i / 4), lat = -1.8 + (i % 4) * 1.2 + row * 0.6 - (row ? 0.3 : 0);
        const [x, z] = local(t, -1.4 + row * 0.8, lat);
        hole.tees.push({ x, z, y });
      }
    }
  }
  // one-way portal: a risky shortcut that skips a couple of tiles
  if (n >= 6 && R() < 0.45) {
    const As = portalCands.filter(t => t.i >= 1 && t.i <= n - 4 && t.type !== 'cup');
    shuffle(As);
    for (const A of As) {
      const B = portalCands.find(t => t.i >= A.i + 2 && t.i <= A.i + 3);
      if (!B) continue;
      const [ax, az] = A.straight ? local(A, 0.9, (R() < 0.5 ? -1 : 1) * 1.6) : local(A, 0.6, 0);
      const [bx, bz] = B.type === 'cup' ? local(B, -1.7, (R() * 2 - 1) * 1.2) : B.straight ? local(B, -1.3, (R() < 0.5 ? -1 : 1) * 1.2) : local(B, 0.6, 0);
      hole.portals.push({ ax, az, ay: A.h0, bx, bz, by: heightAtTile(B, bx, bz) });
      break;
    }
  }
  // make sure most tiles can host a power-up box
  for (const t of tiles) {
    if (t.i === 0 || t.i === n - 1 || pickupCands.some(c => c[0] === t)) continue;
    if (t.type === 'corner' || t.type === 'bank') pickupCands.push([t, 0.4, 0]);
    else if (t.type === 'ramp') pickupCands.push([t, 0, (R() * 2 - 1) * 1.4]);
    else if (t.type === 'slider' || t.type === 'bumpers') pickupCands.push([t, -2.0, (R() * 2 - 1) * 1.5]);
    else if (t.type === 'boost') pickupCands.push([t, 1.5, (R() * 2 - 1) * 1.5]);
    else if (t.type === 'water') pickupCands.push([t, -1.9, 0]);
  }
  // power-up boxes spread along the hole
  shuffle(pickupCands);
  const maxPk = opt.pickups ?? 3;
  for (const [t, a, l] of pickupCands) {
    if (hole.pickups.length >= maxPk) break;
    if (hole.pickups.some(p => Math.abs(p.ti - t.i) < (maxPk > 3 ? 1 : 2))) continue;
    const [x, z] = local(t, a, l);
    if (hole.portals.some(p => Math.hypot(p.ax - x, p.az - z) < 1 || Math.hypot(p.bx - x, p.bz - z) < 1)) continue;
    hole.pickups.push({ x, z, y: heightAtTile(t, x, z) ?? t.h0, ti: t.i });
  }

  // --- distances for bot planning ---
  const exits = [];
  for (let i = 0; i < n - 1; i++) { const t = tiles[i]; exits.push([t.cx + t.d[0] * T / 2, t.cz + t.d[1] * T / 2]); }
  hole.exits = exits;
  hole.remain = new Array(n).fill(0);
  let acc = 0; let last = [hole.cup.x, hole.cup.z];
  for (let i = n - 2; i >= 0; i--) { acc += Math.hypot(exits[i][0] - last[0], exits[i][1] - last[1]); hole.remain[i] = acc; last = exits[i]; }
  hole.par = Math.max(2, Math.min(5, Math.round(n / 2.2)));
  hole.minY = Math.min(...tiles.map(tMin)) - 1.2;
  return hole;
}

export function tileAt(hole, x, z) {
  return hole.map.get(key(Math.floor((x + T / 2) / T), Math.floor((z + T / 2) / T)));
}
// Floor height inside a given tile; null = no floor (jump gap)
function heightAtTile(t, x, z) {
  switch (t.type) {
    case 'bank': {
      const rho = Math.hypot(x - t.ic[0], z - t.ic[1]);
      const k = Math.max(0, Math.min(1, (rho - 2.6) / 2.4));
      // fade the banking out towards the entry and exit edges so it meets the neighbouring tiles flush
      const de = (x - t.cx) * t.din[0] + (z - t.cz) * t.din[1] + T / 2, dx = T / 2 - ((x - t.cx) * t.d[0] + (z - t.cz) * t.d[1]);
      return t.h0 + BANK_H * k * k * sm(de / 1.8) * sm(dx / 1.8);
    }
    case 'jump': {
      const s = (x - t.cx) * t.d[0] + (z - t.cz) * t.d[1] + T / 2;
      if (s <= KICK_END) return t.h0 + KICK_H * Math.max(0, s) / KICK_END;
      if (s < GAP_END) return null;
      return t.h0;
    }
    case 'hill': {
      const k = 1 - ((x - t.hc[0]) ** 2 + (z - t.hc[1]) ** 2) / (2.1 * 2.1);
      return t.h0 + (k > 0 ? 0.42 * k * k : 0);
    }
    case 'cup': {
      if (t.cupKind === 'flat' || !t.cc) return t.h0;
      const rr = Math.hypot(x - t.cc[0], z - t.cc[1]);
      return t.cupKind === 'volcano' ? t.h0 + 0.3 * sm(1 - rr / 1.7) : t.h0 - 0.22 * sm(1 - rr / 2.0);
    }
  }
  if (t.h0 === t.h1) return t.h0;
  let s = (x - t.cx) * t.d[0] + (z - t.cz) * t.d[1] + T / 2;
  s = Math.max(0, Math.min(T, s));
  return t.h0 + (t.h1 - t.h0) * s / T;
}
export function heightAt(hole, x, z) {
  const t = tileAt(hole, x, z); if (!t) return null;
  return heightAtTile(t, x, z);
}
function gradAt(hole, x, z) {
  const e = 0.04;
  const a = heightAt(hole, x + e, z), b = heightAt(hole, x - e, z), c = heightAt(hole, x, z + e), d = heightAt(hole, x, z - e);
  if (a === null || b === null || c === null || d === null) return [0, 0];
  const gx = (a - b) / (2 * e), gz = (c - d) / (2 * e);
  return [Math.abs(gx) < 1e-4 ? 0 : gx, Math.abs(gz) < 1e-4 ? 0 : gz];
}
export function zoneAt(hole, x, z) {
  for (const zn of hole.zones) if (Math.abs(x - zn.x) < zn.hx && Math.abs(z - zn.z) < zn.hz) return zn;
  return null;
}

export function moverPose(m, t) {
  if (m.kind === 'slider') { const o = Math.sin(m.w * t + m.ph) * m.A; return { x: m.x + m.px * o, z: m.z + m.pz * o, a: 0 }; }
  return { x: m.x, z: m.z, a: m.w * t + m.ph };
}

export function makeBall(id, x, z, y = 0, hole = null) {
  const b = { id, x, y, z, vx: 0, vy: 0, vz: 0, air: false, sunk: false, out: false, lastX: x, lastY: y, lastZ: z, strokes: 0, r: BALL_R, m: 1, big: 0, sticky: 0, magnet: 0, ghost: 0, frozen: 0, item: 0 };
  if (hole) applyEffects(b, hole);
  return b;
}
export const isResting = b => b.vx === 0 && b.vz === 0 && !b.air;
export function applyEffects(b, hole) { b.r = b.big > 0 ? BIG_R : hole.P.baseR; b.m = b.sticky > 0 ? 40 : b.big > 0 ? 3 : 1; }
export const shotSpeed = (hole, p) => p * PHYS.MAX_SPEED * hole.P.power;

function fx(b, kind, v) { if (v > (b.fxv || 0) || !b.fx) { b.fx = kind; b.fxv = v; } }

function respond(b, nx, nz, pen, rest, ovx = 0, ovz = 0, minOut = 0) {
  b.x += nx * pen; b.z += nz * pen;
  const rvx = b.vx - ovx, rvz = b.vz - ovz; const vn = rvx * nx + rvz * nz;
  if (vn < 0) { b.vx -= (1 + rest) * vn * nx; b.vz -= (1 + rest) * vn * nz; }
  if (minOut) { const out = (b.vx - ovx) * nx + (b.vz - ovz) * nz; if (out < minOut) { b.vx += (minOut - out) * nx; b.vz += (minOut - out) * nz; } }
  return -vn;
}

function circleBoxLocal(lx, lz, hx, hz, r) {
  const px = Math.max(-hx, Math.min(hx, lx)), pz = Math.max(-hz, Math.min(hz, lz));
  const dx = lx - px, dz = lz - pz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 < 1e-10) {
    const ox = hx - Math.abs(lx), oz = hz - Math.abs(lz);
    return ox < oz ? [Math.sign(lx) || 1, 0, ox + r, px, pz] : [0, Math.sign(lz) || 1, oz + r, px, pz];
  }
  const d = Math.sqrt(d2); return [dx / d, dz / d, r - d, px, pz];
}
function collideOBB(b, o, r, rest, ovel) {
  const dx = b.x - o.x, dz = b.z - o.z;
  if (dx * dx + dz * dz > (Math.hypot(o.hx, o.hz) + r) ** 2) return 0;
  const ca = Math.cos(o.a), sa = Math.sin(o.a);
  const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
  const c = circleBoxLocal(lx, lz, o.hx, o.hz, r);
  if (!c) return 0;
  const nx = c[0] * ca - c[1] * sa, nz = c[0] * sa + c[1] * ca;
  const [ovx, ovz] = ovel ? ovel(c[3], c[4]) : [0, 0];
  return respond(b, nx, nz, c[2], rest, ovx, ovz) || 0.01;
}

// Advance one ball by dt. Returns 'sunk' | 'water' | 'fell' | null
export function stepBall(hole, b, t, dt) {
  if (b.sunk || b.out || b.hold) return null;
  const P = hole.P, r = b.r || BALL_R, sticky = b.sticky > 0, ghost = b.ghost > 0, GR = G * P.g;
  if (!tileAt(hole, b.x, b.z)) return 'fell';
  const g0 = heightAt(hole, b.x, b.z);
  // grounded balls stay grounded through small height changes (e.g. after being pushed sideways on a bank)
  const onGround = g0 !== null && (b.y <= g0 + 0.003 || (!b.air && b.y <= g0 + 0.25));
  if (b.frozen > 0 && onGround) { b.vx = b.vy = b.vz = 0; b.y = g0; b.air = false; return null; }
  let sp = Math.hypot(b.vx, b.vz);
  if (onGround) {
    b.air = false; b.y = g0;
    const [gx, gz] = gradAt(hole, b.x, b.z);
    const gm = Math.hypot(gx, gz);
    const zone = zoneAt(hole, b.x, b.z);
    const fr = P.fric * (sticky ? 4 : 1) * (zone ? (zone.kind === 'sand' ? 5 : zone.kind === 'ice' ? 0.12 : 1) : 1);
    if (zone && zone.kind !== b.zk && zone.kind === 'sand' && sp > 1) fx(b, 'sand', sp);
    b.zk = zone ? zone.kind : '';
    let boosting = false;
    if (zone && zone.kind === 'boost' && b.vx * zone.dx + b.vz * zone.dz < 12) {
      b.vx += zone.dx * 30 * dt; b.vz += zone.dz * 30 * dt; boosting = true;
      if (!b.bst) fx(b, 'boost', 9);
    }
    b.bst = boosting;
    // static friction holds the ball on gentle slopes; otherwise gravity pulls it downhill
    const holds = GR * gm < PHYS.ROLL * fr * 0.9;
    if (gm > 0 && !(holds && sp < PHYS.STOP) && !(sticky && sp < 0.5)) {
      const k = GR / Math.sqrt(1 + gm * gm);
      b.vx -= k * gx * dt; b.vz -= k * gz * dt;
    }
    if (b.magnet > 0) {
      const mx = hole.cup.x - b.x, mz = hole.cup.z - b.z, md = Math.hypot(mx, mz);
      if (md < 3.5 && md > 0.05 && sp > 0) { const a = 11 * (1 - md / 3.5); b.vx += mx / md * a * dt; b.vz += mz / md * a * dt; }
    }
    sp = Math.hypot(b.vx, b.vz);
    if (sp > 0) {
      const dec = (PHYS.ROLL * fr + PHYS.DAMP * Math.min(fr, 2) * sp) * dt; const ns = Math.max(0, sp - dec);
      b.vx *= ns / sp; b.vz *= ns / sp; sp = ns;
    }
    if (holds && sp < PHYS.STOP && !boosting) { b.vx = 0; b.vz = 0; sp = 0; }
    // vertical speed follows the slope under the *current* velocity (so bounces off walls can't launch the ball)
    b.vy = Math.max(-8, Math.min(8, gx * b.vx + gz * b.vz));
  } else {
    b.air = true; b.vy -= GR * dt;
  }
  if (sp > PHYS.MAX_SPEED * 1.5) { const f = PHYS.MAX_SPEED * 1.5 / sp; b.vx *= f; b.vz *= f; sp *= f; }
  const ox = b.x, oz = b.z;
  b.x += b.vx * dt; b.z += b.vz * dt;
  // cliff faces: can't move into floor that's well above the ball
  let g1 = heightAt(hole, b.x, b.z);
  if (g1 !== null && g1 > b.y + 0.15) {
    const hx = heightAt(hole, b.x, oz);
    if (hx !== null && hx > b.y + 0.15) { b.x = ox; b.vx = -b.vx * 0.45; } else { b.z = oz; b.vz = -b.vz * 0.45; }
    fx(b, 'wall', sp);
    g1 = heightAt(hole, b.x, b.z);
    if (g1 !== null && g1 > b.y + 0.15) { b.x = ox; b.z = oz; g1 = g0; }
  }
  // vertical motion
  const yBall = b.y + b.vy * dt;
  if (onGround) {
    // only leave the ground at real edges (kicker lip, drop); stay glued over smooth bumps so the ball never 'pops'
    if (g1 === null || yBall > g1 + 0.25 || b.y > g1 + 0.25) { b.y = yBall; b.air = true; }
    else b.y = g1;
  } else if (g1 !== null && yBall <= g1) {                                 // landing
    b.y = g1;
    if (b.vy < -2.5) { fx(b, 'land', -b.vy); b.vy = -b.vy * 0.3; b.y = g1 + 0.004; b.vx *= 0.9; b.vz *= 0.9; }
    else { b.vy = 0; b.air = false; }
  } else b.y = yBall;

  // walls & static rotated boxes
  const wr = sticky ? 0.15 : P.wallRest;
  for (const w of hole.walls) {
    if (Math.abs(b.x - w.x) > w.hx + r || Math.abs(b.z - w.z) > w.hz + r) continue;
    if (w.kind !== 'border' && b.y > w.y1 + 0.1) continue;
    const c = circleBoxLocal(b.x - w.x, b.z - w.z, w.hx, w.hz, r);
    if (c) fx(b, 'wall', respond(b, c[0], c[1], c[2], wr));
  }
  for (const o of hole.obbs) { const v = collideOBB(b, o, r, wr); if (v) fx(b, 'wall', v); }
  if (!ghost) {
    for (const m of hole.bumpers) {
      if (b.y > m.y + 0.45) continue;
      const dx = b.x - m.x, dz = b.z - m.z, d = Math.hypot(dx, dz), rr = m.r + r;
      if (d < rr && d > 1e-6) fx(b, 'bumper', respond(b, dx / d, dz / d, rr - d, sticky ? 0.3 : 1.0, 0, 0, sticky ? 0 : 3.5) + 2);
    }
    for (const m of hole.movers) {
      if (b.y > m.y + 0.5) continue;
      const p = moverPose(m, t);
      const o = { x: p.x, z: p.z, a: p.a, hx: m.hx, hz: m.hz };
      const v = collideOBB(b, o, r, 0.6, (cx, cz) => {
        const e = 1 / 240, p2 = moverPose(m, t + e), ca = Math.cos(p.a), sa = Math.sin(p.a), c2 = Math.cos(p2.a), s2 = Math.sin(p2.a);
        return [((p2.x + cx * c2 - cz * s2) - (p.x + cx * ca - cz * sa)) / e, ((p2.z + cx * s2 + cz * c2) - (p.z + cx * sa + cz * ca)) / e];
      });
      if (v) fx(b, 'wall', v + 1);
    }
  }
  if (b.air) {
    const ref = tileAt(hole, b.x, b.z);
    if (!ref) return 'fell';
    if (b.y < Math.min(ref.h0, ref.h1) - 0.9) return 'fell';
    return null;
  }
  for (const p of hole.portals) {
    if (sp > 0.3 && Math.abs(b.y - p.ay) < 0.3 && Math.hypot(b.x - p.ax, b.z - p.az) < 0.42) {
      b.x = p.bx; b.z = p.bz; b.y = p.by; b.fx = 'portal'; b.fxv = 9; b.tp = [p.ax, p.ay, p.az];
      return null;
    }
  }
  const cup = hole.cup;
  if (Math.abs(b.y - cup.y) < 0.2) {
    const cdx = cup.x - b.x, cdz = cup.z - b.z, cd = Math.hypot(cdx, cdz);
    if (cd < P.cupR + BALL_R * 0.6 && cd > 1e-6) { b.vx += cdx / cd * 7 * dt; b.vz += cdz / cd * 7 * dt; }
    if (cd < P.cupR && sp < PHYS.CUP_SPEED * (b.magnet > 0 ? 1.6 : 1) * (P.cupR / CUP_R)) { b.sunk = true; b.vx = b.vy = b.vz = 0; b.x = cup.x; b.z = cup.z; return 'sunk'; }
  }
  for (const w of hole.waters) {
    if (Math.abs(b.x - w.x) < w.hx && Math.abs(b.z - w.z) < w.hz && b.y < w.y + 0.1) return 'water';
  }
  // pinned against something on a slope: call it resting so the player can always shoot
  if (b.vx * b.vx + b.vz * b.vz < 0.0064) { b.slow = (b.slow || 0) + dt; if (b.slow > 0.35) { b.vx = 0; b.vz = 0; } } else b.slow = 0;
  return null;
}

// Ball-ball collisions. Marks the slower ball's `newHit` with the faster ball's id (for KO credit).
export function collideBalls(balls) {
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]; if (a.sunk || a.out || a.hold || a.ghost > 0) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j]; if (b.sunk || b.out || b.hold || b.ghost > 0) continue;
      const D = (a.r || BALL_R) + (b.r || BALL_R);
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 >= D * D || d2 < 1e-12 || Math.abs(a.y - b.y) > D) continue;
      const ia = a.frozen > 0 ? 0.02 : 1 / (a.m || 1), ib = b.frozen > 0 ? 0.02 : 1 / (b.m || 1), it = ia + ib;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = D - d;
      a.x -= nx * pen * ia / it; a.z -= nz * pen * ia / it; b.x += nx * pen * ib / it; b.z += nz * pen * ib / it;
      const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (vn < 0) {
        const sa = Math.hypot(a.vx, a.vz), sb = Math.hypot(b.vx, b.vz);
        if (sa > sb) b.newHit = a.id; else a.newHit = b.id;
        const jj = -(1 + 0.92) * vn / it;
        a.vx -= jj * ia * nx; a.vz -= jj * ia * nz; b.vx += jj * ib * nx; b.vz += jj * ib * nz;
        fx(a, 'clack', -vn); fx(b, 'clack', -vn);
      }
    }
  }
}

// radial blast (shockwave / mine): push balls away from (x,z)
export function blast(balls, x, z, y, radius, power, skip = null, by = null) {
  for (const b of balls) {
    if (b === skip || b.sunk || b.out || b.ghost > 0) continue;
    const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
    if (d > radius || Math.abs(b.y - y) > 1.5) continue;
    const k = 1 - d / radius, s = (3 + power * k) / (b.sticky > 0 ? 6 : 1);
    const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
    b.vx += nx * s; b.vz += nz * s; b.vy = Math.max(b.vy, 2.5 * k); b.y += 0.01; b.air = true; b.frozen = 0;
    if (by) b.newHit = by;
  }
}

// Progress cost for bots: approximate rolling distance left to the cup
export function distToCup(hole, x, z) {
  const t = tileAt(hole, x, z); if (!t) return 999;
  const n = hole.tiles.length;
  if (t.i === n - 1) return Math.hypot(hole.cup.x - x, hole.cup.z - z);
  const e = hole.exits[t.i];
  return Math.hypot(e[0] - x, e[1] - z) + hole.remain[t.i];
}

// Bot shot planner: simulate candidate shots against static geometry, pick the best
export function planShot(hole, ball, t0, skill = 1, budget = 1) {
  const sim = { ...ball };
  const n = hole.tiles.length; const cur = tileAt(hole, ball.x, ball.z); const ci = cur ? cur.i : 0;
  const targets = [[hole.cup.x, hole.cup.z]];
  for (let i = ci; i < Math.min(n - 1, ci + 3); i++) targets.push(hole.exits[i]);
  for (const p of hole.portals) targets.push([p.ax, p.az]);
  const angles = [];
  const offs = budget >= 1 ? [-0.24, -0.12, -0.05, 0, 0.05, 0.12, 0.24] : [-0.15, 0, 0.15];
  for (const [tx, tz] of targets) {
    const base = Math.atan2(tz - ball.z, tx - ball.x);
    for (const off of offs) angles.push(base + off);
  }
  for (let i = 0; i < (budget >= 1 ? 8 : 3); i++) angles.push(Math.random() * Math.PI * 2);
  const powers = budget >= 1 ? [0.12, 0.2, 0.3, 0.42, 0.56, 0.72, 0.88, 1.0] : [0.15, 0.3, 0.5, 0.75, 1.0];
  let best = null, bestCost = Infinity;
  const dt = 1 / 90;
  for (const a of angles) for (const p of powers) {
    Object.assign(sim, ball); sim.sunk = false; sim.out = false; sim.fx = null; sim.frozen = 0;
    const s = shotSpeed(hole, p);
    sim.vx = Math.cos(a) * s; sim.vz = Math.sin(a) * s;
    let cost = 0, tt = 0, ev = null;
    for (; tt < 7; tt += dt) {
      ev = stepBall(hole, sim, t0 + tt, dt);
      if (ev || isResting(sim)) break;
    }
    if (ev === 'sunk') cost = -100 + tt;
    else if (ev) cost = 500;
    else cost = distToCup(hole, sim.x, sim.z) + (isResting(sim) ? 0 : 2);
    cost += Math.random() * 0.3;
    if (cost < bestCost) { bestCost = cost; best = { a, p }; }
  }
  const noise = (1 - skill) * 0.15 + 0.03;
  return { a: best.a + (Math.random() * 2 - 1) * noise, p: Math.min(1, best.p * (1 + (Math.random() * 2 - 1) * noise)) };
}

// Play the hole with a solo bot (no timer, no opponents). Returns strokes or null if it failed.
export function botRun(hole, skill = 0.8) {
  const tee = hole.tees[0];
  const b = makeBall('par', tee.x, tee.z, tee.y, hole);
  let t = 0, strokes = 0;
  const dt = 1 / 120;
  while (strokes < MAX_STROKES) {
    const sh = planShot(hole, b, t, skill, 0.5);
    strokes++; b.lastX = b.x; b.lastY = b.y; b.lastZ = b.z;
    const s = shotSpeed(hole, sh.p);
    b.vx = Math.cos(sh.a) * s; b.vz = Math.sin(sh.a) * s;
    for (let k = 0; k < 120 * 10; k++) {
      t += dt; const ev = stepBall(hole, b, t, dt);
      if (ev === 'sunk') return strokes;
      if (ev) { strokes++; b.x = b.lastX; b.y = b.lastY; b.z = b.lastZ; b.vx = b.vy = b.vz = 0; b.air = false; break; }
      if (isResting(b)) break;
    }
    t += 1;
  }
  return null;
}
