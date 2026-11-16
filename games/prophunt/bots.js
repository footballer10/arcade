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

class Walker {
  constructor() { this.path = []; this.goal = null; this.stuck = 0; this.lastD = 0; this.side = 0; }
  to(p, L, x, z, y = 0) { this.goal = { x, z, y }; this.path = navPath(L, p.x, p.z, x, z); this.stuck = 0; }
  // returns movement intent toward the goal (null when there)
  step(p, dt, rnd) {
    if (!this.goal) return null;
    while (this.path.length > 1 && Math.hypot(this.path[0][0] - p.x, this.path[0][1] - p.z) < 0.6) this.path.shift();
    const [tx, tz] = this.path[0] || [this.goal.x, this.goal.z];
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    const last = this.path.length <= 1;
    if (last && d < 0.12 && Math.abs(p.y - this.goal.y) < 0.15) { this.goal = null; return null; }
    let mx = dx / (d || 1), mz = dz / (d || 1);
    // stuck: try a side step and a jump
    const sp = Math.hypot(p.vx, p.vz);
    this.stuck = sp < 0.5 && d > 0.3 ? this.stuck + dt : Math.max(0, this.stuck - dt * 2);
    let jump = false;
    if (this.stuck > 0.35) { jump = true; if (this.stuck > 0.9) { this.side = this.side || (rnd() < 0.5 ? -1 : 1); mx += -dz / (d || 1) * this.side * 1.2; mz += dx / (d || 1) * this.side * 1.2; } }
    if (this.stuck > 2.5) { this.stuck = 0; this.side = -this.side; this.path = navPath({ ...this.L }, p.x, p.z, this.goal.x, this.goal.z); }
    // target on a surface: jump when close
    if (last && this.goal.y > p.y + 0.2 && d < 1.1 && p.gr) jump = true;
    const slow = last ? Math.min(1, d / 0.6 + 0.15) : 1;
    const l = Math.hypot(mx, mz) || 1;
    return { mx: (mx / l) * slow, mz: (mz / l) * slow, jump, yaw: Math.atan2(dx, dz) };
  }
}

export function makeBrain(id, sim, level, Brain) {
  const B = new Brain(level);
  const rnd = Math.random;
  const st = { mode: 'start', walker: new Walker(), slot: null, kind: -1, rot: 0, panicT: 0, nextTaunt: 12 + rnd() * 25, look: 0, seen: new Map(), visited: new Set(), target: null, aimT: 0, scanT: 0, checked: new Set(), sniffHint: null, room: -1 };
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
    st.walker.L = L; st.walker.to(me, L, pick.x, pick.z, pick.y);
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
      if (best && bs > thr) { if (!st.target || st.target.key !== best.key) { st.target = best; st.aimT = 0; } }
      else if (st.target && !st.walker.goal) st.target = null;
      // heard a fresh taunt: head there
      const h = (sim.heard || []).filter((x) => sim.t - x.t < 3 && Math.hypot(x.x - me.x, x.z - me.z) < 22).pop();
      if (h && !st.target && (!st.walker.goal || st.walker.goal.heard !== h.t)) {
        const e = (1 - lv.skill) * 4;
        st.walker.to(me, L, h.x + (rnd() - 0.5) * e, h.z + (rnd() - 0.5) * e); st.walker.goal.heard = h.t;
      }
      if (!st.target && !st.walker.goal) {
        // next room to sweep: unvisited first, nearest (prefer the sniff hint distance)
        const here = roomAt(L, me.x, me.z); st.visited.add(here);
        let rooms = L.rooms.filter((r) => !st.visited.has(r.i)); if (!rooms.length) { st.visited.clear(); st.visited.add(here); rooms = L.rooms.filter((r) => r.i !== here); }
        const hint = st.sniffHint;
        rooms.sort((a, b) => score(a) - score(b));
        function score(r) { const d = Math.hypot(r.x - me.x, r.z - me.z); return d + (hint ? Math.abs(d - hint) * 0.8 : 0) + rnd() * 4; }
        const r = rooms[0];
        if (r) { const a = rnd() * TAU, k = 1 + rnd() * 2; st.walker.to(me, L, r.x + Math.sin(a) * k, r.z + Math.cos(a) * k); }
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
        if (!st.walker.goal || Math.hypot(st.walker.goal.x - tx, st.walker.goal.z - tz) > 1.5) st.walker.to(me, L, tx, tz);
        const m = st.walker.step(me, dt, rnd); if (m) { it.mx = m.mx; it.mz = m.mz; it.jump = m.jump; it.sprint = t.q?.moving > 0; }
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
    if (m) { it.mx = m.mx; it.mz = m.mz; it.jump = m.jump; it.yaw = me.yaw + angDiff(m.yaw, me.yaw) * Math.min(1, dt * 5); }
    // look around a bit
    st.look += dt; it.pitch = Math.sin(st.look * 0.9) * 0.25 - 0.15;
    if (!m) it.yaw = me.yaw + dt * 1.4;
    return it;
  }

  const brain = {
    claim: null,
    onSniff(d) { st.sniffHint = d; },
    update(dt, s) { sim = s; const me = p(); if (!me) return null; return me.role === 'S' ? seeker(dt) : hider(dt); },
  };
  return brain;
}
void kindBox; void rayBox;
