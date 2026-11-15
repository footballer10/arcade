// Mini-Golf Battle — main game (rendering, UI, host-authoritative networking via PeerJS, bots,
// client-side prediction, power-ups, sounds)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as C from './course.js';
import * as SFX from './sfx.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const HOLES = Math.max(1, Math.min(9, parseInt(params.get('holes')) || 9));
const ROOM_PREFIX = 'mgbgolf-';
const COLORS = ['#ffffff', '#ff5c5c', '#4dabff', '#ffd43b', '#b57bff', '#ff9f43', '#2ee6a8', '#ff7ad9'];
const BOT_NAMES = ['Birdie Bot', 'Bogey Bot', 'Caddy Bot', 'Putter Bot', 'Eagle Bot', 'Chip Bot', 'Wedge Bot'];
const STEP = 1 / 240;
const HOLE_END_SECS = 6;
const EFFECT_SECS = 12;
const PICKUP_RESPAWN = 12;

// ---------------------------------------------------------------- state
const S = {
  screen: 'menu', isHost: false, online: false, myId: 'host', name: 'Player', code: '',
  players: [], phase: 'none', holeIdx: 0, seed: 0, holes: HOLES, hole: null, par: 3,
  sim: null,     // host: authoritative {balls, t, acc, timeLeft, first, endDelay, snapAcc, bot, pick}
  csim: null,    // client: predicted local copy {balls, t, acc}
  pick: [],      // pickup availability (for rendering)
  timeLeft: C.HOLE_TIME, ht: 0, htAt: 0,
  peer: null, conns: new Map(), hostConn: null, ping: 0,
  pred: { strokes: -1, until: 0 }, shotLock: 0,
  boardEndsAt: 0, nextPrep: null,
};
const balls = () => S.isHost ? (S.sim ? S.sim.balls : new Map()) : (S.csim ? S.csim.balls : new Map());
const myBall = () => balls().get(S.myId);

// ---------------------------------------------------------------- three.js setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#87c4ea');
scene.fog = new THREE.Fog('#87c4ea', 60, 140);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 8, 10);
const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.minDistance = 2.5; controls.maxDistance = 45; controls.maxPolarAngle = Math.PI * 0.47;
scene.add(new THREE.HemisphereLight(0xffffff, 0x406040, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: '#2f6b3a' }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -1.2; ground.receiveShadow = true; scene.add(ground);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

let course = null;
let moverMeshes = [], pickupMeshes = [], rings = [];
const ballMeshes = new Map();
const aimGroup = new THREE.Group();
const aimBar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.09), new THREE.MeshBasicMaterial({ color: '#4ade80' }));
const aimHead = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.35, 12), aimBar.material);
const pullLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
aimHead.rotation.z = -Math.PI / 2;
aimGroup.add(aimBar, aimHead); aimGroup.visible = false; pullLine.visible = false;
scene.add(aimGroup, pullLine);

// ---------------------------------------------------------------- UI helpers
function show(id) { ['menu', 'lobby', 'board'].forEach(s => $(s).classList.toggle('hidden', s !== id)); }
function toast(msg) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
  $('toasts').appendChild(d); setTimeout(() => d.remove(), 2700);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pname = id => S.players.find(p => p.id === id)?.name ?? '?';
const total = p => p.scores.reduce((a, s) => a + (s || 0), 0) - p.first.filter(Boolean).length;
// volume falloff by distance from what the camera is looking at
const near = (x, z) => Math.max(0, Math.min(1, 1.25 - Math.hypot(x - controls.target.x, z - controls.target.z) / 22));

try { $('nameIn').value = localStorage.getItem('mgb-name') || ''; } catch { }
function readName() {
  const n = ($('nameIn').value || '').trim().slice(0, 14) || 'Player';
  try { localStorage.setItem('mgb-name', n); } catch { }
  return n;
}

function renderLobby() {
  $('roomCode').textContent = S.online ? (S.code || '----') : 'SOLO';
  $('lobbyList').innerHTML = S.players.map(p => `<li><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === S.myId ? ' (you)' : ''}<span class="tag">${p.bot ? 'BOT' : p.id === 'host' ? 'HOST' : ''}</span></li>`).join('');
  $('hostCtl').classList.toggle('hidden', !S.isHost);
  $('waitMsg').classList.toggle('hidden', S.isHost);
  $('addBot').disabled = S.players.length >= 8;
  $('remBot').disabled = !S.players.some(p => p.bot);
  $('startBtn').disabled = S.players.length < 2;
  $('startBtn').textContent = S.players.length < 2 ? 'Start Match (need 2+ players — add a bot)' : 'Start Match';
}

function boardHTML(curIdx, played) {
  const ps = [...S.players].sort((a, b) => total(a) - total(b));
  let h = '<table class="sb"><tr><th></th>';
  for (let i = 0; i < S.holes; i++) h += `<th class="${i === curIdx ? 'cur' : ''}">${i + 1}</th>`;
  h += '<th>Total</th></tr>';
  for (const p of ps) {
    h += `<tr class="${p.id === S.myId ? 'me' : ''}"><td class="n"><span class="dot" style="background:${p.color}"></span> ${esc(p.name)}</td>`;
    for (let i = 0; i < S.holes; i++) {
      const s = i < played ? p.scores[i] : '';
      h += `<td class="${i === curIdx ? 'cur' : ''}">${s ?? ''}${i < played && p.first[i] ? '<span class="star">★</span>' : ''}</td>`;
    }
    h += `<td><b>${total(p)}</b></td></tr>`;
  }
  return h + '</table><div class="sub" style="margin:0">Fewest strokes wins · <span class="star">★</span> first to sink = −1 bonus · unfinished = ' + C.MAX_STROKES + '</div>';
}

function showBoard(final) {
  show('board');
  $('boardTitle').textContent = final ? 'Final Scores' : `Hole ${S.holeIdx + 1} complete`;
  $('boardTable').innerHTML = boardHTML(S.holeIdx, S.holeIdx + 1);
  $('endCtl').classList.toggle('hidden', !final);
  $('againBtn').classList.toggle('hidden', !S.isHost);
  $('lobbyBtn').classList.toggle('hidden', !S.isHost);
  if (final) {
    const ps = [...S.players].sort((a, b) => total(a) - total(b));
    const best = total(ps[0]); const winners = ps.filter(p => total(p) === best).map(p => p.name);
    $('boardMsg').textContent = `🏆 ${winners.join(' & ')} win${winners.length > 1 ? '' : 's'}!` + (S.isHost ? '' : ' — waiting for host…');
    SFX.play('win');
  } else S.boardEndsAt = performance.now() + HOLE_END_SECS * 1000;
}

// ---------------------------------------------------------------- networking
function makeCode() { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)]; return s; }
async function loadPeer() { const m = await import('peerjs'); return m.Peer || m.default; }

function send(conn, m) { try { if (conn && conn.open) conn.send(m); } catch (e) { console.warn('send failed', e); } }
function broadcast(m, loopback = true) {
  for (const c of S.conns.values()) send(c, m);
  if (loopback) onMessage(m);
}
const lobbyMsg = () => ({ t: 'lobby', players: pubPlayers(), code: S.code });

async function createRoom() {
  $('menuErr').textContent = 'Connecting to PeerJS server…';
  let Peer;
  try { Peer = await loadPeer(); } catch (e) { $('menuErr').textContent = 'Could not load PeerJS from CDN.'; return; }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const ok = await new Promise(res => {
      const peer = new Peer(ROOM_PREFIX + code);
      const to = setTimeout(() => { peer.destroy(); res(false); }, 10000);
      peer.on('open', () => { clearTimeout(to); S.peer = peer; S.code = code; res(true); });
      peer.on('error', e => { clearTimeout(to); console.warn('peer error', e.type); if (!S.peer) { peer.destroy(); res(e.type === 'unavailable-id' ? false : null); } });
    });
    if (ok) break;
    if (ok === null) { $('menuErr').textContent = 'PeerJS server unreachable. Try Quick Play.'; return; }
  }
  if (!S.peer) { $('menuErr').textContent = 'Could not create room. Try again.'; return; }
  $('menuErr').textContent = '';
  S.isHost = true; S.online = true; S.myId = 'host'; S.name = readName();
  S.players = [newPlayer('host', S.name, false)];
  S.peer.on('connection', conn => {
    conn.on('data', d => hostOnData(conn, d));
    conn.on('close', () => hostDrop(conn.peer));
    conn.on('error', () => hostDrop(conn.peer));
  });
  S.peer.on('disconnected', () => { try { S.peer.reconnect(); } catch { } });
  S.phase = 'lobby'; S.screen = 'lobby'; show('lobby'); renderLobby();
}

async function joinRoom() {
  const code = ($('codeIn').value || '').trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { $('menuErr').textContent = 'Enter the 4-letter room code.'; return; }
  $('menuErr').textContent = 'Connecting…';
  let Peer;
  try { Peer = await loadPeer(); } catch (e) { $('menuErr').textContent = 'Could not load PeerJS from CDN.'; return; }
  S.name = readName();
  const peer = new Peer(); S.peer = peer;
  const fail = msg => { if (S.screen !== 'menu') return; $('menuErr').textContent = msg; cleanupNet(); };
  const to = setTimeout(() => fail('Timed out connecting to room ' + code + '.'), 15000);
  peer.on('error', e => { clearTimeout(to); if (S.screen === 'menu') fail(e.type === 'peer-unavailable' ? 'Room ' + code + ' not found.' : 'Connection error: ' + e.type); });
  peer.on('open', id => {
    S.myId = id;
    const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
    S.hostConn = conn;
    conn.on('open', () => {
      clearTimeout(to); $('menuErr').textContent = '';
      S.isHost = false; S.online = true; S.code = code;
      send(conn, { t: 'hello', name: S.name });
      S.screen = 'lobby'; show('lobby'); renderLobby();
    });
    conn.on('data', onMessage);
    conn.on('close', () => { if (S.screen !== 'menu') leave('Disconnected from host.'); });
  });
}

function cleanupNet() {
  try { S.peer && S.peer.destroy(); } catch { }
  S.peer = null; S.conns.clear(); S.hostConn = null; S.online = false;
}

function leave(msg) {
  cleanupNet();
  S.isHost = false; S.phase = 'none'; S.screen = 'menu'; S.sim = null; S.csim = null; S.players = []; S.code = '';
  clearCourse();
  $('hud').classList.add('hidden'); $('tabBoard').classList.add('hidden');
  show('menu'); $('menuErr').textContent = msg || '';
}

function newPlayer(id, name, bot) {
  const used = new Set(S.players.map(p => p.color));
  return { id, name, bot, color: COLORS.find(c => !used.has(c)) || '#ccc', scores: [], first: [], skill: 0.55 + Math.random() * 0.4 };
}
const pubPlayers = () => S.players.map(({ id, name, bot, color, scores, first }) => ({ id, name, bot, color, scores, first }));

function hostOnData(conn, m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'hello') {
    if (S.phase !== 'lobby') return send(conn, { t: 'reject', reason: 'Match in progress — try again when the host returns to the lobby.' });
    if (S.players.length >= 8) return send(conn, { t: 'reject', reason: 'Room is full (8 players).' });
    S.conns.set(conn.peer, conn);
    if (!S.players.some(p => p.id === conn.peer)) S.players.push(newPlayer(conn.peer, String(m.name || 'Player').slice(0, 14), false));
    broadcast(lobbyMsg());
  } else if (m.t === 'shot') applyShot(conn.peer, +m.a, +m.p);
  else if (m.t === 'use') useItem(conn.peer);
  else if (m.t === 'ping') send(conn, { t: 'pong', ts: m.ts });
}

function hostDrop(id) {
  if (!S.conns.has(id)) return;
  S.conns.delete(id);
  const p = S.players.find(p => p.id === id);
  if (S.phase === 'lobby') { S.players = S.players.filter(p => p.id !== id); broadcast(lobbyMsg()); }
  else if (p) {
    p.gone = true;
    if (S.sim) { const b = S.sim.balls.get(id); if (b) b.out = true; }
    broadcast({ t: 'ev', msg: `${p.name} left` });
  }
}

// ---------------------------------------------------------------- host game logic
// Pick a seed whose hole a bot can finish, and set par from bot test runs.
function prepareHole(idx) {
  let best = null;
  for (let k = 0; k < 4; k++) {
    const seed = (S.seed + idx * 1013 + k * 7919) >>> 0;
    const hole = C.generateHole(seed, idx);
    const runs = [C.botRun(hole, 0.8), C.botRun(hole, 0.8), C.botRun(hole, 0.8)];
    const ok = runs.filter(r => r !== null);
    const avg = runs.reduce((a, r) => a + (r ?? C.MAX_STROKES), 0) / runs.length;
    const par = Math.max(2, Math.min(6, Math.round(avg)));
    if (ok.length) return { seed, hole, par };
    if (!best) best = { seed, hole, par: hole.par };
  }
  return best;
}

function startMatch() {
  S.players = S.players.filter(p => !p.gone);
  S.players.forEach(p => { p.scores = []; p.first = []; });
  S.seed = params.get('seed') ? (+params.get('seed') >>> 0) : (Math.random() * 1e9) >>> 0;
  S.nextPrep = prepareHole(0);
  startHole(0);
}

function startHole(idx) {
  const prep = S.nextPrep && S.nextPrep.hole.idx === idx ? S.nextPrep : prepareHole(idx);
  S.nextPrep = null;
  const hole = prep.hole; hole.par = prep.par;
  const bs = new Map();
  S.players.forEach((p, i) => { const t = hole.tees[i % hole.tees.length]; const b = C.makeBall(p.id, t.x, t.z, t.y); if (p.gone) b.out = true; bs.set(p.id, b); });
  S.sim = { hole, balls: bs, t: 0, acc: 0, timeLeft: C.HOLE_TIME, first: null, endDelay: 0, snapAcc: 0, bot: new Map(), pick: hole.pickups.map(() => ({ on: true, t: 0 })) };
  S.players.forEach(p => { if (p.bot) S.sim.bot.set(p.id, 1.5 + Math.random() * 2); });
  broadcast({ t: 'hole', seed: prep.seed, idx, holes: S.holes, par: prep.par, players: pubPlayers() });
}

function applyShot(id, a, p) {
  const sim = S.sim; if (!sim || S.phase !== 'playing') return false;
  const b = sim.balls.get(id);
  if (!b || b.sunk || b.out || !C.isResting(b) || !isFinite(a) || !isFinite(p)) return false;
  p = Math.max(0, Math.min(1, p));
  b.lastX = b.x; b.lastY = b.y; b.lastZ = b.z; b.strokes++;
  b.vx = Math.cos(a) * p * C.MAX_SPEED; b.vz = Math.sin(a) * p * C.MAX_SPEED;
  b.fx = 'putt'; b.fxv = 2 + p * 8;
  return true;
}

function useItem(id) {
  const sim = S.sim; if (!sim || S.phase !== 'playing') return;
  const b = sim.balls.get(id); if (!b || !b.item || b.sunk || b.out) return;
  const it = b.item; b.item = 0;
  if (it === 1) { b.big = EFFECT_SECS; C.applyEffects(b); hostEvent(`🔴 ${pname(id)} went BIG!`, 'use', b); }
  else if (it === 2) { b.sticky = EFFECT_SECS; C.applyEffects(b); hostEvent(`🟢 ${pname(id)} is STICKY (can't be pushed)`, 'use', b); }
  else if (it === 3) { C.shockwave([...sim.balls.values()], b); hostEvent(`💥 ${pname(id)} SHOCKWAVE!`, 'shock', b); }
}

function hostEvent(msg, s, b) { broadcast({ t: 'ev', msg, s, x: b ? +b.x.toFixed(2) : 0, y: b ? +b.y.toFixed(2) : 0, z: b ? +b.z.toFixed(2) : 0 }); }

function physicsStep() {
  const sim = S.sim; sim.t += STEP;
  const arr = [...sim.balls.values()];
  for (const b of arr) {
    const ev = C.stepBall(sim.hole, b, sim.t, STEP);
    if (ev === 'water' || ev === 'fell') {
      b.strokes++; b.x = b.lastX; b.y = b.lastY; b.z = b.lastZ; b.vx = b.vy = b.vz = 0; b.air = false;
      hostEvent(ev === 'water' ? `💦 ${pname(b.id)} splashed! +1 stroke` : `🕳️ ${pname(b.id)} fell off! +1 stroke`, ev === 'water' ? 'splash' : 'fell', b);
    } else if (ev === 'sunk') {
      const first = !sim.first; if (first) sim.first = b.id;
      hostEvent(`⛳ ${pname(b.id)} sank it in ${b.strokes}!${first ? ' ★ FIRST (−1)' : ''}`, 'cup', b);
    }
  }
  C.collideBalls(arr);
}

function hostTick(dt) {
  if (!S.isHost || !S.sim) return;
  const sim = S.sim;
  if (S.phase === 'playing') {
    sim.acc += dt;
    let n = 0;
    while (sim.acc >= STEP && n++ < 120) { sim.acc -= STEP; physicsStep(); }
    if (n >= 120) sim.acc = 0;
    sim.timeLeft = Math.max(0, sim.timeLeft - dt);
    const arr = [...sim.balls.values()];
    for (const b of arr) {
      // effects
      if (b.big > 0 || b.sticky > 0) { b.big = Math.max(0, b.big - dt); b.sticky = Math.max(0, b.sticky - dt); C.applyEffects(b); }
      // out of strokes
      if (!b.sunk && !b.out && C.isResting(b) && b.strokes >= C.MAX_STROKES) { b.out = true; hostEvent(`${pname(b.id)} is out of strokes`); }
      // pickups
      if (b.sunk || b.out || b.item) continue;
      sim.hole.pickups.forEach((pk, i) => {
        const st = sim.pick[i];
        if (!st.on || Math.hypot(b.x - pk.x, b.z - pk.z) > 0.55 || Math.abs(b.y - pk.y) > 0.8 || b.item) return;
        st.on = false; st.t = PICKUP_RESPAWN;
        b.item = 1 + Math.floor(Math.random() * 3);
        hostEvent(`🎁 ${pname(b.id)} got ${C.ITEMS[b.item]}`, 'pickup', b);
      });
    }
    sim.pick.forEach(st => { if (!st.on && (st.t -= dt) <= 0) st.on = true; });
    // bots
    for (const p of S.players) {
      if (!p.bot) continue;
      const b = sim.balls.get(p.id); if (!b || b.sunk || b.out) continue;
      if (b.item === 3 && arr.some(o => o !== b && !o.sunk && !o.out && Math.hypot(o.x - b.x, o.z - b.z) < 3.2)) useItem(p.id);
      if (!C.isResting(b)) { sim.bot.delete(p.id); continue; }
      if (!sim.bot.has(p.id)) sim.bot.set(p.id, 0.8 + Math.random() * 1.4);
      const w = sim.bot.get(p.id) - dt; sim.bot.set(p.id, w);
      if (w <= 0) {
        if (b.item === 1 || b.item === 2) useItem(p.id);
        const sh = C.planShot(sim.hole, b, sim.t + 0.05, p.skill); applyShot(p.id, sh.a, sh.p); sim.bot.delete(p.id);
      }
    }
    const allDone = arr.every(b => b.sunk || b.out);
    if ((allDone || sim.timeLeft <= 0) && !sim.endDelay) { sim.endDelay = allDone ? 1.2 : 0.01; if (!allDone) hostEvent('⏰ Time up!'); }
    if (sim.endDelay) { sim.endDelay -= dt; if (sim.endDelay <= 0) endHole(); }
    sim.snapAcc += dt;
    if (sim.snapAcc >= 0.05) { sim.snapAcc = 0; if (S.conns.size) broadcast(snapshot(), false); }
  } else if (S.phase === 'holeEnd') {
    sim.phaseTimer -= dt;
    if (sim.phaseTimer <= 0) {
      if (S.holeIdx + 1 < S.holes) startHole(S.holeIdx + 1);
      else { S.phase = 'matchEnd'; broadcast({ t: 'matchEnd', players: pubPlayers() }); }
    }
  }
}

const r3 = v => Math.round(v * 1000) / 1000;
function snapshot() {
  const sim = S.sim;
  return {
    t: 's', ht: r3(sim.t), tl: r3(sim.timeLeft), pk: sim.pick.map(p => p.on ? 1 : 0),
    b: [...sim.balls.values()].map(b => [b.id, r3(b.x), r3(b.y), r3(b.z), r3(b.vx), r3(b.vy), r3(b.vz),
      (b.sunk ? 1 : 0) | (C.isResting(b) ? 2 : 0) | (b.out ? 4 : 0) | (b.air ? 8 : 0), b.strokes, b.item, r3(b.big), r3(b.sticky)]),
  };
}

function endHole() {
  const sim = S.sim; const idx = S.holeIdx;
  for (const p of S.players) {
    const b = sim.balls.get(p.id);
    p.scores[idx] = b && b.sunk ? Math.min(b.strokes, C.MAX_STROKES) : C.MAX_STROKES;
    p.first[idx] = sim.first === p.id;
  }
  S.phase = 'holeEnd'; sim.phaseTimer = HOLE_END_SECS;
  broadcast({ t: 'holeEnd', players: pubPlayers(), idx });
  // generate + bot-test the next hole while the scoreboard is up
  if (idx + 1 < S.holes) setTimeout(() => { if (S.isHost && S.phase === 'holeEnd') S.nextPrep = prepareHole(idx + 1); }, 300);
}

function backToLobby() {
  if (!S.isHost) return;
  S.players = S.players.filter(p => !p.gone);
  S.phase = 'lobby'; S.sim = null;
  broadcast(lobbyMsg());
}

// ---------------------------------------------------------------- client prediction / reconciliation
function onSnapshot(m) {
  if (!S.csim || !S.hole) return;
  const now = performance.now();
  S.ht = m.ht; S.htAt = now; S.timeLeft = m.tl; S.pick = m.pk || [];
  const lat = Math.min(0.25, S.ping / 2000);
  // server balls, then fast-forward a copy by one-way latency so we compare against "now"
  const srv = m.b.map(([id, x, y, z, vx, vy, vz, f, strokes, item, big, sticky]) => {
    const b = { id, x, y, z, vx, vy, vz, sunk: !!(f & 1), ready: !!(f & 2), out: !!(f & 4), air: !!(f & 8), strokes, item, big, sticky };
    C.applyEffects(b); return b;
  });
  const fw = srv.map(b => ({ ...b }));
  const dt = 1 / 120; let t = m.ht;
  for (let k = 0, n = Math.round(lat / dt); k < n; k++) {
    t += dt;
    for (const b of fw) { if (C.stepBall(S.hole, b, t, dt)) b.hold = true; }
    C.collideBalls(fw);
  }
  const target = m.ht + lat;
  S.csim.t = Math.abs(S.csim.t - target) > 0.5 ? target : S.csim.t + (target - S.csim.t) * 0.3;
  const seen = new Set();
  srv.forEach((s, i) => {
    const f = fw[i]; seen.add(s.id);
    let c = S.csim.balls.get(s.id);
    if (!c) { c = { ...s, hold: false }; S.csim.balls.set(s.id, c); return; }
    const mine = s.id === S.myId;
    const predicting = mine && now < S.pred.until && s.strokes < S.pred.strokes;
    if (!predicting && c.srvStrokes !== undefined && s.strokes > c.srvStrokes && !(mine && s.strokes === S.pred.strokes)) {
      // someone else's shot (or a penalty) — putt sound only if the ball is now moving
      if (Math.hypot(s.vx, s.vz) > 0.5) SFX.play('putt', 0.6 * near(s.x, s.z), s.id);
    }
    c.srvStrokes = s.strokes; c.srvReady = s.ready;
    c.item = s.item; c.big = s.big; c.sticky = s.sticky; c.out = s.out; C.applyEffects(c);
    if (predicting) return;
    c.strokes = s.strokes;
    if (s.sunk) { c.sunk = true; c.x = s.x; c.y = s.y; c.z = s.z; c.vx = c.vy = c.vz = 0; return; }
    if (c.sunk) { if (now - (c.sunkAt || 0) < 700) return; c.sunk = false; }
    const src = f.hold ? s : f;
    c.hold = false;
    const err = Math.hypot(c.x - src.x, c.y - src.y, c.z - src.z);
    if (err > 1.2) Object.assign(c, { x: src.x, y: src.y, z: src.z });
    else { const k = 0.3; c.x += (src.x - c.x) * k; c.y += (src.y - c.y) * k; c.z += (src.z - c.z) * k; }
    c.vx = src.vx; c.vy = src.vy; c.vz = src.vz; c.air = src.air;
  });
  for (const [id, c] of S.csim.balls) if (!seen.has(id)) c.out = true;
}

function clientStep(dt) {
  const cs = S.csim; if (!cs || S.phase !== 'playing') return;
  cs.acc += Math.min(dt, 0.1);
  const arr = [...cs.balls.values()];
  while (cs.acc >= STEP) {
    cs.acc -= STEP; cs.t += STEP;
    for (const b of arr) {
      const ev = C.stepBall(S.hole, b, cs.t, STEP);
      if (ev === 'sunk') b.sunkAt = performance.now();
      else if (ev) { b.hold = true; b.vx = b.vy = b.vz = 0; } // wait for the host to respawn it
    }
    C.collideBalls(arr);
  }
}

// ---------------------------------------------------------------- messages (host loopback + clients)
function onMessage(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'lobby':
      if (!S.isHost) S.players = m.players;
      S.code = m.code || S.code; S.phase = 'lobby';
      if (S.screen !== 'lobby') { clearCourse(); S.csim = null; $('hud').classList.add('hidden'); $('tabBoard').classList.add('hidden'); S.screen = 'lobby'; show('lobby'); }
      renderLobby();
      break;
    case 'reject': leave(m.reason); break;
    case 'hole': {
      if (!S.isHost) S.players = m.players;
      S.holeIdx = m.idx; S.holes = m.holes;
      S.hole = S.isHost ? S.sim.hole : C.generateHole(m.seed, m.idx);
      S.hole.par = m.par;
      S.phase = 'playing'; S.screen = 'game'; S.timeLeft = C.HOLE_TIME; S.ht = 0; S.htAt = performance.now();
      S.pick = S.hole.pickups.map(() => 1); S.pred = { strokes: -1, until: 0 };
      if (!S.isHost) {
        const bs = new Map();
        S.players.forEach((p, i) => { const t = S.hole.tees[i % S.hole.tees.length]; bs.set(p.id, Object.assign(C.makeBall(p.id, t.x, t.z, t.y), { srvReady: true })); });
        S.csim = { balls: bs, t: 0, acc: 0 };
      }
      buildCourse(S.hole); resetCamera(); frame.liveAt = 0;
      show(null); $('hud').classList.remove('hidden');
      toast(`Hole ${m.idx + 1} of ${m.holes} — par ${m.par}`);
      break;
    }
    case 's': if (!S.isHost) onSnapshot(m); break;
    case 'ev':
      toast(m.msg);
      if (m.s) SFX.play(m.s, m.s === 'shock' || m.s === 'cup' ? Math.max(0.35, near(m.x, m.z)) : near(m.x, m.z));
      if (m.s === 'shock') spawnRing(m.x, m.y, m.z);
      break;
    case 'holeEnd': if (!S.isHost) S.players = m.players; S.phase = 'holeEnd'; aimCancel(); showBoard(false); break;
    case 'matchEnd': if (!S.isHost) S.players = m.players; S.phase = 'matchEnd'; aimCancel(); showBoard(true); break;
    case 'pong': S.ping = S.ping ? S.ping * 0.7 + (performance.now() - m.ts) * 0.3 : performance.now() - m.ts; break;
  }
}

// ---------------------------------------------------------------- course rendering
function clearCourse() {
  if (course) {
    scene.remove(course);
    course.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (o.material.map && o.material.map.dispose()); o.material.dispose(); } });
  }
  course = null; moverMeshes = []; pickupMeshes = []; ballMeshes.clear(); aimGroup.visible = false; pullLine.visible = false;
  rings.forEach(r => scene.remove(r.m)); rings = [];
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
function boxMesh(w, h, d, material) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); m.castShadow = true; m.receiveShadow = true; return m; }

function makeLabel(text, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = 'bold 34px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(1.6, 0.4, 1); sp.renderOrder = 10;
  return sp;
}

// Floor of one tile as a height-mapped grid (handles ramps, banks, kickers and gaps)
function tileFloor(hole, t, material) {
  const N = 20, T = C.T, e = 1e-3, pos = [], ok = [], idx = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = t.cx - T / 2 + T * i / N, z = t.cz - T / 2 + T * j / N;
    const h = C.heightAt(hole, Math.min(t.cx + T / 2 - e, Math.max(t.cx - T / 2 + e, x)), Math.min(t.cz + T / 2 - e, Math.max(t.cz - T / 2 + e, z)));
    pos.push(x, h ?? 0, z); ok.push(h !== null);
  }
  const v = (i, j) => j * (N + 1) + i;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1);
    if (ok[a] && ok[c] && ok[b]) idx.push(a, c, b);
    if (ok[b] && ok[c] && ok[d]) idx.push(b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material); m.receiveShadow = true;
  return m;
}

function buildCourse(hole) {
  clearCourse();
  course = new THREE.Group(); scene.add(course);
  const T = C.T;
  ground.position.y = hole.minY - 0.5;
  const minX = Math.min(...hole.tiles.map(t => t.cx)) - T, maxX = Math.max(...hole.tiles.map(t => t.cx)) + T;
  const minZ = Math.min(...hole.tiles.map(t => t.cz)) - T, maxZ = Math.max(...hole.tiles.map(t => t.cz)) + T;
  const dirt = mat('#6b4f35'), pitMat = mat('#21160d');
  for (const t of hole.tiles) {
    const color = t.type === 'ramp' || t.type === 'jump' ? '#57c97a' : t.type === 'bank' ? '#46b86a' : ((t.gx + t.gz) & 1) ? '#3dbb61' : '#35a955';
    course.add(tileFloor(hole, t, mat(color, { side: THREE.DoubleSide })));
    const low = Math.min(t.h0, t.h1) - (t.type === 'jump' ? 1.2 : 0.02);
    const bottom = hole.minY - 0.5;
    const pil = boxMesh(T * 0.995, low - bottom, T * 0.995, t.type === 'jump' ? pitMat : dirt);
    pil.position.set(t.cx, (low + bottom) / 2, t.cz); pil.castShadow = false; course.add(pil);
    if (t.type === 'jump') { // kicker side faces
      for (const s of [-1, 1]) {
        const lat = [-t.d[1] * s * (T / 2 - 0.02), t.d[0] * s * (T / 2 - 0.02)];
        const k = boxMesh(t.d[0] ? 1.5 : 0.04, 0.5, t.d[0] ? 0.04 : 1.5, dirt);
        k.position.set(t.cx + t.d[0] * (-T / 2 + 0.75) + lat[0], t.h0 + 0.0, t.cz + t.d[1] * (-T / 2 + 0.75) + lat[1]); course.add(k);
      }
      const face = boxMesh(t.d[0] ? 0.04 : T, 1.7, t.d[0] ? T : 0.04, pitMat); // kicker front face
      face.position.set(t.cx + t.d[0] * (-T / 2 + 1.5), t.h0 - 0.6, t.cz + t.d[1] * (-T / 2 + 1.5)); course.add(face);
    }
    if (t.type === 'tee') { const tee = boxMesh(T * 0.9, 0.02, 1.8, mat('#8fe3a6')); tee.position.set(t.cx - t.d[0] * 1.1, t.h0 + 0.01, t.cz - t.d[1] * 1.1); if (t.d[0]) tee.rotation.y = Math.PI / 2; course.add(tee); }
  }
  const wallMat = mat('#f1e7d0'), innerMat = mat('#d0773f'), tunMat = mat('#8c8f99');
  for (const w of hole.walls) {
    const m = boxMesh(w.hx * 2, w.y1 - w.y0, w.hz * 2, w.kind === 'inner' ? innerMat : w.kind === 'tunnel' ? tunMat : wallMat);
    m.position.set(w.x, (w.y0 + w.y1) / 2, w.z); course.add(m);
  }
  for (const o of hole.obbs) {
    const m = boxMesh(o.hx * 2, o.y1 - o.y0, o.hz * 2, wallMat);
    m.position.set(o.x, (o.y0 + o.y1) / 2, o.z); m.rotation.y = -o.a; course.add(m);
  }
  const roofMat = new THREE.MeshStandardMaterial({ color: '#7a7f8c', transparent: true, opacity: 0.55, roughness: 0.6 });
  for (const { t, y } of hole.tunnels) {
    const roof = boxMesh(t.d[0] ? 3.6 : T, 0.15, t.d[0] ? T : 3.6, roofMat); roof.castShadow = false;
    roof.position.set(t.cx, y + 0.98, t.cz); course.add(roof);
  }
  const waterMat = new THREE.MeshStandardMaterial({ color: '#2a7fff', transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.1 });
  for (const w of hole.waters) {
    const m = boxMesh(w.hx * 2, 0.03, w.hz * 2, waterMat); m.castShadow = false; m.position.set(w.x, w.y + 0.015, w.z); course.add(m);
  }
  const bumpMat = mat('#e5484d', { emissive: '#400' });
  for (const b of hole.bumpers) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 0.4, 24), bumpMat); m.castShadow = true;
    m.position.set(b.x, b.y + 0.2, b.z); course.add(m);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.6, b.r * 0.6, 0.42, 20), mat('#ffffff')); ring.position.copy(m.position); course.add(ring);
  }
  for (const mv of hole.movers) {
    const g = new THREE.Group();
    const m = boxMesh(mv.hx * 2, 0.35, mv.hz * 2, mat(mv.kind === 'slider' ? '#8b5cf6' : '#f59e0b')); m.position.y = 0.175; g.add(m);
    if (mv.kind === 'spinner') { const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 16), mat('#7c4a03')); hub.position.y = 0.3; g.add(hub); }
    g.position.y = mv.y; course.add(g); moverMeshes.push({ mv, g });
  }
  const pkMat = mat('#facc15', { emissive: '#7a5c00', roughness: 0.4 });
  for (const pk of hole.pickups) {
    const m = boxMesh(0.38, 0.38, 0.38, pkMat); m.position.set(pk.x, pk.y + 0.45, pk.z);
    const q = makeLabel('?', '#ffffff'); q.scale.set(1.2, 0.3, 1); q.position.set(pk.x, pk.y + 0.85, pk.z);
    course.add(m, q); pickupMeshes.push({ m, q, pk });
  }
  const cup = hole.cup;
  const hole3 = new THREE.Mesh(new THREE.CircleGeometry(C.CUP_R, 28), new THREE.MeshBasicMaterial({ color: '#111' }));
  hole3.rotation.x = -Math.PI / 2; hole3.position.set(cup.x, cup.y + 0.006, cup.z); course.add(hole3);
  const ringC = new THREE.Mesh(new THREE.RingGeometry(C.CUP_R, C.CUP_R + 0.05, 28), new THREE.MeshBasicMaterial({ color: '#fff' }));
  ringC.rotation.x = -Math.PI / 2; ringC.position.set(cup.x, cup.y + 0.007, cup.z); course.add(ringC);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 8), mat('#fafafa')); pole.position.set(cup.x, cup.y + 0.8, cup.z); course.add(pole);
  const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(0.6, -0.18); fs.lineTo(0, -0.36);
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(fs), new THREE.MeshStandardMaterial({ color: '#ff3b3b', side: THREE.DoubleSide }));
  flag.position.set(cup.x, cup.y + 1.6, cup.z); course.add(flag);
  const ballGeo = new THREE.SphereGeometry(C.BALL_R, 22, 16);
  for (const p of S.players) {
    const ball = new THREE.Mesh(ballGeo, mat(p.color, { roughness: 0.35 })); ball.castShadow = true;
    const label = makeLabel(p.id === S.myId ? 'YOU' : p.name, p.color);
    course.add(ball, label); ballMeshes.set(p.id, { ball, label });
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, ext = Math.max(maxX - minX, maxZ - minZ) / 2 + 2;
  sun.position.set(cx + 12, 30, cz + 8); sun.target.position.set(cx, 0, cz);
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 80 });
  sun.shadow.camera.updateProjectionMatrix();
}

function spawnRing(x, y, z) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.9 }));
  m.rotation.x = Math.PI / 2; m.position.set(x, y + 0.2, z); scene.add(m); rings.push({ m, t: 0 });
}

function resetCamera() {
  const b = myBall(); if (!b || !S.hole) return;
  const t0 = S.hole.tiles[0];
  controls.target.set(b.x, b.y + b.r, b.z);
  camera.position.set(b.x - t0.d[0] * 7, b.y + 5.5, b.z - t0.d[1] * 7);
  controls.update();
}

// ---------------------------------------------------------------- input: aiming
const aim = { on: false, a: 0, p: 0, hit: new THREE.Vector3() };
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2(); const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function canShoot() {
  const b = myBall(); if (S.phase !== 'playing' || !b || b.sunk || b.out || !C.isResting(b)) return false;
  if (performance.now() < S.shotLock) return false;
  if (S.isHost) return true;
  return b.srvReady && !(performance.now() < S.pred.until && b.srvStrokes < S.pred.strokes);
}
function updateAim(e) {
  const b = myBall(); if (!b) return;
  const y = b.y + b.r;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera); plane.constant = -y;
  if (!raycaster.ray.intersectPlane(plane, aim.hit)) return;
  const dx = b.x - aim.hit.x, dz = b.z - aim.hit.z, len = Math.hypot(dx, dz);
  aim.p = Math.min(1, len / 3.5); aim.a = Math.atan2(dz, dx);
}
function aimCancel() { aim.on = false; aimGroup.visible = false; pullLine.visible = false; $('powerFill').style.width = '0'; }
function shoot(a, p) {
  S.shotLock = performance.now() + 250;
  if (S.isHost) { applyShot(S.myId, a, p); return; }
  // client: predict the shot locally right away, host confirms
  const b = myBall();
  b.lastX = b.x; b.lastY = b.y; b.lastZ = b.z; b.strokes = (b.srvStrokes ?? b.strokes) + 1;
  b.vx = Math.cos(a) * p * C.MAX_SPEED; b.vz = Math.sin(a) * p * C.MAX_SPEED;
  S.pred = { strokes: b.strokes, until: performance.now() + 900 + S.ping * 2 };
  SFX.play('putt', 0.5 + p * 0.5);
  send(S.hostConn, { t: 'shot', a, p });
}
function useMyItem() {
  const b = myBall(); if (!b || !b.item || S.phase !== 'playing') return;
  if (S.isHost) useItem(S.myId); else send(S.hostConn, { t: 'use' });
}
renderer.domElement.addEventListener('pointerdown', e => {
  SFX.initAudio();
  if (e.button === 2 && aim.on) { aimCancel(); return; }
  if (e.button !== 0 || !canShoot()) return;
  aim.on = true; updateAim(e);
});
addEventListener('pointermove', e => { if (aim.on) updateAim(e); });
addEventListener('pointerup', e => {
  if (e.button !== 0 || !aim.on) return;
  updateAim(e); const { a, p } = aim; aimCancel();
  if (p < 0.03 || !canShoot()) return;
  shoot(a, p);
});
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
$('itemSlot').addEventListener('click', useMyItem);

addEventListener('keydown', e => {
  SFX.initAudio();
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter' && e.target.id === 'codeIn') joinRoom(); return; }
  if (e.key === '`' || e.code === 'Backquote') { $('debug').classList.toggle('hidden'); e.preventDefault(); }
  else if (e.key === 'Escape') aimCancel();
  else if (e.key === 'Tab') { e.preventDefault(); if (S.screen === 'game' && S.phase === 'playing') { $('tabBoard').innerHTML = boardHTML(S.holeIdx, S.holeIdx); $('tabBoard').classList.remove('hidden'); } }
  else if (e.key === ' ' || e.key === 'c' || e.key === 'C') { if (S.phase === 'playing') resetCamera(); e.preventDefault(); }
  else if (e.key === 'e' || e.key === 'E') useMyItem();
  else if (e.key === 'm' || e.key === 'M') toast(SFX.toggleMute() ? '🔇 Sound off' : '🔊 Sound on');
});
addEventListener('keyup', e => { if (e.key === 'Tab') $('tabBoard').classList.add('hidden'); });

// ---------------------------------------------------------------- menu buttons
$('quickBtn').onclick = () => {
  SFX.initAudio();
  S.name = readName(); S.isHost = true; S.online = false; S.myId = 'host'; S.code = '';
  S.players = [newPlayer('host', S.name, false)];
  for (let i = 0; i < 3; i++) S.players.push(newPlayer('bot' + i, BOT_NAMES[i], true));
  startMatch();
};
$('createBtn').onclick = () => { SFX.initAudio(); createRoom(); };
$('joinBtn').onclick = () => { SFX.initAudio(); joinRoom(); };
$('addBot').onclick = () => {
  if (S.players.length >= 8) return;
  const n = S.players.filter(p => p.bot).length;
  S.players.push(newPlayer('bot' + Date.now() % 100000 + n, BOT_NAMES[n % BOT_NAMES.length], true));
  broadcast(lobbyMsg());
};
$('remBot').onclick = () => {
  const i = S.players.map(p => p.bot).lastIndexOf(true); if (i < 0) return;
  S.players.splice(i, 1); broadcast(lobbyMsg());
};
$('startBtn').onclick = () => { if (S.players.length >= 2) startMatch(); };
$('leaveLobby').onclick = () => leave();
$('leaveEnd').onclick = () => leave();
$('againBtn').onclick = () => { if (S.isHost) startMatch(); };
$('lobbyBtn').onclick = backToLobby;

// ---------------------------------------------------------------- host ticker (worker-driven so a background host tab keeps simulating)
let lastTick = performance.now();
function tick() { const now = performance.now(); const dt = Math.min(0.25, (now - lastTick) / 1000); lastTick = now; try { hostTick(dt); } catch (e) { console.error(e); } }
try {
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),1000/60)'], { type: 'text/javascript' })));
  w.onmessage = tick;
} catch { setInterval(tick, 1000 / 60); }
setInterval(() => { if (!S.isHost && S.hostConn) send(S.hostConn, { t: 'ping', ts: performance.now() }); }, 1000);

// ---------------------------------------------------------------- render loop
let lastFrame = performance.now(), fpsFrames = 0, fpsAt = performance.now(), fps = 0, lastSec = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  fpsFrames++; if (now - fpsAt > 500) { fps = Math.round(fpsFrames * 1000 / (now - fpsAt)); fpsFrames = 0; fpsAt = now; }

  if (S.screen === 'game' && S.hole) {
    if (S.isHost && S.sim) { S.timeLeft = S.sim.timeLeft; S.ht = S.sim.t; S.htAt = now; S.pick = S.sim.pick.map(p => p.on ? 1 : 0); }
    else { clientStep(dt); if (S.phase === 'playing') S.timeLeft = Math.max(0, S.timeLeft - dt); }
    const ht = S.isHost ? S.ht : (S.csim ? S.csim.t : 0);
    for (const { mv, g } of moverMeshes) { const p = C.moverPose(mv, ht); g.position.x = p.x; g.position.z = p.z; g.rotation.y = -p.a; }
    pickupMeshes.forEach(({ m, q }, i) => { const on = !!S.pick[i]; m.visible = q.visible = on; m.rotation.y += dt * 2; m.rotation.x += dt; });
    const bs = balls();
    for (const [id, { ball, label }] of ballMeshes) {
      const b = bs.get(id);
      const vis = !!b && !b.sunk && !(S.players.find(p => p.id === id)?.gone);
      ball.visible = vis; label.visible = vis;
      if (!b) continue;
      const sc = b.r / C.BALL_R;
      ball.scale.setScalar(sc); ball.position.set(b.x, b.y + b.r, b.z); label.position.set(b.x, b.y + b.r + 0.4, b.z);
      ball.material.emissive.set(b.sticky > 0 ? '#2f7a00' : '#000000');
      // collision / landing sounds from whichever sim we're showing
      if (b.fx) { SFX.play(b.fx, Math.min(1, b.fxv / 8) * near(b.x, b.z), id); b.fx = null; b.fxv = 0; }
    }
    for (const r of rings) { r.t += dt; r.m.scale.setScalar(1 + r.t * 10); r.m.material.opacity = Math.max(0, 0.9 - r.t * 1.8); }
    rings = rings.filter(r => { if (r.t > 0.5) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); return false; } return true; });
    const mb = myBall();
    if (mb) {
      const tgt = new THREE.Vector3(mb.sunk ? S.hole.cup.x : mb.x, (mb.sunk ? S.hole.cup.y : mb.y) + mb.r, mb.sunk ? S.hole.cup.z : mb.z);
      const d = tgt.sub(controls.target).multiplyScalar(Math.min(1, dt * 6));
      controls.target.add(d); camera.position.add(d);
    }
    if (aim.on && mb) {
      const y = mb.y + mb.r, L = 0.5 + aim.p * 4.5;
      aimBar.material.color.setHSL((1 - aim.p) * 0.33, 0.9, 0.5);
      aimGroup.visible = true; aimGroup.position.set(mb.x, y, mb.z); aimGroup.rotation.y = -aim.a;
      aimBar.scale.x = L; aimBar.position.x = L / 2 + 0.1; aimHead.position.x = L + 0.25;
      pullLine.visible = true;
      pullLine.geometry.setFromPoints([new THREE.Vector3(mb.x, y, mb.z), new THREE.Vector3(aim.hit.x, y, aim.hit.z)]);
      $('powerFill').style.width = (aim.p * 100).toFixed(0) + '%';
    }
    const sec = Math.ceil(S.timeLeft);
    if (S.phase === 'playing' && sec !== lastSec && sec <= 5 && sec > 0) SFX.play('tick');
    lastSec = sec;
    updateHud(mb);
  }
  controls.update();
  renderer.render(scene, camera);
  if (!$('debug').classList.contains('hidden') && now - (frame.dbg || 0) > 250) { frame.dbg = now; updateDebug(); }
}
requestAnimationFrame(frame);

function updateHud(mb) {
  $('holeInfo').textContent = `Hole ${S.holeIdx + 1}/${S.holes} · Par ${S.hole.par}`;
  $('strokeInfo').textContent = `Strokes ${mb ? mb.strokes : 0} / ${C.MAX_STROKES}`;
  const tl = Math.ceil(S.timeLeft);
  $('timer').textContent = S.phase === 'playing' ? tl : '';
  $('timer').classList.toggle('low', tl <= 10);
  $('hint').textContent = S.phase !== 'playing' || !mb ? '' : mb.sunk ? 'Sunk! Watch the others…' : mb.out ? 'Out of strokes' :
    aim.on ? 'Release to shoot · right-click/Esc to cancel' : canShoot() ? 'Your shot! Click & drag back from your ball' : 'Ball rolling…';
  if (!frame.liveAt || performance.now() - frame.liveAt > 200) {
    frame.liveAt = performance.now();
    const bs = balls();
    $('live').innerHTML = S.players.map(p => {
      const b = bs.get(p.id);
      const st = !b ? '' : b.sunk ? `${b.strokes} ✓` : b.out ? `${b.strokes} ✗` : b.strokes;
      const fx = !b ? '' : (b.big > 0 ? ' 🔴' : '') + (b.sticky > 0 ? ' 🟢' : '') + (b.item ? ' 🎁' : '');
      return `<div><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === S.myId ? ' (you)' : ''}${fx}<span class="s">${st}</span></div>`;
    }).join('') + `<div style="opacity:.6;font-size:.8rem">Tab: scores · M: sound ${SFX.isMuted() ? 'off' : 'on'}</div>`;
    const slot = $('itemSlot');
    if (mb && (mb.item || mb.big > 0 || mb.sticky > 0)) {
      slot.classList.remove('hidden');
      slot.innerHTML = (mb.item ? `<b>[E]</b> ${C.ITEMS[mb.item]}` : '') +
        (mb.big > 0 ? `<div class="eff">BIG ${Math.ceil(mb.big)}s</div>` : '') + (mb.sticky > 0 ? `<div class="eff">STICKY ${Math.ceil(mb.sticky)}s</div>` : '');
      slot.classList.toggle('ready', !!mb.item);
    } else slot.classList.add('hidden');
  }
  if (S.phase === 'holeEnd' && S.boardEndsAt) $('boardMsg').textContent = `Next hole in ${Math.max(0, Math.ceil((S.boardEndsAt - performance.now()) / 1000))}…`;
}

function updateDebug() {
  const role = S.isHost ? (S.online ? 'host' : 'offline host') : 'client (predicting)';
  $('debug').textContent =
    `FPS     ${fps}\n` +
    `Ping    ${S.isHost ? '0 ms (you are host)' : Math.round(S.ping) + ' ms'}\n` +
    `Players ${S.players.length} (${S.players.filter(p => p.bot).length} bots, ${S.isHost ? S.conns.size : '?'} remote)\n` +
    `Role    ${role}${S.code ? ' · room ' + S.code : ''}\n` +
    `Phase   ${S.phase} · hole ${S.holeIdx + 1}/${S.holes} · par ${S.hole ? S.hole.par : '-'}\n` +
    `Seed    ${S.hole ? S.hole.seed : S.seed}`;
}

window.__golf = { S, C, applyShot, useItem, balls };
