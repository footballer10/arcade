// Bot contestants (run on the host only; also drives the test autopilot). They follow the stage's route nodes,
// look a little ahead for sweepers / hammers / punchers (jump the low ones, dive under the high ones, wait for
// the rest), time leaps onto moving platforms, pick doors (and remember the fake ones they bonked), hop
// between tiles, and dive across finish lines. Difficulty (ctx.bots.level) sets reaction time, how far ahead
// they look, how often they misjudge a hazard or a jump, and how bold they are.
import { C, pose, active, groundAt, isDown, blinkU, lavaLevel, rollU, stepPlayer, setPoses, EV } from './world.js';

export function makeBot(Brain, level, rnd = Math.random) {
  return { brain: new Brain(level, rnd), level, rnd, ni: 0, offs: new Map(), lane: null, door: null, tried: new Set(), inp: { mx: 0, mz: 0, jh: false, j: 0, d: 0, g: false },
    nf: new Map(), stuck: 0, lx: 0, lz: 0, jumpT: 0, diveArm: false, ignore: new Map(), goal: -1, goalT: 0, wander: null, wanderT: 0, lastRs: -1, finDive: false, prey: null, leapT: 0 };
}
export function resetBot(b) { b.nf?.clear(); b.pad = null; b.alt = null; b.ni = 0; b.offs.clear(); b.lane = null; b.door = null; b.tried.clear(); b.goal = -1; b.wander = null; b.finDive = false; b.diveArm = false; b.ignore.clear(); b.prey = null; b.flight = null; b.safe = null; b.edgeWait = 0; b.commit = null; }

const TMP = {}, TMP2 = {}, TMP3 = {};
const jump = (b, hold = 0.32, why = '') => { b.inp.j++; b.jumpT = hold; b.inp.jh = true; b.jumpWhy = why; };   // held from the press itself, or the jump comes out short
const dive = (b) => { b.inp.d++; };

// G: {st, W, players: [{id,x,y,z,...}] (in round), me: id}
export function botThink(G, p, b, dt) {
  const inp = b.inp, lv = b.level, st = G.st;
  b.jumpT -= dt; b.leapT -= dt; inp.jh = b.jumpT > 0; inp.g = false;
  const think = b.brain.ready(dt);
  if (p.rs !== b.lastRs) {          // respawned: remember where we fell (to get careful there), then find our place again
    if (b.lastRs >= 0) { b.nf.set(b.ni, (b.nf.get(b.ni) || 0) + 1); b.offs.clear(); b.lane = null; b.pad = null; b.alt = null; b.gate = null; }
    b.lastRs = p.rs; b.ni = 0; b.door = null; b.stuck = 0; b.flight = null; b.safe = null; b.edgeWait = 0; b.commit = null;
  }
  if (b.diveArm && p.gr < 0 && p.vy < 1.2 && !p.dive) { b.diveArm = false; dive(b); }
  if (p.gr >= 0) b.diveArm = false;
  if (isDown(p) || p.hang >= 0) { inp.mx = inp.mz = 0; return inp; }
  // a ground move the look-ahead approved (e.g. through a moving gap): follow through
  if (b.commit) {
    if (G.W.t < b.commit.until && !p.tumble) { inp.mx = b.commit.mx; inp.mz = b.commit.mz; return inp; }
    b.commit = null;
  }
  // following a jump the look-ahead approved: keep the same stick input until we land
  if (b.flight) {
    if ((p.gr >= 0 && G.W.t > b.flight.t0 + 0.1) || (b.flight.end && G.W.t > b.flight.end)) b.flight = null;
    else if (G.W.t < b.flight.t0 + 2.4) { inp.mx = b.flight.mx; inp.mz = b.flight.mz; return inp; }
    else b.flight = null;
  }
  let tx, tz, tsolid = -1, leapNode = false;
  if (st.mode === 'race' || st.mode === 'crown') ({ tx, tz, tsolid, leapNode } = raceTarget(G, p, b));
  else if (st.id === 'tiles') ({ tx, tz, tsolid } = tileTarget(G, p, b, think));
  else if (st.id === 'blockdash') ({ tx, tz } = dashTarget(G, p, b, think));
  else ({ tx, tz } = arenaTarget(G, p, b, think));
  if (tx == null) { inp.mx = inp.mz = 0; return inp; }
  let dx = tx - p.x, dz = tz - p.z; const dist = Math.hypot(dx, dz);
  if (dist > 1e-3) { dx /= dist; dz /= dist; }
  let mx = dist > 0.25 ? dx : 0, mz = dist > 0.25 ? dz : 0;
  const err = (b.errA ??= (b.rnd() * 2 - 1) * lv.aimError * 0.25);
  if (mx || mz) { const c = Math.cos(err), s = Math.sin(err); [mx, mz] = [mx * c + mz * s, -mx * s + mz * c]; }
  // edge: no ground ahead -> leap if the target is in reach, otherwise wait
  const grounded = p.gr >= 0;
  if (grounded && (mx || mz)) {
    const ax = p.x + mx * 0.85, az = p.z + mz * 0.85;
    const below = (b.dropOK ? groundAt(G.W, ax, az, p.y - 2, p.y - 0.5) >= 0 : tsolid < 0 && b.dropY != null && b.dropY < p.y - 0.8 && groundAt(G.W, ax, az, p.y - 6, p.y - 0.5) >= 0);   // fine to hop down
    if (below && hazardNear(G, p) && (think || b.dropChk == null) && canPlan(G)) {
      const r = lookAhead(G, p, { mx, mz, T: 1.0, minY: p.y - 3.5 });
      b.dropChk = r.ok;
    }
    if (below && b.dropChk === false && hazardNear(G, p)) { mx = mz = 0; }
    if (!below) b.dropChk = null;
    const stepUp = !below && groundAt(G.W, ax, az, p.y - 0.7, p.y + 0.55) < 0 && groundAt(G.W, p.x + mx * 1.3, p.z + mz * 1.3, p.y + 0.55, p.y + 1.85) >= 0;
    if (stepUp) {
      // a step (or a higher platform) right in front: jump up onto it when the look-ahead says the landing is safe
      if ((think || b.leapT < -0.3) && b.jumpT <= 0 && canPlan(G)) {
        const fl = Math.hypot(mx, mz) || 1, ux = mx / fl, uz = mz / fl;
        const r = lookAhead(G, p, { mx: ux, mz: uz, jump: true, hold: 0.5, T: 1.4, stand: 0.3, after: [ux * 0.2, uz * 0.2], minY: p.y - 0.8, accept: (gr) => G.W.solids[gr].y + G.W.solids[gr].hy > p.y + 0.5 });
        if (r.ok || b.rnd() < lv.mistakes * 0.03) { jump(b, 0.5, 'stepup'); b.leapT = 0.4; b.flight = { mx: ux, mz: uz, t0: G.W.t, ok: r.ok }; inp.mx = ux; inp.mz = uz; return inp; }
      }
      mx *= 0.05; mz *= 0.05;
    }
    else if (!below && groundAt(G.W, ax, az, p.y - 0.7, p.y + 0.55) < 0) {
      const careful = (b.nf.get(b.ni) || 0) >= 2;          // fell here twice already: only take safe jumps
      const lp = leapPlan(G, p, tsolid >= 0 ? tsolid : groundAt(G.W, tx, tz, p.y - 3, p.y + 1.7), tx, tz, careful);
      const reach = careful ? 2.9 : 3.2 + lv.skill * 0.7, mistake = !careful && think && b.rnd() < lv.mistakes * 0.08;
      const tsi = tsolid >= 0 ? tsolid : groundAt(G.W, tx, tz, p.y - 3, p.y + 1.7);
      if (lp && tsi >= 0 && !mistake && lp.gap < 7 && lp.dy < 1.8) {
        // look-ahead: only jump when a simulated jump lands (and stays) safely; otherwise wait at the edge
        b.edgeWait = (b.edgeWait || 0) + dt;
        if ((think || b.leapT < -0.3) && canPlan(G)) {
          const pl = planLeap(G, p, b, tsi, lp.ax, lp.az, careful);
          if (pl) {
            const e = (b.rnd() - 0.5) * lv.aimError * 0.32, c = Math.cos(e), sn = Math.sin(e);
            mx = pl.mx * c + pl.mz * sn; mz = -pl.mx * sn + pl.mz * c;
            jump(b, 0.5, 'leap'); b.leapT = 0.4; b.edgeWait = 0;
            b.flight = { mx, mz, t0: G.W.t, plan: pl, si: tsi, end: pl.bounce ? G.W.t + pl.t + 0.05 : null }; if (pl.dive) b.diveArm = true;
            inp.mx = mx; inp.mz = mz; return inp;
          }
        }
        if (b.edgeWait < 5 + lv.skill * 4) { mx = mz = 0; }
        else if (lp.ok && lp.gap <= reach) { jump(b, 0.5, 'leapFallback'); b.leapT = 0.4; b.edgeWait = 0; const l = Math.hypot(lp.ax - p.x, lp.az - p.z) || 1; mx = (lp.ax - p.x) / l; mz = (lp.az - p.z) / l; }
        else { mx = mz = 0; }
      }
      else if (lp && lp.ok && lp.dy < 1.65 && (lp.gap <= reach || (mistake && lp.gap < reach + 2))) {
        if (think || b.leapT < -0.6) {
          const l = Math.hypot(lp.ax - p.x, lp.az - p.z) || 1; mx = (lp.ax - p.x) / l; mz = (lp.az - p.z) / l;
          jump(b, 0.5, 'leapOld'); b.leapT = 0.4; if (b.dropOK) { /* never dive onto a small rock */ } else if (st.id === 'tiles' ? lp.gap > 3.4 : (lp.gap > 2.6 + lv.skill * 0.4 || b.rnd() < 0.15 * lv.skill)) b.diveArm = true;
        } else { mx *= 0.15; mz *= 0.15; }
      } else if (!leapNode && dist < 1.2) { /* target reached at an edge: fine */ mx = mz = 0; }
      else { mx = mz = 0; }
    }
  }
  // big fans: lean into the gust
  if (G.W.winds?.length) for (const f of G.W.winds) {
    if (p.x < f.x0 || p.x > f.x1 || p.z < f.z0 - 1 || p.z > f.z1 || p.y < f.y0 || p.y > f.y1) continue;
    const u = (((G.W.t + 0.15) / f.p + f.ph) % 1 + 1) % 1; if (f.on < 1 && u > f.on) continue;
    mx -= (f.fx / C.RUN) * (0.55 + b.level.skill * 0.5); mz -= (f.fz / C.RUN) * 0.5;
  }
  // giant rolling balls: sidestep out of their path
  const ball = ballThreat(G, p);
  if (ball && ball.across && b.rnd() > b.level.mistakes * dt * 3) { if (!ball.under) { mx = mz = 0; } }
  else if (ball && b.rnd() > b.level.mistakes * dt * 3) {
    // step into the nearest pocket that is clear of every ball coming down at us, then keep running up it
    const px = ballPocket(G, p);
    if (px == null) { if (grounded && b.jumpT <= 0 && ball.tau < 0.45) jump(b, 0.5, 'ballJump'); }
    else if (Math.abs(px - p.x) > 0.3) { mx = Math.sign(px - p.x); mz = 0.2; }
    else { mx = (px - p.x) * 2; mz = 0.8; }
  }
  // spike traps: don't step onto a strip that will be up when we get there (but get off one that is about to pop)
  if (st.spikes?.length && grounded && (mx || mz) && st.mode !== 'race' && st.mode !== 'crown') {
    const sp = spikeThreat(G, p, mx, mz, lv);
    if (sp === 'wait') { mx = mz = 0; }
  }
  // bombs: get out of any red circle that is about to blow
  if (G.W.blasts?.length) {
    for (const bl of G.W.blasts) {
      if (bl.t < G.W.t || bl.t > G.W.t + 1.6 - (1 - lv.skill) * 0.6) continue;
      const dx = p.x - bl.x, dz = p.z - bl.z, d = Math.hypot(dx, dz);
      if (d < bl.r + 1.2) { const l = d || 1; mx = dx / l; mz = dz / l; const k = Math.hypot(p.x, p.z); if (k > 7.5) { mx -= p.x / k * 0.8; mz -= p.z / k * 0.8; } break; }
    }
  }
  // ice: ease off the throttle near a target so you don't slide past it
  if (grounded && G.W.solids[p.gr]?.ice) { const k = Math.max(0.3, Math.min(1, dist / 3)); mx *= k; mz *= k; }
  // hazards nearby (sweepers, hammers, punchers, balls, spike traps): ask the look-ahead whether walking on is safe;
  // if not, pick the first safe option: jump over, wait, back off, or step aside
  if (grounded && (st.mode === 'race' || st.mode === 'crown') && hazardNear(G, p)) {
    if ((think || !b.safe || G.W.t > b.safe.until) && (canPlan(G) || !b.safe)) {
      const mistake = b.rnd() < lv.mistakes * 0.06;
      const opts = [];
      const fl = Math.hypot(mx, mz);
      let ux = mx / (fl || 1), uz = mz / (fl || 1);
      if (fl <= 0.05) { const rl = Math.hypot(tx - p.x, tz - p.z); if (rl > 0.1) { ux = (tx - p.x) / rl; uz = (tz - p.z) / rl; } else { ux = 0; uz = 1; } }
      if (fl > 0.05) { opts.push(['go', mx, mz, false]); opts.push(['jump', ux, uz, true]); for (const d of [0.15, 0.3, 0.45]) opts.push(['gojump', ux, uz, true, d]); }
      const inLava = G.W.lavas?.some((L) => p.x > L.x0 && p.x < L.x1 && p.z > L.z0 && p.z < L.z1 && p.y < L.floor + 0.4);   // on a lava pit floor: never stand around
      if (!inLava) opts.push(['wait', 0, 0, false]);
      if (!inLava) opts.push(['back', -ux * 0.6, -uz * 0.6, false]); opts.push(['left', -uz * 0.7 + ux * 0.15, ux * 0.7 + uz * 0.15, false]); opts.push(['right', uz * 0.7 + ux * 0.15, -ux * 0.7 + uz * 0.15, false]);
      let pick = mistake ? opts[0] : null, best = null, bestT = -1;
      for (const o of opts) {
        if (pick || (budget <= 0 && best)) break;
        if (!o[3] && (o[1] || o[2]) && groundAt(G.W, p.x + o[1] * 1.2, p.z + o[2] * 1.2, p.y - 0.7, p.y + 0.55) < 0 && o[0] !== 'go') continue;
        const r = lookAhead(G, p, o[3] ? { mx: o[1], mz: o[2], jump: true, jumpAt: o[4] || 0, hold: 0.5, T: 1.6 + (o[4] || 0), stand: 0.25, minY: p.y - 1.2 } : { mx: o[1], mz: o[2], walk: true, edgeFail: o[0] !== 'go', T: (o[0] === 'wait' ? 0.75 : 0.55) + lv.skill * 0.25 });
        if (r.ok) pick = o; else if ((r.t || 0) > bestT) { bestT = r.t || 0; best = o; }
      }
      if (!pick) pick = best || opts[0];      // nothing fully safe: the option that stays safe the longest
      b.safe = { k: pick[0], mx: pick[1], mz: pick[2], until: G.W.t + 0.2 + (pick[4] || 0), jumped: false, at: G.W.t + (pick[4] || 0) };
    }
    const sf = b.safe;
    if (sf.k === 'gojump') {
      if (G.W.t >= sf.at && !sf.jumped && b.jumpT <= 0) { jump(b, 0.5, 'gojump'); sf.jumped = true; b.flight = { mx: sf.mx, mz: sf.mz, t0: G.W.t }; }
      mx = sf.mx; mz = sf.mz;
    }
    else if (sf.k === 'jump') { if (!sf.jumped && b.jumpT <= 0) { jump(b, 0.5, 'hazJump'); sf.jumped = true; b.flight = { mx: sf.mx, mz: sf.mz, t0: G.W.t }; } mx = sf.mx; mz = sf.mz; }
    else if (sf.k !== 'go') { mx = sf.mx; mz = sf.mz; }
  } else b.safe = null;
  // stuck: jump, then try another way
  const moved = Math.hypot(p.x - b.lx, p.z - b.lz); b.lx = p.x; b.lz = p.z;
  if ((mx || mz) && moved < dt * 1.2 && grounded) b.stuck += dt; else b.stuck = Math.max(0, b.stuck - dt * 2);
  if (b.stuck > 0.7 && b.jumpT <= 0 && (think || b.stuck > 1.5)) {
    const fl = Math.hypot(mx, mz) || 1;
    if (!hazardNear(G, p) || (canPlan(G) && lookAhead(G, p, { mx: mx / fl, mz: mz / fl, jump: true, hold: 0.35, T: 1.3, stand: 0.2, minY: p.y - 1.2 }).ok)) jump(b, 0.35, 'stuck');
  }
  if (b.stuck > 2.4) { b.stuck = 0; b.offs.clear(); b.lane = null; if (b.door) { b.tried.add(b.door.d); b.door = null; } b.errA = (b.rnd() * 2 - 1) * 0.6; b.wander = null; b.goal = -1; }
  // dive across the finish line
  if (st.mode === 'race' && st.finishZ != null && !b.finDive && grounded && p.z > st.finishZ - 3.4 && p.z < st.finishZ - 1 && b.rnd() < 0.4 + lv.skill * 0.5) { b.finDive = true; dive(b); }
  inp.mx = mx; inp.mz = mz;
  return inp;
}

function raceTarget(G, p, b) {
  const st = G.st, R = st.route;
  // after a respawn (or a fall-back), skip to the first node ahead of us
  if (b.ni === 0 && p.z > 6) { const nz = (n) => (n.z ?? G.W.solids[n.sid ?? n.sidAlts?.[0] ?? 0].bz); let i = 0; while (i < R.length - 1 && nz(R[i]) < p.z - 1) i++; b.ni = i; }
  for (let guard = 0; guard < 4; guard++) {
    const n = R[b.ni]; if (!n) return { tx: p.x, tz: p.z + 5 };
    if (n.crown) {
      const c = st.crown, d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < 1.7 && p.gr >= 0 && b.jumpT <= 0) jump(b, 0.4, 'crown');
      return { tx: c.x, tz: c.z, tsolid: -1 };
    }
    let arrived = false;
    if (n.gates) arrived = p.z > n.z + 1.0;
    else if (n.slideGap != null) arrived = p.z > n.z + 1.3;
    else if (n.padAlts) arrived = n.padAlts.includes(p.gr) || (p.gr < 0 && p.vy > 12.4 && Math.abs(p.z - n.z) < 3);
    else if (n.sidAlts) arrived = n.sidAlts.includes(p.gr);
    else if (n.sid != null) arrived = p.gr === n.sid && (!n.center || Math.hypot(p.x - G.W.solids[n.sid].x, p.z - G.W.solids[n.sid].z) < 1.8 || n.leap);
    else if (n.door != null) arrived = p.z > st.doors[n.door].z + 0.9;
    else arrived = p.z > n.z - (n.r || 1.3) * 0.5 && Math.abs(p.y - n.y) < 1.6 && (p.gr >= 0 || n.y < p.y);
    if (arrived) { b.ni++; if (n.door != null) b.door = null; continue; }
    let tx, tz, tsolid = -1;
    if (n.gates) {
      // pick the gate that is open (for long enough) or opens first; wait in front of it until it is open
      const W = G.W;
      const info = (id) => { const s = W.solids[id], u = blinkU(s, W.t), P = s.blink.p; return u > s.blink.on ? { open: true, left: (1 - u) * P } : { open: false, wait: (s.blink.on - u) * P }; };
      // score each gate by when we could actually be through it: travel time to it vs. its open window
      const usable = (id) => { const s = W.solids[id], i = info(id), P = s.blink.p, win = (1 - s.blink.on) * P;
        const reach = Math.abs(s.x - p.x) / 6.4 + Math.max(0, n.z - 0.6 - p.z) / 7;
        if (i.open && i.left > reach + 0.25) return reach;
        let t0 = i.open ? i.left + s.blink.on * P : i.wait; while (t0 + win < reach + 0.25) t0 += P;
        return Math.max(reach, t0); };
      if (b.gate == null || b.gateNi !== b.ni || b.rnd() < 0.04) {
        let best = n.gates[0], bs = -1e9;
        for (const id of n.gates) { const sc = -usable(id) + b.rnd() * 0.15 + (id === b.gate ? 0.25 : 0); if (sc > bs) { bs = sc; best = id; } }
        b.gate = best; b.gateNi = b.ni;
      }
      const s = W.solids[b.gate], i = info(b.gate);
      const near = p.z > n.z - 2.3;
      if (near && !(i.open && i.left > 0.9 - b.level.skill * 0.3)) return { tx: s.x, tz: n.z - 2.3, tsolid: -1 };       // hold at the gate
      return { tx: s.x, tz: n.z + 2.4, tsolid: -1 };
    }
    if (n.slideGap != null) {
      // sliding wall with one moving gap: shadow the gap from just in front of the wall, step through when lined up
      const W = G.W, s = W.solids[n.slideGap], lim = n.hw - 0.7;
      const gx = (tau) => { pose(s, W.t + tau, TMP2); return Math.max(-lim, Math.min(lim, TMP2.x + n.off)); };
      const lead = 0.12 + (1 - b.level.skill) * 0.25, err = (b.gapErr ??= (b.rnd() - 0.5) * b.level.aimError * 0.8);
      const near = p.z > n.z - 2.6;
      const cross = Math.max(0.15, (n.z + 0.8 - p.z) / C.RUN);
      const lined = Math.abs(gx(0) - p.x) < 0.42 && Math.abs(gx(cross) - p.x) < 0.75;
      if (near && !lined) return { tx: gx(lead) + err, tz: n.z - 2.3, tsolid: -1 };
      if (!near) return { tx: gx(lead + 0.3), tz: n.z - 2.3, tsolid: -1 };
      // check the crossing with the look-ahead before committing to it
      const cx = gx(cross * 0.7) - p.x, cz = n.z + 2.2 - p.z, cl = Math.hypot(cx, cz) || 1;
      const r = lookAhead(G, p, { mx: cx / cl, mz: cz / cl, T: cross + 0.45 });
      if (!r.ok && b.rnd() > b.level.mistakes * 0.1) return { tx: gx(lead) + err, tz: n.z - 2.3, tsolid: -1 };
      b.gapErr = null; b.commit = { mx: cx / cl, mz: cz / cl, until: G.W.t + cross + 0.3 };
      return { tx: gx(cross * 0.7), tz: n.z + 2.2, tsolid: -1 };
    }
    b.dropOK = n.rock != null;
    if (n.rock != null) {
      const L = G.W.lavas?.[n.rock];
      const here = p.gr >= 0 ? G.W.solids[p.gr] : null, dry = here && here.y + here.hy > (L ? L.floor + 0.6 : -1e9);
      if (L && dry && b.ni === b.rockNi) {
        const tgt = n.sid != null ? G.W.solids[n.sid] : { x: n.x, z: n.z };
        const need = Math.hypot(tgt.x - p.x, tgt.z - p.z) / 6.2 + 0.5 + (1 - b.level.skill) * 0.2;
        let safe = true; for (let tau = 0; tau <= need; tau += 0.1) if (lavaLevel(L, G.W.t + tau) > L.floor - 0.1) { safe = false; break; }
        if (!safe && !(b.rnd() < b.level.mistakes * 0.02)) return { tx: p.x, tz: p.z, tsolid: -1 };   // hold position on the rock
      }
      b.rockNi = b.ni;
    }
    if (n.tip && n.sid != null) {
      // Tip Toe: bots only know tiles someone has already stood on safely (like players watching each other).
      // Stepping into the unknown, they guess, and better bots guess right more often.
      const W = G.W, known = (W.tipKnown ||= new Set());
      for (const q of G.players) if (q.gr >= 0) { const s = W.solids[q.gr]; if (s && s.tile >= 0 && s.safe) known.add(s.idx); }
      if (b.tipNi !== b.ni) {
        b.tipNi = b.ni; b.tipWrong = null;
        const guess = !known.has(n.sid) && b.rnd() > 0.3 + b.level.skill * 0.35;
        if (guess || b.rnd() < b.level.mistakes * 0.8) {
          let best = null, bd = 9;
          for (const s of G.W.solids) if (s.tile >= 0 && !s.safe && G.W.dyn[s.tile] === 0 && s.z > p.z - 1) { const d = Math.hypot(s.x - G.W.solids[n.sid].x, s.z - G.W.solids[n.sid].z); if (d < 2.6 && d < bd) { bd = d; best = s.idx; } }
          b.tipWrong = best;
        }
      }
      if (b.tipWrong != null) {
        const s = G.W.solids[b.tipWrong];
        // the tile shakes under us: a moment of surprise before reacting, often too long to get off in time
        if (p.gr === s.idx && W.dyn[s.tile] === 1 && b.tipFreeze == null) b.tipFreeze = W.t + 0.15 + b.level.reaction * 1.4;
        if (b.tipFreeze != null && W.t < b.tipFreeze) return { tx: p.x, tz: p.z, tsolid: -1 };
        if (W.dyn[s.tile] >= 1 && p.gr !== s.idx) { b.tipWrong = null; b.tipFreeze = null; }
        else if (W.dyn[s.tile] === 2) { b.tipWrong = null; b.tipFreeze = null; }
        else if (b.tipFreeze == null) return { tx: s.x, tz: s.z, tsolid: s.idx };
      }
    }
    if (n.padAlts) {
      if (b.pad == null || !n.padAlts.includes(b.pad)) b.pad = n.padAlts[Math.floor(b.rnd() * n.padAlts.length)];
      const s = G.W.solids[b.pad]; return { tx: s.x, tz: s.z + 0.4, tsolid: -1, leapNode: false };
    }
    if (n.sidAlts) {
      if (b.alt == null || !n.sidAlts.includes(b.alt) || b.altNi !== b.ni || (p.gr >= 0 && b.rnd() < 0.2)) {
        let best = n.sidAlts[1], bs = -9;
        for (const id of n.sidAlts) {
          const s = G.W.solids[id], u = blinkU(s, G.W.t + 0.6), left = s.blink.on - u;
          const sc = (u <= s.blink.on ? left : -1) - Math.abs(s.x - p.x) * 0.04 + b.rnd() * 0.08 * (1.3 - b.level.skill);
          if (sc > bs) { bs = sc; best = id; }
        }
        b.alt = best; b.altNi = b.ni;
      }
      const s = G.W.solids[b.alt]; return { tx: s.x, tz: s.z, tsolid: b.alt, leapNode: true };
    }
    if (n.sid != null) {
      const s = G.W.solids[n.sid]; pose(s, G.W.t + 0.5, TMP); tx = TMP.x; tz = TMP.z; tsolid = n.sid;
      // a platform sliding sideways: wait at the edge in our own lane rather than chasing it
      if (s.anim && s.anim.k === 'slide' && Math.abs(s.anim.v[0]) > 0.5 && p.gr !== n.sid) tx = p.x + Math.max(-1.0, Math.min(1.0, TMP.x - p.x));
      if (p.gr === n.sid) { tx = s.x; tz = s.z; }
    } else if (n.alts) {
      if (b.lane == null) { const x = n.alts[Math.floor(b.rnd() * n.alts.length)]; b.lane = x; }
      tx = b.lane; tz = n.z;
    } else if (n.lane) { tx = b.lane ?? 0; tz = n.z; }
    else if (n.door != null) {
      const row = st.doors[n.door];
      if (!b.door || b.tried.has(b.door.d)) b.door = pickDoor(G, p, b, row);
      if (!b.door) { b.tried.clear(); b.door = pickDoor(G, p, b, row); }
      tx = b.door.x; tz = row.z + 1.4;
      if (Math.abs(p.z - row.z) < 1.0 && Math.abs(p.x - b.door.x) < 1.2 && b.door.fake) { b.tried.add(b.door.d); b.door = pickDoor(G, p, b, row) || b.door; }
      if (Math.abs(p.x - tx) > 0.6 && p.z < row.z - 0.3) tz = row.z - 1.4;     // line up before going through
    } else {
      let off = b.offs.get(b.ni);
      if (off == null) { off = (b.rnd() * 2 - 1) * (n.w || 0); if (n.side && Math.abs(off) < n.side) off = (off < 0 ? -1 : 1) * n.side; b.offs.set(b.ni, off); }
      tx = n.x + off; tz = n.z + 0.6;
    }
    b.dropY = n.y;
    if (n.exact) tz = n.z;
    return { tx, tz, tsolid, leapNode: !!n.leap };
  }
  return { tx: p.x, tz: p.z + 3 };
}
function pickDoor(G, p, b, row) {
  const open = row.row.filter((d) => G.W.dyn[d.d] === 1 && !b.tried.has(d.d));
  if (open.length && b.rnd() < 0.35 + b.level.skill * 0.6) return open.sort((a, c) => Math.abs(a.x - p.x) - Math.abs(c.x - p.x))[0];
  const c = row.row.filter((d) => !b.tried.has(d.d));
  if (!c.length) return null;
  c.sort((a, d) => Math.abs(a.x - p.x) - Math.abs(d.x - p.x));
  return c[Math.min(c.length - 1, Math.floor(b.rnd() * Math.min(3, c.length)))];
}

function tileTarget(G, p, b, think) {
  const W = G.W, S = W.solids, lv = b.level;
  const cur = p.gr >= 0 ? S[p.gr] : null;
  if (!cur) { const g = b.goal >= 0 ? S[b.goal] : null; return g ? { tx: g.x, tz: g.z, tsolid: g.idx } : { tx: p.x, tz: p.z, tsolid: -1 }; }
  const layer = cur.layer;
  const age = cur.tile >= 0 && W.dyn[cur.tile] === 1 && W.tileT ? W.t - W.tileT[cur.tile] : 0;
  const gs = b.goal >= 0 ? S[b.goal] : null;
  // a good player waits on a tile until it starts to shake, then steps to a fresh neighbour
  const leaveAt = TILE_FALL_GUESS * (0.25 + lv.skill * 0.45) + (b.wait ?? 0);
  const need = !gs || W.dyn[gs.tile] === 2 || gs.layer !== layer || (gs === cur && age > leaveAt);
  if (need && (think || age > leaveAt + 0.15 || !gs)) {
    b.wait = (b.rnd() - 0.5) * 0.25 + (b.rnd() < lv.mistakes ? 0.5 : 0);
    let best = -1, bs = -1e9;
    for (const s of S) {
      if (s.layer !== layer || W.dyn[s.tile] !== 0 || s === cur) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z); if (d > 4.6) continue;
      let sc = (d < 2.3 ? 3 : 0) - d * 0.3 - Math.hypot(s.x, s.z) * 0.12 + b.rnd() * 1.2;
      for (const o of G.players) if (o.id !== p.id) { const od = Math.hypot(o.x - s.x, o.z - s.z); if (od < 2.5) sc -= (2.5 - od) * 1.2; }
      let nb = 0; for (const t of S) if (t.layer === layer && W.dyn[t.tile] === 0 && Math.abs(t.x - s.x) < 2.2 && Math.abs(t.z - s.z) < 2.2) nb++;
      sc += nb * 0.45 * lv.skill;
      if (sc > bs) { bs = sc; best = s.idx; }
    }
    b.goal = best;
  }
  const g = b.goal >= 0 ? S[b.goal] : null;
  if (!g || g === cur) return { tx: cur.x, tz: cur.z, tsolid: cur.idx };
  return { tx: g.x, tz: g.z, tsolid: g.idx };
}
const TILE_FALL_GUESS = 0.9;

function arenaTarget(G, p, b, think) {
  const lv = b.level, st = G.st, W = G.W;
  b.wanderT -= G.dt || 1 / 60;
  // ground that will still be there in a few seconds (outer rings drop on a timer)
  const ok = (x, z) => { const gi = groundAt(W, x, z, -1, 0.5); if (gi < 0) return false; const s = W.solids[gi]; return !(s.until && s.until - W.t < 3); };
  const here = p.gr >= 0 ? W.solids[p.gr] : null;
  const dying = here && here.until && here.until - W.t < 3.2;
  if (!b.wander || b.wanderT <= 0 || dying || !ok(b.wander[0], b.wander[1]) || Math.hypot(b.wander[0] - p.x, b.wander[1] - p.z) < 0.9) {
    for (let i = 0; i < 10; i++) {
      const a = b.rnd() * Math.PI * 2, r = b.rnd() * (st.arenaR || 10) * 0.8;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (ok(x, z) && ok(x * 0.9, z * 0.9)) { b.wander = [x, z]; break; }
    }
    b.wanderT = 1.2 + b.rnd() * 1.8;
  }
  // finals: the bold ones go hunting
  if (st.mode === 'last' && think && W.t > 10 && b.rnd() < lv.skill * 0.06) {
    const near = G.players.filter((o) => o.id !== p.id).map((o) => [o, Math.hypot(o.x - p.x, o.z - p.z)]).filter(([, d]) => d < 5).sort((a, c) => a[1] - c[1])[0];
    b.prey = near ? near[0].id : null;
  }
  const prey = b.prey && G.players.find((o) => o.id === b.prey);
  if (prey && ok(prey.x, prey.z)) {
    const d = Math.hypot(prey.x - p.x, prey.z - p.z);
    if (d < 2.6 && p.gr >= 0 && think && b.rnd() < 0.5) { p.face = Math.atan2(prey.x - p.x, prey.z - p.z); dive(b); b.prey = null; }
    return { tx: prey.x, tz: prey.z };
  }
  return b.wander ? { tx: b.wander[0], tz: b.wander[1] } : { tx: 0, tz: 0 };
}

// closest landing spot on solid si (predicted ~0.45 s ahead) and the gap to it
function leapPlan(G, p, si, tx, tz, careful = false) {
  if (si < 0) return null;
  const s = G.W.solids[si];
  if (s.blink) { const u = blinkU(s, G.W.t + 0.55); if (u > s.blink.on - (careful ? 0.25 : 0.1)) return null; }
  else if (!active(s, G.W)) return null;
  // where will a moving platform be when we land? (flight time grows with the distance)
  let T = 0.45;
  if (s.anim) for (let k = 0; k < 2; k++) { pose(s, G.W.t + T, TMP2); T = 0.32 + Math.max(0, Math.hypot(TMP2.x - p.x, TMP2.z - p.z) - (s.shape === 'cyl' ? s.r : Math.min(s.hx, s.hz))) / 6.5; }
  const P = s.anim ? (pose(s, G.W.t + T, TMP2), TMP2) : s;
  let ax, az, gap;
  if (s.shape === 'cyl') {
    const dx = p.x - P.x, dz = p.z - P.z, d = Math.hypot(dx, dz) || 1;
    gap = Math.max(0, d - s.r); const k = Math.max(0, s.r - 1.0) / d; ax = P.x + dx * k; az = P.z + dz * k;
  } else {
    const dx = p.x - P.x, dz = p.z - P.z, lx = dx * P.c - dz * P.sn, lz = dx * P.sn + dz * P.c;
    const cx = Math.max(-s.hx, Math.min(s.hx, lx)), cz = Math.max(-s.hz, Math.min(s.hz, lz));
    gap = Math.hypot(lx - cx, lz - cz);
    const ix = Math.max(-s.hx + 0.8, Math.min(s.hx - 0.8, lx)), iz = Math.max(-s.hz + 0.8, Math.min(s.hz - 0.8, lz));
    ax = P.x + ix * P.c + iz * P.sn; az = P.z - ix * P.sn + iz * P.c;
    // bias toward the route target when the platform is big
    if (s.hx > 3 || s.hz > 3) { ax = ax * 0.5 + tx * 0.5; az = az * 0.5 + tz * 0.5; }
  }
  // only jump at a moving platform when it will be (nearly) straight ahead on the route: no wild sideways leaps
  let ok = true;
  if (s.anim && s.anim.k !== 'spin') {
    // courses run along +z: the platform must come to us, not the other way round
    const jx = ax - p.x, jz = az - p.z;
    ok = Math.abs(jx) <= (careful ? 0.7 : 1.15) + 0.2 * Math.abs(jz);
    // and it must not be sliding away from under us: check it is still in place a moment after landing
    pose(s, G.W.t + T + 0.25, TMP3); if (Math.hypot(TMP3.x - P.x, TMP3.z - P.z) > (careful ? 0.7 : 1.3)) ok = ok && Math.hypot(TMP3.x - ax, TMP3.z - az) < Math.max(s.hx, s.hz) - 0.3;
  }
  return { gap, ax, az, dy: P.y + s.hy - p.y, ok };
}

// ---------------------------------------------------------------- look-ahead
// Runs the real player physics forward on a copy of the bot against the future poses of every platform and hazard
// (moving platforms, lifts, blinking tiles, hammers, sweepers, balls, spikes), then puts the world back exactly as it
// was. plan: {mx, mz, jump, hold, dive, T, stand, minY, accept(gr, q)}. Returns {ok, knocked, fell, landed, t}.
const SDT = 1 / 60;
let simCount = 0;
// look-ahead budget per game frame (simulated steps, shared by every bot), so planning never causes a hitch:
// when it's used up, the remaining bots keep their current decision and plan on a later frame
const BUDGET = 420;
let budget = BUDGET, budgetT = -1;
const canPlan = (G) => { if (G.W.t !== budgetT) { budgetT = G.W.t; budget = BUDGET; } return budget > 0; };
export const botSimStats = () => simCount;
function lookAhead(G, p, plan) {
  simCount++;
  const W = G.W, t0 = W.t, dyn0 = W.dyn.slice(), dh = W.doorHit, fh = W.fakeHit; W.doorHit = null; W.fakeHit = null;
  const q = { ...p, grab: null, gby: null, hang: -1, hl: p.hl ? [...p.hl] : p.hl };
  const inp = { mx: plan.mx, mz: plan.mz, jh: false, j: q.lj, d: q.ld, g: false };
  const T = plan.T ?? 1.6, minY = plan.minY ?? p.y - 2.2, startGr = p.gr;
  let air = false, dived = false, landT = -1, res = null;
  for (let k = 1; k * SDT <= T + 1e-6; k++) {
    const t = k * SDT;
    setPoses(W, t0 + t - SDT, SDT);            // the real step that follows this decision runs at the current world time
    const jk = 1 + Math.round((plan.jumpAt || 0) / SDT);
    if (plan.jump && k === jk) inp.j = (q.lj + 1) & 255;
    inp.jh = !!plan.jump && k >= jk && t - (jk - 1) * SDT < (plan.hold ?? 0.5);
    if (plan.dive && air && !dived && !q.dive && q.vy < (plan.diveVy ?? 1.2)) { inp.d = (q.ld + 1) & 255; dived = true; }
    if (landT >= 0) { inp.mx = plan.after ? plan.after[0] : 0; inp.mz = plan.after ? plan.after[1] : 0; }
    const ev = stepPlayer(q, inp, SDT, W); budget--;
    if (q.tumble) { res = { ok: false, knocked: true, t }; break; }
    if ((ev & EV.FELL) || q.y < minY || q.y < W.killY + 1) { res = { ok: false, fell: true, t }; break; }   // includes lava
    if (q.gr < 0) air = true;
    if (plan.walk && q.gr < 0 && !plan.jump) { res = plan.edgeFail ? { ok: false, fell: true, t } : { ok: true, edge: true, t }; break; }
    if (ev & EV.BOUNCE) {            // a trampoline: the bounce is the landing
      const pad = groundAt(W, q.x, q.z, q.y - 1.0, q.y + 0.3);
      res = (!plan.accept || plan.accept(pad >= 0 ? pad : -1, q, startGr)) ? { ok: true, landed: pad, t, bounce: true } : { ok: false, wrong: true, t }; break;
    }      // walked to an edge: the leap logic takes it from here
    if (air && q.gr >= 0 && landT < 0) {
      landT = t;
      if (plan.accept && !plan.accept(q.gr, q, startGr)) { res = { ok: false, wrong: true, landed: q.gr, t }; break; }
      if (!plan.stand) { res = { ok: true, landed: q.gr, t }; break; }
      plan.lt = t;
    }
    if (landT >= 0 && t - landT >= plan.stand) { res = { ok: q.gr >= 0, landed: q.gr, t, lt: landT }; break; }
  }
  if (!res) res = plan.jump ? { ok: false, timeout: true } : { ok: true, t: T };
  setPoses(W, t0, G.dt || SDT); W.dyn.set(dyn0); W.doorHit = dh; W.fakeHit = fh;
  return res;
}
// try a few jumps toward (ax, az): straight at it and a little to either side, with and without a dive
function planLeap(G, p, b, si, ax, az, careful) {
  const W = G.W, base = Math.atan2(ax - p.x, az - p.z), tgt = W.solids[si];
  // small platform (lift, raft, stepping stone) with someone already on it or about to land there: wait for it to clear
  const small = tgt.shape === 'cyl' ? tgt.r < 2.4 : tgt.hx * tgt.hz < 5.5;
  if (small && G.players) for (const q of G.players) {
    if (q === p || q.id === p.id) continue;
    if (q.gr === si) return null;
    if (q.gr < 0 && Math.hypot(q.x - tgt.x, q.z - tgt.z) < 3.2 && q.y > tgt.y - 1) return null;
  }
  const accept = (gr, q, g0) => gr >= 0 && gr !== g0 && (gr === si || (W.solids[gr].y + W.solids[gr].hy > tgt.y + tgt.hy - 0.6 && q.z > p.z + 0.6)) && !W.solids[gr].noStand;
  const minY = Math.min(p.y, tgt.y + tgt.hy) - 1.6;
  const offs = careful ? [0, 0.12, -0.12] : [0, 0.15, -0.15, 0.32, -0.32];
  for (const dive of [false, true]) for (const o of offs) {
    if (budget <= 0) return null;
    const a = base + o, mx = Math.sin(a), mz = Math.cos(a);
    const r = lookAhead(G, p, { mx, mz, jump: true, hold: 0.5, dive, T: 2.2, stand: 0.4, after: [mx * 0.15, mz * 0.15], minY, accept });
    if (r.ok) return { mx, mz, dive, t: r.t, land: r.landed, lt: r.lt, bounce: !!r.bounce };
  }
  return null;
}

// anything that can knock us within reach soon (moving hitters, balls, timed spikes)?
function hazardNear(G, p) {
  for (const s of G.W.moving) {
    if (!s.hit) continue;
    const r = (s.br || Math.max(s.hx || 0, s.hz || 0, s.r || 0)) + 4.5;
    if (Math.abs(s.x - p.x) < r && Math.abs(s.z - p.z) < r && Math.abs(s.y - p.y) < 9) return true;
    if (s.anim.k === 'roll' && Math.abs(s.x - p.x) < 4 && s.z > p.z - 2 && s.z < p.z + 14) return true;
  }
  for (const i of G.st.spikes || []) { const s = G.W.solids[i]; if (Math.abs(s.x - p.x) < s.hx + 2.5 && Math.abs(s.z - p.z) < s.hz + 2.5) return true; }
  return false;
}
// first moving hitter that will overlap us soon
function hazard(G, p, mx, mz, lv) {
  const look = [0.12, 0.24, 0.36, 0.5], longLook = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05];
  for (const s of G.W.moving) {
    if (!s.hit || s.soft || s.gapWall || s.anim.k === 'roll') continue;
    if (Math.abs(s.x - p.x) > s.br + 7 || Math.abs(s.z - p.z) > s.br + 7) continue;
    const piston = s.anim.k === 'piston';            // punchers fire fast: look further ahead before stepping into their lane
    for (const tau of piston ? longLook : look) {
      if (!piston && tau > 0.25 + lv.skill * 0.3) break;
      pose(s, G.W.t + tau, TMP);
      const px = p.x + mx * C.RUN * tau, pz = p.z + mz * C.RUN * tau;
      const dx = px - TMP.x, dz = pz - TMP.z, lx = dx * TMP.c - dz * TMP.sn, lz = dx * TMP.sn + dz * TMP.c;
      const ex = Math.max(0, Math.abs(lx) - s.hx), ez = Math.max(0, Math.abs(lz) - s.hz);
      if (Math.hypot(ex, ez) > C.R + (piston ? 0.7 : 0.3)) continue;
      const top = TMP.y + s.hy, bot = TMP.y - s.hy;
      if (top < p.y + 0.05 || bot > p.y + C.H) continue;
      return { s, tau, low: top < p.y + 1.15, high: bot > p.y + 0.85 };
    }
  }
  return null;
}

// a rolling ball that will cross our spot within the next second (returns its x at that time)
function ballThreat(G, p) {
  for (const s of G.W.moving) {
    if (!s.anim || s.anim.k !== 'roll') continue;
    if (Math.abs(s.z - p.z) > 12 && Math.abs(s.x - p.x) > 14) continue;
    for (const tau of [0.2, 0.4, 0.6, 0.8, 1.0]) {
      pose(s, G.W.t + tau, TMP);
      const u = (((G.W.t + tau) / s.anim.P + s.anim.ph) % 1 + 1) % 1; if (u < 0.02 || u > 0.985) continue;
      const across = Math.abs(s.anim.v[0]) > Math.abs(s.anim.v[2]);
      if (across) {            // a snowball crossing the lane: is it about to cross the strip just in front of us?
        if (Math.abs(TMP.z - p.z) < s.r + 1.6 && TMP.z > p.z - 0.6 && Math.abs(TMP.x - p.x) < s.r + 2.2 + tau * 4 && Math.abs(TMP.y - s.hy - p.y) < 1.5) return { x: TMP.x, tau, across, under: Math.abs(TMP.z - p.z) < s.r + 0.5 && Math.abs(TMP.x - p.x) < s.r + 0.6 };
        continue;
      }
      if (Math.hypot(TMP.x - p.x, TMP.z - (p.z + 3.5 * tau)) < s.r + 1.1 && Math.abs(TMP.y - s.hy - p.y) < 1.5) return { x: TMP.x, tau };
    }
  }
  return null;
}

// x of the closest spot (with floor under it) that none of the balls rolling at us will pass through
function ballPocket(G, p) {
  const lanes = [];
  for (const s of G.W.moving) {
    if (!s.anim || s.anim.k !== 'roll' || Math.abs(s.anim.v[0]) > Math.abs(s.anim.v[2])) continue;
    const u = rollU(s.anim, G.W.t); if (u < 0.02 || u > 0.985) continue;
    const dz = s.z - p.z; if (dz < -s.r - 0.8 || dz > 13 || Math.abs(s.y - s.hy - p.y) > 1.5) continue;
    lanes.push({ x: s.x, w: s.r + 0.75 });
  }
  let best = null, bd = 1e9;
  for (let k = -16; k <= 16; k++) {
    const x = p.x + k * 0.25, d = Math.abs(k * 0.25);
    if (d >= bd || lanes.some((l) => Math.abs(x - l.x) < l.w)) continue;
    if (groundAt(G.W, x, p.z + 0.3, p.y - 0.7, p.y + 0.55) < 0 || groundAt(G.W, x + Math.sign(x - p.x) * 0.5, p.z + 0.3, p.y - 0.7, p.y + 0.55) < 0) continue;
    best = x; bd = d;
  }
  return best;
}

// spike strip ahead that will be up when we reach it -> 'wait'; standing on one that is about to pop -> 'go'
function spikeThreat(G, p, mx, mz, lv) {
  const W = G.W;
  for (const i of G.st.spikes) {
    const s = W.solids[i];
    if (Math.abs(s.x - p.x) > 4 || Math.abs(s.z - p.z) > 4) continue;
    const inside = Math.abs(p.x - s.x) < s.hx + C.R && Math.abs(p.z - s.z) < s.hz + C.R;
    if (inside) return 'go';
    for (let tau = 0.1; tau <= 0.55 + lv.skill * 0.15; tau += 0.1) {
      const px = p.x + mx * C.RUN * tau, pz = p.z + mz * C.RUN * tau;
      if (Math.abs(px - s.x) > s.hx + C.R + 0.1 || Math.abs(pz - s.z) > s.hz + C.R + 0.1) continue;
      if (blinkU(s, W.t + tau) <= s.blink.on || blinkU(s, W.t + tau + 0.25) <= s.blink.on) return 'wait';
    }
  }
  return null;
}
// Block Dash: line up with a gap in the next wall (or jump the low blocks) and stay near the front
function dashTarget(G, p, b, think) {
  const W = G.W, D = G.st.dash, lv = b.level;
  // the nearest wall row still in front of us (a wave can be two rows: deal with one row at a time)
  let front = 1e9;
  for (const s of W.moving) { if (s.anim?.k !== 'wave' || !active(s, W)) continue; const f = s.z - s.hz; if (s.z + s.hz > p.z - C.R && f < front) front = f; }
  const homeZ = D.cz + D.L * 0.2;
  if (front > 1e8) return { tx: b.dashX ?? p.x, tz: homeZ };
  const row = W.moving.filter((s) => s.anim?.k === 'wave' && active(s, W) && Math.abs((s.z - s.hz) - front) < 0.6);
  if (think || b.dashFront == null || Math.abs(front - b.dashFront) > 1.2) {
    const blocked = new Set(), low = new Set();
    for (const s of row) { const c = Math.round((s.x + D.HW - 1) / 2); if (s.hy > 0.6) blocked.add(c); else low.add(c); }
    let best = null, bd = 1e9;
    for (let c = 0; c < 7; c++) { if (blocked.has(c)) continue; const x = -D.HW + 1 + c * 2, d = Math.abs(x - p.x) + (low.has(c) ? 1.5 : 0) + (c === 0 || c === 6 ? 1.2 : 0) + b.rnd() * (1.5 - lv.skill); if (d < bd) { bd = d; best = x; } }
    if (best != null && (b.dashFront == null || b.rnd() > lv.mistakes * 0.4)) b.dashX = best;
  }
  b.dashFront = front;
  // jump low blocks just before they reach us
  for (const s of row) if (s.hy <= 0.6 && Math.abs(s.x - p.x) < s.hx + C.R + 0.3) {
    const gap = (s.z - s.hz) - (p.z + C.R), spd = Math.abs(s.anim.v[2]);
    if (gap > 0 && gap < 0.5 + spd * 0.16 && p.gr >= 0 && b.jumpT <= 0) jump(b, 0.45, 'dash');
  }
  return { tx: b.dashX ?? p.x, tz: Math.max(homeZ - 2, Math.min(homeZ + 2, p.z)) };
}
