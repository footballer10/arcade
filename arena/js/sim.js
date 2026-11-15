// Arena Royale - authoritative game simulation (runs on the host / locally).
// Pure logic, no rendering. Clients use integrate()/setMap() for prediction.

export const ARENA_R = 20;
export const PLAYER_R = 0.6;
export const WINS_TO_WIN = 3; // best of 5
export const STAGE_TIME = 30;
export const ZONE_STAGES = [20, 15.5, 11.5, 8, 4.5];
export const SUDDEN_DEATH = 150; // after this, zone collapses to 0 over 20s
export const MAX_PLAYERS = 8;
export const TICK_RATE = 60;
export const MAX_REWIND = 18; // ticks (300 ms) of lag compensation
// Global balance knobs: lower dmg = longer rounds.
export const TUNE = { dmg: 0.3, kb: 0.9 };

// ---------------- maps ----------------
export const MAPS = {
  pillars: {
    name: 'Pillars',
    obstacles: [
      { x: 7, z: 5, r: 1.5 }, { x: -6, z: 7, r: 1.3 }, { x: -8, z: -5, r: 1.6 },
      { x: 5, z: -8, r: 1.2 }, { x: 13, z: -3, r: 1.1 }, { x: -13, z: 2, r: 1.2 },
      { x: 0, z: 13, r: 1.2 }, { x: 1, z: -14, r: 1.1 }, { x: 0, z: 0, r: 0.9 },
    ],
    holes: [], sweeper: null,
  },
  sweeper: {
    name: 'Sweeper',
    obstacles: [
      { x: 0, z: 0, r: 1.6 }, { x: 9, z: 9, r: 1.3 }, { x: -9, z: 9, r: 1.3 }, { x: 9, z: -9, r: 1.3 }, { x: -9, z: -9, r: 1.3 },
      { x: 14, z: 0, r: 1 }, { x: -14, z: 0, r: 1 },
    ],
    holes: [], sweeper: { len: 17.5, speed: 0.6, width: 0.6, kb: 12, dmg: 6 },
  },
  pits: {
    name: 'Pits & Bumpers',
    obstacles: [
      { x: 0, z: 0, r: 1.3, bumper: true }, { x: 9, z: -3, r: 1.1, bumper: true }, { x: -9, z: -3, r: 1.1, bumper: true },
      { x: 0, z: 10, r: 1.1, bumper: true }, { x: 12, z: 8, r: 1.3 }, { x: -12, z: 8, r: 1.3 }, { x: 0, z: -14, r: 1.3 },
    ],
    holes: [{ x: 6, z: 5.5, r: 2.1 }, { x: -6, z: 5.5, r: 2.1 }, { x: 0, z: -8, r: 2.3 }],
    sweeper: null,
  },
};
export const MAP_KEYS = Object.keys(MAPS);
// The current map (mutated in place so every module sees the same arrays).
export const OBSTACLES = [];
export const HOLES = [];
export const MAP = { key: 'pillars', sweeper: null };
export function setMap(key) {
  const m = MAPS[key] || MAPS.pillars;
  MAP.key = MAPS[key] ? key : 'pillars';
  OBSTACLES.length = 0; OBSTACLES.push(...m.obstacles.map((o) => ({ ...o })));
  HOLES.length = 0; HOLES.push(...m.holes.map((h) => ({ ...h })));
  MAP.sweeper = m.sweeper;
}
setMap('pillars');
export const sweeperAngle = (t) => (MAP.sweeper ? t * MAP.sweeper.speed : 0);

export const CHARS = {
  blaster:   { name: 'Blaster',   speed: 7.0, hp: 100, attack: 'Bolt',  special: 'Knockback Blast', atkCd: 0.3, spCd: 6.0 },
  brawler:   { name: 'Brawler',   speed: 6.9, hp: 140, attack: 'Punch', special: 'Ground Slam',     atkCd: 0.5,  spCd: 5.5 },
  trickster: { name: 'Trickster', speed: 8.8, hp: 95,  attack: 'Slash', special: 'Teleport',        atkCd: 0.28, spCd: 2.8 },
  bomber:    { name: 'Bomber',    speed: 6.8, hp: 110, attack: 'Lob Bomb', special: 'Gravity Well', atkCd: 0.8, spCd: 6.5 },
};
export const CHAR_KEYS = Object.keys(CHARS);

export const POWERUPS = ['speed', 'shield', 'dmg'];
export const DASH_CD = 1.4;
const DASH_SPEED = 24;
export const TELEPORT_MAX = 7;
export const BOMB_RANGE = 10;
export const WELL_RANGE = 9;
export const BLAST_R = 4.8, SLAM_R = 5, BOMB_R = 2.4;
export const PHASES = ['lobby', 'countdown', 'play', 'roundEnd', 'matchEnd'];

export function zoneRadius(t) {
  if (t >= SUDDEN_DEATH) return Math.max(0, ZONE_STAGES[4] * (1 - (t - SUDDEN_DEATH) / 20));
  const k = Math.floor(t / STAGE_TIME);
  if (k === 0) return ZONE_STAGES[0];
  if (k > 4) return ZONE_STAGES[4];
  const from = ZONE_STAGES[k - 1], to = ZONE_STAGES[k];
  const f = Math.min(1, (t - k * STAGE_TIME) / 4);
  return from + (to - from) * f;
}
export function zoneNextIn(t) {
  if (t < STAGE_TIME * 4) return STAGE_TIME - (t % STAGE_TIME);
  if (t < SUDDEN_DEATH) return SUDDEN_DEATH - t;
  return 0;
}
export function zoneStage(t) { return t >= SUDDEN_DEATH ? 5 : Math.min(4, Math.floor(t / STAGE_TIME)); }
export function inHole(x, z) { return HOLES.some((h) => Math.hypot(x - h.x, z - h.z) < h.r); }

// Push out of obstacles. Bumpers fling you away. Returns true if a bumper fired.
export function collideObstacles(p) {
  let bumped = false;
  for (const o of OBSTACLES) {
    const dx = p.x - o.x, dz = p.z - o.z;
    const d = Math.hypot(dx, dz), min = o.r + PLAYER_R;
    if (d < min && d > 1e-4) {
      const nx = dx / d, nz = dz / d;
      p.x = o.x + nx * min; p.z = o.z + nz * min;
      const kv = p.kbx * nx + p.kbz * nz;
      if (kv < 0) { p.kbx -= 1.5 * kv * nx; p.kbz -= 1.5 * kv * nz; }
      const dv = p.dvx * nx + p.dvz * nz;
      if (dv < 0) { p.dvx -= dv * nx; p.dvz -= dv * nz; }
      if (o.bumper && !(p.bumpT > 0)) { p.kbx += nx * 11; p.kbz += nz * 11; p.bumpT = 0.35; bumped = true; }
    }
  }
  return bumped;
}

// Shared movement integration (host sim + client prediction).
export function integrate(p, inp, dt, speedMul = 1) {
  const ch = CHARS[p.char];
  let mx = inp.mx || 0, mz = inp.mz || 0;
  const l = Math.hypot(mx, mz);
  if (l > 1) { mx /= l; mz /= l; }
  const kbMag = Math.hypot(p.kbx, p.kbz);
  const control = kbMag > 5 ? 0.25 : 1;
  const spd = ch.speed * speedMul * (p.slamT > 0 ? 0.4 : 1) * (p.blastT > 0 ? 0.5 : 1);
  const k = Math.min(1, dt * 14);
  p.mvx += (mx * spd * control - p.mvx) * k;
  p.mvz += (mz * spd * control - p.mvz) * k;
  const kd = Math.exp(-dt * 3.2); p.kbx *= kd; p.kbz *= kd;
  const dd = Math.exp(-dt * 9); p.dvx *= dd; p.dvz *= dd;
  if (p.bumpT > 0) p.bumpT -= dt;
  p.x += (p.mvx + p.kbx + p.dvx) * dt;
  p.z += (p.mvz + p.kbz + p.dvz) * dt;
  return collideObstacles(p);
}

export function applyDash(p, inp) {
  let dx = inp.mx || 0, dz = inp.mz || 0;
  const l = Math.hypot(dx, dz);
  if (l < 0.1) { dx = Math.cos(p.aim); dz = Math.sin(p.aim); } else { dx /= l; dz /= l; }
  p.dvx = dx * DASH_SPEED; p.dvz = dz * DASH_SPEED;
  p.dashCd = DASH_CD;
  p.invT = 0.15;
}

export function clampTo(px, pz, tx, tz, max, min = 0) {
  let dx = tx - px, dz = tz - pz; const d = Math.hypot(dx, dz);
  if (d < 1e-3) return { x: px, z: pz, d: 0 };
  const k = d > max ? max / d : d < min ? min / d : 1;
  return { x: px + dx * k, z: pz + dz * k, d: Math.min(max, Math.max(min, d)) };
}

function rand(a, b) { return a + Math.random() * (b - a); }
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
const r2 = (v) => Math.round(v * 100) / 100;

const FRESH = () => ({
  x: 0, z: 0, y: 0, hp: 100, maxHp: 100, alive: false, falling: false, fallT: 0,
  mvx: 0, mvz: 0, kbx: 0, kbz: 0, dvx: 0, dvz: 0,
  atkCd: 0, dashCd: 0, spCd: 0, slamT: 0, blastT: 0, invT: 0, hitT: 0, swingT: 0, bumpT: 0, sweepT: 0,
  shield: 0, shieldT: 0, speedT: 0, dmgT: 0, lastHitBy: null, lastHitT: -99, placement: 0, hist: [],
});

export class Sim {
  constructor(mapKey = 'pillars') {
    setMap(mapKey);
    this.map = MAP.key;
    this.botLevel = 'normal';
    this.players = new Map();
    this.proj = [];
    this.pu = [];
    this.wells = [];
    this.fx = [];
    this.phase = 'lobby';
    this.phaseT = 0;
    this.round = 0;
    this.t = 0;
    this.tick = 0;
    this.zoneR = ARENA_R;
    this.puTimer = 5;
    this.nextProj = 1;
    this.nextPu = 1;
    this.roundWinner = null;
    this.matchWinner = null;
  }

  addPlayer({ id, name, char, isBot, color, n }) {
    const p = {
      ...FRESH(), id, name, char: CHARS[char] ? char : 'blaster', isBot: !!isBot, color: color ?? 0, n: n ?? this.players.size,
      aim: 0, wins: 0, kills: 0, dashSeq: 0, spSeq: 0, ack: 0, rw: 0,
    };
    this.players.set(id, p);
    return p;
  }
  removePlayer(id) { this.players.delete(id); }

  // Rebuild a running game from a client's latest snapshot (host migration).
  static fromSnapshot(s, roster, mapKey, botLevel) {
    const sim = new Sim(mapKey);
    sim.botLevel = botLevel || 'normal';
    Object.assign(sim, { phase: s.phase, phaseT: s.phaseT, round: s.round, t: s.t, tick: s.tick, zoneR: s.zoneR, roundWinner: s.roundWinner, matchWinner: s.matchWinner });
    for (const r of roster) {
      const p = sim.addPlayer(r);
      const sp = s.players.find((q) => q.id === r.id);
      if (sp) {
        for (const k of ['x', 'z', 'y', 'aim', 'hp', 'maxHp', 'alive', 'falling', 'mvx', 'mvz', 'kbx', 'kbz', 'dvx', 'dvz', 'dashCd', 'spCd', 'slamT', 'blastT', 'invT', 'shield', 'speedT', 'dmgT', 'wins', 'kills', 'placement']) if (sp[k] !== undefined) p[k] = sp[k];
        if (p.shield > 0) p.shieldT = 8;
        if (p.falling) p.fallT = 0.5;
      }
    }
    for (const b of s.proj) {
      if (b.kind === 1) sim.proj.push({ id: sim.nextProj++, kind: 'bomb', owner: null, x0: b.x, z0: b.z, x: b.x, z: b.z, tx: b.tx, tz: b.tz, t: 0, T: Math.max(0.05, b.T * (1 - b.f)), color: b.color, rw: 0 });
      else sim.proj.push({ id: sim.nextProj++, kind: 'bolt', owner: null, x: b.x, z: b.z, vx: b.vx, vz: b.vz, life: 0.4, dmg: 7, kb: 4.5, color: b.color, rw: 0 });
    }
    sim.pu = s.pu.map((u) => ({ ...u, life: 15 }));
    sim.nextPu = Math.max(1, ...s.pu.map((u) => u.id + 1));
    return sim;
  }

  startMatch() {
    for (const p of this.players.values()) { p.wins = 0; p.kills = 0; }
    this.round = 0;
    this.matchWinner = null;
    this.startRound();
  }

  startRound() {
    this.round++;
    this.phase = 'countdown';
    this.phaseT = 3;
    this.t = 0;
    this.zoneR = ARENA_R;
    this.proj = []; this.pu = []; this.wells = [];
    this.puTimer = rand(4, 7);
    this.roundWinner = null;
    const list = [...this.players.values()];
    const off = Math.random() * Math.PI * 2;
    const slots = list.map((_, i) => i).sort(() => Math.random() - 0.5);
    list.forEach((p, i) => {
      const a = off + (slots[i] / list.length) * Math.PI * 2;
      const ch = CHARS[p.char];
      Object.assign(p, FRESH(), { x: Math.cos(a) * 14, z: Math.sin(a) * 14, aim: a + Math.PI, hp: ch.hp, maxHp: ch.hp, alive: true });
      for (let k = 0; k < 3; k++) collideObstacles(p);
      if (inHole(p.x, p.z)) { p.x *= 0.8; p.z *= 0.8; }
    });
  }

  aliveList() { return [...this.players.values()].filter((p) => p.alive); }

  // Lag compensation: where was q `k` ticks ago?
  posAt(q, k) {
    if (!k || !q.hist.length) return q;
    const h = q.hist[Math.max(0, q.hist.length - 1 - k)];
    return { x: h[0], z: h[1] };
  }

  step(dt, inputs) {
    this.tick++;
    if (this.phase === 'countdown') {
      this.phaseT -= dt;
      for (const p of this.players.values()) { const inp = inputs.get(p.id); if (inp) { p.aim = inp.aim; p.ack = inp.seq || 0; p.dashSeq = inp.dashSeq || 0; p.spSeq = inp.spSeq || 0; } }
      if (this.phaseT <= 0) { this.phase = 'play'; this.fx.push({ k: 'fight' }); }
      return;
    }
    if (this.phase === 'play') {
      const prevStage = zoneStage(this.t);
      this.t += dt;
      if (zoneStage(this.t) !== prevStage) this.fx.push({ k: 'zone' });
      this.zoneR = zoneRadius(this.t);
      this.updatePlayers(dt, inputs, true);
      this.updateHazards(dt);
      this.updateProjectiles(dt);
      this.updatePowerups(dt);
      this.recordHistory();
      this.checkRoundEnd();
      return;
    }
    if (this.phase === 'roundEnd') {
      this.phaseT -= dt;
      this.updatePlayers(dt, inputs, false);
      this.updateProjectiles(dt);
      this.recordHistory();
      if (this.phaseT <= 0) {
        if (this.matchWinner) { this.phase = 'matchEnd'; this.phaseT = 0; }
        else this.startRound();
      }
    }
  }

  recordHistory() {
    for (const p of this.players.values()) { p.hist.push([p.x, p.z]); if (p.hist.length > MAX_REWIND + 2) p.hist.shift(); }
  }

  updatePlayers(dt, inputs, active) {
    const stage = zoneStage(this.t);
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const raw = inputs.get(p.id);
      const inp = (active && raw) || { mx: 0, mz: 0, aim: p.aim };
      if (raw) {
        p.ack = raw.seq || 0;
        p.rw = raw.vt ? Math.max(0, Math.min(MAX_REWIND, this.tick - raw.vt)) : 0;
      }
      p.atkCd -= dt; p.dashCd -= dt; p.spCd -= dt; p.invT -= dt; p.hitT -= dt; p.swingT -= dt; p.sweepT -= dt;
      p.speedT -= dt; p.dmgT -= dt; p.shieldT -= dt;
      if (p.shieldT <= 0) p.shield = 0;

      if (p.falling) {
        p.fallT += dt;
        p.y -= (2 + p.fallT * 18) * dt;
        p.x += (p.mvx + p.kbx + p.dvx) * dt * 0.6;
        p.z += (p.mvz + p.kbz + p.dvz) * dt * 0.6;
        if (p.fallT > 1.1) this.eliminate(p, 'fall');
        continue;
      }
      if (active) {
        p.aim = inp.aim ?? p.aim;
        if ((inp.dashSeq || 0) !== p.dashSeq) { p.dashSeq = inp.dashSeq || 0; if (p.dashCd <= 0) { applyDash(p, inp); this.fx.push({ k: 'dash', x: r2(p.x), z: r2(p.z), id: p.id }); } }
        if ((inp.spSeq || 0) !== p.spSeq) { p.spSeq = inp.spSeq || 0; if (p.spCd <= 0 && p.slamT <= 0 && p.blastT <= 0) this.special(p, inp); }
        if (inp.atk && p.atkCd <= 0 && p.slamT <= 0 && p.blastT <= 0) this.attack(p, inp);
      }
      if (p.slamT > 0) { p.slamT -= dt; if (p.slamT <= 0) this.doSlam(p); }
      if (p.blastT > 0) { p.blastT -= dt; if (p.blastT <= 0) this.doBlast(p); }
      if (integrate(p, active ? inp : { mx: 0, mz: 0 }, dt, p.speedT > 0 ? 1.5 : 1)) this.fx.push({ k: 'bump', x: r2(p.x), z: r2(p.z), id: p.id });

      const dc = Math.hypot(p.x, p.z);
      if (active && dc > this.zoneR) {
        this.damage(p, null, (5 + stage * 4) * dt, true);
        if (!p.alive) continue;
      }
      if (dc > ARENA_R || inHole(p.x, p.z)) { p.falling = true; p.fallT = 0; this.fx.push({ k: 'falling', id: p.id, x: r2(p.x), z: r2(p.z) }); }
    }
    const arr = [...this.players.values()].filter((p) => p.alive && !p.falling);
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = PLAYER_R * 2;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
      }
    }
  }

  // targets near (x,z) as the attacker saw them (rewound by attacker.rw ticks)
  *targets(p, x, z, R, rw) {
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.falling) continue;
      const pos = this.posAt(q, rw);
      const dx = pos.x - x, dz = pos.z - z, d = Math.hypot(dx, dz);
      if (d > R + PLAYER_R) continue;
      yield { q, dx, dz, d };
    }
  }

  attack(p, inp) {
    const ch = CHARS[p.char];
    p.atkCd = ch.atkCd;
    const ax = Math.cos(p.aim), az = Math.sin(p.aim);
    if (p.char === 'blaster') {
      this.proj.push({ id: this.nextProj++, kind: 'bolt', owner: p.id, x: p.x + ax * 0.9, z: p.z + az * 0.9, vx: ax * 24, vz: az * 24, life: 0.75, dmg: 6, kb: 3, color: p.color, rw: p.rw });
      this.fx.push({ k: 'shot', x: r2(p.x), z: r2(p.z), id: p.id });
      return;
    }
    if (p.char === 'bomber') {
      const tgt = clampTo(p.x, p.z, inp.tx ?? p.x + ax * 6, inp.tz ?? p.z + az * 6, BOMB_RANGE, 2);
      this.proj.push({ id: this.nextProj++, kind: 'bomb', owner: p.id, x0: p.x, z0: p.z, x: p.x, z: p.z, tx: tgt.x, tz: tgt.z, t: 0, T: 0.35 + tgt.d * 0.04, color: p.color, rw: p.rw });
      this.fx.push({ k: 'lob', x: r2(p.x), z: r2(p.z), id: p.id });
      return;
    }
    const range = p.char === 'brawler' ? 2.8 : 2.2;
    const arc = p.char === 'brawler' ? 1.9 : 1.5;
    const dmg = p.char === 'brawler' ? 14 : 9;
    const kb = p.char === 'brawler' ? 10 : 6;
    p.swingT = 0.15;
    this.fx.push({ k: 'swing', x: r2(p.x), z: r2(p.z), a: r2(p.aim), r: range, arc, c: p.color, id: p.id });
    for (const { q, dx, dz, d } of this.targets(p, p.x, p.z, range, p.rw)) {
      if (d > 0.8 && Math.abs(angDiff(Math.atan2(dz, dx), p.aim)) > arc / 2) continue;
      const nx = d > 1e-3 ? dx / d : ax, nz = d > 1e-3 ? dz / d : az;
      this.hit(q, p, dmg, nx * kb, nz * kb);
    }
  }

  special(p, inp) {
    const ch = CHARS[p.char];
    p.spCd = ch.spCd;
    if (p.char === 'blaster') {
      p.blastT = 0.18; // short wind-up = telegraph
      this.fx.push({ k: 'charge', id: p.id });
    } else if (p.char === 'brawler') {
      p.slamT = 0.35;
      p.dvx = Math.cos(p.aim) * 11; p.dvz = Math.sin(p.aim) * 11;
      this.fx.push({ k: 'hop', id: p.id });
    } else if (p.char === 'trickster') {
      let tx = inp.tx ?? p.x + Math.cos(p.aim) * TELEPORT_MAX, tz = inp.tz ?? p.z + Math.sin(p.aim) * TELEPORT_MAX;
      if (Math.hypot(tx - p.x, tz - p.z) < 0.05) { tx = p.x + Math.cos(p.aim) * TELEPORT_MAX; tz = p.z + Math.sin(p.aim) * TELEPORT_MAX; }
      const dst = clampTo(p.x, p.z, tx, tz, TELEPORT_MAX);
      const fx = { k: 'tp', x0: r2(p.x), z0: r2(p.z), c: p.color, id: p.id };
      p.x = dst.x; p.z = dst.z; p.mvx *= 0.3; p.mvz *= 0.3; p.kbx *= 0.3; p.kbz *= 0.3; p.dvx = 0; p.dvz = 0;
      collideObstacles(p);
      p.invT = 0.25;
      fx.x1 = r2(p.x); fx.z1 = r2(p.z);
      this.fx.push(fx);
    } else if (p.char === 'bomber') {
      const w = clampTo(p.x, p.z, inp.tx ?? p.x + Math.cos(p.aim) * 6, inp.tz ?? p.z + Math.sin(p.aim) * 6, WELL_RANGE);
      this.wells.push({ x: w.x, z: w.z, t: 1.6, r: 5.5, owner: p.id, color: p.color });
      this.fx.push({ k: 'well', x: r2(w.x), z: r2(w.z), id: p.id });
    }
  }

  doBlast(p) {
    this.fx.push({ k: 'ring', x: r2(p.x), z: r2(p.z), r: BLAST_R, c: p.color, id: p.id });
    for (const { q, dx, dz, d } of this.targets(p, p.x, p.z, BLAST_R, p.rw)) {
      const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
      this.hit(q, p, 6, nx * 22, nz * 22);
    }
    this.proj = this.proj.filter((b) => b.owner === p.id || b.kind !== 'bolt' || Math.hypot(b.x - p.x, b.z - p.z) > BLAST_R);
  }

  doSlam(p) {
    this.fx.push({ k: 'ring', x: r2(p.x), z: r2(p.z), r: SLAM_R, c: p.color, slam: 1, id: p.id });
    for (const { q, dx, dz, d } of this.targets(p, p.x, p.z, SLAM_R, p.rw)) {
      const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
      const f = 1 - 0.4 * (d / SLAM_R);
      this.hit(q, p, 16 * f, nx * 18 * f, nz * 18 * f);
    }
  }

  hit(q, attacker, dmg, kbx, kbz) {
    if (q.invT > 0) return false;
    dmg *= TUNE.dmg; kbx *= TUNE.kb; kbz *= TUNE.kb;
    if (attacker && attacker.dmgT > 0) { dmg *= 1.6; kbx *= 1.25; kbz *= 1.25; }
    const blocked = q.shield > 0;
    this.damage(q, attacker, dmg, false);
    const mult = (1 + (1 - Math.max(0, q.hp) / q.maxHp) * 1.3) * (blocked ? 0.5 : 1);
    q.kbx += kbx * mult; q.kbz += kbz * mult;
    q.hitT = 0.15;
    this.fx.push({ k: 'hit', x: r2(q.x), z: r2(q.z), id: q.id, by: attacker ? attacker.id : null, s: blocked ? 1 : 0, d: Math.round(dmg * 10) / 10 });
    return true;
  }

  damage(q, attacker, dmg, isZone) {
    if (!q.alive || q.falling) return;
    if (q.shield > 0 && !isZone) {
      const a = Math.min(q.shield, dmg); q.shield -= a; dmg -= a;
      if (q.shield <= 0) { q.shield = 0; q.shieldT = 0; }
    }
    q.hp -= dmg;
    if (attacker) { q.lastHitBy = attacker.id; q.lastHitT = this.t; }
    if (q.hp <= 0) { q.hp = 0; this.eliminate(q, isZone ? 'zone' : 'ko'); }
  }

  eliminate(p, how) {
    if (!p.alive) return;
    p.alive = false;
    p.falling = false;
    p.placement = this.aliveList().length + 1;
    let by = null;
    if (p.lastHitBy && this.t - p.lastHitT < 6 && p.lastHitBy !== p.id) {
      const k = this.players.get(p.lastHitBy);
      if (k) { k.kills++; by = k.id; }
    }
    this.fx.push({ k: 'elim', id: p.id, by, how, x: r2(p.x), z: r2(p.z), c: p.color });
  }

  updateHazards(dt) {
    // gravity wells pull enemies toward their centre
    this.wells = this.wells.filter((w) => {
      w.t -= dt;
      const owner = this.players.get(w.owner);
      for (const q of this.players.values()) {
        if (q.id === w.owner || !q.alive || q.falling) continue;
        const dx = w.x - q.x, dz = w.z - q.z, d = Math.hypot(dx, dz);
        if (d > w.r || d < 0.2) continue;
        const pull = 34 * dt * (0.4 + 0.6 * (1 - d / w.r));
        q.kbx += (dx / d) * pull; q.kbz += (dz / d) * pull;
        if (owner) { q.lastHitBy = owner.id; q.lastHitT = this.t; }
      }
      return w.t > 0;
    });
    // rotating sweeper beam
    const sw = MAP.sweeper;
    if (sw) {
      const ang = sweeperAngle(this.t);
      const bx = Math.cos(ang), bz = Math.sin(ang);
      for (const q of this.players.values()) {
        if (!q.alive || q.falling || q.invT > 0 || q.sweepT > 0) continue;
        const along = q.x * bx + q.z * bz, perp = -q.x * bz + q.z * bx;
        if (along < 1 || along > sw.len || Math.abs(perp) > sw.width + PLAYER_R) continue;
        // pushed in the direction of rotation, and a little outward
        const tx = -bz, tz = bx;
        q.sweepT = 0.6;
        this.hit(q, null, sw.dmg, tx * sw.kb + bx * 4, tz * sw.kb + bz * 4);
        this.fx.push({ k: 'sweep', x: r2(q.x), z: r2(q.z), id: q.id });
      }
    }
  }

  updateProjectiles(dt) {
    const keep = [];
    for (const b of this.proj) {
      if (b.kind === 'bomb') {
        b.t += dt;
        const f = Math.min(1, b.t / b.T);
        b.x = b.x0 + (b.tx - b.x0) * f; b.z = b.z0 + (b.tz - b.z0) * f;
        if (f >= 1) this.explode(b); else keep.push(b);
        continue;
      }
      b.life -= dt;
      b.x += b.vx * dt; b.z += b.vz * dt;
      let dead = b.life <= 0 || Math.hypot(b.x, b.z) > ARENA_R + 3;
      if (!dead) for (const o of OBSTACLES) if (Math.hypot(b.x - o.x, b.z - o.z) < o.r + 0.2) { dead = true; this.fx.push({ k: 'spark', x: r2(b.x), z: r2(b.z), c: b.color }); break; }
      if (!dead) for (const q of this.players.values()) {
        if (q.id === b.owner || !q.alive || q.falling) continue;
        const pos = this.posAt(q, b.rw);
        if (Math.hypot(pos.x - b.x, pos.z - b.z) < PLAYER_R + 0.3) {
          const owner = this.players.get(b.owner);
          const l = Math.hypot(b.vx, b.vz);
          if (this.hit(q, owner, b.dmg, (b.vx / l) * b.kb, (b.vz / l) * b.kb)) { dead = true; break; }
        }
      }
      if (!dead) keep.push(b);
    }
    this.proj = keep;
  }

  explode(b) {
    const owner = this.players.get(b.owner) || null;
    this.fx.push({ k: 'boom', x: r2(b.tx), z: r2(b.tz), r: BOMB_R, c: b.color, id: b.owner });
    for (const q of this.players.values()) {
      if (!q.alive || q.falling) continue;
      const pos = q.id === b.owner ? q : this.posAt(q, b.rw);
      const dx = pos.x - b.tx, dz = pos.z - b.tz, d = Math.hypot(dx, dz);
      if (d > BOMB_R + PLAYER_R) continue;
      const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
      const self = q.id === b.owner ? 0.35 : 1; // bombers can rocket-jump a bit
      this.hit(q, owner, 11 * self, nx * 13, nz * 13);
    }
  }

  updatePowerups(dt) {
    this.puTimer -= dt;
    const zr = Math.min(this.zoneR, ARENA_R);
    if (this.puTimer <= 0) {
      this.puTimer = rand(6, 11);
      if (this.pu.length < 3 && zr > 3) {
        for (let tries = 0; tries < 20; tries++) {
          const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * zr * 0.8;
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          if (OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 1)) continue;
          if (HOLES.some((h) => Math.hypot(x - h.x, z - h.z) < h.r + 1)) continue;
          this.pu.push({ id: this.nextPu++, type: POWERUPS[Math.floor(Math.random() * 3)], x, z, life: 20 });
          break;
        }
      }
    }
    const keep = [];
    for (const u of this.pu) {
      u.life -= dt;
      if (u.life <= 0 || Math.hypot(u.x, u.z) > zr + 0.5) continue;
      let taken = false;
      for (const p of this.players.values()) {
        if (!p.alive || p.falling) continue;
        if (Math.hypot(p.x - u.x, p.z - u.z) < 1.3) {
          if (u.type === 'speed') p.speedT = 7;
          else if (u.type === 'shield') { p.shield = 40; p.shieldT = 10; }
          else p.dmgT = 8;
          this.fx.push({ k: 'pickup', id: p.id, type: u.type, x: r2(u.x), z: r2(u.z) });
          taken = true; break;
        }
      }
      if (!taken) keep.push(u);
    }
    this.pu = keep;
  }

  checkRoundEnd() {
    const all = [...this.players.values()];
    const standing = all.filter((p) => p.alive && !p.falling);
    const falling = all.filter((p) => p.alive && p.falling);
    if (falling.length) return;
    if (standing.length <= 1 && (all.length > 1 || standing.length === 0)) {
      const w = standing[0];
      if (w) { w.wins++; w.placement = 1; this.roundWinner = w.id; if (w.wins >= WINS_TO_WIN) this.matchWinner = w.id; }
      this.phase = 'roundEnd';
      this.phaseT = 5.5;
      this.fx.push({ k: 'roundEnd', winner: w ? w.id : null });
    }
  }

  drainFx() { const f = this.fx; this.fx = []; return f; }

  // Plain-object view of the state. Used directly by the host renderer and encoded to binary for clients.
  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id, n: p.n, name: p.name, char: p.char, isBot: p.isBot, color: p.color,
        x: p.x, z: p.z, y: p.y, aim: p.aim, hp: Math.ceil(p.hp), maxHp: p.maxHp,
        alive: p.alive, falling: p.falling,
        mvx: p.mvx, mvz: p.mvz, kbx: p.kbx, kbz: p.kbz, dvx: p.dvx, dvz: p.dvz,
        dashCd: Math.max(0, p.dashCd), spCd: Math.max(0, p.spCd), slamT: Math.max(0, p.slamT), blastT: Math.max(0, p.blastT),
        invT: Math.max(0, p.invT), hitT: Math.max(0, p.hitT), swingT: Math.max(0, p.swingT),
        shield: Math.ceil(p.shield), speedT: Math.max(0, p.speedT), dmgT: Math.max(0, p.dmgT),
        wins: p.wins, kills: p.kills, ack: p.ack, placement: p.placement,
      });
    }
    return {
      tick: this.tick, phase: this.phase, phaseT: this.phaseT, round: this.round, t: this.t, zoneR: this.zoneR,
      roundWinner: this.roundWinner, matchWinner: this.matchWinner,
      players,
      proj: this.proj.map((b) => b.kind === 'bomb'
        ? { id: b.id, kind: 1, color: b.color, x: b.x, z: b.z, tx: b.tx, tz: b.tz, f: Math.min(1, b.t / b.T), T: b.T }
        : { id: b.id, kind: 0, color: b.color, x: b.x, z: b.z, vx: b.vx, vz: b.vz }),
      pu: this.pu.map((u) => ({ id: u.id, type: u.type, x: u.x, z: u.z })),
      wells: this.wells.map((w) => ({ x: w.x, z: w.z, t: w.t, r: w.r, color: w.color })),
    };
  }
}
