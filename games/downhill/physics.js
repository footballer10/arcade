// Shared rider physics + bot AI. No Three.js here so it can be tested in Node.

export const CLASSES = {
  ski: {
    label: 'Skier', turn: 2.5, drag: 0.0046, dragTuck: 0.0029, groomedBonus: 0.86,
    powderFric: 2.6, carveLoss: 0.045, jumpV: 5.0, airMult: 1.05, airBonus: 0.8,
    spinRate: 6.981, flipRate: 5.712, landBoost: 2, trickBoost: 1.3,   // spin/flip in rad/s: a full spin in 0.9 s, a flip in 1.1 s
    grabs: ['Safety', 'Japan', 'Mute', 'Tail', 'Truck Driver', 'Critical'],
  },
  board: {
    label: 'Snowboarder', turn: 1.65, drag: 0.0046, dragTuck: 0.0031, groomedBonus: 1.0,
    powderFric: 1.4, carveLoss: 0.035, jumpV: 5.5, airMult: 1.2, airBonus: 2.8,
    spinRate: 8.727, flipRate: 6.614, landBoost: 2, trickBoost: 2.3,   // spin 0.72 s, flip 0.95 s
    grabs: ['Indy', 'Method', 'Melon', 'Tail', 'Nose', 'Stalefish'],
  },
};

// Ride feel (tunable: see tuning.js).
export const PHYS = {
  G: 14,             // slope acceleration scale
  GRAV: 19,          // vertical gravity
  FRIC: 0.45,
  BRAKE: 13,
  VMAX: 58,
  SPIN_LIM: 1.25,    // max sideways angle you can still ride away from (~72°)
  FLIP_LIM: 0.95,    // max over/under-rotation on a flip (~55°)
  GRAB_MIN: 0.3,     // seconds a grab must be held to count
  MIN_TRICK_AIR: 0.75, // a flat-ground ollie can't reach this, a kicker can
};
const TWO_PI = Math.PI * 2;
export const GRAB_KEYS = ['R', 'F', 'T', 'G', 'C', 'V'];
export const ITEMS = [null, { name: 'Rocket', icon: '🚀' }, { name: 'Snowball', icon: '❄️' }, { name: 'Shield', icon: '🛡️' }];
const hash01 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function newEntity(id, cls, x, z, course) {
  return {
    id, cls, x, z, y: course.groundH(x, z), h: 0, v: 0, vy: 0, air: false, airT: 0,
    spin: 0, flip: 0, state: 'ride', wipeT: 0, ghostT: 0, jumpCD: 0, boostT: 0,
    pushX: 0, pushZ: 0, finished: false, finishTime: 0, tuck: false, lean: 0, msg: null, msgId: 0,
    stance: 0, grab: 0, gt: [0, 0, 0, 0, 0, 0], airSwitch: false, grind: -1, grindT: 0, slideAng: 0, gpts: 0, gname: 0,
    // style + party
    score: 0, bestPts: 0, bestName: '', lastTrick: '', tricks: 0, butterT: 0, butterCD: 0,
    item: 0, itemCD: 0, shieldT: 0, hitT: 0, fireId: 0, pickups: 0, rankFrac: 0.5, handicap: 1,
    idh: [...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7),
  };
}

const wrapPi = (a) => { a = (a + Math.PI) % TWO_PI; if (a < 0) a += TWO_PI; return a - Math.PI; };

function say(e, text, good) { e.msg = { text, good }; e.msgId++; }

export function wipeout(e, why, landing = false) {
  if (e.state === 'wipe' || e.ghostT > 0) return;
  if (!landing && e.shieldT > 0) { e.shieldT = 0; e.v *= 0.75; e.ghostT = 0.6; say(e, 'SHIELD SAVED YOU!', true); return; }
  e.state = 'wipe'; e.wipeT = 1.3; e.air = false; e.boostT = 0;
  say(e, why || 'WIPEOUT!', false);
}

function respawn(e, course) {
  const z = Math.max(5, e.z - 8);
  const cx = course.nearestCenter(e.x, z);
  e.x = cx; e.z = z; e.y = course.groundH(cx, z); e.vy = 0;
  e.h = 0; e.v = 10; e.spin = 0; e.flip = 0; e.state = 'ride'; e.ghostT = 1.6; e.stance = 0; e.grab = 0; e.hitT = 0;
  e.pushX = e.pushZ = 0;
}

export const GRIND_NAMES = ['', '50-50', 'Boardslide', 'Lipslide'];
// Name of the trick currently being done / just landed
export function trickName(e, half, flips) {
  const P = CLASSES[e.cls];
  if (half === undefined) half = Math.round(e.spin / Math.PI);
  if (flips === undefined) flips = Math.round(e.flip / TWO_PI);
  const parts = [];
  if (e.gname) parts.push(GRIND_NAMES[e.gname] + ' to');
  if (e.airSwitch && (half || flips)) parts.push('Switch');
  const mult = ['', '', 'Double ', 'Triple '][Math.min(3, Math.abs(flips))];
  if (flips && half) parts.push(`${mult}${flips > 0 ? 'Misty' : 'Rodeo'} ${Math.abs(half) * 180}`);   // off-axis: flip + spin
  else if (flips) parts.push(mult + (flips > 0 ? 'Frontflip' : 'Backflip'));
  else if (half) parts.push(String(Math.abs(half) * 180));
  const grabs = [];
  P.grabs.forEach((g, i) => { if (e.gt[i] >= PHYS.GRAB_MIN) grabs.push((e.gt[i] >= 0.8 ? 'Tweaked ' : '') + g); });
  if (grabs.length) parts.push(grabs.join(' + '));
  return parts.join(' ');
}

// speed-boost score (small numbers) and style points (big numbers) for the current air
function trickScore(e, half, flips) {
  let s = Math.abs(half) + Math.abs(flips) * 3;
  for (const t of e.gt) if (t >= PHYS.GRAB_MIN) s += 1 + Math.min(1, t);
  if (e.airSwitch && (half || flips)) s += 0.5;
  return s + e.gpts;
}
function stylePoints(e, half, flips, airT) {
  let pts = Math.abs(half) * 100 + Math.abs(flips) * 450, kinds = (half ? 1 : 0) + (flips ? 1 : 0);
  for (const t of e.gt) if (t >= PHYS.GRAB_MIN) { pts += 150 + Math.min(1.5, t) * 200; kinds++; }
  if (e.gpts > 0) { pts += e.gpts * 160; kinds++; }
  if (e.airSwitch && (half || flips)) pts += 100;
  if (pts > 0) pts += Math.min(3, airT) * 60;
  return pts * (1 + 0.3 * Math.max(0, kinds - 1));
}

// What would happen if you touched down right now (used by the HUD landing meter)
export function landingPreview(e) {
  const half = Math.round(e.spin / Math.PI), rs = e.spin - half * Math.PI;
  const flips = Math.round(e.flip / TWO_PI), rf = e.flip - flips * TWO_PI;
  let q = 1 - Math.max(Math.abs(rs) / PHYS.SPIN_LIM, Math.abs(rf) / PHYS.FLIP_LIM);
  if (e.grab > 0) q -= 0.4;
  return { q, half, flips, rs, rf, label: q < 0 ? 'CRASH' : q > 0.85 ? 'PERFECT' : q > 0.5 ? 'CLEAN' : 'SKETCHY', sw: (Math.round(e.stance / Math.PI) + half) % 2 !== 0 };
}

function land(e, P, airT) {
  const half = Math.round(e.spin / Math.PI), rs = e.spin - half * Math.PI;   // any multiple of 180 is rideable (switch)
  const flips = Math.round(e.flip / TWO_PI), rf = e.flip - flips * TWO_PI;
  let q = 1 - Math.max(Math.abs(rs) / PHYS.SPIN_LIM, Math.abs(rf) / PHYS.FLIP_LIM);  // landing quality 0..1
  const holding = e.grab > 0;
  if (holding) q -= 0.4;
  let name = trickName(e, half, flips);
  if (e.gname && name.endsWith(' to')) name = name.slice(0, -3);
  const real = airT >= PHYS.MIN_TRICK_AIR || e.gpts > 0;
  const score = real ? trickScore(e, half, flips) : 0;
  let pts = real ? stylePoints(e, half, flips, airT) : 0;
  e.spin = 0; e.flip = 0; e.grab = 0; e.gt = [0, 0, 0, 0, 0, 0]; e.gpts = 0; e.gname = 0;
  if (q < 0) { e.stance = 0; wipeout(e, holding && Math.abs(rs) < PHYS.SPIN_LIM ? 'STILL GRABBING!' : Math.abs(rf) > PHYS.FLIP_LIM ? 'OVER-ROTATED!' : 'BAD LANDING!', true); return; }
  // ride away in the direction you landed (sketchy landings keep their angle)
  e.stance = ((Math.round((e.stance + half * Math.PI) / Math.PI) % 2) + 2) % 2 ? Math.PI : 0;
  e.h = Math.max(-1.75, Math.min(1.75, e.h + rs * 0.9));
  e.v *= 1 - 0.18 * (1 - q);
  const label = q > 0.85 ? 'PERFECT' : q > 0.5 ? 'CLEAN' : 'SKETCHY';
  if (score > 0) {
    const repeat = name && name === e.lastTrick;
    pts = Math.round(pts * (q > 0.85 ? 1.2 : q > 0.5 ? 1 : 0.5) * (repeat ? 0.5 : 1) / 10) * 10;
    e.lastTrick = name; e.score += pts; e.tricks++;
    if (pts > e.bestPts) { e.bestPts = pts; e.bestName = name; }
    const boost = Math.min(15, P.landBoost + score * P.trickBoost) * (0.25 + 0.75 * q * q);
    e.v = Math.min(PHYS.VMAX, e.v + boost); e.boostT = Math.max(e.boostT, 0.4 + 0.15 * score * q);
    say(e, `${name || 'Air'} · ${label}${repeat ? ' (repeat)' : ''}  +${pts} pts  +${Math.round(boost * 3.6)} km/h`, q > 0.5);
  } else if (airT >= 1.0 && q > 0.5) {
    const boost = P.landBoost * q;
    e.v = Math.min(PHYS.VMAX, e.v + boost); e.score += 50;
    say(e, `Big air · ${label}  +50 pts  +${Math.round(boost * 3.6)} km/h`, true);
  } else if (half || flips) {
    say(e, `${name} · ${label}`, q > 0.5);
  }
}

// inp: {steer:-1..1 (+ = right), tuck, brake, jump, spin:-1..1, flip:-1..1}
export function stepEntity(e, inp, dt, course) {
  const P = CLASSES[e.cls];
  if (e.ghostT > 0) e.ghostT -= dt;
  if (e.jumpCD > 0) e.jumpCD -= dt;
  if (e.boostT > 0) e.boostT -= dt;
  if (e.itemCD > 0) e.itemCD -= dt;
  if (e.shieldT > 0) e.shieldT -= dt;
  if (e.hitT > 0) e.hitT -= dt;
  if (e.butterT > 0) e.butterT -= dt;
  if (e.butterCD > 0) e.butterCD -= dt;

  if (e.state === 'wipe') {
    e.wipeT -= dt;
    e.v *= Math.exp(-2.5 * dt);
    e.x += Math.sin(e.h) * e.v * dt; e.z += Math.cos(e.h) * e.v * dt;
    e.y = course.groundH(e.x, e.z);
    e.flip += dt * 9; e.spin += dt * 4;
    if (e.wipeT <= 0) respawn(e, course);
    return;
  }

  if (e.finished) inp = { steer: 0, tuck: false, brake: true, jump: false, spin: 0, flip: 0, grab: 0 };
  inp = { steer: 0, spin: 0, flip: 0, grab: 0, ...inp };
  // items: pick up from boxes, use with the item key
  if (!e.finished) {
    if (!e.item && e.itemCD <= 0) for (const b of course.itemsNear(e.z)) {
      if (Math.abs(b.z - e.z) < 2.4 && Math.abs(b.x - e.x) < 2.2 && e.y - b.y < 4) {
        const r = hash01(b.i * 31 + e.pickups * 17 + e.idh), wB = 0.25 + 0.5 * e.rankFrac, wS = 0.45, wSh = 0.3 - 0.2 * e.rankFrac;
        e.item = r * (wB + wS + wSh) < wB ? 1 : r * (wB + wS + wSh) < wB + wS ? 2 : 3;
        e.pickups++; e.itemCD = 0.4; say(e, `GOT ${ITEMS[e.item].name.toUpperCase()}!`, true);
        break;
      }
    }
    if (inp.use && e.item && e.itemCD <= 0) {
      if (e.item === 1) { e.v = Math.min(PHYS.VMAX, e.v + 11); e.boostT = 1.8; say(e, 'ROCKET!', true); }
      else if (e.item === 2) e.fireId++;
      else { e.shieldT = 7; say(e, 'SHIELD UP', true); }
      e.item = 0; e.itemCD = 1;
    }
  }
  if (e.grind >= 0) { grindStep(e, inp, dt, course, P); return; }
  const info = course.corridor(e.x, e.z);
  const powder = !info.groomed;
  e.tuck = !!inp.tuck && !inp.brake;

  let drag = e.tuck ? P.dragTuck : P.drag;
  if (info.groomed) drag *= P.groomedBonus; else drag *= 1.15;
  if (e.boostT > 0) drag *= 0.55;
  drag *= e.handicap;
  if (e.hitT > 0) drag *= 3;

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
    let a = -PHYS.G * (gx * sx + gz * sz);
    if (!inp.brake && e.v < 5) a += 7 * (1 - e.v / 5); // skate / push off when nearly stopped
    a -= drag * e.v * e.v + PHYS.FRIC + (powder ? P.powderFric * (info.shortcut ? 0.4 : info.soft && !info.shortcut && info.d <= 0 ? 0.45 : 1) : 0) + (inp.brake ? PHYS.BRAKE : 0)
      + Math.abs(inp.steer) * e.v * P.carveLoss;
    e.v = Math.max(0, Math.min(PHYS.VMAX, e.v + a * dt));
    // boost pads
    for (const p of course.pads) {
      if (Math.abs(p.z - e.z) < 3.2 && Math.abs(p.x - e.x) < 2.3) {
        if (e.boostT < 0.9) { e.v = Math.min(PHYS.VMAX, e.v + 9); say(e, 'BOOST!', true); }
        e.boostT = 1.4;
      }
    }
    // butter: a 180 on the snow (changes stance, small style points, no boost)
    if (inp.butter && e.butterCD <= 0 && e.v > 8 && !e.finished) {
      e.stance = e.stance ? 0 : Math.PI; e.butterT = 0.35; e.butterCD = 0.9; e.v *= 0.985;
      const rep = e.lastTrick === 'Butter 180'; e.lastTrick = 'Butter 180';
      const pts = rep ? 20 : 60; e.score += pts; say(e, `Butter 180  +${pts} pts`, true);
    }
    if (inp.jump && e.jumpCD <= 0 && !e.finished) {
      // pop relative to the slope you're riding (an ollie on flat ground is a small hop; on a kicker lip it adds height)
      e.vy = e.vy + P.jumpV; e.air = true; e.airT = 0; e.spin = 0; e.flip = 0; e.grab = 0; e.gt = [0, 0, 0, 0, 0, 0];
      e.airSwitch = e.stance !== 0; e.jumpCD = 0.6; e.y += 0.05;
    }
  } else {
    e.lean *= Math.exp(-4 * dt);
    e.v = Math.max(0, e.v - drag * 0.8 * e.v * e.v * dt);
    e.spin += (inp.spin || 0) * P.spinRate * dt;
    e.flip += (inp.flip || 0) * P.flipRate * dt;
    // landing assist: with the keys released you drift toward the nearest rideable angle
    if (!inp.spin) { const tgt = Math.round(e.spin / Math.PI) * Math.PI, d = tgt - e.spin; e.spin += Math.sign(d) * Math.min(Math.abs(d), 1.6 * dt); }
    if (!inp.flip) { const tgt = Math.round(e.flip / TWO_PI) * TWO_PI, d = tgt - e.flip; if (Math.abs(d) < 1.3) e.flip += Math.sign(d) * Math.min(Math.abs(d), 1.6 * dt); }
    e.grab = inp.grab || 0;
    if (e.grab) e.gt[e.grab - 1] += dt;
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
  e.vy -= PHYS.GRAV * dt;
  const ny = e.y + e.vy * dt;
  if (ny <= hg) {
    const wasAir = e.air, airT = e.airT;
    e.y = hg;
    e.vy = Math.max(-45, Math.min(25, (hg - prevY) / dt));
    e.air = false; e.airT = 0;
    if (wasAir && (airT > 0.3 || e.gpts > 0)) land(e, P, airT);
    else if (wasAir) { e.spin = 0; e.flip = 0; e.grab = 0; e.gt = [0, 0, 0, 0, 0, 0]; }
  } else {
    e.y = ny;
    if (!e.air && ny - hg > 0.3) {
      e.air = true; e.airT = 0; e.spin = 0; e.flip = 0; e.grab = 0; e.gt = [0, 0, 0, 0, 0, 0]; e.airSwitch = e.stance !== 0;
      if (course.rampH(px, pz) > 0.5) e.vy = Math.max(0, e.vy) * P.airMult + P.airBonus; // off a kicker (snowboarders pop higher)
    }
  }

  // rails & boxes: ride onto the start lined up, drop onto them from the air, or get bounced off the side
  const rl = course.railsNear(e.z);
  for (let i = 0; i < rl.length; i++) {
    const r = rl[i];
    if (e.z < r.z0 || e.z > r.z0 + r.len - 0.8) continue;
    const lat = e.x - r.x;
    if (Math.abs(lat) > r.w / 2 + 0.5) continue;
    const top = course.railTop(r, e.z);
    const aligned = Math.abs(e.h) < 0.55;
    if (aligned && e.y >= top - 0.5 && e.y <= top + 1.0 && (!e.air || e.vy <= 1.5) && e.state === 'ride') {
      e.grind = course.rails.indexOf(r); e.air = false; e.y = top; e.vy = 0; e.h = 0;
      e.flip = 0; e.grindT = 0; e.slideAng = r.type === 'box' && Math.abs(e.spin) > 0.6 ? Math.sign(e.spin) * Math.PI / 2 : 0; e.spin = 0;
      if (!e.airSwitch) e.airSwitch = e.stance !== 0;
      return;
    }
    if (e.y < top - 0.3) { // hit the side
      const sg = Math.sign(lat) || 1;
      e.x = r.x + sg * (r.w / 2 + 0.5); e.pushX += sg * 3; e.v *= 0.92;
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
}

function grindStep(e, inp, dt, course, P) {
  const r = course.rails[e.grind];
  if (!r) { e.grind = -1; return; }
  e.grindT += dt;
  // A/D rotates the slide (90° = boardslide), released keys keep the current angle
  e.slideAng = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, e.slideAng + inp.steer * 7 * dt));
  const slope = (course.groundH(r.x, e.z - 0.5) - course.groundH(r.x, e.z + 0.5));
  e.v = Math.max(4, e.v + (PHYS.G * slope * 0.9 - 0.9 - P.drag * e.v * e.v) * dt);
  e.lean *= Math.exp(-6 * dt);
  e.x += (r.x - e.x) * Math.min(1, dt * 20);
  e.z += e.v * dt;
  const top = course.railTop(r, e.z);
  e.vy = (top - e.y) / dt; e.y = top;
  e.tuck = false;
  const end = e.z > r.z0 + r.len;
  if (end || (inp.jump && e.grindT > 0.15)) {
    const slid = Math.abs(e.slideAng) > 1.0;
    e.gname = slid ? (r.type === 'box' ? 2 : 3) : 1;
    e.gpts += 0.5 + Math.min(2, e.grindT * 1.2) + (slid ? 1 : 0);
    e.grind = -1; e.air = true; e.airT = 0; e.spin = e.slideAng; e.slideAng = 0; e.flip = 0; e.grab = 0; e.gt = [0, 0, 0, 0, 0, 0];
    e.vy = Math.max(0, e.vy) + (inp.jump ? P.jumpV * 0.9 : 2.5); e.y += 0.05; e.jumpCD = 0.4;
  }
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
  const g = Math.round(Number(a[5]) || 0);
  return { steer: c(a[1]), tuck: !!(a[2] & 1), brake: !!(a[2] & 2), jump: !!(a[2] & 4), use: !!(a[2] & 8), butter: !!(a[2] & 16),
    spin: Math.round(c(a[3])), flip: Math.round(c(a[4])), grab: g >= 0 && g <= 6 ? g : 0 };
}
export function packInput(seq, inp) {
  return [seq, Math.round(inp.steer * 100) / 100, (inp.tuck ? 1 : 0) | (inp.brake ? 2 : 0) | (inp.jump ? 4 : 0) | (inp.use ? 8 : 0) | (inp.butter ? 16 : 0), inp.spin, inp.flip, inp.grab || 0];
}

// Snowball hit (host only)
export function snowballHit(e) {
  if (e.state === 'wipe' || e.ghostT > 0 || e.finished) return false;
  if (e.shieldT > 0) { e.shieldT = 0; say(e, 'BLOCKED!', true); return true; }
  e.v *= 0.45; e.hitT = 0.9; e.boostT = 0; say(e, 'SNOWBALLED!', false);
  return true;
}

// ---- Bots ----
function estimateAir(e, course) {
  let x = e.x, z = e.z, y = e.y, vy = e.vy; const vx = Math.sin(e.h) * e.v, vz = Math.cos(e.h) * e.v, d = 0.05;
  for (let t = d; t < 4; t += d) { vy -= PHYS.GRAV * d; x += vx * d; z += vz * d; y += vy * d; if (y <= course.groundH(x, z)) return t; }
  return 4;
}
export function newBrain(rnd, cls) {
  return {
    shortcut: [rnd() < 0.55, rnd() < 0.55], lane: (rnd() - 0.5) * 12, laneT: 2 + rnd() * 3,
    skill: 0.9 + rnd() * 0.12, trickProb: cls === 'board' ? 0.75 : 0.4,
    trick: null, wasAir: false, rnd, avoid: 0, avoidT: 0,
  };
}

export function botInput(e, br, course, dt) {
  const inp = { steer: 0, tuck: true, brake: false, jump: false, spin: 0, flip: 0, grab: 0 };
  if (e.state === 'wipe' || e.finished) return inp;
  if (e.item && e.itemCD <= 0) {
    br.useT = (br.useT || 0) + dt;
    if (e.item === 3 || (e.item === 1 && !e.air && Math.abs(e.h) < 0.3 && br.useT > 0.6) || (e.item === 2 && br.targetAhead && br.useT > 0.4) || br.useT > 9) { inp.use = true; br.useT = 0; }
  } else br.useT = 0;
  if (e.grind >= 0) { inp.tuck = false; if (br.slide) inp.steer = br.slide; return inp; }
  br.laneT -= dt;
  if (br.laneT <= 0) { br.lane = (br.rnd() - 0.5) * 14; br.laneT = 2 + br.rnd() * 4; }

  if (e.air) {
    if (!br.wasAir) {
      br.wasAir = true; br.trick = null;
      const T = estimateAir(e, course);
      if (T > 0.9 && br.rnd() < br.trickProb) {
        const P = CLASSES[e.cls], avail = T - 0.3 - br.rnd() * 0.2;
        const tr = { t: 0, T, spinDir: br.rnd() < 0.5 ? -1 : 1, half: 0, flip: 0, grab: 0, gFrom: 0.15, gTo: T - 0.35 };
        if (br.rnd() < 0.35 && avail * P.flipRate > TWO_PI * 1.05) tr.flip = br.rnd() < 0.5 ? 1 : -1;
        else tr.half = Math.min(5, Math.floor(avail * P.spinRate / Math.PI));
        if (br.rnd() < 0.6) tr.grab = 1 + Math.floor(br.rnd() * 6);
        // occasionally misjudge the rotation
        if (br.rnd() < 0.12) tr.half += 1;
        br.trick = tr;
      }
    }
    const tr = br.trick;
    if (tr) {
      tr.t += dt;
      if (tr.half && Math.abs(e.spin) < tr.half * Math.PI - 0.04) inp.spin = tr.spinDir;
      if (tr.flip && Math.abs(e.flip) < TWO_PI - 0.04) inp.flip = tr.flip;
      if (tr.grab && tr.t > tr.gFrom && tr.t < tr.gTo) inp.grab = tr.grab;
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
      for (const o of [...course.obstaclesNear(qz), ...course.railsNear(qz).map(r => ({ x: r.x, z: Math.min(Math.max(qz, r.z0), r.z0 + r.len), r: 1.2, h: 1, rail: r }))]) {
        if (o.h < 2 && e.air) continue;
        if (o.rail && br.railPick && br.railPick.go && br.railPick.r === o.rail) continue;
        const lat = (o.x - qx);
        if (Math.abs(o.z - qz) < 2.5 && Math.abs(lat) < o.r + 1.6) { br.avoid = lat > 0 ? -4.5 : 4.5; br.avoidT = 0.5; break; }
      }
      if (br.avoid) break;
    }
  }
  tx += br.avoid;
  // sometimes go for a rail or box that's coming up
  for (const r of course.railsNear(e.z + 30)) {
    if (r.z0 < e.z + 6 || r.z0 > e.z + 45) continue;
    if (br.railPick === undefined || br.railPick.r !== r) br.railPick = { r, go: br.rnd() < 0.45 };
    if (br.railPick.go) { tx = r.x; br.avoid = 0; br.slide = r.type === 'box' && br.rnd() < 0.5 ? (br.rnd() < 0.5 ? -1 : 1) : 0; }
  }
  const desired = Math.atan2(tx - e.x, look);
  const err = e.h - desired;
  inp.steer = Math.max(-1, Math.min(1, err * 3));
  inp.tuck = Math.abs(err) < 0.25 && e.v < 50 * br.skill;
  if (e.v > 44 * br.skill + (e.boostT > 0 ? 10 : 0)) inp.tuck = false;
  if (Math.abs(err) > 0.7 && e.v > 25) inp.brake = true;
  return inp;
}
