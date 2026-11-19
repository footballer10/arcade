// ROCKET SOCCER — rocket-powered cars play soccer with a giant ball in a curved-wall arena. Signature mechanic:
// car control and aerials (drive up the walls, jump, dodge-flip into the ball, boost to fly).
//
// Netcode (host-authoritative, full-world prediction):
// - The host steps the whole world (all cars, the ball, boost pads, the clock) at a fixed 60 Hz in ctx.tick, rounds
//   it to float32 and broadcasts a binary snapshot every 2 steps (30 Hz) on the unreliable channel. Remote human
//   inputs are queued and applied one per step, so a client's input N lands on step (snapshot + N - ack).
// - Clients run the same world forward every step with their own live input (other cars keep their last known
//   input). On each snapshot they rewind to it and replay their un-acknowledged inputs through the WHOLE world, so
//   the ball is predicted against their own car and hits feel instant and weighty. Any visual jump caused by the
//   correction is folded into per-body offsets that melt away over ~0.1 s.
// - Goals, demolitions, saves, replays, kickoffs and the end come from the host as reliable events.
// - Host migration: the new host continues from the last snapshot it received; bots take over for anyone who left.
import * as THREE from 'three';
import { makeArena, sdArena } from './arena.js';
import './tuning.js';
import { C, PH, DT, MAGIC, HDR, CK, newWorld, kickoff, stepWorld, pack, unpack, quantize, encInput, speedOf } from './physics.js';
import { Referee } from './match.js';
import { newBot, botInput, assignRoles } from './bots.js';
import { createView, TEAM } from './render.js';
import { Particles, Rings } from './fx.js';
import { RSAudio } from './audio.js';
import { PALETTE } from '../../core/palette.js';
import { HATS, HAIRS } from '../../core/avatar.js';
export { manifest } from './manifest.js';

const SNAP_EVERY = 2;
const FILLERS = ['Rook', 'Ace', 'Dash', 'Turbo', 'Comet', 'Spark', 'Nitro', 'Zoom'];
const fmtClock = (t, ot) => { const s = ot ? Math.floor(t) : Math.ceil(t); return `${ot ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const CSS = `
.rs-layer{position:absolute;inset:0;pointer-events:none;font-family:var(--font);color:#fff;text-shadow:var(--stroke);overflow:hidden}
.rs-tag{position:absolute;transform:translate(-50%,-100%);font-size:.8rem;white-space:nowrap;padding:0 7px;border-radius:8px;border:2px solid var(--ink);background:var(--pill)}
.rs-bug{display:flex;gap:6px;align-items:stretch}
.rs-sc{display:flex;align-items:center;gap:8px;padding:0 12px;border:3px solid var(--ink);border-radius:16px;font-size:2rem;text-shadow:var(--stroke);transition:transform .2s}
.rs-sc .t{font-size:.8rem;opacity:.95}
.rs-sc.a{background:linear-gradient(180deg,#63adff,#2466e0)} .rs-sc.b{background:linear-gradient(180deg,#ffb35a,#ee6f0b)}
.rs-sc.pop{transform:scale(1.25)}
.rs-clock.ot{color:var(--yellow)} .rs-clock.zero{color:#ff6a6a;animation:ph-pulse .6s infinite}
.rs-arrow{position:absolute;width:0;height:0;border-left:14px solid transparent;border-right:14px solid transparent;border-bottom:26px solid #fff;filter:drop-shadow(0 0 2px #17112e) drop-shadow(0 0 2px #17112e);transform-origin:50% 60%;opacity:0;transition:opacity .2s}
.rs-flash{position:absolute;inset:0;opacity:0;background:#fff}
.rs-pop{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);font-size:2.4rem;white-space:nowrap;opacity:0;transition:opacity .2s,transform .2s;text-align:center;line-height:1.05}
.rs-pop small{display:block;font-size:1.1rem}
.rs-pop.on{opacity:1;transform:translate(-50%,-50%) scale(1.05)}
.rs-replay{position:absolute;left:18px;bottom:18px;font-size:1.3rem;padding:4px 14px;border:3px solid var(--ink);border-radius:14px;background:#e23b3b;opacity:0;transition:opacity .2s}
.rs-replay.on{opacity:1}
.rs-vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 62%,rgba(10,0,40,.35) 100%)}`;

// Teams: honour each human's pick when there's room, balance the rest, then fill both teams with bots.
function buildRoster(ctx, size0, rng) {
  const P = ctx.players, size = Math.min(4, Math.max(size0, Math.ceil(P.length / 2)));
  const T = [[], []], placed = new Set();
  const put = (p, t) => { if (T[t].length >= size) t = 1 - t; T[t].push(p); placed.add(p.id); };
  const humans = P.filter((p) => !p.isBot), bots = P.filter((p) => p.isBot);
  for (const p of humans) { const pr = ctx.picks[p.id]?.team; const t = pr === 'blue' ? 0 : pr === 'orange' ? 1 : -1; if (t >= 0 && T[t].length < size) put(p, t); }
  const hc = (t) => T[t].filter((p) => !p.isBot).length;
  for (const p of humans) if (!placed.has(p.id)) put(p, hc(0) < hc(1) ? 0 : hc(1) < hc(0) ? 1 : T[0].length <= T[1].length ? 0 : 1);
  for (const p of bots) put(p, T[0].length <= T[1].length ? 0 : 1);
  const used = new Set(P.map((p) => p.color)); let k = 0;
  for (const t of [0, 1]) while (T[t].length < size) {
    let color = 0; for (let c = 0; c < 8; c++) { const cc = (k * 3 + c) % 8; if (!used.has(cc)) { color = cc; break; } }
    used.add(color);
    T[t].push({ id: 'filler-' + k, name: 'Bot ' + FILLERS[k % FILLERS.length], color, isBot: true, filler: true, hat: HATS[1 + Math.floor(rng() * (HATS.length - 1))], skin: Math.floor(rng() * 6), hair: HAIRS[Math.floor(rng() * HAIRS.length)], hairColor: Math.floor(rng() * 6) });
    k++;
  }
  return [...T[0].map((p) => ({ ...p, team: 0 })), ...T[1].map((p) => ({ ...p, team: 1 }))].map((p) => ({ ...p, colorHex: PALETTE[p.color % 8], colorCss: '#' + PALETTE[p.color % 8].toString(16).padStart(6, '0') }));
}

export async function start(ctx) {
  const { net, ui, input } = ctx;
  const A = makeArena(ctx.options.arena || 'stadium');
  const mins = Math.max(1, Math.min(5, +ctx.options.length || 3));
  const roster = buildRoster(ctx, Math.max(1, Math.min(4, +ctx.options.size || 2)), ctx.rng(0xf111));
  const N = roster.length;
  const idxOf = new Map(roster.map((r, i) => [r.id, i]));
  const myIdx = ctx.spectator ? -1 : idxOf.get(ctx.myId) ?? -1;
  const myTeam = myIdx >= 0 ? roster[myIdx].team : -1;
  const W = newWorld(A, roster.map((r) => r.team));
  W.clock = mins * 60;
  const moon = ctx.options.gravity === 'moon';
  if (moon) W.grav = C.MOON_G;
  const kickRng = ctx.rng(0x6b1c);
  kickoff(W, kickRng); W.pt = 0;   // the hub's countdown is the first kickoff
  quantize(W);

  // ---------------------------------------------------------------- view
  const style = document.createElement('style'); style.textContent = CSS; ctx.container.appendChild(style);
  const view = createView(ctx, A, roster);
  const { scene, camera } = view;
  const fx = new Particles(scene, ctx.quality().effects ? 1800 : 700);
  const rings = new Rings(scene);
  const sfx = new RSAudio(ctx);
  const layer = ui.el('div', 'rs-layer', '<div class="rs-vig"></div><div class="rs-flash"></div><div class="rs-arrow"></div><div class="rs-pop"></div><div class="rs-replay">● REPLAY</div>');
  ctx.container.appendChild(layer);
  const flashEl = layer.querySelector('.rs-flash'), arrowEl = layer.querySelector('.rs-arrow'), popEl = layer.querySelector('.rs-pop'), replayEl = layer.querySelector('.rs-replay');
  const tags = roster.map((r, i) => {
    const t = ui.el('div', 'rs-tag'); t.textContent = r.name; t.style.color = r.colorCss; t.style.borderColor = TEAM[r.team].css;
    if (i === myIdx) t.style.display = 'none';
    layer.appendChild(t); return t;
  });
  const bug = ui.el('div', 'rs-bug', `<div class="rs-sc a"><span class="t">BLUE</span><b>0</b></div><div class="hud-timer rs-clock">${fmtClock(W.clock)}</div><div class="rs-sc b"><b>0</b><span class="t">ORANGE</span></div>`);
  ui.zone('tc').appendChild(bug);
  const scA = bug.querySelector('.a b'), scB = bug.querySelector('.b b'), clockEl = bug.querySelector('.rs-clock');
  const resize = () => { view.resize(); fx.setScale(ctx.container.clientHeight || innerHeight); };
  ctx.on('resize', resize); resize();
  ctx.on('settings', (k) => { if (k === 'quality') view.setQuality(); });

  // ---------------------------------------------------------------- state
  let isSim = net.isHost, ref = null, ended = false, acc = 0, snapCount = 0;
  const evBuf = [];
  const queues = roster.map(() => ({ q: [], max: 0, ack: 0, wait: true, need: 2, smooth: 0 }));
  const acks = new Float32Array(N), snapAcks = new Float32Array(N);
  const bots = new Map(); const roles = []; let roleT = 0;
  let stats = roster.map(() => ({ g: 0, a: 0, s: 0, sh: 0, d: 0, t: 0, pts: 0 }));
  let seq = 0; const hist = []; let sendT = 0;
  let lastSnap = null, lastSnapTick = -1;
  const rec = [];                        // replay recording: packed snapshots at 30 Hz
  let replay = null, skips = new Set(), mySkip = false;
  let ballCam = (() => { try { return localStorage.getItem('partyhub.rs.ballcam2') === '1'; } catch { return false; } })();   // car cam by default: steering always matches the screen
  const hooks = window.__rs = { autopilot: false, turbo: 1, get W() { return W; }, get phase() { return W.phase; }, get score() { return [W.sA, W.sB]; }, roster, lag: 0, get replaying() { return !!replay; }, err: { car: 0, ball: 0, n: 0, carMax: 0, ballMax: 0 } };
  let autoBot = null;
  const brain = (i) => { let b = bots.get(i); if (!b) { b = newBot(ctx.bots.level, ctx.rng(0xb07 + i)); bots.set(i, b); } return b; };
  if (isSim) ref = new Referee(W, kickRng);

  // ---------------------------------------------------------------- input
  const myInput = { x: 0, y: 0, jump: false, boost: false };
  function sampleInput() {
    if (hooks.autopilot && myIdx >= 0) {
      if (!isSim && --roleT <= 0) { roleT = 15; assignRoles(W, roles); }
      autoBot ||= newBot({ key: 'test', reaction: 0.2, aimError: 0.2, skill: 0.75, mistakes: 0.05 }, ctx.rng(0xa070));
      return botInput(W, myIdx, autoBot, roles[myIdx] || 'attack');
    }
    const ax = input.axis();
    myInput.x = ax.x; myInput.y = ax.y; myInput.jump = input.down('jump'); myInput.boost = input.down('boost');
    return myInput;
  }
  input.on('press', (a) => {
    if (a === 'secondary') { ballCam = !ballCam; try { localStorage.setItem('partyhub.rs.ballcam2', ballCam ? '1' : '0'); } catch { /* */ } ui.toast(ballCam ? '🎥 Ball cam ON' : '🎥 Ball cam OFF', '', 1000); }
  });

  // ---------------------------------------------------------------- host simulation
  function hostStep() {
    if (ended) return;
    if (--roleT <= 0) { roleT = 15; assignRoles(W, roles); }
    for (let i = 0; i < N; i++) {
      const r = roster[i], c = W.cars[i];
      if (i === myIdx) c.inp = encInput(sampleInput());
      else if (r.isBot || !ctx.connected(r.id)) c.inp = encInput(botInput(W, i, brain(i), roles[i] || 'attack'));
      else {
        const qu = queues[i];
        // adaptive jitter buffer: after running dry, wait until `need` inputs are queued before consuming again;
        // `need` grows after each dry spell and shrinks back after a smooth stretch. Exactly one input per step
        // keeps client replays in sync with what the host applied.
        while (qu.q.length > qu.need + 4) qu.q.shift();
        if (qu.wait && qu.q.length >= qu.need) qu.wait = false;
        if (qu.q.length && !qu.wait) {
          const e = qu.q.shift(); qu.ack = e.seq; c.inp = e.b; hooks.used = (hooks.used || 0) + 1;
          if (++qu.smooth > 240 && qu.need > 2) { qu.need--; qu.smooth = 0; }
        } else { if (!qu.wait) qu.need = Math.min(8, qu.need + 1); qu.wait = true; qu.smooth = 0; hooks.starve = (hooks.starve || 0) + 1; }
      }
    }
    evBuf.length = 0; W.ev = evBuf;
    stepWorld(W);
    if (hooks.turbo > 1 && W.phase === PH.PLAY && !W.ot) W.clock = Math.max(0, W.clock - DT * (hooks.turbo - 1));
    const out = ref.step(evBuf);
    if (hooks.turbo > 1 && W.phase === PH.REPLAY) ref.skip = true;
    if (W.phase === PH.REPLAY && skips.size) {
      const humans = roster.filter((r) => !r.isBot && ctx.connected(r.id));
      if (humans.length && humans.every((r) => skips.has(r.id))) ref.skip = true;
    }
    quantize(W);
    liveEvents(evBuf);
    for (const e of out) {
      if (e.k === 'goal') explodeCars(e);
      net.toAll({ t: 'ev', e });
      if (e.k === 'goal' || e.k === 'save' || e.k === 'demo' || e.k === 'end') net.toAll({ t: 'stats', st: ref.stats });
      if (e.k === 'final') finish();
    }
    if (++snapCount >= SNAP_EVERY) {
      snapCount = 0;
      for (let i = 0; i < N; i++) acks[i] = queues[i].ack;
      const f = pack(W, acks); net.rawToAll(f.buffer); record(f);
    }
  }
  // the goal explosion shoves nearby cars (authoritative, so everyone sees the same tumble)
  function explodeCars(e) {
    for (const c of W.cars) {
      if (c.demo > 0) continue;
      const dx = c.x - e.x, dy = c.y - e.y, dz = c.z - e.z, d = Math.hypot(dx, dy, dz);
      if (d > 24 || d < 0.01) continue;
      const k = 34 * (1 - d / 24);
      c.vx += (dx / d) * k; c.vy += (dy / d) * k + k * 0.4; c.vz += (dz / d) * k;
      c.gnd = 0; c.jt = -1; c.wx += (Math.random() - 0.5) * 8; c.wz += (Math.random() - 0.5) * 8; c.ft = 0.4;
    }
  }
  function placements() {
    const ids = (t) => roster.filter((r) => r.team === t && !r.filler).map((r) => r.id);
    if (W.sA === W.sB) return [[...ids(0), ...ids(1)]];
    const win = W.sA > W.sB ? 0 : 1;
    return [ids(win), ids(1 - win)].filter((g) => g.length);
  }
  function standings() { return placements(); }
  function finish() {
    if (ended) return; ended = true;
    const st = ref ? ref.stats : stats, out = {};
    roster.forEach((r, i) => {
      if (r.filler) return;
      const s = st[i], bits = [`${TEAM[r.team].emoji} ${s.pts} pts`];
      if (s.g) bits.push(`${s.g} goal${s.g > 1 ? 's' : ''}`); if (s.a) bits.push(`${s.a} assist${s.a > 1 ? 's' : ''}`);
      if (s.s) bits.push(`${s.s} save${s.s > 1 ? 's' : ''}`); if (s.d) bits.push(`${s.d} demo${s.d > 1 ? 's' : ''}`);
      out[r.id] = bits.join(' · ');
    });
    const title = W.sA === W.sB ? `Draw ${W.sA}–${W.sB}` : `${W.sA > W.sB ? 'Blue' : 'Orange'} wins ${Math.max(W.sA, W.sB)}–${Math.min(W.sA, W.sB)}${W.ot ? ' in overtime' : ''}`;
    let mvp = 0; st.forEach((s, i) => { if (s.pts > st[mvp].pts) mvp = i; });
    const note = st[mvp].pts > 0 ? `⭐ MVP: ${roster[mvp].name} (${TEAM[roster[mvp].team].name.toLowerCase()}, ${st[mvp].pts} pts)` : '';
    ctx.endGame(placements(), { stats: out, title, note });
  }

  // ---------------------------------------------------------------- client prediction
  function clientStep() {
    if (myIdx >= 0) {
      const b = encInput(sampleInput());
      seq++; hist.push({ seq, b }); if (hist.length > 90) hist.shift();
      W.cars[myIdx].inp = b;
      if (++sendT >= 2) {        // 30 packets a second; each carries the last 10 inputs, so a lost or late one costs nothing
        sendT = 0;
        const n = Math.min(10, hist.length), buf = new Uint8Array(6 + n), dv = new DataView(buf.buffer);
        dv.setUint8(0, 1); dv.setUint32(1, seq, true); dv.setUint8(5, n);
        for (let k = 0; k < n; k++) buf[6 + k] = hist[hist.length - n + k].b;
        if (hooks.lag > 0) ctx.setTimeout(() => net.rawToHost(buf.buffer), hooks.lag / 2); else net.rawToHost(buf.buffer);
      }
    }
    evBuf.length = 0; W.ev = evBuf;
    stepWorld(W); quantize(W);
    liveEvents(evBuf);
  }
  ctx.tick((dt) => {
    if (!ctx.started) return;
    acc += dt; let k = 0;
    while (acc >= DT && k < 10) { acc -= DT; k++; if (isSim) hostStep(); else clientStep(); }
    if (k >= 10) acc = 0;
  });

  // smoothing offsets (visual only)
  const off = roster.map(() => new THREE.Vector3()), ballOff = new THREE.Vector3();
  const pre = roster.map(() => new THREE.Vector3()), preBall = new THREE.Vector3();
  net.onRaw((buf, from) => { if (!isSim && hooks.lag > 0) ctx.setTimeout(() => onSnap(buf, from), hooks.lag / 2); else onSnap(buf, from); });
  function onSnap(buf, from) {
    if (isSim) {
      // input packet: [1][seq u32][n u8][input bytes oldest -> newest]
      const dv = new DataView(buf); if (dv.byteLength < 6 || dv.getUint8(0) !== 1) return;
      const i = idxOf.get(from); if (i == null || roster[i].isBot) return;
      const last = dv.getUint32(1, true), n = dv.getUint8(5), qu = queues[i];
      for (let k = 0; k < n; k++) { const sq = last - (n - 1 - k); if (sq <= qu.max) continue; qu.max = sq; qu.q.push({ seq: sq, b: dv.getUint8(6 + k) }); }
      return;
    }
    const f = new Float32Array(buf);
    if (f[0] !== MAGIC || f[8] !== N || f[9] !== A.pads.length) return;
    if (f[1] <= lastSnapTick) return;
    lastSnapTick = f[1]; lastSnap = f; record(f);
    W.cars.forEach((c, i) => pre[i].set(c.x, c.y, c.z)); preBall.set(W.ball.x, W.ball.y, W.ball.z);
    unpack(W, f, snapAcks);
    if (myIdx >= 0) {
      const ack = snapAcks[myIdx];
      while (hist.length && hist[0].seq <= ack) hist.shift();
      W.ev = null;
      for (const h of hist) { W.cars[myIdx].inp = h.b; stepWorld(W); quantize(W); }   // same float32 rounding as the host: replays match exactly
    }
    // fold the correction into offsets that decay, so nothing pops
    // on a laggy link (relay) other cars are predicted further ahead, so bigger corrections are normal: glide, don't snap
    const lagF = Math.min(1, Math.max(0, ((net.ping() || 0) - 60) / 200));
    W.cars.forEach((c, i) => { off[i].add(pre[i].sub(new THREE.Vector3(c.x, c.y, c.z))); if (off[i].length() > (i === myIdx ? 7 : 7 + 7 * lagF)) off[i].set(0, 0, 0); });
    const be = preBall.sub(new THREE.Vector3(W.ball.x, W.ball.y, W.ball.z)).length();
    ballOff.add(preBall); if (ballOff.length() > 9 + 5 * lagF) ballOff.set(0, 0, 0);
    if (myIdx >= 0) { const E = hooks.err, ce = off[myIdx].length(); E.n++; E.car += ce; E.ball += be; E.carMax = Math.max(E.carMax, ce); E.ballMax = Math.max(E.ballMax, be); }
  }
  function record(f) { rec.push({ tick: f[1], f }); while (rec.length && rec[0].tick < f[1] - 60 * 8) rec.shift(); }

  // ---------------------------------------------------------------- events
  net.onMessage((m, from) => {
    if (m.t === 'skip' && isSim) { if (W.phase === PH.REPLAY && (ref?.goalTick == null || m.tk === ref.goalTick)) skips.add(from); return; }
    if (m.t === 'stats' && !isSim) { stats = m.st; return; }
    if (m.t === 'ev') hostEvent(m.e);
  });
  ctx.on('join', () => { if (isSim) { net.toAll({ t: 'stats', st: ref.stats }); net.rawToAll(pack(W, acks).buffer); } });
  ctx.on('hostchange', ({ amHost }) => {
    if (!amHost || isSim) return;
    if (lastSnap) unpack(W, lastSnap);
    quantize(W);
    ref = new Referee(W, ctx.rng(0x6b1c ^ (W.tick | 0)));
    ref.stats = stats.map((s) => ({ ...s })); ref.goals = W.sA + W.sB;
    for (const q of queues) { q.q.length = 0; q.max = 0; q.ack = 0; q.wait = true; q.need = 2; q.smooth = 0; }
    isSim = true; acc = 0;
    ctx.log('took over the match simulation at tick', W.tick);
  });
  ctx.on('leave', (id) => { const i = idxOf.get(id); if (i != null && !roster[i].isBot) ui.toast(`🤖 A bot drives for ${roster[i].name}`, '', 2200); });

  let goalTickSeen = null, prevPhase = -1, lastGoal = null, demoedBy = -1, prevClock = W.clock, cheer = 0, goT = -1;
  let shake = 0, flash = 0, popT = 0, pulse = [0, 0], countShown = -1, lastScore = [0, 0];
  function pop(html, ms = 1300) { popEl.innerHTML = html; popEl.classList.add('on'); popT = ms / 1000; }
  const nm = (i) => (i >= 0 && roster[i] ? ui.esc(roster[i].name) : '?');
  const colorOf = (i) => (i >= 0 ? roster[i].colorHex : 0xffffff);
  function hostEvent(e) {
    switch (e.k) {
      case 'goal': {
        const mine = myTeam === e.team, tc = TEAM[e.team];
        sfx.sfx(myTeam < 0 || mine ? 'goal' : 'concede'); setTimeout(() => sfx.sfx('horn'), 200);
        goalBoom(e.x, e.y, e.z, colorOf(e.scorer), tc.glow);
        pulse[e.team] = 1;
        const who = e.own ? `Own goal by ${nm(e.scorer)}` : e.scorer >= 0 ? `${nm(e.scorer)} scores!${e.assist >= 0 ? ` <small>assist ${nm(e.assist)}</small>` : ''}` : '';
        const tag = e.ot ? 'GOLDEN GOAL!' : e.g === 3 ? 'HAT TRICK!' : e.aerial ? 'AERIAL GOAL!' : e.speed > 50 ? 'ROCKET GOAL!' : e.own ? 'OWN GOAL!' : 'GOAL!';
        lastGoal = e;
        pop(`<span style="color:${tc.css}">${tag}</span><small>${who} · ${Math.round(e.speed * 3.6)} km/h</small>`, 2600);
        W.sA = e.sA; W.sB = e.sB; goalTickSeen = e.tick;
        if (e.scorer === myIdx && !e.own) ui.toast('⚽ You scored!', 'gold', 2200);
        break;
      }
      case 'replay': goalTickSeen = e.tick; break;
      case 'kick': replay = null; mySkip = false; skips.clear(); sfx.sfx('whistle'); break;
      case 'overtime': replay = null; mySkip = false; skips.clear(); ui.banner('OVERTIME! Next goal wins', 2600); sfx.sfx('overtime'); break;
      case 'zero': ui.banner('0:00 — ball still live!', 1600, { small: true }); break;
      case 'comeback': ui.toast(`${TEAM[e.team].emoji} Comeback boost: ${TEAM[e.team].name} kicks off with a full tank!`, '', 2600); break;
      case 'shot': if (e.i === myIdx) ui.toast('🎯 Shot on goal!', '', 1200); break;
      case 'save': {
        if (e.i === myIdx) ui.toast(e.epic ? '🧤 EPIC SAVE!' : '🧤 Save!', 'gold', 1600); else ui.toast(`🧤 ${roster[e.i]?.name} ${e.epic ? 'with an epic save!' : 'saves!'}`, '', 1400);
        sfx.sfx('save'); break;
      }
      case 'demo': {
        const c = W.cars[e.i]; const p = dispPos[e.i];
        sfx.sfx('demo', e.i === myIdx || e.by === myIdx ? 1.2 : 0.6);
        fx.burst(p.x, p.y, p.z, 70, [TEAM[roster[e.i].team].glow, 0xffd23f, 0xffffff, 0x333333], 18, 1.1, 1.4, { up: 4, grav: 10 });
        rings.add(p.x, p.y, p.z, TEAM[roster[e.i].team].glow, 10, 0.5, null);
        if (e.i === myIdx) { shake = Math.max(shake, 1); flash = 0.5; demoedBy = e.by; pop(`<span style="color:#ff6a6a">DEMOLISHED!</span><small>by ${nm(e.by)}</small>`, 1500); }
        else if (e.by === myIdx) { pop(e.i === demoedBy ? '😤 PAYBACK!' : '💥 DEMOLITION!', 1300); if (e.i === demoedBy) demoedBy = -1; shake = Math.max(shake, 0.5); }
        else ui.toast(`💥 ${roster[e.by]?.name} demolished ${roster[e.i]?.name}`, '', 1800);
        void c; break;
      }
      case 'end': {
        replay = null;
        sfx.sfx('end');
        const txt = e.winner < 0 ? 'DRAW!' : `${TEAM[e.winner].name} WINS!`;
        ui.banner(txt, 3200);
        if (e.winner >= 0) for (let k = 0; k < 6; k++) setTimeout(() => confetti(e.winner), k * 220);
        break;
      }
    }
  }
  function goalBoom(x, y, z, color, team) {
    const hi = ctx.quality().effects;
    fx.burst(x, y, z, hi ? 170 : 90, [color, color, color, team], 42, 1.7, 2.2, { up: 7, grav: 7, drag: 1.1 });
    fx.burst(x, y, z, hi ? 50 : 25, [0xffd23f, color], 22, 1.0, 1.4, { up: 10, grav: 14, drag: 0.6 });
    fx.burst(x, y, z, 14, 0xffffff, 14, 0.4, 3.0);
    rings.add(x, Math.max(0.3, y), z, color, 34, 0.9, null);
    rings.add(x, y, z, team, 26, 0.7, new THREE.Vector3(0, 0, 1));
    rings.add(x, y, z, color, 16, 0.5, new THREE.Vector3(0, 0, 1));
    shake = Math.max(shake, 1.3); flash = 0.45; cheer = 1.6;
    view.boom(x, y, z, color); view.setBloom(1.2);
  }
  function confetti(team) {
    const cols = [TEAM[team].hex, TEAM[team].light, 0xffffff, 0xffd23f];
    for (let k = 0; k < 4; k++) fx.burst((Math.random() - 0.5) * A.W * 1.5, A.H * 0.7, (Math.random() - 0.5) * A.L * 1.5, 40, cols, 12, 2.6, 1.1, { grav: 6, drag: 0.8 });
  }
  // predicted, local effects (hits, jumps, pads…)
  function liveEvents(evs) {
    for (const e of evs) {
      const mine = e.i === myIdx;
      switch (e.k) {
        case 'hit': {
          const k = Math.min(1.5, e.s / 28);
          sfx.sfx('hit', 0.4 + k * (mine ? 0.8 : 0.5));
          fx.burst(e.x, e.y, e.z, 10 + Math.round(k * 26), [0xffffff, colorOf(e.i), 0xfff2a0], 8 + k * 14, 0.45, 0.9);
          if (k > 0.8) rings.add(e.x, e.y, e.z, colorOf(e.i), 5 + k * 4, 0.35, new THREE.Vector3(W.ball.x - e.x, W.ball.y - e.y, W.ball.z - e.z).normalize());
          if (mine) shake = Math.max(shake, 0.15 + k * 0.35);
          break;
        }
        case 'bounce': if (e.s > 14) { sfx.sfx('bounce', e.s / 30); fx.burst(e.x, e.y, e.z, 8, 0xffffff, 6, 0.35, 0.7); } break;
        case 'jump': case 'jump2': view.cars[e.i].squash = -0.22; if (mine) sfx.sfx('jump'); break;
        case 'dodge': if (mine) sfx.sfx('dodge'); { const p = W.cars[e.i]; fx.burst(p.x, p.y - 0.3, p.z, 10, 0xffffff, 6, 0.4, 0.7); } break;
        case 'land': view.cars[e.i].squash = Math.min(0.4, e.s / 35); if (mine) { sfx.sfx('land', e.s / 14); shake = Math.max(shake, Math.min(0.4, e.s / 40)); } break;
        case 'bump': if (e.i === myIdx || e.j === myIdx) { sfx.sfx('bump', e.s / 10); shake = Math.max(shake, 0.4); } fx.burst(e.x, e.y, e.z, 14, [0xffd23f, 0xffffff], 9, 0.4, 0.8); break;
        case 'pad': { const pd = A.pads[e.p]; if (mine) sfx.sfx(pd.big ? 'padbig' : 'pad'); fx.burst(pd.x, 0.8, pd.z, pd.big ? 24 : 8, 0xffd23f, pd.big ? 9 : 5, 0.5, pd.big ? 1.1 : 0.6, { up: 5 }); break; }
        case 'kickoff': if (ctx.started && countShown > 0) ui.countdown(0); countShown = -1; break;
        case 'respawn': if (mine) sfx.sfx('respawn'); break;
      }
    }
  }

  // ---------------------------------------------------------------- replay (goal, slow-mo near the end)
  const Wr = newWorld(A, roster.map((r) => r.team)), Wr2 = newWorld(A, roster.map((r) => r.team));
  function startReplay(goalTick) {
    const from = goalTick - 60 * 2.8, to = goalTick + 60 * 0.6;
    const frames = rec.filter((r) => r.tick >= from && r.tick <= to);
    if (frames.length < 8) { replay = null; return; }   // nothing worth showing (e.g. joined a moment ago)
    mySkip = false; skips.clear();
    const b = frames.find((r) => r.tick >= goalTick) || frames[frames.length - 1];
    const gz = b.f[HDR + N * (CK + 1) + 2] >= 0 ? 1 : -1;   // ball z at the goal tick (header, cars, then ball x,y,z)
    replay = { frames, tt: frames[0].tick, goalTick, boomed: false, side: Math.random() < 0.5 ? -1 : 1, gz, t: 0, armed: false, hold: 0 };
    replayEl.classList.add('on');
  }
  function replayFrame(dt) {
    const R = replay;
    const slow = R.tt > R.goalTick - 60 * 0.9 && R.tt < R.goalTick + 60 * 0.3;
    R.tt += dt * 60 * (slow ? 0.38 : 1); R.t += dt;
    const fr = R.frames;
    let a = fr[0], b = fr[0];
    for (let k = 0; k < fr.length; k++) { if (fr[k].tick <= R.tt) { a = fr[k]; b = fr[k + 1] || fr[k]; } }
    if (R.tt >= fr[fr.length - 1].tick) { R.tt = fr[fr.length - 1].tick; }
    unpack(Wr, a.f); unpack(Wr2, b.f);
    const f = b.tick > a.tick ? Math.min(1, (R.tt - a.tick) / (b.tick - a.tick)) : 0;
    if (!R.boomed && R.tt >= R.goalTick) { R.boomed = true; const B = Wr2.ball; goalBoom(B.x, B.y, B.z, lastGoal ? colorOf(lastGoal.scorer) : 0xffffff, TEAM[R.gz > 0 ? 0 : 1].glow); }
    return { a: Wr, b: Wr2, f };
  }

  // ---------------------------------------------------------------- drawing
  const dispPos = roster.map(() => new THREE.Vector3()), dispQ = roster.map(() => new THREE.Quaternion());
  const ballPos = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _u = new THREE.Vector3();
  const ballQ = new THREE.Quaternion();
  function drawFrom(a, b, f, useOff) {
    for (let i = 0; i < N; i++) {
      const ca = a.cars[i], cb = b.cars[i], v = view.cars[i];
      const dead = cb.demo > 0 || cb.y < -20;
      v.root.visible = !dead; v.shadow.visible = !dead; tags[i].dataset.hidden = dead ? '1' : '';
      if (dead) continue;
      const jump = Math.hypot(cb.x - ca.x, cb.y - ca.y, cb.z - ca.z) > 6;
      const p = dispPos[i];
      if (a === b) p.set(cb.px + (cb.x - cb.px) * f, cb.py + (cb.y - cb.py) * f, cb.pz + (cb.z - cb.pz) * f);
      else if (jump) p.set(cb.x, cb.y, cb.z);
      else p.set(ca.x + (cb.x - ca.x) * f, ca.y + (cb.y - ca.y) * f, ca.z + (cb.z - ca.z) * f);
      if (useOff) p.add(off[i]);
      _q.set(cb.qx, cb.qy, cb.qz, cb.qw);
      if (a !== b && !jump) { _q2.set(ca.qx, ca.qy, ca.qz, ca.qw); _q.copy(_q2.slerp(_q, f)); }
      dispQ[i].copy(_q);
      v.root.position.copy(p); v.root.quaternion.copy(_q);
      const sq = v.squash || 0; v.rig.scale.set(1 + sq * 0.35, 1 - sq * 0.6, 1 + sq * 0.2); v.squash = sq * 0.86;
      // wheels + boost flames
      const sp = speedOf(cb);
      v.spin += sp * 0.016 * (cb.inp & 8 ? -1 : 1);
      for (const w of v.wheels) w.children[0].rotation.x = v.spin;
      const st = (cb.inp & 3) === 1 ? 0.35 : (cb.inp & 3) === 2 ? -0.35 : 0;
      v.wheels[0].rotation.y = v.wheels[1].rotation.y = cb.gnd ? st : 0;
      const boosting = cb.bst > 0;
      for (const fl of v.flames) { fl.visible = boosting; if (boosting) fl.scale.set(1, 1, 0.8 + Math.random() * 0.5); }
      // shadow blob on the floor
      v.shadow.visible = p.y < 14; v.shadow.position.set(p.x, 0.04, p.z); const ss = Math.max(0.3, 1 - p.y / 16); v.shadow.scale.set(1.3 * ss, 1, 1.8 * ss);
      v.shadow.material.opacity = 0.32;
    }
    const ba = a.ball, bb = b.ball;
    if (a === b) ballPos.set(bb.px + (bb.x - bb.px) * f, bb.py + (bb.y - bb.py) * f, bb.pz + (bb.z - bb.pz) * f);
    else ballPos.set(ba.x + (bb.x - ba.x) * f, ba.y + (bb.y - ba.y) * f, ba.z + (bb.z - ba.z) * f);
    if (useOff) ballPos.add(ballOff);
    const hidden = b.phase === PH.GOAL || (b.phase === PH.REPLAY && !replay) || b.phase === PH.END;
    view.ball.root.visible = !hidden; view.ballShadow.visible = !hidden && ballPos.y < 30;
    view.ball.root.position.copy(ballPos);
    view.ballShadow.position.set(ballPos.x, 0.05, ballPos.z); view.ballShadow.scale.setScalar(C.BALL_R * Math.max(0.35, 1 - ballPos.y / 34));
    // pads
    for (let p = 0; p < view.pads.length; p++) view.setPad(p, b.pads[p] <= 0);
  }

  // ---------------------------------------------------------------- camera
  const cam = { pos: new THREE.Vector3(0, 40, -90), look: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), fov: 72 };
  if (myTeam === 1) { cam.pos.z = 90; cam.dir.z = -1; }
  let introT = 0;
  function keepInside(p) {
    const g = [0, 0, 0], d = sdArena(A, p.x, p.y, p.z, g);
    if (d > -1.2) { p.x -= g[0] * (d + 1.2); p.y -= g[1] * (d + 1.2); p.z -= g[2] * (d + 1.2); }
    if (p.y < 1) p.y = 1;
  }
  function updateCamera(dt, now) {
    const k = 1 - Math.exp(-dt * 10);
    let pos = _v, look = _u, fov = 72;
    if (replay) {
      const R = replay, gz = R.gz * (A.L - 3);
      pos.set(R.side * (A.GW + 8) + Math.sin(R.t * 0.3) * 4, 5 + R.t * 0.5, gz);
      look.copy(ballPos); fov = 52;
      cam.pos.lerp(pos, R.t < 0.05 ? 1 : k); cam.look.lerp(look, R.t < 0.05 ? 1 : 1 - Math.exp(-dt * 6));
    } else if (!ctx.started) {
      // intro: sweep around the stadium toward my end
      introT += dt;
      // intro: a slow crane shot around the stadium that settles behind my team's goal
      const e = Math.min(1, introT / 7), side = myTeam === 1 ? 1 : -1;
      const ang = Math.PI * 0.75 * (1 - e) + (side > 0 ? 0 : Math.PI), r = 120 - 50 * e;
      pos.set(Math.sin(ang) * r * 0.8, 55 - 30 * e + Math.sin(introT * 0.7) * 2, Math.cos(ang) * r);
      look.set(0, 3, 0); fov = 58;
      cam.pos.copy(pos); cam.look.copy(look);
    } else if (myIdx >= 0 && W.cars[myIdx].demo <= 0) {
      const p = dispPos[myIdx], c = W.cars[myIdx];
      let hx, hz;
      if (ballCam && view.ball.root.visible) { hx = ballPos.x - p.x; hz = ballPos.z - p.z; }
      else {
        _q.copy(dispQ[myIdx]); const f = new THREE.Vector3(0, 0, 1).applyQuaternion(_q);
        hx = f.x; hz = f.z;
        if (Math.hypot(hx, hz) < 0.35) { hx = c.vx; hz = c.vz; }
        if (Math.hypot(hx, hz) < 0.5) { hx = cam.dir.x; hz = cam.dir.z; }
      }
      const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
      const dk = 1 - Math.exp(-dt * (ballCam ? 7 : 5));
      cam.dir.x += (hx - cam.dir.x) * dk; cam.dir.z += (hz - cam.dir.z) * dk; cam.dir.y = 0; cam.dir.normalize();
      const sp = speedOf(c);
      const dist = 10 + sp * 0.06, hgt = 4.2;
      pos.set(p.x - cam.dir.x * dist, p.y + hgt, p.z - cam.dir.z * dist);
      if (ballCam && view.ball.root.visible) {
        const to = new THREE.Vector3().subVectors(ballPos, p); const tl = to.length() || 1;
        const lift = Math.max(0, Math.min(0.6, to.y / tl));
        pos.y += lift * 3;
        look.copy(p).addScaledVector(to, Math.min(1, 6 / tl)); look.y += 0.5;
      } else look.set(p.x + cam.dir.x * 6, p.y + 0.8, p.z + cam.dir.z * 6);
      keepInside(pos);
      const glide = goT >= 0 && goT < 1.6 ? Math.pow(Math.min(1, 0.08 + goT / 1.6), 2) : 1;   // swoop down from the intro shot
      if (goT >= 0) goT += dt;
      cam.pos.lerp(pos, 1 - Math.exp(-dt * 14 * glide)); cam.look.lerp(look, 1 - Math.exp(-dt * 16 * glide));
      fov = 72 + Math.max(0, sp - 25) * 0.5 + (c.bst ? 4 : 0);
    } else {
      // spectating / demolished: TV camera from the side stand, tracking the ball
      pos.set(Math.max(-A.W + 6, Math.min(A.W - 6, ballPos.x * 0.3 - A.W * 0.6)), 22, ballPos.z * 0.75);
      look.copy(ballPos);
      keepInside(pos);
      cam.pos.lerp(pos, 1 - Math.exp(-dt * 3)); cam.look.lerp(look, 1 - Math.exp(-dt * 5)); fov = 64;
    }
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
    camera.position.copy(cam.pos);
    if (shake > 0) { const s = shake * shake * 0.7; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s; }
    camera.lookAt(cam.look);
    if (Math.abs(camera.fov - cam.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    void now;
  }

  // ---------------------------------------------------------------- per-frame
  const proj = new THREE.Vector3();
  ctx.frame((dt, now) => {
    // The replay starts the moment this screen's copy of the match enters the replay phase. It must not depend on
    // the order the host's reliable 'replay' event and the unreliable snapshot arrive in (that race cancelled it).
    if (W.phase === PH.REPLAY && prevPhase !== PH.REPLAY && !replay && goalTickSeen != null) startReplay(goalTickSeen);
    prevPhase = W.phase;
    // Skipping is deliberate: HOLD Space for 0.6 s, after the first 0.8 s, and only once Space has been let go
    // (Space is also jump, and people mash it while the goal is celebrated).
    if (replay && !mySkip && !ctx.spectator) {
      const R = replay;
      if (!input.down('jump')) { R.armed = true; R.hold = 0; }
      else if (R.armed && R.t > 0.8) { R.hold += dt; if (R.hold >= 0.6) { mySkip = true; net.toHost({ t: 'skip', tk: R.goalTick }); ui.toast('⏭ Skipping the replay…', '', 1200); } }
    }
    // world to draw
    if (replay && W.phase === PH.REPLAY) { const r = replayFrame(dt); drawFrom(r.a, r.b, r.f, false); }
    else { if (replay && W.phase !== PH.REPLAY) { replay = null; } drawFrom(W, W, Math.min(1, acc / DT), !isSim); }
    replayEl.classList.toggle('on', !!replay);
    if (replay) { const txt = mySkip ? '● REPLAY · skipping…' : replay.hold > 0 ? `● REPLAY · hold Space… ${Math.round(Math.min(1, replay.hold / 0.6) * 100)}%` : '● REPLAY · hold Space to skip'; if (replayEl.textContent !== txt) replayEl.textContent = txt; }
    // corrections fade out: fast for my own car, slower (smoother) for others and the ball when the ping is high
    const lagF = Math.min(1, Math.max(0, ((net.ping() || 0) - 60) / 200));
    off.forEach((o, i) => o.multiplyScalar(Math.exp(-dt / (i === myIdx ? 0.1 : 0.1 + 0.12 * lagF))));
    ballOff.multiplyScalar(Math.exp(-dt / (0.12 + 0.08 * lagF)));
    // ball spin (visual)
    const bw = W.ball, wl = Math.hypot(bw.wx, bw.wy, bw.wz);
    if (wl > 1e-3 && view.ball.root.visible) { _q.setFromAxisAngle(_v.set(bw.wx / wl, bw.wy / wl, bw.wz / wl), wl * dt * (replay ? 0.5 : 1)); ballQ.premultiply(_q); view.ball.mesh.quaternion.copy(ballQ); }
    // boost trails + supersonic sparkle
    for (let i = 0; i < N; i++) {
      const c = (replay ? Wr2 : W).cars[i], v = view.cars[i];
      if (!v.root.visible || !c.bst) continue;
      const p = dispPos[i]; _v.set(0, 0, -1.9).applyQuaternion(dispQ[i]).add(p);
      const tc = TEAM[roster[i].team];
      fx.emit(_v.x, _v.y, _v.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, Math.random() < 0.3 ? roster[i].colorHex : tc.glow, 0.45, 1.0, 2.5);
      if (speedOf(c) > C.SUPER) fx.emit(_v.x, _v.y, _v.z, 0, 0, 0, 0xffffff, 0.3, 0.7, 1);
    }
    // kickoff countdown (frozen cars) — the first kickoff is the hub's countdown
    if (W.phase === PH.KICK && W.pt > 0.05 && ctx.started) { const n = Math.ceil(W.pt); if (n !== countShown) { countShown = n; ui.countdown(n); } }
    // fx + camera
    shake = Math.max(0, shake - dt * 2.2); flash = Math.max(0, flash - dt * 2.5);
    pulse[0] = Math.max(0, pulse[0] - dt * 0.5); pulse[1] = Math.max(0, pulse[1] - dt * 0.5);
    view.uniforms.uTime.value += dt; view.uniforms.uPulseA.value = pulse[0] * (0.6 + 0.4 * Math.sin(now / 90)); view.uniforms.uPulseB.value = pulse[1] * (0.6 + 0.4 * Math.sin(now / 90));
    flashEl.style.opacity = (flash * 0.55).toFixed(3);
    if (popT > 0) { popT -= dt; if (popT <= 0) popEl.classList.remove('on'); }
    cheer = Math.max(0, cheer - dt * 0.3);
    const dangerC = Math.max(0, 1 - Math.abs(Math.abs(W.ball.z) - A.L) / 25);
    view.update(dt, Math.min(1.3, cheer + (ctx.started ? dangerC * 0.35 : 0.1)));
    // ball streak at speed, tinted by the team that last hit it
    const bsrc = replay ? Wr2.ball : W.ball, bsp = speedOf(bsrc);
    { const lt0 = (replay ? Wr2 : W).lastTouch; view.ball.setGlow(Math.max(0, Math.min(1, (bsp - 14) / 40)), lt0 >= 0 && roster[lt0] ? TEAM[roster[lt0].team].glow : null, dt); }
    if (bsp > 30 && view.ball.root.visible) {
      const lt = (replay ? Wr2 : W).lastTouch, tint = lt >= 0 && roster[lt] ? TEAM[roster[lt].team].glow : 0xffffff;
      for (let k = 0; k < (bsp > 48 ? 3 : 1); k++) fx.emit(ballPos.x + (Math.random() - 0.5) * 2.4, ballPos.y + (Math.random() - 0.5) * 2.4, ballPos.z + (Math.random() - 0.5) * 2.4, 0, 0, 0, Math.random() < 0.5 ? 0xffffff : tint, 0.4, 1.3, 0);
    }
    fx.update(dt); rings.update(dt);
    updateCamera(dt, now);
    view.setBloom(0.55 + flash * 0.9);
    view.render();
    // name tags + off-screen ball arrow
    const w = ctx.container.clientWidth, h = ctx.container.clientHeight;
    for (let i = 0; i < N; i++) {
      const t = tags[i]; if (i === myIdx) continue;
      if (!view.cars[i].root.visible) { t.style.display = 'none'; continue; }
      proj.copy(dispPos[i]); proj.y += 1.7; proj.project(camera);
      const vis = proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1 && camera.position.distanceTo(dispPos[i]) < 90;
      t.style.display = vis ? '' : 'none';
      if (vis) t.style.transform = `translate(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px) translate(-50%, -100%)`;
    }
    proj.copy(ballPos).project(camera);
    const behind = proj.z > 1, offs = behind || Math.abs(proj.x) > 0.95 || Math.abs(proj.y) > 0.95;
    if (offs && view.ball.root.visible && ctx.started && !replay) {
      let ax = proj.x, ay = proj.y; if (behind) { ax = -ax; ay = -ay; }
      const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
      const ex = w / 2 + ax * (w / 2 - 40), ey = h / 2 - ay * (h / 2 - 40);
      arrowEl.style.opacity = 1; arrowEl.style.left = (ex - 14) + 'px'; arrowEl.style.top = (ey - 13) + 'px';
      arrowEl.style.transform = `rotate(${Math.atan2(ax, ay)}rad)`;
    } else arrowEl.style.opacity = 0;
    // sound
    const me = myIdx >= 0 ? W.cars[myIdx] : null;
    const danger = Math.max(0, 1 - Math.abs(Math.abs(W.ball.z) - A.L) / 30);
    sfx.update(dt, { speed: me ? Math.min(1, speedOf(me) / C.MAX) : 0, boosting: !!me?.bst, gnd: !!me?.gnd, active: !!me && ctx.started && me.demo <= 0 && W.phase !== PH.REPLAY && !ended, excite: ctx.started ? 0.25 + danger * 0.7 + (!W.ot && W.clock < 30 ? 0.25 : 0) + (W.ot ? 0.35 : 0) : 0.15 });
    hud(dt);
  });

  // ---------------------------------------------------------------- HUD
  function hud() {
    if (!W.ot && W.phase === PH.PLAY && prevClock > 60 && W.clock <= 60 && mins > 1) { ui.banner('LAST MINUTE!', 1500); sfx.sfx('overtime'); }
    if (!W.ot && W.phase === PH.PLAY && prevClock > 10 && W.clock <= 10) ui.toast('⏱ 10 seconds left!', 'gold', 1500);
    prevClock = W.clock;
    if (W.sA !== lastScore[0]) bump(scA); if (W.sB !== lastScore[1]) bump(scB);
    lastScore = [W.sA, W.sB];
    scA.textContent = W.sA; scB.textContent = W.sB;
    const zero = !W.ot && W.clock <= 0 && W.phase === PH.PLAY;
    const ctext = fmtClock(W.clock, W.ot);
    if (clockEl.textContent !== ctext) clockEl.textContent = ctext;
    clockEl.classList.toggle('ot', !!W.ot); clockEl.classList.toggle('zero', zero || (!W.ot && W.clock < 10.5 && W.clock > 0));
    const st = isSim && ref ? ref.stats : stats;
    if (myIdx >= 0) {
      const c = W.cars[myIdx], s = st[myIdx] || {};
      const T = TEAM[myTeam];
      ui.status(c.demo > 0 ? `💥 Respawning… ${Math.ceil(c.demo)}` : W.phase === PH.REPLAY ? `${T.emoji} ${T.name} · hold <kbd>Space</kbd> to skip` : `${T.emoji} ${T.name}${s.g ? ` · ⚽ ${s.g}` : ''}${s.s ? ` · 🧤 ${s.s}` : ''}`);
      ui.bar(c.boost / 100, `🚀 BOOST ${Math.round(c.boost)}`);
      ui.abilities([
        { key: 'Space', label: c.gnd ? 'Jump' : c.dj ? 'Flip' : 'Jump', ready: !!(c.gnd || c.dj) },
        { key: 'Shift', label: 'Boost', ready: c.boost > 0 },
        { key: 'R-click', label: ballCam ? 'Ball cam' : 'Car cam', ready: ballCam },
      ]);
    } else ui.status('👀 Spectating');
    const rows = roster.map((r, i) => ({ id: r.id, name: `${TEAM[r.team].emoji} ${r.name}`, color: r.color, value: st[i]?.pts ?? 0, me: i === myIdx, team: r.team, out: W.cars[i].demo > 0 }));
    rows.sort((a, b) => a.team - b.team || b.value - a.value);
    ui.mini(rows);
  }
  function bump(el) { el.parentElement.classList.add('pop'); ctx.setTimeout(() => el.parentElement?.classList.remove('pop'), 350); }
  ui.setScoreboard(() => {
    const st = isSim && ref ? ref.stats : stats;
    return { columns: ['Player', 'Team', 'Points', 'Goals', 'Assists', 'Saves', 'Shots', 'Demos'], rows: roster.map((r, i) => ({ r, s: st[i] || {} })).sort((a, b) => a.r.team - b.r.team || b.s.pts - a.s.pts).map(({ r, s }) => [`<span style="color:${r.colorCss}">${ui.esc(r.name)}</span>`, TEAM[r.team].emoji, s.pts ?? 0, s.g ?? 0, s.a ?? 0, s.s ?? 0, s.sh ?? 0, s.d ?? 0]) };
  });
  ctx.on('go', () => {
    sfx.sfx('whistle'); goT = 0; cheer = 0.8;
    if (myIdx >= 0) ui.banner(`${TEAM[myTeam].emoji} You're ${TEAM[myTeam].name}! Score in the ${TEAM[1 - myTeam].name.toLowerCase()} goal`, 2200, { small: true });
    if (moon) ctx.setTimeout(() => ui.toast('🌙 Moon Ball: low gravity. Jump high and fly!', 'gold', 2600), 2300);
  });

  return {
    standings,
    stop() {
      sfx.dispose(); fx.dispose(); rings.dispose(); view.dispose();
      if (window.__rs === hooks) delete window.__rs;
    },
  };
}
