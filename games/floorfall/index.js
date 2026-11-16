// FLOOR IS FALLING — last one standing on a stack of hexagon floors high above a glowing void. Every tile you
// touch cracks and drops about half a second later, so every step burns the floor: movement is planning. Fall
// through a hole and you land on the layer below; fall off the bottom layer and you're out. Jump to cross a gap
// or stall on a cracking tile, dash to bump rivals into holes you cut. Best of 3 (host option).
//
// Net model: the host runs HostSim (sim.js) at 60 Hz with every bot. Clients predict their own player against
// their copy of the tiles and send input + predicted state at 30 Hz; the host adopts that state when it is
// plausible and otherwise forces a correction (auth counter). Tile cracks are reliable events with an absolute
// drop time on the round clock, so every client drops the same tile at the same moment. Snapshots at 15 Hz.
export { manifest } from './manifest.js';
import { C, makeLevel, newPlayer, stepPlayer, syncCounters, layerOf, solidCount, LAYER_NAMES, tileAt } from './world.js';
import { HostSim, standingsOf } from './sim.js';
import { makeBot, botThink } from './bots.js';
import { createView } from './render.js';
import { createSound } from './sound.js';

const SNAP_HZ = 15, SEND_HZ = 30;
const MATCH = { bo3: [2, 3], bo5: [3, 5], one: [1, 1] };
const r2 = (v) => Math.round(v * 100) / 100;

export async function start(ctx) {
  const { ui, input, net } = ctx;
  const N = ctx.players.length, ids = ctx.players.map((p) => p.id), myIdx = ids.indexOf(ctx.myId);
  const [need, maxRounds] = MATCH[ctx.options.match] || MATCH.bo3;
  const lopts = { layers: +ctx.options.layers || 4, shape: ctx.options.shape || 'random', delay: ctx.options.delay || 'normal', players: N };
  const levels = new Map();
  const levelFor = (k) => { if (!levels.has(k)) levels.set(k, makeLevel(ctx.rng(0x100 + k * 977), lopts, k)); return levels.get(k); };
  const api = { autopilot: false, turbo: 1 };            // test-only hooks (tests/drivers.mjs)
  window.__ff = api;

  const gfx = createView(ctx);
  const snd = createSound(ctx);
  ctx.on('resize', gfx.resize);
  ctx.on('settings', (k) => { if (k === 'quality') gfx.applyQ(); });

  // ---------------------------------------------------------------- shared client view of the match
  const info = { wins: Object.fromEntries(ids.map((id) => [id, 0])), pts: Object.fromEntries(ids.map((id) => [id, 0])), out: [] };
  let round = -1, level = null, phase = 'wait', phaseT = 0, tC = 0, ended = false;
  let snapA = null, snapB = null, snapAt = 0, snapGap = 1 / SNAP_HZ;
  const view = new Map();         // id -> drawn state
  let me = null;                  // my predicted player (clients)
  let sim = null;
  let spec = null;                // who I watch when I'm out
  const myInput = { mx: 0, mz: 0, j: 0, d: 0 };
  const myBot = makeBot(ctx.bots.Brain, ctx.bots.level);

  function useRound(k) {
    if (k === round) return;
    round = k; level = levelFor(k); tC = 0; info.out = []; spec = null;
    gfx.buildLevel(level);
    view.clear(); snapA = snapB = null;
    ctx.players.forEach((p, i) => { const s = newPlayer(p.id, level, i); view.set(p.id, s); });
    if (myIdx >= 0 && !net.isHost) { me = newPlayer(ctx.myId, level, myIdx); me.auth = -1; syncCounters(me, myInput); }
    const f = view.get(ctx.myId) || view.get(ids[0]);
    if (f) Object.assign(gfx.cam, { x: f.x, y: f.y + 6, z: f.z });
  }
  useRound(0);
  api.dbg = () => ({ phase, round, t: +tC.toFixed(1), host: net.isHost, wins: { ...info.wins }, alive: [...positions().values()].map((p) => (p.alive ? `${p.l}:${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}` : 'X')) });

  // ---------------------------------------------------------------- input
  input.on('press', (a) => {
    if (amAlive() || !level) return;
    if (a === 'jump' || a === 'primary' || a === 'secondary') cycleSpectate();
  });
  function cycleSpectate() {
    const alive = ids.filter((id) => id !== ctx.myId && livingNow(id));
    if (!alive.length) return;
    spec = alive[(alive.indexOf(spec) + 1) % alive.length];
  }
  const livingNow = (id) => (net.isHost && sim ? sim.byId.get(id)?.alive : view.get(id)?.alive) !== false;
  const myState = () => (net.isHost && sim ? sim.byId.get(ctx.myId) : me);
  const amAlive = () => !ctx.spectator && !!myState()?.alive;
  function readInput(dt) {
    const ax = input.axis();
    myInput.mx = ax.x; myInput.mz = ax.y;
    myInput.j = input.presses('jump'); myInput.d = input.presses('boost');
    const p = myState();
    if (api.autopilot && p?.alive && level) {
      botThink(myBot, p, { lv: level, t: tC, players: [...positions().values()] }, dt);
      myInput.mx = myBot.inp.mx; myInput.mz = myBot.inp.mz; myInput.j += myBot.inp.j * 1000; myInput.d += myBot.inp.d * 1000;
    }
    if (phase !== 'play' || !ctx.started) { myInput.mx = myInput.mz = 0; if (p) syncCounters(p, myInput); }
  }

  // ---------------------------------------------------------------- host
  const cfg = () => ({ ids, bots: new Set(ctx.players.filter((p) => p.isBot).map((p) => p.id)), levelFor, need, maxRounds, level: ctx.bots.level, Brain: ctx.bots.Brain,
    ev: hostEvent, turbo: () => api.turbo || 1, connected: (id) => ctx.connected(id), myId: ctx.myId, myInput });
  function hostEvent(type, d) {
    switch (type) {
      case 'round': net.toAll({ t: 'rd', k: d.round }); break;
      case 'play': net.toAll({ t: 'pl', k: d.round }); break;
      case 'out': net.toAll({ t: 'out', id: d.id, by: d.by, left: d.left }); break;
      case 'roundEnd': net.toAll({ t: 're', winners: d.winners, wins: d.wins, pts: sim.pts, k: d.round }); break;
      case 'hit': net.toAll({ t: 'hit', ...d }); break;
      case 'dash': net.toAll({ t: 'da', id: d.id }); break;
      case 'thud': net.toAll({ t: 'th', id: d.id }); break;
      case 'done': finish(); break;
    }
  }
  function finish() {
    if (ended || !sim) return; ended = true;
    const stats = {};
    for (const id of ids) { const w = sim.wins[id] || 0; stats[id] = `${w} round win${w === 1 ? '' : 's'} · outlived ${sim.pts[id] || 0} · ${sim.bumps[id] || 0} bumps`; }
    ctx.endGame(sim.standings(), { stats });
  }
  function snapshot() {
    return { t: 's', r: sim.round, ph: sim.phase, pt: r2(sim.phaseT), tm: +sim.t.toFixed(3),
      p: sim.players.map((p) => [r2(p.x), r2(p.y), r2(p.z), r2(p.vx), r2(p.vy), r2(p.vz), p.g ? 1 : 0, p.l, r2(p.face), p.alive ? 1 : 0, p.auth, r2(p.dashCd), r2(p.stun), r2(p.dashT)]) };
  }
  function fullSync() {
    const lv = sim.level, tiles = [];
    lv.layers.forEach((L, h) => { for (let i = 0; i < L.n; i++) if (L.at[i] !== Infinity) tiles.push(h, i, +L.at[i].toFixed(3), L.who[i]); });
    return { t: 'full', k: sim.round, ph: sim.phase, pt: sim.phaseT, tm: sim.t, wins: sim.wins, pts: sim.pts, out: sim.out, tiles, s: snapshot() };
  }
  function becomeHost() {
    const players = ids.map((id, i) => {
      const v = id === ctx.myId && me ? me : view.get(id);
      return v ? { id, x: v.x, y: v.y, z: v.z, vx: v.vx || 0, vy: v.vy || 0, vz: v.vz || 0, g: !!v.g, l: v.l ?? level.L - 1, face: v.face || 0, alive: v.alive !== false, auth: v.auth || 0, dashCd: v.dashCd || 0, stun: 0, dashT: 0 } : { id };
    });
    sim = new HostSim(cfg(), { round, phase: phase === 'wait' && ctx.started ? 'play' : phase, phaseT, t: tC, wins: info.wins, pts: info.pts, out: info.out, players });
    const mp = sim.byId.get(ctx.myId); if (mp) syncCounters(mp, myInput);
    net.toAll(fullSync(), false);
  }
  if (net.isHost) sim = new HostSim(cfg());
  ctx.on('hostchange', ({ amHost }) => { if (amHost && !sim) becomeHost(); });
  ctx.on('join', (id) => { if (net.isHost && sim) net.to(id, fullSync()); });
  ctx.on('go', () => { if (net.isHost && sim) sim.go(); snd.music(true); });

  let snapAcc = 0;
  ctx.tick((dt) => {
    if (!net.isHost || !sim || ended) return;
    readInput(dt);
    sim.step(dt, ctx.myId, myInput);
    if (sim.pending.length) { net.toAll({ t: 'tr', k: sim.pending }, false); sim.pending = []; }
    snapAcc += dt;
    if (snapAcc >= 1 / SNAP_HZ) { snapAcc = 0; net.toAll(snapshot(), false); }
    tC = sim.t; phase = sim.phase; phaseT = sim.phaseT;
  });

  // ---------------------------------------------------------------- messages
  net.onMessage((m, from) => {
    switch (m.t) {
      case 'in': if (net.isHost && sim) sim.input(from, m.i, m.s); break;
      case 's': if (!net.isHost) onSnap(m); break;
      case 'tr': if (!net.isHost) applyTiles(m.k); break;
      case 'full': if (!net.isHost) {
        useRound(m.k); phase = m.ph; phaseT = m.pt; tC = m.tm; Object.assign(info.wins, m.wins); Object.assign(info.pts, m.pts); info.out = [...m.out];
        applyTiles(m.tiles, true); onSnap(m.s);
        break;
      }
      case 'rd': useRound(m.k); phase = 'intro'; ui.banner(`ROUND ${m.k + 1}`, 1600); snd.round(); break;
      case 'pl': if (m.k === round) { phase = 'play'; if (m.k > 0) { ui.banner('GO!', 700); ctx.audio.play('go'); } } break;
      case 'out': {
        if (!info.out.includes(m.id)) info.out.push(m.id);
        const v = view.get(m.id); if (v) v.alive = false;
        if (m.id === ctx.myId && me) me.alive = false;
        const mine = m.id === ctx.myId, nm = ctx.player(m.id)?.name || '?', by = m.by && ctx.player(m.by)?.name;
        snd.out(mine);
        if (mine) { ui.banner('YOU FELL!', 1600); gfx.shake(0.6); }
        else ui.toast(by ? `${nm} was bumped into the void by ${by}!` : `${nm} fell into the void!`, m.by === ctx.myId ? 'gold' : '', 2400);
        if (spec === m.id) spec = null;
        break;
      }
      case 're': {
        phase = 'end'; Object.assign(info.wins, m.wins); Object.assign(info.pts, m.pts);
        const names = m.winners.map((id) => ctx.player(id)?.name || '?');
        const mine = m.winners.includes(ctx.myId);
        ui.banner(names.length ? `${names.join(' & ')} ${names.length > 1 ? 'win' : 'wins'} the round!` : 'Nobody survived!', 3000, { small: true });
        snd.roundWin(mine);
        break;
      }
      case 'hit': {
        const mine = m.a === ctx.myId || m.b === ctx.myId;
        snd.hit(mine); if (mine) gfx.shake(0.45);
        break;
      }
      case 'da': if (m.id !== ctx.myId) { const v = view.get(m.id), f = focusPos(); if (v && Math.hypot(v.x - f.x, v.z - f.z) < 8 && Math.abs(v.y - f.y) < 2) snd.dash(); } break;
      case 'th': if (m.id === ctx.myId) gfx.shake(0.2); break;
    }
  });
  function applyTiles(k, reset = false) {
    if (!level) return;
    if (reset) for (const L of level.layers) { L.at.fill(Infinity); L.who.fill(255); }
    for (let j = 0; j + 3 < k.length; j += 4) { const L = level.layers[k[j]]; if (!L) continue; L.at[k[j + 1]] = k[j + 2]; L.who[k[j + 1]] = k[j + 3]; }
  }
  function onSnap(m) {
    if (m.r !== round) useRound(m.r);
    phase = m.ph; phaseT = m.pt;
    const d = m.tm - tC; if (Math.abs(d) > 0.3) tC = m.tm; else tC += d * 0.15;
    const now = performance.now();
    snapGap = snapB ? Math.max(0.03, Math.min(0.3, (now - snapAt) / 1000)) : 1 / SNAP_HZ;
    snapA = snapB || m; snapB = m; snapAt = now;
    ids.forEach((id, i) => {
      const r = m.p[i]; if (!r) return;
      const v = view.get(id);
      Object.assign(v, { vx: r[3], vy: r[4], vz: r[5], g: !!r[6], l: r[7], alive: !!r[9], auth: r[10], dashCd: r[11], stun: r[12], dashT: r[13] });
      if (id === ctx.myId && me) {
        if (me.auth !== r[10]) Object.assign(me, { x: r[0], y: r[1], z: r[2], vx: r[3], vy: r[4], vz: r[5], g: !!r[6], l: r[7], face: r[8], auth: r[10], stun: r[12], dashT: r[13] });
        me.alive = !!r[9]; me.dashCd = Math.max(me.dashCd, r[11] - 0.1);
      }
    });
  }

  // ---------------------------------------------------------------- per frame
  const ev = {};
  let sendAcc = 0, lastMe = null, introT = 0;
  function positions() {
    const out = new Map();
    if (net.isHost && sim) { for (const p of sim.players) out.set(p.id, { ...p, run: Math.hypot(p.vx, p.vz) }); return out; }
    const f = snapA && snapB ? Math.min(1.2, (performance.now() - snapAt) / 1000 / snapGap) : 1;
    ids.forEach((id, i) => {
      const v = view.get(id);
      if (snapB) {
        const a = snapA.p[i], b = snapB.p[i];
        if (a && b) { v.x = a[0] + (b[0] - a[0]) * f; v.y = a[1] + (b[1] - a[1]) * f; v.z = a[2] + (b[2] - a[2]) * f; v.face = b[8]; }
      }
      out.set(id, { ...v, run: Math.hypot(v.vx || 0, v.vz || 0) });
    });
    if (me) out.set(ctx.myId, { ...me, run: Math.hypot(me.vx, me.vz) });
    return out;
  }
  function focusPos() {
    const p = myState();
    if (p && p.alive && p.y > C.KILL_Y + 2) return p;
    if (!spec || !livingNow(spec)) { spec = null; cycleSpectate(); }
    const pos = positions();
    return (spec && pos.get(spec)) || p || { x: 0, y: level ? level.layers[level.L - 1].y : 0, z: 0 };
  }

  ctx.frame((dt, now) => {
    if (!level) return;
    if (!net.isHost) readInput(dt);
    // client prediction
    if (!net.isHost && me && me.alive && phase === 'play' && ctx.started && !ended) {
      tC += dt;
      stepPlayer(me, myInput, dt, level, tC, ev);
      if (ev.ground >= 0) { const L = level.layers[me.l]; if (L.at[ev.ground] === Infinity) { L.at[ev.ground] = tC + level.delay; L.who[ev.ground] = myIdx; } }
      sendAcc += dt;
      if (sendAcc >= 1 / SEND_HZ) { sendAcc = 0; net.toHost({ t: 'in', i: { ...myInput }, s: [r2(me.x), r2(me.y), r2(me.z), r2(me.vx), r2(me.vy), r2(me.vz), me.g ? 1 : 0, me.l, me.auth] }); }
    } else if (!net.isHost && phase === 'play' && ctx.started) {
      tC += dt;
      sendAcc += dt; if (sendAcc >= 1 / SEND_HZ && !ctx.spectator) { sendAcc = 0; net.toHost({ t: 'in', i: { ...myInput } }); }
    } else if (!net.isHost && !ctx.spectator) {
      sendAcc += dt; if (sendAcc >= 0.25) { sendAcc = 0; net.toHost({ t: 'in', i: { ...myInput } }); }
    }
    const pos = positions();
    // my own movement sounds
    const mp = myState();
    if (mp && lastMe) {
      if (!lastMe.g && mp.g && mp.alive) snd.land(Math.min(1, (mp.l !== lastMe.l ? 1 : 0.4)));
      if (lastMe.g && !mp.g && mp.vy > 2) snd.jump();
      if (lastMe.g && !mp.g && mp.vy <= 2 && mp.alive) snd.fall();
      if ((mp.dashT || 0) > (lastMe.dashT || 0) + 0.05) snd.dash();
      if (mp.g && mp.l !== lastMe.l) gfx.shake(0.25);
    }
    lastMe = mp ? { g: mp.g, l: mp.l, vy: mp.vy, dashT: mp.dashT } : null;
    const focus = focusPos();
    const alive = ids.filter((id) => pos.get(id)?.alive !== false).length;
    snd.intensity(N > 1 ? (N - alive) / Math.max(1, N - 1) * 0.8 + (tC > C.COLLAPSE_AT / (api.turbo || 1) ? 0.3 : 0) : Math.min(1, tC / 90));
    const st = { t: tC, players: pos, focus, dist: amAlive() ? 1 : 1.25 };
    const fx = gfx.frame(dt, now, st);
    if (fx) { if (fx.cracks) snd.crack(fx.cracksNear > 0); if (fx.drops) snd.drop(fx.dropsNear > 0); }
    hud(pos, focus);
  });

  // ---------------------------------------------------------------- HUD (shared zones)
  function hud(pos, focus) {
    const mp = myState();
    const fl = layerOf(level, (focus?.y ?? 0) + 0.3);
    const dot = (h) => `<span class="ph-dot" style="background:#${level.layers[h].color.toString(16).padStart(6, '0')}"></span>`;
    if (ctx.spectator) ui.status('👀 Spectating');
    else if (mp && !mp.alive) ui.status(`👻 Out · watching ${ui.esc(ctx.player(spec)?.name || '…')} <small>(Space = switch)</small>`);
    else if (fl >= 0) ui.status(`${dot(fl)} Layer ${level.L - fl} of ${level.L} <small>${fl === 0 ? '· last floor!' : ''}</small>`);
    else ui.status('');
    const ct = C.COLLAPSE_AT / (api.turbo || 1);
    if (phase === 'intro' || phase === 'wait') ui.timer(null, { text: `ROUND ${round + 1}` });
    else if (phase === 'end') ui.timer(null, { text: 'ROUND OVER' });
    else if (tC < ct) ui.timer(ct - tC, { warn: 10 });
    else ui.timer(null, { text: 'COLLAPSE!' });
    ui.mini(ids.map((id) => {
      const pl = ctx.player(id), w = info.wins[id] || 0, out = pos.get(id)?.alive === false;
      return { id, name: pl?.name || '?', color: pl?.color ?? 0, value: '★'.repeat(w) || '·', me: id === ctx.myId, out };
    }).sort((a, b) => (a.out - b.out) || ((info.wins[b.id] || 0) - (info.wins[a.id] || 0))), need > 1 ? `First to ${need} ★` : '');
    const cd = mp?.dashCd || 0;
    if (amAlive()) ui.abilities([{ key: 'Space', label: 'Jump', ready: !!mp?.g }, { key: 'Shift', label: 'Dash', cd: cd / C.DASH_CD, ready: cd <= 0 }]);
    else ui.abilities([]);
  }
  ui.setScoreboard(() => ({ columns: ['Player', 'Round wins', 'Outlived'], rows: standings().flat().map((id) => [ui.esc(ctx.player(id)?.name || id), info.wins[id] || 0, info.pts[id] || 0]) }));
  function standings() { return sim ? sim.standings() : standingsOf(ids, info.wins, info.pts); }

  return {
    standings,
    stop() {
      snd.dispose(); gfx.dispose();
      if (window.__ff === api) delete window.__ff;
      levels.clear(); sim = null;
    },
  };
}
