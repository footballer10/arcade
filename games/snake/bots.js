// Host-only snake AI. Each bot looks for food, feels ahead for bodies and the ring with a fan of rays, and (on
// Normal/Hard) tries to cut off smaller snakes. Difficulty (ctx.bots.level) sets reaction time, aim wobble,
// how often it ignores danger, and how greedy/aggressive it is.
import { C, radiusOf, turnOf, wrapA } from './sim.js';

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

export function botThink(sim, s, b, dt) {
  if (!b.brain.ready(dt)) return;
  const L = b.brain.level, R = sim.R, r = radiusOf(s.mass), dc = Math.hypot(s.x, s.y);
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
