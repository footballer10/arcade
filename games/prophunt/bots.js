// Bot AI (runs on the host only, inside HostSim.step). Each brain returns an intent per tick:
//   { mx, mz, sprint, jump, yaw, pitch, acts: [{a:'dis'|'rot'|'lock'|'taunt'|'tag'|'sniff', ...}] }
// HIDER bots pick a free spot where an object naturally belongs, become an object that fits there, line it up and
// lock it. They taunt now and then (risky ones get bonus points) and may panic and run when a seeker gets close.
// SEEKER bots sweep the rooms and judge everything they can see: objects in odd spots, wrong rotations, wobbling
// or moving objects and places they heard a taunt from are suspicious. Their perception noise, threshold and
// reaction time come from ctx.bots.level, so easy bots bonk the wrong things a lot and hard bots rarely do.
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
  to(p, L, x, z, y = 0, needY = false) { this.L = L; this.goal = { x, z, y, needY }; this.path = navPath(L, p.x, p.z, x, z); this.stuck = 0; this.age = 0; this.best = Infinity; this.noGain = 0; }
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
      if ((d < (g.needY ? 0.14 : 0.4)) && yOk) { this.goal = null; return null; }
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
    // raised target: jump when close
    if (last && g.needY && g.y > p.y + 0.2 && d < 1.1 && p.gr) jump = true;
    const slow = last && g.needY ? Math.min(1, d / 0.6 + 0.15) : 1;
    const l = Math.hypot(mx, mz) || 1;
    return { mx: (mx / l) * slow, mz: (mz / l) * slow, jump, yaw: Math.atan2(dx, dz) };
  }
}

export function makeBrain(id, sim, level, Brain) {
  const B = new Brain(level);
  const rnd = Math.random;
  const st = { mode: 'start', walker: new Walker(), slot: null, kind: -1, rot: 0, panicT: 0, nextTaunt: 12 + rnd() * 25, look: 0, seen: new Map(), visited: new Set(), target: null, aimT: 0, scanT: 0, checked: new Set(), sniffHint: null, room: -1, inspect: [], approach: null, chaseT: 0, pause: 0, sweep: 1, glanceT: 0, glance: null };
  const lv = level;
  const noise = { easy: 1.05, normal: 0.8, hard: 0.5 }[lv.key] ?? 0.8;
  const sharp = 0.35 + 0.65 * lv.skill;   // how well tells are noticed
  const p = () => sim.players.get(id);

  function freeSlots(L) {
    const used = new Set();
    for (const q of sim.players.values()) if (q.id !== id && q.role === 'H' && q.alive) used.add(Math.round(q.x * 4) + ',' + Math.round(q.z * 4));
    const claimed = new Set([...sim.brains.values()].map((b) => b.claim).filter(Boolean));
    return L.slots.filter((s) => s.decoy == null && s.reach && !claimed.has(s) && !used.has(Math.round(s.x * 4) + ',' + Math.round(s.z * 4)) && s.kinds.some((k) => L.present.includes(k)));
  }
  function chooseSpot(far) {
    const L = sim.level, me = p();
    const seekR = L.rooms[L.seekRoom];
    const opts = freeSlots(L).map((s) => ({ s, w: rnd() * 6 + Math.min(12, Math.hypot(s.x - seekR.x, s.z - seekR.z)) * 0.5 - (far ? Math.max(0, 10 - Math.hypot(s.x - me.x, s.z - me.z)) : Math.hypot(s.x - me.x, s.z - me.z) * 0.15) }));
    opts.sort((a, b) => b.w - a.w);
    const pick = opts[Math.floor(rnd() * Math.min(3, opts.length))]?.s;
    if (!pick) return false;
    st.slot = pick; brain.claim = pick;
    const fit = pick.kinds.filter((k) => L.present.includes(k));
    st.kind = B.mistake() && rnd() < 0.6 ? L.present[Math.floor(rnd() * L.present.length)] : fit[Math.floor(rnd() * fit.length)];
    st.rot = pick.free ? Math.round(rnd() * 8) * (Math.PI / 4) : pick.ry + (B.mistake() ? Math.PI / 4 : 0);
    st.walker.to(me, L, pick.x, pick.z, pick.y, true);
    st.mode = 'go';
    return true;
  }

  // ------------------------------------------------------------------ hider
  function hider(dt) {
    const me = p(), it = { mx: 0, mz: 0, acts: [] };
    if (!me.alive) return it;
    if (sim.phase === 'intro') { st.mode = 'start'; return it; }
    if (st.mode === 'start') { if (!chooseSpot(false)) { st.mode = 'hide-here'; } }
    if (st.mode === 'go' || st.mode === 'flee') {
      const m = st.walker.step(me, dt, rnd);
      const late = sim.phase === 'hunt' && st.mode === 'go' && sim.cfg.hunt - sim.pt > 6;
      if (!m || late) {
        // arrived (or out of time): become the object, line it up, lock
        if (!m && st.slot) { me.x = st.slot.x; me.z = st.slot.z; }
        if (me.kind !== st.kind) it.acts.push({ a: 'dis', k: st.kind, r: st.rot });
        it.acts.push({ a: 'rot', r: st.rot }, { a: 'lock', v: true });
        st.mode = 'hidden';
      } else { Object.assign(it, m); it.sprint = sim.phase === 'hunt' || st.mode === 'flee'; }
      // already disguised on the way after the hide phase starts running out (props walk around)
      if (st.mode === 'go' && sim.phase === 'hide' && sim.pt < 6 && me.kind < 0) it.acts.push({ a: 'dis', k: st.kind, r: st.rot });
      return it;
    }
    if (st.mode === 'hide-here') { const L = sim.level; const k = L.present[Math.floor(rnd() * L.present.length)]; it.acts.push({ a: 'dis', k, r: 0 }, { a: 'lock', v: true }); st.mode = 'hidden'; return it; }
    // hidden: taunt sometimes, maybe panic
    let near = Infinity, nearS = null;
    for (const q of sim.players.values()) if (q.alive && q.role === 'S') { const d = Math.hypot(q.x - me.x, q.z - me.z); if (d < near) { near = d; nearS = q; } }
    if (sim.phase === 'hunt') {
      st.nextTaunt -= dt;
      const ready = sim.t - me.lastTaunt >= R.TAUNT_CD;
      if (ready && st.nextTaunt <= 0) {
        const brave = lv.key === 'easy' ? true : lv.key === 'hard' ? near > 10 || (near > 5 && rnd() < 0.3) : near > 4;
        if (brave) it.acts.push({ a: 'taunt' });
        st.nextTaunt = 18 + rnd() * (lv.key === 'easy' ? 18 : 32);
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

  // ------------------------------------------------------------------ seeker
  function candidates(me, eye) {
    const L = sim.level, out = [];
    for (const dc of L.decoys) { const d = Math.hypot(dc.x - me.x, dc.z - me.z); if (d < 9) out.push({ key: 'd:' + dc.i, x: dc.x, y: dc.y + KINDS[dc.k].size[1] / 2, z: dc.z, d, dc }); }
    for (const q of sim.players.values()) if (q.alive && q.role === 'H') { const d = Math.hypot(q.x - me.x, q.z - me.z); if (d < 11) out.push({ key: 'h:' + q.id, x: q.x, y: q.y + (q.kind >= 0 ? KINDS[q.kind].size[1] / 2 : 0.8), z: q.z, d, q }); }
    return out.filter((c) => lineOfSight(L, eye, [c.x, c.y, c.z]));
  }
  function suspicion(c) {
    if (st.checked.has(c.key)) return -9;
    if (!st.seen.has(c.key)) st.seen.set(c.key, (rnd() + rnd() + rnd() - 1.5) * noise * 1.4);
    let s = st.seen.get(c.key);
    const L = sim.level;
    if (c.q) {
      const q = c.q;
      if (q.kind < 0) return 20;
      const sl = L.slots.reduce((b, sl) => { const d = Math.hypot(sl.x - q.x, sl.z - q.z) + Math.abs(sl.y - q.y) * 2; return d < b.d ? { d, sl } : b; }, { d: 9, sl: null });
      if (!sl.sl || sl.d > 0.45 || !sl.sl.kinds.includes(q.kind)) s += 2.6 * sharp;
      else if (!sl.sl.free && Math.abs(Math.sin((q.rot - sl.sl.ry) * 2)) > 0.2) s += 1.1 * sharp;
      if (q.moving > 0) s += c.d < 9 ? 3.5 : 1.5;
      else if (!q.locked && c.d < 5) s += 1.4 * lv.skill;
    }
    // a taunt heard nearby makes everything around that spot suspicious (fuzzier for weaker bots)
    for (const h of sim.heard || []) if (sim.t - h.t < 20) { const err = 4.2 - lv.skill * 2.4; if (Math.hypot(h.x - c.x, h.z - c.z) < err) s += 0.85 * (1 - (sim.t - h.t) / 22); }
    return s;
  }
  function seeker(dt) {
    const me = p(), it = { mx: 0, mz: 0, acts: [] };
    if (!me.alive || sim.phase !== 'hunt') { st.walker.goal = null; st.target = null; st.visited.clear(); st.checked.clear(); st.seen.clear(); return it; }
    const L = sim.level, eye = [me.x, me.y + R.EYE, me.z];
    st.walker.L = L;
    if (sim.t - me.sniffAt >= R.SNIFF_CD && rnd() < dt * 0.15 * lv.skill) it.acts.push({ a: 'sniff' });
    // think
    if (B.ready(dt)) {
      const left = sim.pt, hpFrac = me.hp / R.HP;
      let thr = 1.5 + (lv.key === 'easy' ? 0.5 : 0) + (1 - hpFrac) * 1.6 - (left < 40 ? 0.9 : 0) + (lv.key === 'hard' ? 0.2 : 0);
      if (hpFrac <= R.WRONG / R.HP + 0.01) thr += 3;
      let best = null, bs = -Infinity;
      for (const c of candidates(me, eye)) { const s = suspicion(c); if (s > bs) { bs = s; best = c; } }
      if (best && bs > thr) { if (!st.target || st.target.key !== best.key) { st.target = best; st.aimT = 0; st.chaseT = 0; st.approach = null; } }
      else if (st.target && !st.walker.goal) st.target = null;
      // heard a fresh taunt: head there
      const h = (sim.heard || []).filter((x) => sim.t - x.t < 3 && Math.hypot(x.x - me.x, x.z - me.z) < 22).pop();
      if (h && !st.target && (!st.walker.goal || st.walker.goal.heard !== h.t)) {
        const e = (1 - lv.skill) * 4;
        st.walker.to(me, L, h.x + (rnd() - 0.5) * e, h.z + (rnd() - 0.5) * e); st.walker.goal.heard = h.t; st.inspect = [];
      }
      if (!st.target && !st.walker.goal && st.pause <= 0) {
        // next room to sweep: unvisited first, nearest (prefer the sniff hint distance)
        const here = roomAt(L, me.x, me.z); st.visited.add(here);
        let rooms = L.rooms.filter((r) => !st.visited.has(r.i)); if (!rooms.length) { st.visited.clear(); st.visited.add(here); rooms = L.rooms.filter((r) => r.i !== here); }
        const hint = st.sniffHint;
        rooms.sort((a, b) => score(a) - score(b));
        function score(r) { const d = Math.hypot(r.x - me.x, r.z - me.z); return d + (hint ? Math.abs(d - hint) * 0.8 : 0) + rnd() * 4; }
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
              // stand ~1.2 m in front of the spot, toward the room center
              const vx = r.x - sl.x, vz = r.z - sl.z, l = Math.hypot(vx, vz) || 1, px = sl.x + vx / l * 1.3, pz = sl.z + vz / l * 1.3;
              if (walkable(L, px, pz)) st.inspect.push([px, pz]);
            }
          }
        }
      }
    }
    // act on target: walk up, aim, bonk
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
        if (st.aimT > lv.reaction + 0.25 && Math.abs(angDiff(want, me.yaw)) < 0.25 && sim.t - me.bonkAt > R.BONK_CD) {
          const err = lv.aimError * 0.35;
          const yw = it.yaw + (rnd() - 0.5) * err, pt = it.pitch + (rnd() - 0.5) * err;
          const dir = [Math.sin(yw) * Math.cos(pt), Math.sin(pt), Math.cos(yw) * Math.cos(pt)];
          const pk = pickTarget(L, [...sim.players.values()], eye, dir, R.REACH, id);
          it.acts.push({ a: 'tag', o: eye, d: dir, tg: pk.tg });
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
      const want = st.glance != null && st.glanceT > 0.4 ? st.glance : m.yaw;
      it.yaw = me.yaw + Math.max(-dt * 6, Math.min(dt * 6, angDiff(want, me.yaw)));
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
    onSniff(d) { st.sniffHint = d; },
    dbg: () => ({ path: st.walker.path.map((q) => q.map((v) => +v.toFixed(1))), pause: +st.pause.toFixed(1), mode: st.mode, target: st.target?.key, aimT: +st.aimT.toFixed(2), goal: st.walker.goal && [+st.walker.goal.x.toFixed(1), +st.walker.goal.z.toFixed(1)], stuck: +st.walker.stuck.toFixed(2) }),
    update(dt, s) { sim = s; const me = p(); if (!me) return null; return me.role === 'S' ? seeker(dt) : hider(dt); },
  };
  return brain;
}
void kindBox; void rayBox;
