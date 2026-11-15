import * as THREE from 'three';
import { makeCourse, mulberry32 } from './course.js';
import { CLASSES, newEntity, stepEntity, bump, botInput, newBrain } from './physics.js';
import { createRenderer, buildCourse, disposeGroup, makeRider, poseRider, COLORS } from './render.js';

const $ = (id) => document.getElementById(id);
const { renderer, scene, camera } = createRenderer($('c'));
const linesCv = $('lines'), lctx = linesCv.getContext('2d');
const fitLines = () => { linesCv.width = innerWidth; linesCv.height = innerHeight; };
fitLines(); addEventListener('resize', fitLines);

const PREFIX = 'dhrush-v1-';
const BOT_NAMES = ['Avalanche', 'Yeti', 'Flurry', 'Moguls', 'Icicle', 'Powder', 'Slush', 'Blizzard', 'Frosty', 'Shred'];
const MAX_PLAYERS = 8;
const SEND_HZ = 20;

const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { } } };

const S = {
  screen: 'menu', mode: 'solo', myId: 'me',
  name: store.get('dh_name', ''), cls: store.get('dh_cls', 'ski'),
  players: [], peer: null, conns: new Map(), hostConn: null, code: null,
  ping: 0, race: null, debug: false, fps: 0, waiting: false,
};
$('name').value = S.name;

// ---------------- UI helpers ----------------
function show(screen) {
  S.screen = screen;
  for (const id of ['menu', 'lobby', 'results']) $(id).classList.toggle('show', id === screen);
  $('hud').classList.toggle('show', screen === 'race' || screen === 'results');
}
function toast(t, ms = 2500) { const el = $('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => el.style.display = 'none', ms); }
function setErr(t) { $('err').textContent = t || ''; }
function refreshCls() { document.querySelectorAll('[data-cls] button').forEach(b => b.classList.toggle('sel', b.dataset.c === S.cls)); }
refreshCls();
document.querySelectorAll('[data-cls] button').forEach(b => b.addEventListener('click', () => {
  S.cls = b.dataset.c; store.set('dh_cls', S.cls); refreshCls();
  const me = S.players.find(p => p.id === S.myId); if (me) me.cls = S.cls;
  if (S.mode === 'client') send(S.hostConn, { t: 'cls', cls: S.cls });
  if (S.mode === 'host') broadcastLobby();
  renderLobby();
}));
function myName() { const n = $('name').value.trim().slice(0, 12) || 'Rider' + Math.floor(Math.random() * 90 + 10); S.name = n; store.set('dh_name', n); return n; }
const fmtTime = (t) => { if (t == null) return 'DNF'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

// ---------------- Lobby ----------------
function addBot() {
  if (S.players.length >= MAX_PLAYERS) return toast('Room is full (8)');
  const used = new Set(S.players.map(p => p.name));
  const name = BOT_NAMES.find(n => !used.has(n + ' (bot)')) || 'Bot';
  S.players.push({ id: 'bot' + Math.random().toString(36).slice(2, 7), name: name + ' (bot)', cls: Math.random() < 0.5 ? 'ski' : 'board', bot: true });
}
function renderLobby() {
  const ul = $('plist'); ul.innerHTML = '';
  S.players.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:#${COLORS[i % 8].toString(16).padStart(6, '0')}"></span><span class="nm"></span>
      <span class="tag">${CLASSES[p.cls].label}</span>${p.id === 'host' || (S.mode === 'host' && p.id === S.myId) ? '<span class="tag">HOST</span>' : ''}${p.id === S.myId ? '<span class="tag">YOU</span>' : ''}`;
    li.querySelector('.nm').textContent = p.name;
    if (p.bot && S.mode === 'host') {
      const t = document.createElement('button'); t.className = 'alt'; t.textContent = 'swap';
      t.onclick = () => { p.cls = p.cls === 'ski' ? 'board' : 'ski'; broadcastLobby(); renderLobby(); };
      const x = document.createElement('button'); x.className = 'red'; x.textContent = '✕';
      x.onclick = () => { S.players = S.players.filter(q => q !== p); broadcastLobby(); renderLobby(); };
      li.append(t, x);
    }
    ul.appendChild(li);
  });
  const host = S.mode === 'host';
  $('hostctl').style.display = host ? '' : 'none';
  $('start').disabled = S.players.length < 2;
  $('code').textContent = S.code || '----';
  $('lobbymsg').textContent = host ? (S.players.length < 2 ? 'Add a bot or wait for a friend to join (2–8 riders).' : `${S.players.length}/8 riders. Start when ready.`)
    : (S.waiting ? 'Race in progress — you will join the next one.' : 'Waiting for the host to start…');
}
$('addbot').onclick = () => { addBot(); broadcastLobby(); renderLobby(); };
$('rmbot').onclick = () => { const i = S.players.map(p => p.bot).lastIndexOf(true); if (i >= 0) S.players.splice(i, 1); broadcastLobby(); renderLobby(); };
$('start').onclick = () => hostStartRace();
$('leave').onclick = () => leaveToMenu();
$('quit').onclick = () => leaveToMenu();
$('again').onclick = () => { if (S.mode !== 'client') hostStartRace(); };
$('tolobby').onclick = () => { if (S.mode === 'host') { endRaceObjects(); show('lobby'); renderLobby(); broadcast({ t: 'tolobby' }); broadcastLobby(); } };

// ---------------- Networking (PeerJS) ----------------
let PeerCls = null;
async function loadPeer() {
  if (!PeerCls) { const m = await import('peerjs'); PeerCls = m.Peer || m.default; }
  return PeerCls;
}
function send(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { console.warn('send failed', e); } }
function broadcast(msg) { for (const c of S.conns.values()) send(c, msg); }
function lobbyPayload() { return { t: 'lobby', code: S.code, players: S.players.map(({ id, name, cls, bot }) => ({ id, name, cls, bot })) }; }
function broadcastLobby() { if (S.mode === 'host') broadcast(lobbyPayload()); }

function randomCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }

async function createRoom(tries = 0) {
  setErr('Connecting to PeerJS…');
  let Peer; try { Peer = await loadPeer(); } catch (e) { setErr('Could not load PeerJS (check internet).'); return; }
  const code = randomCode();
  const peer = new Peer(PREFIX + code, { debug: 1 });
  peer.on('open', () => {
    setErr('');
    S.peer = peer; S.mode = 'host'; S.code = code; S.myId = 'host';
    S.players = [{ id: 'host', name: myName(), cls: S.cls, bot: false }];
    show('lobby'); renderLobby();
  });
  peer.on('connection', (conn) => hostAcceptConn(conn));
  peer.on('error', (err) => {
    console.warn('peer error', err.type, err);
    if (err.type === 'unavailable-id' && tries < 5) { peer.destroy(); createRoom(tries + 1); return; }
    if (S.mode !== 'host') setErr('Network error: ' + err.type); else toast('Network: ' + err.type);
  });
  peer.on('disconnected', () => { if (S.mode === 'host' && !peer.destroyed) peer.reconnect(); });
}

function hostAcceptConn(conn) {
  conn.on('data', (msg) => hostOnMsg(conn, msg));
  conn.on('close', () => hostDropConn(conn));
  conn.on('error', () => hostDropConn(conn));
}
function hostDropConn(conn) {
  if (!S.conns.has(conn.peer)) return;
  S.conns.delete(conn.peer);
  const p = S.players.find(q => q.id === conn.peer);
  S.players = S.players.filter(q => q.id !== conn.peer);
  if (S.race) { const ent = S.race.ents.get(conn.peer); if (ent) { ent.left = true; removeEnt(conn.peer); } }
  if (p) toast(`${p.name} left`);
  broadcastLobby(); if (S.screen === 'lobby') renderLobby();
}
function hostOnMsg(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'hello': {
      if (S.players.length >= MAX_PLAYERS) { send(conn, { t: 'kick', reason: 'Room is full (8 max).' }); setTimeout(() => conn.close(), 300); return; }
      S.conns.set(conn.peer, conn);
      const name = String(msg.name || 'Rider').slice(0, 12);
      S.players.push({ id: conn.peer, name, cls: msg.cls === 'board' ? 'board' : 'ski', bot: false });
      send(conn, { t: 'welcome', id: conn.peer, inRace: S.screen === 'race' });
      broadcastLobby(); if (S.screen === 'lobby') renderLobby();
      toast(`${name} joined`);
      break;
    }
    case 'cls': { const p = S.players.find(q => q.id === conn.peer); if (p) { p.cls = msg.cls === 'board' ? 'board' : 'ski'; broadcastLobby(); if (S.screen === 'lobby') renderLobby(); } break; }
    case 'ping': send(conn, { t: 'pong', ts: msg.ts }); break;
    case 'st': if (S.race) applyRemoteState(conn.peer, msg.s); break;
  }
}

async function joinRoom(code) {
  code = code.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) return setErr('Enter the 4-letter room code.');
  setErr('Connecting…');
  let Peer; try { Peer = await loadPeer(); } catch (e) { setErr('Could not load PeerJS (check internet).'); return; }
  const peer = new Peer({ debug: 1 });
  let opened = false;
  const to = setTimeout(() => { if (!opened) { setErr('Could not reach that room. Check the code and try again.'); peer.destroy(); } }, 12000);
  peer.on('error', (err) => {
    console.warn('peer error', err.type, err);
    if (err.type === 'peer-unavailable') { setErr(`Room ${code} not found.`); clearTimeout(to); peer.destroy(); }
    else if (!opened) setErr('Network error: ' + err.type);
  });
  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    conn.on('open', () => {
      opened = true; clearTimeout(to); setErr('');
      S.peer = peer; S.hostConn = conn; S.mode = 'client'; S.code = code; S.myId = conn.peer && peer.id;
      send(conn, { t: 'hello', name: myName(), cls: S.cls });
    });
    conn.on('data', (msg) => clientOnMsg(msg));
    conn.on('close', () => { if (S.mode === 'client') { leaveToMenu(); setErr('Disconnected from host.'); } });
  });
}
function clientOnMsg(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'welcome': S.myId = msg.id; S.waiting = !!msg.inRace; show('lobby'); renderLobby(); break;
    case 'lobby': S.players = msg.players; S.code = msg.code; if (S.screen === 'lobby') renderLobby(); break;
    case 'tolobby': S.waiting = false; endRaceObjects(); show('lobby'); renderLobby(); break;
    case 'start': S.waiting = false; startRace(msg.seed, msg.players, msg.cd - S.ping / 2); break;
    case 'snap': if (S.race && !S.waiting) applySnap(msg); break;
    case 'results': if (S.race) showResults(msg.list); break;
    case 'kick': leaveToMenu(); setErr(msg.reason); break;
    case 'pong': S.ping = performance.now() - msg.ts; break;
  }
}
setInterval(() => { if (S.mode === 'client') send(S.hostConn, { t: 'ping', ts: performance.now() }); }, 1000);

function leaveToMenu() {
  const peer = S.peer;
  S.mode = 'solo'; S.peer = null; S.hostConn = null; S.conns.clear(); S.code = null; S.players = []; S.myId = 'me'; S.waiting = false;
  if (peer) try { peer.destroy(); } catch { }
  endRaceObjects();
  show('menu'); setErr('');
  ensureMenuCourse();
}

$('create').onclick = () => createRoom();
$('join').onclick = () => joinRoom($('joincode').value);
$('joincode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('joincode').value); });
$('quick').onclick = () => {
  S.mode = 'solo'; S.myId = 'me';
  S.players = [{ id: 'me', name: myName(), cls: S.cls, bot: false }];
  for (let i = 0; i < 5; i++) addBot();
  hostStartRace();
};

// ---------------- Race setup ----------------
let menuCourse = null;
function ensureMenuCourse() {
  if (menuCourse) return;
  const c = makeCourse(Math.floor(Math.random() * 1e9));
  menuCourse = { course: c, mesh: buildCourse(c), t: 0 };
  scene.add(menuCourse.mesh);
}
function dropMenuCourse() { if (menuCourse) { scene.remove(menuCourse.mesh); disposeGroup(menuCourse.mesh); menuCourse = null; } }

function hostStartRace() {
  const me = S.players.find(p => p.id === S.myId); if (me) me.cls = S.cls;
  const seed = Math.floor(Math.random() * 1e9);
  const cd = 3500;
  const list = S.players.map(({ id, name, cls, bot }) => ({ id, name, cls, bot }));
  if (S.mode === 'host') broadcast({ t: 'start', seed, players: list, cd });
  startRace(seed, list, cd);
}

function startRace(seed, list, cd) {
  endRaceObjects(); dropMenuCourse();
  const course = makeCourse(seed);
  const mesh = buildCourse(course); scene.add(mesh);
  const rnd = mulberry32(seed ^ 0x5bd1e995);
  const race = { seed, course, mesh, startAt: performance.now() + Math.max(500, cd), phase: 'countdown', ents: new Map(), firstFinish: null,
    over: false, sendT: 0, lastMsgId: 0, msgUntil: 0, endIn: null, list };
  list.forEach((p, i) => {
    const row = Math.floor(i / 4), colI = i % 4;
    const z = 8 - row * 4, x = course.cxMain(z) + (colI - 1.5) * 4 + (row % 2) * 2;
    const e = newEntity(p.id, p.cls, x, z, course);
    const rider = makeRider(p.cls, COLORS[i % 8], p.id === S.myId ? null : p.name);
    scene.add(rider.root, rider.shadow);
    const ent = { e, rider, info: { ...p, color: COLORS[i % 8] }, local: p.id === S.myId, bot: p.bot && S.mode !== 'client', remote: null };
    if (ent.bot) ent.brain = newBrain(mulberry32(Math.floor(rnd() * 1e9)), p.cls);
    race.ents.set(p.id, ent);
  });
  race.me = race.ents.get(S.myId) || null;
  S.race = race;
  camState.init = false;
  buildProgressMarkers();
  $('fin').innerHTML = ''; $('msg').textContent = '';
  $('hint').textContent = 'W tuck · S brake · Space jump · arrows in air = tricks';
  show('race');
}

function removeEnt(id) {
  const r = S.race; if (!r) return;
  const ent = r.ents.get(id); if (!ent) return;
  scene.remove(ent.rider.root, ent.rider.shadow); disposeGroup(ent.rider.root); disposeGroup(ent.rider.shadow);
  r.ents.delete(id);
  buildProgressMarkers();
}
function endRaceObjects() {
  const r = S.race; if (!r) return;
  for (const id of [...r.ents.keys()]) removeEnt(id);
  scene.remove(r.mesh); disposeGroup(r.mesh);
  S.race = null;
}

// ---------------- Network state sync ----------------
const STATE_CODE = { ride: 0, wipe: 2 };
function packEnt(e) {
  const st = (e.state === 'wipe' ? 2 : e.air ? 1 : 0) | (e.tuck ? 4 : 0) | (e.finished ? 8 : 0) | (e.ghostT > 0 ? 16 : 0);
  const r = (n, k = 100) => Math.round(n * k) / k;
  return [r(e.x), r(e.y), r(e.z), r(e.h, 1000), r(e.spin, 100), r(e.flip, 100), r(e.v), st, e.finished ? r(e.finishTime, 1000) : 0];
}
function applyRemoteState(id, s) {
  const ent = S.race && S.race.ents.get(id);
  if (!ent || ent.local || !Array.isArray(s)) return;
  ent.remote = { x: s[0], y: s[1], z: s[2], h: s[3], spin: s[4], flip: s[5], v: s[6], st: s[7], finT: s[8], t: performance.now() };
  const e = ent.e;
  e.h = s[3]; e.spin = s[4]; e.flip = s[5]; e.v = s[6];
  e.state = (s[7] & 3) === 2 ? 'wipe' : 'ride'; e.air = (s[7] & 3) === 1; e.tuck = !!(s[7] & 4); e.ghostT = (s[7] & 16) ? 1 : 0;
  if ((s[7] & 8) && !e.finished) { e.finished = true; e.finishTime = s[8]; onFinish(ent); }
}
function applySnap(msg) {
  const r = S.race;
  r.endIn = msg.endIn;
  if (r.phase === 'countdown' && msg.rt > 0) { r.startAt = performance.now() - msg.rt * 1000; }
  for (const row of msg.e) {
    const id = row[0];
    if (id === S.myId) continue;
    applyRemoteState(id, row.slice(1));
  }
  for (const id of [...r.ents.keys()]) if (id !== S.myId && !msg.e.some(row => row[0] === id)) removeEnt(id);
}
function smoothRemote(ent, dt) {
  const R = ent.remote; if (!R) return;
  const e = ent.e;
  const age = Math.min(0.25, (performance.now() - R.t) / 1000);
  const moving = e.state !== 'wipe' && !e.finished;
  const tx = R.x + (moving ? Math.sin(R.h) * R.v * age : 0), tz = R.z + (moving ? Math.cos(R.h) * R.v * age : 0);
  const dx = tx - e.x, dz = tz - e.z;
  if (dx * dx + dz * dz > 100) { e.x = tx; e.z = tz; e.y = R.y; return; }
  const k = 1 - Math.exp(-14 * dt);
  e.x += dx * k; e.z += dz * k;
  const gy = S.race.course.groundH(e.x, e.z);
  e.y = e.air ? e.y + (R.y - e.y) * k : gy;
}

// ---------------- Input ----------------
const K = {};
const stale = new Set();
let jumpBuf = 0;
addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT') return;
  if (ev.code === 'Backquote') { S.debug = !S.debug; $('debug').style.display = S.debug ? 'block' : 'none'; return; }
  if (S.screen === 'race' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(ev.code)) ev.preventDefault();
  if (ev.code === 'Space' && !ev.repeat) jumpBuf = 0.18;
  K[ev.code] = true;
});
addEventListener('keyup', (ev) => { K[ev.code] = false; stale.delete(ev.code); });
addEventListener('blur', () => { for (const k in K) K[k] = false; });
const fresh = (c) => K[c] && !stale.has(c);
function localInput(e) {
  const L = K.KeyA || K.ArrowLeft, Rr = K.KeyD || K.ArrowRight;
  const inp = { steer: (Rr ? 1 : 0) - (L ? 1 : 0), tuck: !!(K.KeyW || K.ArrowUp), brake: !!(K.KeyS || K.ArrowDown), jump: jumpBuf > 0, spin: 0, flip: 0 };
  if (e.air) {
    inp.spin = ((fresh('ArrowRight') || fresh('KeyD')) ? 1 : 0) - ((fresh('ArrowLeft') || fresh('KeyA')) ? 1 : 0);
    inp.flip = ((fresh('ArrowUp') || fresh('KeyW')) ? 1 : 0) - ((fresh('ArrowDown') || fresh('KeyS')) ? 1 : 0);
  }
  return inp;
}

// ---------------- Simulation tick ----------------
const FIXED = 1 / 60;
let acc = 0;
function raceTime() { return S.race ? (performance.now() - S.race.startAt) / 1000 : 0; }

function simStep(dt) {
  const r = S.race; const rt = raceTime();
  for (const ent of r.ents.values()) {
    if (!ent.local && !ent.bot) continue;
    const e = ent.e;
    const wasAir = e.air;
    const inp = ent.local ? localInput(e) : botInput(e, ent.brain, r.course, dt);
    const m = e.msgId;
    stepEntity(e, inp, dt, r.course);
    if (ent.local) {
      if (!wasAir && e.air) { stale.clear(); for (const k in K) if (K[k]) stale.add(k); jumpBuf = 0; }
      if (e.msgId !== m && e.msg) flash(e.msg.text, e.msg.good);
    }
    if (e.finished && !e.finishTime) { e.finishTime = rt; onFinish(ent); }
  }
  // bumps: each side resolves itself (local player; host also resolves bots)
  const list = [...r.ents.values()];
  for (const a of list) {
    if (!a.local && !a.bot) continue;
    for (const b of list) if (a !== b && bump(a.e, b.e) && a.local) flash('BUMP!', null, 500);
  }
}

function onFinish(ent) {
  const r = S.race;
  if (r.firstFinish == null) r.firstFinish = raceTime();
  if (ent.local) {
    const place = rankOf(ent);
    $('fin').innerHTML = `FINISHED ${ordinal(place)}!<small>${fmtTime(ent.e.finishTime)}</small>`;
  }
}

function standings() {
  const arr = [...S.race.ents.values()];
  arr.sort((a, b) => {
    if (a.e.finished && b.e.finished) return a.e.finishTime - b.e.finishTime;
    if (a.e.finished) return -1; if (b.e.finished) return 1;
    return b.e.z - a.e.z;
  });
  return arr;
}
function rankOf(ent) { return standings().indexOf(ent) + 1; }

function hostCheckEnd() {
  const r = S.race; if (r.over || r.phase !== 'race') return;
  const rt = raceTime();
  const ents = [...r.ents.values()];
  const humans = ents.filter(x => !x.info.bot);
  const allHumansDone = humans.every(x => x.e.finished);
  const allDone = ents.every(x => x.e.finished);
  r.endIn = r.firstFinish != null ? Math.max(0, 30 - (rt - r.firstFinish)) : null;
  if (allHumansDone && !allDone) {
    // give bots a few seconds after the last human to cross
    if (r.humansDoneAt == null) r.humansDoneAt = rt;
    r.endIn = Math.min(r.endIn ?? 99, Math.max(0, 12 - (rt - r.humansDoneAt)));
  }
  if (allDone || r.endIn === 0 || rt > 200) {
    r.over = true;
    const list = standings().map(x => ({ id: x.info.id, name: x.info.name, cls: x.info.cls, bot: !!x.info.bot, time: x.e.finished ? x.e.finishTime : null, color: x.info.color }));
    if (S.mode === 'host') broadcast({ t: 'results', list });
    setTimeout(() => showResults(list), 900);
  }
}

function showResults(list) {
  const t = $('rtable');
  t.innerHTML = '<tr><th>#</th><th>Rider</th><th>Class</th><th>Time</th></tr>';
  const best = list.find(x => x.time != null)?.time;
  list.forEach((x, i) => {
    const tr = document.createElement('tr'); if (x.id === S.myId) tr.className = 'me';
    const gap = x.time != null && best != null && i > 0 ? ` <small style="opacity:.6">+${(x.time - best).toFixed(2)}</small>` : '';
    tr.innerHTML = `<td>${i + 1}</td><td></td><td>${CLASSES[x.cls].label}</td><td>${fmtTime(x.time)}${gap}</td>`;
    tr.children[1].textContent = x.name;
    t.appendChild(tr);
  });
  const host = S.mode !== 'client';
  $('resctl').style.display = host ? '' : 'none';
  $('tolobby').style.display = S.mode === 'host' ? '' : 'none';
  $('resmsg').textContent = host ? '' : 'Waiting for the host to start the next race…';
  if (S.race) S.race.over = true;
  show('results');
}

function netTick(dt) {
  const r = S.race; if (!r) return;
  r.sendT -= dt;
  if (r.sendT > 0) return;
  r.sendT = 1 / SEND_HZ;
  if (S.mode === 'client' && r.me) send(S.hostConn, { t: 'st', s: packEnt(r.me.e) });
  if (S.mode === 'host') {
    const e = [];
    for (const [id, ent] of r.ents) e.push([id, ...packEnt(ent.e)]);
    broadcast({ t: 'snap', rt: Math.round(raceTime() * 1000) / 1000, e, endIn: r.endIn });
  }
}

// ---------------- HUD ----------------
let msgTimer = 0;
function flash(text, good, ms = 1400) {
  const el = $('msg'); el.textContent = text;
  el.style.color = good === true ? '#7dffb0' : good === false ? '#ff7a8a' : '#fff';
  el.style.opacity = 1; msgTimer = ms / 1000;
}
function buildProgressMarkers() {
  const pr = $('prog'); pr.innerHTML = '';
  if (!S.race) return;
  for (const ent of S.race.ents.values()) {
    const d = document.createElement('div'); d.className = 'm' + (ent.local ? ' me' : '');
    d.style.background = '#' + ent.info.color.toString(16).padStart(6, '0');
    pr.appendChild(d); ent.marker = d;
  }
}
function updateHud(dt) {
  const r = S.race; if (!r) return;
  const rt = raceTime();
  const cdEl = $('cd');
  if (r.phase === 'countdown') cdEl.textContent = Math.ceil(-rt) > 0 ? Math.ceil(-rt) : 'GO!';
  else if (rt < 1) cdEl.textContent = 'GO!'; else cdEl.textContent = '';
  const me = r.me;
  if (me) {
    const e = me.e;
    $('pos').innerHTML = `${ordinal(rankOf(me))}<small> / ${r.ents.size}</small>`;
    $('time').textContent = fmtTime(e.finished ? e.finishTime : Math.max(0, rt));
    $('speed').innerHTML = `${Math.round(e.v * 3.6)}<small> km/h</small><span class="c">${CLASSES[e.cls].label}${e.boostT > 0 ? ' · BOOST' : ''}</span>`;
    if (e.finished) {
      const left = r.endIn != null && !r.over ? `<small>Results in ${Math.ceil(r.endIn)}s</small>` : '';
      $('fin').innerHTML = `FINISHED ${ordinal(rankOf(me))}!<small>${fmtTime(e.finishTime)}</small>${left}`;
    } else if (r.endIn != null && r.endIn < 30) {
      $('fin').innerHTML = `<small>Race closes in ${Math.ceil(r.endIn)}s</small>`;
    }
  }
  for (const ent of r.ents.values()) if (ent.marker) ent.marker.style.left = (Math.max(0, Math.min(1, ent.e.z / r.course.L)) * 100) + '%';
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').style.opacity = 0; }
  if (rt > 8) $('hint').textContent = '';
}

function drawSpeedLines(v) {
  lctx.clearRect(0, 0, linesCv.width, linesCv.height);
  if (S.screen !== 'race' || v < 27) return;
  const k = Math.min(1, (v - 27) / 20);
  const W = linesCv.width, H = linesCv.height, cx = W / 2, cy = H * 0.45;
  const n = Math.floor(12 + k * 40);
  lctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.4 * k})`;
  lctx.lineWidth = 2;
  lctx.beginPath();
  const maxR = Math.hypot(W, H) / 2;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = maxR * (0.45 + Math.random() * 0.3), r1 = r0 + maxR * (0.1 + 0.25 * k * Math.random());
    lctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    lctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
  }
  lctx.stroke();
}

// ---------------- Camera ----------------
const camState = { init: false, h: 0, pos: new THREE.Vector3() };
const tmpV = new THREE.Vector3(), lookV = new THREE.Vector3();
function updateCamera(dt) {
  const r = S.race;
  if (!r || !r.me) {
    ensureMenuCourse();
    if (menuCourse) {
      const c = menuCourse.course; menuCourse.t += dt;
      const z = 30 + (menuCourse.t * 18) % (c.L - 100);
      const x = c.cxMain(z);
      camera.position.set(x + 25, c.groundH(x, z) + 18, z - 20);
      camera.lookAt(c.cxMain(z + 40), c.groundH(c.cxMain(z + 40), z + 40), z + 40);
      camera.fov = 70; camera.updateProjectionMatrix();
    }
    return;
  }
  const e = r.me.e;
  if (!camState.init) { camState.h = e.h; camState.init = true; camState.pos.set(e.x - Math.sin(e.h) * 9, e.y + 4, e.z - Math.cos(e.h) * 9); }
  camState.h += (e.h - camState.h) * (1 - Math.exp(-5 * dt));
  const sx = Math.sin(camState.h), sz = Math.cos(camState.h);
  const dist = 8 + Math.min(e.v, 50) * 0.04;
  tmpV.set(e.x - sx * dist, 0, e.z - sz * dist);
  const gy = r.course.groundH(tmpV.x, tmpV.z);
  tmpV.y = Math.max(e.y + 3.4, gy + 2);
  camState.pos.lerp(tmpV, 1 - Math.exp(-9 * dt));
  camera.position.copy(camState.pos);
  lookV.set(e.x + sx * 6, e.y + 1.2, e.z + sz * 6);
  camera.lookAt(lookV);
  const fov = 70 + Math.max(0, Math.min(1, (e.v - 18) / 32)) * 20;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt)); camera.updateProjectionMatrix(); }
}

// ---------------- Main loop ----------------
let lastT = performance.now();
let fpsAcc = 0, fpsN = 0, debugT = 0;
function tick(render) {
  const now = performance.now();
  let dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (jumpBuf > 0) jumpBuf -= dt;
  const r = S.race;
  if (r && S.screen !== 'menu') {
    if (r.phase === 'countdown' && raceTime() >= 0) r.phase = 'race';
    if (r.phase === 'race' && !r.over) {
      acc += dt;
      let n = 0;
      while (acc >= FIXED && n < 8) { simStep(FIXED); acc -= FIXED; n++; }
      if (n === 8) acc = 0;
      for (const ent of r.ents.values()) if (!ent.local && !ent.bot) smoothRemote(ent, dt);
      if (S.mode !== 'client') hostCheckEnd();
    } else if (r.phase === 'race' && r.over) {
      // keep riders sliding to a stop on the results screen
      for (const ent of r.ents.values()) if (ent.local || ent.bot) stepEntity(ent.e, { steer: 0, brake: true }, dt, r.course);
    }
    if (S.mode !== 'solo') netTick(dt);
  }
  if (!render) return;
  if (S.race) {
    for (const ent of S.race.ents.values()) poseRider(ent.rider, ent.e, S.race.course.groundH(ent.e.x, ent.e.z), now / 1000);
    updateHud(dt);
  }
  updateCamera(dt);
  drawSpeedLines(S.race && S.race.me ? S.race.me.e.v : 0);
  renderer.render(scene, camera);
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { S.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  debugT -= dt;
  if (S.debug && debugT <= 0) {
    debugT = 0.2;
    const ents = S.race ? [...S.race.ents.values()] : [];
    const humans = S.race ? ents.filter(x => !x.info.bot).length : S.players.filter(p => !p.bot).length;
    const total = S.race ? ents.length : S.players.length;
    const me = S.race?.me?.e;
    $('debug').textContent = [
      `FPS      ${S.fps.toFixed(0)}`,
      `Ping     ${S.mode === 'client' ? Math.round(S.ping) + ' ms' : S.mode === 'host' ? 'you are host' : 'solo (no network)'}`,
      `Players  ${total} (${humans} human, ${total - humans} bot)`,
      `Mode     ${S.mode}${S.code ? ' · room ' + S.code : ''}`,
      S.race ? `Seed     ${S.race.seed}` : '',
      me ? `Speed    ${(me.v * 3.6).toFixed(0)} km/h  z ${me.z.toFixed(0)}/${S.race.course.L}` : '',
      me ? `State    ${me.state}${me.air ? ' air' : ''} spin ${me.spin.toFixed(1)} flip ${me.flip.toFixed(1)}` : '',
    ].filter(Boolean).join('\n');
  }
}
function frame() { tick(true); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
// Background tabs throttle rAF to zero; a worker timer keeps the host simulating + sending.
try {
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),33)'], { type: 'text/javascript' })));
  w.onmessage = () => { if (document.hidden) tick(false); };
} catch (e) { console.warn('no worker ticker', e); }

ensureMenuCourse();
window.__dh = S; // handy for debugging in the console
void STATE_CODE;
