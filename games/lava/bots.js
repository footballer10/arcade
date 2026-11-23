// Rising Lava bots (run on the host, or on a client for the test autopilot). They read the same world the
// players see: pick a safe, cool, uncrowded platform they can reach, run and jump to it, air-dash to save a
// short jump, and shove anyone standing close to an edge. ctx.bots.level tunes reaction time, aim, planning
// horizon (how far ahead they read the lava) and how often they fumble a jump.
//
// EXTREME (level.tier === 'extreme' / level.rank >= 3; key still reports 'hard' for older checks) plays like a
// very sharp human on the same body and the same limits — no extra speed, no seeing through anything, same
// cooldowns as a player. It gets confident (not inflated) jump judgment, a touch of routing sense (prefers a
// landing that leads somewhere, not a dead end), an offensive dash to close on a vulnerable target just outside
// shove range, and smarter lava-bomb spirits (full flight-time lead, and aiming for whoever a hit would actually
// finish, not a random target).
import { C, ST_CRUMBLE, ST_GONE, lavaAt, jumpReach } from './world.js';

const TAU = Math.PI * 2;
// horizontal distance a running jump covers when landing dh higher (negative = lower)
export function makeBot(Brain, level) {
  const b = new Brain(level);
  return { brain: b, lvl: level, target: -1, aimOff: 0, inp: { mx: 0, mz: 0, jh: false, j: 0, d: 0, s: 0 }, jumpK: 0.6, holdJ: 0, prey: null, fumble: false, stuck: 0 };
}

function standable(w, s, i) {
  if (!s.solid) return false;
  const k = s.kind;
  if (k === 'basalt' && (w.st[i] === ST_CRUMBLE || w.st[i] === ST_GONE)) return false;
  if (k === 'glass' && s.warn) return false;
  return true;
}
function occOf(w, id, self) { let n = 0; for (const o of w.players) if (o !== self && o.alive && o.gr === id) n++; return n; }

// how much of the true physics reach a bot of this skill THINKS it has when picking a target: >1 means it
// overestimates (commits to jumps that are really a bit too far and falls short), <1 means it plays safe.
const reachMargin = (L) => (L.rank >= 3 ? 0.9 : 1.3 - 0.53 * L.skill);

// EXTREME: a cheap "does this lead anywhere?" count — how many other safe platforms are reachable on from s —
// so it avoids stranding itself on a dead end, the way a player who thinks a step ahead would. Capped and only
// run for extreme bots (it's an O(n) scan per candidate, so only worth it for the tier that needs the edge).
function branchFactor(w, s) {
  let n = 0;
  for (let j = 0; j < w.S.length; j++) {
    const q = w.S[j]; if (q === s || !q.solid) continue;
    const dh = q.top - s.top; if (Math.abs(dh) > 1.6) continue;
    const gap = Math.hypot(q.x - s.x, q.z - s.z) - q.r - s.r * 0.8;
    if (gap <= jumpReach(dh) * 0.85) { n++; if (n >= 4) break; }
  }
  return n;
}

function scorePlat(w, me, s, i, b, cur) {
  const L = b.lvl, look = 0.8 + L.skill * 6;
  const futureLava = lavaAt(w.lv, w.t + look);
  const safety = s.top - Math.max(w.lava, futureLava);
  if (safety < 0.5) return -1e9;
  let sc = Math.min(safety, 5) * 1.2 + s.top * 0.1;
  if (s.kind === 'basalt') sc -= (w.st[i] / 100) * 4.5;
  if (s.kind === 'pumice') sc -= 1.2 + (w.st[i] / 100) * 6;
  if (s.kind === 'mover') sc -= 0.35;
  if (s.kind === 'glass') sc -= 0.6;
  if (w.bombs) for (const bm of w.bombs) {
    const notice = 0.3 + L.skill * 0.9;             // how long before impact this skill level actually reacts
    if (bm.land - w.t > notice) continue;
    if (Math.hypot(s.x - bm.x, s.z - bm.z) < s.r + C.BOMB_R * 0.8) sc -= 3 * L.skill;
  }
  const occ = occOf(w, s.id, me);
  sc -= occ * (s.kind === 'pumice' ? 4 : 1.6);
  if (!cur) sc -= Math.hypot(s.x - me.x, s.z - me.z) * 0.12;
  if (L.rank >= 3 && !cur) sc += branchFactor(w, s) * 0.15;
  return sc + (b.brain.rnd() - 0.5) * (1 - L.skill) * 4.5;
}

// w = {S, st, lava, lv, t, players[], level}; me = player state. Fills and returns bot.inp.
export function botThink(w, me, b, dt) {
  const inp = b.inp, L = b.lvl;
  if (!me.alive) { inp.mx = inp.mz = 0; return inp; }
  const S = w.S;
  const cur = me.gr >= 0 ? S[me.gr] : null;
  if (b.holdJ > 0) { b.holdJ -= dt; inp.jh = b.holdJ > 0; }
  const tgt0 = b.target >= 0 ? S[b.target] : null;
  const committed = me.gr < 0 && tgt0 && standable(w, tgt0, tgt0.id) && tgt0.top > w.lava + 0.2;   // mid-jump: don't change your mind
  if (b.brain.ready(dt) && !committed) {
    // ---- choose where to stand next
    let best = -1, bs = -1e9;
    const curScore = cur && standable(w, cur, cur.id) ? scorePlat(w, me, cur, cur.id, b, true) + 1.1 - (cur.kind === 'basalt' && w.st[cur.id] > 42 ? 4 : 0) : -1e9;
    const fromY = cur ? cur.top : me.y;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (s === cur || !standable(w, s, i)) continue;
      const dh = s.top - fromY;
      if (dh > (L.rank >= 3 ? 2.0 : 1.5)) continue;
      const gap = Math.max(0, Math.hypot(s.x - me.x, s.z - me.z) - s.r - (cur ? cur.r * 0.8 : 0));
      const reach = jumpReach(dh) * reachMargin(L);
      if (gap > reach) continue;
      const sc = scorePlat(w, me, s, i, b, false);
      if (sc > bs) { bs = sc; best = i; }
    }
    if (best < 0 && (curScore < 0 || (cur && cur.kind === 'basalt' && w.st[cur.id] > 42))) {
      // nothing in easy reach and we have to move: try the closest rock we could make with a dash
      let bd = 1e9;
      for (let i = 0; i < S.length; i++) {
        const s = S[i]; if (s === cur || !standable(w, s, i) || s.top - fromY > 1.3 || s.top < w.lava + 0.8) continue;
        const gap = Math.max(0, Math.hypot(s.x - me.x, s.z - me.z) - s.r - (cur ? cur.r * 0.8 : 0));
        if (gap < jumpReach(s.top - fromY) * reachMargin(L) + 0.6 && gap - s.top < bd) { bd = gap - s.top; best = i; bs = curScore + 1; }
      }
    }
    if (best >= 0 && bs > curScore) { if (b.target !== best) { b.target = best; b.aimOff = (b.brain.rnd() * 2 - 1) * L.aimError * 0.8; b.fumble = b.brain.mistake(); b.jumpK = 0.42 + b.brain.rnd() * 0.25; } }
    else if (cur) b.target = cur.id;
    // ---- shove someone who is close and near an edge (or just close, if hard)
    b.prey = null; b.dashAttack = false;
    if (me.shoveCd <= 0 && me.stun <= 0) {
      for (const o of w.players) {
        if (o === me || !o.alive) continue;
        const d = Math.hypot(o.x - me.x, o.z - me.z);
        if (d > C.SHOVE_R + 0.6 || Math.abs(o.y - me.y) > 1.2) continue;
        // someone squaring up to me: shove first (quick bots win these exchanges)
        const facing = (Math.sin(o.face) * (me.x - o.x) + Math.cos(o.face) * (me.z - o.z)) / (d || 1);
        const counterP = L.rank >= 3 ? 0.85 : L.skill * 0.55;
        if (facing > 0.5 && d < C.SHOVE_R + 0.3 && b.brain.rnd() < counterP) { b.prey = o; break; }
        const oc = o.gr >= 0 ? S[o.gr] : null;
        const edge = !oc || Math.hypot(o.x - oc.x, o.z - oc.z) > oc.r - 0.6;
        const edgeP = L.rank >= 3 ? 0.9 : L.skill * 0.6, awayP = L.rank >= 3 ? 0.3 : L.skill * 0.12;
        if (b.brain.rnd() < (edge ? edgeP : awayP)) { b.prey = o; break; }
      }
    }
    // EXTREME: nobody in plain shove range, but someone vulnerable (near their own edge, or already airborne)
    // sits just inside dash range — close the gap with an attacking dash instead of just watching them go by.
    // Same dash everyone has (speed, cooldown, one-time use in the air); it just chooses to use it offensively.
    if (L.rank >= 3 && !b.prey && cur && me.dashCd <= 0 && me.stun <= 0) {
      let best = null, bd = 1e9;
      for (const o of w.players) {
        if (o === me || !o.alive) continue;
        const d = Math.hypot(o.x - me.x, o.z - me.z);
        if (d <= C.SHOVE_R + 0.6 || d > C.DASH_V * C.DASH_T + 1.0 || Math.abs(o.y - me.y) > 1.1) continue;
        const oc = o.gr >= 0 ? S[o.gr] : null;
        if (!oc) continue;                                             // only lunge at someone standing on solid ground
        const vulnerable = Math.hypot(o.x - oc.x, o.z - oc.z) > oc.r - 0.5;
        if (!vulnerable) continue;
        // only commit if the dash itself actually lands us on THEIR platform (not short, into the lava)
        const a = Math.atan2(o.x - me.x, o.z - me.z);
        const ax = me.x + Math.sin(a) * C.DASH_V * C.DASH_T, az = me.z + Math.cos(a) * C.DASH_V * C.DASH_T;
        if (Math.hypot(ax - oc.x, az - oc.z) > oc.r - 0.2) continue;
        if (d < bd) { bd = d; best = o; }
      }
      if (best && b.brain.rnd() < 0.85) { b.prey = best; b.dashAttack = true; }
    }
  }
  // ---- steer
  const T = b.target >= 0 ? S[b.target] : null;
  let gx = me.x, gz = me.z;
  if (b.prey && b.prey.alive) { gx = b.prey.x; gz = b.prey.z; }
  else if (T) { gx = T.x; gz = T.z; }
  let dx = gx - me.x, dz = gz - me.z, d = Math.hypot(dx, dz);
  if (b.dashAttack && b.prey && b.prey.alive && me.gr >= 0) {
    // commit to the lunge: face the target and dash the instant it's off cooldown
    const a = Math.atan2(dx, dz); inp.mx = Math.sin(a); inp.mz = Math.cos(a);
    if (me.dashCd <= 0 && me.stun <= 0) { inp.d++; b.dashAttack = false; }
  } else if (T && T === cur && !b.prey) {
    // stay near the middle of the platform we're on
    const k = d > 0.5 ? 1 : d / 0.5;
    const a = Math.atan2(dx, dz); inp.mx = Math.sin(a) * k * 0.8; inp.mz = Math.cos(a) * k * 0.8;
  } else if (b.prey && cur) {
    // close in on the prey, but never step off our own platform to do it
    const nx = me.x + (dx / (d || 1)) * 0.6, nz = me.z + (dz / (d || 1)) * 0.6;
    const a = Math.atan2(dx, dz);
    if (Math.hypot(nx - cur.x, nz - cur.z) < cur.r - 0.25) { inp.mx = Math.sin(a); inp.mz = Math.cos(a); } else { inp.mx = Math.sin(a) * 0.05; inp.mz = Math.cos(a) * 0.05; }
  } else if (d > 0.05) {
    const a = Math.atan2(dx, dz) + (me.gr >= 0 ? b.aimOff : b.aimOff * 0.3);
    inp.mx = Math.sin(a); inp.mz = Math.cos(a);
  } else { inp.mx = inp.mz = 0; }
  // shove
  if (b.prey && b.prey.alive && me.shoveCd <= 0 && me.stun <= 0) {
    const pd = Math.hypot(b.prey.x - me.x, b.prey.z - me.z);
    if (pd < C.SHOVE_R - 0.25) { me.face = Math.atan2(b.prey.x - me.x, b.prey.z - me.z); inp.s++; b.prey = null; }
  }
  // jump to the target platform
  if (T && T !== cur && me.gr >= 0 && me.stun <= 0) {
    const dh = T.top - me.y;
    const gap = Math.max(0, d - T.r);
    const reach = jumpReach(dh);
    const atEdge = cur ? Math.hypot(me.x - cur.x, me.z - cur.z) > cur.r - 0.35 : true;
    const k = b.fumble ? 1.25 : b.jumpK;
    if (gap < reach * k || (atEdge && gap < reach * 1.05) || (dh > 0.3 && gap < 0.6)) {
      inp.j++; b.holdJ = dh > -0.5 || gap > 2.5 ? 0.5 : 0.12; inp.jh = true;
      if (b.fumble && b.brain.rnd() < 0.5) b.holdJ = 0.05;
      b.fumble = false;
    }
  }
  // in the air: air-dash to rescue a short jump
  if (me.gr < 0 && !me.airDash && me.dashCd <= 0 && me.stun <= 0.1 && me.vy < -0.5) {
    let tgt = T && T !== cur && T.top < me.y ? T : null;
    if (!tgt) {
      let bd = 1e9;
      for (let i = 0; i < S.length; i++) { const s = S[i]; if (!standable(w, s, i) || s.top > me.y - 0.05 || s.top < w.lava + 0.4) continue; const dd = Math.hypot(s.x - me.x, s.z - me.z) - s.r; if (dd < bd) { bd = dd; tgt = s; } }
    }
    if (tgt) {
      const dc = Math.hypot(tgt.x - me.x, tgt.z - me.z), gd = dc - (tgt.r + 0.1);
      const g = C.G * C.FALL_MUL, h = Math.max(0, me.y - tgt.top);
      const tFall = (me.vy + Math.sqrt(me.vy * me.vy + 2 * g * h)) / g;
      const willMiss = gd > Math.max(Math.hypot(me.vx, me.vz), C.RUN * 0.8) * tFall;
      const after = C.DASH_V * C.DASH_T + C.RUN * 1.1 * Math.sqrt((2 * h) / g);     // where a dash now would land us
      if (willMiss && Math.abs(after - dc) < tgt.r + 0.4 && b.brain.rnd() < 0.15 + L.skill * 0.6) {
        const a = Math.atan2(tgt.x - me.x, tgt.z - me.z); inp.mx = Math.sin(a); inp.mz = Math.cos(a); inp.d++; b.target = tgt.id;
      }
    }
  }
  // in the air, heading toward a higher target that the first jump won't quite reach: double-jump to stretch
  // it (once per airtime) — a legitimate recovery, not guaranteed; weaker bots notice and use it less often.
  if (me.gr < 0 && !me.airJump && me.stun <= 0 && T && T !== cur && T.top > me.y + 0.3 && me.vy < 2.5) {
    const gd = Math.max(0, Math.hypot(T.x - me.x, T.z - me.z) - T.r);
    const willFallShort = gd > jumpReach(T.top - me.y) * reachMargin(L) * 0.85;
    if (willFallShort && b.brain.rnd() < 0.08 + L.skill * 0.5) {
      const a = Math.atan2(T.x - me.x, T.z - me.z); inp.mx = Math.sin(a); inp.mz = Math.cos(a); inp.j++; inp.jh = true; b.holdJ = 0.3;
    }
  }
  // stuck against a column side: hop
  if (me.gr >= 0 && T && T !== cur && Math.hypot(me.vx, me.vz) < 0.5 && d > 0.6) { b.stuck += dt; if (b.stuck > 0.4) { inp.j++; b.holdJ = 0.5; b.stuck = 0; } } else b.stuck = 0;
  inp.face = me.face;
  return inp;
}

// A dead bot's volcano spirit: every so often lob a lava bomb at a living player, leading their movement.
// Easy spirits wait longer and aim worse. Returns {x, z} when it wants to throw (the host checks cooldowns).
export function ghostThink(w, me, b, dt) {
  const L = b.lvl;
  b.ghostWait = (b.ghostWait ?? 1 + b.brain.rnd() * 2) - dt;
  if (b.ghostWait > 0) return null;
  b.ghostWait = 2 + (1 - L.skill) * 4 + b.brain.rnd() * 3;
  const alive = w.players.filter((o) => o.alive);
  if (!alive.length) return null;
  let o;
  if (L.rank >= 3) {
    // EXTREME: go for whoever a hit would actually finish — standing near their own platform's rim, or
    // already airborne over the drop, or on ground that's heating up and about to give way under them.
    // Everything here is on-screen state any player could read, not hidden intent.
    let best = null, bestSc = -1e9;
    for (const q of alive) {
      const qc = q.gr >= 0 ? w.S[q.gr] : null;
      const rim = qc ? Math.min(1, Math.hypot(q.x - qc.x, q.z - qc.z) / Math.max(0.1, qc.r)) : 1;
      const heat = qc && qc.kind === 'basalt' ? (w.st[qc.id] || 0) / 100 : 0;
      const sc = rim * 1.4 + heat * 0.7 + b.brain.rnd() * 0.3;
      if (sc > bestSc) { bestSc = sc; best = q; }
    }
    o = best;
  } else {
    o = alive[Math.floor(b.brain.rnd() * alive.length)];
  }
  // EXTREME leads by the bomb's full flight time (the correct constant-velocity pursuit lead); weaker spirits
  // lead by less of it and jitter their aim more.
  const lead = L.rank >= 3 ? C.BOMB_T : C.BOMB_T * L.skill * 0.8, err = L.aimError * 4;
  return { x: o.x + o.vx * lead + (b.brain.rnd() * 2 - 1) * err, z: o.z + o.vz * lead + (b.brain.rnd() * 2 - 1) * err };
}
