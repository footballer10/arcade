// Rising Lava host simulation: the whole match (rounds, lava, platforms, players, bots, deaths, scores).
// Runs on the party host at 60 Hz. A new host rebuilds it from the last snapshot + round info (fromView).
// Pure logic (no DOM / three.js): the headless balance script runs it too.
import { C, ST_GONE, makeSolids, updateSolids, newPlayer, stepPlayer, separate, shoveTargets, knock, stepPlatforms, lavaAt } from './world.js';
import { makeBot, botThink } from './bots.js';

export const INTRO_T = 4.2, POST_T = 4.2;

export class HostSim {
  // cfg: {ids:[...], bots:Set(ids), levelFor(k), need, maxRounds, botLevel, Brain, ev(type, data)}
  constructor(cfg) {
    Object.assign(this, { cfg, ids: cfg.ids, round: 0, phase: 'wait', phaseT: 0, t: 0, wins: {}, pts: {}, deaths: [], hist: [], ended: false, timeScale: 1 });
    for (const id of this.ids) { this.wins[id] = 0; this.pts[id] = 0; }
    this.bots = new Map();
    for (const id of cfg.bots) this.bots.set(id, makeBot(cfg.Brain, cfg.botLevel));
    this.auth = {}; this.kbAt = {}; this.lastIn = new Map();
    this.loadRound(0);
  }
  loadRound(k) {
    this.round = k; this.level = this.cfg.levelFor(k);
    this.S = makeSolids(this.level); this.st = new Uint16Array(this.level.plats.length); this.timers = new Float32Array(this.level.plats.length);
    this.t = 0; this.deaths = []; this.lava = this.level.lv.from;
    this.players = this.ids.map((id, i) => { const p = newPlayer(id, this.level.plats[this.level.spawns[i % this.level.spawns.length]]); p.idx = i; p.auth = (this.auth[id] = ((this.auth[id] || 0) + 1) & 255); return p; });
    this.byId = new Map(this.players.map((p) => [p.id, p]));
    for (const b of this.bots.values()) { b.target = -1; b.prey = null; }
    updateSolids(this.level, this.S, this.st, 0, this.lava, 0);
  }
  get world() { return { S: this.S, st: this.st, lava: this.lava, lv: this.level.lv, t: this.t, players: this.players, level: this.level }; }
  alive() { return this.players.filter((p) => p.alive); }
  go() { if (this.phase === 'wait') { this.phase = 'play'; this.phaseT = 0; this.t = 0; } }

  // inputs: Map id -> latest input; connected(id) -> bool
  step(dt, inputs, connected) {
    if (this.ended) return;
    const sdt = dt * this.timeScale;
    this.phaseT += sdt;
    if (this.phase === 'intro' && this.phaseT >= INTRO_T) { this.phase = 'play'; this.phaseT = 0; this.t = 0; this.cfg.ev('play', { round: this.round }); }
    if (this.phase === 'post' && this.phaseT >= POST_T) { this.nextRound(); return; }
    const playing = this.phase === 'play';
    if (playing) this.t += sdt;
    this.lava = lavaAt(this.level.lv, playing ? this.t : this.phase === 'post' ? this.t : 0);
    updateSolids(this.level, this.S, this.st, playing || this.phase === 'post' ? this.t : 0, this.lava, sdt);
    const w = this.world;
    // players
    for (const p of this.players) {
      if (!p.alive) continue;
      let inp;
      const bot = this.bots.get(p.id);
      if (bot) inp = botThink(w, p, bot, dt);
      else inp = inputs.get(p.id) || this.lastIn.get(p.id) || { mx: 0, mz: 0, jh: false, j: p.lj, d: p.ld, s: p.ls };
      if (!bot) this.lastIn.set(p.id, inp);
      if (!playing) { p.lj = inp.j; p.ld = inp.d; p.ls = inp.s; inp = { mx: 0, mz: 0, jh: false, j: p.lj, d: p.ld, s: p.ls }; if (this.phase !== 'post') { p.vx = p.vz = 0; } }
      const ev = stepPlayer(p, inp, dt, this.S);
      if (ev & 4) this.doShove(p);
      if (ev & 2) this.cfg.ev('dash', { id: p.id });
    }
    // bodies push apart, dash bumps
    const al = this.alive();
    for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) {
      const a = al[i], b = al[j];
      for (const [x, y] of [[a, b], [b, a]]) {
        if (x.dashT > 0 && x.bumped !== y.id && y.stun <= 0 && Math.hypot(x.x - y.x, x.z - y.z) < C.PR * 2.3 && Math.abs(x.y - y.y) < 1.3) {
          x.bumped = y.id; knock(y, x.dx, x.dz, C.BUMP_KB, 4); this.kbAt[y.id] = performance.now(); y.lastBy = x.id; y.lastByT = this.t;
          this.cfg.ev('hit', { a: x.id, v: y.id, vx: y.vx, vy: y.vy, vz: y.vz, bump: 1 });
        }
      }
      separate(a, b);
    }
    // platform heat / crumble / pumice
    if (playing || this.phase === 'post') {
      const occ = new Uint8Array(this.S.length);
      for (const p of al) if (p.gr >= 0) occ[p.gr]++;
      for (const [i, k] of stepPlatforms(this.level, this.S, this.st, this.timers, occ, this.lava, sdt, this.t > this.level.lv.T)) this.cfg.ev('plat', { i, k });
    }
    // lava
    if (playing) {
      const died = [];
      for (const p of al) {
        const gone = !this.bots.has(p.id) && !connected(p.id);
        if (p.y <= this.lava + 0.02 || p.y < -8 || gone) died.push(p);
      }
      if (died.length) {
        for (const p of died) { p.alive = false; p.deathT = this.t; const by = p.lastBy && this.t - p.lastByT < 3 ? p.lastBy : null; this.cfg.ev('die', { id: p.id, by, x: p.x, y: p.y, z: p.z, round: this.round }); }
        this.deaths.push(died.map((p) => p.id));
      }
      const left = this.alive();
      const solo = this.players.length === 1;
      if ((solo ? left.length === 0 : left.length <= 1) || this.t > this.level.lv.T + C.HARD_END) this.endRound();
    }
  }
  doShove(p) {
    const hits = [];
    for (const [o, dx, dz] of shoveTargets(p, this.players)) {
      knock(o, dx, dz, C.SHOVE_KB, C.SHOVE_UP); o.lastBy = p.id; o.lastByT = this.t; this.kbAt[o.id] = performance.now();
      hits.push(o.id);
      this.cfg.ev('hit', { a: p.id, v: o.id, vx: o.vx, vy: o.vy, vz: o.vz });
    }
    p.vx += Math.sin(p.face) * 2.5; p.vz += Math.cos(p.face) * 2.5;
    this.cfg.ev('shove', { id: p.id, hit: hits.length });
  }
  endRound() {
    const left = this.alive();
    const order = [...this.deaths];
    if (left.length) order.push(left.map((p) => p.id));
    const winners = order.length ? order[order.length - 1] : [];
    // points = how many players you outlived this round
    let before = 0;
    for (const g of order) { for (const id of g) this.pts[id] = (this.pts[id] || 0) + before; before += g.length; }
    if (this.players.length > 1) for (const id of winners) this.wins[id] = (this.wins[id] || 0) + 1;
    this.hist.push({ round: this.round, winners, layout: this.level.layout, pattern: this.level.pattern, t: this.t });
    this.phase = 'post'; this.phaseT = 0;
    this.cfg.ev('roundEnd', { round: this.round, winners, wins: { ...this.wins }, pts: { ...this.pts }, t: this.t });
  }
  matchOver() {
    const top = Math.max(0, ...Object.values(this.wins));
    return top >= this.cfg.need || this.round + 1 >= this.cfg.maxRounds;
  }
  nextRound() {
    if (this.matchOver()) { this.phase = 'done'; this.ended = true; this.cfg.ev('done', {}); return; }
    this.loadRound(this.round + 1);
    this.phase = 'intro'; this.phaseT = 0;
    this.cfg.ev('round', { round: this.round });
  }
  standings() { return standingsOf(this.ids, this.wins, this.pts, this.phase === 'play' ? this.liveBonus() : null); }
  liveBonus() { const b = {}; let before = 0; for (const g of this.deaths) before += g.length; for (const p of this.players) if (p.alive) b[p.id] = before; return b; }

  // ---- host migration: continue from the last snapshot (decoded) + round info every client keeps
  static fromView(cfg, info, snap) {
    const s = new HostSim(cfg);
    Object.assign(s.wins, info.wins || {}); Object.assign(s.pts, info.pts || {});
    if (snap && snap.round !== s.round) s.loadRound(snap.round); else if (!snap && info.round) s.loadRound(info.round);
    s.deaths = (info.deaths || []).map((g) => [...g]);
    if (snap) {
      s.phase = snap.phase === 'wait' ? 'wait' : snap.phase === 'done' ? 'post' : snap.phase; s.phaseT = snap.phaseT; s.t = snap.t;
      s.st.set(snap.st.subarray(0, s.st.length));
      for (const r of snap.players) {
        const p = s.players[r.idx]; if (!p) continue;
        Object.assign(p, { x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, face: r.face, alive: r.alive, gr: -1 });
        p.auth = s.auth[p.id] = (r.auth + 1) & 255;
      }
      for (let i = 0; i < s.st.length; i++) if (s.st[i] === ST_GONE) s.timers[i] = 0;
    }
    s.hist = info.hist || [];
    return s;
  }
}

// wins first, then "outlived" points; extra = live points for players still alive in a running round
export function standingsOf(ids, wins, pts, extra = null) {
  const sc = (id) => (wins[id] || 0) * 1000 + (pts[id] || 0) + (extra?.[id] || 0);
  const sorted = [...ids].sort((a, b) => sc(b) - sc(a));
  const groups = [];
  for (const id of sorted) { const g = groups[groups.length - 1]; if (g && sc(g[0]) === sc(id)) g.push(id); else groups.push([id]); }
  return groups;
}
