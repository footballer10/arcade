// Arena Royale - authoritative game simulation (runs on the host / locally).
// Pure logic, no rendering. Clients only use integrate() for prediction.

export const ARENA_R = 20;
export const PLAYER_R = 0.6;
export const WINS_TO_WIN = 3; // best of 5
export const STAGE_TIME = 30;
export const ZONE_STAGES = [20, 15.5, 11.5, 8, 4.5];
export const SUDDEN_DEATH = 150; // after this, zone collapses to 0 over 20s
export const MAX_PLAYERS = 8;
// Global balance knobs: lower dmg = longer rounds. 0.45 gives ~1.5 min rounds with 6 bots.
export const TUNE = { dmg: 0.45, kb: 1 };

export const OBSTACLES = [
  { x: 7, z: 5, r: 1.5 }, { x: -6, z: 7, r: 1.3 }, { x: -8, z: -5, r: 1.6 },
  { x: 5, z: -8, r: 1.2 }, { x: 13, z: -3, r: 1.1 }, { x: -13, z: 2, r: 1.2 },
  { x: 0, z: 13, r: 1.2 }, { x: 1, z: -14, r: 1.1 }, { x: 0, z: 0, r: 0.9 },
];

export const CHARS = {
  blaster:   { name: 'Blaster',   speed: 7.0, hp: 100, attack: 'Bolt',  special: 'Knockback Blast', atkCd: 0.26, spCd: 6.0 },
  brawler:   { name: 'Brawler',   speed: 6.4, hp: 125, attack: 'Punch', special: 'Ground Slam',     atkCd: 0.5,  spCd: 5.5 },
  trickster: { name: 'Trickster', speed: 8.8, hp: 90,  attack: 'Slash', special: 'Teleport',        atkCd: 0.28, spCd: 2.8 },
};
export const CHAR_KEYS = Object.keys(CHARS);

export const POWERUPS = ['speed', 'shield', 'dmg'];
export const DASH_CD = 1.4;
const DASH_SPEED = 24;
const TELEPORT_MAX = 7;

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

export function collideObstacles(p) {
  for (const o of OBSTACLES) {
    const dx = p.x - o.x, dz = p.z - o.z;
    const d = Math.hypot(dx, dz), min = o.r + PLAYER_R;
    if (d < min && d > 1e-4) {
      const nx = dx / d, nz = dz / d;
      p.x = o.x + nx * min; p.z = o.z + nz * min;
      // kill velocity into the obstacle (bounce a little for knockback)
      const kv = p.kbx * nx + p.kbz * nz;
      if (kv < 0) { p.kbx -= 1.5 * kv * nx; p.kbz -= 1.5 * kv * nz; }
      const dv = p.dvx * nx + p.dvz * nz;
      if (dv < 0) { p.dvx -= dv * nx; p.dvz -= dv * nz; }
    }
  }
}

// Shared movement integration (host sim + client prediction).
export function integrate(p, inp, dt, speedMul = 1) {
  const ch = CHARS[p.char];
  let mx = inp.mx || 0, mz = inp.mz || 0;
  const l = Math.hypot(mx, mz);
  if (l > 1) { mx /= l; mz /= l; }
  const kbMag = Math.hypot(p.kbx, p.kbz);
  const control = kbMag > 5 ? 0.25 : 1;
  const spd = ch.speed * speedMul * (p.slamT > 0 ? 0.4 : 1);
  const k = Math.min(1, dt * 14);
  p.mvx += (mx * spd * control - p.mvx) * k;
  p.mvz += (mz * spd * control - p.mvz) * k;
  const kd = Math.exp(-dt * 3.2); p.kbx *= kd; p.kbz *= kd;
  const dd = Math.exp(-dt * 9); p.dvx *= dd; p.dvz *= dd;
  p.x += (p.mvx + p.kbx + p.dvx) * dt;
  p.z += (p.mvz + p.kbz + p.dvz) * dt;
  collideObstacles(p);
}

export function applyDash(p, inp) {
  let dx = inp.mx || 0, dz = inp.mz || 0;
  const l = Math.hypot(dx, dz);
  if (l < 0.1) { dx = Math.cos(p.aim); dz = Math.sin(p.aim); } else { dx /= l; dz /= l; }
  p.dvx = dx * DASH_SPEED; p.dvz = dz * DASH_SPEED;
  p.dashCd = DASH_CD;
  p.invT = 0.15;
}

function rand(a, b) { return a + Math.random() * (b - a); }
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
const r2 = (v) => Math.round(v * 100) / 100;

export class Sim {
  constructor() {
    this.players = new Map();
    this.proj = [];
    this.pu = [];
    this.fx = [];
    this.phase = 'lobby';
    this.phaseT = 0;
    this.round = 0;
    this.t = 0;
    this.zoneR = ARENA_R;
    this.puTimer = 5;
    this.nextProj = 1;
    this.nextPu = 1;
    this.roundWinner = null;
    this.matchWinner = null;
  }

  addPlayer({ id, name, char, isBot, color }) {
    const p = {
      id, name, char: CHARS[char] ? char : 'blaster', isBot: !!isBot, color: color ?? 0,
      x: 0, z: 0, y: 0, aim: 0, hp: 100, maxHp: 100, alive: false, falling: false, fallT: 0,
      mvx: 0, mvz: 0, kbx: 0, kbz: 0, dvx: 0, dvz: 0,
      atkCd: 0, dashCd: 0, spCd: 0, slamT: 0, invT: 0, hitT: 0, swingT: 0,
      shield: 0, shieldT: 0, speedT: 0, dmgT: 0,
      wins: 0, kills: 0, lastHitBy: null, lastHitT: -99,
      dashSeq: 0, spSeq: 0, ack: 0, placement: 0,
    };
    this.players.set(id, p);
    return p;
  }
  removePlayer(id) { this.players.delete(id); }

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
    this.proj = [];
    this.pu = [];
    this.puTimer = rand(4, 7);
    this.roundWinner = null;
    const list = [...this.players.values()];
    const off = Math.random() * Math.PI * 2;
    // shuffle spawn slots
    const slots = list.map((_, i) => i).sort(() => Math.random() - 0.5);
    list.forEach((p, i) => {
      const a = off + (slots[i] / list.length) * Math.PI * 2;
      const ch = CHARS[p.char];
      Object.assign(p, {
        x: Math.cos(a) * 14, z: Math.sin(a) * 14, y: 0, aim: a + Math.PI,
        hp: ch.hp, maxHp: ch.hp, alive: true, falling: false, fallT: 0,
        mvx: 0, mvz: 0, kbx: 0, kbz: 0, dvx: 0, dvz: 0,
        atkCd: 0, dashCd: 0, spCd: 0, slamT: 0, invT: 0, hitT: 0, swingT: 0,
        shield: 0, shieldT: 0, speedT: 0, dmgT: 0, lastHitBy: null, lastHitT: -99, placement: 0,
      });
    });
  }

  aliveList() { return [...this.players.values()].filter((p) => p.alive); }

  step(dt, inputs) {
    if (this.phase === 'countdown') {
      this.phaseT -= dt;
      for (const p of this.players.values()) { const inp = inputs.get(p.id); if (inp) { p.aim = inp.aim; p.ack = inp.seq || 0; p.dashSeq = inp.dashSeq || 0; p.spSeq = inp.spSeq || 0; } }
      if (this.phaseT <= 0) { this.phase = 'play'; this.fx.push({ k: 'fight' }); }
      return;
    }
    if (this.phase === 'play') {
      this.t += dt;
      this.zoneR = zoneRadius(this.t);
      this.updatePlayers(dt, inputs, true);
      this.updateProjectiles(dt);
      this.updatePowerups(dt);
      this.checkRoundEnd();
      return;
    }
    if (this.phase === 'roundEnd') {
      this.phaseT -= dt;
      this.updatePlayers(dt, inputs, false);
      this.updateProjectiles(dt);
      if (this.phaseT <= 0) {
        if (this.matchWinner) { this.phase = 'matchEnd'; this.phaseT = 0; }
        else this.startRound();
      }
    }
  }

  updatePlayers(dt, inputs, active) {
    const stage = zoneStage(this.t);
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const inp = (active && inputs.get(p.id)) || { mx: 0, mz: 0, aim: p.aim };
      if (inputs.get(p.id)) p.ack = inputs.get(p.id).seq || 0;
      p.atkCd -= dt; p.dashCd -= dt; p.spCd -= dt; p.invT -= dt; p.hitT -= dt; p.swingT -= dt;
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
        if ((inp.spSeq || 0) !== p.spSeq) { p.spSeq = inp.spSeq || 0; if (p.spCd <= 0 && p.slamT <= 0) this.special(p, inp); }
        if (inp.atk && p.atkCd <= 0 && p.slamT <= 0) this.attack(p);
      }
      if (p.slamT > 0) { p.slamT -= dt; if (p.slamT <= 0) this.doSlam(p); }
      integrate(p, active ? inp : { mx: 0, mz: 0 }, dt, p.speedT > 0 ? 1.5 : 1);

      // zone damage
      const dc = Math.hypot(p.x, p.z);
      if (active && dc > this.zoneR) {
        this.damage(p, null, (6 + stage * 4) * dt, true);
        if (!p.alive) continue;
      }
      // off the edge
      if (dc > ARENA_R) { p.falling = true; p.fallT = 0; this.fx.push({ k: 'falling', id: p.id }); }
    }
    // player-player separation
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

  attack(p) {
    const ch = CHARS[p.char];
    p.atkCd = ch.atkCd;
    const ax = Math.cos(p.aim), az = Math.sin(p.aim);
    if (p.char === 'blaster') {
      this.proj.push({ id: this.nextProj++, owner: p.id, x: p.x + ax * 0.9, z: p.z + az * 0.9, vx: ax * 24, vz: az * 24, life: 0.75, dmg: 7, kb: 4.5, color: p.color });
      return;
    }
    const range = p.char === 'brawler' ? 2.6 : 2.1;
    const arc = p.char === 'brawler' ? 1.9 : 1.5;
    const dmg = p.char === 'brawler' ? 13 : 8;
    const kb = p.char === 'brawler' ? 10 : 6;
    p.swingT = 0.15;
    this.fx.push({ k: 'swing', x: r2(p.x), z: r2(p.z), a: r2(p.aim), r: range, arc, c: p.color });
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.falling) continue;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > range + PLAYER_R) continue;
      if (d > 0.8 && Math.abs(angDiff(Math.atan2(dz, dx), p.aim)) > arc / 2) continue;
      const nx = d > 1e-3 ? dx / d : ax, nz = d > 1e-3 ? dz / d : az;
      this.hit(q, p, dmg, nx * kb, nz * kb);
    }
  }

  special(p, inp) {
    const ch = CHARS[p.char];
    if (p.char === 'blaster') {
      p.spCd = ch.spCd;
      const R = 4.8;
      this.fx.push({ k: 'ring', x: r2(p.x), z: r2(p.z), r: R, c: p.color });
      for (const q of this.players.values()) {
        if (q === p || !q.alive || q.falling) continue;
        const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
        if (d > R + PLAYER_R) continue;
        const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
        this.hit(q, p, 6, nx * 22, nz * 22);
      }
      // destroy enemy bolts in range
      this.proj = this.proj.filter((b) => b.owner === p.id || Math.hypot(b.x - p.x, b.z - p.z) > R);
    } else if (p.char === 'brawler') {
      p.spCd = ch.spCd;
      p.slamT = 0.35;
      p.dvx = Math.cos(p.aim) * 11; p.dvz = Math.sin(p.aim) * 11;
      this.fx.push({ k: 'hop', id: p.id });
    } else if (p.char === 'trickster') {
      p.spCd = ch.spCd;
      let tx = inp.tx ?? p.x + Math.cos(p.aim) * TELEPORT_MAX, tz = inp.tz ?? p.z + Math.sin(p.aim) * TELEPORT_MAX;
      let dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.01) { dx = Math.cos(p.aim); dz = Math.sin(p.aim); d = 1; tx = p.x + dx * TELEPORT_MAX; tz = p.z + dz * TELEPORT_MAX; }
      if (d > TELEPORT_MAX) { tx = p.x + (dx / d) * TELEPORT_MAX; tz = p.z + (dz / d) * TELEPORT_MAX; }
      const fx = { k: 'tp', x0: r2(p.x), z0: r2(p.z), c: p.color };
      p.x = tx; p.z = tz; p.mvx *= 0.3; p.mvz *= 0.3; p.kbx *= 0.3; p.kbz *= 0.3; p.dvx = 0; p.dvz = 0;
      collideObstacles(p);
      p.invT = 0.25;
      fx.x1 = r2(p.x); fx.z1 = r2(p.z);
      this.fx.push(fx);
    }
  }

  doSlam(p) {
    const R = 5;
    this.fx.push({ k: 'ring', x: r2(p.x), z: r2(p.z), r: R, c: p.color, slam: 1 });
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.falling) continue;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > R + PLAYER_R) continue;
      const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
      const f = 1 - 0.4 * (d / R);
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
    this.fx.push({ k: 'hit', x: r2(q.x), z: r2(q.z), id: q.id, s: blocked ? 1 : 0 });
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

  updateProjectiles(dt) {
    const keep = [];
    for (const b of this.proj) {
      b.life -= dt;
      b.x += b.vx * dt; b.z += b.vz * dt;
      let dead = b.life <= 0 || Math.hypot(b.x, b.z) > ARENA_R + 3;
      if (!dead) for (const o of OBSTACLES) if (Math.hypot(b.x - o.x, b.z - o.z) < o.r + 0.2) { dead = true; this.fx.push({ k: 'spark', x: r2(b.x), z: r2(b.z), c: b.color }); break; }
      if (!dead) for (const q of this.players.values()) {
        if (q.id === b.owner || !q.alive || q.falling) continue;
        if (Math.hypot(q.x - b.x, q.z - b.z) < PLAYER_R + 0.3) {
          const owner = this.players.get(b.owner);
          const l = Math.hypot(b.vx, b.vz);
          if (this.hit(q, owner, b.dmg, (b.vx / l) * b.kb, (b.vz / l) * b.kb)) { dead = true; break; }
        }
      }
      if (!dead) keep.push(b);
    }
    this.proj = keep;
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
    if (falling.length) return; // wait for fallers to resolve
    if (standing.length <= 1 && (all.length > 1 || standing.length === 0)) {
      const w = standing[0];
      if (w) { w.wins++; w.placement = 1; this.roundWinner = w.id; if (w.wins >= WINS_TO_WIN) this.matchWinner = w.id; }
      this.phase = 'roundEnd';
      this.phaseT = 5.5;
      this.fx.push({ k: 'roundEnd', winner: w ? w.id : null });
    }
  }

  drainFx() { const f = this.fx; this.fx = []; return f; }

  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id, name: p.name, char: p.char, isBot: p.isBot, color: p.color,
        x: r2(p.x), z: r2(p.z), y: r2(p.y), aim: r2(p.aim), hp: Math.ceil(p.hp), maxHp: p.maxHp,
        alive: p.alive, falling: p.falling,
        mvx: r2(p.mvx), mvz: r2(p.mvz), kbx: r2(p.kbx), kbz: r2(p.kbz), dvx: r2(p.dvx), dvz: r2(p.dvz),
        dashCd: r2(Math.max(0, p.dashCd)), spCd: r2(Math.max(0, p.spCd)), slamT: r2(Math.max(0, p.slamT)),
        invT: r2(Math.max(0, p.invT)), hitT: r2(Math.max(0, p.hitT)), swingT: r2(Math.max(0, p.swingT)),
        shield: Math.ceil(p.shield), speedT: r2(Math.max(0, p.speedT)), dmgT: r2(Math.max(0, p.dmgT)),
        wins: p.wins, kills: p.kills, ack: p.ack, placement: p.placement,
      });
    }
    return {
      phase: this.phase, phaseT: r2(this.phaseT), round: this.round, t: r2(this.t), zoneR: r2(this.zoneR),
      roundWinner: this.roundWinner, matchWinner: this.matchWinner,
      players,
      proj: this.proj.map((b) => ({ id: b.id, x: r2(b.x), z: r2(b.z), vx: r2(b.vx), vz: r2(b.vz), color: b.color })),
      pu: this.pu.map((u) => ({ id: u.id, type: u.type, x: r2(u.x), z: r2(u.z) })),
    };
  }
}
