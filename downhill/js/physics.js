// Shared rider physics + bot AI. No Three.js here so it can be tested in Node.

export const CLASSES = {
  ski: {
    label: 'Skier', turn: 2.5, drag: 0.0046, dragTuck: 0.0029, groomedBonus: 0.86,
    powderFric: 2.6, carveLoss: 0.045, jumpV: 7.5, airMult: 1.0, airBonus: 0,
    spinRate: Math.PI * 2 / 1.05, flipRate: Math.PI * 2 / 1.2, landBoost: 2.5, trickBoost: 2.5, trickBoostT: 0.8,
  },
  board: {
    label: 'Snowboarder', turn: 1.65, drag: 0.0046, dragTuck: 0.0031, groomedBonus: 1.0,
    powderFric: 1.4, carveLoss: 0.035, jumpV: 8.5, airMult: 1.35, airBonus: 1.8,
    spinRate: Math.PI * 2 / 0.85, flipRate: Math.PI * 2 / 0.95, landBoost: 2.5, trickBoost: 6.5, trickBoostT: 1.6,
  },
};

const G = 14;          // slope acceleration scale
const GRAV = 19;       // vertical gravity
const FRIC = 0.45;
const BRAKE = 13;
const VMAX = 58;
const TWO_PI = Math.PI * 2;

export function newEntity(id, cls, x, z, course) {
  return {
    id, cls, x, z, y: course.groundH(x, z), h: 0, v: 0, vy: 0, air: false, airT: 0,
    spin: 0, flip: 0, state: 'ride', wipeT: 0, ghostT: 0, jumpCD: 0, boostT: 0,
    pushX: 0, pushZ: 0, finished: false, finishTime: 0, tuck: false, lean: 0, msg: null, msgId: 0,
  };
}

const wrapPi = (a) => { a = (a + Math.PI) % TWO_PI; if (a < 0) a += TWO_PI; return a - Math.PI; };

function say(e, text, good) { e.msg = { text, good }; e.msgId++; }

export function wipeout(e, why) {
  if (e.state === 'wipe' || e.ghostT > 0) return;
  e.state = 'wipe'; e.wipeT = 1.3; e.air = false; e.boostT = 0;
  say(e, why || 'WIPEOUT!', false);
}

function respawn(e, course) {
  const z = Math.max(5, e.z - 8);
  const cx = course.nearestCenter(e.x, z);
  e.x = cx; e.z = z; e.y = course.groundH(cx, z); e.vy = 0;
  e.h = 0; e.v = 10; e.spin = 0; e.flip = 0; e.state = 'ride'; e.ghostT = 1.6;
  e.pushX = e.pushZ = 0;
}

function land(e, P) {
  const s = Math.abs(wrapPi(e.spin)), f = Math.abs(wrapPi(e.flip));
  const rots = Math.round(Math.abs(e.spin) / TWO_PI) + Math.round(Math.abs(e.flip) / TWO_PI);
  if (s > 0.75 || f > 0.75) { e.spin = 0; e.flip = 0; wipeout(e, 'BAD LANDING!'); return; }
  if (rots > 0) {
    const spins = Math.round(Math.abs(e.spin) / TWO_PI), flips = Math.round(Math.abs(e.flip) / TWO_PI);
    const parts = [];
    if (spins) parts.push(spins * 360);
    if (flips) parts.push(flips > 1 ? `${flips}x FLIP` : (e.flip > 0 ? 'FRONTFLIP' : 'BACKFLIP'));
    const boost = P.landBoost + rots * P.trickBoost;
    e.v = Math.min(VMAX, e.v + boost); e.boostT = Math.max(e.boostT, P.trickBoostT * rots);
    say(e, `${parts.join(' + ')}  CLEAN! +${Math.round(boost * 3.6)} km/h`, true);
  } else if (e.airT > 0.7) {
    e.v = Math.min(VMAX, e.v + P.landBoost);
    say(e, 'CLEAN LANDING +BOOST', true);
  }
  e.spin = 0; e.flip = 0;
}

// inp: {steer:-1..1 (+ = right), tuck, brake, jump, spin:-1..1, flip:-1..1}
export function stepEntity(e, inp, dt, course) {
  const P = CLASSES[e.cls];
  if (e.ghostT > 0) e.ghostT -= dt;
  if (e.jumpCD > 0) e.jumpCD -= dt;
  if (e.boostT > 0) e.boostT -= dt;

  if (e.state === 'wipe') {
    e.wipeT -= dt;
    e.v *= Math.exp(-2.5 * dt);
    e.x += Math.sin(e.h) * e.v * dt; e.z += Math.cos(e.h) * e.v * dt;
    e.y = course.groundH(e.x, e.z);
    e.flip += dt * 9; e.spin += dt * 4;
    if (e.wipeT <= 0) respawn(e, course);
    return;
  }

  if (e.finished) inp = { steer: 0, tuck: false, brake: true, jump: false, spin: 0, flip: 0 };
  const info = course.corridor(e.x, e.z);
  const powder = !info.groomed;
  e.tuck = !!inp.tuck && !inp.brake;

  let drag = e.tuck ? P.dragTuck : P.drag;
  if (info.groomed) drag *= P.groomedBonus; else drag *= 1.15;
  if (e.boostT > 0) drag *= 0.55;

  if (!e.air) {
    const rate = P.turn * (1 - Math.min(e.v, 55) / 150) * (e.tuck ? 0.8 : 1);
    e.h -= inp.steer * rate * dt;
    e.lean += (inp.steer - e.lean) * Math.min(1, dt * 8);
    const eps = 0.5;
    const gx = (course.groundH(e.x + eps, e.z) - course.groundH(e.x - eps, e.z)) / (2 * eps);
    const gz = (course.groundH(e.x, e.z + eps) - course.groundH(e.x, e.z - eps)) / (2 * eps);
    // side-slopes (half-pipe walls, run edges) pull you back toward the fall line
    const gLat = gx * Math.cos(e.h) - gz * Math.sin(e.h);
    if (Math.abs(gLat) > 0.08) e.h -= gLat * 1.6 * dt;
    e.h = Math.max(-1.75, Math.min(1.75, e.h));
    const sx = Math.sin(e.h), sz = Math.cos(e.h);
    let a = -G * (gx * sx + gz * sz);
    if (!inp.brake && e.v < 5) a += 7 * (1 - e.v / 5); // skate / push off when nearly stopped
    a -= drag * e.v * e.v + FRIC + (powder ? P.powderFric * (info.shortcut ? 0.4 : 1) : 0) + (inp.brake ? BRAKE : 0)
      + Math.abs(inp.steer) * e.v * P.carveLoss;
    e.v = Math.max(0, Math.min(VMAX, e.v + a * dt));
    // boost pads
    for (const p of course.pads) {
      if (Math.abs(p.z - e.z) < 3.2 && Math.abs(p.x - e.x) < 2.3) {
        if (e.boostT < 0.9) { e.v = Math.min(VMAX, e.v + 9); say(e, 'BOOST!', true); }
        e.boostT = 1.4;
      }
    }
    if (inp.jump && e.jumpCD <= 0 && !e.finished) {
      e.vy = Math.max(e.vy, 0) + P.jumpV; e.air = true; e.airT = 0; e.spin = 0; e.flip = 0;
      e.jumpCD = 0.9; e.y += 0.05;
    }
  } else {
    e.lean *= Math.exp(-4 * dt);
    e.v = Math.max(0, e.v - drag * 0.8 * e.v * e.v * dt);
    e.spin += (inp.spin || 0) * P.spinRate * dt;
    e.flip += (inp.flip || 0) * P.flipRate * dt;
    e.airT += dt;
  }

  // horizontal motion + bump push
  e.pushX *= Math.exp(-4 * dt); e.pushZ *= Math.exp(-4 * dt);
  const px = e.x, pz = e.z;
  e.x += (Math.sin(e.h) * e.v + e.pushX) * dt;
  e.z += (Math.cos(e.h) * e.v + e.pushZ) * dt;

  // vertical motion
  const hg = course.groundH(e.x, e.z);
  const prevY = e.y;
  e.vy -= GRAV * dt;
  const ny = e.y + e.vy * dt;
  if (ny <= hg) {
    const wasAir = e.air, airT = e.airT;
    e.y = hg;
    e.vy = Math.max(-45, Math.min(25, (hg - prevY) / dt));
    e.air = false; e.airT = 0;
    if (wasAir && airT > 0.3) land(e, P);
    else if (wasAir) { e.spin = 0; e.flip = 0; }
  } else {
    e.y = ny;
    if (!e.air && ny - hg > 0.3) {
      e.air = true; e.airT = 0; e.spin = 0; e.flip = 0;
      if (e.vy > 1) e.vy = e.vy * P.airMult + P.airBonus; // off a kicker
    }
  }

  // obstacles
  if (e.ghostT <= 0) {
    for (const o of course.obstaclesNear(e.z)) {
      const dx = e.x - o.x, dz = e.z - o.z;
      const rr = o.r + 0.45;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (e.y - course.groundH(o.x, o.z) > o.h) continue; // cleared it in the air
      if (e.v > 17) { wipeout(e, o.type === 'tree' ? 'TREE!' : 'ROCK!'); return; }
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      e.x = o.x + dx / d * rr; e.z = o.z + dz / d * rr;
      e.v *= 0.4;
      e.pushX += dx / d * 4; e.pushZ += dz / d * 4;
    }
  }
  if (!e.finished && e.z >= course.L) e.finished = true; // caller stamps finishTime
  void px; void pz;
}

// Push two riders apart and trade some momentum. Applies only to `a` (each side resolves itself).
export function bump(a, b) {
  if (a.state === 'wipe' || b.state === 'wipe' || a.ghostT > 0 || b.ghostT > 0) return false;
  const dx = a.x - b.x, dz = a.z - b.z, dy = a.y - b.y;
  const d2 = dx * dx + dz * dz;
  if (d2 > 1.3 * 1.3 || d2 < 1e-6 || Math.abs(dy) > 1.6) return false;
  const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
  const avx = Math.sin(a.h) * a.v, avz = Math.cos(a.h) * a.v;
  const bvx = Math.sin(b.h) * b.v, bvz = Math.cos(b.h) * b.v;
  const rel = (bvx - avx) * nx + (bvz - avz) * nz; // closing speed along normal
  const imp = Math.max(3, rel * 0.9 + 3);
  a.pushX += nx * imp; a.pushZ += nz * imp;
  a.x += nx * (1.3 - d) * 0.5; a.z += nz * (1.3 - d) * 0.5;
  a.v *= 0.97;
  return true;
}

// Host-side validation of inputs received from clients.
export function sanitizeInput(a) {
  const c = (v) => { v = Number(v); return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; };
  if (!Array.isArray(a)) return null;
  return { steer: c(a[1]), tuck: !!(a[2] & 1), brake: !!(a[2] & 2), jump: !!(a[2] & 4), spin: Math.round(c(a[3])), flip: Math.round(c(a[4])) };
}
export function packInput(seq, inp) {
  return [seq, Math.round(inp.steer * 100) / 100, (inp.tuck ? 1 : 0) | (inp.brake ? 2 : 0) | (inp.jump ? 4 : 0), inp.spin, inp.flip];
}

// ---- Bots ----
export function newBrain(rnd, cls) {
  return {
    shortcut: [rnd() < 0.55, rnd() < 0.55], lane: (rnd() - 0.5) * 12, laneT: 2 + rnd() * 3,
    skill: 0.9 + rnd() * 0.12, trickProb: cls === 'board' ? 0.75 : 0.4,
    trick: null, wasAir: false, rnd, avoid: 0, avoidT: 0,
  };
}

export function botInput(e, br, course, dt) {
  const inp = { steer: 0, tuck: true, brake: false, jump: false, spin: 0, flip: 0 };
  if (e.state === 'wipe' || e.finished) return inp;
  br.laneT -= dt;
  if (br.laneT <= 0) { br.lane = (br.rnd() - 0.5) * 14; br.laneT = 2 + br.rnd() * 4; }

  if (e.air) {
    if (!br.wasAir) {
      br.wasAir = true;
      br.trick = null;
      if (e.vy > 3 && br.rnd() < br.trickProb) {
        const P = CLASSES[e.cls];
        // estimate airtime and pick a trick that fits
        const t = (e.vy / 19) * 2 + 0.25;
        const spins = Math.floor((t - 0.2) / (TWO_PI / P.spinRate));
        if (spins >= 1) br.trick = { kind: br.rnd() < 0.3 ? 'flip' : 'spin', dir: br.rnd() < 0.5 ? -1 : 1, target: 1 };
      }
    }
    if (br.trick) {
      const cur = br.trick.kind === 'spin' ? e.spin : e.flip;
      if (Math.abs(cur) < TWO_PI * br.trick.target - 0.08) inp[br.trick.kind] = br.trick.dir;
    }
    return inp;
  }
  br.wasAir = false;

  const look = 14 + e.v * 0.55;
  const tz = e.z + look;
  const sc = course.scAt(tz), scI = course.shortcuts.indexOf(sc);
  const useSc = sc && br.shortcut[scI] && course.scActive(e.z + 2) ||
    (course.scActive(e.z) && Math.abs(e.x - course.cxBase(e.z)) < Math.abs(e.x - course.cxMain(e.z)) && course.scActive(tz));
  let tx = useSc ? course.cxBase(tz) : course.cxMain(tz) + br.lane * Math.max(0, 1 - Math.abs(course.cxMain(tz + 20) - course.cxMain(tz)) / 12);

  // obstacle avoidance: look along heading
  br.avoidT -= dt;
  if (br.avoidT <= 0) {
    br.avoid = 0;
    const sx = Math.sin(e.h), sz = Math.cos(e.h);
    for (let s = 6; s < 34; s += 4) {
      const qx = e.x + sx * s, qz = e.z + sz * s;
      for (const o of course.obstaclesNear(qz)) {
        if (o.h < 2 && e.air) continue;
        const lat = (o.x - qx);
        if (Math.abs(o.z - qz) < 2.5 && Math.abs(lat) < o.r + 1.6) { br.avoid = lat > 0 ? -4.5 : 4.5; br.avoidT = 0.5; break; }
      }
      if (br.avoid) break;
    }
  }
  tx += br.avoid;
  const desired = Math.atan2(tx - e.x, look);
  const err = e.h - desired;
  inp.steer = Math.max(-1, Math.min(1, err * 3));
  inp.tuck = Math.abs(err) < 0.25 && e.v < 50 * br.skill;
  if (e.v > 44 * br.skill + (e.boostT > 0 ? 10 : 0)) inp.tuck = false;
  if (Math.abs(err) > 0.7 && e.v > 25) inp.brake = true;
  return inp;
}
