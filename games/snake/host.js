// Host-authoritative simulation: movement, boosting, orbs, collisions, deaths, the shrinking ring.
import { C, Trail, Grid, stepHead, radiusOf, lengthOf, ringAt, spawnOf, orbSize, orbGoal, standingsOf } from './sim.js';

const BODY_TMP = new Float32Array(2 * 400);

export class HostSim {
  // players: ctx.players. cfg: arenaCfg. orbs0: initialOrbs(). events: { death(s, byId, cause), eat(orb, idx), add(orb) }
  constructor(players, cfg, orbs0, events, opts = {}) {
    this.cfg = cfg; this.ev = events; this.t = 0; this.players = players;
    this.snakes = new Map(); this.orbs = new Map(); this.grid = new Grid(); this.deaths = [];
    this.nextOrb = 100000; this.orbTarget = opts.orbs || 1;
    players.forEach((p, i) => {
      const sp = spawnOf(i, players.length, cfg.r0);
      const s = { id: p.id, idx: i, x: sp.x, y: sp.y, a: sp.a, v: 0, mass: C.START_MASS, alive: true, boost: false, trail: new Trail(), kills: 0, deathT: 0, by: null, drop: 0, peak: C.START_MASS, ang: sp.a, wantBoost: false, ack: 0 };
      s.trail.reset(s.x, s.y, s.a, lengthOf(s.mass));
      this.snakes.set(p.id, s);
    });
    for (const o of orbs0) this.orbs.set(o.id, { ...o });
  }
  get R() { return ringAt(this.t, this.cfg); }
  alive() { return [...this.snakes.values()].filter((s) => s.alive); }

  // rebuild from a client's view after host migration
  static fromView(players, cfg, view, events, opts) {
    const h = new HostSim(players, cfg, [], events, opts);
    h.orbs.clear();
    for (const o of view.orbs.values()) h.orbs.set(o.id, { id: o.id, x: o.x, y: o.y, v: o.v, c: o.c });
    let mx = view.maxOrb || 0; for (const k of view.orbs.keys()) mx = Math.max(mx, k);
    h.nextOrb = Math.max(h.nextOrb, mx + 5000);
    h.t = view.t;
    for (const s of h.snakes.values()) {
      const v = view.snakes.get(s.id); if (!v) continue;
      Object.assign(s, { x: v.x, y: v.y, a: v.a, v: v.boost ? C.BOOST_SPEED : C.SPEED, mass: v.mass, alive: v.alive, kills: v.kills, deathT: v.deathT || 0, peak: Math.max(v.mass, v.peak || 0), ang: v.a });
      if (v.trail.x.length > 1) { s.trail.x = v.trail.x.slice(); s.trail.y = v.trail.y.slice(); s.trail.push(s.x, s.y); }
      else s.trail.reset(s.x, s.y, s.a, lengthOf(s.mass));
    }
    h.deaths = (view.deaths || []).slice();
    return h;
  }

  addOrb(x, y, v, c, kind = 0) {
    const o = { id: this.nextOrb++, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, v: Math.round(v * 10) / 10, c, k: kind };
    this.orbs.set(o.id, o); this.ev.add(o); return o;
  }

  kill(s, byId, cause) {
    if (!s.alive) return;
    s.alive = false; s.deathT = this.t; s.by = byId; s.boost = false;
    this.deaths.push(s.id);
    // burst into orbs along the body, in the snake's color
    const r = radiusOf(s.mass), L = lengthOf(s.mass);
    const n = s.trail.sample(L, Math.max(0.9, r * 1.1), BODY_TMP, 200);
    const total = s.mass * C.DEATH_KEEP, per = total / Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const j = (Math.random() - 0.5) * r * 1.6, j2 = (Math.random() - 0.5) * r * 1.6;
      this.addOrb(BODY_TMP[k * 2] + j, BODY_TMP[k * 2 + 1] + j2, Math.max(1, per * (0.7 + Math.random() * 0.6)), s.idx, 1);
    }
    if (byId && this.snakes.get(byId)) this.snakes.get(byId).kills++;
    this.ev.death(s, byId, cause);
  }

  // inputs: (snake) -> { ang, boost }
  step(dt, inputOf) {
    this.t += dt;
    const R = this.R;
    // 1. move
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      const inp = inputOf(s);
      if (inp) { s.ang = inp.ang; s.wantBoost = inp.boost; }
      s.boost = s.wantBoost && s.mass > C.BOOST_MIN;
      stepHead(s, s.ang, s.boost, dt);
      if (s.boost) {
        s.mass -= C.BOOST_DRAIN * dt;
        s.drop += dt;
        if (s.drop >= C.BOOST_DROP) {
          s.drop = 0;
          const L = lengthOf(s.mass), n = s.trail.sample(L, L, BODY_TMP, 2), tx = BODY_TMP[(n - 1) * 2], ty = BODY_TMP[(n - 1) * 2 + 1];
          this.addOrb(tx + (Math.random() - 0.5) * 0.6, ty + (Math.random() - 0.5) * 0.6, C.BOOST_DRAIN * C.BOOST_DROP * 0.75, s.idx, 2);
        }
      }
      s.trail.push(s.x, s.y);
      s.trail.trim(lengthOf(s.mass));
    }
    // 2. bodies into the grid
    const g = this.grid; g.clear();
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      const r = radiusOf(s.mass), n = s.trail.sample(lengthOf(s.mass), Math.max(0.3, r * 0.7), BODY_TMP, 400);
      for (let k = 0; k < n; k++) g.add(BODY_TMP[k * 2], BODY_TMP[k * 2 + 1], r, s.idx, k);
    }
    // 3. collisions (decided together, applied after)
    const dead = [];
    const byIdx = [...this.snakes.values()];
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      const r = radiusOf(s.mass);
      if (Math.hypot(s.x, s.y) + r * 0.4 > R) { dead.push([s, null, 'ring']); continue; }
      const hits = new Map();   // owner idx -> closest-to-head point index touched
      g.query(s.x, s.y, r + 3, (x, y, rb, owner, k) => {
        if (owner === s.idx) return false;
        if (Math.hypot(x - s.x, y - s.y) < r * 0.6 + rb * 0.92) hits.set(owner, Math.min(k, hits.get(owner) ?? 1e9));
        return false;
      });
      let hit = null;
      for (const [owner, k] of hits) {
        const o = byIdx.find((q) => q.idx === owner);
        // head-on (touching their head): the bigger snake wins, near-equals both pop
        if (k <= 2 && s.mass > o.mass * 1.05) continue;
        hit = o; break;
      }
      if (hit) dead.push([s, hit.id, 'body']);
    }
    for (const [s, by, cause] of dead) this.kill(s, by, cause);
    // 4. eat + suction
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      const r = radiusOf(s.mass), eat = r + C.ORB_EAT, pull = r + C.ORB_PULL;
      for (const o of this.orbs.values()) {
        const dx = s.x - o.x, dy = s.y - o.y;
        if (Math.abs(dx) > pull || Math.abs(dy) > pull) continue;
        const d = Math.hypot(dx, dy);
        if (d < eat + orbSize(o.v)) {
          s.mass += o.v; s.peak = Math.max(s.peak, s.mass);
          this.orbs.delete(o.id); this.ev.eat(o, s.idx);
        } else if (d < pull) { const f = Math.min(1, dt * 6 * (1 - d / pull) + dt * 2); o.x += dx * f; o.y += dy * f; }
      }
    }
    // 5. the ring sweeps orbs inward (everyone does this locally too), and keeps the map fed
    const edge = R - 0.7;
    for (const o of this.orbs.values()) {
      const d = Math.hypot(o.x, o.y);
      if (d > edge) { o.x *= edge / d; o.y *= edge / d; }
    }
    const goal = orbGoal(R, this.orbTarget);
    let natural = 0; for (const o of this.orbs.values()) if (!o.k) natural++;
    for (let i = 0; i < 4 && natural < goal; i++, natural++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (R - 2);
      this.addOrb(Math.cos(a) * d, Math.sin(a) * d, Math.random() < 0.12 ? 3 : Math.random() < 0.4 ? 2 : 1, Math.floor(Math.random() * 8), 0);
    }
  }

  standings() { return standingsOf(this.snakes.values()); }
}
