// Simple AI bots. Produce the same input objects humans send.
import { ARENA_R, OBSTACLES } from './sim.js';

const RANGE = { blaster: 8, brawler: 1.7, trickster: 1.5 };
export const BOT_NAMES = ['Bolt', 'Nova', 'Rex', 'Pixel', 'Juno', 'Tank', 'Zip', 'Echo', 'Fang', 'Mochi', 'Ziggy', 'Blip'];

export function botInput(sim, p, dt) {
  const m = p.bot || (p.bot = {
    think: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0, aimErr: 0, wander: Math.random() * 6.28,
    inp: { mx: 0, mz: 0, aim: 0, tx: 0, tz: 0, atk: false, dashSeq: 0, spSeq: 0, seq: 0 },
  });
  const inp = m.inp;
  m.think -= dt; m.strafeT -= dt;
  if (m.strafeT <= 0) { m.strafe *= -1; m.strafeT = 0.7 + Math.random() * 1.6; }
  if (m.think > 0) return inp;
  m.think = 0.08 + Math.random() * 0.1;

  if (!p.alive || p.falling || sim.phase !== 'play') { inp.mx = inp.mz = 0; inp.atk = false; return inp; }

  const zr = Math.min(sim.zoneR, ARENA_R);
  let best = null, bd = 1e9;
  for (const q of sim.players.values()) {
    if (q === p || !q.alive || q.falling) continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z) - (1 - q.hp / q.maxHp) * 3;
    if (d < bd) { bd = d; best = q; }
  }
  let mx = 0, mz = 0;
  let wantDash = false;
  // bots don't hunt across the whole map, and back off to recover when hurt
  m.calm = (m.calm ?? Math.random() * 3) - 0.13;
  if (m.calm < -4) m.calm = 2 + Math.random() * 4;
  const hurt = p.hp / p.maxHp < 0.35 && bd < 7 && Math.random() < 0.9;
  if (best && !hurt && (bd > 13 || m.calm > 0) && bd > 4) best = null; // idle: wander / take cover
  if (hurt && best) {
    const dx = best.x - p.x, dz = best.z - p.z, d = Math.max(0.01, Math.hypot(dx, dz));
    mx -= dx / d; mz -= dz / d;
    mx += -dz / d * m.strafe * 0.6; mz += dx / d * m.strafe * 0.6;
    inp.aim = Math.atan2(dz, dx);
    inp.atk = p.char === 'blaster' || d < 2.5;
    if (p.spCd <= 0 && p.char === 'blaster' && d < 4) inp.spSeq++;
    if (p.dashCd <= 0 && d < 3 && Math.random() < 0.15) wantDash = true;
    best = null; m.fleeing = true;
  } else m.fleeing = false;
  if (best) {
    const dx = best.x - p.x, dz = best.z - p.z, d = Math.max(0.01, Math.hypot(dx, dz));
    const ux = dx / d, uz = dz / d;
    const want = RANGE[p.char];
    if (d > want + 0.8) { mx += ux; mz += uz; } else if (d < want - 0.8) { mx -= ux; mz -= uz; }
    const sw = p.char === 'blaster' ? 0.9 : (d < 4 ? 0.5 : 0.25);
    mx += -uz * m.strafe * sw; mz += ux * m.strafe * sw;

    let ax = best.x, az = best.z;
    if (p.char === 'blaster') { const t = d / 24; ax += (best.mvx + best.kbx) * t * 0.7; az += (best.mvz + best.kbz) * t * 0.7; }
    m.aimErr = Math.max(-0.3, Math.min(0.3, m.aimErr + (Math.random() - 0.5) * 0.25));
    inp.aim = Math.atan2(az - p.z, ax - p.x) + m.aimErr * 0.5;
    inp.atk = p.char === 'blaster' ? d < 15 && clearShot(p, best) : d < want + 1.3;

    if (p.spCd <= 0 && Math.random() < 0.5) {
      if (p.char === 'blaster' && d < 4) inp.spSeq++;
      else if (p.char === 'brawler' && d < 4.5) inp.spSeq++;
      else if (p.char === 'trickster' && d > 4.5 && d < 10) {
        // teleport next to target, but stay inside the safe area
        let tx = best.x - ux * 1.3, tz = best.z - uz * 1.3;
        const tc = Math.hypot(tx, tz), lim = zr - 1.5;
        if (tc > lim) { tx *= lim / tc; tz *= lim / tc; }
        inp.tx = tx; inp.tz = tz; inp.spSeq++;
      }
    }
    if (p.dashCd <= 0 && d > 5 && d < 9 && p.char !== 'blaster' && Math.random() < 0.06) wantDash = true;
  } else if (!m.fleeing) {
    inp.atk = false;
    m.wander += (Math.random() - 0.5) * 0.5;
    mx += Math.cos(m.wander) * 0.5; mz += Math.sin(m.wander) * 0.5;
  }

  // power-ups nearby
  for (const u of sim.pu) {
    const d = Math.hypot(u.x - p.x, u.z - p.z);
    if (d < 7 && (!best || d < bd)) { mx += (u.x - p.x) / d * 1.5; mz += (u.z - p.z) / d * 1.5; break; }
  }

  // dodge incoming bolts
  for (const b of sim.proj) {
    if (b.owner === p.id) continue;
    const rx = p.x - b.x, rz = p.z - b.z, d = Math.hypot(rx, rz);
    if (d > 4) continue;
    const vl = Math.hypot(b.vx, b.vz);
    if ((rx * b.vx + rz * b.vz) / (d * vl) > 0.9) {
      mx += -b.vz / vl * 1.5 * m.strafe; mz += b.vx / vl * 1.5 * m.strafe;
      if (p.dashCd <= 0 && Math.random() < 0.08) wantDash = true;
      break;
    }
  }

  // obstacle avoidance
  for (const o of OBSTACLES) {
    const ox = p.x - o.x, oz = p.z - o.z, dd = Math.hypot(ox, oz), gap = dd - o.r;
    if (gap < 1.3 && dd > 0.01) { mx += (ox / dd) * (1.3 - gap) * 1.5; mz += (oz / dd) * (1.3 - gap) * 1.5; }
  }

  // stay inside zone and away from the edge (overrides most else)
  const dc = Math.hypot(p.x, p.z);
  const safe = zr - 2.2;
  if (dc > safe && dc > 0.01) {
    const w = (dc - safe) * 1.4 + 1;
    mx -= (p.x / dc) * w; mz -= (p.z / dc) * w;
    if (dc > zr - 1 && p.dashCd <= 0 && (Math.hypot(p.kbx, p.kbz) > 3 || dc > ARENA_R - 2.5)) { mx = -p.x; mz = -p.z; wantDash = true; }
  }
  if (wantDash) inp.dashSeq++;
  inp.mx = mx; inp.mz = mz;
  return inp;
}

function clearShot(p, q) {
  for (const o of OBSTACLES) {
    const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((o.x - p.x) * dx + (o.z - p.z) * dz) / l2));
    if (Math.hypot(p.x + dx * t - o.x, p.z + dz * t - o.z) < o.r + 0.25) return false;
  }
  return true;
}
