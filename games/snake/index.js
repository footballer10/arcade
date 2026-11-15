// SNAKE ROYALE — slither-style battle royale. Eat orbs to grow, boost by shedding length, pop anyone whose head
// hits your body. A glowing ring closes in and sweeps every orb inward, so the richest food piles up right at
// the deadly edge. Last snake alive (or the biggest when time runs out) wins.
//
// Net model: the host runs HostSim at 60 Hz (bots too) and sends 20 Hz binary snapshots of every head; clients
// rebuild bodies from the head paths they see, predict their own snake (input replay + smoothed correction) and
// get orb spawns / eats / deaths as reliable batched messages.
export { manifest } from './manifest.js';
import { C, Trail, stepHead, radiusOf, lengthOf, ringAt, arenaCfg, spawnOf, initialOrbs, orbGoal, wrapA, standingsOf, encodeSnap, decodeSnap, encodeInput, decodeInput } from './sim.js';
import { HostSim } from './host.js';
import { makeBot, botThink } from './bots.js';
import { createView } from './render.js';
import { createSound } from './audio.js';

const CSS = `
.snk-tag{position:absolute;left:0;top:0;pointer-events:none;font:1rem var(--font);color:#fff;white-space:nowrap;
  text-shadow:var(--stroke);padding:0 8px;border-radius:10px;background:color-mix(in srgb,var(--c) 45%,transparent);border:2px solid var(--ink)}
.snk-feed{position:absolute;left:14px;top:84px;display:flex;flex-direction:column;gap:5px;pointer-events:none;font:.95rem var(--font)}
.snk-feed div{background:rgba(23,17,46,.82);border:3px solid var(--ink);border-radius:12px;padding:2px 10px;color:#fff;text-shadow:var(--stroke);animation:snkIn .25s ease-out}
.snk-feed b{font-weight:400}
.snk-map{position:absolute;right:14px;bottom:14px;width:150px;height:150px;border-radius:50%;border:4px solid var(--ink);background:rgba(11,8,32,.75);pointer-events:none}
.snk-hint{position:absolute;left:50%;bottom:92px;transform:translateX(-50%);font:1rem var(--font);color:#fff;text-shadow:var(--stroke);pointer-events:none;opacity:.9}
@keyframes snkIn{from{transform:translateX(-30px);opacity:0}to{transform:none;opacity:1}}
`;

export async function start(ctx) {
  const { ui, input, net } = ctx;
  const N = ctx.players.length;
  const LEN = +(ctx.options.len || 150);
  const cfg = arenaCfg(LEN, N);
  const myIdx = ctx.players.findIndex((p) => p.id === ctx.myId);
  const orbs0 = initialOrbs(ctx.rng(0x0b5), cfg.r0, orbGoal(cfg.r0));

  const style = document.createElement('style'); style.textContent = CSS; ctx.container.appendChild(style);
  const feed = document.createElement('div'); feed.className = 'snk-feed'; ctx.container.appendChild(feed);
  const map = document.createElement('canvas'); map.className = 'snk-map'; map.width = map.height = 150; ctx.container.appendChild(map);
  const hint = document.createElement('div'); hint.className = 'snk-hint'; ctx.container.appendChild(hint);
  const mg = map.getContext('2d');

  const gfx = createView(ctx, cfg);
  ctx.on('resize', gfx.resize);
  const sfx = createSound(ctx.audio);

  // ---------------------------------------------------------------- client view of the world (everyone keeps one)
  const V = { t: 0, snakes: new Map(), orbs: new Map(), deaths: [], maxOrb: 0, full: !ctx.spectator };
  ctx.players.forEach((p, i) => {
    const sp = spawnOf(i, N, cfg.r0);
    const v = { id: p.id, idx: i, p, x: sp.x, y: sp.y, a: sp.a, aim: sp.a, mass: C.START_MASS, alive: true, boost: false, kills: 0, deathT: 0, trail: new Trail(), buf: [] };
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
    death(s, by, cause) { flushNow = true; pendingDeaths.push({ t: 'd', id: s.id, by, cause, tm: +s.deathT.toFixed(3) }); },
  };
  const pendingDeaths = [];
  const myInput = { ang: V.snakes.get(ctx.myId)?.a || 0, boost: false };

  function makeSim() { sim = new HostSim(ctx.players, cfg, orbs0, events); }
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
        else if ((N >= 2 && alive.length <= 1) || alive.length === 0) {
          endAt = performance.now() + 2600;
          if (!winnerSent) { winnerSent = true; net.toAll({ t: 'win', id: alive[0]?.id || null }); }
        }
      } else if (!ended && performance.now() >= endAt) finish();
    }
    orbAcc += dt; snapAcc += dt;
    if (flushNow || orbAcc >= 0.1) { orbAcc = 0; flushNow = false; flushOrbs(); }
    if (snapAcc >= 1 / C.SNAP_HZ) { snapAcc = 0; net.rawToAll(encodeSnap(sim.t, [...sim.snakes.values()])); }
  }
  function finish() {
    if (ended) return; ended = true;
    flushOrbs();
    const stats = {};
    for (const s of sim.snakes.values()) stats[s.id] = `${s.alive ? Math.round(s.mass) + ' long' : 'popped'} · best ${Math.round(s.peak)} · ${s.kills} kill${s.kills === 1 ? '' : 's'}`;
    ctx.endGame(sim.standings(), { stats });
  }
  function standings() {
    if (sim) return sim.standings();
    return standingsOf([...V.snakes.values()]);
  }
  function fullSync() {
    return {
      t: 'full', T: sim.t, maxOrb: sim.nextOrb,
      s: [...sim.snakes.values()].map((s) => [s.id, +s.x.toFixed(2), +s.y.toFixed(2), +s.a.toFixed(3), +s.mass.toFixed(1), s.alive ? 1 : 0, s.kills, +s.deathT.toFixed(3), s.alive ? s.trail.export(lengthOf(s.mass)) : []]),
      o: [...sim.orbs.values()].map((o) => [o.id, o.x, o.y, o.v, o.c, o.k | 0]),
    };
  }
  if (net.isHost) makeSim();
  ctx.on('hostchange', ({ amHost }) => {
    if (amHost && !sim) {
      for (const v of V.snakes.values()) if (v.id !== ctx.myId) v.trail.push(v.x, v.y);
      sim = HostSim.fromView(ctx.players, cfg, V, events);
      ui.toast('You are now hosting the snake pit', '', 2500);
    }
  });
  ctx.on('join', (id) => { if (net.isHost && sim) net.to(id, fullSync()); });

  // ---------------------------------------------------------------- shared effects
  function snakeOf(id) { return net.isHost && sim ? sim.snakes.get(id) : V.snakes.get(id); }
  function displayOf(id) { return id === ctx.myId && pred && !net.isHost ? disp : snakeOf(id); }
  function onEat(o, idx) {
    flying.push({ x: o.x, y: o.y, v: o.v, c: o.c, k: o.k, id: o.id, to: idx, life: 0.18 });
    if (idx === myIdx) sfx.eat(o.v, o.k === 1);
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
    const me = focusSnake();
    const near = me && Math.hypot(me.x - d.x, me.y - d.y) < 25;
    if (m.id === ctx.myId) { gfx.shake(1.1); ui.banner('POPPED!', 1600); }
    else if (near) gfx.shake(0.45);
    sfx.death(m.id === ctx.myId, near);
    if (m.by === ctx.myId) { sfx.kill(); ui.toast(`💥 You popped ${pl.name}!`, 'gold', 2200); }
    if (!net.isHost || !sim) { const v = V.snakes.get(m.id); if (v) { v.alive = false; v.deathT = m.tm; v.boost = false; } V.deaths.push(m.id); }
    if (m.id === ctx.myId) { spectate = m.by && snakeOf(m.by)?.alive ? m.by : null; }
    const line = document.createElement('div');
    const name = (p) => `<b style="color:${p.colorCss}">${ui.esc(p.name)}</b>`;
    line.innerHTML = killer ? `${name(killer)} 💥 ${name(pl)}` : m.cause === 'ring' ? `${name(pl)} 🔥 hit the ring` : `${name(pl)} 💀`;
    feed.appendChild(line); while (feed.children.length > 5) feed.firstChild.remove();
    ctx.setTimeout(() => line.remove(), 5000);
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
    V.t = Math.max(V.t, snap.t); lastSnap = performance.now();
    for (const e of snap.list) {
      const v = V.snakes.get(byIdx(e.idx)); if (!v) continue;
      v.mass = e.mass; v.kills = e.kills; v.boost = e.boost; v.aim = e.aim;
      if (!e.alive && v.alive) { v.alive = false; }
      if (e.alive && !v.alive && V.full) { v.alive = true; v.trail.reset(e.x, e.y, e.a, lengthOf(e.mass)); v.buf.length = 0; }
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
    else if (m.t === 'win') {
      const p = m.id && ctx.player(m.id);
      ui.banner(p ? (m.id === ctx.myId ? 'YOU WIN!' : `${p.name.toUpperCase()} WINS!`) : 'NOBODY SURVIVED!', 2500);
      if (m.id === ctx.myId) sfx.win();
      if (p) spectate = m.id;
    } else if (m.t === 'full' && !net.isHost) {
      V.t = m.T; V.maxOrb = m.maxOrb; V.full = true; V.orbs.clear(); V.deaths = [];
      for (const [id, x, y, v, c, k] of m.o) V.orbs.set(id, { id, x, y, v, c, k });
      for (const [id, x, y, a, mass, alive, kills, deathT, pts] of m.s) {
        const v = V.snakes.get(id); if (!v) continue;
        Object.assign(v, { x, y, a, mass, alive: !!alive, kills, deathT, buf: [] });
        if (pts.length > 2) v.trail.setPoints(pts); else v.trail.reset(x, y, a, lengthOf(mass));
        if (id === ctx.myId && pred) { Object.assign(pred, { x, y, a, mass }); Object.assign(disp, { x, y, a }); pending = []; }
      }
    }
  });

  // ---------------------------------------------------------------- input
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
    const R = ringAt(V.t, cfg);
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
      list.push({ p, x: d.x, y: d.y, a: d.a, aim: host ? s.ang : s.aim, mass: s.mass, alive: s.alive, boost: s.boost, trail: s.trail });
    }
    const fid = focusId(), focus = fid && displayOf(fid), fm = fid ? snakeOf(fid).mass : 25;
    const shrinking = V.t > LEN * 0.12 && V.t < LEN * 0.82;
    const meS = myAlive() ? displayOf(ctx.myId) : null;
    const edgeDanger = meS ? Math.max(0, 1 - (R - Math.hypot(meS.x, meS.y)) / 6) : 0;
    gfx.draw({ t: now / 1000, dt, R, warn: Math.max(shrinking ? 0.25 : 0, edgeDanger), snakes: list, orbs: host ? sim.orbs.values() : V.orbs.values(), flying, focus: focus && { x: focus.x, y: focus.y, mass: fm } });
    // --- sound
    const myS = snakeOf(ctx.myId);
    const boosting = !!(myS?.alive && (host ? myS.boost : myInput.boost && myS.mass > C.BOOST_MIN));
    if (boosting && !wasBoost) sfx.boostStart();
    wasBoost = boosting;
    sfx.update(dt, { boosting, danger: edgeDanger, intensity: Math.min(1, V.t / LEN) });
    // --- ring announcements
    const phase = V.t >= LEN * 0.82 ? 2 : V.t >= LEN * 0.12 ? 1 : 0;
    if (phase > ringPhase && ctx.started) { ringPhase = phase; ui.banner(phase === 1 ? 'THE RING IS CLOSING!' : 'FINAL RING!', 1800); sfx.ring(); }
    const left = Math.max(0, LEN - V.t);
    if (ctx.started && left <= 5 && Math.ceil(left) !== lastSec && left > 0) { lastSec = Math.ceil(left); sfx.tick(); }
    // --- HUD
    const rows = ctx.players.map((p) => { const s = snakeOf(p.id); return { id: p.id, name: p.name, color: p.color, value: s?.alive ? Math.round(s.mass) : '💀', me: p.id === ctx.myId, out: !s?.alive, m: s?.alive ? s.mass : -1 - (s?.deathT || 0) / 1e4 }; })
      .sort((a, b) => b.m - a.m);
    ui.mini(rows);
    const aliveN = rows.filter((r) => !r.out).length;
    if (ctx.spectator) ui.status(`👀 Watching · 🐍 ${aliveN} left`);
    else if (myS?.alive) ui.status(`🐍 <b>${Math.round(myS.mass)}</b> long · 💥 ${myS.kills} · ${aliveN} left`);
    else ui.status(`💀 Watching ${ui.esc(ctx.player(spectate)?.name || '…')} · ${aliveN} left`);
    ui.timer(ctx.started ? left : LEN, { warn: 10 });
    if (!ctx.spectator && myS?.alive) ui.abilities([{ key: 'Shift', label: 'Boost', ready: myS.mass > C.BOOST_MIN, cd: myS.mass > C.BOOST_MIN ? 0 : 1, wide: true }]);
    else ui.abilities([]);
    hint.textContent = !ctx.started ? 'Steer with the mouse · hold Shift / click to boost' : !myAlive() && !ctx.spectator ? 'Click to switch who you watch' : '';
    drawMap(R, list);
  });

  function drawMap(R, list) {
    const W = 150, sc = (W / 2 - 6) / cfg.r0;
    mg.clearRect(0, 0, W, W);
    mg.save(); mg.translate(W / 2, W / 2);
    mg.strokeStyle = '#ff3d7f'; mg.lineWidth = 3; mg.beginPath(); mg.arc(0, 0, R * sc, 0, Math.PI * 2); mg.stroke();
    for (const s of list) {
      if (!s.alive) continue;
      const r = Math.max(2.5, radiusOf(s.mass) * sc * 3);
      mg.fillStyle = s.p.colorCss; mg.beginPath(); mg.arc(s.x * sc, s.y * sc, r, 0, Math.PI * 2); mg.fill();
      if (s.p.id === ctx.myId) { mg.strokeStyle = '#fff'; mg.lineWidth = 2; mg.stroke(); }
    }
    mg.restore();
  }

  ctx.on('go', () => { ui.banner('SLITHER!', 1100); });

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
