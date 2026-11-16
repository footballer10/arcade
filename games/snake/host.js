// Host-authoritative simulation: movement, boosting, orbs, collisions, deaths, the shrinking ring, rocks,
// Royale showdowns, Frenzy respawns, Golden Blooms and the King Snake bounty.
import { C, Trail, Grid, stepHead, radiusOf, lengthOf, ringAt, spawnOf, orbSize, orbGoal, standingsOf, inRock } from './sim.js';

const BODY_TMP = new Float32Array(2 * 400);
export const GOLD = 8;           // orb color index for gold
const RESPAWN = 2.5, GHOST = 2.2;

export class HostSim {
  // players: ctx.players. cfg: arenaCfg. orbs0: initialOrbs(). opts: { rocks, blooms }
  // events: { death(s, byId, cause), eat(orb, idx), add(orb), bloom(x, y, at), showdown(), respawn(s), king(s) }
  constructor(players, cfg, orbs0, events, opts = {}) {
    this.cfg = cfg; this.ev = events; this.t = 0; this.players = players;
    this.rocks = opts.rocks || []; this.blooms = !!opts.blooms; this.frenzy = cfg.mode === 'frenzy';
    this.snakes = new Map(); this.orbs = new Map(); this.grid = new Grid(); this.deaths = [];
    this.nextOrb = 100000; this.Rv = cfg.r0; this.showdown = false;
    this.nextBloom = 24 + Math.random() * 6; this.bloom = null; this.king = null;
    players.forEach((p, i) => {
      const sp = spawnOf(i, players.length, cfg.r0);
      const s = { id: p.id, idx: i, x: sp.x, y: sp.y, a: sp.a, v: 0, mass: C.START_MASS, alive: true, boost: false, trail: new Trail(), kills: 0, deaths: 0, deathT: 0, by: null, drop: 0, peak: C.START_MASS, ang: sp.a, wantBoost: false, ack: 0, ghost: 0, respawnAt: 0 };
      s.trail.reset(s.x, s.y, s.a, lengthOf(s.mass));
      this.snakes.set(p.id, s);
    });
    for (const o of orbs0) this.orbs.set(o.id, { ...o });
  }
  get R() { return this.Rv; }
  alive() { return [...this.snakes.values()].filter((s) => s.alive); }

  // rebuild from a client's view after host migration
  static fromView(players, cfg, view, events, opts) {
    const h = new HostSim(players, cfg, [], events, opts);
    for (const o of view.orbs.values()) h.orbs.set(o.id, { id: o.id, x: o.x, y: o.y, v: o.v, c: o.c, k: o.k });
    let mx = view.maxOrb || 0; for (const k of view.orbs.keys()) mx = Math.max(mx, k);
    h.nextOrb = Math.max(h.nextOrb, mx + 5000);
    h.t = view.t; h.Rv = view.R || ringAt(view.t, cfg); h.showdown = !!view.showdown;
    h.nextBloom = Math.max(view.t + 10, view.nextBloom || 0);
    for (const s of h.snakes.values()) {
      const v = view.snakes.get(s.id); if (!v) continue;
      Object.assign(s, { x: v.x, y: v.y, a: v.a, v: v.boost ? C.BOOST_SPEED : C.SPEED, mass: v.mass, alive: v.alive, kills: v.kills, deaths: v.deaths || 0, deathT: v.deathT || 0, peak: Math.max(v.mass, v.peak || 0), ang: v.a, ghost: v.ghost ? 1 : 0 });
      if (!s.alive && h.frenzy) s.respawnAt = view.t + 1;
      if (v.trail.x.length > 1) { s.trail.x = v.trail.x.slice(); s.trail.y = v.trail.y.slice(); s.trail.push(s.x, s.y); }
      else s.trail.reset(s.x, s.y, s.a, lengthOf(s.mass));
    }
    h.deaths = (view.deaths || []).slice();
    return h;
  }

  addOrb(x, y, v, c, kind = 0) {
    for (const r of this.rocks) {   // never inside a rock
      const d = Math.hypot(x - r.x, y - r.y);
      if (d < r.r + 0.5) { const f = (r.r + 0.6) / Math.max(0.01, d); x = r.x + (x - r.x) * f; y = r.y + (y - r.y) * f; }
    }
    const o = { id: this.nextOrb++, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, v: Math.round(v * 10) / 10, c, k: kind };
    this.orbs.set(o.id, o); this.ev.add(o); return o;
  }

  kill(s, byId, cause) {
    if (!s.alive) return;
    s.alive = false; s.deathT = this.t; s.by = byId; s.boost = false; s.deaths++;
    this.deaths.push(s.id);
    if (this.frenzy) s.respawnAt = this.t + RESPAWN;
    // burst into orbs along the body, in the snake's color (gold if it was the King Snake)
    const king = this.king === s.id;
    const r = radiusOf(s.mass), L = lengthOf(s.mass);
    const n = s.trail.sample(L, Math.max(0.9, r * 1.1), BODY_TMP, 200);
    const total = s.mass * C.DEATH_KEEP * (king ? 1.5 : 1), per = total / Math.max(1, n);
    for (let k = 0; k < n; k++) {
      const j = (Math.random() - 0.5) * r * 1.6, j2 = (Math.random() - 0.5) * r * 1.6;
      this.addOrb(BODY_TMP[k * 2] + j, BODY_TMP[k * 2 + 1] + j2, Math.max(1, per * (0.7 + Math.random() * 0.6)), king ? GOLD : s.idx, king ? 3 : 1);
    }
    if (byId && this.snakes.get(byId)) this.snakes.get(byId).kills++;
    if (king) this.king = null;
    this.ev.death(s, byId, cause, king);
  }

  respawn(s) {
    // the safest of a few random spots: furthest from every live head and body point
    const R = this.R;
    let best = null, bestD = -1;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R * 0.75;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (inRock(this.rocks, x, y, 5)) continue;
      let m = 1e9;
      this.grid.query(x, y, 14, (px, py) => { m = Math.min(m, Math.hypot(px - x, py - y)); return false; });
      if (m > bestD) { bestD = m; best = { x, y }; }
    }
    best ||= { x: 0, y: 0 };
    Object.assign(s, { x: best.x, y: best.y, a: Math.atan2(-best.y, -best.x) + (Math.random() - 0.5), v: C.SPEED, mass: C.START_MASS, alive: true, boost: false, ghost: GHOST, respawnAt: 0, drop: 0 });
    s.ang = s.a;
    s.trail.reset(s.x, s.y, s.a, lengthOf(s.mass));
    this.ev.respawn(s);
  }

  // inputs: (snake) -> { ang, boost }
  step(dt, inputOf) {
    this.t += dt;
    const cfg = this.cfg;
    // 0. the ring: follows the schedule, and races in for the Royale showdown
    this.Rv = Math.min(this.Rv, ringAt(this.t, cfg));
    const alive0 = this.alive();
    if (!this.frenzy && !this.showdown && this.players.length >= 4 && alive0.length <= 3 && alive0.length >= 2 && this.t > cfg.len * 0.4 && this.Rv > cfg.r1 + 4) {
      this.showdown = true; this.ev.showdown();
    }
    if (this.showdown) this.Rv = Math.max(cfg.r1, this.Rv - dt * 0.9);
    const R = this.Rv;
    // 1. move
    for (const s of this.snakes.values()) {
      if (!s.alive) { if (s.respawnAt && this.t >= s.respawnAt) this.respawn(s); continue; }
      if (s.ghost > 0) s.ghost = Math.max(0, s.ghost - dt);
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
    // 2. solid bodies into the grid (ghosts are not solid)
    const g = this.grid; g.clear();
    for (const s of this.snakes.values()) {
      if (!s.alive || s.ghost > 0) continue;
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
      if (s.ghost > 0) continue;
      if (inRock(this.rocks, s.x, s.y, r * 0.6)) { dead.push([s, null, 'rock']); continue; }
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
    const goal = orbGoal(R);
    let natural = 0; for (const o of this.orbs.values()) if (!o.k) natural++;
    for (let i = 0; i < 4 && natural < goal; i++, natural++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (R - 2), x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (inRock(this.rocks, x, y, 0.8)) continue;
      this.addOrb(x, y, Math.random() < 0.12 ? 3 : Math.random() < 0.4 ? 2 : 1, Math.floor(Math.random() * 8), 0);
    }
    // 6. Golden Bloom: a 3 s beacon, then a burst of gold
    if (this.blooms) {
      if (!this.bloom && this.t >= this.nextBloom - 3 && this.t < cfg.len - 8) {
        let x = 0, y = 0;
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * Math.PI * 2, d = R * (0.25 + Math.random() * 0.4);
          x = Math.cos(a) * d; y = Math.sin(a) * d;
          if (!inRock(this.rocks, x, y, 6)) break;
        }
        this.bloom = { x, y, at: this.t + 3 };
        this.ev.bloom(x, y, this.bloom.at);
      } else if (this.bloom && this.t >= this.bloom.at) {
        const { x, y } = this.bloom;
        for (let i = 0; i < 26; i++) {
          const a = i * 2.4, d = 0.8 + Math.sqrt(i) * 1.15;
          this.addOrb(x + Math.cos(a) * d, y + Math.sin(a) * d, 4, GOLD, 3);
        }
        this.bloom = null; this.nextBloom = this.t + 26 + Math.random() * 8;
      }
    }
    // 7. King Snake: the biggest living snake (clear leader, 3+ players) wears the crown
    if (this.players.length >= 3) {
      let top = null, second = 0;
      for (const s of this.snakes.values()) if (s.alive) { if (!top || s.mass > top.mass) { second = top ? top.mass : second; top = s; } else second = Math.max(second, s.mass); }
      const cur = this.king && this.snakes.get(this.king);
      let next = cur && cur.alive ? cur : null;
      if (top && top.mass >= 60 && (!next || top.mass > next.mass * 1.1)) next = top;
      if ((next?.id || null) !== this.king) { this.king = next?.id || null; if (next) this.ev.king(next); }
    }
  }

  standings() { return standingsOf(this.snakes.values()); }
}
