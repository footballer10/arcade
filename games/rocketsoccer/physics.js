// Rocket Soccer physics. Pure JS (no three.js) so the host, client prediction and the Node tuning tests all run the
// exact same code. One fixed step = 1/60 s. The whole world (every car, the ball, the boost pads, the match clock)
// lives in one plain object and packs into a Float32Array: the host rounds its state to float32 after every step,
// so a client that rewinds to a snapshot and replays its inputs reproduces the host's numbers exactly.
import { sdArena } from './arena.js';

export const DT = 1 / 60;
export const C = {
  G: 24, MOON_G: 14,        // gravity (normal / Moon Ball)
  BALL_R: 2.7, BALL_MAX: 66, BALL_DRAG: 0.025, BALL_E: 0.62, BALL_ROLL: 0.22,
  HX: 1.1, HY: 0.5, HZ: 1.55, REST: 0.86,   // car hitbox half extents (x width, y height, z length), ride height
  DRIVE_MAX: 25, MAX: 42, SUPER: 38,         // top speed on throttle / absolute cap / supersonic (demolishes)
  THROTTLE: 40, BRAKE: 45, COAST: 6, GRIP: 14, STICK: 9,
  BOOST_ACC: 30, BOOST_USE: 33, BOOST_START: 34,
  JUMP_V: 8.6, JUMP_HOLD: 26, JUMP_HOLD_T: 0.2, DJ_WINDOW: 1.45, DODGE_V: 11.5, FLIP_T: 0.62,
  PITCH: 5.2, YAW: 3.6, ROLL: 3.2, AIR_RESP: 9,
  CAR_MASS: 4, HIT_E: 0.5, HIT_EXTRA: 0.42,
  CAR_R: 1.4, DEMO_T: 3,
  PAD_BIG: 100, PAD_SMALL: 12, PAD_BIG_T: 10, PAD_SMALL_T: 4, PAD_BIG_R: 2.4, PAD_SMALL_R: 1.5,
};
export const PH = { KICK: 0, PLAY: 1, GOAL: 2, REPLAY: 3, END: 4 };
export const KICK_T = 3;

// --------------------------------------------------------------------- tiny vector / quaternion helpers
const g3 = [0, 0, 0], v3 = [0, 0, 0], f3 = [0, 0, 0], u3 = [0, 0, 0], r3 = [0, 0, 0], n3 = [0, 0, 0], t3 = [0, 0, 0];
export function qrot(c, vx, vy, vz, out) {
  const qx = c.qx, qy = c.qy, qz = c.qz, qw = c.qw;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}
function qinv(c, vx, vy, vz, out) {   // rotate by the conjugate (world -> local)
  const qx = -c.qx, qy = -c.qy, qz = -c.qz, qw = c.qw;
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}
// c.q = rot(axis, ang) * c.q  (axis must be unit)
function qpre(c, ax, ay, az, ang) {
  if (!ang) return;
  const h = ang / 2, s = Math.sin(h), rw = Math.cos(h), rx = ax * s, ry = ay * s, rz = az * s;
  const qx = c.qx, qy = c.qy, qz = c.qz, qw = c.qw;
  let x = rw * qx + rx * qw + ry * qz - rz * qy;
  let y = rw * qy - rx * qz + ry * qw + rz * qx;
  let z = rw * qz + rx * qy - ry * qx + rz * qw;
  let w = rw * qw - rx * qx - ry * qy - rz * qz;
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  c.qx = x / l; c.qy = y / l; c.qz = z / l; c.qw = w / l;
}
// rotate vector (vx,vy,vz) in place on object fields about unit axis by ang (Rodrigues)
function rotVel(o, ax, ay, az, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), vx = o.vx, vy = o.vy, vz = o.vz;
  const d = ax * vx + ay * vy + az * vz;
  const cx = ay * vz - az * vy, cy = az * vx - ax * vz, cz = ax * vy - ay * vx;
  o.vx = vx * c + cx * s + ax * d * (1 - c);
  o.vy = vy * c + cy * s + ay * d * (1 - c);
  o.vz = vz * c + cz * s + az * d * (1 - c);
}
// rotate the car so its up vector turns toward n by fraction k (0..1)
function alignUp(c, nx, ny, nz, k) {
  qrot(c, 0, 1, 0, u3);
  let ax = u3[1] * nz - u3[2] * ny, ay = u3[2] * nx - u3[0] * nz, az = u3[0] * ny - u3[1] * nx;
  const s = Math.sqrt(ax * ax + ay * ay + az * az), d = u3[0] * nx + u3[1] * ny + u3[2] * nz;
  if (s < 1e-6) {
    if (d > 0) return;
    qrot(c, 0, 0, 1, f3); ax = f3[0]; ay = f3[1]; az = f3[2];   // upside down: roll about forward
    qpre(c, ax, ay, az, Math.PI * k); return;
  }
  qpre(c, ax / s, ay / s, az / s, Math.atan2(s, d) * k);
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

// --------------------------------------------------------------------- state
export const CAR_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'qx', 'qy', 'qz', 'qw', 'wx', 'wy', 'wz', 'boost', 'gnd', 'jt', 'jh', 'jhold', 'dj', 'ft', 'demo', 'tt', 'hc', 'bst', 'inp', 'st', 'sk'];
export const BALL_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'wx', 'wy', 'wz'];
export const HDR = 12;   // [magic, tick, phase, pt, clock, ot, sA, sB, nCars, nPads, lastTouch, flags]
export const MAGIC = 77;

export function newCar(team) {
  return { team, x: 0, y: C.REST, z: 0, vx: 0, vy: 0, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1, wx: 0, wy: 0, wz: 0, boost: C.BOOST_START, gnd: 1, jt: -1, jh: 0, jhold: 0, dj: 0, ft: 0, demo: 0, tt: 0, hc: 0, bst: 0, inp: 0, st: 0, sk: 0, px: 0, py: 0, pz: 0 };
}
export function newWorld(A, teams) {
  const cars = teams.map((t) => newCar(t));
  return {
    A, cars, ball: { x: 0, y: C.BALL_R, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, px: 0, py: C.BALL_R, pz: 0 },
    grav: C.G, pads: new Float32Array(A.pads.length), tick: 0, phase: PH.KICK, pt: 0, clock: 180, ot: 0, sA: 0, sB: 0, lastTouch: -1, flags: 0,
    ev: null,   // events array while "live" (null during client replays)
  };
}
export function setFacing(c, yaw) { c.qx = 0; c.qy = Math.sin(yaw / 2); c.qz = 0; c.qw = Math.cos(yaw / 2); }

// Input byte: bits 0-1 steer (0 none,1 left,2 right), 2-3 pitch/throttle (0 none,1 W/forward,2 S/back), 4 jump, 5 boost
export function encInput(i) { return (i.x < -0.3 ? 1 : i.x > 0.3 ? 2 : 0) | ((i.y < -0.3 ? 1 : i.y > 0.3 ? 2 : 0) << 2) | (i.jump ? 16 : 0) | (i.boost ? 32 : 0); }
const INP = [];
for (let b = 0; b < 64; b++) { const s = b & 3, t = (b >> 2) & 3; INP[b] = { x: s === 1 ? -1 : s === 2 ? 1 : 0, y: t === 1 ? -1 : t === 2 ? 1 : 0, jump: !!(b & 16), boost: !!(b & 32) }; }
export const decInput = (b) => INP[b & 63];

// --------------------------------------------------------------------- car
function stepCar(W, c, i) {
  const A = W.A, ev = W.ev;
  if (c.demo > 0) {
    c.demo -= DT;
    if (c.demo <= 0) { c.demo = 0; respawn(W, c, i); if (ev) ev.push({ k: 'respawn', i }); }
    return;
  }
  const inp = INP[c.inp & 63];
  const pressed = inp.jump && !c.jh; c.jh = inp.jump ? 1 : 0;
  qrot(c, 0, 0, 1, f3); qrot(c, 0, 1, 0, u3); qrot(c, -1, 0, 0, r3);
  let boosting = inp.boost && c.boost > 0;
  if (boosting) c.boost = Math.max(0, c.boost - C.BOOST_USE * DT);
  c.bst = boosting ? 1 : 0;
  if (c.hc > 0) c.hc--;

  if (c.gnd) {
    sdArena(A, c.x, c.y, c.z, g3); const nx = -g3[0], ny = -g3[1], nz = -g3[2];
    if (pressed) {
      c.vx += nx * C.JUMP_V; c.vy += ny * C.JUMP_V; c.vz += nz * C.JUMP_V;
      c.gnd = 0; c.jt = 0; c.dj = 1; c.jhold = 1;
      if (ev) ev.push({ k: 'jump', i });
    } else {
      // forward along the surface
      const fd = f3[0] * nx + f3[1] * ny + f3[2] * nz;
      let fx = f3[0] - nx * fd, fy = f3[1] - ny * fd, fz = f3[2] - nz * fd;
      const fl = len3(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      const sx = ny * fz - nz * fy, sy = nz * fx - nx * fz, sz = nx * fy - ny * fx;   // left
      const vf = c.vx * fx + c.vy * fy + c.vz * fz;
      const t = -inp.y;
      const vsd = c.vx * sx + c.vy * sy + c.vz * sz, spT = Math.hypot(vf, vsd);
      // brake-turn (handbrake): S + steer while rolling forward. The body whips round fast, the car skids and
      // sheds speed, and you come out facing the new way. Ends once you are facing back the way you came.
      // (needs ~0.15 s of S + steer at real speed, so an ordinary brake into a corner doesn't trigger it)
      const wantSkid = t < 0 && inp.x && vf > -0.96 * spT && (spT > 9 || (c.sk > 0.15 && spT > 3));
      c.sk = wantSkid ? c.sk + DT : 0;
      const skid = wantSkid && c.sk > 0.15;
      let acc = 0;
      if (skid) {
        const k = Math.max(0, 1 - (C.BRAKE * 0.75 * DT) / spT);   // scrub total speed
        c.vx *= k; c.vy *= k; c.vz *= k;
      } else {
        if (boosting) acc += C.BOOST_ACC;
        if (t) {
          if (vf * t < -0.5) acc += t * C.BRAKE;
          else if (Math.abs(vf) < C.DRIVE_MAX) acc += t * C.THROTTLE * Math.max(0.12, 1 - Math.abs(vf) / C.DRIVE_MAX);
        } else if (!boosting) acc -= Math.sign(vf) * Math.min(Math.abs(vf) / DT, C.COAST);
        c.vx += fx * acc * DT; c.vy += fy * acc * DT; c.vz += fz * acc * DT;
      }
      // steering: turn the car and its velocity about the surface normal
      const sp = Math.abs(vf), dir = vf < -0.5 ? -1 : vf > 0.5 ? 1 : t || 1;
      // steering ramps up over ~0.3 s (taps = small, precise corrections, a held key = full lock) and lets go quickly
      c.st += (inp.x - c.st) * Math.min(1, (inp.x === 0 || inp.x * c.st < 0 ? 16 : wantSkid ? 14 : 5.5) * DT);
      if (Math.abs(c.st) < 0.002) c.st = 0;
      let rate = -c.st * dir * Math.min(1, (sp + 2) / 4) * (4.5 - Math.min(sp, C.MAX) * 0.05);
      if (skid) rate = -c.st * 6.8;
      if (rate) { qpre(c, nx, ny, nz, rate * DT); rotVel(c, nx, ny, nz, rate * DT * (skid ? 0.3 : 1)); }
      // tyre grip kills sideways sliding
      const vs = c.vx * sx + c.vy * sy + c.vz * sz, k = vs * (1 - Math.exp(-(skid ? 3 : C.GRIP) * DT));
      c.vx -= sx * k; c.vy -= sy * k; c.vz -= sz * k;
      c.vy -= (W.grav || C.G) * DT;
      c.vx -= nx * C.STICK * DT; c.vy -= ny * C.STICK * DT; c.vz -= nz * C.STICK * DT;
      c.wx = c.wy = c.wz = 0;
      // too slow on a wall, or hanging from the ceiling: fall off
      const spd = len3(c.vx, c.vy, c.vz);
      if ((ny < 0.3 && spd < 7) || (ny < -0.35 && spd < 24) || ny < -0.75) {
        c.gnd = 0; c.jt = -1; c.dj = 1; c.jhold = 0;
        c.vx += nx * 2; c.vy += ny * 2; c.vz += nz * 2;
      }
    }
  }
  if (!c.gnd) {
    if (c.jt >= 0) c.jt += DT;
    if (c.jhold && inp.jump && c.jt < C.JUMP_HOLD_T) { c.vx += u3[0] * C.JUMP_HOLD * DT; c.vy += u3[1] * C.JUMP_HOLD * DT; c.vz += u3[2] * C.JUMP_HOLD * DT; }
    else c.jhold = 0;
    if (pressed && c.dj && c.ft <= 0 && (c.jt < 0 || c.jt > 0.06) && (c.jt < 0 ? true : c.jt < C.DJ_WINDOW)) {
      c.dj = 0;
      if (inp.x || inp.y) {
        // dodge: a burst of speed in the held direction plus a full flip
        let hx = f3[0], hz = f3[2]; const hl = Math.hypot(hx, hz);
        if (hl < 0.2) { hx = c.vx; hz = c.vz; } const hl2 = Math.hypot(hx, hz) || 1; hx /= hl2; hz /= hl2;
        const rx = -hz, rz = hx;   // right of heading (in the horizontal plane)
        let dx = hx * -inp.y + rx * inp.x, dz = hz * -inp.y + rz * inp.x;
        const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        c.vx += dx * C.DODGE_V; c.vz += dz * C.DODGE_V;
        c.vy = c.vy > 0 ? c.vy * 0.35 : c.vy * 0.15;
        // spin axis = dir × worldUp so the nose dips toward the dodge direction
        const ax = -dz, az = dx, al = Math.hypot(ax, az) || 1;
        const spin = (Math.PI * 2) / C.FLIP_T;
        c.wx = (ax / al) * spin; c.wy = 0; c.wz = (az / al) * spin; c.ft = C.FLIP_T;
        if (ev) ev.push({ k: 'dodge', i });
      } else {
        c.vx += u3[0] * C.JUMP_V; c.vy += u3[1] * C.JUMP_V; c.vz += u3[2] * C.JUMP_V;
        if (ev) ev.push({ k: 'jump2', i });
      }
    }
    if (c.ft > 0) {
      c.ft -= DT;
      if (c.ft <= 0) { c.ft = 0; c.wx = c.wy = c.wz = 0; }
    } else {
      // air control in the car's own frame. With boost held you fly: W/S pitch, A/D yaw + roll (a banked turn).
      // Without boost it stays calm: a gentle tilt, A/D just turn, and the car levels itself (see carSurface),
      // so holding W through a jump doesn't flip you onto your roof.
      qinv(c, c.wx, c.wy, c.wz, t3);
      const fly = boosting ? 1 : 0;
      const tp = -inp.y * C.PITCH * (fly ? 1 : 0.3), ty = -inp.x * C.YAW * (fly ? 1 : 0.85), tr = inp.x * C.ROLL * fly;
      const k = Math.min(1, C.AIR_RESP * DT);
      t3[0] += (tp - t3[0]) * k; t3[1] += (ty - t3[1]) * k; t3[2] += (tr - t3[2]) * k;
      qrot(c, t3[0], t3[1], t3[2], t3); c.wx = t3[0]; c.wy = t3[1]; c.wz = t3[2];
    }
    if (boosting) { c.vx += f3[0] * C.BOOST_ACC * DT; c.vy += f3[1] * C.BOOST_ACC * DT; c.vz += f3[2] * C.BOOST_ACC * DT; }
    c.vy -= (W.grav || C.G) * DT;
    const wl = len3(c.wx, c.wy, c.wz);
    if (wl > 1e-5) qpre(c, c.wx / wl, c.wy / wl, c.wz / wl, wl * DT);
  }
  // speed cap
  const sp = len3(c.vx, c.vy, c.vz);
  if (sp > C.MAX) { const k = C.MAX / sp; c.vx *= k; c.vy *= k; c.vz *= k; }
  // integrate
  c.px = c.x; c.py = c.y; c.pz = c.z;
  c.x += c.vx * DT; c.y += c.vy * DT; c.z += c.vz * DT;
  carSurface(W, c, i, inp, pressed);
}

function carSurface(W, c, i, inp, pressed) {
  const A = W.A, ev = W.ev;
  const d = -sdArena(A, c.x, c.y, c.z, g3); const nx = -g3[0], ny = -g3[1], nz = -g3[2];
  qrot(c, 0, 1, 0, u3);
  const up = u3[0] * nx + u3[1] * ny + u3[2] * nz;
  const vn = c.vx * nx + c.vy * ny + c.vz * nz;
  if (c.gnd) {
    if (d > C.REST + 0.7 || up < 0.4) { c.gnd = 0; c.jt = -1; c.dj = 1; c.jhold = 0; return; }
    // follow the curve: turn velocity + body by the change of surface normal since the last step
    sdArena(A, c.px, c.py, c.pz, t3);
    const ox = -t3[0], oy = -t3[1], oz = -t3[2], dn = ox * nx + oy * ny + oz * nz;
    if (dn < 0.99999) {
      let ax = oy * nz - oz * ny, ay = oz * nx - ox * nz, az = ox * ny - oy * nx; const s = len3(ax, ay, az);
      if (s > 1e-7) { ax /= s; ay /= s; az /= s; const ang = Math.atan2(s, dn); rotVel(c, ax, ay, az, ang); qpre(c, ax, ay, az, ang); }
    }
    c.x += nx * (C.REST - d); c.y += ny * (C.REST - d); c.z += nz * (C.REST - d);
    const vn2 = c.vx * nx + c.vy * ny + c.vz * nz;
    if (vn2 < 0) { c.vx -= nx * vn2; c.vy -= ny * vn2; c.vz -= nz * vn2; }
    alignUp(c, nx, ny, nz, Math.min(1, 16 * DT));
    return;
  }
  if (d < C.REST) {
    if (up > 0.35 && vn < 1) {
      // wheels down: land
      const hard = -vn;
      c.gnd = 1; c.jt = -1; c.dj = 0; c.jhold = 0; c.ft = 0; c.wx = c.wy = c.wz = 0; c.tt = 0;
      c.x += nx * (C.REST - d); c.y += ny * (C.REST - d); c.z += nz * (C.REST - d);
      if (vn < 0) { c.vx -= nx * vn; c.vy -= ny * vn; c.vz -= nz * vn; }
      alignUp(c, nx, ny, nz, 0.6);
      if (ev && hard > 6) ev.push({ k: 'land', i, s: hard });
      return;
    }
    // roof / side contact: bounce like a box
    const rr = 0.62 + 0.3 * Math.abs(up);
    if (d < rr) { c.x += nx * (rr - d); c.y += ny * (rr - d); c.z += nz * (rr - d); }
    if (vn < 0) {
      c.vx -= nx * vn * 1.25; c.vy -= ny * vn * 1.25; c.vz -= nz * vn * 1.25;
      c.vx *= 0.9; c.vy *= 0.9; c.vz *= 0.9;
      c.wx *= 0.6; c.wy *= 0.6; c.wz *= 0.6;
      if (ev && vn < -8) ev.push({ k: 'bonk', i, s: -vn });
    }
  }
  // turtled (lying on the roof or side): flip back over by itself or with Space
  const sp = len3(c.vx, c.vy, c.vz);
  if (d < 1.7 && sp < 5 && up < 0.5 && c.ft <= 0) c.tt += DT; else c.tt = 0;
  if (c.tt > 0.45 || (pressed && c.tt > 0.08)) {
    c.tt = 0; c.dj = 0; c.jt = -1;
    c.vx += nx * 7; c.vy += ny * 7; c.vz += nz * 7;
    let ax = u3[1] * nz - u3[2] * ny, ay = u3[2] * nx - u3[0] * nz, az = u3[0] * ny - u3[1] * nx;
    let al = len3(ax, ay, az);
    if (al < 1e-3) { qrot(c, 0, 0, 1, f3); ax = f3[0]; ay = f3[1]; az = f3[2]; al = 1; }
    const ang = Math.acos(clamp(up, -1, 1)), T = 0.5;
    c.wx = (ax / al) * (ang / T); c.wy = (ay / al) * (ang / T); c.wz = (az / al) * (ang / T); c.ft = T;
  }
  // self-levelling while not flying: wheels ease toward the surface below (or the sky when high up)
  if (c.ft <= 0 && !c.bst) {
    const near = d < 6 && vn < 2, rate = (inp.x || inp.y ? 2.6 : 3.6) * DT;
    if (near) alignUp(c, nx, ny, nz, Math.min(1, rate)); else alignUp(c, 0, 1, 0, Math.min(1, rate * 0.8));
  }
}

export function respawn(W, c, i) {
  const A = W.A, slot = W.cars.filter((o, k) => k < i && o.team === c.team).length % A.respawn.length;
  const [x, z] = A.respawn[slot], s = c.team === 0 ? 1 : -1;
  Object.assign(c, { x: x * s, y: C.REST, z: z * s, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, gnd: 1, jt: -1, dj: 0, ft: 0, tt: 0, jhold: 0, boost: C.BOOST_START, demo: 0, st: 0, sk: 0 });
  setFacing(c, c.team === 0 ? 0 : Math.PI);
  c.px = c.x; c.py = c.y; c.pz = c.z;
}

// --------------------------------------------------------------------- ball
function stepBall(W) {
  const b = W.ball, A = W.A, R = C.BALL_R;
  b.px = b.x; b.py = b.y; b.pz = b.z;
  b.vy -= (W.grav || C.G) * DT;
  const dk = 1 - C.BALL_DRAG * DT; b.vx *= dk; b.vy *= dk; b.vz *= dk;
  const sp = len3(b.vx, b.vy, b.vz);
  if (sp > C.BALL_MAX) { const k = C.BALL_MAX / sp; b.vx *= k; b.vy *= k; b.vz *= k; }
  b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
  let rolling = false;
  for (let it = 0; it < 2; it++) {
    const f = sdArena(A, b.x, b.y, b.z, g3);
    if (f <= -R) break;
    const nx = -g3[0], ny = -g3[1], nz = -g3[2], pen = f + R;
    b.x += nx * pen; b.y += ny * pen; b.z += nz * pen;
    const vn = b.vx * nx + b.vy * ny + b.vz * nz;
    if (vn < 0) {
      const tx = b.vx - nx * vn, ty = b.vy - ny * vn, tz = b.vz - nz * vn;
      if (vn < -3) {
        const e = C.BALL_E, fr = 0.9;
        b.vx = tx * fr - nx * vn * e; b.vy = ty * fr - ny * vn * e; b.vz = tz * fr - nz * vn * e;
        if (W.ev && vn < -9) W.ev.push({ k: 'bounce', s: -vn, x: b.x - nx * R, y: b.y - ny * R, z: b.z - nz * R });
      } else {
        const k = 1 - C.BALL_ROLL * DT;
        b.vx = tx * k; b.vy = ty * k; b.vz = tz * k; rolling = true;
      }
      // spin: roll along the surface (visual + replay only)
      b.wx = (ny * b.vz - nz * b.vy) / R; b.wy = (nz * b.vx - nx * b.vz) / R; b.wz = (nx * b.vy - ny * b.vx) / R;
    }
  }
  if (!rolling) { b.wx *= 0.995; b.wy *= 0.995; b.wz *= 0.995; }
}

// car (oriented box) vs ball (sphere)
function carBall(W, c, i) {
  if (c.demo > 0) return;
  const b = W.ball, R = C.BALL_R;
  const dx = b.x - c.x, dy = b.y - c.y, dz = b.z - c.z;
  if (dx * dx + dy * dy + dz * dz > (R + 2.2) * (R + 2.2)) return;
  qinv(c, dx, dy, dz, t3);
  const cx = clamp(t3[0], -C.HX, C.HX), cy = clamp(t3[1], -C.HY, C.HY), cz = clamp(t3[2], -C.HZ, C.HZ);
  let lx = t3[0] - cx, ly = t3[1] - cy, lz = t3[2] - cz;
  let dist = len3(lx, ly, lz);
  if (dist >= R) return;
  if (dist < 1e-4) {   // ball centre inside the box: push out through the nearest face
    const ex = C.HX - Math.abs(t3[0]), ey = C.HY - Math.abs(t3[1]), ez = C.HZ - Math.abs(t3[2]);
    lx = ly = lz = 0;
    if (ex <= ey && ex <= ez) lx = Math.sign(t3[0]) || 1; else if (ey <= ez) ly = Math.sign(t3[1]) || 1; else lz = Math.sign(t3[2]) || 1;
    dist = 0;
  } else { lx /= dist; ly /= dist; lz /= dist; }
  qrot(c, lx, ly, lz, n3); const nx = n3[0], ny = n3[1], nz = n3[2];
  qrot(c, cx, cy, cz, v3);   // contact point relative to the car centre
  const pen = R - dist;
  b.x += nx * pen * 0.9; b.y += ny * pen * 0.9; b.z += nz * pen * 0.9;
  c.x -= nx * pen * 0.1; c.y -= ny * pen * 0.1; c.z -= nz * pen * 0.1;
  // velocity of the car at the contact point
  const pvx = c.vx + (c.wy * v3[2] - c.wz * v3[1]), pvy = c.vy + (c.wz * v3[0] - c.wx * v3[2]), pvz = c.vz + (c.wx * v3[1] - c.wy * v3[0]);
  const rvx = b.vx - pvx, rvy = b.vy - pvy, rvz = b.vz - pvz;
  const vn = rvx * nx + rvy * ny + rvz * nz;
  if (vn >= 0) return;
  const j = (-(1 + C.HIT_E) * vn) / (1 + 1 / C.CAR_MASS);
  b.vx += nx * j; b.vy += ny * j; b.vz += nz * j;
  c.vx -= (nx * j) / C.CAR_MASS; c.vy -= (ny * j) / C.CAR_MASS; c.vz -= (nz * j) / C.CAR_MASS;
  // arcade "power": an extra push along the line from the car to the ball, flattened so shots stay low and
  // aimable. Only once per touch, so dribbling stays soft.
  const rel = Math.min(len3(rvx, rvy, rvz), 60);
  if (c.hc <= 0 && rel > 2) {
    let ex = dx, ey = dy * 0.4, ez = dz; const el = len3(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
    const k = rel * C.HIT_EXTRA * (rel > 30 ? 0.9 : 1);
    b.vx += ex * k; b.vy += ey * k; b.vz += ez * k;
    c.hc = 8;
  }
  W.lastTouch = i;
  if (W.ev && (-vn > 1.5)) W.ev.push({ k: 'hit', i, s: -vn + rel * 0.3, x: c.x + v3[0], y: c.y + v3[1], z: c.z + v3[2] });
}

function carCar(W, a, b, ia, ib) {
  if (a.demo > 0 || b.demo > 0) return;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d2 = dx * dx + dy * dy + dz * dz, min = C.CAR_R * 2;
  if (d2 >= min * min || d2 < 1e-8) return;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
  const va = a.vx * nx + a.vy * ny + a.vz * nz, vb = b.vx * nx + b.vy * ny + b.vz * nz;
  // demolition: a supersonic car ramming an opponent
  if (a.team !== b.team) {
    const sa = len3(a.vx, a.vy, a.vz), sb = len3(b.vx, b.vy, b.vz);
    if (sa >= C.SUPER && va > 18 && va > vb) { demolish(W, b, ib, ia); return; }
    if (sb >= C.SUPER && -vb > 18 && -vb > -va) { demolish(W, a, ia, ib); return; }
  }
  const push = (min - d) / 2;
  a.x -= nx * push; a.y -= ny * push; a.z -= nz * push;
  b.x += nx * push; b.y += ny * push; b.z += nz * push;
  const rel = vb - va;
  if (rel < 0) {
    const j = -(1 + 0.35) * rel / 2;
    a.vx -= nx * j; a.vy -= ny * j; a.vz -= nz * j;
    b.vx += nx * j; b.vy += ny * j; b.vz += nz * j;
    // a little pop so bumps look lively
    if (j > 4) { if (va > -vb) { b.vy += j * 0.25; b.gnd = 0; b.jt = -1; } else { a.vy += j * 0.25; a.gnd = 0; a.jt = -1; } }
    if (W.ev && j > 3) W.ev.push({ k: 'bump', i: ia, j: ib, s: j, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  }
}
function demolish(W, v, iv, ia) {
  if (W.ev) W.ev.push({ k: 'demo', i: iv, by: ia, x: v.x, y: v.y, z: v.z });
  v.demo = C.DEMO_T; v.gnd = 0; v.vx = v.vy = v.vz = 0; v.wx = v.wy = v.wz = 0; v.y = -50;
  if (W.onDemo) W.onDemo(iv, ia);
}

function stepPads(W) {
  const A = W.A;
  for (let p = 0; p < A.pads.length; p++) {
    if (W.pads[p] > 0) { W.pads[p] = Math.max(0, W.pads[p] - DT); continue; }
    const pd = A.pads[p], r = pd.big ? C.PAD_BIG_R : C.PAD_SMALL_R;
    for (let i = 0; i < W.cars.length; i++) {
      const c = W.cars[i];
      if (c.demo > 0 || c.y > 3 || c.boost >= 100) continue;
      const dx = c.x - pd.x, dz = c.z - pd.z;
      if (dx * dx + dz * dz > r * r) continue;
      c.boost = Math.min(100, c.boost + (pd.big ? C.PAD_BIG : C.PAD_SMALL));
      W.pads[p] = pd.big ? C.PAD_BIG_T : C.PAD_SMALL_T;
      if (W.ev) W.ev.push({ k: 'pad', i, p });
      break;
    }
  }
}

// One fixed step of the whole world. Inputs are already in each car's `inp` byte.
export function stepWorld(W) {
  if (W.phase === PH.KICK) {
    W.pt -= DT;
    if (W.pt > 0) { for (const c of W.cars) { c.px = c.x; c.py = c.y; c.pz = c.z; c.jh = INP[c.inp & 63].jump ? 1 : 0; } const b = W.ball; b.px = b.x; b.py = b.y; b.pz = b.z; W.tick++; return; }
    W.pt = 0; W.phase = PH.PLAY;
    if (W.ev) W.ev.push({ k: 'kickoff' });
  }
  if (W.phase !== PH.PLAY && W.phase !== PH.GOAL) { W.tick++; return; }
  const cars = W.cars;
  for (let i = 0; i < cars.length; i++) stepCar(W, cars[i], i);
  for (let i = 0; i < cars.length; i++) for (let k = i + 1; k < cars.length; k++) carCar(W, cars[i], cars[k], i, k);
  if (W.phase === PH.PLAY) {
    for (let i = 0; i < cars.length; i++) carBall(W, cars[i], i);
    stepBall(W);
    if (W.ot) W.clock += DT; else W.clock = Math.max(0, W.clock - DT);
  } else { const b = W.ball; b.px = b.x; b.py = b.y; b.pz = b.z; }
  stepPads(W);
  W.tick++;
}

// Only the ball (for bot predictions). Works on a lightweight copy.
export function predictBall(W, out, steps, every = 3) {
  const P = { A: W.A, ball: { ...W.ball }, ev: null, grav: W.grav };
  out.length = 0;
  for (let s = 1; s <= steps; s++) { stepBall(P); if (s % every === 0) out.push({ t: s * DT, x: P.ball.x, y: P.ball.y, z: P.ball.z, vx: P.ball.vx, vy: P.ball.vy, vz: P.ball.vz }); }
  return out;
}

// --------------------------------------------------------------------- kickoff
export function kickoff(W, rng) {
  const A = W.A, b = W.ball;
  Object.assign(b, { x: 0, y: C.BALL_R, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, px: 0, py: C.BALL_R, pz: 0 });
  const order = rng ? rng.shuffle([0, 1, 2, 3, 4]) : [0, 1, 2, 3, 4];   // same spots for both teams (mirrored)
  for (const team of [0, 1]) {
    const idx = W.cars.map((c, i) => (c.team === team ? i : -1)).filter((i) => i >= 0);
    idx.forEach((ci, k) => {
      const c = W.cars[ci], [x, z] = A.kick[order[k % 5]], s = team === 0 ? 1 : -1;
      Object.assign(c, { x: x * s, y: C.REST, z: z * s, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, gnd: 1, jt: -1, dj: 0, ft: 0, tt: 0, jhold: 0, demo: 0, hc: 0, boost: C.BOOST_START, bst: 0, st: 0, sk: 0 });
      setFacing(c, Math.atan2(-c.x, -c.z));
      c.px = c.x; c.py = c.y; c.pz = c.z;
    });
  }
  W.pads.fill(0);
  W.phase = PH.KICK; W.pt = KICK_T; W.lastTouch = -1;
}

// --------------------------------------------------------------------- pack / unpack (snapshots, replays)
export const CK = CAR_KEYS.length, BK = BALL_KEYS.length;
export function packSize(W) { return HDR + W.cars.length * (CK + 1) + BK + W.pads.length; }
export function pack(W, acks) {
  const f = new Float32Array(packSize(W));
  f[0] = MAGIC; f[1] = W.tick; f[2] = W.phase; f[3] = W.pt; f[4] = W.clock; f[5] = W.ot; f[6] = W.sA; f[7] = W.sB; f[8] = W.cars.length; f[9] = W.pads.length; f[10] = W.lastTouch; f[11] = W.flags;
  let o = HDR;
  for (let i = 0; i < W.cars.length; i++) { const c = W.cars[i]; for (let k = 0; k < CK; k++) f[o++] = c[CAR_KEYS[k]]; f[o++] = acks ? acks[i] || 0 : 0; }
  for (let k = 0; k < BK; k++) f[o++] = W.ball[BALL_KEYS[k]];
  f.set(W.pads, o);
  return f;
}
// Write a packed snapshot into W. Returns the per-car acks.
export function unpack(W, f, acks) {
  W.tick = f[1]; W.phase = f[2]; W.pt = f[3]; W.clock = f[4]; W.ot = f[5]; W.sA = f[6]; W.sB = f[7]; W.lastTouch = f[10]; W.flags = f[11];
  let o = HDR;
  for (let i = 0; i < W.cars.length; i++) { const c = W.cars[i]; for (let k = 0; k < CK; k++) c[CAR_KEYS[k]] = f[o++]; if (acks) acks[i] = f[o]; o++; }
  for (let k = 0; k < BK; k++) W.ball[BALL_KEYS[k]] = f[o++];
  W.pads.set(f.subarray(o, o + W.pads.length));
  return acks;
}
// Round all state to float32 (the host does this every step so replays on clients match bit for bit).
const F = Math.fround;
export function quantize(W) {
  W.pt = F(W.pt); W.clock = F(W.clock);
  for (const c of W.cars) for (let k = 0; k < CK; k++) { const key = CAR_KEYS[k]; c[key] = F(c[key]); }
  for (let k = 0; k < BK; k++) { const key = BALL_KEYS[k]; W.ball[key] = F(W.ball[key]); }
}
export const speedOf = (o) => len3(o.vx, o.vy, o.vz);
export { len3, clamp };
