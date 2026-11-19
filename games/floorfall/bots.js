// Bot brains for Floor Is Falling (run by the host; the test autopilot uses the same code on a client).
// A bot looks a few steps ahead in 16 directions and scores each path: solid tiles good, cracking tiles risky,
// holes bad unless there is floor behind them to jump to. It likes open space (it avoids burning the tiles it
// will need), drifts away from crumbling rims, and hunts the nearest rival on its layer: running circles
// around them to cut their floor and dashing into them when close. Difficulty (ctx.bots.level) sets its
// reaction time, aim wobble, how often it misjudges a jump and how aggressive it is.
import { C, tileAt, tileQR, NEIGH } from './world.js';

const DIRS = 16;
// How sharp each difficulty is. reflex = chance per tick (60 Hz) that a bot notices the floor vanishing ahead of it;
// steps = how many tiles ahead it plans; plan = weight of its "room to keep running" planning; hop = chance it
// hop-runs when floor is scarce; air = chance it steers its fall / jumps towards floor; blind = chance it jumps
// without checking the landing; idle = chance per think of dithering for half a second (burning its own tile).
const HANDICAP = {
  easy:   { reflex: 0.045, steps: 2, plan: 0,   hop: 0,    air: 0.25, blind: 0.45, idle: 0.14, dash: 0.1 },
  normal: { reflex: 0.16,  steps: 3, plan: 0.4, hop: 0.2,  air: 0.6,  blind: 0.2,  idle: 0.06, dash: 0.3 },
  hard:   { reflex: 0.4,   steps: 4, plan: 0.8, hop: 0.55, air: 0.9,  blind: 0.06, idle: 0.02, dash: 0.6 },
};
const AIR = () => 2 * C.JUMP / C.G;           // time in the air for a full jump (read live: tunable)
// Where would a jump started now land if I steer with heading a at strength m? (same integration as stepPlayer)
function jumpLand(p, a, m) {
  let x = p.x, z = p.z, vx = p.vx, vz = p.vz; const dt = 1 / 30, tx = Math.sin(a) * C.SPEED * m, tz = Math.cos(a) * C.SPEED * m;
  for (let tt = 0; tt < AIR(); tt += dt) {
    const ex = tx - vx, ez = tz - vz, el = Math.hypot(ex, ez), acc = C.AIR_ACC * dt;
    if (el <= acc) { vx = tx; vz = tz; } else { vx += (ex / el) * acc; vz += (ez / el) * acc; }
    x += vx * dt; z += vz * dt;
  }
  return [x, z];
}
// Find a jump that lands on floor that will still be there (and isn't a dead end). Returns {a, m} or null.
function landSafe(L, p, a, t, B) {
  const tries = [[a, 1], [a, 0.6], [a, 0.25], [a + 0.4, 1], [a - 0.4, 1], [a + 0.4, 0.5], [a - 0.4, 0.5]];
  for (const [aa, m] of tries) {
    const [x, z] = jumpLand(p, aa, m), i = tileAt(L, x, z);
    if (i < 0 || L.at[i] <= t + AIR() + 0.25) continue;
    let ok = 0; for (const [ox, oz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) if (tileVal(L, x + ox, z + oz, t, AIR() + 0.3)) ok++;
    if (ok < 2) continue;
    if (B) B.air = { a: aa, m, t: AIR() + 0.1, at: t };
    return true;
  }
  return false;
}
export function makeBot(Brain, level, rnd = Math.random) {
  return { brain: new Brain(level, rnd), level, rnd, inp: { mx: 0, mz: 0, j: 0, d: 0 }, dir: rnd() * Math.PI * 2, jumpFor: 0, careful: true, hop: false, airAware: true, noticed: 0, sparse: 1, air: null, hold: 0, target: null, wander: 0 };
}

// lookup: tile state at (x,z) on layer L: 2 solid, 1 cracking (but will hold `eta` more seconds), 0 hole
function tileVal(L, x, z, t, eta) {
  const i = tileAt(L, x, z);
  if (i < 0 || L.at[i] <= t + eta) return 0;
  return L.at[i] === Infinity ? 2 : 1;
}

// How much untouched floor can I reach from tile `start` without crossing `block` (my own tile)? (capped)
const seen = new Map(); let stamp = 0;
function room(L, start, block, cap) {
  if (start < 0 || L.at[start] !== Infinity) return 0;
  stamp++; const q = [start]; let n = 0;
  const key = (i) => L.h * 100000 + i;
  seen.set(key(start), stamp); if (block >= 0) seen.set(key(block), stamp);
  while (q.length && n < cap) {
    const i = q.pop(); n++;
    for (const [dq, dr] of NEIGH) {
      const j = tileQR(L, L.qs[i] + dq, L.rs[i] + dr);
      if (j < 0 || L.at[j] !== Infinity || seen.get(key(j)) === stamp) continue;
      seen.set(key(j), stamp); q.push(j);
    }
  }
  if (seen.size > 4000) seen.clear();
  return n;
}

export function botThink(B, p, w, dt) {
  const { lv, t, players } = w;
  const inp = B.inp, lvl = B.level, rnd = B.rnd, H = HANDICAP[lvl.key] || HANDICAP.normal;
  if (!p.alive) { inp.mx = inp.mz = 0; return; }
  B.wander -= dt; B.jumpFor -= dt; B.noticed = Math.max(0, (B.noticed || 0) - dt);
  const L = lv.layers[p.l];
  // reflexes (every tick): don't run into a hole unless I meant to jump it; jump when the floor ahead ends
  if (p.g) {
    const here = tileAt(L, p.x, p.z), left = here >= 0 ? L.at[here] - t : 0;
    const sp = Math.hypot(p.vx, p.vz), hd = sp > 1.5 ? Math.atan2(p.vx, p.vz) : B.dir;
    // is running this way safe for the next ~0.25 s (plus the drift it takes to turn)?
    const safeWay = (a, reach) => { for (const d of reach) if (!tileVal(L, p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, t, d / Math.max(2.5, sp) + 0.08)) return false; return true; };
    const NEAR = [0.35, 0.7, 1.05], FAR = [0.35, 0.7, 1.05, 1.5, 2];
    if ((!safeWay(hd, NEAR) || !safeWay(B.dir, NEAR)) && (B.noticed > 0 || (B.noticed = rnd() < H.reflex ? 0.25 : 0) > 0)) {
      if (B.jumpFor > 0 && Math.cos(hd - B.dir) > 0.7 && (rnd() < H.blind || landSafe(L, p, B.dir, t, B))) { inp.j++; B.jumpFor = 0; }
      else if (B.careful || rnd() < 0.12) {          // a careless bot reacts late (often too late)
        // steer to a safe heading: close to where I'm going, but prefer turning back towards the middle
        const home = Math.atan2(-p.x, -p.z);
        let ba = null, bs = -1e9;
        for (let k = 0; k < 16; k++) {
          const a = hd + (k / 16) * Math.PI * 2;
          if (!safeWay(a, FAR)) continue;
          const sc = Math.cos(a - hd) * 0.6 + Math.cos(a - home) * 0.5 + (tileVal(L, p.x + Math.sin(a) * 3, p.z + Math.cos(a) * 3, t, 0.6) === 2 ? 0.4 : 0);
          if (sc > bs) { bs = sc; ba = a; }
        }
        if (ba === null) for (let k = 0; k < 16; k++) { const a = hd + (k / 16) * Math.PI * 2; if (safeWay(a, NEAR)) { ba = a; break; } }
        if (ba !== null) { B.dir = ba; inp.mx = Math.sin(ba); inp.mz = Math.cos(ba); B.jumpFor = 0; B.hold = 0.18; }
        else if (left < 0.15 && rnd() < lvl.skill) {                         // nowhere to run: jump to the best landing
          for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; if (landSafe(L, p, a, t, B)) { B.dir = a; inp.mx = Math.sin(a); inp.mz = Math.cos(a); inp.j++; break; } }
        }
      }
    } else if (left < 0.1 && left > 0 && !safeWay(hd, [0.8]) && landSafe(L, p, hd, t, B) && rnd() < lvl.skill * 0.3) inp.j++;
    else if (B.hop && sp > 3 && landSafe(L, p, hd, t, B)) inp.j++;          // hop-running: one tile per jump instead of three

  } else {
    if (B.air && B.air.t > 0) { B.air.t -= dt; inp.mx = Math.sin(B.air.a) * B.air.m; inp.mz = Math.cos(B.air.a) * B.air.m; }
    // airborne over a wide gap: dash to stretch the jump
    if (p.dashCd <= 0 && p.vy < 1 && !B.air && p.y > L.y - 0.2 && B.jumpFor > -0.4 && rnd() < lvl.skill * 0.2) {
      const lx = p.x + p.vx * 0.35, lz = p.z + p.vz * 0.35;
      if (tileVal(L, lx, lz, t, 0.4) === 0 && tileVal(L, lx + Math.sin(B.dir) * 1.8, lz + Math.cos(B.dir) * 1.8, t, 0.6)) { inp.mx = Math.sin(B.dir); inp.mz = Math.cos(B.dir); inp.d++; }
    }
  }
  if (p.g && B.air && t - B.air.at > 0.12) B.air = null;
  if (!p.g && p.vy < 0 && B.careful && B.airAware) {
    // falling: steer towards floor on the layer I'm about to land on
    let Lb = null; for (let h = lv.L - 1; h >= 0; h--) if (lv.layers[h].y < p.y - 0.05) { Lb = lv.layers[h]; break; }
    if (Lb) {
      const ft = Math.max(0.05, (-p.vy - Math.sqrt(Math.max(0, p.vy * p.vy - 2 * C.G * (p.y - Lb.y) * -1))) / -C.G);
      const tf = Math.sqrt(2 * Math.max(0.01, p.y - Lb.y) / C.G) * 0.9 + 0 * ft;
      const lx = p.x + p.vx * tf, lz = p.z + p.vz * tf;
      if (tileVal(Lb, lx, lz, t, tf + 0.3) === 0) {
        let bx = 0, bz = 0, bd = 1e9;
        for (let i = 0; i < Lb.n; i += 1) { if (Lb.at[i] <= t + tf + 0.6) continue; const d = Math.hypot(Lb.xs[i] - lx, Lb.zs[i] - lz) + Math.hypot(Lb.xs[i], Lb.zs[i]) * 0.15; if (d < bd) { bd = d; bx = Lb.xs[i]; bz = Lb.zs[i]; } }
        if (bd < 1e9) { const a = Math.atan2(bx - p.x, bz - p.z); inp.mx = Math.sin(a); inp.mz = Math.cos(a); B.dir = a; }
      }
    }
  }
  B.hold = (B.hold || 0) - dt;
  if (!B.brain.ready(dt) || B.hold > 0) return;
  if (!p.g) return;     // keep steering in the air with the last choice

  // nearest rival on my layer
  let tgt = null, td = 1e9;
  for (const o of players) {
    if (o === p || !o.alive || Math.abs(o.y - p.y) > 1.5) continue;
    const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < td) { td = d; tgt = o; }
  }
  const aggro = 0.25 + lvl.skill * 0.75;
  let best = B.dir, bestS = -1e9, bestJump = false;
  for (let k = 0; k < DIRS; k++) {
    const a = (k / DIRS) * Math.PI * 2, sx = Math.sin(a), sz = Math.cos(a);
    let s = 0, gap = false, jump = false;
    for (let st = 1; st <= H.steps; st++) {
      const d = st * 0.95, eta = d / C.SPEED;
      const v = tileVal(L, p.x + sx * d, p.z + sz * d, t, eta);
      const wgt = st === 1 ? 2.2 : st === 2 ? 1.5 : st === 3 ? 1 : 0.6;
      if (v === 0) {
        if (st <= 2) gap = true;
        s -= (st === 1 ? 3 : 1.4) * wgt;
      } else {
        if (gap && !jump) { jump = true; s += 2.4 + (st === 3 ? 0.6 : 0); }   // floor behind a gap: jumpable
        s += (v === 2 ? 1 : 0.15) * wgt;
      }
    }
    if (jump) s = Math.max(s, -1);
    // open space ahead (don't burn the floor you need)
    const fx = p.x + sx * 3, fz = p.z + sz * 3;
    let open = 0;
    for (const [ox, oz] of [[0, 0], [1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) open += tileVal(L, fx + ox, fz + oz, t, 0.6) === 2 ? 1 : 0;
    s += open * 0.35;
    // room: is there enough floor that way to keep running? (dead ends are deadly on the last layer)
    const here0 = tileAt(L, p.x, p.z), cap = p.l === 0 ? 40 : 24;
    const rm = room(L, tileAt(L, p.x + sx * 1.8, p.z + sz * 1.8), here0, cap);
    s += H.plan * ((rm / cap) * (p.l === 0 ? 4 : 2.2) - (rm < 6 ? (p.l === 0 ? 3 : 1) : 0));
    // keep heading (no jitter), drift away from the rim towards the layer middle
    const dc = Math.cos(a - B.dir); s += dc * 0.7;
    const r = Math.hypot(p.x, p.z);
    if (r > 1) s += Math.cos(a - Math.atan2(-p.x, -p.z)) * Math.min(1, r / (L.N * 1.5)) * 0.8;
    // hunt: approach, but circle when close so my trail cuts their floor
    if (tgt) {
      const ta = Math.atan2(tgt.x - p.x, tgt.z - p.z);
      const want = td > 3.2 ? ta : ta + (B.wander > 0 ? 1.1 : -1.1);
      s += Math.cos(a - want) * aggro * (td > 7 ? 0.6 : 1.1);
    }
    if (s > bestS) { bestS = s; best = a; bestJump = jump; }
  }
  if (B.wander < -2) B.wander = 2 + rnd() * 2;
  // misjudge: easy bots sometimes commit to a bad direction or forget to jump
  if (B.brain.mistake()) { best += (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.9); if (rnd() < 0.5) bestJump = false; }
  B.dir = B.brain.jitter(best);
  B.careful = rnd() >= lvl.mistakes * 0.5;
  // when floor gets scarce, good bots hop to burn fewer tiles
  if (rnd() < 0.15) { let c = 0; for (let i = 0; i < L.n; i += 3) if (L.at[i] > t) c++; B.sparse = (c * 3) / L.n; }
  B.hop = (p.l === 0 || B.sparse < 0.35) && B.sparse < 0.75 && rnd() < H.hop;
  B.airAware = rnd() < H.air;
  if (rnd() < H.idle) { B.hold = 0.35 + rnd() * 0.3; inp.mx = inp.mz = 0; return; }       // dither (and burn my own tile)
  B.jumpFor = bestJump ? 0.6 : 0;
  inp.mx = Math.sin(B.dir); inp.mz = Math.cos(B.dir);
  // dash: into a nearby rival, or across a gap
  if (p.dashCd <= 0) {
    const ta = tgt ? Math.atan2(tgt.x - p.x, tgt.z - p.z) : 0;
    // only shove when it can't backfire: floor under my landing spot, and not in the opening seconds
    const safe = tgt && t > 2.5 && tileVal(L, p.x + Math.sin(ta) * 1.6, p.z + Math.cos(ta) * 1.6, t, 0.35) > 0;
    if (safe && td < 2.4 && rnd() < H.dash * 0.5) { inp.mx = Math.sin(ta); inp.mz = Math.cos(ta); B.dir = ta; inp.d++; }
  }
  // standing on a cracking tile with nowhere good to go: hop to stall
  const here = tileAt(L, p.x, p.z);
  if (bestS < -2 && here >= 0 && L.at[here] - t < 0.25 && landSafe(L, p, best, t, B) && rnd() < lvl.skill) inp.j++;
}
