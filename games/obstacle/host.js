// Host simulation for the whole show: rounds, qualifying, eliminations, bodies, grabs, tiles, bots.
// Runs on the party host at 60 Hz (pure logic, no DOM). A new host rebuilds it with HostSim.fromView().
import { C, EV, TILE_FALL, setPoses, stepPlayer, separate, knock, newPlayer, isDown } from './world.js';
import { STAGES, quota, makeWorld, spawnOf, respawnOf, progressOf } from './stages.js';
import { makeBot, botThink, resetBot } from './bots.js';

export const INTRO_T = 4.6, POST_T = 3.2, SHOW_T = 6.5, FINAL_POST_T = 4.5;

export class HostSim {
  // cfg: {ids, bots:Set, plan:[stageId], stageFor(k), N, botLevel, Brain, ev(type, data)}
  constructor(cfg, info = null) {
    this.cfg = cfg; this.ids = cfg.ids; this.ended = false; this.timeScale = 1;
    this.bots = new Map();
    for (const id of cfg.bots) this.bots.set(id, makeBot(cfg.Brain, cfg.botLevel));
    this.auth = {}; this.kbAt = {}; this.lastIn = new Map();
    this.elim = info ? info.elim.map((g) => [...g]) : [];
    this.winner = info?.winner || null;
    this.loadRound(info ? info.k : 0, info ? info.roundIn : [...this.ids], info);
  }
  loadRound(k, roundIn, info = null) {
    this.k = k; this.st = this.cfg.stageFor(k); this.W = makeWorld(this.st);
    this.roundIn = [...roundIn];
    this.q = quota(this.cfg.plan, k, roundIn.length, this.cfg.N);
    this.final = k >= this.cfg.plan.length - 1;
    this.status = {}; this.order = []; this.outOrder = [];
    for (const id of this.ids) this.status[id] = roundIn.includes(id) ? 'in' : 'gone';
    if (info) { Object.assign(this.status, info.status); this.order = [...info.order]; this.outOrder = [...info.outOrder]; }
    this.tileT = new Float32Array(this.st.dynN); this.W.tileT = this.tileT;
    this.players = new Map();
    roundIn.forEach((id, i) => {
      const s = spawnOf(this.st, i), p = newPlayer(id, s.x, s.y, s.z, s.face);
      p.idx = this.ids.indexOf(id); p.slot = i; p.auth = (this.auth[id] = ((this.auth[id] || 0) + 1) & 255);
      this.players.set(id, p);
    });
    for (const b of this.bots.values()) resetBot(b);
    this.t = 0; this.phaseT = 0; this.phase = k === 0 ? 'wait' : 'intro';
    this.endAt = 0;
    setPoses(this.W, 0, 1 / 60);
  }
  info() { return { k: this.k, roundIn: this.roundIn, status: { ...this.status }, order: [...this.order], outOrder: [...this.outOrder], elim: this.elim.map((g) => [...g]), winner: this.winner, phase: this.phase }; }
  go() { if (this.phase === 'wait') { this.phase = 'play'; this.phaseT = 0; this.t = 0; this.cfg.ev('play', { k: this.k }); } }
  inRound() { return [...this.players.values()].filter((p) => this.status[p.id] === 'in'); }

  step(dt, inputs, connected) {
    if (this.ended) return;
    const sdt = dt;
    this.phaseT += sdt;
    if (this.phase === 'intro' && this.phaseT >= INTRO_T) { this.phase = 'play'; this.phaseT = 0; this.t = 0; this.cfg.ev('play', { k: this.k }); }
    else if (this.phase === 'post' && this.phaseT >= (this.final ? FINAL_POST_T : POST_T)) {
      if (this.final) { this.phase = 'done'; this.ended = true; this.cfg.ev('done', {}); return; }
      this.phase = 'show'; this.phaseT = 0; this.cfg.ev('show', { k: this.k });
    } else if (this.phase === 'show' && this.phaseT >= SHOW_T) {
      const next = this.roundIn.filter((id) => this.status[id] === 'q');
      this.loadRound(this.k + 1, next); this.cfg.ev('round', { k: this.k });
      return;
    }
    const playing = this.phase === 'play', post = this.phase === 'post';
    if (playing || post) this.t += sdt;
    setPoses(this.W, playing || post ? this.t : 0, sdt);
    const st = this.st, W = this.W;
    W.doorHit = (d, p) => this.cfg.ev('door', { d, id: p.id });
    W.fakeHit = null;
    const G = { st, W, players: this.inRound(), dt: sdt };
    for (const p of this.players.values()) {
      if (this.status[p.id] !== 'in') continue;
      const bot = this.bots.get(p.id);
      let inp;
      if (bot) inp = botThink(G, p, bot, sdt);
      else {
        if (!connected(p.id)) continue;               // left: frozen in place
        inp = inputs.get(p.id) || this.lastIn.get(p.id) || { mx: 0, mz: 0, jh: false, j: p.lj, d: p.ld, g: false };
        this.lastIn.set(p.id, inp);
      }
      if (!playing && !post) inp = { mx: 0, mz: 0, jh: false, j: inp.j, d: inp.d, g: false };
      if (!playing && !post) { p.lj = inp.j; p.ld = inp.d; }
      const ev = stepPlayer(p, inp, sdt, W);
      if (ev & EV.FELL) this.fell(p);
      if (!bot && playing) this.unstick(p, inp, sdt);
      if (!playing) continue;
      p.g = !!inp.g;
      // checkpoints, finish line, crown
      if (st.cps.length) for (let i = p.cp; i < st.cps.length; i++) { const c = st.cps[i]; if (p.z > c.z - 2.4 && p.y > c.y - 0.6 && p.gr >= 0) p.cp = i + 1; }
      if (st.mode === 'race' && p.z > st.finishZ && p.y > st.finishY - 1.2 && this.status[p.id] === 'in') this.qualify(p.id);
      if (st.mode === 'crown' && this.status[p.id] === 'in' && Math.hypot(p.x - st.crown.x, p.y + 0.8 - st.crown.y, p.z - st.crown.z) < 1.3) { this.winner = [p.id]; this.qualify(p.id); }
    }
    if (!playing && !post) return;
    const al = this.inRound();
    // bodies: bouncy pushes; a diving bean knocks others over
    for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) {
      const a = al[i], b = al[j];
      const pre = [a.dive, b.dive];
      const rv = separate(a, b);
      if (rv > 0) for (const [x, y, dv] of [[a, b, pre[0]], [b, a, pre[1]]]) {
        if (dv && !isDown(y) && y.hitCd <= 0 && Math.hypot(x.vx, x.vz) + rv * 0.3 > C.BUMP_DIVE) {
          const l = Math.hypot(x.vx, x.vz) || 1;
          knock(y, x.vx / l * 7, 5, x.vz / l * 7, 0.8); y.lastBy = x.id; y.lastByT = this.t; this.kbAt[y.id] = performance.now();
          this.cfg.ev('hit', { a: x.id, v: y.id, vx: y.vx, vy: y.vy, vz: y.vz });
        }
      }
    }
    this.grabs(al, sdt);
    // collapsing tiles
    if (st.id === 'tiles' || st.hasTiles) {
      for (const p of al) if (p.gr >= 0) { const s = W.solids[p.gr]; if (s.tile >= 0 && !s.safe && W.dyn[s.tile] === 0) { W.dyn[s.tile] = 1; this.tileT[s.tile] = this.t; } }
      for (let i = 0; i < st.dynN; i++) if (W.dyn[i] === 1 && this.t - this.tileT[i] > (st.tileFall || TILE_FALL)) W.dyn[i] = 2;
    }
    if (playing) this.checkEnd(connected);
  }
  // Safety net for humans: pushing hard against something without moving for over a second pops you free.
  // (Closed doors are the exception: they are supposed to stop you.)
  unstick(p, inp, dt) {
    const push = Math.hypot(inp.mx || 0, inp.mz || 0) > 0.5, w = p.wall >= 0 ? this.W.solids[p.wall] : null;
    const still = Math.hypot(p.vx, p.vz) < 1.2 && p.gr >= 0 && !isDown(p) && !p.dive && p.hang < 0 && !p.grab && !p.gby && !(w && w.door >= 0);
    p.stk = push && still ? (p.stk || 0) + dt : 0;
    if (p.stk > 1.1) {
      p.stk = 0; p.vy = 8.5; p.gr = -1; p.coy = 0; p.vx = (inp.mx || 0) * 6; p.vz = (inp.mz || 0) * 6;
      p.auth = (p.auth + 1) & 255; this.cfg.ev('unstick', { id: p.id });
    }
  }
  grabs(al, dt) {
    for (const p of al) {
      if (p.grab) {
        const q = this.players.get(p.grab);
        p.grabT += dt;
        const d = q ? Math.hypot(q.x - p.x, q.z - p.z) : 99;
        if (!p.g || !q || this.status[q.id] !== 'in' || p.grabT > C.GRAB_T || d > C.GRAB_BREAK || isDown(p) || p.dive || Math.abs(p.y - q.y) > 1.8) {
          if (q && q.gby === p.id) q.gby = null;
          p.grab = null; p.gcd = C.GRAB_CD;
        } else if (d > 1.15) {
          const ex = d - 1.15, nx = (q.x - p.x) / d, nz = (q.z - p.z) / d;
          q.x -= nx * ex * 0.6; q.z -= nz * ex * 0.6; p.x += nx * ex * 0.15; p.z += nz * ex * 0.15;
        }
      } else if (p.g && p.gcd <= 0 && p.gr >= 0 && !isDown(p) && !p.dive && p.hang < 0) {
        let best = null, bd = C.GRAB_R;
        for (const q of al) {
          if (q === p || q.gby) continue;
          const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
          if (d < bd && Math.abs(q.y - p.y) < 1.2 && (dx * Math.sin(p.face) + dz * Math.cos(p.face)) / (d || 1) > 0.2) { bd = d; best = q; }
        }
        if (best) { p.grab = best.id; best.gby = p.id; p.grabT = 0; this.cfg.ev('grab', { a: p.id, v: best.id }); }
      }
      if (p.gby) { const g = this.players.get(p.gby); if (!g || g.grab !== p.id) p.gby = null; }
    }
  }
  fell(p) {
    const st = this.st;
    if (this.status[p.id] !== 'in') return;
    if (st.mode === 'race' || st.mode === 'crown') {
      const s = respawnOf(st, p.cp, p.slot);
      Object.assign(p, { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, face: s.face, down: 0, tumble: false, dive: false, slide: false, gr: -1, hang: -1, grab: null });
      p.rs = (p.rs + 1) & 255;
      this.cfg.ev('fell', { id: p.id, respawn: true });
    } else if (this.phase === 'play') {
      this.status[p.id] = 'out'; this.outOrder.push(p.id);
      this.cfg.ev('out', { id: p.id, by: p.lastBy && this.t - p.lastByT < 3 ? p.lastBy : null, x: p.x, z: p.z });
    } else {   // fell during the post-round celebration: put them back
      const s = spawnOf(st, p.slot); Object.assign(p, { x: s.x, y: s.y + 1, z: s.z, vx: 0, vy: 0, vz: 0 });
    }
  }
  qualify(id) {
    if (this.status[id] !== 'in') return;
    this.status[id] = 'q'; this.order.push(id);
    this.cfg.ev('q', { id, place: this.order.length, final: this.final });
  }
  checkEnd(connected) {
    const st = this.st, meta = STAGES[st.id];
    const left = this.roundIn.filter((id) => this.status[id] === 'in');
    const live = left.filter((id) => this.cfg.bots.has(id) || connected(id));
    const timeUp = this.t >= meta.time;
    let end = false;
    if (st.mode === 'race') end = this.order.length >= this.q || !live.length || timeUp;
    else if (st.mode === 'crown') end = !!this.winner || !live.length || timeUp;
    else if (st.mode === 'last') end = (this.roundIn.length > 1 ? left.length <= 1 : left.length === 0) || timeUp;
    else end = (this.roundIn.length > this.q ? left.length <= this.q : left.length === 0) || timeUp;
    if (end) this.endRound(timeUp);
  }
  endRound(timeUp) {
    const st = this.st;
    const prog = (id) => { const p = this.players.get(id); return p ? progressOf(st, p) : -1e9; };
    let left = this.roundIn.filter((id) => this.status[id] === 'in').sort((a, b) => prog(b) - prog(a));
    if (st.mode === 'race') {
      const need = Math.min(this.q, Math.max(1, Math.ceil(this.q / 2)));
      while (timeUp && this.order.length < need && left.length) this.qualify(left.shift());
    } else if (st.mode === 'crown') {
      if (!this.winner && left.length) { this.winner = [left[0]]; this.qualify(left.shift()); }
    } else {
      if (!left.length && this.outOrder.length) {   // everyone went down at once: the last ones out survive
        const last = this.outOrder.pop(); this.status[last] = 'in'; left = [last];
      }
      for (const id of left) this.qualify(id);
      left = [];
      if (st.mode === 'last') this.winner = [...this.order];
    }
    const eliminated = [...left, ...[...this.outOrder].reverse()];
    for (const id of left) { this.status[id] = 'out'; }
    // The show ends early when only one contestant is left, or when no human is left to play for anything:
    // nobody is made to keep playing alone (or to sit through bot-only rounds).
    if (!this.final) {
      const humansLeft = this.order.filter((id) => !this.cfg.bots.has(id)).length;
      if (this.order.length <= 1 || !humansLeft) { this.final = true; if (!this.winner) this.winner = this.order.slice(0, 1); }
    }
    if (this.final) {
      // finalists who didn't win, best progress first
      this.elim.push(eliminated);
    } else this.elim.push(eliminated);
    this.phase = 'post'; this.phaseT = 0;
    this.cfg.ev('end', { k: this.k, qualified: [...this.order], eliminated, timeUp, final: this.final, winner: this.winner });
  }
  // placements best -> worst (ties as arrays)
  standings() { return standingsOf(this.info(), (id) => { const p = this.players.get(id); return p ? progressOf(this.st, p) : -1e9; }); }
  // ---- host migration: rebuild from the last info + snapshot this client saw
  static fromView(cfg, info, snap) {
    const sim = new HostSim(cfg, info);
    if (snap && snap.round === info.k) {
      sim.phase = snap.phase === 'done' ? 'post' : snap.phase; sim.phaseT = snap.phaseT; sim.t = snap.t;
      if (snap.dyn?.length === sim.W.dyn.length) sim.W.dyn.set(snap.dyn);
      for (let i = 0; i < sim.st.dynN; i++) if (sim.W.dyn[i] === 1) sim.tileT[i] = sim.t;
      for (const r of snap.players) {
        const id = cfg.ids[r.idx], p = sim.players.get(id); if (!p) continue;
        Object.assign(p, { x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, face: r.face, cp: r.cp, rs: r.rs, down: r.down, dive: !!(r.flags & 4), gr: -1 });
      }
      setPoses(sim.W, sim.t, 1 / 60);
    } else if (info.phase && info.phase !== 'wait') { sim.phase = info.phase === 'play' ? 'play' : info.phase; }
    return sim;
  }
}

// shared by host + clients: info -> placements
export function standingsOf(info, prog = () => 0) {
  const out = [];
  if (info.winner?.length) out.push([...info.winner]);
  const seen = new Set(out.flat());
  const cur = info.roundIn.filter((id) => !seen.has(id));
  const qd = info.order.filter((id) => cur.includes(id));
  for (const id of qd) { out.push([id]); seen.add(id); }
  const inRace = cur.filter((id) => info.status[id] === 'in').sort((a, b) => prog(b) - prog(a));
  for (const id of inRace) { out.push([id]); seen.add(id); }
  const lastElim = info.elim.length > info.k ? info.elim[info.k] : [...info.outOrder].reverse();
  for (const id of lastElim) if (!seen.has(id)) { out.push([id]); seen.add(id); }
  for (let r = Math.min(info.k, info.elim.length) - 1; r >= 0; r--) {
    const g = info.elim[r].filter((id) => !seen.has(id));
    for (const id of g) { out.push([id]); seen.add(id); }
  }
  return out;
}
