// NEON RUSH — ship physics in track space. Shared by the host simulation, client prediction, bots and the
// node tuning scripts, so it must stay deterministic and free of three.js / DOM.
//
// Ship state (all numbers, so it packs straight into a Float32Array for the network):
//   path, s, d, y, vy (position on a track path; y = height above the surface)
//   yaw (heading relative to the track tangent), vf / vl (velocity in the ship's heading frame: forward / lateral)
//   drift (-1/0/1), dch (drift charge, tiers at 1/2/3), dlink (this drift continues a chain), chain, chainT
//   meter (0..100 boost flux), mini (mini-boost timer), pad (boost-strip timer), ...
import { wrapS, scalar, extent, gapAt, idxAt, mainS, ENTRY, SC_LEAD } from './tracks.js';

export const FIXED = 1 / 60;
export const C = {
  VMAX: 60, VPAD: 80, VBOOST: 86, ACC: 30, ACC_BOOST: 75, BRAKE: 60, COAST: 7, REV: 14,
  TURN_LO: 2.3, TURN_HI: 1.2, GRIP: 9, AIR_GRIP: 0.6,
  DRIFT_MINV: 22, DRIFT_K: 0.016, DRIFT_KADJ: 0.009, DRIFT_MAXYAW: 0.55, DRIFT_GRIP: 8, CHARGE: 1.7,
  CHAIN_WIN: 1.25, CHAIN_MAX: 5, DRAIN: 30, G: 42, SHIP_HW: 1.1, DRAFT_ON: 0.6, OVERHEAT: 1.3, UNDERDOG: 0.35,
};
export const TIER_AT = [0, 0.85, 2.2, 3.7];      // drift charge needed for each tier
export const MINI = [0, 0.5, 0.85, 1.3];     // mini-boost seconds on release, by tier
export const GAIN = [0, 10, 18, 28];          // boost meter % on release, by tier (× chain multiplier)
export const chainMult = (chain) => 1 + 0.5 * Math.max(0, chain - 1);

// Ship classes (manifest pick). Multipliers on the base constants.
export const CLASSES = [
  { key: 'comet', name: 'Comet', vmax: 1, acc: 1, turn: 1, grip: 1, charge: 1, drain: 1 },
  { key: 'viper', name: 'Viper', vmax: 1.035, acc: 0.92, turn: 0.94, grip: 0.95, charge: 0.86, drain: 1 },
  { key: 'wisp', name: 'Wisp', vmax: 0.975, acc: 1.12, turn: 1.07, grip: 1.05, charge: 1.2, drain: 1.08 },
];

// Events raised by step() (bitmask in ship.ev, consumed by whoever renders / plays sounds).
export const EV = { TIER: 1, RELEASE: 2, FIZZLE: 4, WALL: 8, JUMP: 16, LAND: 32, PAD: 64, FALL: 128, RESPAWN: 256, LAP: 512, FINISH: 1024, BUMP: 2048, DRAFT: 4096, START_DRIFT: 8192, SHORTCUT: 16384, OVERHEAT: 32768, OUT: 65536 };

export const KEYS = ['path', 's', 'd', 'y', 'vy', 'yaw', 'vf', 'vl', 'st', 'drift', 'dch', 'dlink', 'dlock', 'chain', 'chainT', 'meter', 'mini', 'pad',
  'air', 'resp', 'respS', 'prog', 'fin', 'wallT', 'draft', 'lapT', 'best', 'maxChain', 'cls', 'ghost', 'boosting', 'hc', 'bumpT', 'lastTier', 'drifts', 'lastLap', 'heat', 'rk', 'out', 'outT', 'golds'];

export function newShip(track, cls, s, d) {
  const L = track.main.L;
  const sh = Object.fromEntries(KEYS.map((k) => [k, 0]));
  Object.assign(sh, { s: wrapS(track.main, s), d, cls, chainT: 99, hc: 1, prog: s > L / 2 ? s - L : s < 0 ? s : s, ev: 0, impact: 0 });
  if (s < 0) sh.s = wrapS(track.main, s);
  return sh;
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// Input: {steer -1..1, throttle 0..1, brake 0..1, drift bool, boost bool}
export const NO_INPUT = { steer: 0, throttle: 0, brake: 0, drift: false, boost: false };
export function packInput(i) { return (i.steer < -0.2 ? 1 : 0) | (i.steer > 0.2 ? 2 : 0) | (i.throttle > 0.5 ? 4 : 0) | (i.brake > 0.5 ? 8 : 0) | (i.drift ? 16 : 0) | (i.boost ? 32 : 0); }
export function unpackInput(b) { return { steer: ((b & 2) ? 1 : 0) - ((b & 1) ? 1 : 0), throttle: (b & 4) ? 1 : 0, brake: (b & 8) ? 1 : 0, drift: !!(b & 16), boost: !!(b & 32) }; }

// ---------------------------------------------------------------- step
// env: { track, t (race time), laps, others: [ships] (optional, for slipstream) }
export function step(sh, inp, dt, env) {
  const tr = env.track, K = CLASSES[sh.cls] || CLASSES[0];
  let path = tr.paths[sh.path] || tr.main;
  sh.boosting = 0;
  if (sh.out) { sh.vf *= 0.97; return; }
  if (sh.resp > 0) { sh.resp -= dt; if (sh.resp <= 0) respawn(sh, tr); return; }
  sh.chainT += dt;
  sh.wallT = Math.max(0, sh.wallT - dt); sh.mini = Math.max(0, sh.mini - dt); sh.pad = Math.max(0, sh.pad - dt); sh.bumpT = Math.max(0, sh.bumpT - dt);
  if (sh.chain && !sh.drift && sh.chainT > C.CHAIN_WIN) sh.chain = 0;
  if (!inp.drift) sh.dlock = 0;

  // steering: keyboard is digital, smooth it (fast in, faster out)
  const target = clamp(inp.steer, -1, 1);
  sh.st += (target - sh.st) * Math.min(1, dt * (Math.abs(target) > Math.abs(sh.st) ? 8 : 14));
  const air = sh.air > 0;

  // ---- drift start / end
  if (!sh.drift) {
    if (inp.drift && !sh.dlock && !air && sh.vf > C.DRIFT_MINV && Math.abs(sh.st) > 0.3) {
      sh.drift = sh.st > 0 ? 1 : -1; sh.dch = 0; sh.lastTier = 0; sh.heat = 0; sh.drifts++;
      sh.dlink = sh.chain > 0 && sh.chainT <= C.CHAIN_WIN ? 1 : 0;
      sh.vl -= sh.drift * 2.5; sh.yaw += sh.drift * 0.06;   // kick the tail out: crisp entry
      sh.ev |= EV.START_DRIFT;
    }
  } else if (!inp.drift) release(sh);
  else if (sh.vf < C.DRIFT_MINV * 0.6) fizzle(sh, false);

  // ---- yaw
  const vn = clamp(sh.vf / C.VMAX, 0, 1.4);
  let rate;
  if (sh.drift) {
    rate = sh.drift * (C.DRIFT_K + C.DRIFT_KADJ * sh.st * sh.drift) * K.turn * Math.max(18, sh.vf);   // drift = pick a turn radius (≈26..87)
    // the slide saturates: ease the turn-in rate toward 0 as the car's nose nears DRIFT_MAXYAW off the track
    // tangent, so holding a drift through a straight or a gentle bend doesn't run away into a wall -- it just
    // settles at a fixed, dramatic slide angle. Steering back the other way is never throttled.
    if (Math.sign(rate) === Math.sign(sh.yaw) || sh.yaw === 0) rate *= 1 - clamp(Math.abs(sh.yaw) / C.DRIFT_MAXYAW, 0, 1);
  } else rate = sh.st * (C.TURN_LO + (C.TURN_HI - C.TURN_LO) * Math.min(1, vn)) * K.turn * Math.min(1, Math.abs(sh.vf) / 7) * (sh.vf < -0.5 ? -1 : 1);
  if (air) rate *= 0.35;
  const dyaw = rate * dt;
  sh.yaw += dyaw;
  { const c = Math.cos(dyaw), s = Math.sin(dyaw), vf = sh.vf, vl = sh.vl; sh.vf = vf * c + vl * s; sh.vl = vl * c - vf * s; }

  // ---- thrust / boost
  const meterBoost = inp.boost && sh.meter > 0.5;
  if (meterBoost) sh.meter = Math.max(0, sh.meter - C.DRAIN * K.drain * dt);
  const boosting = meterBoost || sh.mini > 0 || sh.pad > 0;
  sh.boosting = meterBoost ? 2 : boosting ? 1 : 0;
  let vmax = C.VMAX * K.vmax * sh.hc;
  if (sh.mini > 0 || sh.pad > 0) vmax = Math.max(vmax, C.VPAD * K.vmax);
  if (meterBoost) vmax = C.VBOOST * K.vmax;
  if (sh.draft > C.DRAFT_ON) vmax *= 1.07;
  if (sh.drift) vmax *= 0.975;
  const thr = boosting ? 1 : clamp(inp.throttle, 0, 1);
  if (thr > 0 && sh.vf < vmax) {
    const f = Math.max(0, sh.vf) / vmax;
    sh.vf += (boosting ? C.ACC_BOOST : C.ACC * K.acc) * thr * (1 - f * f * 0.85) * (air ? 0.4 : 1) * dt;
    if (sh.vf > vmax) sh.vf = vmax;
  } else if (sh.vf > vmax) sh.vf -= (sh.vf - vmax) * 1.4 * dt + 2 * dt;
  if (inp.brake > 0 && !boosting) {
    if (sh.vf > 0) sh.vf = Math.max(-0.1, sh.vf - C.BRAKE * inp.brake * dt);
    else sh.vf = Math.max(-C.REV, sh.vf - C.ACC * 0.5 * dt);
  } else if (thr <= 0) {
    const c = C.COAST * dt; sh.vf = Math.abs(sh.vf) <= c ? 0 : sh.vf - Math.sign(sh.vf) * c;
  }

  // ---- lateral grip (low while drifting: the slide is what charges the meter)
  const grip = air ? C.AIR_GRIP : (sh.drift ? C.DRIFT_GRIP : C.GRIP) * K.grip;
  const nvl = sh.vl * Math.exp(-grip * dt), lost = Math.abs(sh.vl) - Math.abs(nvl);
  sh.vl = nvl;
  if (sh.vf > 0) sh.vf += lost * (sh.drift ? 0.3 : 0.12);

  // ---- drift charge
  if (sh.drift && !air) {
    // tighter drifts (steering into the turn) and more speed charge faster
    const x = clamp(sh.st * sh.drift, -1, 1);
    const q = (0.55 + 0.45 * (x + 1) / 2) * clamp(sh.vf / 40, 0, 1);
    sh.dch = Math.min(3.999, sh.dch + dt * C.CHARGE * q * K.charge);
    const tier = tierOf(sh.dch);
    if (tier > sh.lastTier) { sh.lastTier = tier; sh.ev |= EV.TIER; }
    // gold can only be held so long: overheat burns the whole drift (and the chain)
    if (tier === 3) { sh.heat += dt; if (sh.heat > C.OVERHEAT) { fizzle(sh, false); sh.ev |= EV.OVERHEAT; sh.vf *= 0.9; } }
  }

  // ---- move in track space
  const cy = Math.cos(sh.yaw), sy = Math.sin(sh.yaw);
  const vT = sh.vf * cy - sh.vl * sy, vR = sh.vf * sy + sh.vl * cy;
  const k = scalar(path, path.k, sh.s);
  const ds = (vT * dt) / Math.max(0.35, 1 - k * clamp(sh.d, -14, 14));
  const s0 = sh.s;
  let sRaw = sh.s + ds;
  sh.d += vR * dt;
  sh.yaw = wrapA(sh.yaw - k * ds);
  if (!path.closed && sRaw < 0) { sRaw = 0; if (sh.vf < 0) sh.vf = 0; }
  // jumps (lip crossing while grounded)
  if (!air && path.jumps.length) for (const j of path.jumps) if (s0 < j.lip && sRaw >= j.lip) { sh.air = 1; sh.vy = 7 + Math.max(0, sh.vf) * 0.2; sh.ev |= EV.JUMP; if (sh.drift) release(sh); }
  sh.s = path.closed ? wrapS(path, sRaw) : sRaw;

  // shortcut end: drop back onto the main track
  if (!path.closed && sh.s >= path.L - 0.5) {
    const p = path.parent;
    sh.path = 0; sh.s = wrapS(tr.main, p.b + (sh.s - path.L)); sh.y += p.lift; sh.vy = Math.max(sh.vy, 6); sh.air = 1;
    path = tr.main;
    if (sh.drift) release(sh);
  }

  // ---- air
  if (sh.air) {
    sh.vy -= C.G * dt; sh.y += sh.vy * dt;
    if (sh.y <= 0) {
      const overGap = gapAt(path, sh.s);
      if (overGap) { if (sh.y < -7) return fall(sh, tr, path); }
      else if (sh.y < -6) return fall(sh, tr, path);
      else {
        // a short landing (clipped the far edge) costs speed instead of a respawn
        if (sh.y < -2) { sh.vf *= 0.72; sh.vl *= 0.5; }
        sh.impact = -sh.vy + (sh.y < -2 ? 12 : 0); sh.y = 0; sh.vy = 0; sh.air = 0; sh.ev |= EV.LAND;
      }
    }
  } else if (gapAt(path, sh.s)) { sh.air = 1; sh.vy = 0; }

  // ---- walls, open edges, shortcut entries
  const i = idxAt(path, sh.s);
  for (const side of [-1, 1]) {
    const ext = extent(path, sh.s, side), lim = ext - C.SHIP_HW, dd = sh.d * side;
    // shortcuts: catch you well before the literal edge, so finding one doesn't require hugging the wall.
    // (only loosened for *entering* from the main track -- the exit check below stays strict, so cruising
    // the narrow shortcut lane doesn't flap you back onto the main track from ordinary lateral noise.)
    if (path === tr.main && dd > ext * 0.6 && transfer(sh, tr, path, side)) { path = tr.paths[sh.path]; break; }
    if (dd <= lim) continue;
    const wall = side < 0 ? path.wl[i] : path.wr[i];
    if (wall) {
      sh.d = lim * side;
      const into = vR * side;
      if (into > 0) {
        // redirect velocity away from the wall and straighten the heading back toward it every frame
        // (so a car pinned against a wall self-corrects and stops plowing further in), but only take the
        // speed penalty and fire the event/sound once per contact -- otherwise a sustained scrape (e.g.
        // riding the inside wall through a drift) reapplies the loss dozens of times a second and the
        // car stops dead almost instantly, which is exactly what made drifting feel like "just crashing".
        const bvR = -side * into * 0.25;
        sh.vf = vT * cy + bvR * sy; sh.vl = -vT * sy + bvR * cy;
        if (Math.abs(sh.yaw) < 1.4) sh.yaw *= 1 - Math.min(0.6, into * 0.03);
        if (sh.wallT <= 0) {
          sh.vf *= 1 - Math.min(0.32, into * 0.0085);
          if (into > 7) {
            sh.ev |= EV.WALL; sh.wallT = 0.4; sh.impact = into;
            if (into > 19 && sh.drift) fizzle(sh, true);
          }
        }
      }
    } else if (transfer(sh, tr, path, side)) { path = tr.paths[sh.path]; break; }
    else if (dd > ext + 0.8 && !sh.air) return fall(sh, tr, path);
    else if (dd > ext + 3) return fall(sh, tr, path);
  }

  // ---- boost strips
  if (!sh.air && path.pads.length) for (const p of path.pads) {
    if (sh.s >= p.s0 && sh.s <= p.s1 && sh.d >= p.d0 - 1 && sh.d <= p.d1 + 1) { if (sh.pad < 0.45) { sh.ev |= EV.PAD; sh.meter = Math.min(100, sh.meter + 5); } sh.pad = 0.75; }
  }

  // ---- slipstream
  if (env.others) {
    let inDraft = false;
    for (const o of env.others) {
      if (o === sh || o.ghost || o.out || o.resp > 0 || o.path !== sh.path) continue;
      const ahead = o.prog - sh.prog;
      if (ahead > 3.5 && ahead < 28 && Math.abs(o.d - sh.d) < 2.6 && Math.abs(o.y - sh.y) < 3) { inDraft = true; break; }
    }
    const was = sh.draft > C.DRAFT_ON;
    sh.draft = inDraft ? Math.min(2, sh.draft + dt) : Math.max(0, sh.draft - dt * 3);
    if (sh.draft > C.DRAFT_ON) { sh.meter = Math.min(100, sh.meter + 7 * dt); if (!was) sh.ev |= EV.DRAFT; }
  }

  progress(sh, tr, env);
}

export const tierOf = (dch) => (dch >= TIER_AT[3] ? 3 : dch >= TIER_AT[2] ? 2 : dch >= TIER_AT[1] ? 1 : 0);
function release(sh) {
  const tier = tierOf(sh.dch);
  if (tier >= 1) {
    sh.chain = sh.dlink ? Math.min(C.CHAIN_MAX, sh.chain + 1) : 1;
    sh.maxChain = Math.max(sh.maxChain, sh.chain);
    const m = chainMult(sh.chain) * (1 + C.UNDERDOG * sh.rk);
    if (tier === 3) sh.golds++;
    sh.mini = Math.max(sh.mini, MINI[tier] * (1 + 0.1 * (sh.chain - 1)));
    sh.meter = Math.min(100, sh.meter + GAIN[tier] * m);
    sh.vf += 3 + tier * 1.5;
    sh.chainT = 0;
    sh.ev |= EV.RELEASE;
  } else { sh.chain = 0; sh.ev |= EV.FIZZLE; }
  sh.drift = 0; sh.dch = 0; sh.dlink = 0; sh.heat = 0;
}
function fizzle(sh, wall) {
  sh.drift = 0; sh.dch = 0; sh.dlink = 0; sh.dlock = 1; sh.chain = 0; sh.heat = 0;
  sh.ev |= EV.FIZZLE;   // (wall: the normal wall-bounce physics above already costs speed; no extra penalty here)
}

// leaving the surface sideways: hop onto / off a shortcut lane
function transfer(sh, tr, path, side) {
  if (path === tr.main) {
    for (const sc of tr.main.shortcuts) {
      if (sc.side !== side) continue;
      let rel = sh.s - sc.a; if (rel < -tr.main.L / 2) rel += tr.main.L;
      // SC_LEAD: the wall is already open a bit before the shortcut's own 's=0', so a player who
      // pushes wide early still gets caught (clamped onto the start of the shortcut lane) instead
      // of sailing past the opening into open air.
      if (rel < -SC_LEAD || rel > ENTRY - 3) continue;
      const hwM = scalar(tr.main, tr.main.hw, sh.s);
      sh.path = sc.path; sh.s = Math.max(0, rel); sh.d -= side * (hwM + sc.hwSc);
      sh.ev |= EV.SHORTCUT;
      return true;
    }
  } else if (path.parent && sh.s < ENTRY - 2 && side === -path.parent.side) {
    const p = path.parent, hwM = scalar(tr.main, tr.main.hw, p.a + sh.s);
    sh.path = 0; sh.s = wrapS(tr.main, p.a + sh.s); sh.d += p.side * (hwM + p.hwSc);
    return true;
  }
  return false;
}

function fall(sh, tr, path) {
  sh.ev |= EV.FALL; sh.resp = 1.25;
  if (sh.drift) { sh.drift = 0; sh.dch = 0; }
  sh.chain = 0; sh.dlink = 0;
  let rs;
  if (path !== tr.main) rs = path.parent.a + ENTRY + 8;
  else {
    rs = sh.s;
    for (const j of path.jumps) { let rel = sh.s - j.ramp; if (rel < 0) rel += path.L; if (rel < j.end - j.ramp + 20) rs = j.end + 8; }
  }
  sh.respS = wrapS(tr.main, rs);
  sh.vf = 0; sh.vl = 0; sh.vy = 0;
}
function respawn(sh, tr) {
  sh.path = 0; sh.s = sh.respS; sh.d = 0; sh.y = 0; sh.vy = 0; sh.air = 0; sh.yaw = 0; sh.vl = 0; sh.vf = 30; sh.mini = 0.6; sh.resp = 0;
  sh.ev |= EV.RESPAWN;
}

// race progress along the main track + laps / finish
function progress(sh, tr, env) {
  const L = tr.main.L;
  const ms = mainS(tr, sh.path, sh.s);
  let dms = ms - wrapS(tr.main, sh.prog);
  if (dms > L / 2) dms -= L; else if (dms < -L / 2) dms += L;
  if (Math.abs(dms) > 80) return;   // teleport (respawn far away): keep progress, it re-syncs next step
  const before = Math.floor(sh.prog / L);
  sh.prog += dms;
  const after = Math.floor(sh.prog / L);
  if (sh.fin || after <= before) return;
  if (before >= 0) {   // completed a lap (crossing the line at the start doesn't count)
    const lt = env.t - sh.lapT; sh.lastLap = lt; if (!sh.best || lt < sh.best) sh.best = lt;
    sh.ev |= EV.LAP;
  }
  sh.lapT = env.t;
  if (after >= env.laps) { sh.fin = Math.max(0.001, env.t); sh.ev |= EV.FINISH; }
}
export const lapOf = (sh, track, laps) => clamp(Math.floor(sh.prog / track.main.L) + 1, 1, laps);
export const respawnS = (sh) => sh.respS;

// host only: ship-to-ship bumps
export function collide(ships) {
  for (let a = 0; a < ships.length; a++) {
    const A = ships[a]; if (A.ghost || A.out || A.resp > 0) continue;
    for (let b = a + 1; b < ships.length; b++) {
      const B = ships[b]; if (B.ghost || B.out || B.resp > 0 || A.path !== B.path) continue;
      const ds = B.prog - A.prog, dd = B.d - A.d;
      if (Math.abs(ds) > 3.8 || Math.abs(dd) > 2.3 || Math.abs(A.y - B.y) > 2.5) continue;
      const side = dd >= 0 ? 1 : -1, push = (2.3 - Math.abs(dd)) * 0.5 + 0.05;
      A.d -= side * push; B.d += side * push;
      if (Math.abs(dd) > 1.1) { A.vl -= side * 3.5; B.vl += side * 3.5; }
      else { const back = ds > 0 ? A : B, front = ds > 0 ? B : A; back.vf *= 0.9; front.vf += 2; }
      if (A.bumpT <= 0 || B.bumpT <= 0) { A.ev |= EV.BUMP; B.ev |= EV.BUMP; A.bumpT = B.bumpT = 0.3; }
    }
  }
}

// placements: finished by time, then everyone else by progress
export function order(ships) {
  // knocked-out ships sort last, the most recently knocked out first
  return [...ships].sort((a, b) => (a.out || b.out ? (a.out ? (b.out ? b.outT - a.outT : 1) : -1) : a.fin && b.fin ? a.fin - b.fin : a.fin ? -1 : b.fin ? 1 : b.prog - a.prog));
}
