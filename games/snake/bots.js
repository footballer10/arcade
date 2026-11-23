// Host-only snake AI. Each bot looks for food, feels ahead for bodies and the ring with a fan of rays, and (on
// Normal/Hard) tries to cut off smaller snakes. Difficulty (ctx.bots.level) sets reaction time, aim wobble,
// how often it ignores danger, and how greedy/aggressive it is.
// EXTREME (level.tier 'extreme' / rank 3) plays like a sharp human with the same body and the same limits:
// it plans along the arcs its snake can really turn (same stepHead physics), treats other snakes' projected
// paths as walls only once they will actually be there, steers by where the ring will be in a couple of
// seconds, cuts off any snake whose path it can reach first (preferring the King Snake), and feeds on
// orb clusters, boosting only when it pays. It only reads what every player can see on screen.
import { C, radiusOf, turnOf, wrapA, stepHead, ringAt } from './sim.js';

const FAN = [0, 0.3, -0.3, 0.65, -0.65, 1.0, -1.0, 1.45, -1.45, 2.0, -2.0, 2.7, -2.7];

export function makeBot(Brain, level) {
  return { brain: new Brain(level), ang: 0, boost: false, goal: null, hunt: null, wander: Math.random() * 6.28, blind: 0, side: 1 };
}

// threats: predicted head positions of nearby snakes [x, y, rad, ...] (where their body WILL be)
function clearance(sim, s, ang, look, r, R, threats, blind) {
  const step = 0.8, cx = Math.cos(ang), cy = Math.sin(ang), margin = Math.max(1.5, s.v / turnOf(s.mass)) + 0.4;
  for (let d = step; d <= look; d += step) {
    const x = s.x + cx * d, y = s.y + cy * d;
    if (Math.hypot(x, y) + r > R - margin) return d;
    for (const o of sim.rocks) if (Math.hypot(o.x - x, o.y - y) < o.r + r + 1.3) return d;
    if (blind) continue;
    for (let i = 0; i < threats.length; i += 3) if (Math.hypot(threats[i] - x, threats[i + 1] - y) < threats[i + 2] + r) return d;
    const hit = sim.grid.query(x, y, r + 1.4, (px, py, pr, owner) => owner !== s.idx && Math.hypot(px - x, py - y) < r + pr + 0.35);
    if (hit) return d;
  }
  return look + 1;
}

// EXTREME: follow the arc this snake would really take when steering toward heading `ang` (same physics as
// every player), and return the distance travelled before it would hit something. `paths` holds other snakes'
// projected heads [x, y, rad, t, ...]: a point is only solid once that snake will have passed it.
const ARC_DT = 0.05;
function arcClear(sim, s, ang, look, r, Rnow, Rsoon, paths, boost) {
  const st = { x: s.x, y: s.y, a: s.a, v: s.v, mass: s.mass };
  const margin = r + 0.5;
  let dist = 0, t = 0;
  while (dist < look) {
    const px = st.x, py = st.y;
    stepHead(st, ang, boost, ARC_DT); t += ARC_DT;
    dist += Math.hypot(st.x - px, st.y - py);
    const x = st.x, y = st.y;
    const Rt = Rnow + (Rsoon - Rnow) * Math.min(1, t / 2.5);
    if (Math.hypot(x, y) + margin > Rt) return dist;
    for (const o of sim.rocks) if (Math.hypot(o.x - x, o.y - y) < o.r + r + 1.0) return dist;
    for (let i = 0; i < paths.length; i += 4) if (paths[i + 3] <= t + 0.2 && Math.hypot(paths[i] - x, paths[i + 1] - y) < paths[i + 2] + r) return dist;
    if (sim.grid.query(x, y, r + 1.4, (qx, qy, qr, owner) => owner !== s.idx && Math.hypot(qx - x, qy - y) < r + qr + 0.3)) return dist;
  }
  return look + 1;
}

// EXTREME: orbs binned into 4-unit cells once per sim tick, so a bot can see where the rich piles are.
function orbBins(sim) {
  if (sim._binsT === sim.t) return sim._bins;
  const m = new Map();
  for (const o of sim.orbs.values()) {
    const k = Math.floor(o.x / 4) * 1000 + Math.floor(o.y / 4);
    let c = m.get(k); if (!c) { c = { v: 0, x: 0, y: 0 }; m.set(k, c); }
    c.v += o.v; c.x += o.x * o.v; c.y += o.y * o.v;
  }
  for (const c of m.values()) { c.x /= c.v; c.y /= c.v; }
  sim._binsT = sim.t; sim._bins = m; return m;
}

// EXTREME: the earliest point on a snake's current line I can reach first (boosting if I can afford it).
function intercept(s, o, mySpeed) {
  const ro = radiusOf(o.mass);
  for (let t = 0.25; t <= 2.6; t += 0.15) {
    const px = o.x + Math.cos(o.a) * o.v * t, py = o.y + Math.sin(o.a) * o.v * t;
    const gx = px + Math.cos(o.a) * (ro * 2 + 1.2), gy = py + Math.sin(o.a) * (ro * 2 + 1.2);   // just ahead of its nose
    const d = Math.hypot(gx - s.x, gy - s.y);
    if (d / mySpeed < t - 0.2) return { x: gx, y: gy, t, d };
  }
  return null;
}

export function botThink(sim, s, b, dt) {
  if (b.brain.level.rank >= 3) return extremeThink(sim, s, b, dt);
  if (!b.brain.ready(dt)) return;
  const L = b.brain.level, R = sim.R, r = radiusOf(s.mass), dc = Math.hypot(s.x, s.y), turnR = s.v / turnOf(s.mass);
  // --- what do I want?
  let goal = null, wantBoost = false;
  const others = [...sim.snakes.values()].filter((o) => o.alive && o !== s);
  const threats = [];
  if (L.skill > 0.5 || Math.random() < L.skill) {
    for (const o of others) {
      const dd = Math.hypot(o.x - s.x, o.y - s.y); if (dd > 22) continue;
      const ro = radiusOf(o.mass) + 0.6;
      for (let k = 1; k <= 4; k++) threats.push(o.x + Math.cos(o.a) * o.v * 0.28 * k, o.y + Math.sin(o.a) * o.v * 0.28 * k, ro + k * 0.25);
    }
  }
  if (L.skill > 0.6 && s.mass > 34 && dc < R - 14 && (!b.hunt || Math.random() < 0.15)) {
    b.hunt = null;
    for (const o of others) {
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d < 13 + L.skill * 6 && o.mass < s.mass * (0.9 + L.skill * 0.8) && Math.random() < L.skill * 0.55) { b.hunt = o.id; break; }
    }
  }
  const prey = b.hunt && sim.snakes.get(b.hunt);
  const bl = sim.bloom, bd = bl ? Math.hypot(bl.x - s.x, bl.y - s.y) : 1e9;
  if (bl && bd < 45 && bd > 2 && (b.bloomFor === bl || Math.random() < 0.35 + L.skill * 0.5)) {
    b.bloomFor = bl; b.hunt = null;   // race to the Golden Bloom
    goal = Math.atan2(bl.y - s.y, bl.x - s.x);
    wantBoost = bd > 8 && s.mass > 45 && Math.random() < L.skill * 0.6 && sim.t > bl.at - 2.2;
  } else if (prey && prey.alive && prey.ghost <= 0) {
    const lead = 5 + radiusOf(prey.mass) * 3 + L.skill * 3;
    const gx = prey.x + Math.cos(prey.a) * lead, gy = prey.y + Math.sin(prey.a) * lead;
    goal = Math.atan2(gy - s.y, gx - s.x);
    const d = Math.hypot(gx - s.x, gy - s.y);
    wantBoost = d < 14 && d > 3 && s.mass > 30 && L.skill > 0.65;
    const headGap = Math.hypot(prey.x - s.x, prey.y - s.y);
    if (d > 26 || headGap < 3.5 + radiusOf(prey.mass) * 2 || dc > R - 12 || Math.hypot(gx, gy) > R - 6) b.hunt = null;
  } else {
    b.hunt = null;
    let best = 0, bx = 0, by = 0;
    for (const o of sim.orbs.values()) {
      const dx = o.x - s.x, dy = o.y - s.y;
      if (Math.abs(dx) > 22 || Math.abs(dy) > 22) continue;
      const d = Math.hypot(dx, dy);
      const fwd = Math.cos(wrapA(Math.atan2(dy, dx) - s.a));
      let sc = (o.v / (d + 4)) * (1.4 + fwd);
      if (Math.hypot(o.x, o.y) > R - 3) sc *= 0.3 + L.skill * 0.9;     // edge piles: tempting but risky
      if (d < turnR * 2.2 && Math.abs(wrapA(Math.atan2(dy, dx) - s.a)) > 0.9) sc *= 0.08;   // inside my turning circle: I'd just orbit it
      if (sc > best) { best = sc; bx = o.x; by = o.y; }
    }
    if (best > 0) {
      goal = Math.atan2(by - s.y, bx - s.x);
      const d = Math.hypot(bx - s.x, by - s.y);
      wantBoost = best > 0.75 && d < 9 && s.mass > 40 && Math.random() < L.skill * 0.4;
    } else { b.wander += (Math.random() - 0.5) * 1.2; goal = b.wander; }
  }
  if (dc > R - 8) {   // drift back toward the middle when near the ring
    const inward = Math.atan2(-s.y, -s.x), w = Math.min(1, (dc - (R - 8)) / 6);
    goal = goal == null ? inward : goal + wrapA(inward - goal) * w;
  }
  goal = goal + (Math.random() * 2 - 1) * L.aimError * 0.35;
  // --- is it safe? (bad bots sometimes forget to look)
  if (b.blind > 0) b.blind -= 1;
  else if (Math.random() < L.mistakes * 0.35) b.blind = 1 + Math.floor(Math.random() * 3);
  let ang = goal;
  const blind = b.blind > 0;   // a distracted bot still sees the ring, just not the snakes
  {
    const look = 4 + s.v * (0.45 + L.skill * 0.35) + r * 2, near = 2.5 + r * 2;
    const clear = FAN.map((off) => clearance(sim, s, s.a + off, look, r, R, threats, blind));
    // can I turn to `off` without sweeping through something close?
    const sweepOk = (off) => FAN.every((o, i) => !(Math.sign(o) === Math.sign(off) && Math.abs(o) <= Math.abs(off)) || clear[i] >= near);
    const goff = wrapA(goal - s.a), gclamp = Math.max(-1.45, Math.min(1.45, goff));
    let best = null, bestScore = -1e9, maxI = 0;
    clear.forEach((c, i) => { if (c > clear[maxI]) maxI = i; });
    if (clearance(sim, s, s.a + gclamp, look, r, R, threats, blind) > look && sweepOk(gclamp) && (Math.abs(goff) < 1.45 || clear[0] > near)) best = gclamp;
    else FAN.forEach((off, i) => { if (clear[i] > look && sweepOk(off)) { const sc = -Math.abs(wrapA(off - goff)) + (off && Math.sign(off) === b.side ? 0.6 : 0); if (sc > bestScore) { bestScore = sc; best = off; } } });
    if (best == null) { best = FAN[maxI]; wantBoost = wantBoost && clear[maxI] > look * 0.6; }
    if (Math.abs(best) > 0.2) b.side = Math.sign(best);
    ang = s.a + best;
    if (clear[0] < look || dc > R - 10) wantBoost = false;
    else if (clear[maxI] < look * 0.5 && s.mass > 25 && Math.random() < L.skill * 0.5) wantBoost = true;   // panic dash
  }
  b.ang = ang; b.boost = wantBoost && s.mass > C.BOOST_MIN + 10;
}

function extremeThink(sim, s, b, dt) {
  if (!b.brain.ready(dt)) return;
  const L = b.brain.level, R = sim.R, r = radiusOf(s.mass), dc = Math.hypot(s.x, s.y);
  const cfg = sim.cfg;
  // where the ring will be shortly (schedule, or the Showdown racing in)
  const Rsoon = Math.min(R, ringAt(sim.t + 2.5, cfg), sim.showdown ? Math.max(cfg.r1, R - 0.9 * 2.5) : R);
  const others = [...sim.snakes.values()].filter((o) => o.alive && o !== s);
  const iAmKing = sim.king === s.id;
  // projected heads of nearby snakes, time-stamped (curving with their current steering)
  const paths = [];
  for (const o of others) {
    if (o.ghost > 0 || Math.hypot(o.x - s.x, o.y - s.y) > 26) continue;
    const st = { x: o.x, y: o.y, a: o.a, v: o.v, mass: o.mass }, ro = radiusOf(o.mass) + (iAmKing ? 0.9 : 0.5);
    for (let k = 1; k <= 8; k++) { stepHead(st, o.ang ?? o.a, o.boost, 0.15); paths.push(st.x, st.y, ro + k * 0.08, k * 0.15); }
  }
  let goal = null, wantBoost = false;
  const canBoost = s.mass > C.BOOST_MIN + 12;
  // 1. hunt: cut across the path of a snake I can reach first. The King (gold) is the favourite target.
  if (!iAmKing || s.mass > 400) {
    let best = null, bestSc = 0;
    for (const o of others) {
      if (o.ghost > 0) continue;
      const d0 = Math.hypot(o.x - s.x, o.y - s.y); if (d0 > 24 || d0 < 2.5) continue;
      const ic = intercept(s, o, canBoost ? C.BOOST_SPEED : C.SPEED); if (!ic) continue;
      if (Math.hypot(ic.x, ic.y) > Rsoon - 5) continue;
      if (sim.rocks.some((q) => Math.hypot(q.x - ic.x, q.y - ic.y) < q.r + 3)) continue;
      const sc = (o.mass + 30) * (sim.king === o.id ? 2 : 1) / (ic.d + 6);
      if (sc > bestSc) { bestSc = sc; best = ic; }
    }
    if (best && bestSc > 2.2) { goal = Math.atan2(best.y - s.y, best.x - s.x); wantBoost = canBoost && best.d > 3; b.hunting = true; }
    else b.hunting = false;
  } else b.hunting = false;
  // 2. Golden Bloom: get there as it pops
  const bl = sim.bloom;
  if (goal == null && bl) {
    const bd = Math.hypot(bl.x - s.x, bl.y - s.y), eta = bd / C.SPEED;
    if (bd < 50 && bd > 2) { goal = Math.atan2(bl.y - s.y, bl.x - s.x); wantBoost = canBoost && eta > bl.at - sim.t + 0.6 && bd > 8; }
  }
  // 3. food: richest reachable pile (bins), not just the nearest orb
  if (goal == null) {
    const turnR = s.v / turnOf(s.mass);
    let best = 0, bx = 0, by = 0, bv = 0;
    for (const c of orbBins(sim).values()) {
      const dx = c.x - s.x, dy = c.y - s.y;
      if (Math.abs(dx) > 30 || Math.abs(dy) > 30) continue;
      const d = Math.hypot(dx, dy), off = Math.abs(wrapA(Math.atan2(dy, dx) - s.a));
      if (Math.hypot(c.x, c.y) > Rsoon - 2.5) continue;               // edge piles only while the ring is holding still
      if (d < turnR * 2.2 && off > 0.9) continue;                      // would just orbit it
      let crowd = 0; for (const o of others) if (Math.hypot(o.x - c.x, o.y - c.y) < 6 + radiusOf(o.mass) * 2) crowd++;
      const sc = (c.v / (d + 5)) * (1.3 + Math.cos(off)) / (1 + crowd * 0.7);
      if (sc > best) { best = sc; bx = c.x; by = c.y; bv = c.v; }
    }
    if (best > 0) {
      goal = Math.atan2(by - s.y, bx - s.x);
      const d = Math.hypot(bx - s.x, by - s.y);
      wantBoost = canBoost && bv >= 18 && d > 5 && d < 18;            // only for a pile worth more than the boost costs
    } else goal = Math.atan2(-s.y, -s.x);
  }
  // keep well inside the ring that is coming; within two turning circles of it, heading inward is the only goal
  const turnR = s.v / turnOf(s.mass), edgeZone = Math.max(9, turnR * 2 + r + 2);
  if (dc > Rsoon - edgeZone) {
    const inward = Math.atan2(-s.y, -s.x), w = Math.min(1, (dc - (Rsoon - edgeZone)) / 4);
    goal = goal + wrapA(inward - goal) * w;
    if (w > 0.6) wantBoost = false;
  }
  goal += (Math.random() * 2 - 1) * L.aimError * 0.35;
  // --- choose a heading whose real turning arc stays clear
  const look = 6 + s.v * 0.9 + r * 2.5;
  const FANX = [0, 0.25, -0.25, 0.55, -0.55, 0.9, -0.9, 1.3, -1.3, 1.8, -1.8, 2.4, -2.4, 3.1];
  const goff = wrapA(goal - s.a);
  let pick = null, pickScore = -1e9, maxC = -1, maxOff = 0;
  const gc = arcClear(sim, s, s.a + goff, look, r, R, Rsoon, paths, false);
  if (gc > look) pick = goff;
  else {
    for (const off of FANX) {
      const c = arcClear(sim, s, s.a + off, look, r, R, Rsoon, paths, false);
      if (c > maxC) { maxC = c; maxOff = off; }
      if (c > look) { const sc = -Math.abs(wrapA(off - goff)) + (off && Math.sign(off) === b.side ? 0.4 : 0); if (sc > pickScore) { pickScore = sc; pick = off; } }
    }
    if (pick == null) {
      pick = maxOff;
      // boxed in: would a burst of speed get me out along the best line?
      wantBoost = canBoost && arcClear(sim, s, s.a + maxOff, look, r, R, Rsoon, paths, true) > maxC + 1.5;
    }
  }
  if (Math.abs(pick) > 0.2) b.side = Math.sign(pick);
  // never boost into something: the boosted arc must be clear too
  if (wantBoost && pick === goff && arcClear(sim, s, s.a + pick, look * 1.4, r, R, Rsoon, paths, true) <= look * 1.4) wantBoost = false;
  b.ang = s.a + pick; b.boost = wantBoost && s.mass > C.BOOST_MIN + 10;
}
