// Mini-Golf Battle — course generation + 2.5D ball physics (shared by host and clients)
export const T = 5;            // tile size (world units)
export const BALL_R = 0.15;
export const CUP_R = 0.27;
export const WALL_TH = 0.25;
export const MAX_SPEED = 14;
export const MAX_STROKES = 8;
export const HOLE_TIME = 60;
export const G = 9.8;
const ROLL = 0.9, DAMP = 0.35, STOP = 0.12, CUP_SPEED = 4.6;

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W

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

export function generateHole(seed, idx) {
  const R = rng(seed);
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
    t.d = DIRS[t.out];
    t.straight = t.out === t.inn;
  }

  // --- assign piece types ---
  const weights = { plain: 0.8, ramp: 2, water: 1.6, slider: 1.3, spinner: 1.1, gate: 1.3, bumpers: 1.2 };
  let h = 0, ramps = 0, prev = '';
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    t.h0 = h; t.h1 = h;
    if (i === 0) t.type = 'tee';
    else if (i === n - 1) t.type = 'cup';
    else if (t.straight) {
      let total = 0; const ent = Object.entries(weights).filter(([k]) => k !== prev && !(k === 'ramp' && ramps >= 2));
      ent.forEach(([, w]) => total += w);
      let r = R() * total; t.type = ent[ent.length - 1][0];
      for (const [k, w] of ent) { if ((r -= w) < 0) { t.type = k; break; } }
      if (t.type === 'ramp') {
        ramps++;
        const rise = h <= 0 ? 1 : h >= 2 ? -1 : (R() < 0.6 ? 1 : -1);
        t.h1 = h + rise; h = t.h1;
      }
    } else t.type = R() < 0.65 ? 'corner' : 'plain';
    prev = t.type;
  }

  const hole = { seed, idx, tiles, map: new Map(), walls: [], bumpers: [], movers: [], waters: [], tees: [], cup: null, par: 0 };
  tiles.forEach(t => hole.map.set(key(t.gx, t.gz), t));

  const local = (t, a, l) => { const d = t.d; return [t.cx + d[0] * a - d[1] * l, t.cz + d[1] * a + d[0] * l]; };
  const localBox = (t, a, l, ha, hl) => { const [x, z] = local(t, a, l); return t.d[0] !== 0 ? { x, z, hx: ha, hz: hl } : { x, z, hx: hl, hz: ha }; };
  const tMin = t => Math.min(t.h0, t.h1), tMax = t => Math.max(t.h0, t.h1);

  // --- border walls ---
  const wallSeen = new Map();
  for (const t of tiles) {
    for (let k = 0; k < 4; k++) {
      const [dx, dz] = DIRS[k];
      const nb = hole.map.get(key(t.gx + dx, t.gz + dz));
      if (nb && Math.abs(nb.i - t.i) === 1) continue;
      const x = t.cx + dx * T / 2, z = t.cz + dz * T / 2;
      const kk = x.toFixed(2) + ',' + z.toFixed(2);
      let y0 = tMin(t) - 0.25, y1 = tMax(t) + 0.35;
      if (wallSeen.has(kk)) { const w = wallSeen.get(kk); w.y0 = Math.min(w.y0, y0); w.y1 = Math.max(w.y1, y1); continue; }
      const w = dx !== 0 ? { x, z, hx: WALL_TH / 2, hz: T / 2 + WALL_TH / 2 } : { x, z, hx: T / 2 + WALL_TH / 2, hz: WALL_TH / 2 };
      w.y0 = y0; w.y1 = y1; w.kind = 'border';
      wallSeen.set(kk, w); hole.walls.push(w);
    }
  }

  // --- pieces ---
  for (const t of tiles) {
    const y = t.h0;
    if (t.type === 'water') {
      if (R() < 0.5) hole.waters.push({ ...localBox(t, 0, 0, 1.0, 1.1), y });
      else { const s = R() < 0.5 ? -1 : 1; hole.waters.push({ ...localBox(t, 0, s * 1.5, 1.5, 1.05), y }); }
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
      const segs = [[-L, g - gh], [g + gh, L]];
      for (const [l0, l1] of segs) {
        if (l1 - l0 < 0.05) continue;
        hole.walls.push({ ...localBox(t, 0, (l0 + l1) / 2, 0.12, (l1 - l0) / 2), y0: y - 0.1, y1: y + 0.35, kind: 'inner' });
      }
    } else if (t.type === 'bumpers') {
      const cnt = 2 + Math.floor(R() * 2); const pts = [];
      for (let tries = 0; tries < 50 && pts.length < cnt; tries++) {
        const a = (R() * 2 - 1) * 1.5, l = (R() * 2 - 1) * 1.6;
        if (pts.every(p => Math.hypot(p[0] - a, p[1] - l) > 1.4)) pts.push([a, l]);
      }
      for (const [a, l] of pts) { const [x, z] = local(t, a, l); hole.bumpers.push({ x, z, r: 0.35, y }); }
    } else if (t.type === 'corner') {
      const di = DIRS[t.inn], dout = DIRS[t.out], o = T / 2 - 0.8;
      hole.bumpers.push({ x: t.cx + (di[0] - dout[0]) * o, z: t.cz + (di[1] - dout[1]) * o, r: 0.5, y });
    } else if (t.type === 'cup') {
      const a = 0.6 + R() * 0.9, l = (R() * 2 - 1) * 1.3;
      const [x, z] = local(t, a, l);
      hole.cup = { x, z, y };
      if (R() < 0.4) { const [bx, bz] = local(t, a - 1.1, l + (R() * 2 - 1) * 0.5); hole.bumpers.push({ x: bx, z: bz, r: 0.3, y }); }
    } else if (t.type === 'tee') {
      for (let i = 0; i < 8; i++) {
        const row = Math.floor(i / 4), lat = -1.8 + (i % 4) * 1.2 + row * 0.6 - (row ? 0.3 : 0);
        const [x, z] = local(t, -1.4 + row * 0.8, lat);
        hole.tees.push({ x, z });
      }
    }
  }

  // --- distances for bot planning ---
  const exits = [];
  for (let i = 0; i < n - 1; i++) { const t = tiles[i]; exits.push([t.cx + t.d[0] * T / 2, t.cz + t.d[1] * T / 2]); }
  hole.exits = exits;
  hole.remain = new Array(n).fill(0); // distance from exit of tile i to cup
  let acc = 0; let last = [hole.cup.x, hole.cup.z];
  for (let i = n - 2; i >= 0; i--) { acc += Math.hypot(exits[i][0] - last[0], exits[i][1] - last[1]); hole.remain[i] = acc; last = exits[i]; }
  hole.par = Math.max(2, Math.min(5, Math.round(n / 2.2)));
  return hole;
}

export function tileAt(hole, x, z) {
  return hole.map.get(key(Math.floor((x + T / 2) / T), Math.floor((z + T / 2) / T)));
}
export function heightAt(hole, x, z) {
  const t = tileAt(hole, x, z); if (!t) return 0;
  if (t.h0 === t.h1) return t.h0;
  let s = (x - t.cx) * t.d[0] + (z - t.cz) * t.d[1] + T / 2;
  s = Math.max(0, Math.min(T, s));
  return t.h0 + (t.h1 - t.h0) * s / T;
}

export function moverPose(m, t) {
  if (m.kind === 'slider') { const o = Math.sin(m.w * t + m.ph) * m.A; return { x: m.x + m.px * o, z: m.z + m.pz * o, a: 0 }; }
  return { x: m.x, z: m.z, a: m.w * t + m.ph };
}

export function makeBall(id, x, z) { return { id, x, z, vx: 0, vz: 0, sunk: false, out: false, lastX: x, lastZ: z, strokes: 0 }; }
export const isResting = b => b.vx === 0 && b.vz === 0;

function respond(b, nx, nz, pen, rest, ovx = 0, ovz = 0, minOut = 0) {
  b.x += nx * pen; b.z += nz * pen;
  const rvx = b.vx - ovx, rvz = b.vz - ovz; const vn = rvx * nx + rvz * nz;
  if (vn < 0) { b.vx -= (1 + rest) * vn * nx; b.vz -= (1 + rest) * vn * nz; }
  if (minOut) { const out = (b.vx - ovx) * nx + (b.vz - ovz) * nz; if (out < minOut) { b.vx += (minOut - out) * nx; b.vz += (minOut - out) * nz; } }
}

// circle vs box in a local frame (box centered at origin, half extents hx,hz). Returns [nx,nz,pen] local or null
function circleBoxLocal(lx, lz, hx, hz) {
  const px = Math.max(-hx, Math.min(hx, lx)), pz = Math.max(-hz, Math.min(hz, lz));
  const dx = lx - px, dz = lz - pz, d2 = dx * dx + dz * dz;
  if (d2 >= BALL_R * BALL_R) return null;
  if (d2 < 1e-10) {
    const ox = hx - Math.abs(lx), oz = hz - Math.abs(lz);
    return ox < oz ? [Math.sign(lx) || 1, 0, ox + BALL_R] : [0, Math.sign(lz) || 1, oz + BALL_R];
  }
  const d = Math.sqrt(d2); return [dx / d, dz / d, BALL_R - d];
}

// Advance one ball by dt. Returns 'sunk' | 'water' | null
export function stepBall(hole, b, t, dt) {
  if (b.sunk || b.out) return null;
  const tile = tileAt(hole, b.x, b.z);
  if (!tile) return 'water';
  let gx = 0, gz = 0;
  if (tile.h0 !== tile.h1) { const s = (tile.h1 - tile.h0) / T; gx = s * tile.d[0]; gz = s * tile.d[1]; }
  const slope = gx !== 0 || gz !== 0;
  const k = G / Math.sqrt(1 + gx * gx + gz * gz);
  b.vx -= k * gx * dt; b.vz -= k * gz * dt;
  let sp = Math.hypot(b.vx, b.vz);
  if (sp > 0) {
    const dec = (ROLL + DAMP * sp) * dt; const ns = Math.max(0, sp - dec);
    b.vx *= ns / sp; b.vz *= ns / sp; sp = ns;
  }
  if (sp > MAX_SPEED * 1.4) { const f = MAX_SPEED * 1.4 / sp; b.vx *= f; b.vz *= f; sp *= f; }
  if (!slope && sp < STOP) { b.vx = 0; b.vz = 0; sp = 0; }
  b.x += b.vx * dt; b.z += b.vz * dt;

  for (const w of hole.walls) {
    if (Math.abs(b.x - w.x) > w.hx + BALL_R || Math.abs(b.z - w.z) > w.hz + BALL_R) continue;
    const c = circleBoxLocal(b.x - w.x, b.z - w.z, w.hx, w.hz);
    if (c) respond(b, c[0], c[1], c[2], 0.7);
  }
  for (const m of hole.bumpers) {
    const dx = b.x - m.x, dz = b.z - m.z, d = Math.hypot(dx, dz), rr = m.r + BALL_R;
    if (d < rr && d > 1e-6) { respond(b, dx / d, dz / d, rr - d, 1.0, 0, 0, 3.5); b.bumped = true; }
  }
  for (const m of hole.movers) {
    const p = moverPose(m, t);
    const dx = b.x - p.x, dz = b.z - p.z;
    if (dx * dx + dz * dz > (Math.hypot(m.hx, m.hz) + BALL_R) ** 2) continue;
    const ca = Math.cos(p.a), sa = Math.sin(p.a);
    const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
    const c = circleBoxLocal(lx, lz, m.hx, m.hz);
    if (!c) continue;
    const nx = c[0] * ca - c[1] * sa, nz = c[0] * sa + c[1] * ca;
    // velocity of obstacle at contact point
    const e = 1 / 240, p2 = moverPose(m, t + e);
    const cx = Math.max(-m.hx, Math.min(m.hx, lx)), cz = Math.max(-m.hz, Math.min(m.hz, lz));
    const wx1 = p.x + cx * ca - cz * sa, wz1 = p.z + cx * sa + cz * ca;
    const c2 = Math.cos(p2.a), s2 = Math.sin(p2.a);
    const wx2 = p2.x + cx * c2 - cz * s2, wz2 = p2.z + cx * s2 + cz * c2;
    respond(b, nx, nz, c[2], 0.6, (wx2 - wx1) / e, (wz2 - wz1) / e);
  }
  const cup = hole.cup;
  const cdx = cup.x - b.x, cdz = cup.z - b.z, cd = Math.hypot(cdx, cdz);
  if (cd < CUP_R + BALL_R * 0.6 && cd > 1e-6) { b.vx += cdx / cd * 7 * dt; b.vz += cdz / cd * 7 * dt; }
  if (cd < CUP_R && sp < CUP_SPEED) { b.sunk = true; b.vx = 0; b.vz = 0; b.x = cup.x; b.z = cup.z; return 'sunk'; }
  for (const w of hole.waters) {
    if (Math.abs(b.x - w.x) < w.hx && Math.abs(b.z - w.z) < w.hz) return 'water';
  }
  return null;
}

export function collideBalls(balls) {
  const D = BALL_R * 2;
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]; if (a.sunk || a.out) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j]; if (b.sunk || b.out) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 >= D * D || d2 < 1e-12) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = (D - d) / 2;
      a.x -= nx * pen; a.z -= nz * pen; b.x += nx * pen; b.z += nz * pen;
      const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (vn < 0) {
        const j2 = -(1 + 0.92) * vn / 2;
        a.vx -= j2 * nx; a.vz -= j2 * nz; b.vx += j2 * nx; b.vz += j2 * nz;
        a.hit = b.hit = true;
      }
    }
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
export function planShot(hole, ball, t0, skill = 1) {
  const sim = { ...ball };
  const n = hole.tiles.length; const cur = tileAt(hole, ball.x, ball.z); const ci = cur ? cur.i : 0;
  const targets = [[hole.cup.x, hole.cup.z]];
  for (let i = ci; i < Math.min(n - 1, ci + 3); i++) targets.push(hole.exits[i]);
  const angles = [];
  for (const [tx, tz] of targets) {
    const base = Math.atan2(tz - ball.z, tx - ball.x);
    for (const off of [-0.24, -0.12, -0.05, 0, 0.05, 0.12, 0.24]) angles.push(base + off);
  }
  for (let i = 0; i < 8; i++) angles.push(Math.random() * Math.PI * 2);
  const powers = [0.12, 0.2, 0.3, 0.42, 0.56, 0.72, 0.88, 1.0];
  let best = null, bestCost = Infinity;
  const dt = 1 / 90;
  for (const a of angles) for (const p of powers) {
    Object.assign(sim, ball); sim.sunk = false; sim.out = false;
    sim.vx = Math.cos(a) * p * MAX_SPEED; sim.vz = Math.sin(a) * p * MAX_SPEED;
    let cost = 0, tt = 0, ev = null;
    for (; tt < 7; tt += dt) {
      ev = stepBall(hole, sim, t0 + tt, dt);
      if (ev || isResting(sim)) break;
    }
    if (ev === 'sunk') cost = -100 + tt;
    else if (ev === 'water') cost = 500;
    else cost = distToCup(hole, sim.x, sim.z) + (isResting(sim) ? 0 : 2);
    cost += Math.random() * 0.3;
    if (cost < bestCost) { bestCost = cost; best = { a, p }; }
  }
  const noise = (1 - skill) * 0.15 + 0.03;
  return { a: best.a + (Math.random() * 2 - 1) * noise, p: Math.min(1, best.p * (1 + (Math.random() * 2 - 1) * noise)) };
}
