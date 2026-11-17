// SNAKE ROYALE — slither-style battle royale. Eat orbs to grow, boost by shedding length, pop anyone whose head
// hits your body. A glowing ring closes in and sweeps every orb inward, so the richest food piles up right at
// the deadly edge. Last snake alive (or the biggest when time runs out) wins.
//
// Net model: the host runs HostSim at 60 Hz (bots too) and sends 20 Hz binary snapshots of every head; clients
// rebuild bodies from the head paths they see, predict their own snake (input replay + smoothed correction) and
// get orb spawns / eats / deaths as reliable batched messages.
export { manifest } from './manifest.js';
import './tuning.js';
import { C, Trail, stepHead, radiusOf, lengthOf, ringAt, arenaCfg, spawnOf, initialOrbs, orbGoal, wrapA, standingsOf, encodeSnap, decodeSnap, encodeInput, decodeInput, makeRocks, inRock } from './sim.js';
import { HostSim } from './host.js';
import { makeBot, botThink } from './bots.js';
import { createView } from './render.js';
import { createSound } from './audio.js';

const CSS = `
.snk-tag,.snk-feed,.snk-map,.snk-hint,.snk-arrow{z-index:2}
.snk-tag{position:absolute;left:0;top:0;pointer-events:none;font:1rem var(--font);color:#fff;white-space:nowrap;
  text-shadow:var(--stroke);padding:0 8px;border-radius:10px;background:color-mix(in srgb,var(--c) 45%,transparent);border:2px solid var(--ink)}
.snk-feed{position:absolute;left:14px;top:84px;display:flex;flex-direction:column;gap:5px;pointer-events:none;font:.95rem var(--font)}
.snk-feed div{background:rgba(23,17,46,.82);border:3px solid var(--ink);border-radius:12px;padding:2px 10px;color:#fff;text-shadow:var(--stroke);animation:snkIn .25s ease-out}
.snk-feed b{font-weight:400}
.snk-map{position:absolute;right:14px;bottom:14px;width:150px;height:150px;border-radius:50%;border:4px solid var(--ink);background:rgba(11,8,32,.75);pointer-events:none}
.snk-arrow{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;font:1.6rem var(--font);color:#ffd23f;text-shadow:var(--stroke)}
.snk-arrow i{position:absolute;transform:translate(-50%,-50%);font-style:normal}
.snk-fx{position:absolute;inset:0;pointer-events:none;z-index:1}
.snk-flash{position:absolute;inset:0;pointer-events:none;z-index:1;background:#fff;opacity:0;transition:opacity .45s ease-out}
.snk-hint{position:absolute;left:50%;bottom:92px;transform:translateX(-50%);font:1rem var(--font);color:#fff;text-shadow:var(--stroke);pointer-events:none;opacity:.9}
@keyframes snkIn{from{transform:translateX(-30px);opacity:0}to{transform:none;opacity:1}}
`;

export async function start(ctx) {
  const { ui, input, net } = ctx;
  const N = ctx.players.length;
  const LEN = +(ctx.options.len || 150);
  const MODE = ctx.options.mode === 'frenzy' ? 'frenzy' : 'royale', FRENZY = MODE === 'frenzy';
  const cfg = arenaCfg(LEN, N, MODE);
  const mapRng = ctx.rng(0x70c);
  const MAP = ctx.options.map === 'rocks' || (ctx.options.map !== 'open' && mapRng() < 0.5) ? 'rocks' : 'open';
  cfg.rocks = MAP === 'rocks' ? makeRocks(mapRng, cfg, N) : [];
  const BLOOMS = ctx.options.blooms !== 'off';
  const skinOf = (id) => ctx.picks[id]?.skin || 'stripes';
  const myIdx = ctx.players.findIndex((p) => p.id === ctx.myId);
  const orbs0 = initialOrbs(ctx.rng(0x0b5), cfg.r0, orbGoal(cfg.r0)).filter((o) => !inRock(cfg.rocks, o.x, o.y, 0.8));

  const style = document.createElement('style'); style.textContent = CSS; ctx.container.appendChild(style);
  const feed = document.createElement('div'); feed.className = 'snk-feed'; ctx.container.appendChild(feed);
  const map = document.createElement('canvas'); map.className = 'snk-map'; map.width = map.height = 150; ctx.container.appendChild(map);
  const hint = document.createElement('div'); hint.className = 'snk-hint'; ctx.container.appendChild(hint);
  const arrow = document.createElement('div'); arrow.className = 'snk-arrow'; arrow.innerHTML = '<i>➤</i>'; ctx.container.appendChild(arrow);
  const mg = map.getContext('2d');
  const fx = document.createElement('div'); fx.className = 'snk-fx'; ctx.container.appendChild(fx);
  const flash = document.createElement('div'); flash.className = 'snk-flash'; ctx.container.appendChild(flash);
  const doFlash = (color = '#fff', o = 0.55) => { flash.style.transition = 'none'; flash.style.background = color; flash.style.opacity = o; void flash.offsetWidth; flash.style.transition = ''; flash.style.opacity = 0; };
  const t0 = performance.now();

  const gfx = createView(ctx, cfg);
  ctx.on('resize', gfx.resize);
  ctx.on('settings', (k) => { if (k === 'quality') gfx.setQuality(); });
  const sfx = createSound(ctx.audio);

  // ---------------------------------------------------------------- client view of the world (everyone keeps one)
  const V = { t: 0, R: cfg.r0, snakes: new Map(), orbs: new Map(), deaths: [], maxOrb: 0, full: !ctx.spectator, bloom: null, king: null, showdown: false, nextBloom: 0 };
  ctx.players.forEach((p, i) => {
    const sp = spawnOf(i, N, cfg.r0);
    const v = { id: p.id, idx: i, p, x: sp.x, y: sp.y, a: sp.a, aim: sp.a, mass: C.START_MASS, alive: true, boost: false, ghost: false, kills: 0, deaths: 0, deathT: 0, trail: new Trail(), buf: [] };
    v.trail.reset(v.x, v.y, v.a, lengthOf(v.mass));
    V.snakes.set(p.id, v);
  });
  for (const o of orbs0) V.orbs.set(o.id, { ...o });
  const flying = [];          // orbs being slurped into a mouth: {x,y,v,c,k,id,to(idx),life}
  const byIdx = (i) => ctx.players[i]?.id;

  // ---------------------------------------------------------------- host
  let sim = null, ended = false, endAt = 0, winnerSent = false, snapAcc = 0, orbAcc = 0, flushNow = false;
  const inputs = new Map(), bots = new Map();
  let adds = [], eats = [];
  const events = {
    add(o) { adds.push([o.id, o.x, o.y, o.v, o.c, o.k | 0]); },
    eat(o, idx) { eats.push([o.id, idx]); onEat(o, idx); },
    death(s, by, cause, king) { flushNow = true; pendingDeaths.push({ t: 'd', id: s.id, by, cause, king, tm: +s.deathT.toFixed(3) }); },
    bloom(x, y, at) { net.toAll({ t: 'bloom', x: +x.toFixed(2), y: +y.toFixed(2), at: +at.toFixed(2) }); },
    showdown() { net.toAll({ t: 'show' }); },
    respawn(s) { flushNow = true; pendingDeaths.push({ t: 'spawn', id: s.id, x: +s.x.toFixed(2), y: +s.y.toFixed(2), a: +s.a.toFixed(3), tm: +sim.t.toFixed(3) }); },
    king(s) { net.toAll({ t: 'king', id: s.id }); },
  };
  const pendingDeaths = [];
  const myInput = { ang: V.snakes.get(ctx.myId)?.a || 0, boost: false };

  const simOpts = { rocks: cfg.rocks, blooms: BLOOMS };
  function makeSim() { sim = new HostSim(ctx.players, cfg, orbs0, events, simOpts); }
  function inputOf(s) {
    const pl = ctx.players[s.idx];
    if (pl.isBot || (!ctx.connected(pl.id) && pl.id !== ctx.myId) || (pl.id === ctx.myId && api.autopilot)) {
      let b = bots.get(s.id); if (!b) { b = makeBot(ctx.bots.Brain, ctx.bots.level); b.ang = s.a; bots.set(s.id, b); }
      botThink(sim, s, b, 1 / 60);
      return { ang: b.ang, boost: b.boost };
    }
    if (pl.id === ctx.myId) return myInput;
    const i = inputs.get(pl.id); if (i) s.ack = i.seq;
    return i || null;
  }
  function flushOrbs() {
    if (adds.length || eats.length) { net.toAll({ t: 'o', a: adds, e: eats }); adds = []; eats = []; }
    for (const d of pendingDeaths.splice(0)) net.toAll(d);
  }
  function hostTick(dt) {
    if (ctx.started && !(ended && performance.now() > endAt + 4000)) {
      sim.step(dt, inputOf);
      const alive = sim.alive();
      if (!endAt) {
        if (sim.t >= LEN) { endAt = performance.now(); finish(); }
        else if (!FRENZY && ((N >= 2 && alive.length <= 1) || alive.length === 0)) {
          endAt = performance.now() + 2600;
          if (!winnerSent) { winnerSent = true; net.toAll({ t: 'win', id: alive[0]?.id || null }); }
        }
      } else if (!ended && performance.now() >= endAt) finish();
    }
    orbAcc += dt; snapAcc += dt;
    if (flushNow || orbAcc >= 0.1) { orbAcc = 0; flushNow = false; flushOrbs(); }
    if (snapAcc >= 1 / C.SNAP_HZ) { snapAcc = 0; net.rawToAll(encodeSnap(sim.t, sim.R, [...sim.snakes.values()])); }
  }
  function finish() {
    if (ended) return; ended = true;
    flushOrbs();
    const stats = {};
    for (const s of sim.snakes.values()) stats[s.id] = `${s.alive ? Math.round(s.mass) + ' long' : 'popped'} · best ${Math.round(s.peak)} · ${s.kills} pop${s.kills === 1 ? '' : 's'}`;
    const alive = sim.alive();
    const note = FRENZY ? 'Biggest snake at the buzzer wins' : alive.length === 1 ? 'Last snake slithering' : alive.length ? 'Time! Biggest survivor wins' : 'Nobody survived the pit';
    ctx.endGame(sim.standings(), { stats, note });
  }
  function standings() {
    if (sim) return sim.standings();
    return standingsOf([...V.snakes.values()]);
  }
  function fullSync() {
    return {
      t: 'full', T: sim.t, R: sim.R, maxOrb: sim.nextOrb, king: sim.king, show: sim.showdown, bloom: sim.bloom, nb: sim.nextBloom,
      s: [...sim.snakes.values()].map((s) => [s.id, +s.x.toFixed(2), +s.y.toFixed(2), +s.a.toFixed(3), +s.mass.toFixed(1), s.alive ? 1 : 0, s.kills, +s.deathT.toFixed(3), s.alive ? s.trail.export(lengthOf(s.mass)) : [], s.deaths, Math.round(s.peak)]),
      o: [...sim.orbs.values()].map((o) => [o.id, o.x, o.y, o.v, o.c, o.k | 0]),
    };
  }
  if (net.isHost) makeSim();
  ctx.on('hostchange', ({ amHost }) => {
    if (amHost && !sim) {
      for (const v of V.snakes.values()) if (v.id !== ctx.myId) v.trail.push(v.x, v.y);
      sim = HostSim.fromView(ctx.players, cfg, V, events, simOpts);
      sim.king = V.king; if (V.bloom) sim.bloom = { ...V.bloom };
      ui.toast('You are now hosting the snake pit', '', 2500);
    }
  });
  ctx.on('join', (id) => { if (net.isHost && sim) net.to(id, fullSync()); });

  // ---------------------------------------------------------------- shared effects
  function snakeOf(id) { return net.isHost && sim ? sim.snakes.get(id) : V.snakes.get(id); }
  function displayOf(id) { return id === ctx.myId && pred && !net.isHost ? disp : snakeOf(id); }
  function onEat(o, idx) {
    flying.push({ x: o.x, y: o.y, v: o.v, c: o.c, k: o.k, id: o.id, to: idx, life: 0.18 });
    if (idx === myIdx) sfx.eat(o.v, o.k === 1 || o.k === 3);
    if (o.v >= 3 || idx === myIdx) gfx.burst(o.x, o.y, o.k === 3 ? 0xffd23f : 0xffffff, o.k === 3 ? 4 : 2, 4, 0.7, 0.35, 3);
  }
  const SAMP = new Float32Array(2 * 200);
  function onDeath(m) {
    const s = snakeOf(m.id); if (!s) return;
    const pl = ctx.player(m.id), killer = m.by && ctx.player(m.by);
    // burst along the whole body
    const d = displayOf(m.id), r = radiusOf(s.mass);
    const n = s.trail.sample(lengthOf(s.mass), Math.max(0.8, r), SAMP, 200);
    for (let k = 0; k < n; k++) gfx.burst(SAMP[k * 2], SAMP[k * 2 + 1], pl.colorHex, 3, 7 + r * 3, 1.3 * r + 0.5, 0.9, 6);
    gfx.burst(d.x, d.y, 0xffffff, 26, 16, 1.6, 0.6, 10);
    gfx.shock(d.x, d.y, pl.colorHex, 6 + r * 6, 0.7);
    if (m.king) { gfx.shock(d.x, d.y, 0xffd23f, 14 + r * 6, 1.0); gfx.burst(d.x, d.y, 0xffd23f, 40, 18, 1.8, 1.1, 12); }
    const me = focusSnake();
    const near = me && Math.hypot(me.x - d.x, me.y - d.y) < 25;
    if (m.id === ctx.myId) { gfx.shake(1.1); ui.banner('POPPED!', 1600); doFlash('#ff3d7f', 0.5); }
    else if (m.by === ctx.myId) doFlash('#ffffff', 0.18);
    else if (near) gfx.shake(0.45);
    sfx.death(m.id === ctx.myId, near);
    if (m.by === ctx.myId) {
      sfx.kill();
      const nowT = performance.now();
      myPops = myPops.filter((t) => nowT - t < 4000); myPops.push(nowT);
      if (myPops.length >= 3) ui.banner('TRIPLE POP!', 1400);
      else if (myPops.length === 2) ui.banner('DOUBLE POP!', 1300);
      else if (m.id === nemesis) ui.banner('REVENGE!', 1300);
      ui.toast(m.king ? `👑 You popped the King Snake! Grab the gold!` : `💥 You popped ${pl.name}!`, 'gold', 2200);
    } else if (m.king && killer) ui.toast(`👑 ${killer.name} popped the King Snake!`, '', 2200);
    if (m.id === ctx.myId) nemesis = m.by || null;
    if (!net.isHost || !sim) { const v = V.snakes.get(m.id); if (v) { v.alive = false; v.deathT = m.tm; v.boost = false; v.deaths = (v.deaths || 0) + 1; } V.deaths.push(m.id); if (V.king === m.id) V.king = null; }
    if (m.id === ctx.myId) { spectate = m.by && snakeOf(m.by)?.alive ? m.by : null; }
    const line = document.createElement('div');
    const name = (p) => `<b style="color:${p.colorCss}">${ui.esc(p.name)}</b>`;
    line.innerHTML = killer ? `${name(killer)} 💥 ${name(pl)}${m.king ? ' 👑' : ''}` : m.cause === 'ring' ? `${name(pl)} 🔥 hit the ring` : m.cause === 'rock' ? `${name(pl)} 🪨 hit a rock` : `${name(pl)} 💀`;
    feed.appendChild(line); while (feed.children.length > 5) feed.firstChild.remove();
    ctx.setTimeout(() => line.remove(), 5000);
  }

  let myPops = [], nemesis = null;
  function onRespawn(id, x, y, a, tm) {
    const host = net.isHost && sim;
    if (!host) {
      const v = V.snakes.get(id); if (!v || v.alive) return;
      Object.assign(v, { alive: true, x, y, a, mass: C.START_MASS, boost: false, ghost: true, buf: [] });
      v.trail.reset(x, y, a, lengthOf(v.mass));
      if (id === ctx.myId && pred) { Object.assign(pred, { x, y, a, v: C.SPEED, mass: C.START_MASS }); Object.assign(disp, { x, y, a }); err = { x: 0, y: 0, a: 0 }; pending = []; }
    }
    const pl = ctx.player(id);
    gfx.burst(x, y, pl.colorHex, 30, 10, 1.4, 0.8, 8); gfx.shock(x, y, pl.colorHex, 7, 0.6);
    if (id === ctx.myId) { ui.banner('BACK IN!', 900); gfx.snapCamera(x, y); sfx.spawn(); }
  }

  // ---------------------------------------------------------------- client networking
  let pred = null, disp = null, err = { x: 0, y: 0, a: 0 }, pending = [], seq = 1, sendAcc = 0, clockOff = null, lastSnap = 0;
  if (!ctx.spectator) { const v = V.snakes.get(ctx.myId); pred = { x: v.x, y: v.y, a: v.a, v: 0, mass: v.mass }; disp = { x: v.x, y: v.y, a: v.a }; }
  net.onRaw((ab, from) => {
    if (net.isHost) {
      const inp = decodeInput(ab); if (inp && from !== ctx.myId) inputs.set(from, inp);
      return;
    }
    const snap = decodeSnap(ab); if (!snap) return;
    const nowS = performance.now() / 1000, off = snap.t - nowS;
    clockOff = clockOff == null || off > clockOff ? off : clockOff + (off - clockOff) * 0.04;
    V.t = Math.max(V.t, snap.t); V.R = snap.R; lastSnap = performance.now();
    for (const e of snap.list) {
      const v = V.snakes.get(byIdx(e.idx)); if (!v) continue;
      if (e.alive && !v.alive) { if (V.full && snap.t > v.deathT + 1) onRespawn(v.id, e.x, e.y, e.a); else continue; }
      v.mass = e.mass; v.kills = e.kills; v.boost = e.boost; v.aim = e.aim; v.ghost = e.ghost;
      if (!e.alive && v.alive) { v.alive = false; }
      if (v.id === ctx.myId && pred) { reconcile(e); continue; }
      v.buf.push({ t: snap.t, x: e.x, y: e.y, a: e.a });
      if (v.buf.length > 12) v.buf.shift();
    }
  });
  function reconcile(e) {
    pred.mass = e.mass;
    if (!e.alive) return;
    // drop acknowledged inputs, then replay the rest from the host's state
    const ack = e.ack;
    pending = pending.filter((p) => ((p.seq - ack) & 65535) > 0 && ((p.seq - ack) & 65535) < 30000);
    const before = { x: disp.x, y: disp.y, a: disp.a };
    pred.x = e.x; pred.y = e.y; pred.a = e.a; pred.v = e.boost ? C.BOOST_SPEED : C.SPEED;
    for (const p of pending) stepHead(pred, p.ang, p.boost && pred.mass > C.BOOST_MIN, p.dt);
    err.x = before.x - pred.x; err.y = before.y - pred.y; err.a = wrapA(before.a - pred.a);
    if (Math.hypot(err.x, err.y) > 6) { err.x = err.y = err.a = 0; }
  }
  net.onMessage((m) => {
    if (m.t === 'o') {
      if (net.isHost) return;     // the host already applied these
      for (const [id, x, y, v, c, k] of m.a) { V.orbs.set(id, { id, x, y, v, c, k }); V.maxOrb = Math.max(V.maxOrb, id); }
      for (const [id, idx] of m.e) { const o = V.orbs.get(id); if (o) { V.orbs.delete(id); onEat(o, idx); } }
    } else if (m.t === 'd') onDeath(m);
    else if (m.t === 'spawn') onRespawn(m.id, m.x, m.y, m.a, m.tm);
    else if (m.t === 'bloom') {
      V.bloom = { x: m.x, y: m.y, at: m.at };
      ui.banner('GOLDEN BLOOM!', 1500); sfx.bloom();
      ctx.setTimeout(() => { if (V.bloom && V.bloom.at === m.at) { gfx.burst(m.x, m.y, 0xffd23f, 60, 14, 2, 1, 10); gfx.shock(m.x, m.y, 0xffd23f, 16, 0.9); sfx.bloomPop(); V.bloom = null; } }, 3000);
    } else if (m.t === 'show') { V.showdown = true; ui.banner('SHOWDOWN! THE RING IS RACING IN!', 2200); sfx.ring(); }
    else if (m.t === 'king') {
      V.king = m.id; const p = ctx.player(m.id);
      if (m.id === ctx.myId) { ui.toast('👑 You are the King Snake! Everyone wants your gold.', 'gold', 3000); sfx.crown(); }
      else if (p && performance.now() - lastKingToast > 6000) { ui.toast(`👑 ${p.name} is the King Snake. Pop them for gold!`, '', 2500); }
      lastKingToast = performance.now();
    }
    else if (m.t === 'win') {
      const p = m.id && ctx.player(m.id);
      ui.banner(p ? (m.id === ctx.myId ? 'YOU WIN!' : `${p.name.toUpperCase()} WINS!`) : 'NOBODY SURVIVED!', 2500);
      if (m.id === ctx.myId) { sfx.win(); doFlash('#ffd23f', 0.35); }
      if (p) { spectate = m.id; winner = m.id; const w = snakeOf(m.id); if (w) { gfx.shock(w.x, w.y, 0xffd23f, 18, 1.2); for (let i = 0; i < 5; i++) ctx.setTimeout(() => { const ww = displayOf(m.id); if (ww) gfx.burst(ww.x, ww.y, [0xffd23f, 0xff5a5f, 0x3ea6ff, 0x4cd964, 0xff6ec7][i], 40, 16, 1.5, 1.2, 14); }, i * 220); } }
    } else if (m.t === 'full' && !net.isHost) {
      V.t = m.T; V.R = m.R; V.maxOrb = m.maxOrb; V.full = true; V.orbs.clear(); V.deaths = []; V.king = m.king; V.showdown = m.show; V.bloom = m.bloom; V.nextBloom = m.nb;
      for (const [id, x, y, v, c, k] of m.o) V.orbs.set(id, { id, x, y, v, c, k });
      for (const [id, x, y, a, mass, alive, kills, deathT, pts, deaths, peak] of m.s) {
        const v = V.snakes.get(id); if (!v) continue;
        Object.assign(v, { x, y, a, mass, alive: !!alive, kills, deathT, deaths, peak, buf: [] });
        if (pts.length > 2) v.trail.setPoints(pts); else v.trail.reset(x, y, a, lengthOf(mass));
        if (id === ctx.myId && pred) { Object.assign(pred, { x, y, a, mass }); Object.assign(disp, { x, y, a }); pending = []; }
      }
    }
  });

  // ---------------------------------------------------------------- input
  let lastKingToast = 0, winner = null, goAt = 0;
  let aimAng = myInput.ang, lastMouse = { x: -1, y: -1 }, keySteer = false, spectate = null, wasBoost = false;
  input.on('press', (a) => {
    if (a === 'primary' && !myAlive() && ctx.started) {   // click while out: cycle who you watch
      const alive = [...V.snakes.values()].filter((v) => snakeOf(v.id)?.alive);
      if (alive.length) { const i = alive.findIndex((v) => v.id === spectate); spectate = alive[(i + 1) % alive.length].id; }
    }
    if (['up', 'down', 'left', 'right'].includes(a)) keySteer = true;
  });
  function myAlive() { return !ctx.spectator && !!snakeOf(ctx.myId)?.alive; }
  function readInput() {
    const ax = input.axis();
    const m = input.mouse;
    if (m.x !== lastMouse.x || m.y !== lastMouse.y) { lastMouse = { x: m.x, y: m.y }; if (!(ax.x || ax.y)) keySteer = false; }
    const head = displayOf(ctx.myId);
    if (ax.x || ax.y) aimAng = Math.atan2(ax.y, ax.x);
    else if (!keySteer && head && lastMouse.x >= 0) {
      const w = gfx.mouseWorld(m.x, m.y);
      if (w && Math.hypot(w.x - head.x, w.y - head.y) > 0.6) aimAng = Math.atan2(w.y - head.y, w.x - head.x);
    }
    const boost = input.down('boost') || input.down('jump') || input.down('primary');
    myInput.ang = aimAng; myInput.boost = ctx.started && boost;
  }

  // ---------------------------------------------------------------- per frame: predict, interpolate, draw, HUD
  let ringPhase = 0, lastSec = 99;
  function focusId() {
    if (winner && snakeOf(winner)?.alive) return winner;
    if (myAlive()) return ctx.myId;
    if (spectate && snakeOf(spectate)?.alive) return spectate;
    let best = null;
    for (const v of V.snakes.values()) { const s = snakeOf(v.id); if (s?.alive && (!best || s.mass > best.mass)) best = s; }
    if (best) spectate = best.id;
    return best ? best.id : null;
  }
  function focusSnake() { const id = focusId(); return id ? displayOf(id) : null; }

  ctx.frame((dt, now) => {
    readInput();
    const host = net.isHost && sim;
    // --- time
    if (host) V.t = sim.t;
    else if (ctx.started && !ended && performance.now() - lastSnap < 1500) V.t += dt;
    if (host) V.R = sim.R;
    const R = V.R;
    // --- my snake (clients predict)
    if (!host && pred) {
      const v = V.snakes.get(ctx.myId);
      if (v.alive && ctx.started) {
        const b = myInput.boost && pred.mass > C.BOOST_MIN;
        stepHead(pred, myInput.ang, b, dt);
        pending.push({ seq, ang: myInput.ang, boost: myInput.boost, dt });
        if (pending.length > 240) pending.shift();
        sendAcc += dt;
        if (sendAcc >= 1 / 30) { sendAcc = 0; net.rawToHost(encodeInput(seq, myInput.ang, myInput.boost)); seq = (seq + 1) & 65535 || 1; }
        const k = Math.exp(-dt * 9);
        err.x *= k; err.y *= k; err.a *= k;
        disp.x = pred.x + err.x; disp.y = pred.y + err.y; disp.a = wrapA(pred.a + err.a);
        Object.assign(v, { x: disp.x, y: disp.y, a: disp.a, aim: myInput.ang, boost: b });
        v.trail.push(disp.x, disp.y); v.trail.trim(lengthOf(v.mass));
      }
    }
    // --- everyone else (clients interpolate ~110 ms in the past)
    if (!host) {
      const rt = (clockOff == null ? 0 : now / 1000 + clockOff) - C.INTERP;
      for (const v of V.snakes.values()) {
        if (v.id === ctx.myId && pred) continue;
        if (!v.alive || !v.buf.length) continue;
        const b = v.buf;
        let a = b[0], c = b[b.length - 1];
        for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
        if (rt >= c.t) {   // extrapolate a little
          const ex = Math.min(0.2, rt - c.t), sp = v.boost ? C.BOOST_SPEED : C.SPEED;
          v.x = c.x + Math.cos(c.a) * sp * ex; v.y = c.y + Math.sin(c.a) * sp * ex; v.a = c.a;
        } else if (rt <= a.t) { v.x = a.x; v.y = a.y; v.a = a.a; }
        else {
          const f = (rt - a.t) / Math.max(1e-4, c.t - a.t);
          v.x = a.x + (c.x - a.x) * f; v.y = a.y + (c.y - a.y) * f; v.a = a.a + wrapA(c.a - a.a) * f;
        }
        v.trail.push(v.x, v.y); v.trail.trim(lengthOf(v.mass));
      }
      // the ring sweeps orbs inward (same rule as the host)
      const edge = R - 0.7;
      for (const o of V.orbs.values()) { const d = Math.hypot(o.x, o.y); if (d > edge) { o.x *= edge / d; o.y *= edge / d; } }
    }
    // --- slurp animation
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i], s = displayOf(byIdx(f.to));
      f.life -= dt;
      if (f.life <= 0 || !s) { flying.splice(i, 1); continue; }
      const k = Math.min(1, dt * 16); f.x += (s.x - f.x) * k; f.y += (s.y - f.y) * k;
    }
    // --- draw
    const list = [];
    for (const p of ctx.players) {
      const s = snakeOf(p.id); if (!s) continue;
      const d = displayOf(p.id);
      list.push({ p, x: d.x, y: d.y, a: d.a, aim: host ? s.ang : s.aim, mass: s.mass, alive: s.alive, boost: s.boost, trail: s.trail, skin: skinOf(p.id), ghost: host ? s.ghost > 0 : s.ghost });
    }
    const fid = focusId(), focus = fid && displayOf(fid), fm = fid ? snakeOf(fid).mass : 25;
    // boost sparks shed from the tail
    if (Math.random() < 0.7) for (const s of list) {
      if (!s.alive || !s.boost || !s.trail.x.length) continue;
      const tx = s.trail.x[Math.min(s.trail.x.length - 1, 2)], ty = s.trail.y[Math.min(s.trail.y.length - 1, 2)];
      gfx.burst(tx, ty, s.p.colorHex, 1, 3, 1.1, 0.5, 2);
    }
    // intro fly-in: from the whole pit down to your snake by the end of the countdown
    const intro = goAt ? 1 + (now - goAt) / 600 : Math.min(0.92, (now - t0) / 4200);
    const shrinking = V.showdown || (V.t > LEN * 0.12 && V.t < LEN * 0.82);
    const bloom = host ? sim.bloom : V.bloom;
    const king = host ? sim.king : V.king;
    const meS = myAlive() ? displayOf(ctx.myId) : null;
    const edgeDanger = meS ? Math.max(0, 1 - (R - Math.hypot(meS.x, meS.y)) / 6) : 0;
    gfx.draw({ t: now / 1000, dt, R, warn: Math.max(shrinking ? 0.25 : 0, edgeDanger), snakes: list, orbs: host ? sim.orbs.values() : V.orbs.values(), flying, focus: focus && { x: focus.x, y: focus.y, mass: fm * (winner ? 0.6 : 1) }, bloom, king, simT: V.t, intro: Math.min(1, intro), boost: myAlive() && myInput.boost && (snakeOf(ctx.myId)?.mass || 0) > C.BOOST_MIN });
    // danger vignette: red at the screen edge when your head nears the ring
    const vg = Math.max(edgeDanger, V.showdown && myAlive() ? 0.25 : 0);
    fx.style.background = vg > 0.02 ? `radial-gradient(ellipse at center, transparent 55%, rgba(255,40,100,${(vg * 0.55).toFixed(2)}) 100%)` : 'radial-gradient(ellipse at center, transparent 60%, rgba(5,3,20,.55) 100%)';
    // off-screen arrow to the Golden Bloom
    arrow.style.display = 'none';
    if (bloom && focus) {
      const dx = bloom.x - focus.x, dy = bloom.y - focus.y, d = Math.hypot(dx, dy);
      if (d > 16) {
        const W = ctx.container.clientWidth, H = ctx.container.clientHeight, a = Math.atan2(dy, dx);
        const k = Math.min((W / 2 - 40) / Math.max(1e-3, Math.abs(Math.cos(a))), (H / 2 - 40) / Math.max(1e-3, Math.abs(Math.sin(a))));
        arrow.style.display = ''; arrow.firstChild.style.left = W / 2 + Math.cos(a) * k + 'px'; arrow.firstChild.style.top = H / 2 + Math.sin(a) * k + 'px';
        arrow.firstChild.style.transform = `translate(-50%,-50%) rotate(${a}rad)`;
      }
    }
    // --- sound
    const myS = snakeOf(ctx.myId);
    const boosting = !!(myS?.alive && (host ? myS.boost : myInput.boost && myS.mass > C.BOOST_MIN));
    if (boosting && !wasBoost) sfx.boostStart();
    wasBoost = boosting;
    sfx.update(dt, { boosting, danger: edgeDanger, intensity: Math.min(1, V.t / LEN) });
    // --- ring announcements
    const phase = V.t >= LEN * 0.82 ? 2 : V.t >= LEN * 0.12 ? 1 : 0;
    if (phase > ringPhase && ctx.started) { ringPhase = phase; if (!V.showdown || phase === 1) { ui.banner(phase === 1 ? 'THE RING IS CLOSING!' : 'FINAL RING!', 1800); sfx.ring(); } }
    const left = Math.max(0, LEN - V.t);
    if (ctx.started && left <= 5 && Math.ceil(left) !== lastSec && left > 0) { lastSec = Math.ceil(left); sfx.tick(); }
    // --- HUD
    const rows = ctx.players.map((p) => { const s = snakeOf(p.id); return { id: p.id, name: p.name, color: p.color, value: s?.alive ? Math.round(s.mass) : '💀', me: p.id === ctx.myId, out: !s?.alive, m: s?.alive ? s.mass : -1 - (s?.deathT || 0) / 1e4 }; })
      .sort((a, b) => b.m - a.m);
    for (const r of rows) if (r.id === king) r.name = '👑 ' + r.name;
    ui.mini(rows);
    const aliveN = rows.filter((r) => !r.out).length;
    if (ctx.spectator) ui.status(`👀 Watching · 🐍 ${aliveN} left`);
    else if (myS?.alive) ui.status(`🐍 <b>${Math.round(myS.mass)}</b> long · 💥 ${myS.kills}${FRENZY ? '' : ` · ${aliveN} left`}`);
    else if (FRENZY) ui.status(`💀 Respawning… · 💥 ${myS?.kills || 0} pops`);
    else ui.status(`💀 Watching ${ui.esc(ctx.player(spectate)?.name || '…')} · ${aliveN} left`);
    ui.timer(ctx.started ? left : LEN, { warn: 10 });
    if (!ctx.spectator && myS?.alive) ui.abilities([{ key: 'Shift', label: 'Boost', ready: myS.mass > C.BOOST_MIN, cd: myS.mass > C.BOOST_MIN ? 0 : 1, wide: true }]);
    else ui.abilities([]);
    hint.textContent = !ctx.started ? `${FRENZY ? 'FRENZY: respawns on, biggest at the buzzer wins' : 'ROYALE: one life, last snake wins'} · ${MAP === 'rocks' ? 'Asteroid Belt' : 'Open Pit'}` : !myAlive() && !ctx.spectator && !FRENZY ? 'Click to switch who you watch' : '';
    drawMap(R, list);
  });

  function drawMap(R, list) {
    const W = 150, sc = (W / 2 - 6) / cfg.r0;
    mg.clearRect(0, 0, W, W);
    mg.save(); mg.translate(W / 2, W / 2);
    mg.strokeStyle = '#ff3d7f'; mg.lineWidth = 3; mg.beginPath(); mg.arc(0, 0, R * sc, 0, Math.PI * 2); mg.stroke();
    mg.fillStyle = '#5b3fa8'; for (const r of cfg.rocks) { mg.beginPath(); mg.arc(r.x * sc, r.y * sc, r.r * sc, 0, Math.PI * 2); mg.fill(); }
    const bl = net.isHost && sim ? sim.bloom : V.bloom;
    if (bl) { mg.strokeStyle = '#ffd23f'; mg.lineWidth = 2; mg.beginPath(); mg.arc(bl.x * sc, bl.y * sc, 5 + 3 * Math.sin(performance.now() / 90), 0, Math.PI * 2); mg.stroke(); }
    const kg = net.isHost && sim ? sim.king : V.king;
    for (const s of list) {
      if (!s.alive) continue;
      const r = Math.max(2.5, radiusOf(s.mass) * sc * 3);
      mg.fillStyle = s.p.colorCss; mg.beginPath(); mg.arc(s.x * sc, s.y * sc, r, 0, Math.PI * 2); mg.fill();
      if (s.p.id === ctx.myId || s.p.id === kg) { mg.strokeStyle = s.p.id === kg ? '#ffd23f' : '#fff'; mg.lineWidth = 2; mg.stroke(); }
    }
    mg.restore();
  }

  ctx.on('go', () => { goAt = performance.now(); ui.banner('SLITHER!', 1100); });

  // host simulation tick (keeps running in background tabs)
  ctx.tick((dt) => { if (net.isHost && sim) hostTick(dt); });

  ui.setScoreboard(() => ({
    columns: ['Snake', 'Length', 'Best', 'Pops', 'Status'],
    rows: standings().flat().map((id) => {
      const s = snakeOf(id), p = ctx.player(id);
      return [`<span style="color:${p.colorCss}">${ui.esc(p.name)}</span>`, s?.alive ? Math.round(s.mass) : '—', Math.round(s?.peak || s?.mass || 0), s?.kills || 0, s?.alive ? '🐍 alive' : '💀 popped'];
    }),
  }));

  // test hook
  const api = { autopilot: false, get state() { return { t: V.t, host: !!sim, alive: [...V.snakes.values()].filter((v) => snakeOf(v.id)?.alive).length }; } };
  window.__snake = api;
  ctx.onCleanup(() => { if (window.__snake === api) delete window.__snake; });

  return {
    standings,
    stop() {
      sfx.dispose();
      gfx.dispose();
      V.snakes.clear(); V.orbs.clear(); flying.length = 0;
      sim = null;
    },
  };
}
