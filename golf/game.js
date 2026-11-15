// Mini-Golf Battle — main game (rendering, UI, host-authoritative networking via PeerJS, bots)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as C from './course.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const HOLES = Math.max(1, Math.min(9, parseInt(params.get('holes')) || 9));
const ROOM_PREFIX = 'mgbgolf-';
const COLORS = ['#ffffff', '#ff5c5c', '#4dabff', '#ffd43b', '#b57bff', '#ff9f43', '#2ee6a8', '#ff7ad9'];
const BOT_NAMES = ['Birdie Bot', 'Bogey Bot', 'Caddy Bot', 'Putter Bot', 'Eagle Bot', 'Chip Bot', 'Wedge Bot'];
const STEP = 1 / 240;
const HOLE_END_SECS = 6;

// ---------------------------------------------------------------- state
const S = {
  screen: 'menu', isHost: false, online: false, myId: 'host', name: 'Player', code: '',
  players: [], phase: 'none', holeIdx: 0, seed: 0, holes: HOLES, hole: null,
  sim: null,             // host only: {balls: Map, t, acc, timeLeft, first, endDelay, snapAcc}
  view: new Map(),       // id -> {x,z,tx,tz,vx,vz,sunk,out,ready,strokes}
  timeLeft: C.HOLE_TIME, ht: 0, htAt: 0,
  peer: null, conns: new Map(), hostConn: null, ping: 0, pendingShot: 0,
  boardEndsAt: 0,
};

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

let course = null;            // THREE.Group for the hole
let moverMeshes = [];
const ballMeshes = new Map(); // id -> {ball, label}
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

try { $('nameIn').value = localStorage.getItem('mgb-name') || ''; } catch { }
function readName() {
  const n = ($('nameIn').value || '').trim().slice(0, 14) || 'Player';
  try { localStorage.setItem('mgb-name', n); } catch { }
  return n;
}

function renderLobby() {
  $('roomCode').textContent = S.code || '----';
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
  if (final) {
    const ps = [...S.players].sort((a, b) => total(a) - total(b));
    const best = total(ps[0]); const winners = ps.filter(p => total(p) === best).map(p => p.name);
    $('boardMsg').textContent = `🏆 ${winners.join(' & ')} win${winners.length > 1 ? '' : 's'}!` + (S.isHost ? '' : ' — waiting for host to Play Again…');
  } else S.boardEndsAt = performance.now() + HOLE_END_SECS * 1000;
}

// ---------------------------------------------------------------- networking
function makeCode() { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)]; return s; }
async function loadPeer() { const m = await import('peerjs'); return m.Peer || m.default; }

function send(conn, m) { try { if (conn.open) conn.send(m); } catch (e) { console.warn('send failed', e); } }
function broadcast(m, loopback = true) {
  for (const c of S.conns.values()) send(c, m);
  if (loopback) onMessage(m);
}

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
  S.isHost = false; S.phase = 'none'; S.screen = 'menu'; S.sim = null; S.players = []; S.code = '';
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
    if (S.phase !== 'lobby') return send(conn, { t: 'reject', reason: 'Match already in progress.' });
    if (S.players.length >= 8) return send(conn, { t: 'reject', reason: 'Room is full (8 players).' });
    S.conns.set(conn.peer, conn);
    if (!S.players.some(p => p.id === conn.peer)) S.players.push(newPlayer(conn.peer, String(m.name || 'Player').slice(0, 14), false));
    broadcast({ t: 'lobby', players: pubPlayers(), code: S.code });
  } else if (m.t === 'shot') applyShot(conn.peer, +m.a, +m.p);
  else if (m.t === 'ping') send(conn, { t: 'pong', ts: m.ts });
}

function hostDrop(id) {
  if (!S.conns.has(id)) return;
  S.conns.delete(id);
  const p = S.players.find(p => p.id === id);
  if (S.phase === 'lobby') { S.players = S.players.filter(p => p.id !== id); broadcast({ t: 'lobby', players: pubPlayers(), code: S.code }); }
  else if (p) {
    p.gone = true;
    if (S.sim) { const b = S.sim.balls.get(id); if (b) b.out = true; }
    broadcast({ t: 'ev', msg: `${p.name} left` });
  }
}

// ---------------------------------------------------------------- host game logic
function startMatch() {
  S.players = S.players.filter(p => !p.gone);
  S.players.forEach(p => { p.scores = []; p.first = []; });
  S.seed = (Math.random() * 1e9) >>> 0;
  startHole(0);
}

function startHole(idx) {
  const hole = C.generateHole(S.seed + idx * 1013, idx);
  const balls = new Map();
  S.players.forEach((p, i) => { const t = hole.tees[i % hole.tees.length]; balls.set(p.id, C.makeBall(p.id, t.x, t.z)); });
  S.sim = { hole, balls, t: 0, acc: 0, timeLeft: C.HOLE_TIME, first: null, endDelay: 0, snapAcc: 0, bot: new Map() };
  S.players.forEach(p => { if (p.bot) S.sim.bot.set(p.id, 1.5 + Math.random() * 2); });
  broadcast({ t: 'hole', seed: S.seed, idx, holes: S.holes, players: pubPlayers() });
}

function applyShot(id, a, p) {
  const sim = S.sim; if (!sim || S.phase !== 'playing') return;
  const b = sim.balls.get(id);
  if (!b || b.sunk || b.out || !C.isResting(b) || !isFinite(a) || !isFinite(p)) return;
  p = Math.max(0, Math.min(1, p));
  b.lastX = b.x; b.lastZ = b.z; b.strokes++;
  b.vx = Math.cos(a) * p * C.MAX_SPEED; b.vz = Math.sin(a) * p * C.MAX_SPEED;
}

function hostEvent(msg) { broadcast({ t: 'ev', msg }); }

function physicsStep() {
  const sim = S.sim; sim.t += STEP;
  const arr = [...sim.balls.values()];
  for (const b of arr) {
    const ev = C.stepBall(sim.hole, b, sim.t, STEP);
    if (ev === 'water') {
      b.strokes++; b.x = b.lastX; b.z = b.lastZ; b.vx = b.vz = 0;
      hostEvent(`💦 ${pname(b.id)} splashed! +1 stroke`);
    } else if (ev === 'sunk') {
      const first = !sim.first; if (first) sim.first = b.id;
      hostEvent(`⛳ ${pname(b.id)} sank it in ${b.strokes}!${first ? ' ★ FIRST (−1)' : ''}`);
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
    // out of strokes
    for (const b of sim.balls.values()) {
      if (!b.sunk && !b.out && C.isResting(b) && b.strokes >= C.MAX_STROKES) { b.out = true; hostEvent(`${pname(b.id)} is out of strokes`); }
    }
    // bots
    for (const p of S.players) {
      if (!p.bot) continue;
      const b = sim.balls.get(p.id); if (!b || b.sunk || b.out) continue;
      if (!C.isResting(b)) { sim.bot.delete(p.id); continue; }
      if (!sim.bot.has(p.id)) sim.bot.set(p.id, 0.8 + Math.random() * 1.4);
      const w = sim.bot.get(p.id) - dt; sim.bot.set(p.id, w);
      if (w <= 0) { const sh = C.planShot(sim.hole, b, sim.t + 0.05, p.skill); applyShot(p.id, sh.a, sh.p); sim.bot.delete(p.id); }
    }
    const allDone = [...sim.balls.values()].every(b => b.sunk || b.out);
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

function snapshot() {
  const sim = S.sim; const r = v => Math.round(v * 1000) / 1000;
  return {
    t: 's', ht: r(sim.t), tl: r(sim.timeLeft),
    b: [...sim.balls.values()].map(b => [b.id, r(b.x), r(b.z), r(b.vx), r(b.vz), (b.sunk ? 1 : 0) | (C.isResting(b) ? 2 : 0) | (b.out ? 4 : 0), b.strokes]),
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
}

// ---------------------------------------------------------------- messages (host loopback + clients)
function onMessage(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'lobby': if (!S.isHost) S.players = m.players; S.code = m.code || S.code; S.phase = 'lobby'; if (S.screen === 'lobby') renderLobby(); break;
    case 'reject': leave(m.reason); break;
    case 'hole': {
      if (!S.isHost) S.players = m.players; S.seed = m.seed; S.holeIdx = m.idx; S.holes = m.holes;
      S.hole = S.isHost ? S.sim.hole : C.generateHole(m.seed + m.idx * 1013, m.idx);
      S.phase = 'playing'; S.screen = 'game'; S.timeLeft = C.HOLE_TIME; S.ht = 0; S.htAt = performance.now();
      S.view.clear();
      S.players.forEach((p, i) => { const t = S.hole.tees[i % S.hole.tees.length]; S.view.set(p.id, { x: t.x, z: t.z, tx: t.x, tz: t.z, vx: 0, vz: 0, sunk: false, out: false, ready: true, strokes: 0 }); });
      buildCourse(S.hole); resetCamera(); frame.liveAt = 0;
      show(null); $('hud').classList.remove('hidden');
      toast(`Hole ${m.idx + 1} of ${m.holes} — par ${S.hole.par}`);
      break;
    }
    case 's': {
      if (S.isHost) break;
      S.ht = m.ht; S.htAt = performance.now(); S.timeLeft = m.tl;
      const seen = new Set();
      for (const [id, x, z, vx, vz, f, st] of m.b) {
        seen.add(id);
        let v = S.view.get(id); if (!v) { v = { x, z }; S.view.set(id, v); }
        Object.assign(v, { tx: x, tz: z, vx, vz, sunk: !!(f & 1), ready: !!(f & 2), out: !!(f & 4), strokes: st, at: performance.now() });
        if (v.sunk) { v.x = x; v.z = z; }
        if (Math.hypot(v.x - x, v.z - z) > 3) { v.x = x; v.z = z; } // teleport (water respawn)
      }
      for (const id of S.view.keys()) if (!seen.has(id)) S.view.get(id).out = true;
      break;
    }
    case 'ev': toast(m.msg); break;
    case 'holeEnd': if (!S.isHost) S.players = m.players; S.phase = 'holeEnd'; aimCancel(); showBoard(false); break;
    case 'matchEnd': if (!S.isHost) S.players = m.players; S.phase = 'matchEnd'; aimCancel(); showBoard(true); break;
    case 'pong': S.ping = performance.now() - m.ts; break;
  }
}

// ---------------------------------------------------------------- course rendering
function clearCourse() {
  if (course) {
    scene.remove(course);
    course.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (o.material.map && o.material.map.dispose()); o.material.dispose(); } });
  }
  course = null; moverMeshes = []; ballMeshes.clear(); aimGroup.visible = false; pullLine.visible = false;
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

function buildCourse(hole) {
  clearCourse();
  course = new THREE.Group(); scene.add(course);
  const T = C.T;
  const minX = Math.min(...hole.tiles.map(t => t.cx)) - T, maxX = Math.max(...hole.tiles.map(t => t.cx)) + T;
  const minZ = Math.min(...hole.tiles.map(t => t.cz)) - T, maxZ = Math.max(...hole.tiles.map(t => t.cz)) + T;
  for (const t of hole.tiles) {
    const rise = t.h1 - t.h0;
    const color = t.type === 'ramp' ? '#57c97a' : ((t.gx + t.gz) & 1) ? '#3dbb61' : '#35a955';
    let m;
    if (rise) {
      const L = Math.hypot(T, rise), th = Math.atan(rise / T);
      m = t.d[0] ? boxMesh(L, 0.4, T, mat(color)) : boxMesh(T, 0.4, L, mat(color));
      m.rotation.z = t.d[0] * th; m.rotation.x = -t.d[1] * th;
    } else m = boxMesh(T, 0.4, T, mat(color));
    m.castShadow = false;
    m.position.set(t.cx, (t.h0 + t.h1) / 2 - 0.2, t.cz);
    // support pillar so raised tiles don't float
    const low = Math.min(t.h0, t.h1);
    if (low > -0.5) { const pil = boxMesh(T * 0.98, low + 1.0, T * 0.98, mat('#6b4f35')); pil.position.set(t.cx, (low - 0.4 - 1.2) / 2, t.cz); pil.castShadow = false; course.add(pil); }
    course.add(m);
    if (t.type === 'tee') { const tee = boxMesh(T * 0.9, 0.02, 1.8, mat('#8fe3a6')); tee.position.set(t.cx - t.d[0] * 1.1, t.h0 + 0.01, t.cz - t.d[1] * 1.1); if (!t.d[0]) tee.rotation.y = 0; else tee.rotation.y = Math.PI / 2; course.add(tee); }
  }
  const wallMat = mat('#f1e7d0'), innerMat = mat('#d0773f');
  for (const w of hole.walls) {
    const m = boxMesh(w.hx * 2, w.y1 - w.y0, w.hz * 2, w.kind === 'inner' ? innerMat : wallMat);
    m.position.set(w.x, (w.y0 + w.y1) / 2, w.z); course.add(m);
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
  const cup = hole.cup;
  const hole3 = new THREE.Mesh(new THREE.CircleGeometry(C.CUP_R, 28), new THREE.MeshBasicMaterial({ color: '#111' }));
  hole3.rotation.x = -Math.PI / 2; hole3.position.set(cup.x, cup.y + 0.006, cup.z); course.add(hole3);
  const ringC = new THREE.Mesh(new THREE.RingGeometry(C.CUP_R, C.CUP_R + 0.05, 28), new THREE.MeshBasicMaterial({ color: '#fff' }));
  ringC.rotation.x = -Math.PI / 2; ringC.position.set(cup.x, cup.y + 0.007, cup.z); course.add(ringC);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 8), mat('#fafafa')); pole.position.set(cup.x, cup.y + 0.8, cup.z); course.add(pole);
  const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(0.6, -0.18); fs.lineTo(0, -0.36);
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(fs), new THREE.MeshStandardMaterial({ color: '#ff3b3b', side: THREE.DoubleSide }));
  flag.position.set(cup.x, cup.y + 1.6, cup.z); course.add(flag);
  // balls
  const ballGeo = new THREE.SphereGeometry(C.BALL_R, 22, 16);
  for (const p of S.players) {
    const ball = new THREE.Mesh(ballGeo, mat(p.color, { roughness: 0.35 })); ball.castShadow = true;
    const label = makeLabel(p.id === S.myId ? 'YOU' : p.name, p.color);
    course.add(ball, label); ballMeshes.set(p.id, { ball, label });
  }
  // light / shadow bounds
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, ext = Math.max(maxX - minX, maxZ - minZ) / 2 + 2;
  sun.position.set(cx + 12, 30, cz + 8); sun.target.position.set(cx, 0, cz);
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 80 });
  sun.shadow.camera.updateProjectionMatrix();
}

function myView() { return S.view.get(S.myId); }
function ballY(x, z) { return S.hole ? C.heightAt(S.hole, x, z) + C.BALL_R : C.BALL_R; }

function resetCamera() {
  const v = myView(); if (!v || !S.hole) return;
  const t0 = S.hole.tiles[0];
  const y = ballY(v.x, v.z);
  controls.target.set(v.x, y, v.z);
  camera.position.set(v.x - t0.d[0] * 7, y + 5.5, v.z - t0.d[1] * 7);
  controls.update();
}

// ---------------------------------------------------------------- input: aiming
const aim = { on: false, a: 0, p: 0, hit: new THREE.Vector3() };
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2(); const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function canShoot() {
  const v = myView();
  return S.phase === 'playing' && v && v.ready && !v.sunk && !v.out && performance.now() > S.pendingShot;
}
function updateAim(e) {
  const v = myView(); if (!v) return;
  const y = ballY(v.x, v.z);
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera); plane.constant = -y;
  if (!raycaster.ray.intersectPlane(plane, aim.hit)) return;
  const dx = v.x - aim.hit.x, dz = v.z - aim.hit.z, len = Math.hypot(dx, dz);
  aim.p = Math.min(1, len / 3.5); aim.a = Math.atan2(dz, dx);
}
function aimCancel() { aim.on = false; aimGroup.visible = false; pullLine.visible = false; $('powerFill').style.width = '0'; }
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button === 2 && aim.on) { aimCancel(); return; }
  if (e.button !== 0 || !canShoot()) return;
  aim.on = true; updateAim(e);
});
addEventListener('pointermove', e => { if (aim.on) updateAim(e); });
addEventListener('pointerup', e => {
  if (e.button !== 0 || !aim.on) return;
  updateAim(e); const { a, p } = aim; aimCancel();
  if (p < 0.03 || !canShoot()) return;
  S.pendingShot = performance.now() + 400;
  const v = myView(); v.ready = false;
  if (S.isHost) applyShot(S.myId, a, p); else send(S.hostConn, { t: 'shot', a, p });
});
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter' && e.target.id === 'codeIn') joinRoom(); return; }
  if (e.key === '`' || e.code === 'Backquote') { $('debug').classList.toggle('hidden'); e.preventDefault(); }
  else if (e.key === 'Escape') aimCancel();
  else if (e.key === 'Tab') { e.preventDefault(); if (S.screen === 'game' && S.phase === 'playing') { $('tabBoard').innerHTML = boardHTML(S.holeIdx, S.holeIdx); $('tabBoard').classList.remove('hidden'); } }
  else if (e.key === ' ' || e.key === 'c' || e.key === 'C') { if (S.phase === 'playing') resetCamera(); e.preventDefault(); }
});
addEventListener('keyup', e => { if (e.key === 'Tab') $('tabBoard').classList.add('hidden'); });

// ---------------------------------------------------------------- menu buttons
$('quickBtn').onclick = () => {
  S.name = readName(); S.isHost = true; S.online = false; S.myId = 'host'; S.code = '';
  S.players = [newPlayer('host', S.name, false)];
  for (let i = 0; i < 3; i++) S.players.push(newPlayer('bot' + i, BOT_NAMES[i], true));
  startMatch();
};
$('createBtn').onclick = createRoom;
$('joinBtn').onclick = joinRoom;
$('addBot').onclick = () => {
  if (S.players.length >= 8) return;
  const n = S.players.filter(p => p.bot).length;
  S.players.push(newPlayer('bot' + Date.now() % 100000 + n, BOT_NAMES[n % BOT_NAMES.length], true));
  broadcast({ t: 'lobby', players: pubPlayers(), code: S.code });
};
$('remBot').onclick = () => {
  const i = S.players.map(p => p.bot).lastIndexOf(true); if (i < 0) return;
  S.players.splice(i, 1); broadcast({ t: 'lobby', players: pubPlayers(), code: S.code });
};
$('startBtn').onclick = () => { if (S.players.length >= 2) startMatch(); };
$('leaveLobby').onclick = () => leave();
$('leaveEnd').onclick = () => leave();
$('againBtn').onclick = () => { if (S.isHost) startMatch(); };

// ---------------------------------------------------------------- host ticker (worker-driven so a background host tab keeps simulating)
let lastTick = performance.now();
function tick() { const now = performance.now(); const dt = Math.min(0.25, (now - lastTick) / 1000); lastTick = now; try { hostTick(dt); } catch (e) { console.error(e); } }
try {
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),1000/60)'], { type: 'text/javascript' })));
  w.onmessage = tick;
} catch { setInterval(tick, 1000 / 60); }
setInterval(() => { if (!S.isHost && S.hostConn) send(S.hostConn, { t: 'ping', ts: performance.now() }); }, 1000);

// ---------------------------------------------------------------- render loop
let lastFrame = performance.now(), fpsFrames = 0, fpsAt = performance.now(), fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  fpsFrames++; if (now - fpsAt > 500) { fps = Math.round(fpsFrames * 1000 / (now - fpsAt)); fpsFrames = 0; fpsAt = now; }

  if (S.screen === 'game' && S.hole) {
    // update view state
    if (S.isHost && S.sim) {
      S.timeLeft = S.sim.timeLeft; S.ht = S.sim.t; S.htAt = now;
      for (const [id, b] of S.sim.balls) {
        const v = S.view.get(id); if (!v) continue;
        Object.assign(v, { x: b.x, z: b.z, vx: b.vx, vz: b.vz, sunk: b.sunk, out: b.out, ready: C.isResting(b), strokes: b.strokes });
      }
    } else {
      for (const v of S.view.values()) {
        if (v.tx === undefined) continue;
        const age = Math.min(0.15, (now - (v.at || now)) / 1000);
        const px = v.tx + v.vx * age, pz = v.tz + v.vz * age, k = Math.min(1, dt * 18);
        v.x += (px - v.x) * k; v.z += (pz - v.z) * k;
      }
    }
    const ht = S.isHost ? S.ht : S.ht + (now - S.htAt) / 1000;
    for (const { mv, g } of moverMeshes) { const p = C.moverPose(mv, ht); g.position.x = p.x; g.position.z = p.z; g.rotation.y = -p.a; }
    for (const [id, { ball, label }] of ballMeshes) {
      const v = S.view.get(id);
      const vis = !!v && !v.sunk && !(S.players.find(p => p.id === id)?.gone);
      ball.visible = vis; label.visible = vis;
      if (!v) continue;
      const y = ballY(v.x, v.z);
      ball.position.set(v.x, y, v.z); label.position.set(v.x, y + 0.5, v.z);
    }
    // camera follow
    const mv = myView();
    if (mv) {
      const tgt = new THREE.Vector3(mv.sunk ? S.hole.cup.x : mv.x, ballY(mv.x, mv.z), mv.sunk ? S.hole.cup.z : mv.z);
      const d = tgt.sub(controls.target).multiplyScalar(Math.min(1, dt * 6));
      controls.target.add(d); camera.position.add(d);
    }
    // aim visuals
    if (aim.on && mv) {
      const y = ballY(mv.x, mv.z), L = 0.5 + aim.p * 4.5;
      const col = new THREE.Color().setHSL((1 - aim.p) * 0.33, 0.9, 0.5);
      aimBar.material.color.copy(col);
      aimGroup.visible = true; aimGroup.position.set(mv.x, y, mv.z); aimGroup.rotation.y = -aim.a;
      aimBar.scale.x = L; aimBar.position.x = L / 2 + 0.1; aimHead.position.x = L + 0.25;
      pullLine.visible = true;
      pullLine.geometry.setFromPoints([new THREE.Vector3(mv.x, y, mv.z), new THREE.Vector3(aim.hit.x, y, aim.hit.z)]);
      $('powerFill').style.width = (aim.p * 100).toFixed(0) + '%';
    }
    updateHud(mv);
  }
  controls.update();
  renderer.render(scene, camera);
  if (!$('debug').classList.contains('hidden') && now - (frame.dbg || 0) > 250) { frame.dbg = now; updateDebug(); }
}
requestAnimationFrame(frame);

function updateHud(mv) {
  $('holeInfo').textContent = `Hole ${S.holeIdx + 1}/${S.holes} · Par ${S.hole.par}`;
  $('strokeInfo').textContent = `Strokes ${mv ? mv.strokes : 0} / ${C.MAX_STROKES}`;
  const tl = Math.ceil(S.timeLeft);
  $('timer').textContent = S.phase === 'playing' ? tl : '';
  $('timer').classList.toggle('low', tl <= 10);
  $('hint').textContent = S.phase !== 'playing' ? '' : !mv ? '' : mv.sunk ? 'Sunk! Watch the others…' : mv.out ? 'Out of strokes' :
    aim.on ? 'Release to shoot · right-click/Esc to cancel' : canShoot() ? 'Your shot! Click & drag back from your ball' : 'Ball rolling…';
  if (!frame.liveAt || performance.now() - frame.liveAt > 200) {
    frame.liveAt = performance.now();
    $('live').innerHTML = S.players.map(p => {
      const v = S.view.get(p.id);
      const st = !v ? '' : v.sunk ? `${v.strokes} ✓` : v.out ? `${v.strokes} ✗` : v.strokes;
      return `<div><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === S.myId ? ' (you)' : ''}<span class="s">${st}</span></div>`;
    }).join('') + '<div style="opacity:.6;font-size:.8rem">Hold Tab: scoreboard</div>';
  }
  if (S.phase === 'holeEnd' && S.boardEndsAt) $('boardMsg').textContent = `Next hole in ${Math.max(0, Math.ceil((S.boardEndsAt - performance.now()) / 1000))}…`;
}

function updateDebug() {
  const role = S.isHost ? (S.online ? 'host' : 'offline host') : 'client';
  $('debug').textContent =
    `FPS     ${fps}\n` +
    `Ping    ${S.isHost ? '0 ms (you are host)' : Math.round(S.ping) + ' ms'}\n` +
    `Players ${S.players.length} (${S.players.filter(p => p.bot).length} bots, ${S.isHost ? S.conns.size : '?'} remote)\n` +
    `Role    ${role}${S.code ? ' · room ' + S.code : ''}\n` +
    `Phase   ${S.phase} · hole ${S.holeIdx + 1}/${S.holes}\n` +
    `Seed    ${S.seed}`;
}

// expose for debugging/tests
window.__golf = { S, C, applyShot };
