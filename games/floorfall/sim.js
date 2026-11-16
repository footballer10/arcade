// Host simulation: runs every player (humans from their inputs / predicted states, bots from bots.js), cracks
// the tiles people touch, erodes the rims, decides knockouts, rounds and the match. Only the host runs this; a
// new host after migration rebuilds it from the last snapshot it saw (resume) and the tile states it already has.
import { C, newPlayer, stepPlayer, collide, tileAt, edgeTiles, syncCounters } from './world.js';

function underdogSpawn(lv, p) {
  const T = lv.layers[lv.L - 1], i = tileAt(T, p.x * 0.45, p.z * 0.45);
  if (i >= 0) { p.x = T.xs[i]; p.z = T.zs[i]; p.underdog = true; }
}
import { makeBot, botThink } from './bots.js';

export const INTRO_T = 3.2, END_T = 3.6;

export class HostSim {
  // cfg: { ids, bots:Set, levelFor(k), need, maxRounds, level, Brain, ev(type, data), turbo() }
  constructor(cfg, resume = null) {
    this.cfg = cfg; this.ids = cfg.ids;
    this.wins = Object.fromEntries(cfg.ids.map((id) => [id, 0]));
    this.pts = Object.fromEntries(cfg.ids.map((id) => [id, 0]));
    this.bumps = Object.fromEntries(cfg.ids.map((id) => [id, 0]));
    this.cracked = Object.fromEntries(cfg.ids.map((id) => [id, 0]));
    this.round = 0; this.phase = 'wait'; this.phaseT = 0; this.t = 0;
    this.players = []; this.byId = new Map(); this.bots = new Map(); this.inputs = new Map(); this.states = new Map();
    this.out = [];         // knocked-out ids this round, in order
    this.erode = [];       // per-layer erosion accumulators
    this.pending = [];     // tile triggers to broadcast: [layer, index, at, who]
    this.lastHit = new Map();
    this.rr = Math.random;
    if (resume) {
      Object.assign(this.wins, resume.wins); Object.assign(this.pts, resume.pts || {}); Object.assign(this.bumps, resume.bumps || {}); Object.assign(this.cracked, resume.cracked || {});
      this.setupRound(resume.round, false);
      this.phase = resume.phase; this.phaseT = resume.phaseT; this.t = resume.t; this.out = [...(resume.out || [])];
      for (const s of resume.players) { const p = this.byId.get(s.id); if (p) Object.assign(p, s, { auth: (s.auth || 0) + 1 }); }
    } else this.setupRound(0, false);
  }
  get level() { return this.cfg.levelFor(this.round); }
  setupRound(k, announce = true) {
    this.round = k; this.t = 0; this.out = []; this.pending = [];
    const lv = this.level;
    this.erode = lv.layers.map(() => this.rr());
    const prev = this.byId;
    this.players = this.ids.map((id, i) => { const p = newPlayer(id, lv, i); const o = prev.get(id); if (o) { p.auth = o.auth + 1; p.lj = o.lj; p.ld = o.ld; } return p; });
    this.byId = new Map(this.players.map((p) => [p.id, p]));
    // comeback: players behind the match leader start closer to the middle of the top floor (more room to plan)
    const top = Math.max(0, ...this.ids.map((id) => this.wins[id] || 0));
    if (top > 0) for (const p of this.players) if ((this.wins[p.id] || 0) < top) underdogSpawn(lv, p);
    for (const id of this.ids) if (this.cfg.bots.has(id)) { const b = this.bots.get(id) || makeBot(this.cfg.Brain, this.cfg.level); b.inp.mx = b.inp.mz = 0; syncCounters(this.byId.get(id), b.inp); this.bots.set(id, b); }
    for (const [id, inp] of this.inputs) { const p = this.byId.get(id); if (p) syncCounters(p, inp); }
    const mp = this.byId.get(this.cfg.myId); if (mp && this.cfg.myInput) syncCounters(mp, this.cfg.myInput);
    if (announce) { this.phase = 'intro'; this.phaseT = INTRO_T; this.cfg.ev('round', { round: k }); }
  }
  go() { if (this.phase === 'wait') { this.phase = 'play'; this.cfg.ev('play', { round: this.round }); } }
  // client -> host: input counters + its predicted state
  input(id, inp, st) {
    this.inputs.set(id, inp);
    const p = this.byId.get(id);
    if (p && this.phase !== 'play') syncCounters(p, inp);
    if (!p || !st || !p.alive || this.phase !== 'play') return;
    const [x, y, z, vx, vy, vz, g, l, auth] = st;
    if (auth !== p.auth) return;                                       // client hasn't seen my last correction yet
    if (Math.hypot(x - p.x, z - p.z) > 3 || Math.abs(y - p.y) > C.LAYER_H * 1.2) { p.auth++; return; }   // too far off: correct
    const lv = this.level;
    if (g && l >= 0 && l < lv.L) {                                      // standing on a tile I already dropped? no.
      const L = lv.layers[l], i = tileAt(L, x, z);
      if (i < 0 || L.at[i] < this.t - 0.2) { p.auth++; return; }
    }
    Object.assign(p, { x, y, z, vx, vy, vz, g: !!g, l: l >= 0 ? l : p.l });
  }
  trigger(lv, h, i, who, delay) {
    const L = lv.layers[h];
    if (L.at[i] !== Infinity) return;
    L.at[i] = this.t + delay; L.who[i] = who;
    if (who < this.ids.length) this.cracked[this.ids[who]]++;
    this.pending.push(h, i, +L.at[i].toFixed(3), who);
  }
  step(dt, myId, myInput) {
    if (this.phase === 'wait' || this.phase === 'done') return;
    if (this.phase === 'intro') { this.phaseT -= dt; if (this.phaseT <= 0) { this.phase = 'play'; this.cfg.ev('play', { round: this.round }); } return; }
    if (this.phase === 'end') { this.phaseT -= dt; if (this.phaseT <= 0) this.nextRound(); return; }
    const lv = this.level, turbo = this.cfg.turbo();
    this.t += dt;
    const w = { lv, t: this.t, players: this.players };
    const ev = {};
    for (let idx = 0; idx < this.players.length; idx++) {
      const p = this.players[idx];
      if (!p.alive) continue;
      const b = this.bots.get(p.id);
      let inp;
      if (b) { botThink(b, p, w, dt); inp = b.inp; }
      else if (p.id === myId) inp = myInput;
      else { inp = this.inputs.get(p.id) || { mx: 0, mz: 0, j: p.lj, d: p.ld }; if (!this.cfg.connected(p.id)) inp = { mx: 0, mz: 0, j: p.lj, d: p.ld }; }
      stepPlayer(p, inp, dt, lv, this.t, ev);
      if (ev.ground >= 0) this.trigger(lv, p.l, ev.ground, idx, lv.delay);
      if (ev.land >= 0 && (ev.impact || 0) > 12) this.cfg.ev('thud', { id: p.id, l: p.l });
      if (ev.dash) this.cfg.ev('dash', { id: p.id });
      if (!p.alive) this.knockout(p);
    }
    collide(this.players.filter((p) => p.alive), (a, b, x, y, z, both) => {
      a.auth++; b.auth++;
      this.bumps[a.id]++; this.lastHit.set(b.id, { by: a.id, t: this.t });
      if (both) this.lastHit.set(a.id, { by: b.id, t: this.t });
      this.cfg.ev('hit', { a: a.id, b: b.id, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) });
    });
    // erosion: rims crumble on their own; upper layers shrink fastest; the collapse speeds everything up
    const L = lv.L, ct = C.COLLAPSE_AT / turbo;
    const ramp = 1 + Math.max(0, this.t * turbo - 25) / 25;
    for (let h = 0; h < L; h++) {
      let rate = (0.12 + 0.5 * (h / Math.max(1, L - 1))) * ramp * turbo;
      if (this.t > ct) rate += (1.5 + (this.t - ct) * 0.25 * turbo) * (0.6 + 0.4 * (h / Math.max(1, L - 1))) * turbo;
      this.erode[h] += rate * dt;
      while (this.erode[h] >= 1) {
        this.erode[h] -= 1;
        const edge = edgeTiles(lv.layers[h], this.t);
        if (edge.length) this.trigger(lv, h, edge[Math.floor(this.rr() * edge.length)], 255, Math.max(0.5, lv.delay * 1.8));
      }
    }
    // round over?
    const alive = this.players.filter((p) => p.alive);
    if (alive.length <= (this.players.length > 1 ? 1 : 0)) this.endRound(alive);
  }
  knockout(p) {
    this.out.push(p.id);
    const lh = this.lastHit.get(p.id), by = lh && this.t - lh.t < 4 ? lh.by : null;
    this.cfg.ev('out', { id: p.id, by, left: this.players.filter((q) => q.alive).length });
  }
  endRound(alive) {
    let winners = alive.map((p) => p.id);
    if (!winners.length) { // everyone fell at once: the last to go share it
      const lastT = this.out.slice(-this.players.length);
      winners = lastT.length ? [lastT[lastT.length - 1]] : [];
    }
    for (const id of winners) this.wins[id]++;
    // survival points: how many players each one outlived this round
    this.out.forEach((id, i) => { this.pts[id] += i; });
    for (const id of winners) if (!this.out.includes(id)) this.pts[id] += this.players.length - 1;
    this.phase = 'end'; this.phaseT = END_T;
    this.cfg.ev('roundEnd', { winners, wins: { ...this.wins }, round: this.round });
  }
  nextRound() {
    const top = Math.max(...this.ids.map((id) => this.wins[id]));
    if (top >= this.cfg.need || this.round + 1 >= this.cfg.maxRounds) { this.phase = 'done'; this.cfg.ev('done', {}); return; }
    this.setupRound(this.round + 1, true);
  }
  standings() {
    // a round in progress counts too (tie-breaker): still standing > fell later > fell earlier
    const cur = {};
    if (this.phase === 'play') for (const id of this.ids) { const i = this.out.indexOf(id); cur[id] = i < 0 ? this.out.length + 1 : i; }
    return standingsOf(this.ids, this.wins, this.pts, cur);
  }
}

export function standingsOf(ids, wins, pts, cur = {}) {
  const key = (id) => (wins[id] || 0) * 100000 + (pts[id] || 0) * 100 + (cur[id] || 0);
  const sorted = [...ids].sort((a, b) => key(b) - key(a));
  const groups = [];
  for (const id of sorted) { const g = groups[groups.length - 1]; if (g && key(g[0]) === key(id)) g.push(id); else groups.push([id]); }
  return groups.map((g) => (g.length === 1 ? g[0] : g));
}
