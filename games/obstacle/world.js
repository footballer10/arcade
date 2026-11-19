// ULTIMATE OBSTACLE COURSE — shared world rules (host AND clients run this; no DOM, no three.js).
// Stages are lists of solids (boxes / cylinders). Every moving obstacle is a pure function of the stage clock
// (spin, slide, piston, pendulum), so clients predict them exactly. Only collapsing tiles and doors carry state
// (`W.dyn`, sent in snapshots). Players are vertical capsules (feet at y) with a bouncy, readable move set:
// run, variable jump, dive (Space again in mid-air, once per jump), belly slide, ledge hang + climb, grab.
export const C = {
  R: 0.42, H: 1.5, HL: 0.8,                  // radius, standing height, low height (diving / knocked down)
  RUN: 7.4, ACC: 62, AIR_ACC: 22,
  GRAV: 32, JUMP: 11.6, JUMP_CUT: 46, MAXFALL: 34,
  DIVE: 10.8, DIVE_MAX: 13, DIVE_UP: 5.4, DIVE_AIR_UP: 3.4, SLIDE_T: 0.38,
  COYOTE: 0.11, JBUF: 0.14, STEP_UP: 0.5,
  HANG_MAX: 4, HANG_DROP: 1.25,
  HIT_MIN: 6, HIT_MAX: 15, DOWN_T: 0.9,
  GRAB_R: 1.55, GRAB_BREAK: 2.7, GRAB_T: 2.6, GRAB_CD: 1.2,
  BUMP_DIVE: 8,
};
export const EV = { JUMP: 1, DIVE: 2, LAND: 4, BONK: 8, HIT: 16, FELL: 32, HANG: 64, CLIMB: 128, BOUNCE: 256, DOOR: 512 };
// rising / falling lava (Lava Rush): low for half the cycle, then swells up over the floor and drains again
export const lavaLevel = (L, t) => L.y0 + L.amp * Math.max(0, Math.sin(((t / L.p + L.ph) % 1) * Math.PI * 2));
export const TILE_FALL = 0.9;                // seconds a tile shakes before it drops

// ---------------------------------------------------------------- solids
export function solid(o) {
  const s = Object.assign({ shape: 'box', hx: 1, hy: 0.5, hz: 1, r: 1, bx: 0, by: 0, bz: 0, bry: 0, ox: 0, oz: 0, anim: null, hit: 0, belt: null, bounce: 0,
    tile: -1, door: -1, fake: false, spike: false, noStand: false, ice: false, safe: false, pal: 0, until: 0, blink: null, finish: false, noHang: false, look: 'floor', col: 0 }, o);
  s.q = {}; s.br = s.shape === 'cyl' ? s.r : Math.hypot(s.hx, s.hz);
  pose(s, 0, s); pose(s, 0, s.q);
  return s;
}
// giant rolling balls: travel one chute length every P seconds, then restart at the top
export const rollU = (a, t) => (((t / a.P + a.ph) % 1) + 1) % 1;
const pulse = (u) => (u < 0.1 ? u / 0.1 : u < 0.42 ? 1 : u < 0.72 ? 1 - (u - 0.42) / 0.3 : 0);
const smooth = (u) => u * u * (3 - 2 * u);
// writes x, y, z, ry, c (cos ry), sn (sin ry) and, for pendulums, th (swing angle) into o
export function pose(s, t, o) {
  let x = s.bx, y = s.by, z = s.bz, ry = s.bry;
  const a = s.anim;
  if (a) switch (a.k) {
    case 'spin': ry += a.w * t + 0.5 * (a.acc || 0) * t * t; break;
    case 'slide': { const k = Math.sin(a.w * t + a.ph); x += a.v[0] * k; y += a.v[1] * k; z += a.v[2] * k; break; }
    case 'piston': { const k = smooth(pulse((((t * a.f + a.ph) % 1) + 1) % 1)); x += a.v[0] * k; y += a.v[1] * k; z += a.v[2] * k; break; }
    case 'wave': { const k = Math.max(0, t - a.t0); x += a.v[0] * k; y += a.v[1] * k; z += a.v[2] * k; break; }
    case 'roll': { const u = rollU(a, t), d = u * a.P; x += a.v[0] * d; y += a.v[1] * d; z += a.v[2] * d; o.rollA = d / (s.r || 1); break; }
    case 'pend': { const th = a.amp * Math.sin(a.w * t + a.ph); x += a.d[0] * Math.sin(th) * a.L; y -= Math.cos(th) * a.L; z += a.d[1] * Math.sin(th) * a.L; o.th = th; break; }
  }
  const c = Math.cos(ry), sn = Math.sin(ry);
  if (s.ox || s.oz) { x += s.ox * c + s.oz * sn; z += -s.ox * sn + s.oz * c; }
  o.x = x; o.y = y; o.z = z; o.ry = ry; o.c = c; o.sn = sn;
}
export function setPoses(W, t, dt) {
  W.t = t;
  for (const s of W.moving) { pose(s, t - dt, s.q); pose(s, t, s); }
}
// blinking platforms: on for `on` of every `p` seconds (phase ph), a pure function of the stage clock
export const blinkU = (s, t) => ((t / s.blink.p + s.blink.ph) % 1 + 1) % 1;
export function active(s, W) {
  if (s.anim && s.anim.k === 'wave' && (W.t < s.anim.t0 || W.t > s.anim.t1)) return false;
  if (s.anim && s.anim.k === 'roll') { const u = rollU(s.anim, W.t); if (u < 0.02 || u > 0.985) return false; }
  if (s.blink && blinkU(s, W.t) > s.blink.on) return false;
  if (s.tile >= 0) return W.dyn[s.tile] < 2;
  if (s.door >= 0 && !s.fake) return W.dyn[s.door] === 0;
  if (s.until) return W.t < s.until;
  return true;
}
// world point -> solid local (current pose) and back (current or previous pose)
const toLocal = (s, x, z, out) => { const dx = x - s.x, dz = z - s.z; out[0] = dx * s.c - dz * s.sn; out[1] = dx * s.sn + dz * s.c; return out; };
const L = [0, 0];
export function pointVel(s, x, z, dt) {
  toLocal(s, x, z, L);
  const q = s.q, px = q.x + L[0] * q.c + L[1] * q.sn, pz = q.z - L[0] * q.sn + L[1] * q.c;
  return [(x - px) / dt, (s.y - q.y) / dt, (z - pz) / dt];
}
// footprint test (used by bots and spawn logic): is (x, z) over this solid's top?
export function over(s, x, z, pad = 0) {
  if (s.shape === 'cyl') return Math.hypot(x - s.x, z - s.z) <= s.r + pad;
  toLocal(s, x, z, L); return Math.abs(L[0]) <= s.hx + pad && Math.abs(L[1]) <= s.hz + pad;
}
// highest walkable top under (x, z) between [lo, hi]; returns solid index or -1
export function groundAt(W, x, z, lo, hi) {
  let best = -1, by = -1e9;
  for (let i = 0; i < W.solids.length; i++) {
    const s = W.solids[i]; if (s.hit || !active(s, W)) continue;
    const top = s.y + s.hy; if (top < lo || top > hi || top <= by) continue;
    if (over(s, x, z, 0.1)) { best = i; by = top; }
  }
  return best;
}

// ---------------------------------------------------------------- players
export function newPlayer(id, x, y, z, face = 0) {
  return { id, x, y, z, vx: 0, vy: 0, vz: 0, face, gr: -1, coy: 0, jbuf: 0, jumping: false, dive: false, diveOk: true, down: 0, tumble: false, slide: false,
    hang: -1, hl: [0, 0], hn: [0, 0], hangT: 0, hcd: 0, wall: -1, wn: [0, 0], wtop: 0, grab: null, gby: null, grabT: 0, gcd: 0, lj: 0, ld: 0, cp: 0, rs: 0,
    landV: 0, hitCd: 0, auth: 0, lastBy: null, lastByT: -9 };
}
export function syncCounters(p, inp) { p.lj = inp.j; p.ld = inp.d; }
export const isDown = (p) => p.down > 0 || (p.tumble && p.gr < 0);
export function knock(p, vx, vy, vz, downT = C.DOWN_T) {
  p.vx = vx; p.vy = vy; p.vz = vz; p.down = Math.max(p.down, downT); p.tumble = true; p.dive = false; p.slide = false;
  p.gr = -1; p.coy = 0; p.hang = -1; p.hcd = 0.6; p.grab = null; p.hitCd = downT + 0.6; p.jumping = false;
}
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// One fixed step. inp: {mx, mz (world dir, |m|<=1), jh (jump held), j (jump press counter), d (dive counter), g (grab held)}
// W: {solids, moving, dyn, t, killY, doorHit(fn)}. Returns EV bits.
export function stepPlayer(p, inp, dt, W) {
  let ev = 0;
  const jp = inp.j !== p.lj, dp0 = inp.d !== p.ld; p.lj = inp.j; p.ld = inp.d;
  if (jp) p.jbuf = C.JBUF; else p.jbuf -= dt;
  p.down -= dt; p.hcd -= dt; p.gcd -= dt; p.hitCd -= dt;
  if (p.down <= 0 && p.gr >= 0) { p.tumble = false; p.slide = false; }
  // ---- hanging on a ledge
  if (p.hang >= 0) {
    const s = W.solids[p.hang];
    p.hangT += dt;
    if (!active(s, W) || !inp.g || p.hangT > C.HANG_MAX) { p.hang = -1; p.hcd = 0.45; }
    else {
      p.x = s.x + p.hl[0] * s.c + p.hl[1] * s.sn; p.z = s.z - p.hl[0] * s.sn + p.hl[1] * s.c;
      p.y = s.y + s.hy - C.HANG_DROP; p.vx = p.vy = p.vz = 0;
      const n = [-(p.hn[0]), -(p.hn[1])];
      p.face += angDiff(Math.atan2(n[0], n[1]), p.face) * Math.min(1, dt * 12);
      if (jp) { p.x += n[0] * 0.75; p.z += n[1] * 0.75; p.y = s.y + s.hy + 0.05; p.vy = 4.5; p.vx = n[0] * 2.5; p.vz = n[1] * 2.5; p.hang = -1; p.hcd = 0.35; p.gr = -1; p.jbuf = 0; ev |= EV.CLIMB; }
      return ev;
    }
  }
  const grounded = p.gr >= 0;
  const down = isDown(p);
  const ctl = !down && !p.dive;
  let mx = inp.mx || 0, mz = inp.mz || 0; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  // ---- run
  if (ctl) {
    const slow = (p.grab ? 0.55 : 1) * (p.gby ? 0.4 : 1);
    const ice = grounded && W.solids[p.gr].ice;
    const a = (grounded ? (ice ? C.ACC * 0.085 : C.ACC) : C.AIR_ACC) * dt;
    let dx = mx * C.RUN * slow - p.vx, dz = mz * C.RUN * slow - p.vz; const dl = Math.hypot(dx, dz);
    if (dl > a) { dx *= a / dl; dz *= a / dl; }
    p.vx += dx; p.vz += dz;
    if (ml > 0.1) p.face += angDiff(Math.atan2(mx, mz), p.face) * Math.min(1, dt * 16);
  } else if (grounded) { const f = Math.max(0, 1 - (p.slide ? 3.2 : W.solids[p.gr].ice ? 0.6 : 6) * dt); p.vx *= f; p.vz *= f; }
  // ---- jump (also: a jump press gets you up early from a belly slide)
  if (p.slide && jp && grounded && p.down > 0.05) { p.down = 0; p.slide = false; p.tumble = false; p.jbuf = 0; p.vy = 6; p.gr = -1; ev |= EV.JUMP; }
  else if (ctl && p.jbuf > 0 && p.coy > 0) { p.vy = C.JUMP; p.gr = -1; p.coy = 0; p.jbuf = 0; p.jumping = true; ev |= EV.JUMP; }
  // ---- dive: press Space a second time in mid-air (once per airtime). `inp.d` is only used by bots.
  const dp = dp0 || (jp && p.jbuf > 0 && p.gr < 0 && p.coy <= 0);
  if (dp && !down && !p.dive && p.diveOk) {
    let dir = p.face; if (ml > 0.2) dir = Math.atan2(mx, mz);
    const sp = Math.min(C.DIVE_MAX, Math.max(C.DIVE, Math.hypot(p.vx, p.vz) * 1.12));
    p.face = dir; p.vx = Math.sin(dir) * sp; p.vz = Math.cos(dir) * sp;
    p.vy = grounded ? C.DIVE_UP : Math.max(p.vy + C.DIVE_AIR_UP, C.DIVE_AIR_UP);
    p.dive = true; p.diveOk = false; p.gr = -1; p.coy = 0; p.jumping = false; p.grab = null; ev |= EV.DIVE;
  }
  // ---- gravity
  p.vy -= C.GRAV * dt;
  if (p.jumping && !inp.jh && p.vy > 0) p.vy -= C.JUMP_CUT * dt;
  if (p.vy <= 0) p.jumping = false;
  if (p.vy < -C.MAXFALL) p.vy = -C.MAXFALL;
  // ---- wind from big fans: gusts shove you sideways (more when airborne)
  if (W.winds) for (const f of W.winds) {
    if (p.x < f.x0 || p.x > f.x1 || p.z < f.z0 || p.z > f.z1 || p.y < f.y0 || p.y > f.y1) continue;
    if (f.on < 1 && ((((W.t / f.p + f.ph) % 1) + 1) % 1) > f.on) continue;
    const k = p.gr >= 0 ? 1 : 1.5;
    p.x += f.fx * k * dt; p.z += f.fz * k * dt;
  }
  // ---- carried by the ground (moving / spinning platforms, conveyor belts)
  if (p.gr >= 0) {
    const s = W.solids[p.gr];
    if (s.anim) {
      const q = s.q, dx = p.x - q.x, dz = p.z - q.z, lx = dx * q.c - dz * q.sn, lz = dx * q.sn + dz * q.c;
      p.x = s.x + lx * s.c + lz * s.sn; p.z = s.z - lx * s.sn + lz * s.c; p.y += s.y - q.y; p.face += s.ry - q.ry;
    }
    if (s.belt) { p.x += (s.belt[0] * s.c + s.belt[1] * s.sn) * dt; p.z += (-s.belt[0] * s.sn + s.belt[1] * s.c) * dt; }
  }
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  const wasGr = p.gr, vyIn = p.vy;
  ev |= collide(p, W, dt, wasGr);
  if (p.gr >= 0) {
    if (wasGr < 0) {
      ev |= EV.LAND; p.landV = -vyIn;
      if (p.dive) { p.dive = false; p.slide = true; p.down = Math.max(p.down, C.SLIDE_T); }
    }
    p.coy = C.COYOTE; p.diveOk = true;
    const s = W.solids[p.gr];
    if (s.bounce) { p.vy = s.bounce; p.gr = -1; p.coy = 0; p.dive = false; ev |= EV.BOUNCE; }
  } else p.coy -= dt;
  // ---- ledge grab: hold E in the air against a wall whose top is within reach
  if (p.gr < 0 && inp.g && p.wall >= 0 && p.vy < 3 && p.hcd <= 0 && !isDown(p) && !p.dive) {
    const s = W.solids[p.wall], rel = p.wtop - p.y;
    if (!s.hit && !s.noHang && rel > 0.75 && rel < 2.0) {
      toLocal(s, p.x, p.z, L); p.hl[0] = L[0]; p.hl[1] = L[1]; p.hn[0] = p.wn[0]; p.hn[1] = p.wn[1];
      p.hang = p.wall; p.hangT = 0; p.vx = p.vy = p.vz = 0; p.y = p.wtop - C.HANG_DROP; ev |= EV.HANG;
    }
  }
  if (p.y < W.killY) ev |= EV.FELL;
  if (W.lavas) for (const L of W.lavas) {
    if (p.x < L.x0 || p.x > L.x1 || p.z < L.z0 || p.z > L.z1) continue;
    if (p.y < lavaLevel(L, W.t) - 0.05) ev |= EV.FELL;
  }
  if (W.blasts) for (const b of W.blasts) {
    if (b.t > W.t || b.t <= W.t - dt) continue;
    const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
    if (d > b.r + C.R || Math.abs(p.y - b.y) > 2.5) continue;
    const k = 1 - 0.45 * d / b.r, nx = d > 0.1 ? dx / d : 1, nz = d > 0.1 ? dz / d : 0;
    knock(p, nx * 12 * k, 9 + 3 * k, nz * 12 * k, 0.9); ev |= EV.HIT;
  }
  return ev;
}

function collide(p, W, dt, wasGr) {
  let ev = 0;
  p.gr = -1; p.wall = -1;
  const H = p.dive || isDown(p) ? C.HL : C.H, R = C.R;
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < W.solids.length; i++) {
      const s = W.solids[i];
      const top = s.y + s.hy, bot = s.y - s.hy;
      if (p.y > top + 0.06 || p.y + H < bot) continue;
      if (Math.abs(p.x - s.x) > s.br + R || Math.abs(p.z - s.z) > s.br + R) continue;
      if (!active(s, W)) continue;
      let lx, lz, ddx, ddz, d, inside = false, nlx = 0, nlz = 0, pen = 0;
      if (s.shape === 'cyl') {
        lx = p.x - s.x; lz = p.z - s.z; const rr = Math.hypot(lx, lz);
        d = Math.max(0, rr - s.r); if (d >= R) continue;
        if (rr > 1e-5) { nlx = lx / rr; nlz = lz / rr; } else { nlx = 1; nlz = 0; }
        pen = R - d; inside = rr < s.r;
        if (inside) pen = s.r - rr + R;
      } else {
        toLocal(s, p.x, p.z, L); lx = L[0]; lz = L[1];
        const cx = Math.max(-s.hx, Math.min(s.hx, lx)), cz = Math.max(-s.hz, Math.min(s.hz, lz));
        ddx = lx - cx; ddz = lz - cz; d = Math.hypot(ddx, ddz);
        if (d >= R) continue;
        if (d > 1e-5) { nlx = ddx / d; nlz = ddz / d; pen = R - d; }
        else {
          inside = true;
          const px = s.hx - Math.abs(lx), pz = s.hz - Math.abs(lz);
          if (px < pz) { nlx = Math.sign(lx) || 1; pen = px + R; } else { nlz = Math.sign(lz) || 1; pen = pz + R; }
        }
      }
      if (s.spike) {
        if (p.hitCd <= 0) {
          let kx = p.x - s.x, kz = p.z - s.z; const kl = Math.hypot(kx, kz);
          if (kl > 0.2) { kx /= kl; kz /= kl; } else { const vl = Math.hypot(p.vx, p.vz) || 1; kx = -p.vx / vl; kz = -p.vz / vl; }
          const vl = Math.hypot(p.vx, p.vz); if (vl > 1) { kx = kx * 0.4 - p.vx / vl * 0.6; kz = kz * 0.4 - p.vz / vl * 0.6; const l2 = Math.hypot(kx, kz) || 1; kx /= l2; kz /= l2; }
          knock(p, kx * 7.5, 8.5, kz * 7.5, 0.85); ev |= EV.HIT;
        }
        continue;
      }
      const footIn = d < R * 0.75;
      if (!s.hit && !s.noStand) {
        // land / stand on top
        const rise = s.anim ? Math.max(0, s.y - s.q.y) : 0;
        const tol = Math.max(0.28, -p.vy * dt + 0.12) + rise + (wasGr === i ? 0.25 : 0);
        if (footIn && p.vy <= 0.5 + rise / dt && p.y >= top - tol) { p.y = top; if (p.vy < 0) p.vy = 0; p.gr = i; continue; }
        // bump head
        if (footIn && p.vy > 0 && p.y + H - bot < 0.45 && p.y < bot) { p.y = bot - H; p.vy = 0; p.jumping = false; continue; }
        if (p.y >= top - 0.05) continue;          // level with the top: a seam between platforms, not a wall
      }
      // sweeping Block Dash walls always shove you the way they travel (never sideways off the platform)
      if (s.anim && s.anim.k === 'wave' && p.y < top - 0.05) {
        const dirz = Math.sign(s.anim.v[2]) || -1, face = s.z + dirz * s.hz;
        const want = face + dirz * R;
        if ((p.z - want) * dirz < 0) { p.z = want; if (p.vz * dirz < 0) p.vz = 0; }
        p.wall = i; p.wn[0] = 0; p.wn[1] = dirz; p.wtop = top;
        continue;
      }
      // push out sideways
      const nx = nlx * s.c + nlz * s.sn, nz = -nlx * s.sn + nlz * s.c;
      if (s.shape === 'cyl') { p.x += nlx * pen; p.z += nlz * pen; } else { p.x += nx * pen; p.z += nz * pen; }
      const wx = s.shape === 'cyl' ? nlx : nx, wz = s.shape === 'cyl' ? nlz : nz;
      const vn = p.vx * wx + p.vz * wz;
      if (s.hit && p.hitCd <= 0) {
        const v = pointVel(s, p.x - wx * R, p.z - wz * R, dt);
        const m = Math.hypot(v[0], v[2]);
        if (m > 0.45) {
          const sp = Math.max(C.HIT_MIN, Math.min(s.kmax || C.HIT_MAX, 4 + m * s.hit));
          let kx = v[0] / m * 0.75 + wx * 0.45, kz = v[2] / m * 0.75 + wz * 0.45; const kl = Math.hypot(kx, kz) || 1;
          knock(p, kx / kl * sp, 5 + sp * 0.18, kz / kl * sp); ev |= EV.HIT; p.lastBy = null;
          continue;
        }
      }
      if (vn < 0) {
        if (p.dive && -vn > 6) { p.vx = wx * 3.5; p.vz = wz * 3.5; p.vy = Math.max(p.vy, 3); p.dive = false; p.down = Math.max(p.down, 0.7); p.tumble = true; ev |= EV.BONK; }
        else { p.vx -= vn * wx; p.vz -= vn * wz; }
      }
      p.wall = i; p.wn[0] = wx; p.wn[1] = wz; p.wtop = top;
      if (s.door >= 0 && !s.fake && W.dyn[s.door] === 0) { W.dyn[s.door] = 1; ev |= EV.DOOR; W.doorHit?.(s.door, p); }
      else if (s.door >= 0 && s.fake && -vn > 2.5) { ev |= EV.BONK; knock(p, wx * 6.5, 5, wz * 6.5, 0.55); W.fakeHit?.(s.door, p); }
    }
  }
  return ev;
}

// Soft, bouncy body-vs-body push. `both` = move both (host); false = only a (client predicting itself).
export function separate(a, b, both = true) {
  if (Math.abs(a.y - b.y) > 1.25) return 0;
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = C.R * 2.05;
  if (d >= min || d < 1e-5) return 0;
  const nx = dx / d, nz = dz / d, pen = min - d;
  if (both) { a.x -= nx * pen / 2; a.z -= nz * pen / 2; b.x += nx * pen / 2; b.z += nz * pen / 2; } else { a.x -= nx * pen; a.z -= nz * pen; }
  const rv = (a.vx - (b.vx || 0)) * nx + (a.vz - (b.vz || 0)) * nz;   // closing speed
  if (rv > 0) {
    const k = 0.55;
    a.vx -= nx * rv * k; a.vz -= nz * rv * k;
    if (both) { b.vx += nx * rv * k; b.vz += nz * rv * k; }
  }
  return rv;
}

// ---------------------------------------------------------------- snapshots (binary, unreliable channel)
// flags: 1 in-round, 2 grounded, 4 dive, 8 down, 16 hang, 32 qualified/finished, 64 grabbing, 128 slide
export const PHASES = ['wait', 'intro', 'play', 'post', 'show', 'done'];
export function encodeSnap(s) {
  const n = s.players.length, dyn = s.dyn || new Uint8Array(0);
  const buf = new ArrayBuffer(16 + n * 28 + dyn.length), v = new DataView(buf);
  v.setUint8(0, 7); v.setUint8(1, s.round); v.setUint8(2, PHASES.indexOf(s.phase)); v.setUint8(3, n);
  v.setFloat32(4, s.t); v.setFloat32(8, s.phaseT); v.setUint16(12, dyn.length);
  let o = 16;
  for (const p of s.players) {
    v.setUint8(o, p.idx); v.setUint8(o + 1, p.flags); v.setUint8(o + 2, p.auth & 255); v.setUint8(o + 3, p.grabIdx ?? 255);
    v.setFloat32(o + 4, p.x); v.setFloat32(o + 8, p.y); v.setFloat32(o + 12, p.z);
    const c16 = (x) => Math.max(-32767, Math.min(32767, Math.round(x)));
    v.setInt16(o + 16, c16(p.vx * 100)); v.setInt16(o + 18, c16(p.vy * 100)); v.setInt16(o + 20, c16(p.vz * 100));
    v.setInt16(o + 22, c16(Math.atan2(Math.sin(p.face), Math.cos(p.face)) * 10000)); v.setUint8(o + 24, Math.min(255, Math.max(0, Math.round(p.down * 60))));
    v.setUint8(o + 25, p.cp & 255); v.setUint8(o + 26, p.rs & 255);
    o += 28;
  }
  new Uint8Array(buf, o, dyn.length).set(dyn);
  return buf;
}
export function decodeSnap(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 16 || v.getUint8(0) !== 7) return null;
  const n = v.getUint8(3), dl = v.getUint16(12);
  if (v.byteLength < 16 + n * 28 + dl) return null;
  const s = { round: v.getUint8(1), phase: PHASES[v.getUint8(2)] || 'wait', t: v.getFloat32(4), phaseT: v.getFloat32(8), players: [] };
  let o = 16;
  for (let i = 0; i < n; i++) {
    const g = v.getUint8(o + 3);
    s.players.push({ idx: v.getUint8(o), flags: v.getUint8(o + 1), auth: v.getUint8(o + 2), grabIdx: g === 255 ? -1 : g,
      x: v.getFloat32(o + 4), y: v.getFloat32(o + 8), z: v.getFloat32(o + 12),
      vx: v.getInt16(o + 16) / 100, vy: v.getInt16(o + 18) / 100, vz: v.getInt16(o + 20) / 100, face: v.getInt16(o + 22) / 10000, down: v.getUint8(o + 24) / 60, cp: v.getUint8(o + 25), rs: v.getUint8(o + 26) });
    o += 28;
  }
  s.dyn = new Uint8Array(buf.slice(o, o + dl));
  return s;
}
