// NEON RUSH — anti-gravity racing on glowing tracks through a synthwave city. Signature mechanic: drifting charges
// a boost meter, and chained drifts multiply it.
//
// Netcode (host-authoritative): the host steps every ship at a fixed 60 Hz (ctx.tick, also in background tabs):
// humans from their queued inputs (one step per input, so client prediction replays exactly), bots from the AI.
// Clients predict their own ship, send inputs (binary, redundant, unreliable channel) and rewind/replay on each
// snapshot; other ships are interpolated ~100 ms in the past. Snapshots (20 Hz, binary) carry the full ship state,
// so a new host after migration continues from the last one it saw.
import * as THREE from 'three';
import { buildTrack, clearTrackCache, TRACK_IDS, TRACKS, worldPos, wrapS } from './tracks.js';
import './tuning.js';
import { FIXED, C, KEYS, EV, CLASSES, newShip, step, collide, order, lapOf, tierOf, TIER_AT, chainMult, NO_INPUT } from './physics.js';
import { newBrain, botInput } from './bots.js';
import { createWorld } from './render.js';
import { ShipKit, Trail, Sparks, TIER_COLORS } from './ships.js';
import { NeonAudio } from './audio.js';
import { AdaptiveDelay } from '../../core/interp.js';
export { manifest } from './manifest.js';

const SNAP_EVERY = 3;            // host steps per snapshot (20 Hz)
const HARD_CAP = 235;            // seconds: the race always ends by then
const AFTER_FIRST = 30;          // seconds the others get after the winner finishes
const NK = KEYS.length, REC = NK + 2, HDR = 6;
const INTERP = 0.1;              // remote ships are drawn this far in the past (s)
const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

const CSS = `
.nr-layer{position:absolute;inset:0;pointer-events:none;font-family:var(--font);color:#fff;text-shadow:var(--stroke);overflow:hidden}
.nr-lines{position:absolute;inset:0;width:100%;height:100%}
.nr-vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 58%,rgba(10,0,30,.5) 100%)}
.nr-tag{position:absolute;transform:translate(-50%,-100%);font-size:.85rem;white-space:nowrap;padding:1px 8px;border-radius:9px;border:2px solid var(--ink);background:var(--pill)}
.nr-drift{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;transition:opacity .15s}
.nr-pips{display:flex;gap:5px}
.nr-pip{width:46px;height:12px;border:3px solid var(--ink);border-radius:7px;background:rgba(0,0,0,.45);overflow:hidden}
.nr-pip i{display:block;height:100%;width:0}
.nr-chain{font-size:1.5rem;letter-spacing:.04em}
.nr-chain small{font-size:.9rem;opacity:.85}
.nr-pop{position:absolute;left:50%;top:34%;transform:translate(-50%,-50%);font-size:2.6rem;white-space:nowrap;opacity:0;transition:opacity .2s,transform .2s}
.nr-pop.on{opacity:1;transform:translate(-50%,-50%) scale(1.06)}
.nr-mini{position:absolute;left:14px;bottom:14px;border:3px solid var(--ink);border-radius:14px;background:rgba(10,6,30,.55)}
.nr-warn{position:absolute;left:50%;top:22%;transform:translateX(-50%);font-size:2rem;color:#ff5a7a;opacity:0;transition:opacity .2s}
.nr-flash{position:absolute;inset:0;opacity:0;transition:opacity .25s}`;

export async function start(ctx) {
  const { net, ui, input } = ctx;
  const P = ctx.players, N = P.length;
  const idxOf = new Map(P.map((p, i) => [p.id, i]));
  const myIdx = ctx.spectator ? -1 : idxOf.get(ctx.myId) ?? -1;
  // ---------------------------------------------------------------- track + options (identical on every client)
  const optTrack = ctx.options.track || 'random';
  const trackId = TRACKS[optTrack] ? optTrack : TRACK_IDS[Math.floor(ctx.rng(0x7e1)() * TRACK_IDS.length)];
  const laps = Math.max(1, Math.min(5, +ctx.options.laps || 3));
  // Knockout: no finish line; every few seconds the last racer is derezzed until one remains
  const KO = ctx.options.mode === 'knockout' && N >= 2;
  const KO_FIRST = 25, KO_EVERY = Math.max(14, Math.min(25, 150 / Math.max(1, N - 1)));
  const koAt = (k) => KO_FIRST + k * KO_EVERY;      // time of the k-th knockout (same on every client)
  const track = buildTrack(trackId);
  const L = track.main.L;
  const clsOf = (p) => Math.max(0, CLASSES.findIndex((c) => c.key === ctx.picks[p.id]?.ship));
  // starting grid: seeded shuffle, two columns, staggered
  const grid = ctx.rng(0x6a1d).shuffle(P.map((_, i) => i));
  const gridPos = (slot) => [-10 - Math.floor(slot / 2) * 10 - (slot % 2) * 4, slot % 2 ? 4.2 : -4.2];

  // ---------------------------------------------------------------- DOM layer + world
  const style = document.createElement('style'); style.textContent = CSS; ctx.container.appendChild(style);
  const layer = ui.el('div', 'nr-layer', `<canvas class="nr-lines"></canvas><div class="nr-vig"></div><div class="nr-flash"></div><canvas class="nr-mini" width="170" height="170"></canvas>
    <div class="nr-drift"><div class="nr-pips"><div class="nr-pip"><i></i></div><div class="nr-pip"><i></i></div><div class="nr-pip"><i></i></div></div><div class="nr-chain"></div></div>
    <div class="nr-pop"></div><div class="nr-warn">⟲ WRONG WAY</div>`);
  ctx.container.appendChild(layer);
  const $ = (c) => layer.querySelector('.' + c);
  const linesCv = $('nr-lines'), lctx = linesCv.getContext('2d');
  const miniCv = $('nr-mini'), mctx = miniCv.getContext('2d');
  const driftEl = $('nr-drift'), pipEls = [...layer.querySelectorAll('.nr-pip i')], chainEl = $('nr-chain'), popEl = $('nr-pop'), warnEl = $('nr-warn'), flashEl = $('nr-flash');

  const world = createWorld(ctx, track, TRACKS[trackId].sky, ctx.rng(0xc17));
  const { scene, camera } = world;
  const kit = new ShipKit(ctx, scene);
  const sparks = new Sparks(scene, ctx.quality().pixelRatio > 1 ? 900 : 400);
  const sfx = new NeonAudio(ctx);
  const views = P.map((p) => {
    const v = kit.build(p);
    const tag = ui.el('div', 'nr-tag'); tag.textContent = p.name; tag.style.color = p.colorCss; layer.appendChild(tag);
    return { ...v, trails: [new Trail(scene, p.colorHex), new Trail(scene, p.colorHex)], tag, vis: { drift: 0, roll: 0, pitch: 0, boost: 0 }, wpos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0) };
  });
  const fitLines = () => { linesCv.width = ctx.container.clientWidth; linesCv.height = ctx.container.clientHeight; world.resize(); };
  ctx.on('resize', fitLines); fitLines();
  ctx.on('settings', (k) => { if (k === 'quality') world.setQuality(); });

  // minimap: draw the track outline once
  const mini = (() => {
    const m = track.main; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < m.n; i++) { x0 = Math.min(x0, m.P[i * 3]); x1 = Math.max(x1, m.P[i * 3]); z0 = Math.min(z0, m.P[i * 3 + 2]); z1 = Math.max(z1, m.P[i * 3 + 2]); }
    const sc = 140 / Math.max(x1 - x0, z1 - z0), ox = 85 - (x0 + x1) / 2 * sc, oz = 85 - (z0 + z1) / 2 * sc;
    const bg = document.createElement('canvas'); bg.width = bg.height = 170; const g = bg.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const [w, c] of [[9, '#120c26'], [5, '#' + world.mood.edge.toString(16).padStart(6, '0')]]) {
      for (const p of track.paths) { g.strokeStyle = p === m ? c : 'rgba(180,140,255,.6)'; g.lineWidth = p === m ? w : w * 0.5; g.beginPath(); for (let i = 0; i < p.n; i += 4) { const x = p.P[i * 3] * sc + ox, z = p.P[i * 3 + 2] * sc + oz; i ? g.lineTo(x, z) : g.moveTo(x, z); } if (p.closed) g.closePath(); g.stroke(); }
    }
    return { bg, sc, ox, oz };
  })();

  // ---------------------------------------------------------------- state
  const ships = P.map((p) => { const slot = grid.indexOf(idxOf.get(p.id)); const [s, d] = gridPos(slot); return newShip(track, clsOf(p), s, d); });
  const prev = ships.map((s) => ({ ...s }));
  let raceT = 0, phase = 0, endIn = -1, firstFin = 0, ended = false;   // phase 0 = grid, 1 = racing, 2 = over
  let acc = 0;
  const evAcc = new Array(N).fill(0), hostShown = new Array(N).fill(0);       // host: events since the last snapshot (sent to clients)
  let myEv = 0;                             // events of my own ship (local)
  // host
  let isHostSim = false;
  const queues = P.map(() => ({ q: [], max: 0, ack: 0, lastAt: 0, last: NO_INPUT }));
  const brains = new Map();
  let snapCount = 0;
  // client
  let me = myIdx >= 0 ? ships[myIdx] : null;   // my predicted ship (same object as ships[myIdx] on the host)
  let seq = 0; const hist = [];
  const snaps = [];                          // [{t, at, st:[ship states]}]
  let lastSnapAt = 0, lastSnapT = 0;
  // Remote ships are drawn on the host's race clock (hostOff: our clock -> race time, from the fastest snapshots),
  // a little in the past; the delay grows on a jittery link (relay) so bunched snapshots don't cause stutter.
  let hostOff = null; const interpDelay = new AdaptiveDelay({ min: INTERP, start: INTERP, interval: 0.05 });
  const corr = new THREE.Vector3();          // visual error offset after reconciliation
  const env = { track, laps: KO ? 99 : laps, t: 0, others: ships };
  let koDone = 0;
  window.__neon = { autopilot: false, track: trackId, trackL: L, get ships() { return ships; }, get phase() { return phase; }, get raceT() { return raceT; }, get corr() { return corr.length(); }, get me() { return me; }, get hist() { return hist.length; } };
  let autoBrain = null;

  function makeBrains() {
    brains.clear();
    P.forEach((p, i) => { if (p.isBot) brains.set(i, newBrain(ctx.bots.level)); });
  }
  if (net.isHost) { isHostSim = true; makeBrains(); }

  // ---------------------------------------------------------------- input
  const myInput = { steer: 0, throttle: 0, brake: 0, drift: false, boost: false };
  function sampleInput() {
    if (window.__neon.autopilot && me) {
      autoBrain ||= newBrain({ key: 'test', reaction: 0.2, aimError: 0.15, skill: 0.75, mistakes: 0.05 });
      return { ...botInput(me, autoBrain, env) };
    }
    const ax = input.axis();
    myInput.steer = ax.x; myInput.throttle = ax.y < 0 ? 1 : 0; myInput.brake = ax.y > 0 ? 1 : 0;
    myInput.drift = input.down('jump'); myInput.boost = input.down('boost');
    if (!ctx.started) { myInput.steer = 0; myInput.throttle = myInput.brake = 0; myInput.drift = myInput.boost = false; }
    return { ...myInput };
  }
  const enc = (i) => [Math.round(Math.max(-1, Math.min(1, i.steer)) * 127), (i.throttle > 0.5 ? 1 : 0) | (i.brake > 0.5 ? 2 : 0) | (i.drift ? 4 : 0) | (i.boost ? 8 : 0)];
  const dec = (s, b) => ({ steer: s / 127, throttle: b & 1 ? 1 : 0, brake: b & 2 ? 1 : 0, drift: !!(b & 4), boost: !!(b & 8) });

  // ---------------------------------------------------------------- host simulation
  function hostStep() {
    if (!ctx.started || phase === 2) return;
    if (phase === 0) phase = 1;
    raceT += FIXED; env.t = raceT;
    const now = performance.now();
    for (let i = 0; i < N; i++) {
      const sh = ships[i], p = P[i];
      sh.ghost = !p.isBot && !ctx.connected(p.id) ? 1 : 0;
      let inp, n = 1;
      if (sh.fin || brains.has(i)) {
        if (!brains.has(i)) brains.set(i, newBrain(ctx.bots.level));
        inp = botInput(sh, brains.get(i), env);
        if (p.isBot) rubberBand(sh);
      } else if (i === myIdx) inp = sampleInput();
      else {
        const qu = queues[i];
        if (qu.q.length) { n = qu.q.length > 8 ? 3 : qu.q.length > 3 ? 2 : 1; }
        else if (now - qu.lastAt > 300 || sh.ghost) { n = 1; inp = sh.ghost ? NO_INPUT : qu.last; }
        else n = 0;
        if (qu.q.length) {
          for (let k = 0; k < n; k++) { const e = qu.q.shift(); qu.ack = e.seq; qu.last = e.inp; savePrev(i); step(sh, e.inp, FIXED, env); evAcc[i] |= sh.ev; sh.ev = 0; }
          continue;
        }
        if (!n) continue;
      }
      savePrev(i);
      step(sh, inp, FIXED, env);
      if (i === myIdx) myEv |= sh.ev;
      evAcc[i] |= sh.ev; sh.ev = 0;
    }
    collide(ships);
    for (let i = 0; i < N; i++) { if (ships[i].ev) { evAcc[i] |= ships[i].ev; if (i === myIdx) myEv |= ships[i].ev; ships[i].ev = 0; } }
    for (let i = 0; i < N; i++) if (i !== myIdx && evAcc[i] & ~hostShown[i]) { remoteEvents(i, evAcc[i] & ~hostShown[i]); hostShown[i] |= evAcc[i]; }
    raceLogic();
    if (++snapCount >= SNAP_EVERY) { snapCount = 0; net.rawToAll(snapshot()); evAcc.fill(0); hostShown.fill(0); }
  }
  function rubberBand(sh) {
    // bots ease off when far ahead of every human, and get a little help when far behind
    let best = -1e9, worst = 1e9;
    P.forEach((p, i) => { if (!p.isBot && ctx.connected(p.id)) { best = Math.max(best, ships[i].prog); worst = Math.min(worst, ships[i].prog); } });
    if (best < -1e8) { sh.hc = 1; return; }
    const ahead = sh.prog - best, behind = worst - sh.prog, sk = ctx.bots.level.skill ?? 0.7;
    const target = ahead > 90 ? 1 - Math.min(0.1, (ahead - 90) / 1500) * (1.4 - sk) : behind > 160 ? 1 + Math.min(0.06, (behind - 160) / 2500) : 1;
    sh.hc += (target - sh.hc) * 0.02;
  }
  function raceLogic() {
    // rank 0 (leader) .. 1 (last) feeds the underdog boost bonus
    const alive = order(ships).filter((s) => !s.out && !s.fin);
    alive.forEach((s, k) => { s.rk = alive.length > 1 ? k / (alive.length - 1) : 0; });
    if (KO) {
      while (raceT >= koAt(koDone) && alive.length > 1) {
        const last = alive.pop(); koDone++;
        last.out = 1; last.outT = raceT; last.drift = 0; last.ghost = 1;
        evAcc[ships.indexOf(last)] |= EV.OUT; if (ships.indexOf(last) === myIdx) myEv |= EV.OUT;
        if (ships.indexOf(last) !== myIdx) remoteEvents(ships.indexOf(last), EV.OUT);
      }
      if (alive.length <= 1) { endIn = endIn < 0 ? 3 : endIn - FIXED; if (endIn <= 0.0001) finish(); }
      if (raceT > HARD_CAP) finish();
      return;
    }
    // finish / end conditions
    for (const sh of ships) if (sh.fin && !firstFin) firstFin = sh.fin;
    const humans = P.map((p, i) => i).filter((i) => !P[i].isBot && ctx.connected(P[i].id));
    const allHumansDone = humans.length > 0 && humans.every((i) => ships[i].fin);
    const allDone = ships.every((s) => s.fin || s.ghost);
    if (allDone || allHumansDone) endIn = endIn < 0 ? 4.5 : endIn;
    else if (firstFin) endIn = Math.max(0, firstFin + AFTER_FIRST - raceT);
    if (raceT > HARD_CAP) endIn = 0;
    if (endIn >= 0) { endIn -= endIn > 0 && (allDone || allHumansDone) ? FIXED : 0; if (endIn <= 0.0001) finish(); }
  }
  function standings() { return order(ships).map((s) => P[ships.indexOf(s)].id); }
  function finish() {
    if (ended) return; ended = true; phase = 2;
    net.rawToAll(snapshot());
    const stats = {};
    ships.forEach((s, i) => {
      const bits = [];
      if (KO) bits.push(s.out ? `derezzed at ${fmt(s.outT)}` : '🏆 last one standing');
      else if (s.fin) bits.push(fmt(s.fin)); else bits.push(`DNF · lap ${lapOf(s, track, laps)}/${laps}`);
      if (s.best) bits.push(`best lap ${s.best.toFixed(1)}s`);
      if (s.maxChain > 1) bits.push(`chain ×${chainMult(s.maxChain).toFixed(1)}`);
      if (s.golds) bits.push(`${s.golds} gold drift${s.golds > 1 ? 's' : ''}`);
      stats[P[i].id] = bits.join(' · ');
    });
    ctx.endGame(standings(), { stats, title: `${TRACKS[trackId].name}${KO ? ' · Knockout' : ''}` });
  }
  function savePrev(i) { const a = ships[i], b = prev[i]; b.path = a.path; b.s = a.s; b.d = a.d; b.y = a.y; b.yaw = a.yaw; b.resp = a.resp; }

  // ---------------------------------------------------------------- snapshots
  function snapshot() {
    const f = new Float32Array(HDR + N * REC);
    f[0] = 7; f[1] = N; f[2] = raceT; f[3] = endIn; f[4] = phase; f[5] = firstFin;
    for (let i = 0; i < N; i++) {
      const b = HDR + i * REC, s = ships[i];
      f[b] = i === myIdx || P[i].isBot ? 0 : queues[i].ack; f[b + 1] = evAcc[i];
      for (let k = 0; k < NK; k++) f[b + 2 + k] = s[KEYS[k]];
    }
    return f.buffer;
  }
  net.onRaw((buf, from) => {
    if (isHostSim) {
      // client input packet: [1][seq u32][count u8][(steer i8, buttons u8) × count] oldest → newest
      const v = new DataView(buf); if (v.getUint8(0) !== 1) return;
      const i = idxOf.get(from); if (i == null || P[i].isBot) return;
      const last = v.getUint32(1, true), n = v.getUint8(5), qu = queues[i];
      qu.lastAt = performance.now();
      for (let k = 0; k < n; k++) {
        const sq = last - (n - 1 - k); if (sq <= qu.ack || sq <= qu.max) continue;
        qu.max = sq; qu.q.push({ seq: sq, inp: dec(v.getInt8(6 + k * 2), v.getUint8(7 + k * 2)) });
      }
      if (qu.q.length > 30) qu.q.splice(0, qu.q.length - 30);
      return;
    }
    const f = new Float32Array(buf); if (f[0] !== 7 || f[1] !== N) return;
    const st = [];
    for (let i = 0; i < N; i++) {
      const b = HDR + i * REC, o = { ack: f[b], evNet: f[b + 1] };
      for (let k = 0; k < NK; k++) o[KEYS[k]] = f[b + 2 + k];
      st.push(o);
    }
    const snap = { t: f[2], at: performance.now(), endIn: f[3], phase: f[4], firstFin: f[5], st };
    if (snaps.length && snap.t < snaps[snaps.length - 1].t) return;   // out of order
    const prevT = snaps.length ? snaps[snaps.length - 1].t : null;
    snaps.push(snap); if (snaps.length > 30) snaps.shift();
    if (prevT !== null && snap.t > prevT) {          // only while the race clock runs
      const off = snap.t - snap.at / 1000;
      hostOff = hostOff == null || off > hostOff ? off : hostOff + (off - hostOff) * 0.04;
      interpDelay.observe(snap.at / 1000 + hostOff - snap.t);
    } else if (prevT !== null && snap.t === prevT) hostOff = null;
    lastSnapAt = snap.at; lastSnapT = snap.t; endIn = snap.endIn; phase = snap.phase; firstFin = snap.firstFin;
    raceT = Math.max(raceT, snap.t);
    // other ships: keep the latest state (used for slipstream + HUD); remote events -> effects
    for (let i = 0; i < N; i++) {
      if (i === myIdx) continue;
      Object.assign(ships[i], st[i]); ships[i].ev = 0;
      if (st[i].evNet) remoteEvents(i, st[i].evNet);
    }
    if (me) reconcile(st[myIdx]);
  });
  function reconcile(hs) {
    const hostEv = hs.evNet;
    if (hostEv & EV.BUMP) myEv |= EV.BUMP;
    if (hostEv & EV.FINISH) myEv |= EV.FINISH;
    if (hostEv & EV.OUT) myEv |= EV.OUT;
    const before = shipWorld(me, new THREE.Vector3()), pathB = me.path;
    const keepEv = me.ev;
    for (const k of KEYS) me[k] = hs[k];
    while (hist.length && hist[0].seq <= hs.ack) hist.shift();
    env.t = hs.t ?? raceT;
    for (const h of hist) { if (me.fin) break; step(me, h.inp, FIXED, env); }
    me.ev = keepEv;
    const after = shipWorld(me, new THREE.Vector3());
    const e = before.sub(after);
    if (e.length() < 14 && pathB === me.path && !me.fin) corr.add(e); else corr.set(0, 0, 0);
    if (corr.length() > 14) corr.set(0, 0, 0);
    savePrevFrom(me, myIdx);
  }
  function savePrevFrom(sh, i) { const b = prev[i]; b.path = sh.path; b.s = sh.s; b.d = sh.d; b.y = sh.y; b.yaw = sh.yaw; b.resp = sh.resp; }

  // client fixed step: predict my ship and send inputs
  let sendAcc = 0;
  function clientStep() {
    if (!me || !ctx.started || phase === 2) return;
    raceT += FIXED; env.t = raceT;
    if (me.fin) return;
    const inp = sampleInput();
    seq++; hist.push({ seq, inp }); if (hist.length > 180) hist.shift();
    savePrevFrom(me, myIdx);
    step(me, inp, FIXED, env);
    myEv |= me.ev; me.ev = 0;
    if (++sendAcc >= 2) {
      sendAcc = 0;
      const n = Math.min(12, hist.length), buf = new Uint8Array(6 + n * 2), v = new DataView(buf.buffer);
      v.setUint8(0, 1); v.setUint32(1, seq, true); v.setUint8(5, n);
      for (let k = 0; k < n; k++) { const [s, b] = enc(hist[hist.length - n + k].inp); v.setInt8(6 + k * 2, s); v.setUint8(7 + k * 2, b); }
      net.rawToHost(buf.buffer);
    }
  }
  ctx.tick((dt) => {
    acc += dt; let k = 0;
    while (acc >= FIXED && k < 12) { acc -= FIXED; k++; if (isHostSim) hostStep(); else clientStep(); }
    if (k >= 12) acc = 0;
  });

  // ---------------------------------------------------------------- host migration / joins / leaves
  ctx.on('hostchange', ({ amHost }) => {
    if (!amHost || isHostSim) return;
    const last = snaps[snaps.length - 1];
    if (last) {
      for (let i = 0; i < N; i++) {
        if (i === myIdx) continue;
        for (const k of KEYS) ships[i][k] = last.st[i][k];
        queues[i].ack = queues[i].max = last.st[i].ack; queues[i].q.length = 0; queues[i].lastAt = performance.now();
        savePrevFrom(ships[i], i);
      }
      raceT = Math.max(raceT, last.t + (performance.now() - last.at) / 1000);
    }
    isHostSim = true; makeBrains(); acc = 0;
    ctx.log('took over the race simulation at', raceT.toFixed(1));
  });
  ctx.on('leave', (id) => { const i = idxOf.get(id); if (i != null && isHostSim) ships[i].ghost = 1; });
  ctx.on('rejoin', (id) => { const i = idxOf.get(id); if (i != null && isHostSim) { ships[i].ghost = 0; queues[i].q.length = 0; } });
  ctx.on('join', () => { if (isHostSim) net.rawToAll(snapshot()); });

  // ---------------------------------------------------------------- rendering helpers
  const frm = { t: [0, 0, 0], u: [0, 0, 0], r: [0, 0, 0] }, tmp = [0, 0, 0];
  function shipWorld(sh, out) { worldPos(track.paths[sh.path] || track.main, sh.s, sh.d, sh.y + 0.7, tmp); return out.set(tmp[0], tmp[1], tmp[2]); }
  const lerpS = (path, a, b, f) => { let d = b - a; if (path.closed) { if (d > path.L / 2) d -= path.L; else if (d < -path.L / 2) d += path.L; } return a + d * f; };
  const lerpA = (a, b, f) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * f; };
  // state to draw for ship i this frame
  const drawSt = P.map(() => ({}));
  function renderState(i) {
    const out = drawSt[i];
    if (isHostSim || (i === myIdx && !me.fin)) {
      const a = prev[i], b = ships[i], f = Math.min(1, acc / FIXED);
      Object.assign(out, b);
      if (a.path === b.path && Math.abs(a.s - b.s) < 30 && !b.resp) {
        const path = track.paths[b.path];
        out.s = wrapS(path, lerpS(path, a.s, b.s, f)); out.d = a.d + (b.d - a.d) * f; out.y = a.y + (b.y - a.y) * f; out.yaw = lerpA(a.yaw, b.yaw, f);
      }
      return out;
    }
    // remote ship on a client: interpolate the snapshot buffer
    const rt = hostOff != null ? performance.now() / 1000 + hostOff - interpDelay.value : lastSnapT + (performance.now() - lastSnapAt) / 1000 - INTERP;
    let A = null, B = null;
    for (let k = snaps.length - 1; k >= 0; k--) if (snaps[k].t <= rt) { A = snaps[k]; B = snaps[k + 1] || null; break; }
    if (!A) { A = snaps[0]; B = null; }
    if (!A) { Object.assign(out, ships[i]); return out; }
    const sa = A.st[i];
    Object.assign(out, sa);
    if (B) {
      const sb = B.st[i], f = Math.max(0, Math.min(1, (rt - A.t) / Math.max(1e-3, B.t - A.t)));
      if (sa.path === sb.path && !sb.resp && !sa.resp) {
        const path = track.paths[sa.path];
        if (Math.abs(sb.s - sa.s) < 40 || path.closed) { out.s = wrapS(path, lerpS(path, sa.s, sb.s, f)); out.d = sa.d + (sb.d - sa.d) * f; out.y = sa.y + (sb.y - sa.y) * f; out.yaw = lerpA(sa.yaw, sb.yaw, f); out.vf = sa.vf + (sb.vf - sa.vf) * f; }
      } else if (f > 0.5) Object.assign(out, sb);
    }
    return out;
  }

  // ---------------------------------------------------------------- effects from events
  let shake = 0, flash = 0, fovKick = 0, popT = 0, lastPos = 0, wrongT = 0;
  function pop(text, color = '#fff', ms = 1100) { popEl.textContent = text; popEl.style.color = color; popEl.classList.add('on'); popT = ms / 1000; }
  function localEvents(ev, sh) {
    if (!ev) return;
    const v = views[myIdx];
    if (ev & EV.START_DRIFT) sfx.sfx('driftStart');
    if (ev & EV.TIER) { const t = tierOf(sh.dch); sfx.sfx('tier' + Math.max(1, t)); burst(v, TIER_COLORS[t], 14, 6); }
    if (ev & EV.RELEASE) {
      sfx.sfx('release'); fovKick = 1; shake = Math.max(shake, 0.25); burst(v, 0xffffff, 18, 10);
      if (sh.chain > 1) { sfx.sfx('chain', sh.chain); pop(`CHAIN ×${chainMult(sh.chain).toFixed(1)}`, '#ffd23f', 900); }
    }
    if (ev & EV.OVERHEAT) { sfx.sfx('overheat'); pop('OVERHEAT!', '#ff5a3a', 900); shake = Math.max(shake, 0.3); burst(v, 0xff5a3a, 20, 9); }
    else if (ev & EV.FIZZLE) sfx.sfx('fizzle');
    if (ev & EV.OUT) { sfx.sfx('derez'); pop('DEREZZED!', '#ff3ea5', 2200); flash = 0.6; derez(v); }
    if (ev & EV.WALL) { sfx.sfx('wall', Math.min(1.4, (sh.impact || 10) / 18)); shake = Math.max(shake, 0.6); wallSparks(v); }
    if (ev & EV.BUMP) { sfx.sfx('bump'); shake = Math.max(shake, 0.45); }
    if (ev & EV.PAD) { sfx.sfx('pad'); fovKick = 1.3; flash = 0.25; }
    if (ev & EV.JUMP) sfx.sfx('jump');
    if (ev & EV.LAND) { sfx.sfx('land', Math.min(1.5, (sh.impact || 10) / 15)); shake = Math.max(shake, Math.min(0.8, (sh.impact || 10) / 25)); burst(v, 0xffffff, 16, 8); }
    if (ev & EV.FALL) { sfx.sfx('fall'); pop('FELL OFF!', '#ff6a8a', 1200); }
    if (ev & EV.RESPAWN) sfx.sfx('respawn');
    if (ev & EV.SHORTCUT) { sfx.sfx('shortcut'); pop('SHORTCUT!', '#c89bff', 1100); }
    if (ev & EV.DRAFT) { sfx.sfx('draft'); ui.toast('💨 Slipstream!', '', 1200); }
    if (ev & EV.LAP && KO) { sfx.sfx('lap'); if (sh.lastLap) ui.toast(`Lap ${sh.lastLap.toFixed(2)}s`, 'good', 1800); }
    else if (ev & EV.LAP) {
      const lap = lapOf(sh, track, laps);
      if (lap === laps) { sfx.sfx('final'); ui.banner('FINAL LAP!', 1600); sfx.setIntensity(2); }
      else { sfx.sfx('lap'); ui.banner(`LAP ${lap}/${laps}`, 1300); sfx.setIntensity(1); }
      if (sh.lastLap) ui.toast(`Lap ${sh.lastLap.toFixed(2)}s${sh.best === sh.lastLap ? ' · best!' : ''}`, 'good', 2200);
    }
    if (ev & EV.FINISH) { sfx.sfx('finish'); fireworks(P[myIdx]?.colorHex ?? 0xffffff); const r = order(ships.map((s, i) => (i === myIdx ? me : s))).indexOf(me) + 1; ui.banner(r === 1 ? '🏆 YOU WIN!' : `FINISHED ${ord(r).toUpperCase()}!`, 2600); }
  }
  function remoteEvents(i, ev) {
    const v = views[i];
    if (ev & EV.OUT) { derez(v); ui.toast(`💥 ${P[i].name} derezzed!`, 'bad', 2200); sfx.sfx('derezOther'); }
    if (ev & EV.RELEASE) burst(v, 0xffffff, 10, 8);
    if (ev & (EV.WALL | EV.BUMP)) wallSparks(v);
    if (ev & EV.LAND) burst(v, 0xffffff, 8, 6);
    if (ev & EV.FINISH) fireworks(P[i].colorHex);
  }
  // fireworks over the start/finish gate (queued bursts, drawn from the shared spark pool)
  const fwQ = [];
  const gatePos = new THREE.Vector3(), gateUp = new THREE.Vector3();
  { const f = { t: [0, 0, 0], u: [0, 0, 0], r: [0, 0, 0] }; const p = worldPos(track.main, 4, 0, 0, [0, 0, 0], f); gatePos.set(...p); gateUp.set(...f.u); }
  function fireworks(color) { for (let k = 0; k < 5; k++) fwQ.push({ at: k * 0.32 + Math.random() * 0.15, color: k % 2 ? color : [0xffd23f, 0x2ef6ff, 0xff3ea5][k % 3] }); }
  function runFireworks(dt) {
    for (let j = fwQ.length - 1; j >= 0; j--) {
      const fw = fwQ[j]; fw.at -= dt; if (fw.at > 0) continue; fwQ.splice(j, 1);
      _p.copy(gatePos).addScaledVector(gateUp, 26 + Math.random() * 14).add(new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30));
      for (let k = 0; k < 70; k++) {
        const a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1), sp = 14 + Math.random() * 6;
        sparks.emit([_p.x, _p.y, _p.z], [Math.sin(b) * Math.cos(a) * sp, Math.cos(b) * sp, Math.sin(b) * Math.sin(a) * sp], fw.color, 1.3, 1);
      }
      if (_p.distanceTo(camera.position) < 400) sfx.sfx('firework');
    }
  }
  const _p = new THREE.Vector3();
  function burst(v, color, n, sp) { if (!v) return; for (let k = 0; k < n; k++) { _p.copy(v.wpos).addScaledVector(v.fwd, 1.5); sparks.emit([_p.x, _p.y, _p.z], [v.up.x * 3, v.up.y * 3, v.up.z * 3], color, 0.5, sp); } }
  function derez(v) { if (!v) return; for (let k = 0; k < 60; k++) sparks.emit([v.wpos.x, v.wpos.y, v.wpos.z], [v.up.x * 5, v.up.y * 5, v.up.z * 5], k % 2 ? v.color.getHex() : 0xffffff, 0.9, 22); }
  function wallSparks(v) { if (!v) return; for (let k = 0; k < 16; k++) sparks.emit([v.wpos.x, v.wpos.y, v.wpos.z], [v.up.x * 6, v.up.y * 6, v.up.z * 6], 0xffc04d, 0.45, 12); }

  // ---------------------------------------------------------------- camera
  const cam = { pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), look: new THREE.Vector3(), yaw: 0, init: false, intro: 0, fly: 0, orbit: 0, target: myIdx, fov: 70 };
  const _m4v = new THREE.Vector3();
  const raceClockNow = () => (isHostSim ? raceT : lastSnapT + (phase === 1 ? (performance.now() - lastSnapAt) / 1000 : 0));
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _u = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
  // Space (as well as A/D) cycles who you're watching once you're out of the running (derezzed, finished, or
  // just spectating); only among ships still in the race, so you never land on another dead one by hand.
  input.on('press', (a) => {
    if (!(ctx.spectator || myIdx < 0 || ships[myIdx]?.out || ships[myIdx]?.fin)) return;
    if (a !== 'left' && a !== 'right' && a !== 'jump') return;
    const o = order(ships).map((s) => ships.indexOf(s)).filter((i) => !ships[i].out);
    if (!o.length) return;
    const k = o.indexOf(cam.target);
    cam.target = o[((k < 0 ? 0 : k) + (a === 'left' ? -1 : 1) + o.length) % o.length];
  });
  function updateCamera(dt, now) {
    // whoever you're watching got derezzed (yourself included): move on to whoever's leading among the rest
    if (ships[cam.target]?.out) { const alive = order(ships).map((s) => ships.indexOf(s)).filter((i) => !ships[i].out); if (alive.length) cam.target = alive[0]; }
    let ti = cam.target;
    if (ti < 0 || ti >= N) { ti = ships.indexOf(order(ships)[0]); cam.target = myIdx >= 0 ? myIdx : ti; }
    const st = drawSt[ti], v = views[ti];
    const path = track.paths[st.path] || track.main;
    const look = input.down('special') && myIdx >= 0;
    // camera sits on the track behind the ship (in track space, so it follows loops and corkscrews)
    cam.yaw += (st.yaw * 0.55 - cam.yaw) * Math.min(1, dt * 4);
    const back = look ? -9 : 10.5;
    const cs = path.closed ? st.s - back : Math.max(0, st.s - back);
    const cd = st.d * 0.8 - Math.sin(cam.yaw) * back * 0.9;
    worldPos(path, cs, cd, st.y * 0.6 + 4.3, tmp, frm);
    _a.set(tmp[0], tmp[1], tmp[2]);
    _u.set(frm.u[0], frm.u[1], frm.u[2]);
    // intro: a flyover that races backwards down the track to the starting grid during the countdown,
    // then blends into the chase camera at GO
    let introLook = null;
    if (!ctx.started || cam.intro < 1) {
      cam.fly += dt;
      if (ctx.started) cam.intro = Math.min(1, cam.intro + dt * 1.4);
      const u = Math.min(1, cam.fly / 5.5), e = 1 - Math.pow(1 - u, 3);
      const sCam = 320 * (1 - e) + 6 * e, side = Math.sin(cam.fly * 0.7) * 7 * (1 - e);
      worldPos(track.main, sCam, side, 16 - 9 * e, tmp, frm); _b.set(tmp[0], tmp[1], tmp[2]);
      worldPos(track.main, sCam - 40, 0, 1.5, tmp); introLook = new THREE.Vector3(tmp[0], tmp[1], tmp[2]);
      const k = ctx.started ? cam.intro * cam.intro * (3 - 2 * cam.intro) : 0;
      _a.lerp(_b, 1 - k);
      if (k < 1) { _u.lerp(_b.set(frm.u[0], frm.u[1], frm.u[2]), 1 - k).normalize(); introLook.lerp(_m4v.copy(v.wpos).addScaledVector(v.up, 1.4).addScaledVector(v.fwd, 7), k); }
    }
    // victory lap: once the followed ship has finished, slowly orbit it
    const fin = st.fin && (raceClockNow() - st.fin) > 1.2;
    if (fin) { cam.orbit += dt * 0.45; _a.copy(v.wpos).addScaledVector(v.up, 4.5).addScaledVector(v.fwd, Math.cos(cam.orbit) * 13).addScaledVector(v.right, Math.sin(cam.orbit) * 13); }
    if (!cam.init) { cam.pos.copy(_a); cam.up.copy(_u); cam.init = true; }
    const sm = introLook && cam.intro < 1 ? 1 : 1 - Math.exp(-dt * (st.resp > 0 ? 3 : fin ? 4 : 12));
    cam.pos.lerp(_a, sm);
    cam.up.lerp(_u, 1 - Math.exp(-dt * 6)).normalize();
    if (introLook && cam.intro < 1) cam.look.copy(introLook);
    else if (fin) cam.look.copy(v.wpos).addScaledVector(v.up, 1);
    else cam.look.copy(v.wpos).addScaledVector(v.up, 1.4).addScaledVector(v.fwd, look ? -6 : 7);
    // shake
    if (shake > 0) { cam.pos.x += (Math.random() - 0.5) * shake; cam.pos.y += (Math.random() - 0.5) * shake; cam.pos.z += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 2.2); }
    camera.position.copy(cam.pos); camera.up.copy(cam.up); camera.lookAt(cam.look);
    const speed = Math.max(0, st.vf || 0);
    const target = 70 + Math.min(1.3, speed / C.VBOOST) * 16 + (st.boosting === 2 ? 6 : 0) + fovKick * 6;
    cam.fov += (target - cam.fov) * Math.min(1, dt * 5);
    fovKick = Math.max(0, fovKick - dt * 2.5);
    if (Math.abs(camera.fov - cam.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    return st;
  }

  // ---------------------------------------------------------------- per-frame render
  const _r = new THREE.Vector3(), _f = new THREE.Vector3(), _n = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
  let musicOn = false;
  ctx.frame((dt, now) => {
    if (!musicOn && ctx.started && ctx.audio.ready) { musicOn = true; sfx.startMusic(); }
    const t = now / 1000;
    for (let i = 0; i < N; i++) renderState(i);
    // ships
    for (let i = 0; i < N; i++) {
      const st = drawSt[i], v = views[i], path = track.paths[st.path] || track.main;
      const visible = !(st.resp > 0 && Math.floor(t * 12) % 2) && !(st.resp > 0.9) && !st.out;
      v.root.visible = visible;
      worldPos(path, st.s, st.d, st.y, tmp, frm);
      const hover = 0.7 + Math.sin(t * 7 + i) * 0.06;
      v.up.set(frm.u[0], frm.u[1], frm.u[2]);
      v.wpos.set(tmp[0], tmp[1], tmp[2]).addScaledVector(v.up, hover);
      if (i === myIdx && !isHostSim) { v.wpos.add(corr); corr.multiplyScalar(Math.exp(-dt * 9)); }
      const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
      _f.set(frm.t[0] * cy + frm.r[0] * sy, frm.t[1] * cy + frm.r[1] * sy, frm.t[2] * cy + frm.r[2] * sy);
      v.fwd.copy(_f); v.right.crossVectors(_f, v.up).normalize();
      // visual extras: drift angle, lean, air pitch
      const vis = v.vis;
      vis.drift += ((st.drift || 0) * 0.42 - vis.drift) * Math.min(1, dt * 9);
      vis.roll += (-(st.st || 0) * 0.28 - (st.drift || 0) * 0.12 - vis.roll) * Math.min(1, dt * 8);
      vis.pitch += ((st.air ? Math.max(-0.4, Math.min(0.3, (st.vy || 0) * 0.02)) : 0) - vis.pitch) * Math.min(1, dt * 6);
      vis.boost += ((st.boosting ? 1 : 0) - vis.boost) * Math.min(1, dt * 8);
      _m.makeBasis(v.right, v.up, _n.copy(_f).negate());
      v.root.quaternion.setFromRotationMatrix(_m);
      v.root.position.copy(v.wpos);
      v.body.rotation.set(vis.pitch, vis.drift, vis.roll);
      v.glow.material.opacity = st.air ? 0.4 : 0.9;
      const thr = Math.min(1.6, 0.35 + Math.max(0, st.vf || 0) / 70 + vis.boost * 0.8);
      for (const fl of v.pods) { fl.scale.set(0.7 + vis.boost * 0.5, 0.7 + vis.boost * 0.5, thr * (0.85 + Math.random() * 0.3)); }
      v.pilot.userData.setPose({ run: 0, t });
      if (v.ghostSet !== !!st.ghost) { v.ghostSet = !!st.ghost; v.hullMat.transparent = v.ghostSet; v.hullMat.opacity = v.ghostSet ? 0.35 : 1; v.hullMat.needsUpdate = true; }
      // trail from the two engines
      if (visible) {
        v.root.updateMatrixWorld();
        _e1.set(-1.05, 0.08, 2.3).applyMatrix4(v.root.matrixWorld); _e2.set(1.05, 0.08, 2.3).applyMatrix4(v.root.matrixWorld);
        const tw = 0.16 + vis.boost * 0.1;
        [_e1, _e2].forEach((e, k) => { v.trails[k].push([e.x - v.right.x * tw, e.y - v.right.y * tw, e.z - v.right.z * tw], [e.x + v.right.x * tw, e.y + v.right.y * tw, e.z + v.right.z * tw]); v.trails[k].mat.uniforms.boost.value = vis.boost; });
        // boost exhaust
        if (st.boosting) for (const e of [_e1, _e2]) sparks.emit([e.x, e.y, e.z], [-_f.x * 18, -_f.y * 18, -_f.z * 18], st.boosting === 2 ? v.color.getHex() : 0xffd23f, 0.25, 2.5);
        // drift sparks
        if (st.drift && !st.air) {
          const tier = tierOf(st.dch || 0), c = TIER_COLORS[tier];
          const nS = tier ? 3 : 1;
          for (let k = 0; k < nS; k++) {
            const e = Math.random() < 0.5 ? _e1 : _e2;
            sparks.emit([e.x, e.y - 0.3, e.z], [v.up.x * 4 - v.right.x * st.drift * 5, v.up.y * 4 - v.right.y * st.drift * 5, v.up.z * 4 - v.right.z * st.drift * 5], c, 0.35, 4);
          }
        }
      } else v.trails.forEach((tr) => tr.reset());
    }
    runFireworks(dt);
    sparks.update(dt);
    // camera + world
    const cst = updateCamera(dt, now);
    const beat = sfx.beat();
    world.update(dt, views[cam.target]?.wpos, beat);
    // close passes: a whoosh when another ship flashes by
    if (myIdx >= 0 && me && ctx.started && !me.fin) {
      for (let i = 0; i < N; i++) {
        if (i === myIdx) continue; const o = drawSt[i], v = views[i];
        const near = o.path === me.path && Math.abs(o.prog - me.prog) < 5 && Math.abs(o.d - me.d) < 4.5 && !o.out && !o.resp;
        if (near && !v.near && Math.abs((o.vf || 0) - (me.vf || 0)) > 4) sfx.sfx('whoosh', Math.min(1.5, Math.abs((o.vf || 0) - (me.vf || 0)) / 15));
        v.near = near;
      }
    }
    world.setBloom?.(0.6 + (cst.boosting ? 0.2 : 0));
    world.render();
    // own events (sounds, popups)
    const mine = myIdx >= 0 ? drawSt[myIdx] : null;
    if (myEv) { localEvents(myEv, me); myEv = 0; }
    if (mine) sfx.engineUpdate(Math.max(0, mine.vf), mine.boosting, mine.drift ? tierOf(mine.dch) : -1, !!mine.air, ctx.started && !mine.resp);
    else sfx.engineUpdate(0, 0, -1, false, false);
    drawOverlay(dt, cst);
    hud(dt, now);
  });

  // ---------------------------------------------------------------- overlay: speed lines, name tags, minimap, drift meter
  function drawOverlay(dt, cst) {
    const W = linesCv.width, H = linesCv.height;
    lctx.clearRect(0, 0, W, H);
    const sp = Math.max(0, cst.vf || 0);
    const k = Math.max(0, (sp - 55) / 35) + (cst.boosting ? 0.5 : 0);
    if (k > 0.02) {
      lctx.strokeStyle = `rgba(255,255,255,${Math.min(0.5, k * 0.35)})`; lctx.lineWidth = 2;
      lctx.beginPath();
      for (let i = 0; i < 26 * Math.min(1.5, k); i++) {
        const a = Math.random() * Math.PI * 2, r0 = (0.45 + Math.random() * 0.25) * Math.max(W, H), r1 = r0 + 40 + Math.random() * 120 * k;
        lctx.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0); lctx.lineTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1);
      }
      lctx.stroke();
    }
    flash = Math.max(0, flash - dt);
    flashEl.style.opacity = flash.toFixed(2);
    flashEl.style.background = 'radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(255,210,63,.45))';
    // name tags
    for (let i = 0; i < N; i++) {
      const v = views[i], tag = v.tag;
      if (i === cam.target) { tag.style.display = 'none'; continue; }
      _p.copy(v.wpos).addScaledVector(v.up, 2.4);
      const dist = _p.distanceTo(camera.position);
      _p.project(camera);
      if (_p.z > 1 || dist > 260 || !v.root.visible) { tag.style.display = 'none'; continue; }
      tag.style.display = ''; tag.style.left = ((_p.x + 1) / 2 * W) + 'px'; tag.style.top = ((1 - _p.y) / 2 * H) + 'px';
      tag.style.opacity = Math.max(0.3, 1 - dist / 260).toFixed(2);
    }
    // minimap
    mctx.clearRect(0, 0, 170, 170); mctx.drawImage(mini.bg, 0, 0);
    for (let i = N - 1; i >= 0; i--) {
      const v = views[i]; const x = v.wpos.x * mini.sc + mini.ox, z = v.wpos.z * mini.sc + mini.oz;
      mctx.fillStyle = P[i].colorCss; mctx.strokeStyle = i === myIdx ? '#fff' : '#120c26'; mctx.lineWidth = i === myIdx ? 3 : 2;
      mctx.beginPath(); mctx.arc(x, z, i === myIdx ? 6 : 4.5, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
    }
  }

  // ---------------------------------------------------------------- HUD (shared zones)
  let lastRank = 0;
  function hud(dt, now) {
    const o = order(ships.map((s, i) => (i === myIdx ? me : s)));
    const rankOf = (sh) => o.indexOf(sh) + 1;
    const raceClock = isHostSim ? raceT : lastSnapT + (ctx.started && phase === 1 ? (performance.now() - lastSnapAt) / 1000 : 0);
    // top-left: position + lap
    const focus = myIdx >= 0 ? me : ships[cam.target];
    if (focus) {
      const r = rankOf(focus), lap = lapOf(focus, track, laps);
      const who = myIdx < 0 ? `👀 ${ui.esc(P[cam.target]?.name || '')} · ` : '';
      const nAlive = KO ? ships.filter((s) => !s.out).length : N;
      ui.status(focus.out ? `${who}💥 Derezzed · ${ord(r)}` : focus.fin ? `${who}🏁 ${ord(r)} · ${fmt(focus.fin)}` : `${who}<span style="font-size:2.1rem">${r}</span><small>${ord(r).replace(/\d+/, '')} / ${nAlive}</small> &nbsp;${KO ? '⚡ KNOCKOUT' : `LAP ${lap}/${laps}`}`);
      if (myIdx >= 0 && ctx.started && !focus.fin && lastRank && r !== lastRank) sfx.sfx(r < lastRank ? 'pass' : 'passed');
      if (myIdx >= 0) lastRank = r;
    }
    // top-center: race clock, or the finish countdown
    if (KO && ctx.started && phase === 1) { const left = koAt(koDone) - raceClock; ui.timer(Math.max(0, left), { warn: 5 }); }
    else if (endIn > 0 && firstFin) ui.timer(endIn, { warn: 10 });
    else ui.timer(null, { text: ctx.started ? fmt(raceClock) : TRACKS[trackId].name });
    // top-right: standings
    ui.mini(o.map((s) => { const i = ships.indexOf(s) >= 0 ? ships.indexOf(s) : myIdx; const pl = P[i]; return { id: pl.id, name: pl.name, color: pl.color, me: i === myIdx, out: !!s.ghost, value: s.out ? '💥' : s.fin ? fmt(s.fin) : KO ? '' : `L${lapOf(s, track, laps)}` }; }));
    // bottom-center: boost meter + keys
    if (myIdx >= 0 && me) {
      const m = me.meter || 0;
      ui.bar(m / 100, `BOOST ${Math.round(m)}% · ${Math.round(Math.max(0, drawSt[myIdx].vf || 0) * 5)} km/h`);
      ui.abilities([
        { key: 'Space', label: me.drift ? ['Drift…', 'Blue!', 'Pink!', 'GOLD!'][tierOf(me.dch)] : 'Drift', ready: !!me.drift },
        { key: 'Shift', label: 'Boost', ready: m > 1, cd: 1 - m / 100 },
      ]);
      // drift charge pips + chain
      const show = me.drift || me.chain > 0;
      driftEl.style.opacity = show ? 1 : 0;
      for (let k = 0; k < 3; k++) {
        const lo = TIER_AT[k], hi = TIER_AT[k + 1];
        const f = me.drift ? Math.max(0, Math.min(1, (me.dch - lo) / (hi - lo))) : 0;
        pipEls[k].style.width = (f * 100).toFixed(0) + '%';
        pipEls[k].style.background = '#' + TIER_COLORS[k + 1].toString(16).padStart(6, '0');
      }
      const hot = me.heat / C.OVERHEAT;
      pipEls[2].parentElement.style.boxShadow = hot > 0 ? `0 0 ${8 + hot * 18}px ${hot > 0.6 && Math.floor(now / 90) % 2 ? '#ff3a1c' : '#ffd23f'}` : '';
      pipEls[2].style.background = hot > 0.6 && Math.floor(now / 90) % 2 ? '#ff5a3a' : pipEls[2].style.background;
      const cw = me.chain > 0 && !me.drift ? Math.max(0, 1 - me.chainT / C.CHAIN_WIN) : me.dlink ? 1 : 0;
      chainEl.innerHTML = me.chain > 0 ? `CHAIN ×${chainMult(me.chain + (me.drift && me.dlink ? 1 : 0)).toFixed(1)} <small>${me.drift ? (me.dlink ? 'linked!' : '') : cw > 0 ? 'drift again!' : ''}</small>` : '';
      // wrong way
      const wrong = ctx.started && !me.fin && Math.abs(me.yaw) > 2.1 && Math.abs(me.vf) > 4;
      wrongT = wrong ? wrongT + dt : 0;
      warnEl.style.opacity = wrongT > 0.8 ? 1 : 0;
    } else { driftEl.style.opacity = 0; ui.bar(null); }
    popT -= dt; if (popT <= 0) popEl.classList.remove('on');
  }
  ui.setScoreboard(() => ({
    columns: ['#', 'Racer', 'Lap', 'Best lap', 'Max chain'],
    rows: order(ships).map((s, k) => { const i = ships.indexOf(s); return [k + 1, `<span style="color:${P[i].colorCss}">${ui.esc(P[i].name)}</span>`, s.fin ? '🏁 ' + fmt(s.fin) : `${lapOf(s, track, laps)}/${laps}`, s.best ? s.best.toFixed(2) + 's' : '–', s.maxChain ? '×' + chainMult(s.maxChain).toFixed(1) : '–']; }),
  }));

  ctx.on('go', () => { ui.banner(KO ? 'KNOCKOUT! DON\'T BE LAST!' : 'GO! DRIFT TO BOOST!', 1400); sfx.setIntensity(KO ? 1 : 0); });
  ui.banner(TRACKS[trackId].name.toUpperCase(), 2600);
  ui.toast(KO ? `Knockout: last place is derezzed every ${Math.round(KO_EVERY)}s` : `${laps} laps · ${TRACKS[trackId].desc}`, '', 3500);

  return {
    standings,
    stop() {
      sfx.stop();
      for (const v of views) { v.trails.forEach((tr) => tr.dispose()); kit.disposeShip(v); }
      sparks.dispose(); kit.dispose();
      world.dispose();
      clearTrackCache();
      delete window.__neon;
    },
  };
}
