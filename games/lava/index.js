// RISING LAVA — survival platformer. Lava rises steadily while everyone hops between basalt columns that heat
// up and crumble under your feet, floating slabs, blinking obsidian and sinking pumice rafts. Shove rivals
// off. Last one standing wins the round; best of 5. Every round has a new arena layout and lava rise pattern.
//
// Net model: the host runs HostSim (host.js) at 60 Hz with every bot and sends 20 Hz binary snapshots on the
// unreliable channel. Moving platforms and the lava are pure functions of the round clock, so clients predict
// them exactly; clients predict their own player and send input + their predicted state at 30 Hz. The host
// adopts a client's state when it is close to its own (smooth, responsive jumps) and otherwise forces a
// correction (auth counter). Knockback, heat, crumbling, deaths and scoring are decided by the host only.
export { manifest } from './manifest.js';
import { C, LAYOUTS, PATTERNS, makeLevel, roundPlan, makeSolids, updateSolids, newPlayer, stepPlayer, separate, lavaAt, surgeIn, encodeSnap, decodeSnap, syncCounters, groundAt } from './world.js';
import { HostSim, INTRO_T, standingsOf } from './host.js';
import { makeBot, botThink } from './bots.js';
import { createView } from './render.js';
import { createSound } from './audio.js';

const CSS = `
.lv-tags{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2}
.lv-meter,.lv-hint,.lv-hot{z-index:3}
.lv-tag{position:absolute;left:0;top:0;font:.95rem var(--font);color:#fff;white-space:nowrap;text-shadow:var(--stroke);padding:0 8px;border-radius:10px;
  background:color-mix(in srgb,var(--c) 55%,transparent);border:2px solid var(--ink)}
.lv-tag.me{display:none!important}
.lv-meter{position:absolute;left:16px;top:50%;transform:translateY(-50%);width:26px;height:min(46vh,300px);border:3px solid var(--ink);border-radius:14px;
  background:linear-gradient(180deg,#5a3a7a,#2a1840);overflow:visible;pointer-events:none}
.lv-meter .lava{position:absolute;left:0;right:0;bottom:0;border-radius:0 0 10px 10px;background:linear-gradient(180deg,#ffd166,#ff6a1a 30%,#c2200e);box-shadow:0 -4px 14px #ff7a1a}
.lv-meter .dot{position:absolute;left:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid var(--ink);transition:opacity .3s}
.lv-meter .dot.me{width:20px;height:20px;margin:-10px 0 0 -10px;border-width:3px;z-index:2}
.lv-meter .lbl{position:absolute;left:34px;bottom:-4px;width:max-content;font:.8rem var(--font);color:#fff;text-shadow:var(--stroke);white-space:nowrap}
.lv-hint{position:absolute;left:50%;bottom:104px;transform:translateX(-50%);font:1.05rem var(--font);color:#fff;text-shadow:var(--stroke);pointer-events:none;white-space:nowrap}
.lv-hot{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 120px 30px rgba(255,80,20,0);transition:box-shadow .25s}
`;
const SNAP_HZ = 20, SEND_HZ = 30, STEP = 1 / 60;
const MATCH = { bo5: [3, 5], bo3: [2, 3], one: [1, 1] };

export async function start(ctx) {
  const { ui, input, net } = ctx;
  const N = ctx.players.length, ids = ctx.players.map((p) => p.id), myIdx = ids.indexOf(ctx.myId);
  const [need, maxRounds] = MATCH[ctx.options.match] || MATCH.bo5;
  const plan = roundPlan(ctx.rng(0x1A7A), ctx.options.arena || 'mix', maxRounds);
  const levels = new Map();
  const levelFor = (k) => { if (!levels.has(k)) levels.set(k, makeLevel(ctx.rng(0x100 + k * 977), plan[k].layout, plan[k].pattern, N, k)); return levels.get(k); };
  const api = { autopilot: false, turbo: 1, stats: { corrections: 0, snaps: 0 } };   // test-only hooks (tests/drivers.mjs)
  window.__lava = api;

  const style = document.createElement('style'); style.textContent = CSS; ctx.container.appendChild(style);
  const meter = ui.el('div', 'lv-meter', '<div class="lava"></div><div class="lbl"></div>'); ctx.container.appendChild(meter);
  const hot = ui.el('div', 'lv-hot'); ctx.container.appendChild(hot);
  const hint = ui.el('div', 'lv-hint'); ctx.container.appendChild(hint);
  const dots = new Map();
  for (const p of ctx.players) { const d = ui.el('div', 'dot' + (p.id === ctx.myId ? ' me' : '')); d.style.background = p.colorCss; meter.appendChild(d); dots.set(p.id, d); }

  const gfx = createView(ctx);
  const sfx = createSound(ctx.audio);
  ctx.on('resize', gfx.resize);
  ctx.on('settings', (k) => { if (k === 'quality') gfx.applyQ(); });

  // ---------------------------------------------------------------- shared client view of the round
  const info = { round: 0, wins: Object.fromEntries(ids.map((id) => [id, 0])), pts: Object.fromEntries(ids.map((id) => [id, 0])), ko: {}, deaths: [], hist: [] };
  let crown = new Set(), ghostReadyAt = 0, aimPt = null;
  let round = -1, level = null, S = null, st = null, lava = 0, phase = 'wait', phaseT = 0, tC = 0, lastSnap = null;
  const view = new Map();       // id -> rendered state (others interpolated; me predicted)
  let me = null;                // my predicted player (clients); the host reads sim directly
  const myBot = makeBot(ctx.bots.Brain, ctx.bots.level);
  let sim = null, ended = false;
  const inputs = new Map();
  let graceUntil = 0;

  function useRound(k) {
    if (k === round) return;
    round = k; level = levelFor(k);
    S = makeSolids(level); st = new Uint16Array(level.plats.length); lava = level.lv.from; tC = 0;
    updateSolids(level, S, st, 0, lava, 0);
    gfx.buildLevel(level);
    view.clear();
    ctx.players.forEach((p, i) => { const sp = level.plats[level.spawns[i % level.spawns.length]]; view.set(p.id, { x: sp.x, y: sp.top, z: sp.z, vx: 0, vy: 0, vz: 0, face: Math.atan2(-sp.x, -sp.z), alive: true, grounded: true, px: sp.x, py: sp.top, pz: sp.z }); });
    if (myIdx >= 0) { me = newPlayer(ctx.myId, level.plats[level.spawns[myIdx % level.spawns.length]]); me.auth = -1; syncCounters(me, myInput); }
    myBot.target = -1;
    const sp = me || [...view.values()][0];
    if (sp) { gfx.cam.x = sp.x; gfx.cam.y = sp.y; gfx.cam.z = sp.z; gfx.cam.yaw = Math.atan2(-sp.x, -sp.z); }
    gfx.cam.intro = 1; gfx.cam.introA = Math.atan2(sp ? sp.z : 0, sp ? sp.x : 1) - 0.9;
    shownCount = 0; spec = null; ghostReadyAt = 0;
    // Hot Crown: same rule as the host (match leader(s) heat rocks faster)
    const top = Math.max(0, ...ids.map((id) => info.wins[id] || 0));
    const lead = ids.filter((id) => top > 0 && (info.wins[id] || 0) === top);
    crown = new Set(lead.length < ids.length ? lead : []);
    gfx.fx.crown(crown);
  }

  // ---------------------------------------------------------------- input
  const myInput = { mx: 0, mz: 0, jh: false, j: 0, d: 0, s: 0, face: 0 };
  let spec = null, shownCount = 0;
  input.on('press', (a) => {
    if (a === 'primary' && !amAlive() && !ctx.spectator && phase === 'play' && aimPt && performance.now() >= ghostReadyAt) {
      net.toHost({ t: 'throw', x: +aimPt.x.toFixed(2), z: +aimPt.z.toFixed(2) });
      ghostReadyAt = performance.now() + (C.GHOST_CD * 1000) / (api.turbo || 1);
      return;
    }
    if (a === 'primary' && amAlive() && !input.mouse.locked) input.lockPointer();
    if ((a === 'jump' || a === 'secondary' || (a === 'primary' && ctx.spectator)) && !amAlive()) cycleSpectate();
    if (!amAlive() || phase !== 'play') return;
    if (a === 'jump') sfx.jump();
  });
  input.on('wheel', (e) => { gfx.cam.dist = baseDist = Math.max(6, Math.min(15, gfx.cam.dist + e.deltaY * 0.006)); });
  function readInput(dt) {
    const ax = input.axis();
    const yaw = gfx.cam.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
    let mx = rx * ax.x + fx * -ax.y, mz = rz * ax.x + fz * -ax.y;
    const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    myInput.mx = mx; myInput.mz = mz; myInput.jh = input.down('jump');
    myInput.j = input.presses('jump'); myInput.d = input.presses('boost'); myInput.s = input.presses('primary') + input.presses('use');
  }
  const amAlive = () => { if (ctx.spectator) return false; if (net.isHost && sim) return !!sim.byId.get(ctx.myId)?.alive; return !!me?.alive; };
  function cycleSpectate() {
    const alive = ids.filter((id) => view.get(id)?.alive && id !== ctx.myId);
    if (!alive.length) return;
    const i = alive.indexOf(spec); spec = alive[(i + 1) % alive.length];
  }

  // ---------------------------------------------------------------- host
  const cfg = () => ({ ids, bots: new Set(ctx.players.filter((p) => p.isBot).map((p) => p.id)), levelFor, need, maxRounds, botLevel: ctx.bots.level, Brain: ctx.bots.Brain, ev: hostEvent });
  function hostEvent(type, d) {
    switch (type) {
      case 'hit': net.toAll({ t: 'hit', ...d }); break;
      case 'shove': net.toAll({ t: 'sh', id: d.id, hit: d.hit }); break;
      case 'die': net.toAll({ t: 'die', ...d, tm: +sim.t.toFixed(3) }); break;
      case 'roundEnd': net.toAll({ t: 're', ...d }); break;
      case 'round': net.toAll({ t: 'rd', round: d.round }); break;
      case 'play': net.toAll({ t: 'go', round: d.round }); break;
      case 'bomb': net.toAll({ t: 'bomb', id: d.id, by: d.by, x: +d.x.toFixed(2), z: +d.z.toFixed(2), land: +d.land.toFixed(3) }); break;
      case 'boom': net.toAll({ t: 'boom', id: d.id, by: d.by, x: d.x, y: d.y, z: d.z }); break;
      case 'final': net.toAll({ t: 'f2', ids: d.ids }); break;
      case 'done': finish(); break;
    }
  }
  function finish() {
    if (ended || !sim) return; ended = true;
    const stats = {};
    for (const id of ids) { const w = sim.wins[id] || 0, k = sim.ko[id] || 0; stats[id] = `${w} round win${w === 1 ? '' : 's'} · outlived ${sim.pts[id] || 0}${k ? ` · ${k} bomb KO` : ''}`; }
    const pl = sim.standings();
    const champ = pl[0]?.length === 1 ? ctx.player(pl[0][0])?.name : null;
    ctx.endGame(pl, { stats, title: champ ? `${champ} is King of the Volcano!` : 'The volcano has spoken!' });
  }
  function hostInputFor(id) { return inputs.get(id); }
  if (net.isHost) sim = new HostSim(cfg());
  function becomeHost() {
    sim = HostSim.fromView(cfg(), info, lastSnap);
    const mine = sim.byId.get(ctx.myId);
    if (mine && me) Object.assign(mine, { x: me.x, y: me.y, z: me.z, vx: me.vx, vy: me.vy, vz: me.vz, alive: me.alive, gr: me.gr, face: me.face, lj: me.lj, ld: me.ld, ls: me.ls });
    if (ctx.started && sim.phase === 'wait') sim.go();
    graceUntil = performance.now() + 4000;
    inputs.clear();
  }
  ctx.on('hostchange', ({ amHost }) => { if (amHost && !sim) becomeHost(); });
  ctx.on('join', (id) => { if (net.isHost && sim) net.to(id, { t: 'info', round: sim.round, wins: sim.wins, pts: sim.pts, ko: sim.ko, deaths: sim.deaths, hist: sim.hist }); });
  ctx.on('go', () => { if (net.isHost && sim) sim.go(); });

  function adopt(from, m) {
    const p = sim.byId.get(from);
    if (!p || !p.alive || sim.phase !== 'play' || !Array.isArray(m.p)) return;
    if (m.a !== p.auth) return;
    const now = performance.now();
    if (now - (sim.kbAt[from] || 0) < 450 || p.stun > 0) return;
    const [x, y, z, vx, vy, vz, gr] = m.p;
    if (![x, y, z, vx, vy, vz].every(Number.isFinite)) return;
    const d = Math.hypot(x - p.x, y - p.y, z - p.z);
    if (d < 1.8 || now < graceUntil) {
      Object.assign(p, { x, y, z, vx, vy, vz });
      const s = gr >= 0 ? sim.S[gr] : null;
      p.gr = s && s.solid && Math.hypot(s.x - x, s.z - z) < s.r + 0.4 && Math.abs(s.top - y) < 0.3 ? gr : -1;
      if (p.gr >= 0) p.y = s.top;
      if (Number.isFinite(m.i?.face)) p.face = m.i.face;
    } else p.auth = (p.auth + 1) & 255;
  }

  // ---------------------------------------------------------------- messages
  net.onMessage((m, from) => {
    switch (m.t) {
      case 'in': if (net.isHost && sim && from !== ctx.myId) { inputs.set(from, m.i); adopt(from, m); } break;
      case 'throw': if (net.isHost && sim && Number.isFinite(m.x) && Number.isFinite(m.z)) sim.throwBomb(from, m.x, m.z); break;   // client -> host request; host broadcasts 'bomb'
      case 'bomb': api.stats.bombs = (api.stats.bombs || 0) + 1; if (m.by === ctx.myId) api.stats.myBombs = (api.stats.myBombs || 0) + 1; gfx.fx.bomb(m, ctx.player(m.by)?.colorHex ?? 0xffffff, lava); if (m.by === ctx.myId) ghostReadyAt = performance.now() + ((m.land - tC) / (api.turbo || 1) + C.GHOST_CD - C.BOMB_T) * 1000; sfx.whistle(); break;
      case 'boom': { gfx.fx.boom(m.id, m.x, m.y, m.z); const f = view.get(camFocus); const d = f ? Math.hypot(f.x - m.x, f.z - m.z) : 99; sfx.boom(d < 6); if (d < 7) gfx.fx.shake(0.7 - d * 0.07); break; }
      case 'f2': ui.banner('🔥 FINAL TWO! 🔥', 2000); sfx.surge(); gfx.fx.shake(0.4); break;
      case 'hit': onHit(m); break;
      case 'sh': if (m.id !== ctx.myId) { const v = view.get(m.id); if (v) gfx.fx.shove(v.x, v.y, v.z, v.face, ctx.player(m.id).colorHex); sfx.shove(m.hit); } break;
      case 'die': onDie(m); break;
      case 're': onRoundEnd(m); break;
      case 'rd': info.round = m.round; info.deaths = []; break;
      case 'go': break;
      case 'info': Object.assign(info, { round: m.round, wins: { ...m.wins }, pts: { ...m.pts }, ko: { ...(m.ko || {}) }, deaths: m.deaths.map((g) => [...g]), hist: m.hist || [] }); break;
    }
  });
  function onHit(m) {
    const v = view.get(m.v);
    if (v) gfx.fx.hit(v.x, v.y, v.z);
    const mine = m.v === ctx.myId || m.a === ctx.myId;
    sfx.hit(mine);
    if (mine) gfx.fx.shake(m.v === ctx.myId ? 0.8 : 0.4);
    if (m.v === ctx.myId && !net.isHost && me && me.alive) { Object.assign(me, { vx: m.vx, vy: m.vy, vz: m.vz, gr: -1, stun: C.STUN, dashT: 0, jumping: false, coyote: 0 }); }
  }
  function onDie(m) {
    const last = info.deaths[info.deaths.length - 1];
    if (last && last.tm === m.tm) last.push(m.id); else { const g = [m.id]; g.tm = m.tm; info.deaths.push(g); }
    gfx.fx.die(m.x, Math.max(m.y, lava), m.z); if (m.y <= lava + 0.5) gfx.fx.splash(m.x, lava, m.z);
    const mine = m.id === ctx.myId;
    sfx.burn(mine);
    const v = view.get(m.id); if (v) v.alive = false;
    if (mine) { if (me) me.alive = false; gfx.fx.shake(1); ui.banner('🔥 TOASTED!', 1600); }
    const name = ctx.player(m.id)?.name || '?';
    const by = m.by ? ctx.player(m.by)?.name : null;
    if (!mine) ui.toast(m.ghost && by ? `👻 ${by}'s lava bomb got ${name}!` : by ? `💥 ${by} shoved ${name} into the lava` : `🔥 ${name} melted`, m.by === ctx.myId ? 'gold' : '', 2600);
    if (mine) { ghostReadyAt = performance.now() + (C.GHOST_FIRST * 1000) / (api.turbo || 1); ctx.setTimeout(() => { if (phase === 'play') ui.toast('👻 You are a volcano spirit: click to lob lava bombs!', 'gold', 3500); }, 1700); }
    if (m.ghost && m.by === ctx.myId) { ui.toast(`👻 Revenge! Your bomb got ${name}`, 'gold', 2600); ctx.audio.play('coin'); }
  }
  function onRoundEnd(m) {
    info.wins = { ...m.wins }; info.pts = { ...m.pts }; info.ko = { ...(m.ko || {}) }; info.hist.push({ round: m.round, winners: m.winners });
    victory.clear(); for (const id of m.winners) victory.add(id);
    const names = m.winners.map((id) => ctx.player(id)?.name || '?');
    const mine = m.winners.includes(ctx.myId);
    if (N === 1) ui.banner(`🔥 You lasted ${Math.round(m.t)} s`, 3000);
    else if (!m.winners.length) ui.banner('🌋 The volcano wins!', 3000);
    else ui.banner(mine ? '🏆 YOU SURVIVED!' : `🏆 ${names.join(' & ')} survived!`, 3000);
    sfx.roundWin(mine);
  }

  // ---------------------------------------------------------------- snapshots (clients)
  net.onRaw((buf) => {
    if (net.isHost) return;
    const s = decodeSnap(buf); if (!s) return;
    lastSnap = s; api.stats.snaps++;
    if (s.round !== round) useRound(s.round);
    if (s.round !== info.round) { info.round = s.round; info.deaths = []; }
    const ping = net.ping() || 60;
    if (s.phase !== phase) { if (s.phase === 'play') tC = s.t; phase = s.phase; }
    phaseT = s.phaseT;
    if (phase === 'play') { const target = s.t + ping / 2000; if (Math.abs(target - tC) > 0.4) tC = target; else tC += (target - tC) * 0.1; }
    else if (phase === 'post') tC = s.t;
    st.set(s.st.subarray(0, st.length));
    const now = performance.now();
    for (const r of s.players) {
      const id = ids[r.idx]; if (!id) continue;
      if (id === ctx.myId && me) {
        if (r.auth !== me.auth || phase === 'wait' || phase === 'intro') {
          if (phase === 'play' && me.auth >= 0) api.stats.corrections++;
          Object.assign(me, { x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, gr: -1, alive: r.alive }); me.auth = r.auth;
          if (phase !== 'play') me.face = r.face;
        }
        if (!r.alive) me.alive = false;
        continue;
      }
      let v = view.get(id); if (!v) { v = {}; view.set(id, v); }
      v.px = v.x ?? r.x; v.py = v.y ?? r.y; v.pz = v.z ?? r.z; v.pface = v.face ?? r.face;
      v.tx = r.x; v.ty = r.y; v.tz = r.z; v.tface = r.face; v.at = now; v.span = Math.max(30, now - (v.lastAt || now - 50)); v.lastAt = now;
      Object.assign(v, { vx: r.vx, vy: r.vy, vz: r.vz, alive: r.alive, grounded: r.grounded, dashing: r.dashing, stunned: r.stunned, shoving: r.shoving });
    }
  });

  // ---------------------------------------------------------------- host tick (60 Hz, runs in background tabs)
  let snapAcc = 0, hostAcc = 0;
  ctx.tick((dt) => {
    if (!net.isHost || !sim || ended) return;
    sim.timeScale = api.turbo || 1;
    hostAcc += dt; let n = 0;
    while (hostAcc >= STEP && n < 12) {
      const mine = sim.byId.get(ctx.myId);
      if (mine && !ctx.spectator) inputs.set(ctx.myId, api.autopilot ? { ...botThink(sim.world, mine, myBot, STEP) } : { ...myInput });
      sim.step(STEP, inputs, (id) => id === ctx.myId || ctx.connected(id));
      hostAcc -= STEP; n++;
      if (ended) return;
    }
    if (n >= 12) hostAcc = 0;
    snapAcc += dt;
    if (snapAcc >= 1 / SNAP_HZ) {
      snapAcc = 0;
      net.rawToAll(encodeSnap({ round: sim.round, phase: sim.phase, t: sim.t, phaseT: sim.phaseT, players: sim.players, st: sim.st }));
    }
  });

  // ---------------------------------------------------------------- frame: prediction, camera, render, HUD
  let camFocus = ctx.myId, victoryT = 0; const victory = new Set(); let baseDist = gfx.cam.dist;
  let sendAcc = 0, predAcc = 0, lastPhase = 'wait', lastCount = 0, meterLbl = '';
  useRound(0);
  ctx.frame((dt, now) => {
    if (!ctx.started) { myInput.mx = myInput.mz = 0; }
    readInput(dt);
    const host = net.isHost && sim;
    // --- round / phase bookkeeping
    if (host) {
      if (sim.round !== round) useRound(sim.round);
      S = sim.S; st = sim.st; lava = sim.lava; phase = sim.phase; phaseT = sim.phaseT; tC = sim.t;
      info.round = sim.round; info.wins = sim.wins; info.pts = sim.pts; info.ko = sim.ko; info.deaths = sim.deaths; info.hist = sim.hist;
      for (const p of sim.players) { const v = view.get(p.id); if (!v) continue; Object.assign(v, { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, face: p.face, alive: p.alive, grounded: p.gr >= 0, dashing: p.dashT > 0, stunned: p.stun > 0, shoving: p.shoveT > 0 }); }
    } else if (level) {
      phaseT += dt * (api.turbo || 1);
      if (phase === 'play') tC += dt * (api.turbo || 1);
      const tl = phase === 'play' || phase === 'post' ? tC : 0;
      // client prediction of my player (fixed steps, platforms evaluated at the same clock)
      if (me && me.alive && phase === 'play') {
        predAcc += dt; let k = 0; const t0 = tC - predAcc;
        while (predAcc >= STEP && k < 8) {
          const ts = t0 + (k + 1) * STEP;
          lava = lavaAt(level.lv, ts); updateSolids(level, S, st, ts, lava, STEP);
          const inp = api.autopilot ? botThink({ S, st, lava, lv: level.lv, t: ts, players: [...ids.map((id) => (id === ctx.myId ? me : { ...view.get(id), id, gr: -1 }))], level }, me, myBot, STEP) : myInput;
          const ev = stepPlayer(me, inp, STEP, S);
          if (ev & 2) { sfx.dash(); gfx.fx.kick(1); }
          if (ev & 4) { gfx.fx.shove(me.x, me.y, me.z, me.face, ctx.player(ctx.myId).colorHex); sfx.shove(false); }
          if (ev & 8) { sfx.land(Math.min(1, me.landed / 15)); gfx.fx.land(me.x, me.y, me.z, Math.min(1, me.landed / 15)); }
          for (const [id, v] of view) if (id !== ctx.myId && v.alive) separate(me, v, false);
          if (me.y <= lava + 0.02) { me.alive = false; }
          predAcc -= STEP; k++;
        }
        if (k >= 8) predAcc = 0;
      } else { predAcc = 0; lava = lavaAt(level.lv, tl); updateSolids(level, S, st, tl, lava, dt); syncCounters(me || {}, myInput); }
      // others: interpolate between the last two snapshots
      for (const [id, v] of view) {
        if (id === ctx.myId || v.tx == null) continue;
        const f = Math.min(1.2, (now - v.at) / v.span);
        v.x = v.px + (v.tx - v.px) * f; v.y = v.py + (v.ty - v.py) * f; v.z = v.pz + (v.tz - v.pz) * f;
        let da = v.tface - v.pface; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; v.face = v.pface + da * Math.min(1, f);
      }
      if (me) { const v = view.get(ctx.myId); Object.assign(v, { x: me.x, y: me.y, z: me.z, vx: me.vx, vy: me.vy, vz: me.vz, face: me.face, alive: me.alive, grounded: me.gr >= 0, dashing: me.dashT > 0, stunned: me.stun > 0, shoving: me.shoveT > 0 }); }
      // send input + predicted state
      sendAcc += dt;
      if (me && !ctx.spectator && sendAcc >= 1 / SEND_HZ) { sendAcc = 0; myInput.face = me.face; net.toHost({ t: 'in', i: { ...myInput }, p: [+me.x.toFixed(3), +me.y.toFixed(3), +me.z.toFixed(3), +me.vx.toFixed(2), +me.vy.toFixed(2), +me.vz.toFixed(2), me.gr], a: me.auth }); }
    }
    // host-side local feedback for my own actions (clients get theirs from prediction above)
    if (host) {
      const mp = sim.byId.get(ctx.myId);
      if (mp) {
        if (mp.dashT > 0 && !mp._dashFx) { mp._dashFx = true; sfx.dash(); gfx.fx.kick(1); } else if (mp.dashT <= 0) mp._dashFx = false;
        if (mp.shoveT > 0 && !mp._shFx) { mp._shFx = true; gfx.fx.shove(mp.x, mp.y, mp.z, mp.face, ctx.player(ctx.myId).colorHex); sfx.shove(false); } else if (mp.shoveT <= 0) mp._shFx = false;
        if (mp.gr >= 0 && mp._air) { const k = Math.min(1, (mp._vy || 0) / 15); sfx.land(k); gfx.fx.land(mp.x, mp.y, mp.z, k); }
        mp._air = mp.gr < 0; if (mp.gr < 0) mp._vy = -mp.vy;
      }
    }
    // --- phase cues (round intro countdown, GO)
    if (phase !== lastPhase) {
      if (phase === 'intro') { ui.banner(`ROUND ${round + 1}`, 1700); if (crown.size) ctx.setTimeout(() => ui.toast(`👑 ${[...crown].map((id) => ctx.player(id)?.name).join(' & ')} wear${crown.size > 1 ? '' : 's'} the Hot Crown: rocks heat faster under them!`, '', 3200), 1200); ui.toast(`${LAYOUTS[level.layout].name} · ${PATTERNS[level.pattern].icon} ${PATTERNS[level.pattern].name}`, 'gold', 2600); gfx.cam.intro = 1; }
      if (phase === 'play') { gfx.fx.erupt(lava); sfx.erupt(); }
      if (phase === 'play' && lastPhase === 'intro') { ui.countdown(0); }
      if (phase === 'post') victoryT = 0;
      if (phase !== 'post') { victory.clear(); gfx.cam.dist = baseDist; gfx.cam.pitch = 0.5; }
      if (phase === 'play' && round === 0) { ui.toast(`${LAYOUTS[level.layout].name} · ${PATTERNS[level.pattern].icon} ${PATTERNS[level.pattern].name}`, 'gold', 2600); }
      lastPhase = phase;
    }
    if (phase === 'intro') { const c = Math.ceil(INTRO_T - phaseT); if (c >= 1 && c <= 3 && c !== lastCount) { lastCount = c; ui.countdown(c); } } else lastCount = 0;
    // --- camera
    const vic = phase === 'post' && victory.size ? [...victory].find((id) => view.get(id)?.alive) : null;
    const focusId = camFocus = vic ? vic : amAlive() ? ctx.myId : (spec && view.get(spec)?.alive ? spec : (spec = ids.find((id) => view.get(id)?.alive && id !== ctx.myId) || spec));
    const f = view.get(focusId) || view.get(ctx.myId) || [...view.values()][0];
    const cam = gfx.cam;
    if (f) { const k = Math.min(1, dt * 10); cam.x += (f.x - cam.x) * k; cam.z += (f.z - cam.z) * k; cam.y += (f.y - cam.y) * Math.min(1, dt * 6); }
    if (vic) { victoryT += dt; cam.yaw += dt * 0.7; cam.dist += (6.5 - cam.dist) * Math.min(1, dt * 2); cam.pitch += (0.3 - cam.pitch) * Math.min(1, dt * 2); input.takeMouseDelta(1); }
    else if (input.mouse.locked) { const d = input.takeMouseDelta(ctx.settings.get('sens') || 1); cam.yaw -= d.x * 0.0032; cam.pitch = Math.max(0.12, Math.min(1.2, cam.pitch + d.y * 0.0026)); }
    else if (f && Math.hypot(f.x, f.z) > 2.5) { const want = Math.atan2(-f.x, -f.z); let da = want - cam.yaw; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; cam.yaw += Math.max(-1, Math.min(1, da)) * dt * 0.9; }
    if (cam.intro > 0) cam.intro = Math.max(0, cam.intro - dt / (phase === 'intro' ? INTRO_T - 0.6 : 3.2));
    // --- audio bed
    const my = view.get(focusId);
    const danger = my ? Math.max(0, Math.min(1, 1 - (my.y - lava) / 4)) : 0;
    const si = level ? surgeIn(level.lv, tC) : -1;
    if (si > 0 && si < 1.6 && !gfx._surgeWarned) { gfx._surgeWarned = true; sfx.surge(); gfx.fx.shake(0.5); }
    if (si < 0 || si > 2) gfx._surgeWarned = false;
    sfx.update(dt, { intensity: level && phase === 'play' ? Math.min(1, tC / level.lv.T) : 0, final: ids.filter((id) => view.get(id)?.alive).length <= 2 && N > 2, danger: phase === 'play' ? danger : 0, surge: si > 0 && si < 1.6 ? 1 - si / 1.6 : 0, active: phase === 'play' });
    // --- render
    gfx.update(dt, now, { S, st, lava, t: tC, danger: amAlive() && phase === 'play' ? danger : 0, victory: phase === 'post' ? victory : null, groundAt: (x, z) => groundAt(S, x, z, lava), players: view, onCrumble: (p) => { const near = f && Math.hypot(p.x - f.x, p.z - f.z) < 6; sfx.crumble(near); if (near) gfx.fx.shake(0.35); }, onCrack: () => sfx.crack(), onRise: (p) => { if (f && Math.hypot(p.x - f.x, p.z - f.z) < 9) sfx.rise(); } });
    // --- ghost aim (eliminated players lob lava bombs)
    const ghost = !amAlive() && !ctx.spectator && phase === 'play' && !!S;
    const ready = performance.now() >= ghostReadyAt;
    aimPt = gfx.aimAt(input.mouse.locked ? 0 : input.mouse.nx, input.mouse.locked ? 0 : input.mouse.ny, f ? f.y : lava + 2, ghost, ready, ctx.player(ctx.myId)?.colorHex ?? 0xffffff, (x, z) => groundAt(S, x, z, lava));
    // --- HUD
    const myView = view.get(ctx.myId);
    const myPlat = amAlive() && me ? (host ? sim.byId.get(ctx.myId)?.gr : me.gr) : -1;
    const heat = myPlat >= 0 && level?.plats[myPlat].kind === 'basalt' ? Math.min(1, st[myPlat] / 100) : myPlat >= 0 && level?.plats[myPlat].kind === 'pumice' ? Math.min(1, st[myPlat] / 100 / C.PUMICE_FLOAT) : 0;
    hot.style.boxShadow = `inset 0 0 120px 30px rgba(255,80,20,${(Math.max(heat - 0.35, 0) * 0.9 + danger * 0.35 * (amAlive() ? 1 : 0)).toFixed(2)})`;
    if (heat > 0.55 && amAlive()) sfx.sizzle(heat);
    const T = level ? level.lv.T : 80;
    if (phase === 'play') { if (tC < T) ui.timer(tC, { warn: -1 }); else ui.timer(0, { text: '🔥 NO MORE ROCK' }); } else ui.timer(null);
    const L = level ? `${LAYOUTS[level.layout].name}` : '';
    ui.status(ctx.spectator ? `👀 Spectating · Round ${round + 1}` : amAlive() || phase !== 'play' ? `🌋 Round ${round + 1}${maxRounds > 1 ? '/' + maxRounds : ''} · ${L}` : `💀 Out · watching ${ui.esc(ctx.player(focusId)?.name || '…')}`);
    hint.textContent = ghost ? (ready ? 'Aim with the mouse · click to drop a lava bomb' : '') : heat > 0.7 && phase === 'play' ? 'HOT! Move!' : '';
    const order = standingsOf(ids, info.wins, info.pts, null, info.ko).flat();
    ui.mini(order.map((id) => { const p = ctx.player(id), v = view.get(id); return { id, name: p.name, color: p.color, value: (crown.has(id) ? '👑' : '') + ('★'.repeat(info.wins[id] || 0) || '·'), me: id === ctx.myId, out: !v?.alive }; }), need > 1 ? `First to ${need} ★` : '');
    const mp = host ? sim.byId.get(ctx.myId) : me;
    const dim = !amAlive();
    if (ghost) ui.abilities([
      { key: 'Click', label: '🔥 Lava bomb', cd: Math.max(0, ghostReadyAt - performance.now()) / (C.GHOST_CD * 1000), ready, wide: true },
      { key: 'Space', label: 'View', ready: true },
    ]);
    else ui.abilities([
      { key: 'Space', label: 'Jump', ready: !dim, dim },
      { key: 'Shift', label: mp && mp.gr < 0 && mp.airDash ? 'Dash ✗' : 'Dash', cd: (mp?.dashCd || 0) / C.DASH_CD, ready: !dim && (mp?.dashCd || 0) <= 0, dim },
      { key: 'Click', label: 'Shove', cd: (mp?.shoveCd || 0) / C.SHOVE_CD, ready: !dim && (mp?.shoveCd || 0) <= 0, dim },
    ]);
    // height meter
    if (level) {
      const lo = lava - 3, hi = lava + 11, H = meter.clientHeight || 1;
      const fy = (y) => Math.max(0, Math.min(1, (y - lo) / (hi - lo)));
      meter.firstChild.style.height = (fy(lava) * 100).toFixed(1) + '%';
      for (const [id, d] of dots) { const v = view.get(id); d.style.opacity = v?.alive ? 1 : 0; if (v) d.style.top = ((1 - fy(v.y)) * H).toFixed(0) + 'px'; }
      const lbl = myView?.alive ? `${Math.max(0, myView.y - lava).toFixed(1)} m` : '';
      if (lbl !== meterLbl) { meterLbl = lbl; meter.lastChild.textContent = lbl; }
      meter.lastChild.style.bottom = (fy(lava) * 100).toFixed(1) + '%';
    }
  });

  ui.setScoreboard(() => ({ columns: ['Player', 'Round wins', 'Outlived', 'Bomb KOs', 'This round'], rows: standingsOf(ids, info.wins, info.pts, null, info.ko).flat().map((id) => [ui.esc((crown.has(id) ? '👑 ' : '') + (ctx.player(id)?.name || id)), '★'.repeat(info.wins[id] || 0) || '0', info.pts[id] || 0, info.ko[id] || 0, view.get(id)?.alive ? 'alive' : 'out']) }));

  return {
    standings: () => (sim ? sim.standings() : standingsOf(ids, info.wins, info.pts, null, info.ko)),
    stop() {
      sfx.dispose(); gfx.dispose(); levels.clear();
      if (window.__lava === api) delete window.__lava;
    },
  };
}
