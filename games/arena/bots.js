// AI bots. They produce the same input objects humans send.
import { ARENA_R, OBSTACLES, HOLES, BUSHES, MAP, sweeperAngle, inBush, BOMB_RANGE, WELL_RANGE, TELEPORT_MAX, BOMB_R, PLAYER_R } from './sim.js';

export const BOT_NAMES = ['Bolt', 'Nova', 'Rex', 'Pixel', 'Juno', 'Tank', 'Zip', 'Echo', 'Fang', 'Mochi', 'Ziggy', 'Blip'];
// Reaction/accuracy toned down a notch across the board (bots were sweeping new/casual players, especially at
// the default "Normal" level): slower think cycles, wider aim error, less eager specials/dashes, and a shorter
// sight range for power-ups/cubes so they don't out-scale a human just by having perfect map awareness.
export const BOT_LEVELS = {
  easy:   { label: 'Easy',   think: [0.32, 0.48], aimErr: 0.8,  lead: 0.1, dashP: 0.01,  spP: 0.12, calm: 0.85, cover: false, flank: 0.0, puRange: 3.5 },
  normal: { label: 'Normal', think: [0.18, 0.28], aimErr: 0.5,  lead: 0.45, dashP: 0.03, spP: 0.32, calm: 0.6,  cover: true,  flank: 0.3, puRange: 5.5 },
  hard:   { label: 'Hard',   think: [0.08, 0.14], aimErr: 0.22, lead: 0.85, dashP: 0.07, spP: 0.6,  calm: 0.35, cover: true,  flank: 0.55, puRange: 7 },
  // ctx.bots.level 'extreme' (tier/rank, key still reports 'hard'). A sharp human, not a cheat: same reaction floor
  // as Hard's think loop just runs tighter, aim is close to perfect, and it uses specials/dashes the instant they're
  // off cooldown and useful — but it still can't see through walls or move faster than any other player. The
  // extreme-only tactics below (telegraph dodging, bush retreats, finishing a low-HP target) live in botInput().
  extreme: { label: 'Extreme', think: [0.045, 0.07], aimErr: 0.06, lead: 1.0, dashP: 0.18, spP: 0.95, calm: 0.15, cover: true, flank: 0.75, puRange: 999, extreme: true },
};
const RANGE = { blaster: 8, brawler: 1.7, trickster: 1.5, bomber: 7, ranger: 12, frost: 4.5, ram: 1.6, hook: 2.6 };
const SHOT_SPEED = { blaster: 24, ranger: 30, frost: 20 };

const norm = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
function safeSpot(x, z, zr, margin = 1.5) {
  if (Math.hypot(x, z) > Math.min(zr, ARENA_R) - margin) return false;
  return !HOLES.some((h) => Math.hypot(x - h.x, z - h.z) < h.r + margin);
}

export function botInput(sim, p, dt) {
  const L = BOT_LEVELS[sim.botLevel] || BOT_LEVELS.normal;
  const m = p.bot || (p.bot = {
    think: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0, aimErr: 0, wander: Math.random() * 6.28,
    flank: (Math.random() < 0.5 ? -1 : 1) * L.flank, calm: Math.random() * 3,
    inp: { mx: 0, mz: 0, aim: 0, tx: 0, tz: 0, atk: false, dashSeq: 0, spSeq: 0, seq: 0 },
  });
  const inp = m.inp;
  m.think -= dt; m.strafeT -= dt;
  if (m.strafeT <= 0) { m.strafe *= -1; m.strafeT = 0.7 + Math.random() * 1.6; }
  if (m.think > 0) return inp;
  const thinkDt = L.think[0] + Math.random() * (L.think[1] - L.think[0]);
  m.think = thinkDt;

  if (!p.alive || p.falling || sim.phase !== 'play') { inp.mx = inp.mz = 0; inp.atk = false; return inp; }

  const zr = Math.min(sim.zoneR, ARENA_R);
  // pick a target: close, hurt, and (on hard) near the edge
  let best = null, bd = 1e9, bestScore = 1e9;
  for (const q of sim.players.values()) {
    if (q === p || !q.alive || q.falling) continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d > 4 && q.hitT <= 0 && inBush(q.x, q.z)) continue; // can't see players hiding in bushes
    const edge = Math.max(0, Math.hypot(q.x, q.z) - (zr - 5));
    const score = d - (1 - q.hp / q.maxHp) * 3 - edge * L.flank;
    if (score < bestScore) { bestScore = score; best = q; bd = d; }
  }
  if (L.extreme && best) {
    // A sharp player always takes a free kill: switch off the positional "best" target onto any other visible,
    // already-in-range enemy on death's door, instead of sticking to whoever scored best on distance/edge/hp.
    let finish = null, fd = 1e9;
    for (const q of sim.players.values()) {
      if (q === p || q === best || !q.alive || q.falling) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > 4 && q.hitT <= 0 && inBush(q.x, q.z)) continue;
      if (q.hp / q.maxHp > 0.2 || d > RANGE[p.char] + 2) continue;
      if (d < fd) { fd = d; finish = q; }
    }
    if (finish) { best = finish; bd = fd; }
  }

  let mx = 0, mz = 0;
  let wantDash = false, dashDir = null;
  // calm/aggro cycle so bots don't all dogpile the whole time
  m.calm -= thinkDt;
  if (m.calm < -5) m.calm = (1 + Math.random() * 5) * L.calm * 2;
  const hurt = p.hp / p.maxHp < 0.35 && bd < 8;
  const ranged = p.char === 'blaster' || p.char === 'bomber' || p.char === 'ranger' || p.char === 'frost';
  const shooter = !!SHOT_SPEED[p.char];
  let engage = best && (bd < 4 || (bd < 14 && m.calm <= 0));

  if (best && hurt && L.cover) {
    // retreat behind the obstacle that best blocks the attacker (extreme: a bush beats a wall when it's closer —
    // vanishing from sight entirely is strictly better than just blocking line of sight)
    const cover = findCover(p, best, zr);
    let tgt = cover, td = cover ? Math.hypot(cover.x - p.x, cover.z - p.z) : Infinity;
    if (L.extreme) {
      const bush = findBush(p, best, zr);
      if (bush) { const d2 = Math.hypot(bush.x - p.x, bush.z - p.z); if (d2 < td) { tgt = bush; td = d2; } }
    }
    if (tgt) { const [cx, cz] = norm(tgt.x - p.x, tgt.z - p.z); if (td > 0.5) { mx += cx * 1.6; mz += cz * 1.6; } }
    else { const [ax, az] = norm(p.x - best.x, p.z - best.z); mx += ax; mz += az; }
    aimAt(p, best, inp, m, L);
    inp.atk = ranged ? clearShot(p, best) : bd < 2.5;
    if (p.dashCd <= 0 && bd < 3 && Math.random() < 0.2) wantDash = true;
    engage = false;
  } else if (engage) {
    const dx = best.x - p.x, dz = best.z - p.z, d = Math.max(0.01, bd);
    const ux = dx / d, uz = dz / d;
    const want = RANGE[p.char];
    if (d > want + 0.8) {
      // flank: approach at an angle while far away
      const fa = d > 5 ? m.flank : 0;
      const c = Math.cos(fa), s = Math.sin(fa);
      mx += ux * c - uz * s; mz += ux * s + uz * c;
    } else if (d < want - 0.8) { mx -= ux; mz -= uz; }
    const sw = ranged ? 0.9 : (d < 4 ? 0.5 : 0.25);
    mx += -uz * m.strafe * sw; mz += ux * m.strafe * sw;
    // ranged bots that lack a shot slide sideways to find one
    if (shooter && !clearShot(p, best)) { mx += -uz * m.strafe; mz += ux * m.strafe; }

    aimAt(p, best, inp, m, L);
    if (shooter) inp.atk = d < { blaster: 13, ranger: 22, frost: 6.5 }[p.char] && clearShot(p, best);
    else if (p.char === 'bomber') {
      // lob at where the target will be
      const T = 0.3 + Math.min(BOMB_RANGE, d) * 0.035;
      inp.tx = best.x + (best.mvx + best.kbx) * T * L.lead; inp.tz = best.z + (best.mvz + best.kbz) * T * L.lead;
      inp.atk = d < BOMB_RANGE + 1;
    } else inp.atk = d < want + 1.3;

    // specials
    if (p.spCd <= 0 && Math.random() < L.spP) {
      const tdc = Math.hypot(best.x, best.z);
      const outward = tdc > 0.1 ? (ux * best.x + uz * best.z) / tdc : 0; // >0: we'd push them toward the edge
      if (p.char === 'blaster' && d < 4.2 && (outward > 0.2 || d < 2.5)) inp.spSeq++;
      else if (p.char === 'brawler' && d < 4.5) inp.spSeq++;
      else if (p.char === 'trickster' && d > 4.5 && d < 10) {
        let tx = best.x - ux * 1.3, tz = best.z - uz * 1.3;
        if (safeSpot(tx, tz, zr)) { inp.tx = tx; inp.tz = tz; inp.spSeq++; }
      } else if (p.char === 'bomber' && d < WELL_RANGE + 3) {
        // drop the well just beyond the target, toward the edge, to drag them off
        const [ox, oz] = tdc > 0.1 ? [best.x / tdc, best.z / tdc] : [ux, uz];
        inp.tx = best.x + ox * 3; inp.tz = best.z + oz * 3; inp.spSeq++;
      } else if (p.char === 'ranger' && d < 4.5 && safeSpot(p.x - ux * 5, p.z - uz * 5, zr)) inp.spSeq++; // flip away from melee
      else if (p.char === 'frost' && d < WELL_RANGE + 2) { inp.tx = best.x; inp.tz = best.z; inp.spSeq++; }
      else if (p.char === 'ram' && d > 2.5 && d < 8 && safeSpot(p.x + ux * 11, p.z + uz * 11, zr, 1)) inp.spSeq++;
      else if (p.char === 'hook' && d > 3.5 && d < 10 && clearShot(p, best)) inp.spSeq++;
    }
    if (p.dashCd <= 0 && d > 3.5 && d < 8 && !ranged && Math.random() < L.dashP * 3) wantDash = true;
  } else {
    inp.atk = false;
    if (best) aimAt(p, best, inp, m, L);
    // idle: drift, preferring cover if a ranged enemy is around
    m.wander += (Math.random() - 0.5) * 0.6;
    mx += Math.cos(m.wander) * 0.5; mz += Math.sin(m.wander) * 0.5;
    if (L.cover && best && bd < 16) {
      const cover = findCover(p, best, zr);
      if (cover && Math.hypot(cover.x - p.x, cover.z - p.z) > 1) { const [cx, cz] = norm(cover.x - p.x, cover.z - p.z); mx += cx * 0.7; mz += cz * 0.7; }
    }
  }

  // power-ups nearby
  for (const u of sim.pu) {
    const d = Math.hypot(u.x - p.x, u.z - p.z);
    if (d < L.puRange && (!best || d < bd || !engage)) { mx += (u.x - p.x) / d * 1.5; mz += (u.z - p.z) / d * 1.5; break; }
  }

  // extreme: back off from a visible wind-up (Brawler's slam, Blaster's blast, Ram's stampede) — the same tell a
  // sharp human reacts to on-screen, just read from state instead of an animation frame.
  if (L.extreme) {
    for (const q of sim.players.values()) {
      if (q === p || !q.alive || q.falling) continue;
      if (q.slamT <= 0 && q.blastT <= 0 && q.chargeT <= 0) continue;
      const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
      const danger = q.chargeT > 0 ? 8 : 5.5; // Ram's stampede reaches further than a slam or blast
      if (d < 0.01 || d >= danger) continue;
      mx += (dx / d) * 2.4; mz += (dz / d) * 2.4;
      if (p.dashCd <= 0 && d < 3) { wantDash = true; dashDir = [dx / d, dz / d]; }
    }
  }

  // dodge incoming bolts
  for (const b of sim.proj) {
    if (b.owner === p.id) continue;
    if (b.kind === 'bomb') {
      const d = Math.hypot(p.x - b.tx, p.z - b.tz);
      if (d < BOMB_R + 1.2) { const [ax, az] = norm(p.x - b.tx, p.z - b.tz); mx += ax * 2; mz += az * 2; }
      continue;
    }
    const rx = p.x - b.x, rz = p.z - b.z, d = Math.hypot(rx, rz);
    if (d > 4) continue;
    const vl = Math.hypot(b.vx, b.vz);
    if ((rx * b.vx + rz * b.vz) / (d * vl) > 0.9) {
      mx += -b.vz / vl * 1.5 * m.strafe; mz += b.vx / vl * 1.5 * m.strafe;
      if (p.dashCd <= 0 && Math.random() < L.dashP * 1.5) wantDash = true;
      break;
    }
  }
  // escape enemy gravity wells
  for (const w of sim.wells) {
    const d = Math.hypot(p.x - w.x, p.z - w.z);
    if (d < w.r + 0.5 && w.owner !== p.id) {
      const [ax, az] = norm(p.x - w.x, p.z - w.z);
      mx += ax * 2.5; mz += az * 2.5;
      if (p.dashCd <= 0 && Math.random() < 0.3) { wantDash = true; dashDir = [ax, az]; }
    }
  }

  // sweeper beam: dash through it (dash grants i-frames) just before it arrives
  if (MAP.sweeper) {
    const sw = MAP.sweeper, ang = sweeperAngle(sim.t);
    const r = Math.hypot(p.x, p.z);
    if (r > 1 && r < sw.len + 1) {
      let ahead = Math.atan2(p.z, p.x) - ang;
      while (ahead < 0) ahead += Math.PI * 2;
      while (ahead > Math.PI * 2) ahead -= Math.PI * 2;
      const tArrive = ahead / sw.speed;
      if (tArrive < 1.2) {
        // move away from the hub where the beam is slower to catch you, i.e. step outward/back
        const tx = -Math.sin(ang), tz = Math.cos(ang);
        if (tArrive < 0.3 && p.dashCd <= 0 && Math.random() < 0.6 + L.dashP * 3) { wantDash = true; dashDir = [-tx, -tz]; }
        else { mx += tx * 1.2; mz += tz * 1.2; }
      }
    }
  }

  // obstacle + pit avoidance
  for (const o of OBSTACLES) {
    const ox = p.x - o.x, oz = p.z - o.z, dd = Math.hypot(ox, oz), gap = dd - o.r;
    const margin = o.bumper ? 1.8 : 1.3;
    if (gap < margin && dd > 0.01) { mx += (ox / dd) * (margin - gap) * 1.5; mz += (oz / dd) * (margin - gap) * 1.5; }
  }
  for (const h of HOLES) {
    const ox = p.x - h.x, oz = p.z - h.z, dd = Math.hypot(ox, oz), gap = dd - h.r;
    if (gap < 2.5 && dd > 0.01) {
      const w = (2.5 - gap) * 2.2;
      mx += (ox / dd) * w; mz += (oz / dd) * w;
      if (gap < 0.8 && p.dashCd <= 0 && Math.hypot(p.kbx, p.kbz) > 3) { wantDash = true; dashDir = [ox / dd, oz / dd]; }
    }
  }

  // stay inside the zone and away from the edge
  const dc = Math.hypot(p.x, p.z);
  const safe = zr - 2.2;
  if (dc > safe && dc > 0.01) {
    const w = (dc - safe) * 1.4 + 1;
    mx -= (p.x / dc) * w; mz -= (p.z / dc) * w;
    if (dc > zr - 1 && p.dashCd <= 0 && (Math.hypot(p.kbx, p.kbz) > 3 || dc > ARENA_R - 2.5)) { wantDash = true; dashDir = [-p.x / dc, -p.z / dc]; }
  }
  if (wantDash) {
    if (dashDir) { mx = dashDir[0]; mz = dashDir[1]; }
    // never dash into a pit or off the edge
    const [nx, nz] = norm(mx, mz);
    if (safeSpot(p.x + nx * 2.8, p.z + nz * 2.8, zr, 0.6)) inp.dashSeq++;
  }
  inp.mx = mx; inp.mz = mz;
  return inp;
}

function aimAt(p, q, inp, m, L) {
  let ax = q.x, az = q.z;
  if (SHOT_SPEED[p.char]) { const t = Math.hypot(q.x - p.x, q.z - p.z) / SHOT_SPEED[p.char]; ax += (q.mvx + q.kbx) * t * L.lead; az += (q.mvz + q.kbz) * t * L.lead; }
  m.aimErr = Math.max(-L.aimErr, Math.min(L.aimErr, m.aimErr + (Math.random() - 0.5) * L.aimErr));
  inp.aim = Math.atan2(az - p.z, ax - p.x) + m.aimErr * 0.5;
  inp.tx = ax; inp.tz = az;
}

// A spot behind an obstacle, as seen from the enemy, that's inside the safe area.
function findCover(p, enemy, zr) {
  let best = null, bd = 1e9;
  for (const o of OBSTACLES) {
    if (o.bumper) continue;
    const [ex, ez] = norm(o.x - enemy.x, o.z - enemy.z);
    const x = o.x + ex * (o.r + PLAYER_R + 0.5), z = o.z + ez * (o.r + PLAYER_R + 0.5);
    if (!safeSpot(x, z, zr, 1.5)) continue;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < bd && d < 12) { bd = d; best = { x, z }; }
  }
  return best;
}

// Extreme only: the nearest bush that's actually far enough from the attacker to hide in (bushes only hide you
// from enemies more than 3.5 m away — ducking into one right next to the attacker achieves nothing).
function findBush(p, enemy, zr) {
  let best = null, bd = 1e9;
  for (const b of BUSHES) {
    if (Math.hypot(b.x - enemy.x, b.z - enemy.z) < 3.6) continue;
    if (!safeSpot(b.x, b.z, zr, 0.5)) continue;
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    if (d < bd && d < 12) { bd = d; best = { x: b.x, z: b.z }; }
  }
  return best;
}

function clearShot(p, q) {
  for (const o of OBSTACLES) {
    const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((o.x - p.x) * dx + (o.z - p.z) * dz) / l2));
    if (Math.hypot(p.x + dx * t - o.x, p.z + dz * t - o.z) < o.r + 0.25) return false;
  }
  return true;
}
