// Bot AI (runs on the host only, inside HostSim.step). Each brain returns an intent per tick:
//   { mx, mz, sprint, jump, yaw, pitch, acts: [{a:'dis'|'rot'|'lock'|'taunt'|'tag'|'sniff', ...}] }
// HIDER bots think like a person: pick a believable spot (a free place where an object belongs, with clutter around
// so it blends in, not in the seekers' room, away from other hiders), become something that fits and doesn't
// duplicate what's right next to it, line it up and lock. They choose WHEN to taunt (safe moments, before the forced
// timer runs out) and may panic and run when a seeker stares at them.
// SEEKER bots only notice what is in their field of view, judge from afar and look closer before swinging: odd spots,
// wrong rotation, duplicates of a nearby object, wobbling or moving objects, places a taunt came from. They check
// the nearest suspect first, sweep room by room, use the sniff when unsure, get more desperate as time runs out and
// more careful after a wrong bonk. Perception noise, patience and reaction time come from ctx.bots.level.
import { KINDS } from './props.js';
import { navPath, lineOfSight, roomAt, kindBox, rayBox } from './level.js';
import { R, pickTarget } from './sim.js';

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// is (x, z) somewhere a body of radius r can stand on the floor (not inside furniture or walls)?
export function walkable(L, x, z, r = 0.4) {
  if (roomAt(L, x, z) < 0) return false;
  for (const s of L.solids) if (s.y0 < 1.0 && s.y1 > 0.3 && x + r > s.x0 && x - r < s.x1 && z + r > s.z0 && z - r < s.z1) return false;
  return true;
}

class Walker {
  constructor() { this.path = []; this.goal = null; this.stuck = 0; this.side = 0; this.age = 0; this.best = Infinity; this.noGain = 0; }
  // needY: the goal is a raised spot (hider slots) the body must actually stand on
  to(p, L, x, z, y = 0, needY = false) { this.L = L; this.goal = { x, z, y, needY }; this.reached = false; this.path = navPath(L, p.x, p.z, x, z); this.stuck = 0; this.age = 0; this.best = Infinity; this.noGain = 0; }
  // returns movement intent toward the goal (null when there or when giving up)
  step(p, dt, rnd) {
    if (!this.goal) return null;
    this.age += dt;
    while (this.path.length > 1 && Math.hypot(this.path[0][0] - p.x, this.path[0][1] - p.z) < 0.6) this.path.shift();
    const [tx, tz] = this.path[0] || [this.goal.x, this.goal.z];
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    const last = this.path.length <= 1;
    const g = this.goal;
    if (last) {
      // arrived? (close enough; height only matters for raised hiding spots)
      const yOk = !g.needY || Math.abs(p.y - g.y) < 0.15;
      if ((d < (g.needY ? 0.14 : 0.4)) && yOk) { this.goal = null; this.reached = true; return null; }
      // not getting any closer for a while (goal inside furniture, blocked): good enough / give up
      if (d < this.best - 0.05) { this.best = d; this.noGain = 0; } else this.noGain += dt;
      if (!g.needY && (this.noGain > 1.2 && d < 1.2 || this.noGain > 3)) { this.goal = null; return null; }
    }
    if (this.age > (g.needY ? 14 : 10)) { this.goal = null; return null; }
    let mx = dx / (d || 1), mz = dz / (d || 1);
    // stuck: try a jump, then a side step, then a fresh path
    const sp = Math.hypot(p.vx, p.vz);
    this.stuck = sp < 0.5 ? this.stuck + dt : Math.max(0, this.stuck - dt * 2);
    let jump = false;
    if (this.stuck > 0.35 && d > 0.3) { jump = true; if (this.stuck > 0.9) { this.side = this.side || (rnd() < 0.5 ? -1 : 1); mx += -dz / (d || 1) * this.side * 1.2; mz += dx / (d || 1) * this.side * 1.2; } }
    if (this.stuck > 2.5) { this.stuck = 0; this.side = -this.side; this.path = navPath(this.L, p.x, p.z, g.x, g.z); }
    // steer around furniture: if the straight line is blocked, take the nearest clear heading (keeping to one side)
    if (!g.needY && !(last && d < 1.2)) {
      const L = this.L, clear = (ax, az) => walkable(L, p.x + ax * 0.55, p.z + az * 0.55, 0.36) && walkable(L, p.x + ax * 1.1, p.z + az * 1.1, 0.36);
      const l0 = Math.hypot(mx, mz) || 1; let ux = mx / l0, uz = mz / l0;
      if (!clear(ux, uz)) {
        const base = Math.atan2(ux, uz), sides = this.side ? [this.side, -this.side] : [1, -1];
        let done = false;
        for (const k of [0.6, 1.2, 1.8, 2.4]) { for (const sd of sides) { const a = base + sd * k, ax = Math.sin(a), az = Math.cos(a); if (clear(ax, az)) { mx = ax; mz = az; this.side = sd; done = true; break; } } if (done) break; }
      } else if (this.side && this.stuck < 0.2) this.side = 0;
    }
    // raised target: slow down and hop up from close by, so we land on the spot instead of overshooting onto whatever is behind it
    if (last && g.needY && g.y > p.y + 0.2 && d < 1.0 && p.gr) jump = true;
    let slow = 1, precise = false;
    if (last && g.needY) { precise = d < 2.2; if (precise) slow = Math.max(0.12, Math.min(1, d / 0.75 / 4.2)); }
    const l = Math.hypot(mx, mz) || 1;
    return { mx: (mx / l) * slow, mz: (mz / l) * slow, jump, yaw: Math.atan2(dx, dz), precise };
  }
}

export function makeBrain(id, sim, level, Brain) {
  const B = new Brain(level);
  const rnd = Math.random;
  const st = { mode: 'start', walker: new Walker(), slot: null, kind: -1, rot: 0, panicT: 0, nextTaunt: 2 + rnd() * 9, bold: rnd(), look: 0, seen: new Map(), visited: new Set(), cycles: 0, target: null, aimT: 0, rechecked: false, thr: 1.5, checked: new Set(), sniffHint: null, sniffT: -99, inspect: [], curScore: 0, approach: null, chaseT: 0, pause: 0, sweep: 1, glanceT: 0, glance: null, coolT: 0, lastHp: 100, cue: 0 };
  const lv = level;
  const noise = { easy: 1.05, normal: 0.8, hard: 0.5 }[lv.key] ?? 0.8;
  const sharp = 0.35 + 0.65 * lv.skill;   // how well tells are noticed
  const p = () => sim.players.get(id);

  // ------------------------------------------------------------------ hider: where would a person hide?
  function freeSlots(L) {
    const used = new Set();
    for (const q of sim.players.values()) if (q.id !== id && q.role === 'H' && q.alive) used.add(Math.round(q.x * 4) + ',' + Math.round(q.z * 4));
    const claimed = new Set([...sim.brains.values()].map((b) => b.claim).filter(Boolean));
    return L.slots.filter((s) => s.decoy == null && s.reach && !claimed.has(s) && !used.has(Math.round(s.x * 4) + ',' + Math.round(s.z * 4)) && s.kinds.some((k) => L.present.includes(k)));
  }
  function chooseSpot(far) {
    const L = sim.level, me = p();
    const seekR = L.rooms[L.seekRoom];
    const seekers = [...sim.players.values()].filter((q) => q.role === 'S' && q.alive);
    const mates = [...sim.brains.values()].filter((b) => b !== brain && b.claim).map((b) => b.claim);
    const others = [...sim.players.values()].filter((q) => q.id !== id && q.role === 'H' && q.alive);
    const opts = freeSlots(L).map((s) => {
      let w = rnd() * 2.5;
      const dSeek = far ? Math.min(30, ...seekers.map((q) => Math.hypot(q.x - s.x, q.z - s.z))) : Math.hypot(s.x - seekR.x, s.z - seekR.z);
      w += Math.min(14, dSeek) * (far ? 0.45 : 0.3);
      if (!far && s.room === L.seekRoom) w -= 5;                                   // never right where the seekers start
      let clutter = 0; for (const d of L.decoys) if (Math.abs(d.y - s.y) < 0.6 && Math.hypot(d.x - s.x, d.z - s.z) < 3) clutter++;
      w += Math.min(6, clutter) * 0.45;                                            // blend in with clutter
      if (s.y > 0.2) w += 0.8;                                                     // on a surface among other things
      for (const m of mates) if (Math.hypot(m.x - s.x, m.z - s.z) < 3.2) w -= 3;   // spread out
      for (const q of others) if (roomAt(L, q.x, q.z) === s.room) w -= 1.2;
      if (!far) w -= Math.max(0, Math.hypot(s.x - me.x, s.z - me.z) - 18) * 0.25;  // limited time to get there
      return { s, w };
    });
    opts.sort((a, b) => b.w - a.w);
    const top = opts.slice(0, 4); const pick = top[Math.floor(rnd() * rnd() * top.length)]?.s;   // usually the best, sometimes the 2nd..4th
    if (!pick) return false;
    st.slot = pick; brain.claim = pick;
    const fit = pick.kinds.filter((k) => L.present.includes(k));
    if (B.mistake() && rnd() < 0.6) st.kind = L.present[Math.floor(rnd() * L.present.length)];   // a careless hider picks something odd
    else {
      const ko = fit.map((k) => { let w = 1 + rnd(); for (const d of L.decoys) if (d.k === k && Math.hypot(d.x - pick.x, d.z - pick.z) < 2.2) w -= 2.2; if (KINDS[k].size[1] > 1.2) w -= 0.3; return { k, w }; }).sort((a, b) => b.w - a.w);
      st.kind = ko[Math.floor(rnd() * rnd() * Math.min(2, ko.length))].k;     // avoid copying the object right next to you
    }
    st.rot = pick.free ? Math.round(rnd() * 8) * (Math.PI / 4) : pick.ry + (B.mistake() ? Math.PI / 4 : 0);
    // raised spot: first walk to a clear floor spot right next to it (nothing taller in between), then hop up slowly
    st.stage = 'climb'; st.dis = false;
    if (pick.y > 0.2) {
      const topAt = (x, z) => { let t = 0; for (const o of L.solids) if (x + 0.2 > o.x0 && x - 0.2 < o.x1 && z + 0.2 > o.z0 && z - 0.2 < o.z1 && o.y1 > t) t = o.y1; return t; };
      let bestJ = null, bd = Infinity;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU, rr = 0.8 + (i % 2) * 0.25, jx = pick.x + Math.sin(a) * rr, jz = pick.z + Math.cos(a) * rr;
        if (!walkable(L, jx, jz, 0.34)) continue;
        let ok = true; for (const f of [0.3, 0.6, 0.85]) if (topAt(pick.x + (jx - pick.x) * f, pick.z + (jz - pick.z) * f) > pick.y + 0.05) ok = false;
        if (!ok) continue;
        const dd = Math.hypot(jx - me.x, jz - me.z); if (dd < bd) { bd = dd; bestJ = [jx, jz]; }
      }
      if (bestJ) { st.stage = 'floor'; st.jumpFrom = bestJ; st.walker.to(me, L, bestJ[0], bestJ[1]); st.mode = 'go'; return true; }
    }
    st.walker.to(me, L, pick.x, pick.z, pick.y, true);
    st.mode = 'go';
    return true;
  }

  function hider(dt) {
    const me = p(), it = { mx: 0, mz: 0, acts: [] };
    if (!me.alive) return it;
    if (sim.phase === 'intro') { st.mode = 'start'; return it; }
    if (st.mode === 'start') { if (!chooseSpot(false)) { st.mode = 'hide-here'; } }
    if (st.mode === 'go' || st.mode === 'flee') {
      // become the object first (a person does, and the small body fits onto shelves and into gaps), then go to the spot
      if (!st.dis && st.kind >= 0) { st.dis = true; if (me.kind !== st.kind) it.acts.push({ a: 'dis', k: st.kind, r: st.rot }); }
      let m = st.walker.step(me, dt, rnd);
      const late = sim.phase === 'hunt' && st.mode === 'go' && sim.cfg.hunt - sim.pt > 6;
      if (!m && st.stage === 'floor' && !late) { st.stage = 'climb'; st.walker.to(me, sim.level, st.slot.x, st.slot.z, st.slot.y, true); m = st.walker.step(me, dt, rnd); }
      if (!m || late) {
        // arrived (or out of time): become the object, line it up, lock
        st.why = late ? 'late' : st.walker.reached ? 'reached' : 'gaveup';
        if (!me.gr && !late) return it;                                  // finish the hop first, never lock in mid-air
        // close to the chosen spot: settle exactly onto it; if time ran out far away, just stay where we are
        if (st.slot && Math.hypot(st.slot.x - me.x, st.slot.z - me.z) < 2.5) {
          let top = 0; for (const o of sim.level.solids) if (st.slot.x + 0.1 > o.x0 && st.slot.x - 0.1 < o.x1 && st.slot.z + 0.1 > o.z0 && st.slot.z - 0.1 < o.z1 && o.y1 <= st.slot.y + 0.3 && o.y1 > top) top = o.y1;
          me.x = st.slot.x; me.z = st.slot.z; me.y = Math.max(top, st.slot.y); me.vx = me.vz = me.vy = 0; me.gr = true;   // stand ON the surface, not inside it
        }
        if (me.kind !== st.kind) it.acts.push({ a: 'dis', k: st.kind, r: st.rot });
        it.acts.push({ a: 'rot', r: st.rot }, { a: 'lock', v: true });
        st.mode = 'hidden';
      } else { Object.assign(it, m); it.sprint = !m.precise; }
      // already disguised on the way after the hide phase starts running out (props walk around)
      if (st.mode === 'go' && sim.phase === 'hide' && sim.pt < 6 && me.kind < 0) it.acts.push({ a: 'dis', k: st.kind, r: st.rot });
      return it;
    }
    if (st.mode === 'hide-here') { const L = sim.level; const k = L.present[Math.floor(rnd() * L.present.length)]; it.acts.push({ a: 'dis', k, r: 0 }, { a: 'lock', v: true }); st.mode = 'hidden'; return it; }
    // hidden: pick the moment to taunt, maybe panic
    let near = Infinity, nearS = null;
    for (const q of sim.players.values()) if (q.alive && q.role === 'S') { const d = Math.hypot(q.x - me.x, q.z - me.z); if (d < near) { near = d; nearS = q; } }
    if (sim.phase === 'hunt') {
      st.nextTaunt -= dt;
      const ready = sim.t - me.lastTaunt >= R.TAUNT_CD;
      if (ready) {
        const sameRoom = nearS && roomAt(sim.level, nearS.x, nearS.z) === roomAt(sim.level, me.x, me.z);
        const safe = near > 9 && !sameRoom;
        // a seeker who is close but looking away is a dare worth taking (bold players only)
        const dare = st.bold > 0.7 && near > 3.5 && near < 7 && nearS && Math.cos(angDiff(Math.atan2(me.x - nearS.x, me.z - nearS.z), nearS.yaw)) < 0.2;
        const want = lv.key === 'easy' ? st.nextTaunt <= 0 : (safe && st.nextTaunt <= 0) || (dare && st.nextTaunt <= 0);
        // the forced-taunt clock is about to run out: choose the least bad moment instead of being forced mid-stare
        const urgent = me.fz < 9 && (near > 5 || me.fz < 2.5);
        if (want || urgent) { it.acts.push({ a: 'taunt' }); st.nextTaunt = (lv.key === 'easy' ? 10 : 14) + rnd() * 20; }
      }
      if (nearS && near < 2.3 && me.locked) {
        const facing = Math.cos(angDiff(Math.atan2(me.x - nearS.x, me.z - nearS.z), nearS.yaw)) > 0.85;
        st.panicT += dt;
        if (facing && st.panicT > 1.2 && rnd() < dt * (0.25 + (1 - lv.skill) * 0.6)) {
          it.acts.push({ a: 'lock', v: false });
          brain.claim = null; if (chooseSpot(true)) st.mode = 'flee';
        }
      } else st.panicT = 0;
    }
    return it;
  }

  // ------------------------------------------------------------------ seeker: what does a person notice?
  const FOV = 1.15;                                          // half field of view (rad): you only notice what you face
  const bandOf = (d) => (d > 7 ? 2 : d > 3.5 ? 1 : 0);        // 0 close, 1 medium, 2 far: closer = clearer
  const BAND_NOISE = [0.3, 0.6, 1.0];
  function candidates(me, eye) {
    const L = sim.level, out = [];
    const seesAt = (x, z) => { const d = Math.hypot(x - me.x, z - me.z); return d < 1.4 || Math.abs(angDiff(Math.atan2(x - me.x, z - me.z), me.yaw)) < FOV; };
    for (const dc of L.decoys) { const d = Math.hypot(dc.x - me.x, dc.z - me.z); if (d < 9 && seesAt(dc.x, dc.z)) out.push({ key: 'd:' + dc.i, x: dc.x, y: dc.y + KINDS[dc.k].size[1] / 2, z: dc.z, d, dc }); }
    for (const q of sim.players.values()) if (q.alive && q.role === 'H') { const d = Math.hypot(q.x - me.x, q.z - me.z); if (d < 11 && seesAt(q.x, q.z)) out.push({ key: 'h:' + q.id, x: q.x, y: q.y + (q.kind >= 0 ? KINDS[q.kind].size[1] / 2 : 0.8), z: q.z, d, q }); }
    return out.filter((c) => lineOfSight(L, eye, [c.x, c.y, c.z]));
  }
  // two of the same thing right next to each other looks off (people notice "why are there two lamps here?")
  function dupNear(L, k, x, y, z, skip) {
    for (const d of L.decoys) if (d.i !== skip && d.k === k && Math.hypot(d.x - x, d.z - z) < 1.7 && Math.abs(d.y - y) < 0.6) return true;
    for (const q of sim.players.values()) if (q.alive && q.role === 'H' && q.kind === k && Math.hypot(q.x - x, q.z - z) < 1.7 && Math.abs(q.y - y) < 0.6 && !(Math.abs(q.x - x) < 0.01 && Math.abs(q.z - z) < 0.01)) return true;
    return false;
  }
  function suspicion(c) {
    if (st.checked.has(c.key)) return -9;
    const b = bandOf(c.d), nk = c.key + '|' + b;
    if (!st.seen.has(nk)) st.seen.set(nk, (rnd() + rnd() + rnd() - 1.5) * noise * 1.4 * BAND_NOISE[b]);
    let s = st.seen.get(nk);
    const vis = b === 2 ? 0.55 : 1;                               // tells are hard to spot from far away
    const L = sim.level;
    if (c.q) {
      const q = c.q;
      if (q.kind < 0) return 20;                                  // a bean standing around: obviously a player
      const sl = L.slots.reduce((bb, sl2) => { const d = Math.hypot(sl2.x - q.x, sl2.z - q.z) + Math.abs(sl2.y - q.y) * 2; return d < bb.d ? { d, sl: sl2 } : bb; }, { d: 9, sl: null });
      if (!sl.sl || sl.d > 0.45 || !sl.sl.kinds.includes(q.kind)) s += 2.6 * sharp * vis;    // not where this belongs
      else if (!sl.sl.free && Math.abs(Math.sin((q.rot - sl.sl.ry) * 2)) > 0.2) s += 1.1 * sharp * vis;   // crooked
      if (dupNear(L, q.kind, q.x, q.y, q.z, -1)) s += 0.9 * sharp * vis;
      if (q.moving > 0) s += c.d < 9 ? 3.5 : 1.5;                 // things that move are not furniture
      else if (!q.locked && c.d < 5) s += 1.4 * lv.skill;          // wobbling
    } else if (dupNear(L, c.dc.k, c.dc.x, c.dc.y, c.dc.z, c.dc.i)) s += 0.9 * sharp * vis;
    // a taunt heard nearby makes everything around that spot worth a look (the radius is fuzzier for weaker bots)
    let cue = 0;
    for (const h of sim.heard || []) if (sim.t - h.t < 20) { const err = 3.4 - lv.skill * 2.2, dd = Math.hypot(h.x - c.x, h.z - c.z); if (dd < err) cue = Math.max(cue, 1.55 * (1 - (sim.t - h.t) / 24) * (1 - 0.4 * dd / err)); }
    st.cue = cue;
    return s + cue;
  }
  function seeker(dt) {
    const me = p(), it = { mx: 0, mz: 0, acts: [] };
    if (!me.alive || sim.phase !== 'hunt') { st.walker.goal = null; st.target = null; st.visited.clear(); st.checked.clear(); st.seen.clear(); st.cycles = 0; st.lastHp = me.hp; st.inspect = []; return it; }
    const L = sim.level, eye = [me.x, me.y + R.EYE, me.z];
    st.walker.L = L;
    st.visited.add(roomAt(L, me.x, me.z));            // any room I've been in counts as looked at
    st.coolT = Math.max(0, st.coolT - dt);
    // react to what just happened: wrong bonk = embarrassed pause and more careful; find = quick cheer
    if (me.hp < st.lastHp) { st.coolT = 1.0 + rnd() * 0.8; st.pause = Math.max(st.pause, 0.6); st.target = null; st.walker.goal = null; }
    else if (me.hp > st.lastHp) { st.coolT = 0.6; st.pause = Math.max(st.pause, 0.5); st.target = null; }
    st.lastHp = me.hp;
    // unsure what to do and the sniff is ready: use it (only when standing around, not mid-chase)
    if (!st.target && !st.walker.goal && sim.t - me.sniffAt >= R.SNIFF_CD && sim.pt < sim.cfg.hunt - 6 && rnd() < dt * (0.4 + lv.skill)) it.acts.push({ a: 'sniff' });
    // think
    if (B.ready(dt)) {
      const hpFrac = me.hp / R.HP, elapsed = Math.max(0, Math.min(1, 1 - sim.pt / sim.cfg.hunt));
      // approach threshold: starts careful, relaxes as time runs out and after sweeping the whole map, tightens after getting hurt
      let thr = 1.35 + (lv.key === 'easy' ? 0.4 : 0) + (1 - hpFrac) * 1.4 - elapsed * 0.8 - st.cycles * 0.2 - (sim.pt < 30 ? 0.5 : 0) + (lv.key === 'hard' ? 0.15 : 0);
      if (hpFrac <= R.WRONG / R.HP + 0.01) thr += 3;
      st.thr = thr;
      let best = null, bs = -Infinity, bv = -Infinity;
      for (const c of candidates(me, eye)) { const sc = suspicion(c); const v = sc - c.d * 0.06; if (v > bv) { bv = v; bs = sc; best = c; } }   // among equals check the nearest first
      // commit to a suspect until it's been checked; only drop it for something clearly more suspicious
      const cur = st.target && !st.checked.has(st.target.key) ? st.target : null;
      if (cur && best && best.key !== cur.key && !(bs > st.curScore + 1.0)) best = null;
      if (cur && best == null) { /* keep going to the current suspect */ }
      else if (st.coolT <= 0 && best && bs > thr) { if (!cur || cur.key !== best.key) { st.target = best; st.curScore = bs; st.aimT = 0; st.chaseT = 0; st.approach = null; st.rechecked = false; } }
      else if (st.target && !st.walker.goal) st.target = null;
      // heard a fresh taunt: head there
      const h = (sim.heard || []).filter((x) => sim.t - x.t < 3 && Math.hypot(x.x - me.x, x.z - me.z) < 22).pop();
      if (h && !st.target && (!st.walker.goal || st.walker.goal.heard !== h.t)) {
        const e = (1 - lv.skill) * 4;
        st.walker.to(me, L, h.x + (rnd() - 0.5) * e, h.z + (rnd() - 0.5) * e); st.walker.goal.heard = h.t; st.inspect = []; st.pause = 0;
      }
      if (!st.target && !st.walker.goal && st.pause <= 0) {
        // next room to sweep: unvisited first; the sniff hint says roughly how far the nearest hider is
        const here = roomAt(L, me.x, me.z); st.visited.add(here);
        let rooms = L.rooms.filter((r) => !st.visited.has(r.i)); if (!rooms.length) { st.visited.clear(); st.visited.add(here); st.cycles++; rooms = L.rooms.filter((r) => r.i !== here); }
        const hint = sim.t - st.sniffT < 15 ? st.sniffHint : null;
        const score = (r) => { const d = Math.hypot(r.x - me.x, r.z - me.z); return d + (hint != null ? Math.abs(d - hint) * 0.8 : 0) + rnd() * 2; };
        rooms.sort((a, b) => score(a) - score(b));
        // inside the current room: visit a couple of spots next to furniture first (like a person checking around)
        if (st.inspect.length) { const q = st.inspect.shift(); st.walker.to(me, L, q[0], q[1]); }
        else {
          const r = rooms[0];
          if (r) {
            st.walker.to(me, L, r.x, r.z);
            const near = L.slots.filter((sl) => sl.room === r.i && Math.hypot(sl.x - r.x, sl.z - r.z) > 1.5);
            st.inspect = [];
            for (let i = 0; i < 2 + Math.floor(rnd() * 2) && near.length; i++) {
              const sl = near.splice(Math.floor(rnd() * near.length), 1)[0];
              // stand ~1.3 m in front of the spot, toward the room center
              const vx = r.x - sl.x, vz = r.z - sl.z, l = Math.hypot(vx, vz) || 1, px = sl.x + vx / l * 1.3, pz = sl.z + vz / l * 1.3;
              if (walkable(L, px, pz)) st.inspect.push([px, pz]);
            }
          }
        }
      }
    }
    // act on a suspect: walk up, look it over, decide, bonk
    if (st.target) {
      const t = st.target;
      const live = t.q ? (t.q.alive ? t.q : null) : t;
      if (!live) { st.target = null; return it; }
      const tx = t.q ? t.q.x : t.x, tz = t.q ? t.q.z : t.z, ty = t.q ? t.q.y + (t.q.kind >= 0 ? KINDS[t.q.kind].size[1] / 2 : 0.8) : t.y;
      const d = Math.hypot(tx - me.x, tz - me.z);
      const want = Math.atan2(tx - me.x, tz - me.z), wantP = Math.atan2(ty - eye[1], Math.max(0.1, d));
      it.yaw = me.yaw + angDiff(want, me.yaw) * Math.min(1, dt * 8); it.pitch = me.pitch + (wantP - me.pitch) * Math.min(1, dt * 8);
      if (d > R.REACH - 0.8) {
        st.chaseT += dt;
        // walk to a free spot near the target that can see it (not into the shelf / counter it sits on)
        if (!st.approach || Math.hypot(st.approach[2] - tx, st.approach[3] - tz) > 1.0 || !st.walker.goal) {
          let bestP = null, bd = Infinity;
          for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, rr = 1.3 + (i % 2) * 0.5, px = tx + Math.sin(a) * rr, pz = tz + Math.cos(a) * rr;
            if (!walkable(L, px, pz) || !lineOfSight(L, [px, 1.45, pz], [tx, ty, tz])) continue; const dd = Math.hypot(px - me.x, pz - me.z); if (dd < bd) { bd = dd; bestP = [px, pz]; } }
          const ap = bestP || [tx, tz]; st.approach = [ap[0], ap[1], tx, tz]; st.walker.to(me, L, ap[0], ap[1]);
        }
        const m = st.walker.step(me, dt, rnd); if (m) { it.mx = m.mx; it.mz = m.mz; it.jump = m.jump; it.sprint = t.q?.moving > 0 || st.chaseT > 2; }
        // can't get there: let it go for now (a person would give up and look elsewhere)
        if (st.chaseT > 9) { st.checked.add(t.key); st.target = null; st.approach = null; st.walker.goal = null; }
      } else {
        st.walker.goal = null;
        st.aimT += dt;
        if (st.aimT > lv.reaction + 0.45 && Math.abs(angDiff(want, me.yaw)) < 0.25 && sim.t - me.bonkAt > R.BONK_CD) {
          // up close the picture is clearer: decide again. Not sure after a good look = it's real, move on (impatient/careless players swing anyway)
          if (!st.rechecked) {
            st.rechecked = true;
            const s2 = suspicion({ ...t, d });
            if (!(s2 > st.thr + (st.cue > 0.7 ? 0 : 0.7) || B.mistake())) { st.checked.add(t.key); st.target = null; st.pause = 0.3 + rnd() * 0.5; return it; }
          }
          const err = lv.aimError * 0.35;
          const yw = it.yaw + (rnd() - 0.5) * err, pt = it.pitch + (rnd() - 0.5) * err;
          const dir = [Math.sin(yw) * Math.cos(pt), Math.sin(pt), Math.cos(yw) * Math.cos(pt)];
          const pk = pickTarget(L, [...sim.players.values()], eye, dir, R.REACH, id);
          it.acts.push({ a: 'tag', o: eye, d: dir, tg: pk.tg });
          if (pk.tg && pk.tg !== t.key && pk.tg.startsWith('d:')) st.checked.add(pk.tg);    // bonked the wrong thing: now we know it's real
          if (pk.tg === t.key || st.aimT > 3) { st.checked.add(t.key); st.target = null; }
        }
      }
      return it;
    }
    const m = st.walker.step(me, dt, rnd);
    st.look += dt;
    if (m) {
      st.pause = 0.5 + rnd() * 0.9; st.sweep = rnd() < 0.5 ? -1 : 1;
      it.mx = m.mx; it.mz = m.mz; it.jump = m.jump;
      // glance at things on the way (head turns toward a random nearby object every so often)
      st.glanceT -= dt;
      if (st.glanceT <= 0) { st.glanceT = 0.8 + rnd() * 1.6; const c = L.decoys[Math.floor(rnd() * L.decoys.length)]; st.glance = c && Math.hypot(c.x - me.x, c.z - me.z) < 6 ? Math.atan2(c.x - me.x, c.z - me.z) : null; }
      const wantY = st.glance != null && st.glanceT > 0.4 ? st.glance : m.yaw;
      it.yaw = me.yaw + Math.max(-dt * 6, Math.min(dt * 6, angDiff(wantY, me.yaw)));
      it.pitch = me.pitch + ((st.glance != null ? -0.3 : -0.12) - me.pitch) * Math.min(1, dt * 4);
    } else {
      // arrived: stop for a moment and sweep the view left and right, then move on
      st.pause -= dt;
      it.yaw = me.yaw + st.sweep * dt * 1.6; if (rnd() < dt * 0.8) st.sweep = -st.sweep;
      it.pitch = Math.sin(st.look * 1.3) * 0.2 - 0.25;
      if (st.pause > 0) st.walker.goal = null;
    }
    return it;
  }

  const brain = {
    claim: null,
    onSniff(d) { st.sniffHint = d; st.sniffT = sim.t; },
    dbg: () => ({ why: st.why, slot: st.slot && [+st.slot.x.toFixed(2), st.slot.y, +st.slot.z.toFixed(2)], stage: st.stage, path: st.walker.path.map((q) => q.map((v) => +v.toFixed(1))), pause: +st.pause.toFixed(1), mode: st.mode, target: st.target?.key, aimT: +st.aimT.toFixed(2), thr: +st.thr.toFixed(2), goal: st.walker.goal && [+st.walker.goal.x.toFixed(1), +st.walker.goal.z.toFixed(1)], stuck: +st.walker.stuck.toFixed(2) }),
    update(dt, s) { sim = s; const me = p(); if (!me) return null; return me.role === 'S' ? seeker(dt) : hider(dt); },
  };
  return brain;
}
void kindBox; void rayBox;
