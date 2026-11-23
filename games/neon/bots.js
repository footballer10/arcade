// NEON RUSH — bot drivers (host only). Bots use the same physics as players and read the track ahead in track
// space: steer toward a racing line, drift through corners they can't take on grip, chain drifts through S-bends,
// spend boost on straights and before jumps. Difficulty comes from ctx.bots.level (reaction, aimError, skill, mistakes).
import { scalar, extent, wrapS, ENTRY } from './tracks.js';
import { C, CLASSES, clamp, tierOf } from './physics.js';

export function newBrain(level, rnd = Math.random) {
  const sk = level.skill ?? 0.7;
  // Difficulty is deliberately exaggerated well beyond the raw core skill number: with the same flawless,
  // instant-reaction line-following every tier gets from the formulas below, "easy" and "hard" bots used to
  // finish within a few seconds of each other -- not actually easy. Top speed, cornering caution, drift
  // willingness and steering sharpness all spread much further apart by tier. Extreme (level.tier === 'extreme')
  // is identified explicitly rather than by its raw skill number (which the core level object sets to 1, the
  // same bucket Hard's 0.92 would otherwise round into) and pushes every one of these further still, plus two
  // tactics Hard doesn't bother with: holding a marginal drift a bit longer to chain into the next bend, and
  // tucking into a rival's draft on a straight instead of just chasing position. Still the same physics and
  // inputs as a player -- no extra speed, no seeing through walls, just better execution.
  const T = level.tier === 'extreme' ? 3 : sk > 0.85 ? 2 : sk > 0.55 ? 1 : 0;   // 0 easy, 1 normal, 2 hard, 3 extreme
  return {
    level, rnd, sk, T,
    think: 0, noise: 0, noiseT: 0,
    tierGoal: [1, 2, 3, 3][T],
    speedCap: [0.72, 0.88, 0.99, 1][T],               // fraction of top speed they allow themselves
    steerGain: [0.55, 0.82, 1.05, 1.32][T],           // how sharply they correct toward the ideal line
    cornerCaution: [0.5, 0.22, 0, -0.3][T],           // extra margin before they lift/brake into a corner (negative: later, harder braking)
    boostMin: [72, 42, 20, 3][T],                     // meter % before they spend it
    driftK: [0.021, 0.015, 0.0105, 0.0072][T],        // curvature that makes them bother drifting
    scChance: [0.04, 0.32, 0.8, 1][T],                // chance to take a shortcut each lap
    bailChance: [0.012, 0.004, 0.0008, 0][T],         // per-frame chance to bail out of a held drift early
    patience: [1.2, 1.4, 1.6, 2.8][T],                // seconds to hold a drift past the exit, hoping to chain
    scPlan: new Map(), lapSeen: -1,
    holdDrift: false, wobble: 0, lineBias: (rnd() * 2 - 1) * 2.5,
  };
}

function avgK(path, s, a, b, step = 4) {
  let acc = 0, n = 0, peak = 0;
  for (let x = a; x <= b; x += step) { const k = scalar(path, path.k, s + x); acc += k; n++; if (Math.abs(k) > Math.abs(peak)) peak = k; }
  return [acc / Math.max(1, n), peak];
}

// returns an input object; `env` = { track, laps, t }
export function botInput(sh, br, env, out = {}) {
  const tr = env.track, path = tr.paths[sh.path] || tr.main, K = CLASSES[sh.cls] || CLASSES[0];
  const lv = br.level, rnd = br.rnd;
  out.throttle = 1; out.brake = 0; out.boost = false;
  if (sh.resp > 0) { out.steer = 0; out.drift = false; return out; }
  // recovery: turned sideways / backwards after a crash -> straighten out (reverse if needed)
  if (Math.abs(sh.yaw) > 1.05 && !sh.air) {
    out.drift = false; br.holdDrift = false;
    if (sh.vf > 6) { out.steer = -Math.sign(sh.yaw); out.throttle = 0.3; }
    else { out.throttle = 0; out.brake = 1; out.steer = Math.sign(sh.yaw); }
    return out;
  }
  const v = Math.max(8, sh.vf);
  const look = 10 + v * 0.5;
  const [kNear] = avgK(path, sh.s, 0, look * 0.6);
  const [kFar, kPeak] = avgK(path, sh.s, look * 0.5, look * 1.6);
  const hwL = extent(path, sh.s + look * 0.5, -1), hwR = extent(path, sh.s + look * 0.5, 1);

  // noise / reaction: easy bots wander off the line a bit
  br.noiseT -= 1 / 60;
  if (br.noiseT <= 0) { br.noiseT = 0.6 + rnd() * 1.4; br.noise = (rnd() * 2 - 1) * lv.aimError * 9; }

  // the next real corner ahead (first sample that curves more than a gentle bend)
  let kC = 0, kDist = 0;
  for (let x = 0; x < look * 2.2; x += 3) { const kk = scalar(path, path.k, sh.s + x); if (Math.abs(kk) > 0.009) { kC = kk; kDist = x; break; } }
  // racing line: outside before a corner, inside through it, otherwise back toward the middle
  const hwMin = Math.min(hwL, hwR);
  let dT;
  if (kC && kDist > 8) dT = -Math.sign(kC) * hwMin * 0.32;
  else if (kC) dT = Math.sign(kC) * hwMin * 0.38;
  else dT = 0;
  dT += br.lineBias + br.noise;
  // traffic: pick a side to pass a ship just ahead in our lane
  let passing = false;
  if (env.others) for (const o of env.others) {
    if (o === sh || o.path !== sh.path || o.ghost || o.out || o.resp > 0) continue;
    const ahead = o.prog - sh.prog;
    if (ahead > 0 && ahead < 10 + v * 0.35 && Math.abs(o.d - dT) < 3) {
      const side = o.d > 0 ? -1 : 1;
      dT = o.d + side * 3.6; passing = true; break;
    }
  }
  // extreme: tuck into a rival's draft on a straight rather than just holding the racing line -- free top speed
  // and meter (core/physics.js's own slipstream), so it's not cheating, just noticing the opportunity
  if (br.T >= 3 && !passing && !kC && env.others) for (const o of env.others) {
    if (o === sh || o.path !== sh.path || o.ghost || o.out || o.resp > 0) continue;
    const ahead = o.prog - sh.prog;
    if (ahead > 4 && ahead < 26 && Math.abs(o.d - sh.d) < 6) { dT = o.d; break; }
  }
  // shortcut plan (decided once per lap)
  const lap = Math.floor(sh.prog / tr.main.L);
  if (lap !== br.lapSeen) { br.lapSeen = lap; for (const sc of tr.main.shortcuts) br.scPlan.set(sc.path, rnd() < br.scChance); }
  if (sh.path === 0) {
    for (const sc of tr.main.shortcuts) {
      if (!br.scPlan.get(sc.path)) continue;
      let rel = sh.s - sc.a; if (rel < -tr.main.L / 2) rel += tr.main.L;
      if (rel > -60 && rel < ENTRY - 8) dT = sc.side * (rel < -20 ? extent(path, sh.s, sc.side) * 0.7 : extent(path, sh.s, sc.side) + 4);
    }
  }
  // (while actually ON a shortcut lane, dT keeps the corner-aware racing line computed above instead of being
  // overridden -- it used to collapse to "just stay near the centre", which doesn't react to the shortcut's own
  // curves and ran bots straight off the narrow lane on anything but the gentlest one)
  dT = clamp(dT, -hwL - 6, hwR + 6);

  // heading we want relative to the track tangent, and the turn rate that holds it
  const yawDes = clamp(Math.atan2(dT - sh.d, look), -0.55, 0.55);
  const kHere = scalar(path, path.k, sh.s);
  // steer on the direction we're actually travelling (in a drift the nose points further in than the velocity)
  const cy = Math.cos(sh.yaw), sy = Math.sin(sh.yaw);
  const vT = sh.vf * cy - sh.vl * sy, vR = sh.vf * sy + sh.vl * cy;
  const velYaw = Math.atan2(vR, Math.max(1, vT));
  const need = kHere * v + (yawDes - velYaw) * (sh.drift ? 2.4 : 3.2) * br.steerGain;
  const vn = clamp(sh.vf / C.VMAX, 0, 1.4);
  const grip = (C.TURN_LO + (C.TURN_HI - C.TURN_LO) * Math.min(1, vn)) * K.turn;

  // drift planning: corner too sharp to hold on grip at this speed -> drift into it
  const kd = C.DRIFT_K * K.turn, ka = C.DRIFT_KADJ * K.turn;
  // how much the track turns over the next stretch (same direction only)
  let ang = 0; for (let x = 0; x < 30 + v * 1.6; x += 5) { const kk = scalar(path, path.k, sh.s + x); if (Math.sign(kk) === Math.sign(kC || kPeak)) ang += Math.abs(kk) * 5; }
  // (drifting works just as well on a shortcut lane as on the main track -- no sh.path restriction here)
  const want = kC !== 0 && kDist < 6 + v * 0.12 && Math.abs(kPeak) > br.driftK && Math.abs(kPeak) > (kd - ka) * 1.2 && ang > 0.75 && v > 32 && !sh.air;
  if (!sh.drift) {
    br.holdDrift = false;
    if (want && rnd() > lv.mistakes * 0.05) {
      // steer into the corner first; press drift only once the steering points the right way
      const dir = Math.sign(kC || kPeak);
      out.steer = dir;
      br.holdDrift = sh.st * dir > 0.32;
      br.driftDir = dir; br.dT = 0;
    } else {
      out.steer = clamp(need / grip, -1, 1);
      // too fast for the corner on grip: lift / brake a little (lower-skill bots play it safer, earlier)
      if (Math.abs(need) > grip * (1.25 - br.cornerCaution) && v > 38) { out.throttle = 0; if (Math.abs(need) > grip * (1.6 - br.cornerCaution)) out.brake = 0.6; }
    }
  } else {
    const dir = sh.drift;
    br.holdDrift = true;
    const sd = clamp((need * dir / Math.max(18, sh.vf) - kd) / ka, -1, 1);
    out.steer = sd * dir;
    // release: corner over, goal tier reached on the exit, about to hit a wall, or drifting the wrong way
    const tier = tierOf(sh.dch);
    br.dT = (br.dT || 0) + 1 / 60;
    // hold through the corner we're in; let go as it straightens out (or flips the other way: chain!)
    const ending = (kHere * dir < 0.004 && kNear * dir < (kd - ka) * 0.6) || (kNear * dir < (kd - ka) * 0.5 && kFar * dir < (kd - ka) * 0.75 && (tier >= 1 || br.dT > br.patience));
    const dPred = sh.d + vR * 0.2;
    const wallNear = br.dT > 0.25 && (-dPred * dir > (dir > 0 ? hwL : hwR) - 1.4 || dPred * dir > (dir > 0 ? hwR : hwL) - 1.0);
    const fullTier = tier >= br.tierGoal && Math.abs(kFar) < br.driftK * 0.7;
    if (ending || fullTier || wallNear || tier >= 3 || dir !== br.driftDir) { br.holdDrift = false; br.why = ending ? 'end' : fullTier ? 'tier' : wallNear ? 'wall' : tier >= 3 ? 't3' : 'dir'; }
    if (rnd() < br.bailChance) br.holdDrift = false;   // lower-skill bots bail out of a drift early sometimes
  }
  out.drift = br.holdDrift;

  // speed cap by skill (+ rubber band from the host via sh.hc)
  if (sh.vf > C.VMAX * K.vmax * br.speedCap && !sh.mini && !sh.pad) out.throttle = 0;

  // boost: straights ahead, or not enough speed for a jump
  if (!sh.drift && sh.meter > br.boostMin) {
    const [, kp] = avgK(path, sh.s, 0, 140, 10);
    if (Math.abs(kp) < 0.009) out.boost = true;
  }
  for (const j of path.jumps) { const rel = j.lip - sh.s; if (rel > 0 && rel < 90 && sh.vf < 52 && sh.meter > 3) out.boost = true; }
  if (sh.meter > 92 && !sh.drift) out.boost = true;
  return out;
}
