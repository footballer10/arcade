// Bot contestants (run on the host only; also drives the test autopilot). They follow the stage's route nodes,
// look a little ahead for sweepers / hammers / punchers (jump the low ones, dive under the high ones, wait for
// the rest), time leaps onto moving platforms, pick doors (and remember the fake ones they bonked), hop
// between tiles, and dive across finish lines. Difficulty (ctx.bots.level) sets reaction time, how far ahead
// they look, how often they misjudge a hazard or a jump, and how bold they are.
import { C, pose, active, groundAt, isDown, blinkU } from './world.js';

export function makeBot(Brain, level, rnd = Math.random) {
  return { brain: new Brain(level, rnd), level, rnd, ni: 0, offs: new Map(), lane: null, door: null, tried: new Set(), inp: { mx: 0, mz: 0, jh: false, j: 0, d: 0, g: false },
    stuck: 0, lx: 0, lz: 0, jumpT: 0, diveArm: false, ignore: new Map(), goal: -1, goalT: 0, wander: null, wanderT: 0, lastRs: -1, finDive: false, prey: null, leapT: 0 };
}
export function resetBot(b) { b.pad = null; b.alt = null; b.ni = 0; b.offs.clear(); b.lane = null; b.door = null; b.tried.clear(); b.goal = -1; b.wander = null; b.finDive = false; b.diveArm = false; b.ignore.clear(); b.prey = null; }

const TMP = {}, TMP2 = {};
const jump = (b, hold = 0.32) => { b.inp.j++; b.jumpT = hold; };
const dive = (b) => { b.inp.d++; };

// G: {st, W, players: [{id,x,y,z,...}] (in round), me: id}
export function botThink(G, p, b, dt) {
  const inp = b.inp, lv = b.level, st = G.st;
  b.jumpT -= dt; b.leapT -= dt; inp.jh = b.jumpT > 0; inp.g = false;
  const think = b.brain.ready(dt);
  if (p.rs !== b.lastRs) { b.lastRs = p.rs; b.ni = 0; b.lane = null; b.door = null; b.stuck = 0; }   // respawned: find our place again
  if (b.diveArm && p.gr < 0 && p.vy < 1.2 && !p.dive) { b.diveArm = false; dive(b); }
  if (p.gr >= 0) b.diveArm = false;
  if (isDown(p) || p.hang >= 0) { inp.mx = inp.mz = 0; return inp; }
  let tx, tz, tsolid = -1, leapNode = false;
  if (st.mode === 'race' || st.mode === 'crown') ({ tx, tz, tsolid, leapNode } = raceTarget(G, p, b));
  else if (st.id === 'tiles') ({ tx, tz, tsolid } = tileTarget(G, p, b, think));
  else ({ tx, tz } = arenaTarget(G, p, b, think));
  if (tx == null) { inp.mx = inp.mz = 0; return inp; }
  let dx = tx - p.x, dz = tz - p.z; const dist = Math.hypot(dx, dz);
  if (dist > 1e-3) { dx /= dist; dz /= dist; }
  let mx = dist > 0.25 ? dx : 0, mz = dist > 0.25 ? dz : 0;
  const err = (b.errA ??= (b.rnd() * 2 - 1) * lv.aimError * 0.25);
  if (mx || mz) { const c = Math.cos(err), s = Math.sin(err); [mx, mz] = [mx * c + mz * s, -mx * s + mz * c]; }
  // edge: no ground ahead -> leap if the target is in reach, otherwise wait
  const grounded = p.gr >= 0;
  if (grounded && (mx || mz)) {
    const ax = p.x + mx * 0.85, az = p.z + mz * 0.85;
    const below = tsolid < 0 && b.dropY != null && b.dropY < p.y - 0.8 && groundAt(G.W, ax, az, p.y - 6, p.y - 0.5) >= 0;   // fine to hop down
    if (!below && groundAt(G.W, ax, az, p.y - 0.7, p.y + 0.55) < 0) {
      const lp = leapPlan(G, p, tsolid >= 0 ? tsolid : groundAt(G.W, tx, tz, p.y - 3, p.y + 1.7), tx, tz);
      const reach = 3.2 + lv.skill * 0.7, mistake = b.rnd() < lv.mistakes * dt * 4;
      if (lp && lp.dy < 1.65 && (lp.gap <= reach || (mistake && lp.gap < reach + 2))) {
        if (think || b.leapT < -0.6) {
          const l = Math.hypot(lp.ax - p.x, lp.az - p.z) || 1; mx = (lp.ax - p.x) / l; mz = (lp.az - p.z) / l;
          jump(b, 0.5); b.leapT = 0.4; if (st.id === 'tiles' ? lp.gap > 3.4 : (lp.gap > 2.6 + lv.skill * 0.4 || b.rnd() < 0.15 * lv.skill)) b.diveArm = true;
        } else { mx *= 0.15; mz *= 0.15; }
      } else if (!leapNode && dist < 1.2) { /* target reached at an edge: fine */ mx = mz = 0; }
      else { mx = mz = 0; }
    }
  }
  // big fans: lean into the gust
  if (G.W.winds?.length) for (const f of G.W.winds) {
    if (p.x < f.x0 || p.x > f.x1 || p.z < f.z0 - 1 || p.z > f.z1 || p.y < f.y0 || p.y > f.y1) continue;
    const u = (((G.W.t + 0.15) / f.p + f.ph) % 1 + 1) % 1; if (f.on < 1 && u > f.on) continue;
    mx -= (f.fx / C.RUN) * (0.55 + b.level.skill * 0.5); mz -= (f.fz / C.RUN) * 0.5;
  }
  // giant rolling balls: sidestep out of their path
  const ball = ballThreat(G, p);
  if (ball && b.rnd() > b.level.mistakes * dt * 3) {
    const side = Math.abs(p.x - ball.x) > 0.2 ? Math.sign(p.x - ball.x) : (b.ballSide ||= (b.rnd() < 0.5 ? 1 : -1));
    const room = side > 0 ? 6.6 - p.x : p.x + 6.6;
    if (room > 1.2) { mx = side; mz = 0.15; } else if (grounded && b.jumpT <= 0 && ball.tau < 0.45) jump(b, 0.5);
  } else b.ballSide = null;
  // ice: ease off the throttle near a target so you don't slide past it
  if (grounded && G.W.solids[p.gr]?.ice) { const k = Math.max(0.3, Math.min(1, dist / 3)); mx *= k; mz *= k; }
  // hazards ahead (sweepers, hammers, punchers)
  const hz = hazard(G, p, mx, mz, lv);
  if (hz && grounded) {
    const key = hz.s.idx;
    let ig = b.ignore.get(key);
    if (!ig || G.W.t > ig.until) { ig = { miss: b.rnd() < lv.mistakes * 1.6, until: G.W.t + 1.2 }; b.ignore.set(key, ig); }
    if (!ig.miss) {
      if (hz.low && hz.tau <= 0.26 + lv.skill * 0.06) { if (b.jumpT <= 0) jump(b, 0.55); }
      else if (hz.high && lv.skill > 0.6 && b.rnd() < 0.5) { if (hz.tau < 0.3) { dive(b); } }
      else if (!hz.low) { mx = -mx * 0.6; mz = -mz * 0.6; }
    }
  }
  // stuck: jump, then try another way
  const moved = Math.hypot(p.x - b.lx, p.z - b.lz); b.lx = p.x; b.lz = p.z;
  if ((mx || mz) && moved < dt * 1.2 && grounded) b.stuck += dt; else b.stuck = Math.max(0, b.stuck - dt * 2);
  if (b.stuck > 0.7 && b.jumpT <= 0) { jump(b, 0.35); }
  if (b.stuck > 2.4) { b.stuck = 0; b.offs.clear(); b.lane = null; if (b.door) { b.tried.add(b.door.d); b.door = null; } b.errA = (b.rnd() * 2 - 1) * 0.6; b.wander = null; b.goal = -1; }
  // dive across the finish line
  if (st.mode === 'race' && st.finishZ != null && !b.finDive && grounded && p.z > st.finishZ - 3.4 && p.z < st.finishZ - 1 && b.rnd() < 0.4 + lv.skill * 0.5) { b.finDive = true; dive(b); }
  inp.mx = mx; inp.mz = mz;
  return inp;
}

function raceTarget(G, p, b) {
  const st = G.st, R = st.route;
  // after a respawn (or a fall-back), skip to the first node ahead of us
  if (b.ni === 0 && p.z > 6) { const nz = (n) => (n.z ?? G.W.solids[n.sid ?? n.sidAlts?.[0] ?? 0].bz); let i = 0; while (i < R.length - 1 && nz(R[i]) < p.z - 1) i++; b.ni = i; }
  for (let guard = 0; guard < 4; guard++) {
    const n = R[b.ni]; if (!n) return { tx: p.x, tz: p.z + 5 };
    if (n.crown) {
      const c = st.crown, d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < 1.7 && p.gr >= 0 && b.jumpT <= 0) jump(b, 0.4);
      return { tx: c.x, tz: c.z, tsolid: -1 };
    }
    let arrived = false;
    if (n.gates) arrived = p.z > n.z + 1.0;
    else if (n.padAlts) arrived = n.padAlts.includes(p.gr) || (p.gr < 0 && p.vy > 12.4 && Math.abs(p.z - n.z) < 3);
    else if (n.sidAlts) arrived = n.sidAlts.includes(p.gr);
    else if (n.sid != null) arrived = p.gr === n.sid && (!n.center || Math.hypot(p.x - G.W.solids[n.sid].x, p.z - G.W.solids[n.sid].z) < 1.8 || n.leap);
    else if (n.door != null) arrived = p.z > st.doors[n.door].z + 0.9;
    else arrived = p.z > n.z - (n.r || 1.3) * 0.5 && Math.abs(p.y - n.y) < 1.6 && (p.gr >= 0 || n.y < p.y);
    if (arrived) { b.ni++; if (n.door != null) b.door = null; continue; }
    let tx, tz, tsolid = -1;
    if (n.gates) {
      // pick the gate that is open (for long enough) or opens first; wait in front of it until it is open
      const W = G.W;
      const info = (id) => { const s = W.solids[id], u = blinkU(s, W.t), P = s.blink.p; return u > s.blink.on ? { open: true, left: (1 - u) * P } : { open: false, wait: (s.blink.on - u) * P }; };
      if (b.gate == null || b.gateNi !== b.ni || (!info(b.gate).open && b.rnd() < 0.02)) {
        let best = n.gates[0], bs = -1e9;
        for (const id of n.gates) { const i = info(id), s = W.solids[id]; const sc = (i.open ? i.left : -i.wait * 1.5) - Math.abs(s.x - p.x) * 0.12 + b.rnd() * 0.3; if (sc > bs) { bs = sc; best = id; } }
        b.gate = best; b.gateNi = b.ni;
      }
      const s = W.solids[b.gate], i = info(b.gate);
      const near = p.z > n.z - 2.3;
      if (near && !(i.open && i.left > 0.9 - b.level.skill * 0.3)) return { tx: s.x, tz: n.z - 2.3, tsolid: -1 };       // hold at the gate
      return { tx: s.x, tz: n.z + 2.4, tsolid: -1 };
    }
    if (n.tip && n.sid != null) {
      // Tip Toe: bots know the path but sometimes misjudge and step on a neighbouring (fake) tile
      if (b.tipNi !== b.ni) {
        b.tipNi = b.ni; b.tipWrong = null;
        if (b.rnd() < b.level.mistakes * 1.6) {
          let best = null, bd = 9;
          for (const s of G.W.solids) if (s.tile >= 0 && !s.safe && s.z > p.z - 1) { const d = Math.hypot(s.x - G.W.solids[n.sid].x, s.z - G.W.solids[n.sid].z); if (d < 2.6 && d < bd) { bd = d; best = s.idx; } }
          b.tipWrong = best;
        }
      }
      if (b.tipWrong != null) { const s = G.W.solids[b.tipWrong]; if (G.W.dyn[s.tile] === 2) b.tipWrong = null; else return { tx: s.x, tz: s.z, tsolid: s.idx }; }
    }
    if (n.padAlts) {
      if (b.pad == null || !n.padAlts.includes(b.pad)) b.pad = n.padAlts[Math.floor(b.rnd() * n.padAlts.length)];
      const s = G.W.solids[b.pad]; return { tx: s.x, tz: s.z + 0.4, tsolid: -1, leapNode: false };
    }
    if (n.sidAlts) {
      if (b.alt == null || !n.sidAlts.includes(b.alt) || b.altNi !== b.ni || (p.gr >= 0 && b.rnd() < 0.2)) {
        let best = n.sidAlts[1], bs = -9;
        for (const id of n.sidAlts) {
          const s = G.W.solids[id], u = blinkU(s, G.W.t + 0.6), left = s.blink.on - u;
          const sc = (u <= s.blink.on ? left : -1) - Math.abs(s.x - p.x) * 0.04 + b.rnd() * 0.08 * (1.3 - b.level.skill);
          if (sc > bs) { bs = sc; best = id; }
        }
        b.alt = best; b.altNi = b.ni;
      }
      const s = G.W.solids[b.alt]; return { tx: s.x, tz: s.z, tsolid: b.alt, leapNode: true };
    }
    if (n.sid != null) {
      const s = G.W.solids[n.sid]; pose(s, G.W.t + 0.5, TMP); tx = TMP.x; tz = TMP.z; tsolid = n.sid;
      if (p.gr === n.sid) { tx = s.x; tz = s.z; }
    } else if (n.alts) {
      if (b.lane == null) { const x = n.alts[Math.floor(b.rnd() * n.alts.length)]; b.lane = x; }
      tx = b.lane; tz = n.z;
    } else if (n.lane) { tx = b.lane ?? 0; tz = n.z; }
    else if (n.door != null) {
      const row = st.doors[n.door];
      if (!b.door || b.tried.has(b.door.d)) b.door = pickDoor(G, p, b, row);
      if (!b.door) { b.tried.clear(); b.door = pickDoor(G, p, b, row); }
      tx = b.door.x; tz = row.z + 1.4;
      if (Math.abs(p.z - row.z) < 1.0 && Math.abs(p.x - b.door.x) < 1.2 && b.door.fake) { b.tried.add(b.door.d); b.door = pickDoor(G, p, b, row) || b.door; }
      if (Math.abs(p.x - tx) > 0.6 && p.z < row.z - 0.3) tz = row.z - 1.4;     // line up before going through
    } else {
      let off = b.offs.get(b.ni);
      if (off == null) { off = (b.rnd() * 2 - 1) * (n.w || 0); if (n.side && Math.abs(off) < n.side) off = (off < 0 ? -1 : 1) * n.side; b.offs.set(b.ni, off); }
      tx = n.x + off; tz = n.z + 0.6;
    }
    b.dropY = n.y;
    if (n.exact) tz = n.z;
    return { tx, tz, tsolid, leapNode: !!n.leap };
  }
  return { tx: p.x, tz: p.z + 3 };
}
function pickDoor(G, p, b, row) {
  const open = row.row.filter((d) => G.W.dyn[d.d] === 1 && !b.tried.has(d.d));
  if (open.length && b.rnd() < 0.35 + b.level.skill * 0.6) return open.sort((a, c) => Math.abs(a.x - p.x) - Math.abs(c.x - p.x))[0];
  const c = row.row.filter((d) => !b.tried.has(d.d));
  if (!c.length) return null;
  c.sort((a, d) => Math.abs(a.x - p.x) - Math.abs(d.x - p.x));
  return c[Math.min(c.length - 1, Math.floor(b.rnd() * Math.min(3, c.length)))];
}

function tileTarget(G, p, b, think) {
  const W = G.W, S = W.solids, lv = b.level;
  const cur = p.gr >= 0 ? S[p.gr] : null;
  if (!cur) { const g = b.goal >= 0 ? S[b.goal] : null; return g ? { tx: g.x, tz: g.z, tsolid: g.idx } : { tx: p.x, tz: p.z, tsolid: -1 }; }
  const layer = cur.layer;
  const age = cur.tile >= 0 && W.dyn[cur.tile] === 1 && W.tileT ? W.t - W.tileT[cur.tile] : 0;
  const gs = b.goal >= 0 ? S[b.goal] : null;
  // a good player waits on a tile until it starts to shake, then steps to a fresh neighbour
  const leaveAt = TILE_FALL_GUESS * (0.25 + lv.skill * 0.45) + (b.wait ?? 0);
  const need = !gs || W.dyn[gs.tile] === 2 || gs.layer !== layer || (gs === cur && age > leaveAt);
  if (need && (think || age > leaveAt + 0.15 || !gs)) {
    b.wait = (b.rnd() - 0.5) * 0.25 + (b.rnd() < lv.mistakes ? 0.5 : 0);
    let best = -1, bs = -1e9;
    for (const s of S) {
      if (s.layer !== layer || W.dyn[s.tile] !== 0 || s === cur) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z); if (d > 4.6) continue;
      let sc = (d < 2.3 ? 3 : 0) - d * 0.3 - Math.hypot(s.x, s.z) * 0.12 + b.rnd() * 1.2;
      for (const o of G.players) if (o.id !== p.id) { const od = Math.hypot(o.x - s.x, o.z - s.z); if (od < 2.5) sc -= (2.5 - od) * 1.2; }
      let nb = 0; for (const t of S) if (t.layer === layer && W.dyn[t.tile] === 0 && Math.abs(t.x - s.x) < 2.2 && Math.abs(t.z - s.z) < 2.2) nb++;
      sc += nb * 0.45 * lv.skill;
      if (sc > bs) { bs = sc; best = s.idx; }
    }
    b.goal = best;
  }
  const g = b.goal >= 0 ? S[b.goal] : null;
  if (!g || g === cur) return { tx: cur.x, tz: cur.z, tsolid: cur.idx };
  return { tx: g.x, tz: g.z, tsolid: g.idx };
}
const TILE_FALL_GUESS = 0.9;

function arenaTarget(G, p, b, think) {
  const lv = b.level, st = G.st, W = G.W;
  b.wanderT -= G.dt || 1 / 60;
  // ground that will still be there in a few seconds (outer rings drop on a timer)
  const ok = (x, z) => { const gi = groundAt(W, x, z, -1, 0.5); if (gi < 0) return false; const s = W.solids[gi]; return !(s.until && s.until - W.t < 3); };
  const here = p.gr >= 0 ? W.solids[p.gr] : null;
  const dying = here && here.until && here.until - W.t < 3.2;
  if (!b.wander || b.wanderT <= 0 || dying || !ok(b.wander[0], b.wander[1]) || Math.hypot(b.wander[0] - p.x, b.wander[1] - p.z) < 0.9) {
    for (let i = 0; i < 10; i++) {
      const a = b.rnd() * Math.PI * 2, r = b.rnd() * (st.arenaR || 10) * 0.8;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (ok(x, z) && ok(x * 0.9, z * 0.9)) { b.wander = [x, z]; break; }
    }
    b.wanderT = 1.2 + b.rnd() * 1.8;
  }
  // finals: the bold ones go hunting
  if (st.mode === 'last' && think && W.t > 10 && b.rnd() < lv.skill * 0.06) {
    const near = G.players.filter((o) => o.id !== p.id).map((o) => [o, Math.hypot(o.x - p.x, o.z - p.z)]).filter(([, d]) => d < 5).sort((a, c) => a[1] - c[1])[0];
    b.prey = near ? near[0].id : null;
  }
  const prey = b.prey && G.players.find((o) => o.id === b.prey);
  if (prey && ok(prey.x, prey.z)) {
    const d = Math.hypot(prey.x - p.x, prey.z - p.z);
    if (d < 2.6 && p.gr >= 0 && think && b.rnd() < 0.5) { p.face = Math.atan2(prey.x - p.x, prey.z - p.z); dive(b); b.prey = null; }
    return { tx: prey.x, tz: prey.z };
  }
  return b.wander ? { tx: b.wander[0], tz: b.wander[1] } : { tx: 0, tz: 0 };
}

// closest landing spot on solid si (predicted ~0.45 s ahead) and the gap to it
function leapPlan(G, p, si, tx, tz) {
  if (si < 0) return null;
  const s = G.W.solids[si];
  if (s.blink) { const u = blinkU(s, G.W.t + 0.55); if (u > s.blink.on - 0.1) return null; }
  else if (!active(s, G.W)) return null;
  const P = s.anim ? (pose(s, G.W.t + 0.45, TMP2), TMP2) : s;
  let ax, az, gap;
  if (s.shape === 'cyl') {
    const dx = p.x - P.x, dz = p.z - P.z, d = Math.hypot(dx, dz) || 1;
    gap = Math.max(0, d - s.r); const k = Math.max(0, s.r - 1.0) / d; ax = P.x + dx * k; az = P.z + dz * k;
  } else {
    const dx = p.x - P.x, dz = p.z - P.z, lx = dx * P.c - dz * P.sn, lz = dx * P.sn + dz * P.c;
    const cx = Math.max(-s.hx, Math.min(s.hx, lx)), cz = Math.max(-s.hz, Math.min(s.hz, lz));
    gap = Math.hypot(lx - cx, lz - cz);
    const ix = Math.max(-s.hx + 0.8, Math.min(s.hx - 0.8, lx)), iz = Math.max(-s.hz + 0.8, Math.min(s.hz - 0.8, lz));
    ax = P.x + ix * P.c + iz * P.sn; az = P.z - ix * P.sn + iz * P.c;
    // bias toward the route target when the platform is big
    if (s.hx > 3 || s.hz > 3) { ax = ax * 0.5 + tx * 0.5; az = az * 0.5 + tz * 0.5; }
  }
  return { gap, ax, az, dy: P.y + s.hy - p.y };
}

// first moving hitter that will overlap us soon
function hazard(G, p, mx, mz, lv) {
  const look = [0.12, 0.24, 0.36, 0.5];
  for (const s of G.W.moving) {
    if (!s.hit || s.soft || s.anim.k === 'roll') continue;
    if (Math.abs(s.x - p.x) > s.br + 7 || Math.abs(s.z - p.z) > s.br + 7) continue;
    for (const tau of look) {
      if (tau > 0.25 + lv.skill * 0.3) break;
      pose(s, G.W.t + tau, TMP);
      const px = p.x + mx * C.RUN * tau, pz = p.z + mz * C.RUN * tau;
      const dx = px - TMP.x, dz = pz - TMP.z, lx = dx * TMP.c - dz * TMP.sn, lz = dx * TMP.sn + dz * TMP.c;
      const ex = Math.max(0, Math.abs(lx) - s.hx), ez = Math.max(0, Math.abs(lz) - s.hz);
      if (Math.hypot(ex, ez) > C.R + 0.3) continue;
      const top = TMP.y + s.hy, bot = TMP.y - s.hy;
      if (top < p.y + 0.05 || bot > p.y + C.H) continue;
      return { s, tau, low: top < p.y + 1.15, high: bot > p.y + 0.85 };
    }
  }
  return null;
}

// a rolling ball that will cross our spot within the next second (returns its x at that time)
function ballThreat(G, p) {
  for (const s of G.W.moving) {
    if (!s.anim || s.anim.k !== 'roll') continue;
    if (Math.abs(s.z - p.z) > 12) continue;
    for (const tau of [0.2, 0.4, 0.6, 0.8, 1.0]) {
      pose(s, G.W.t + tau, TMP);
      const u = (((G.W.t + tau) / s.anim.P + s.anim.ph) % 1 + 1) % 1; if (u < 0.02 || u > 0.985) continue;
      if (Math.hypot(TMP.x - p.x, TMP.z - (p.z + 3.5 * tau)) < s.r + 1.1 && Math.abs(TMP.y - s.hy - p.y) < 1.5) return { x: TMP.x, tau };
    }
  }
  return null;
}
