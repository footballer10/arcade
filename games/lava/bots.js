// Rising Lava bots (run on the host, or on a client for the test autopilot). They read the same world the
// players see: pick a safe, cool, uncrowded platform they can reach, run and jump to it, air-dash to save a
// short jump, and shove anyone standing close to an edge. ctx.bots.level tunes reaction time, aim, planning
// horizon (how far ahead they read the lava) and how often they fumble a jump.
import { C, ST_CRUMBLE, ST_GONE, lavaAt } from './world.js';

const TAU = Math.PI * 2;
// horizontal distance a running jump covers when landing dh higher (negative = lower)
export function jumpReach(dh) {
  const v = C.JUMP, g = C.G, disc = v * v - 2 * g * dh;
  if (disc < 0) return 0;
  return C.RUN * ((v + Math.sqrt(disc)) / (g * 1.05));
}

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

function scorePlat(w, me, s, i, b, cur) {
  const L = b.lvl, look = 0.8 + L.skill * 6;
  const futureLava = lavaAt(w.lv, w.t + look);
  const safety = s.top - Math.max(w.lava, futureLava);
  if (safety < 0.5) return -1e9;
  let sc = Math.min(safety, 4.2) * 1.1 + s.top * 0.12;
  if (s.kind === 'basalt') sc -= (w.st[i] / 100) * 3.6;
  if (s.kind === 'pumice') sc -= 1.2 + (w.st[i] / 100) * 6;
  if (s.kind === 'mover') sc -= 0.35;
  if (s.kind === 'glass') sc -= 0.6;
  const occ = occOf(w, s.id, me);
  sc -= occ * (s.kind === 'pumice' ? 4 : 1.6);
  if (!cur) sc -= Math.hypot(s.x - me.x, s.z - me.z) * 0.12;
  return sc + (b.brain.rnd() - 0.5) * (1 - L.skill) * 1.6;
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
    const curScore = cur && standable(w, cur, cur.id) ? scorePlat(w, me, cur, cur.id, b, true) + 1.1 - (cur.kind === 'basalt' && w.st[cur.id] > 55 ? 4 : 0) : -1e9;
    const fromY = cur ? cur.top : me.y;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (s === cur || !standable(w, s, i)) continue;
      const dh = s.top - fromY;
      if (dh > 1.5) continue;
      const gap = Math.max(0, Math.hypot(s.x - me.x, s.z - me.z) - s.r - (cur ? cur.r * 0.8 : 0));
      const reach = jumpReach(dh) * (0.82 + L.skill * 0.15);
      if (gap > reach) continue;
      const sc = scorePlat(w, me, s, i, b, false);
      if (sc > bs) { bs = sc; best = i; }
    }
    if (best >= 0 && bs > curScore) { if (b.target !== best) { b.target = best; b.aimOff = (b.brain.rnd() * 2 - 1) * L.aimError * 0.8; b.fumble = b.brain.mistake(); b.jumpK = 0.42 + b.brain.rnd() * 0.25; } }
    else if (cur) b.target = cur.id;
    // ---- shove someone who is close and near an edge (or just close, if hard)
    b.prey = null;
    if (me.shoveCd <= 0 && me.stun <= 0) {
      for (const o of w.players) {
        if (o === me || !o.alive) continue;
        const d = Math.hypot(o.x - me.x, o.z - me.z);
        if (d > C.SHOVE_R + 0.6 || Math.abs(o.y - me.y) > 1.2) continue;
        // someone squaring up to me: shove first (quick bots win these exchanges)
        const facing = (Math.sin(o.face) * (me.x - o.x) + Math.cos(o.face) * (me.z - o.z)) / (d || 1);
        if (facing > 0.5 && d < C.SHOVE_R + 0.3 && b.brain.rnd() < L.skill * 0.9) { b.prey = o; break; }
        const oc = o.gr >= 0 ? S[o.gr] : null;
        const edge = !oc || Math.hypot(o.x - oc.x, o.z - oc.z) > oc.r - 0.6;
        if (b.brain.rnd() < (edge ? 0.35 + L.skill * 0.55 : L.skill * 0.25)) { b.prey = o; break; }
      }
    }
  }
  // ---- steer
  const T = b.target >= 0 ? S[b.target] : null;
  let gx = me.x, gz = me.z;
  if (b.prey && b.prey.alive) { gx = b.prey.x; gz = b.prey.z; }
  else if (T) { gx = T.x; gz = T.z; }
  let dx = gx - me.x, dz = gz - me.z, d = Math.hypot(dx, dz);
  if (T && T === cur && !b.prey) {
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
  // stuck against a column side: hop
  if (me.gr >= 0 && T && T !== cur && Math.hypot(me.vx, me.vz) < 0.5 && d > 0.6) { b.stuck += dt; if (b.stuck > 0.4) { inp.j++; b.holdJ = 0.5; b.stuck = 0; } } else b.stuck = 0;
  inp.face = me.face;
  return inp;
}
