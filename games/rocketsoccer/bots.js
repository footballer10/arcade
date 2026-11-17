// Rocket Soccer bot AI (host only). Bots produce the same input a player does ({x, y, jump, boost}) and play a
// role picked per team every few hundred ms: ATTACK (go hit the ball toward the other goal), SUPPORT (hang back
// between the ball and our goal, grab boost) or DEFEND (sit in the goal mouth, clear the ball when it comes close).
// Difficulty (ctx.bots.level): reaction = how often the plan is updated, aimError = how sloppy the aim is,
// skill = speed/boost use, dodge shots and (hard) aerials, mistakes = whiffs and wrong reads.
import { C, PH, qrot, predictBall, len3, clamp } from './physics.js';

const tmp = [0, 0, 0], fwd = [0, 0, 0];
function local(c, x, y, z) {   // world point -> car frame (x = left, y = up, z = forward)
  const dx = x - c.x, dy = y - c.y, dz = z - c.z;
  const qx = -c.qx, qy = -c.qy, qz = -c.qz, qw = c.qw;
  const tx = 2 * (qy * dz - qz * dy), ty = 2 * (qz * dx - qx * dz), tz = 2 * (qx * dy - qy * dx);
  tmp[0] = dx + qw * tx + (qy * tz - qz * ty); tmp[1] = dy + qw * ty + (qz * tx - qx * tz); tmp[2] = dz + qw * tz + (qx * ty - qy * tx);
  return tmp;
}

export function newBot(level, rnd = Math.random) {
  return { lv: level, rnd, think: rnd() * 0.3, tx: 0, tz: 0, ty: 0, mode: 'attack', aim: 0, err: 0, dodgeAt: 0,
    jumpT: -1, jumpPlan: 0, aerial: 0, stuck: 0, rev: 0, revSteer: 1, wantBoost: false, kick: false, flipT: 0, whiff: false };
}

// Roles per team: the best-placed player attacks (humans count, so a bot backs off when a teammate is on it).
export function assignRoles(W, roles) {
  const A = W.A, b = W.ball;
  for (const team of [0, 1]) {
    const dir = team === 0 ? 1 : -1, ownZ = -dir * A.L;
    const mem = [];
    W.cars.forEach((c, i) => { if (c.team === team && c.demo <= 0) mem.push(i); });
    if (!mem.length) continue;
    const score = (i) => {
      const c = W.cars[i], d = Math.hypot(c.x - b.x, c.z - b.z);
      const wrong = (c.z - b.z) * dir > 2 ? 1.6 + ((c.z - b.z) * dir) / 25 : 0;   // in front of the ball
      const sp = Math.hypot(c.vx, c.vz);
      return d / Math.max(14, sp + 10) + wrong + (c.boost < 10 ? 0.15 : 0) - (roles[i] === 'attack' ? 0.25 : 0);   // hysteresis
    };
    mem.sort((p, q) => score(p) - score(q));
    const att = mem[0];
    const rest = mem.slice(1).sort((p, q) => Math.abs(W.cars[p].z - ownZ) - Math.abs(W.cars[q].z - ownZ));
    roles[att] = 'attack';
    if (rest.length === 1) roles[rest[0]] = 'defend';
    else if (rest.length >= 2) { roles[rest[0]] = 'defend'; for (const i of rest.slice(1)) roles[i] = 'support'; }
  }
  return roles;
}

// Reaction time: a bot sees the ball as it was `reaction` seconds ago, pushed forward along its velocity at the
// time (so a hard bot reads bounces and touches almost at once, an easy bot a beat late).
function seen(W, lv) {
  const H = W._bh || (W._bh = []);
  if (!H.length || H[H.length - 1].tick !== W.tick) { const b = W.ball; H.push({ tick: W.tick, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz }); if (H.length > 60) H.shift(); }
  const lag = Math.round(lv.reaction * 1.6 * 60);   // widened so the levels feel clearly different
  let e = H[0]; for (let k = H.length - 1; k >= 0; k--) if (H[k].tick <= W.tick - lag) { e = H[k]; break; }
  const t = (W.tick - e.tick) / 60 * 0.8;
  const out = { x: e.x + e.vx * t, y: Math.max(C.BALL_R, e.y + e.vy * t), z: e.z + e.vz * t, vx: e.vx, vy: e.vy, vz: e.vz, wx: 0, wy: 0, wz: 0 };
  return out;
}
function prediction(W, b, key) {
  const cache = W._pc || (W._pc = {});   // per world, so nothing outlives the round
  const pc = cache[key] || (cache[key] = { tick: -1, P: [] });
  if (pc.tick !== W.tick) { predictBall({ A: W.A, ball: b, grav: W.grav }, pc.P, 150, 3); pc.tick = W.tick; }
  return pc.P;
}

// Plan: pick a target point (and how to approach it). Runs every `reaction` seconds.
function plan(W, i, bot, role) {
  const A = W.A, c = W.cars[i], lv = bot.lv, R = C.BALL_R, b = seen(W, lv);
  const dir = c.team === 0 ? 1 : -1, oppZ = dir * A.L, ownZ = -dir * A.L;
  bot.mode = role; bot.whiff = bot.rnd() < lv.mistakes;
  bot.errT = (bot.errT || 0) - 0.3; if (bot.errT <= 0) { bot.errT = 2.5; bot.err = (bot.rnd() * 2 - 1) * lv.aimError; }
  const kickoff = Math.hypot(b.x, b.z) < 0.5 && len3(b.vx, b.vy, b.vz) < 0.5;
  bot.kick = kickoff && role === 'attack';
  if (kickoff && role !== 'attack') {
    // kickoff: the non-taker grabs a boost pad near goal, ready to defend
    bot.tx = (c.x < 0 ? -1 : 1) * A.W * 0.5; bot.tz = ownZ * 0.6; bot.ty = 0; bot.wantBoost = false; return;
  }
  // a defender pushes up to challenge when the ball is in our third
  const ballOwnD = Math.abs(b.z - ownZ);
  if (role === 'defend' && ballOwnD < A.L * 0.55) role = bot.mode = 'attack';
  if (role === 'support') {
    // shadow: between the ball and our goal, a third of the field back
    const low = c.boost < 35 && lv.skill > 0.5;
    if (low) {   // nearest big pad on our half
      let best = null, bd = 1e9;
      for (let p = 0; p < A.pads.length; p++) { const pd = A.pads[p]; if (!pd.big || W.pads[p] > 0 || (pd.z - ownZ) * dir > A.L * 1.1) continue; const d = Math.hypot(pd.x - c.x, pd.z - c.z); if (d < bd) { bd = d; best = pd; } }
      if (best && bd < 50) { bot.tx = best.x; bot.tz = best.z; bot.ty = 0; bot.wantBoost = false; return; }
    }
    bot.tx = clamp(b.x * 0.5, -A.W + 6, A.W - 6); bot.tz = clamp(b.z - dir * A.L * 0.42, -A.L + 8, A.L - 8); bot.ty = 0; bot.wantBoost = false; return;
  }
  if (role === 'defend') {
    bot.tx = clamp(b.x * 0.35, -A.GW + 3, A.GW - 3); bot.tz = ownZ + dir * 4; bot.ty = 0; bot.wantBoost = Math.hypot(c.x - bot.tx, c.z - bot.tz) > 30; return;
  }
  // ATTACK: find the first predicted ball position we can reach in time
  const P = prediction(W, b, lv.reaction);
  const gk = Math.min(1.9, Math.pow(C.G / (W.grav || C.G), 0.75));   // low gravity: jumps reach higher
  const speed = 14 + lv.skill * 12 + (c.boost > 20 ? 8 * lv.skill : 0);
  const aerialOk = lv.skill > 0.85 && c.boost > 30 && (W.grav || C.G) >= C.G;   // in low gravity a jump already reaches high balls
  let tgt = null;
  for (const p of P) {
    if (p.y > 4.6 * gk) continue;
    const d = Math.max(0, Math.hypot(p.x - c.x, p.z - c.z) - R - 1.5);
    const l = local(c, p.x, c.y, p.z), ang = Math.abs(Math.atan2(l[0], l[2]));
    const need = d / speed + ang * 0.35;
    if (need <= p.t + 0.05) { tgt = p; break; }
  }
  if (!tgt) tgt = P[P.length - 1] || { x: b.x, y: b.y, z: b.z, t: 0 };
  // where to send it: the far side of the goal, plus aim error
  const aimX = clamp(-tgt.x * 0.25 + bot.err * A.GW * 1.4, -A.GW * 0.7, A.GW * 0.7);
  let sx = aimX - tgt.x, sz = oppZ + dir * 2 - tgt.z; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
  // clearing from our own corner: just hit it up-field and away from the middle of our goal
  if (Math.abs(tgt.z - ownZ) < A.L * 0.35) { sx = clamp(tgt.x / A.W, -0.6, 0.6); sz = dir; const l2 = Math.hypot(sx, sz); sx /= l2; sz /= l2; }
  const tcx = tgt.x - c.x, tcz = tgt.z - c.z, tcl = Math.hypot(tcx, tcz) || 1;
  const align = (tcx * sx + tcz * sz) / tcl;   // 1 = we are right behind the ball on the shot line
  let back = R + 1.0;
  if (align < 0.1) {
    // wrong side: loop around behind the ball, on the side we are already on
    const side = (c.x - tgt.x) * sz - (c.z - tgt.z) * sx > 0 ? 1 : -1;
    back = 13;
    let lat = 9;
    // make sure the path to the waypoint doesn't run through the ball (that is how own goals happen)
    for (let k = 0; k < 3; k++) {
      const wx = tgt.x - sx * back + sz * side * lat, wz = tgt.z - sz * back - sx * side * lat;
      const ex = wx - c.x, ez = wz - c.z, el2 = ex * ex + ez * ez || 1;
      const u = clamp(((tgt.x - c.x) * ex + (tgt.z - c.z) * ez) / el2, 0, 1);
      if (Math.hypot(c.x + ex * u - tgt.x, c.z + ez * u - tgt.z) > R + 3) break;
      lat += 7;
    }
    bot.tx = tgt.x - sx * back + sz * side * lat; bot.tz = tgt.z - sz * back - sx * side * lat;
  } else {
    back = align < 0.6 ? R + 2 + (0.6 - align) * 12 : R + 0.6;
    bot.tx = tgt.x - sx * back; bot.tz = tgt.z - sz * back;
  }
  bot.ty = tgt.y; bot.bx = tgt.x; bot.bz = tgt.z; bot.align = align; bot.tgtT = tgt.t; bot.sx = sx; bot.sz = sz; bot.wrong = align < 0.1;
  bot.tx = clamp(bot.tx, -A.W + 2, A.W - 2); bot.tz = clamp(bot.tz, -A.L - 4, A.L + 4);
  bot.wantBoost = lv.skill > 0.4 && (align > 0.6 || tcl > 30) && bot.rnd() < 0.4 + lv.skill * 0.6;
  // hard bots go for simple aerials: a high ball we can reach soon, roughly in front of us, heading our way
  if (aerialOk && c.gnd && !bot.aerial && sp(c) < 30 && bot.rnd() < lv.skill * 0.3) {
    for (const p of P) {
      if (p.t < 0.6 || p.t > 1.4) continue;
      if (p.y < 7 || p.y > 15) continue;
      const hd = Math.hypot(p.x - c.x, p.z - c.z), l = local(c, p.x, p.y, p.z);
      if (Math.abs(Math.atan2(l[0], l[2])) > 0.25 || hd > Math.min(18, p.t * 20) || hd < 4) continue;
      if ((p.z - c.z) * dir < -2) continue;   // only toward the opponent's half of the ball
      bot.aerial = 2.4; bot.ax = p.x - sx * 1.2; bot.ay = p.y; bot.az = p.z - sz * 1.2; break;
    }
  }
}
const sp = (c) => len3(c.vx, c.vy, c.vz);

// Per tick: low-level driving toward the current plan.
export function botInput(W, i, bot, role) {
  const c = W.cars[i], lv = bot.lv, b = seen(W, lv), out = { x: 0, y: 0, jump: false, boost: false };
  if (c.demo > 0 || W.phase === PH.REPLAY || W.phase === PH.END) return out;
  if (W.phase === PH.KICK) { bot.think = 0; bot.aerial = 0; bot.jumpT = -1; return out; }
  bot.think -= 1 / 60;
  if (bot.think <= 0) { bot.think = 0.3 * (0.7 + bot.rnd() * 0.6); plan(W, i, bot, role); }
  const sp = len3(c.vx, c.vy, c.vz);
  // ---- aerial (hard bots): jump, then point the nose at the ball and boost
  if (bot.aerial > 0) {
    bot.aerial -= 1 / 60;
    if (c.gnd && bot.aerial < 2.2) { bot.aerial = 0; }
    else {
      const l = local(c, bot.ax, bot.ay + 0.6, bot.az);
      out.jump = bot.aerial > 2.18 || (bot.aerial > 2.05 && bot.aerial < 2.12);
      if (!c.gnd && c.ft <= 0) {
        out.y = l[1] > l[2] * 0.08 + 0.3 ? 1 : l[1] < -0.3 ? -1 : 0;   // nose up / down
        out.x = l[0] > 0.4 ? -1 : l[0] < -0.4 ? 1 : 0;
        out.boost = true;   // boost the whole way: that is what gives full air control
        if (c.boost <= 0) bot.aerial = 0;
      }
      if (out.jump) { out.x = 0; out.y = 0; }   // a jump press with a direction held would dodge instead
      if (Math.hypot(b.x - c.x, b.y - c.y, b.z - c.z) < C.BALL_R + 1.2 || bot.aerial <= 0) bot.aerial = 0;
      return out;
    }
  }
  // ---- jumping / dodging sequence in progress
  if (bot.jumpT >= 0) {
    bot.jumpT += 1 / 60;
    if (bot.jumpPlan === 1) out.jump = bot.jumpT < 0.08 || (bot.jumpT > 0.14 && bot.jumpT < 0.2);  // dodge
    else out.jump = bot.jumpT < 0.22 || (bot.jumpPlan === 3 && bot.jumpT > 0.3 && bot.jumpT < 0.34);
    if (bot.jumpPlan === 1 && bot.jumpT > 0.1) { out.y = -1; out.x = bot.flipX || 0; }
    else { out.y = bot.jumpPlan === 3 && bot.jumpT > 0.26 && bot.jumpT < 0.38 ? 0 : -1; }   // plain double jump, not a dodge
    if (bot.jumpT > 1.1 || (c.gnd && bot.jumpT > 0.3)) bot.jumpT = -1;
    return out;
  }
  // ---- drive to the plan target
  let tx = clamp(bot.tx, -W.A.bx - 2, W.A.bx + 2), tz = bot.tz;
  const dball = Math.hypot(b.x - c.x, b.z - c.z);
  const att = bot.mode === 'attack';
  const dirZ = c.team === 0 ? 1 : -1, toOwn = dball > 0.1 ? -((b.z - c.z) * dirZ) / dball : 0;   // >0: driving through it toward our goal
  if (att && bot.sx != null && b.y < 6.5 * Math.min(1.9, Math.pow(C.G / (W.grav || C.G), 0.75))) {
    // curve in: aim at a point behind the ball whose offset shrinks as we get closer, so the car arrives
    // travelling along the shot line and drives straight through the ball
    const bx = dball < 14 ? b.x : bot.bx, bz = dball < 14 ? b.z : bot.bz;
    const rx = c.x - bx, rz = c.z - bz, d = Math.hypot(rx, rz) || 1;
    const along = (rx * bot.sx + rz * bot.sz) / d;          // -1 = right behind the ball, +1 = in front of it
    let offB = Math.min(16, d * 0.5), offS = 0;
    if (along > -0.2) { const side = rx * bot.sz - rz * bot.sx > 0 ? 1 : -1; offB = Math.min(18, d * 0.7) + 4; offS = side * Math.min(12, 4 + d * 0.35) * (along + 0.2); }
    tx = bx - bot.sx * offB + bot.sz * offS; tz = bz - bot.sz * offB - bot.sx * offS;
    bot.lined = along < -0.8 && d < 12;
    if (bot.lined) { tx = bx + bot.sx * 5; tz = bz + bot.sz * 5; }   // lined up: drive straight through it
    else { tx = clamp(tx, -W.A.bx - 2, W.A.bx + 2); tz = clamp(tz, -W.A.bz - 2, W.A.bz + 2); }   // stay on the flat pitch
  }
  if (att && toOwn > 0.5 && dball < 8 && Math.abs(b.z) < W.A.L * 0.8) bot.think = Math.min(bot.think, 0.05);   // about to push it the wrong way: re-plan now
  if (bot.kick) { tx = b.x; tz = b.z; }
  const l = local(c, tx, c.y, tz);
  const ang = Math.atan2(l[0], l[2]), dist = Math.hypot(l[0], l[2]);
  let steer = clamp(-ang * 3.2, -1, 1);
  let thr = -1;
  // reverse when the target is close behind (defenders backing into goal look natural)
  if (Math.abs(ang) > 2.3 && dist < 10 && !att) { thr = 1; steer = -steer; }
  // arrived at a positional target: slow down and face the ball
  if (!att && dist < 4) {
    const lb = local(c, b.x, c.y, b.z), ab = Math.atan2(lb[0], lb[2]);
    steer = clamp(-ab * 2, -1, 1); thr = Math.abs(ab) > 0.4 ? -0.6 : sp > 3 ? 1 : 0;
    if (Math.abs(ab) > 0.4 && sp < 6) thr = -1;
  }
  // corner speed: slow down for tight turns instead of overshooting into the walls
  const aa = Math.abs(ang);
  if (thr < 0 && c.gnd && aa > 0.3 && !(att && bot.lined)) {
    const allowed = 9 + 30 * Math.max(0, 1 - aa / 1.3) + dist * (0.25 + 0.2 * lv.skill);
    if (sp > allowed + 5) thr = 1; else if (sp > allowed) thr = 0;
  }
  out.x = Math.abs(steer) > 0.18 ? Math.sign(steer) : 0; out.y = thr > 0.3 ? 1 : thr < -0.3 ? -1 : 0;
  out.boost = c.gnd && Math.abs(ang) < 0.2 && (bot.wantBoost || bot.kick) && sp < C.MAX - 1 && (bot.kick || (att ? (bot.lined || dist > 28) : dist > 20));
  // not lined up yet and close: keep it controllable
  if (att && !bot.lined && !bot.kick && dball < 22 && sp > 16 + dball * 0.5) { out.boost = false; if (sp > 20 + dball * 0.6) out.y = 0; }
  if (!att && dist < 14) out.boost = false;
  // easy bots are lazier on the pedal and rarely boost
  if (lv.skill < 0.6 && !bot.kick) { if (bot.rnd() > lv.skill + 0.35 && out.y === -1) out.y = 0; if (bot.rnd() > lv.skill * 0.6) out.boost = false; }
  // stuck (against a wall / car): back up for a moment
  if (c.gnd && sp < 2 && out.y === -1) bot.stuck += 1 / 60; else bot.stuck = Math.max(0, bot.stuck - 1 / 30);
  if (bot.stuck > 1.0) { bot.rev = 0.7; bot.stuck = 0; bot.revSteer = bot.rnd() < 0.5 ? -1 : 1; }
  if (bot.rev > 0) { bot.rev -= 1 / 60; out.y = 1; out.x = bot.revSteer; out.boost = false; return out; }
  // ---- hit decisions near the ball
  const gk = Math.min(1.9, Math.pow(C.G / (W.grav || C.G), 0.75));
  if (c.gnd && att && !bot.whiff) {
    const lb = local(c, b.x, b.y, b.z), bang = Math.abs(Math.atan2(lb[0], lb[2])), bd = Math.hypot(lb[0], lb[2]);
    if (bot.kick && bd < 8.5 + sp * 0.05 && lv.skill > 0.5) { bot.jumpT = 0; bot.jumpPlan = 1; bot.flipX = 0; }
    else if (b.y > 4.3 && b.y < 9 * gk && bd < 3 + Math.max(0, b.y - 4) * 0.8 / gk && bang < 0.6 && b.vy < 4) { bot.jumpT = 0; bot.jumpPlan = b.y > 6.5 * gk ? 3 : 2; }
    else if (b.y < 4 && bd < 6.5 && bang < 0.3 && bot.lined && sp > 12 && bot.rnd() < lv.skill * 0.12) { bot.jumpT = 0; bot.jumpPlan = 1; bot.flipX = 0; }
  }
  if (!c.gnd && c.ft <= 0 && bot.jumpT < 0) { out.x = 0; out.y = 0; }   // let the landing assist settle the car
  return out;
}
