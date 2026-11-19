// Prop Hunt match rules. The HOST runs HostSim at 60 Hz (rounds, roles, timers, scoring, bonks, taunts, bots);
// everyone else only renders snapshots. Players move themselves (clients are authoritative for their own body,
// with sanity checks) because there is no player-vs-player physics: what matters is decided here.
import { KINDS } from './props.js';
import { stepBody, bodySize, kindBox, rayBox, rayWorld, roomAt, BEAN, PHYS } from './level.js';

export const T = { INTRO: 4, HIDE: 20, POST: 7, HUNT: { short: 100, normal: 155, long: 215 } };
export const R = {
  HP: 100, WRONG: 10, FIND_HP: 20, REACH: 3.1, BONK_CD: 0.55, EYE: 1.45,
  FIND: 15, SWEEP: 10, SURVIVE: 10, SURV_EVERY: 5, TAUNT: 3, DARING: 5, DARING_R: 7, TAUNT_CD: 10,
  FORCE_EVERY: 45, FORCED_WARN: 5,   // a hider who stays silent this long is forced to taunt; any taunt resets the clock
  SNIFF_CD: 22, SNIFF_T: 4,          // sniff cooldown, and how long its hot/cold result stays on screen
  SPEED: { H: 4.2, S: 4.4 }, SPRINT: 1.5,
  PROP_MOVE: 0.55,   // while the seekers hunt, a disguised hider shuffles at this fraction of walking speed (and can't sprint): running away as a prop is slow
};
// how fast a body may move right now: props are slow (and can't sprint) once the hunt has started
export function moveSpeed(p, phase, sprint) {
  if (p.role === 'H' && p.kind >= 0 && phase === 'hunt') return R.SPEED.H * R.PROP_MOVE;
  return R.SPEED[p.role] * (sprint ? R.SPRINT : 1);
}
export const TAUNTS = ['kazoo', 'quack', 'honk', 'slide', 'boing', 'cuckoo'];

// Round plan, identical on every client: role rotation so everyone seeks at least once, and a map per round.
export function makePlan(rng, ids, opt, mapIds) {
  const N = ids.length;
  const S = opt.seekers === 'auto' || !opt.seekers ? (N <= 3 ? 1 : N <= 6 ? 2 : 3) : Math.max(1, Math.min(N - 1, +opt.seekers));
  const order = rng.shuffle([...ids]);
  const rounds = Math.ceil(N / S);
  const maps = opt.map && opt.map !== 'mix' && mapIds.includes(opt.map) ? Array(rounds).fill(opt.map) : (() => { const m = rng.shuffle([...mapIds]); return Array.from({ length: rounds }, (_, i) => m[i % m.length]); })();
  const plan = [];
  for (let k = 0; k < rounds; k++) {
    const seekers = [];
    for (let j = 0; j < S; j++) seekers.push(order[(k * S + j) % N]);
    plan.push({ seekers: [...new Set(seekers)], map: maps[k] });
  }
  return plan;
}

export function standingsOf(ids, score) {
  const sorted = [...ids].sort((a, b) => (score[b] || 0) - (score[a] || 0));
  const g = [];
  for (const id of sorted) { const last = g[g.length - 1]; if (last && (score[last[0]] || 0) === (score[id] || 0)) last.push(id); else g.push([id]); }
  return g;
}

const newP = (id) => ({ id, role: 'H', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, gr: true, yaw: 0, pitch: 0, kind: -1, rot: 0, locked: false, alive: true, hp: R.HP, ep: 0, moving: 0, lastTaunt: -99, fz: R.FORCE_EVERY, bonkAt: -9, sniffAt: -99, sAcc: 0, r: BEAN.r, h: BEAN.h });

// snapshot row: [id, x, y, z, yaw, pitch, kind, rot, flags, hp, ep]
export function rowOf(p) {
  return [p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), +p.pitch.toFixed(2), p.kind, +p.rot.toFixed(2), (p.locked ? 1 : 0) | (p.alive ? 2 : 0) | (p.role === 'S' ? 4 : 0) | (p.moving > 0 ? 8 : 0), Math.round(p.hp), p.ep];
}
export function applyRow(p, r) {
  p.x = r[1]; p.y = r[2]; p.z = r[3]; p.yaw = r[4]; p.pitch = r[5]; p.kind = r[6]; p.rot = r[7];
  p.locked = !!(r[8] & 1); p.alive = !!(r[8] & 2); p.role = r[8] & 4 ? 'S' : 'H'; p.moving = r[8] & 8 ? 1 : 0; p.hp = r[9]; p.ep = r[10];
}

export class HostSim {
  // cfg: { ids, isBot(id), connected(id), plan, levelFor(k), hunt, ev(type, data), makeBrain(id) }
  constructor(cfg) {
    this.cfg = cfg; this.ids = cfg.ids;
    this.players = new Map(cfg.ids.map((id) => [id, newP(id)]));
    this.score = Object.fromEntries(cfg.ids.map((id) => [id, 0]));
    this.stats = Object.fromEntries(cfg.ids.map((id) => [id, { finds: 0, taunts: 0, surv: 0, wrong: 0 }]));
    this.round = -1; this.phase = 'wait'; this.pt = 0; this.t = 0; this.done = false;
    this.brains = new Map();
    this.timeScale = 1;
  }
  get level() { return this.cfg.levelFor(this.round); }
  go() { if (this.phase === 'wait') this.startRound(0); }
  startRound(k) {
    this.round = k; const L = this.cfg.levelFor(k), plan = this.cfg.plan[k];
    const seekers = new Set(plan.seekers);
    let si = 0, hi = 0;
    for (const p of this.players.values()) {
      Object.assign(p, { role: seekers.has(p.id) ? 'S' : 'H', kind: -1, rot: 0, locked: false, alive: true, hp: R.HP, vx: 0, vy: 0, vz: 0, gr: true, moving: 0, lastTaunt: -99, bonkAt: -9, sniffAt: -99, sAcc: 0, ...BEAN });
      const [x, z] = p.role === 'S' ? L.seekerSpawn(si++) : L.hiderSpawn(hi++);
      p.x = x; p.z = z; p.y = 0; p.ep++;
      const rc = L.rooms[Math.max(0, roomAt(L, x, z))];
      p.yaw = Math.atan2(x - rc.x, z - rc.z) || 0; p.pitch = 0;
      if (!this.cfg.connected(p.id) && !this.cfg.isBot(p.id)) p.alive = false;
    }
    this.brains.clear();
    for (const id of this.ids) if (this.cfg.isBot(id)) this.brains.set(id, this.cfg.makeBrain(id, this));
    this.setPhase('intro', T.INTRO);
    this.lastProp = null; this.hidersAtStart = this.alive('H');
    this.mult = this.cfg.plan.length > 1 && k === this.cfg.plan.length - 1 ? 2 : 1;   // final round: double points (comeback)
    this.cfg.ev('round', { r: k, mult: this.mult });
  }
  add(id, pts) { this.score[id] = (this.score[id] || 0) + pts * (this.mult || 1); }
  setPhase(ph, dur) { this.phase = ph; this.pt = dur; }
  alive(role) { let n = 0; for (const p of this.players.values()) if (p.alive && p.role === role) n++; return n; }
  canMove(p) { return p.alive && (this.phase === 'hunt' || (this.phase === 'hide' && p.role === 'H')); }

  step(dt0) {
    if (this.done || this.phase === 'wait') return;
    const dt = dt0 * this.timeScale;
    this.t += dt; this.pt -= dt;
    const L = this.level;
    // players who left: out of this round
    for (const p of this.players.values()) if (p.alive && !this.cfg.isBot(p.id) && !this.cfg.connected(p.id)) { p.alive = false; this.cfg.ev('left', { id: p.id }); }
    // bots
    for (const [id, b] of this.brains) {
      const p = this.players.get(id);
      const it = b.update(dt0, this);
      if (!it) continue;
      if (this.canMove(p) && !p.locked) {
        const land = stepBody(p, { mx: it.mx, mz: it.mz, speed: moveSpeed(p, this.phase, !!it.sprint), jump: it.jump, jumpV: p.kind >= 0 ? PHYS.PROP_JUMP : PHYS.JUMP }, dt0, L);
        p.moving = Math.hypot(p.vx, p.vz) > 0.4 ? 0.3 : Math.max(0, p.moving - dt0);
        void land;
      } else { p.vx = p.vz = 0; p.moving = Math.max(0, p.moving - dt0); }
      if (it.yaw != null) p.yaw = it.yaw; if (it.pitch != null) p.pitch = it.pitch;
      for (const a of it.acts || []) this.act(id, a);
    }
    for (const p of this.players.values()) if (!this.brains.has(p.id)) p.moving = Math.max(0, p.moving - dt);
    switch (this.phase) {
      case 'intro': if (this.pt <= 0) { this.setPhase('hide', T.HIDE); this.cfg.ev('phase', { ph: 'hide' }); } break;
      case 'hide': if (this.pt <= 0) { this.setPhase('hunt', this.cfg.hunt); for (const p of this.players.values()) p.fz = R.FORCE_EVERY; this.cfg.ev('phase', { ph: 'hunt' }); } break;
      case 'hunt': {
        for (const p of this.players.values()) if (p.alive && p.role === 'H') {
          p.sAcc += dt * (p.id === this.lastProp ? 2 : 1); this.stats[p.id].surv += dt;
          while (p.sAcc >= R.SURV_EVERY) { p.sAcc -= R.SURV_EVERY; this.add(p.id, 1); }
        }
        // forced taunts: each hider has their own clock that any taunt (forced or chosen) resets
        for (const p of this.players.values()) if (p.alive && p.role === 'H') {
          const before = p.fz; p.fz -= dt;
          if (before > R.FORCED_WARN && p.fz <= R.FORCED_WARN) this.cfg.ev('fwarn', { id: p.id, in: R.FORCED_WARN });
          if (p.fz <= 0) this.taunt(p, true);
        }
        if (!this.lastProp && this.hidersAtStart >= 2 && this.alive('H') === 1) { this.lastProp = [...this.players.values()].find((p) => p.alive && p.role === 'H').id; this.cfg.ev('lastprop', { id: this.lastProp }); }
        if (this.alive('H') === 0) this.endRound('S');
        else if (this.alive('S') === 0) this.endRound('H');
        else if (this.pt <= 0) this.endRound('H');
        break;
      }
      case 'post':
        if (this.pt <= 0) { if (this.round + 1 < this.cfg.plan.length) this.startRound(this.round + 1); else { this.done = true; this.cfg.ev('done', {}); } }
        break;
    }
  }
  endRound(winner) {
    const surv = [];
    for (const p of this.players.values()) {
      if (p.role === 'H' && p.alive) { this.add(p.id, R.SURVIVE * (p.id === this.lastProp ? 2 : 1)); surv.push(p.id); if (this.alive('S') === 0) this.add(p.id, Math.floor(Math.max(0, this.pt) / R.SURV_EVERY)); }
      if (p.role === 'S' && winner === 'S' && this.cfg.connected(p.id) || (p.role === 'S' && winner === 'S' && this.cfg.isBot(p.id))) this.add(p.id, R.SWEEP);
      p.locked = p.locked && p.alive;
    }
    this.setPhase('post', T.POST);
    this.cfg.ev('roundEnd', { r: this.round, winner, surv, last: this.round + 1 >= this.cfg.plan.length });
  }

  // ---------------------------------------------------------------- actions (from clients, bots and the host's own player)
  act(id, a) {
    const p = this.players.get(id); if (!p || !a) return;
    switch (a.a) {
      case 'dis': {   // become an object (kind must exist in this level)
        if (p.role !== 'H' || !p.alive || !(this.phase === 'hide' || this.phase === 'hunt')) return;
        const k = a.k | 0; if (!this.level.present.includes(k) || k === p.kind) return;
        p.kind = k; p.rot = Number.isFinite(a.r) ? a.r : p.rot; p.locked = false; Object.assign(p, bodySize(k));
        this.cfg.ev('poof', { id, k, x: p.x, y: p.y, z: p.z });
        break;
      }
      case 'rot': if (p.role === 'H' && p.alive && p.kind >= 0 && Number.isFinite(a.r)) p.rot = a.r; break;
      case 'lock': if (p.role === 'H' && p.alive && p.kind >= 0) { p.locked = !!a.v; if (p.locked) { p.vx = p.vz = 0; } } break;
      case 'taunt': {
        if (!(p.role === 'H' && p.alive && (this.phase === 'hunt' || this.phase === 'hide'))) break;
        // small tolerance: the host's clock and the player's can differ by a little
        const wait = R.TAUNT_CD - (this.t - p.lastTaunt);
        if (wait <= R.TAUNT_CD * 0.2) this.taunt(p, false); else this.cfg.ev('tauntno', { id, left: +wait.toFixed(1) });
        break;
      }
      case 'tag': this.tag(p, a); break;
      case 'sniff': {
        if (p.role !== 'S' || !p.alive || this.phase !== 'hunt' || this.t - p.sniffAt < R.SNIFF_CD) return;
        p.sniffAt = this.t;
        let best = Infinity; for (const q of this.players.values()) if (q.alive && q.role === 'H') best = Math.min(best, Math.hypot(q.x - p.x, q.z - p.z));
        this.cfg.ev('sniff', { id, d: Number.isFinite(best) ? +best.toFixed(1) : 99 });
        break;
      }
    }
  }
  taunt(p, forced) {
    // what the seekers (and their bots) HEAR is only the general area: a random point up to ~3 m from the real spot
    const fa = Math.random() * Math.PI * 2, fr = 3.2 * Math.sqrt(Math.random());
    p.lastTaunt = this.t; p.fz = R.FORCE_EVERY; (this.heard ||= []).push({ id: p.id, x: p.x + Math.cos(fa) * fr, y: p.y, z: p.z + Math.sin(fa) * fr, t: this.t }); if (this.heard.length > 12) this.heard.shift(); this.stats[p.id].taunts++;
    let near = Infinity; for (const q of this.players.values()) if (q.alive && q.role === 'S') near = Math.min(near, Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z));
    const daring = !forced && near <= R.DARING_R && this.phase === 'hunt';
    const pts = forced || this.phase !== 'hunt' ? 0 : R.TAUNT + (daring ? R.DARING : 0);
    this.add(p.id, pts);
    this.cfg.ev('taunt', { id: p.id, n: this.stats[p.id].taunts, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), pts: pts * this.mult, daring, forced });
  }
  tag(p, a) {
    if (p.role !== 'S' || !p.alive || this.phase !== 'hunt') return;
    if (this.t - p.bonkAt < R.BONK_CD * 0.8) return;
    p.bonkAt = this.t;
    const o = a.o, d = a.d;
    if (!Array.isArray(o) || !Array.isArray(d) || ![...o, ...d].every(Number.isFinite)) return;
    if (Math.hypot(o[0] - p.x, o[1] - (p.y + R.EYE), o[2] - p.z) > 1.8) return;
    const len = Math.hypot(d[0], d[1], d[2]) || 1; const dir = [d[0] / len, d[1] / len, d[2] / len];
    const L = this.level, wall = rayWorld(L, o, dir, R.REACH + 0.6);
    let hit = null;
    // the client says what it hit; we accept it if it is plausible from the host's view (favor the bonker)
    if (typeof a.tg === 'string' && a.tg.startsWith('h:')) {
      const q = this.players.get(a.tg.slice(2));
      if (q && q.alive && q.role === 'H') {
        const box = q.kind >= 0 ? kindBox(q.kind, q.x, q.y, q.z, q.rot, 0.35) : { x0: q.x - 0.7, x1: q.x + 0.7, z0: q.z - 0.7, z1: q.z + 0.7, y0: q.y - 0.3, y1: q.y + 1.9 };
        const t = rayBox(o, dir, box, R.REACH + 0.6);
        if (t <= Math.min(R.REACH + 0.6, wall + 0.4)) hit = { q };
      }
    }
    if (!hit && typeof a.tg === 'string' && a.tg.startsWith('d:')) {
      const dc = L.decoys[+a.tg.slice(2)];
      if (dc && rayBox(o, dir, kindBox(dc.k, dc.x, dc.y, dc.z, dc.ry, 0.2), R.REACH + 0.4) <= wall + 0.3) hit = { dc };
    }
    this.cfg.ev('swing', { id: p.id });
    if (hit?.q) {
      const q = hit.q; q.alive = false; q.locked = false;
      this.add(p.id, R.FIND); this.stats[p.id].finds++; p.hp = Math.min(R.HP, p.hp + R.FIND_HP);
      this.cfg.ev('found', { id: q.id, by: p.id, x: q.x, y: q.y, z: q.z, k: q.kind, rot: q.rot });
      if (this.alive('H') === 0) this.endRound('S');
    } else if (hit?.dc) {
      p.hp -= R.WRONG; this.stats[p.id].wrong++;
      this.cfg.ev('oops', { by: p.id, i: hit.dc.i, hp: p.hp });
      if (p.hp <= 0) { p.hp = 0; p.alive = false; this.cfg.ev('faint', { id: p.id, x: p.x, y: p.y, z: p.z }); if (this.alive('S') === 0) this.endRound('H'); }
    }
  }
  // a client reports its own body
  input(id, m) {
    const p = this.players.get(id); if (!p || !Array.isArray(m.p) || m.ep !== p.ep) return;
    const [x, y, z, yaw, pitch] = m.p;
    if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
    if (Number.isFinite(yaw)) p.yaw = yaw; if (Number.isFinite(pitch)) p.pitch = pitch;
    if (!this.canMove(p) || p.locked) return;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > 5 * this.timeScale + 2) { p.ep++; return; }       // way off: make the client snap back to us
    if (d > 0.05) p.moving = 0.35;
    p.x = x; p.y = Math.max(0, y); p.z = z;
  }
  snapshot() {
    const fz = {}; if (this.phase === 'hunt') for (const p of this.players.values()) if (p.alive && p.role === 'H') fz[p.id] = +Math.max(0, p.fz).toFixed(1);
    return { t: 's', r: this.round, ph: this.phase, lp: this.lastProp, mu: this.mult || 1, hs: this.hidersAtStart || 0, pt: +Math.max(0, this.pt).toFixed(2), fz, sc: this.score, st: this.stats, p: [...this.players.values()].map(rowOf) };
  }
  standings() { return standingsOf(this.ids, this.score); }
  // host migration: continue from the last snapshot this client saw
  static fromSnap(cfg, s) {
    const sim = new HostSim(cfg);
    if (!s || s.r < 0) return sim;
    sim.round = s.r; sim.phase = s.ph === 'wait' ? 'wait' : s.ph; sim.lastProp = s.lp || null; sim.mult = s.mu || 1; sim.hidersAtStart = s.hs || 0; sim.pt = s.pt;
    Object.assign(sim.score, s.sc || {});
    for (const id of cfg.ids) if (s.st?.[id]) sim.stats[id] = { ...sim.stats[id], ...s.st[id] };
    for (const r of s.p) { const p = sim.players.get(r[0]); if (!p) continue; applyRow(p, r); Object.assign(p, bodySize(p.kind)); p.lastTaunt = -99; p.fz = s.fz?.[p.id] ?? R.FORCE_EVERY; p.ep++; }
    for (const id of cfg.ids) if (cfg.isBot(id)) sim.brains.set(id, cfg.makeBrain(id, sim));
    return sim;
  }
}
export const kindName = (k) => (k >= 0 ? KINDS[k].name : 'yourself');

// What a ray from o along d hits first: 'h:<id>' (a hider), 'd:<index>' (a decoy object) or null (wall / nothing).
export function pickTarget(L, players, o, d, reach, meId) {
  let best = rayWorld(L, o, d, reach), tg = null;
  for (const dc of L.decoys) { const t = rayBox(o, d, kindBox(dc.k, dc.x, dc.y, dc.z, dc.ry, 0.04), best); if (t < best) { best = t; tg = 'd:' + dc.i; } }
  for (const q of players) {
    if (q.id === meId || !q.alive || q.role !== 'H') continue;
    const box = q.kind >= 0 ? kindBox(q.kind, q.x, q.y, q.z, q.rot, 0.04) : { x0: q.x - 0.4, x1: q.x + 0.4, z0: q.z - 0.4, z1: q.z + 0.4, y0: q.y, y1: q.y + 1.6 };
    const t = rayBox(o, d, box, best); if (t < best) { best = t; tg = 'h:' + q.id; }
  }
  return { tg, t: best };
}
