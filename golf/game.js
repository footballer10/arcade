// Mini-Golf Battle — main game: rendering, UI, host-authoritative networking (PeerJS), bots,
// client-side prediction, power-ups, game modes, modifiers, emotes, podium
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as C from './course.js';
import * as SFX from './sfx.js';
import * as G from './gfx.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM_PREFIX = 'mgbgolf-';
const COLORS = ['#ffffff', '#ff5c5c', '#4dabff', '#ffd43b', '#b57bff', '#ff9f43', '#2ee6a8', '#ff7ad9', '#9ae66e', '#5ce1e6'];
const BOT_NAMES = ['Birdie Bot', 'Bogey Bot', 'Caddy Bot', 'Putter Bot', 'Eagle Bot', 'Chip Bot', 'Wedge Bot'];
const EMOTES = ['😂', '😡', '👏 Nice!', '😱 Oops!'];
const PLACE_PTS = [10, 7, 5, 4, 3, 2, 1, 1];
const STEP = 1 / 240, HOLE_END_SECS = 6, INTRO_SECS = 3.0;
const ITEM_RESPAWN = { normal: 12, chaos: 4 };
const BOT_SKILL = { easy: [0.2, 0.45], normal: [0.55, 0.9], hard: [0.92, 1] };

// ---------------------------------------------------------------- state
const S = {
  screen: 'menu', isHost: false, online: false, myId: 'host', name: 'Player', code: '',
  opts: { mode: 'classic', holes: Math.max(1, Math.min(9, parseInt(params.get('holes')) || 9)), time: 60, items: 'normal', mods: true, bots: 'normal' },
  players: [], phase: 'none', holeIdx: 0, seed: 0, hole: null,
  sim: null,     // host: authoritative simulation
  csim: null,    // client: predicted local copy
  pick: [], mines: [], awards: [],
  timeLeft: 60, peer: null, conns: new Map(), hostConn: null, ping: 0,
  pred: { strokes: -1, until: 0 }, shotLock: 0, introUntil: 0, introFrom: null,
  boardEndsAt: 0, nextPrep: null, themeOrder: [0, 1, 2, 3, 4], spec: null, podium: null, inMatch: false,
  quality: params.get('q') || (() => { try { return localStorage.getItem('mgb-q') || 'high'; } catch { return 'high'; } })(),
  autoQ: !params.get('q'),
};
const balls = () => S.isHost ? (S.sim ? S.sim.balls : new Map()) : (S.csim ? S.csim.balls : new Map());
const myBall = () => balls().get(S.myId);
const speedMode = () => S.opts.mode === 'speed';

// ---------------------------------------------------------------- three.js setup
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfe1f7');
scene.fog = new THREE.Fog('#cde6f5', 70, 230);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1200);
camera.position.set(0, 8, 10);
const controls = new OrbitControls(camera, renderer.domElement);
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.minDistance = 2.5; controls.maxDistance = 45; controls.maxPolarAngle = Math.PI * 0.47;
const hemi = new THREE.HemisphereLight('#d8eeff', '#5b7a3a', 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3dc', 2.6);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
G.initEnv(renderer);
const sky = G.buildSky(scene);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), G.M.grass);
ground.rotation.x = -Math.PI / 2; ground.position.y = -1.2; ground.receiveShadow = true; scene.add(ground);
const fxp = new G.Particles(scene);
const weather = new G.Weather(scene);
let post = null;
try { post = G.makePost(renderer, scene, camera); } catch (e) { console.warn('post-processing unavailable', e); }
const themeCtx = { scene, sun, hemi, sky, renderer, post };
function applyQuality() {
  const hi = S.quality !== 'low';
  renderer.shadowMap.enabled = hi; sun.castShadow = hi;
  renderer.setPixelRatio(hi ? Math.min(2, devicePixelRatio) : 1);
  renderer.setSize(innerWidth, innerHeight); if (post) post.setSize(innerWidth, innerHeight);
  scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); if (post) post.setSize(innerWidth, innerHeight); });

let course = null;
let moverMeshes = [], pickupMeshes = [], rings = [], mineMeshes = [], portalMeshes = [], bubbles = [];
const ballMeshes = new Map(); // id -> {ball, label, trail, sink}
const aimGroup = new THREE.Group();
const aimMat = new THREE.MeshBasicMaterial({ color: '#4ade80' });
const aimDots = []; const dotGeo = new THREE.SphereGeometry(0.05, 10, 6);
for (let i = 0; i < 26; i++) { const d = new THREE.Mesh(dotGeo, aimMat); d.visible = false; aimDots.push(d); aimGroup.add(d); }
const pullLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
aimGroup.visible = false; pullLine.visible = false;
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
const sum = a => (a || []).reduce((x, y) => x + (y || 0), 0);
const total = p => speedMode() ? sum(p.scores) + sum(p.bonus) : sum(p.scores) - sum(p.bonus);
const ranked = () => [...S.players].sort((a, b) => speedMode() ? total(b) - total(a) : total(a) - total(b));
const near = (x, z) => Math.max(0, Math.min(1, 1.25 - Math.hypot(x - controls.target.x, z - controls.target.z) / 22));

try { $('nameIn').value = localStorage.getItem('mgb-name') || ''; } catch { }
function readName() {
  const n = ($('nameIn').value || '').trim().slice(0, 14) || 'Player';
  try { localStorage.setItem('mgb-name', n); } catch { }
  return n;
}

const OPT_LABEL = { mode: { classic: 'Classic (fewest strokes)', speed: 'Speed Golf (race for points)' }, items: { normal: 'Power-ups: normal', chaos: 'Power-ups: CHAOS', off: 'Power-ups: off' }, bots: { easy: 'Bots: easy', normal: 'Bots: normal', hard: 'Bots: hard' } };
function renderLobby() {
  $('roomCode').textContent = S.online ? (S.code || '----') : 'SOLO';
  $('lobbyList').innerHTML = S.players.map(p => `<li data-id="${esc(p.id)}" class="${p.id === S.myId ? 'mine' : ''}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === S.myId ? ' <small>(you — click to change colour)</small>' : ''}<span class="tag">${p.pending ? 'JOINS NEXT HOLE' : p.bot ? 'BOT' : p.id === 'host' ? 'HOST' : ''}</span></li>`).join('');
  $('hostCtl').classList.toggle('hidden', !S.isHost);
  $('waitMsg').classList.toggle('hidden', S.isHost);
  $('waitMsg').textContent = S.inMatch ? 'Match in progress — you will join at the next hole…' : 'Waiting for host to start…';
  $('addBot').disabled = S.players.length >= 8;
  $('remBot').disabled = !S.players.some(p => p.bot);
  $('startBtn').disabled = S.players.length < 2;
  $('startBtn').textContent = S.players.length < 2 ? 'Start Match (need 2+ players — add a bot)' : 'Start Match';
  const o = S.opts;
  for (const k of ['mode', 'holes', 'time', 'items', 'bots']) $('opt_' + k).value = String(o[k]);
  $('opt_mods').value = o.mods ? '1' : '0';
  $('optSummary').textContent = `${OPT_LABEL.mode[o.mode]} · ${o.holes} holes · ${o.time}s per hole · ${OPT_LABEL.items[o.items]} · Modifiers ${o.mods ? 'on' : 'off'} · ${OPT_LABEL.bots[o.bots]}`;
  $('optSummary').classList.toggle('hidden', S.isHost);
}

function boardHTML(curIdx, played) {
  const ps = ranked(), n = S.opts.holes;
  let h = '<table class="sb"><tr><th></th>';
  for (let i = 0; i < n; i++) h += `<th class="${i === curIdx ? 'cur' : ''}">${i + 1}</th>`;
  h += '<th>Total</th></tr>';
  for (const p of ps) {
    h += `<tr class="${p.id === S.myId ? 'me' : ''}"><td class="n"><span class="dot" style="background:${p.color}"></span> ${esc(p.name)}</td>`;
    for (let i = 0; i < n; i++) h += `<td class="${i === curIdx ? 'cur' : ''}">${i < played ? (p.scores[i] ?? '') : ''}${i < played && p.tags[i] ? `<span class="star">${p.tags[i]}</span>` : ''}</td>`;
    h += `<td><b>${total(p)}</b></td></tr>`;
  }
  return h + '</table><div class="sub" style="margin:0">' + (speedMode()
    ? 'Speed Golf: points for finishing order (10·7·5·4…) · 💥 KO +2 · 🎯 hole-in-one +3'
    : `Fewest strokes wins · ★ first to sink −1 · 💥 KO −1 · 🎯 hole-in-one −1 · unfinished = ${C.MAX_STROKES}`) + '</div>';
}

function showBoard(final) {
  show('board');
  $('board').classList.toggle('final', final);
  $('boardTitle').textContent = final ? '🏆 Final Scorecard' : `Hole ${S.holeIdx + 1} complete`;
  $('boardTable').innerHTML = boardHTML(S.holeIdx, S.holeIdx + 1);
  $('endCtl').classList.toggle('hidden', !final);
  $('againBtn').classList.toggle('hidden', !S.isHost);
  $('lobbyBtn').classList.toggle('hidden', !S.isHost);
  $('awards').innerHTML = final ? S.awards.map(a => `<div>${esc(a)}</div>`).join('') : '';
  if (final) {
    const ps = ranked(); const best = total(ps[0]); const winners = ps.filter(p => total(p) === best).map(p => p.name);
    $('boardMsg').textContent = `${winners.join(' & ')} win${winners.length > 1 ? '' : 's'}!` + (S.isHost ? '' : ' — waiting for host…');
    SFX.play('win'); setupPodium();
  } else S.boardEndsAt = performance.now() + HOLE_END_SECS * 1000;
}

function showIntro(hole) {
  const th = G.THEMES[hole.themeIdx], mod = C.MODS[hole.mod].name;
  $('introHole').textContent = `Hole ${hole.idx + 1}`;
  $('introSub').textContent = `Par ${hole.par} · ${th.name}`;
  $('introMod').textContent = mod ? `⚡ ${mod}` : '';
  const el = $('intro'); el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(showIntro.to); showIntro.to = setTimeout(() => el.classList.add('hidden'), INTRO_SECS * 1000);
}

// ---------------------------------------------------------------- networking
function makeCode() { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)]; return s; }
async function loadPeer() { const m = await import('peerjs'); return m.Peer || m.default; }
function send(conn, m) { try { if (conn && conn.open) conn.send(m); } catch (e) { console.warn('send failed', e); } }
function broadcast(m, loopback = true) {
  for (const c of S.conns.values()) send(c, m);
  if (loopback) onMessage(m);
}
const lobbyMsg = (inMatch = false) => ({ t: 'lobby', players: pubPlayers(), code: S.code, opts: S.opts, inMatch });

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
  S.isHost = true; S.online = true; S.myId = 'host'; S.name = readName(); S.inMatch = false;
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
  S.isHost = false; S.phase = 'none'; S.screen = 'menu'; S.sim = null; S.csim = null; S.players = []; S.code = ''; S.hole = null; S.podium = null; S.inMatch = false;
  buildDemo();
  $('hud').classList.add('hidden'); $('tabBoard').classList.add('hidden'); $('intro').classList.add('hidden');
  show('menu'); $('menuErr').textContent = msg || '';
}

function newPlayer(id, name, bot) {
  const used = new Set(S.players.map(p => p.color));
  return { id, name, bot, color: COLORS.find(c => !used.has(c)) || '#ccc', scores: [], bonus: [], tags: [], stats: { ko: 0, splash: 0, ace: 0, first: 0, items: 0 }, skill: 0.7 };
}
const pubPlayers = () => S.players.map(({ id, name, bot, color, scores, bonus, tags, pending }) => ({ id, name, bot, color, scores, bonus, tags, pending: !!pending }));
function cycleColor(id) {
  const p = S.players.find(p => p.id === id); if (!p) return;
  const used = new Set(S.players.filter(o => o !== p).map(o => o.color));
  const start = COLORS.indexOf(p.color);
  for (let k = 1; k <= COLORS.length; k++) { const c = COLORS[(start + k) % COLORS.length]; if (!used.has(c)) { p.color = c; break; } }
  broadcast(lobbyMsg());
}

function hostOnData(conn, m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'hello') {
    if (S.players.filter(p => !p.gone).length >= 8) return send(conn, { t: 'reject', reason: 'Room is full (8 players).' });
    S.conns.set(conn.peer, conn);
    if (!S.players.some(p => p.id === conn.peer)) {
      const p = newPlayer(conn.peer, String(m.name || 'Player').slice(0, 14), false);
      if (S.phase !== 'lobby') { p.pending = true; S.players.push(p); send(conn, lobbyMsg(true)); toast(`${p.name} joins at the next hole`); return; }
      S.players.push(p);
    }
    broadcast(lobbyMsg());
  } else if (m.t === 'shot') applyShot(conn.peer, +m.a, +m.p);
  else if (m.t === 'use') useItem(conn.peer);
  else if (m.t === 'ping') send(conn, { t: 'pong', ts: m.ts });
  else if (m.t === 'emote') broadcast({ t: 'emote', id: conn.peer, i: m.i | 0 });
  else if (m.t === 'color' && S.phase === 'lobby') cycleColor(conn.peer);
}

function hostDrop(id) {
  if (!S.conns.has(id)) return;
  S.conns.delete(id);
  const p = S.players.find(p => p.id === id);
  if (S.phase === 'lobby' || (p && p.pending)) { S.players = S.players.filter(p => p.id !== id); if (S.phase === 'lobby') broadcast(lobbyMsg()); }
  else if (p) {
    p.gone = true;
    if (S.sim) { const b = S.sim.balls.get(id); if (b) b.out = true; }
    broadcast({ t: 'ev', msg: `${p.name} left` });
  }
}

// ---------------------------------------------------------------- host game logic
// Pick a seed whose hole a bot can finish, and set par from bot test runs.
function prepareHole(idx) {
  const theme = S.themeOrder[idx % S.themeOrder.length];
  const modKeys = Object.keys(C.MODS).filter(k => k !== 'none');
  const mod = params.get('mod') || (S.opts.mods && idx > 0 && Math.random() < 0.45 ? modKeys[Math.floor(Math.random() * modKeys.length)] : 'none');
  const pickups = S.opts.items === 'off' ? 0 : S.opts.items === 'chaos' ? 5 : 3;
  const opt = { theme, mod, pickups };
  let best = null;
  for (let k = 0; k < 4; k++) {
    const seed = (S.seed + idx * 1013 + k * 7919) >>> 0;
    const hole = C.generateHole(seed, idx, opt);
    const runs = [C.botRun(hole, 0.8), C.botRun(hole, 0.8), C.botRun(hole, 0.8)];
    const avg = runs.reduce((a, r) => a + (r ?? C.MAX_STROKES), 0) / runs.length;
    const par = Math.max(2, Math.min(6, Math.round(avg)));
    if (runs.some(r => r !== null)) return { seed, hole, par, opt };
    if (!best) best = { seed, hole, par: hole.par, opt };
  }
  return best;
}

function startMatch() {
  S.players = S.players.filter(p => !p.gone);
  S.players.forEach(p => { p.scores = []; p.bonus = []; p.tags = []; p.pending = false; p.stats = { ko: 0, splash: 0, ace: 0, first: 0, items: 0 }; const [a, b] = BOT_SKILL[S.opts.bots]; p.skill = a + Math.random() * (b - a); });
  S.seed = params.get('seed') ? (+params.get('seed') >>> 0) : (Math.random() * 1e9) >>> 0;
  const R = C.rng(S.seed ^ 0x51ed); S.themeOrder = [0, 1, 2, 3, 4];
  for (let i = 4; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [S.themeOrder[i], S.themeOrder[j]] = [S.themeOrder[j], S.themeOrder[i]]; }
  if (params.get('theme')) S.themeOrder = [(+params.get('theme')) % 5];
  S.podium = null;
  S.nextPrep = prepareHole(0);
  startHole(0);
}

function startHole(idx) {
  const prep = S.nextPrep && S.nextPrep.hole.idx === idx ? S.nextPrep : prepareHole(idx);
  S.nextPrep = null;
  const hole = prep.hole; hole.par = prep.par;
  // late joiners come in now; missed holes count as the worst score so far on each
  for (const p of S.players) {
    if (!p.pending) continue;
    p.pending = false;
    for (let i = 0; i < idx; i++) {
      const others = S.players.filter(o => o !== p && o.scores[i] !== undefined).map(o => o.scores[i]);
      p.scores[i] = speedMode() ? 0 : (others.length ? Math.max(...others) : C.MAX_STROKES); p.bonus[i] = 0; p.tags[i] = '';
    }
  }
  const bs = new Map();
  S.players.forEach((p, i) => { const t = hole.tees[i % hole.tees.length]; const b = C.makeBall(p.id, t.x, t.z, t.y, hole); if (p.gone) b.out = true; bs.set(p.id, b); });
  S.sim = { hole, balls: bs, t: 0, acc: 0, timeLeft: S.opts.time, first: null, endDelay: 0, snapAcc: 0, intro: INTRO_SECS + 0.3, bot: new Map(), mines: [], order: [], bonus: new Map(), ko: new Map(), pick: hole.pickups.map(() => ({ on: true, t: 0 })) };
  S.players.forEach(p => { if (p.bot) S.sim.bot.set(p.id, 0.6 + Math.random() * 2); });
  broadcast({ t: 'hole', seed: prep.seed, idx, par: prep.par, gen: prep.opt, opts: S.opts, players: pubPlayers() });
}

function applyShot(id, a, p) {
  const sim = S.sim; if (!sim || S.phase !== 'playing' || sim.intro > 0) return false;
  const b = sim.balls.get(id);
  if (!b || b.sunk || b.out || b.frozen > 0 || !C.isResting(b) || !isFinite(a) || !isFinite(p)) return false;
  p = Math.max(0, Math.min(1, p));
  b.lastX = b.x; b.lastY = b.y; b.lastZ = b.z; b.strokes++;
  const s = C.shotSpeed(sim.hole, p);
  b.vx = Math.cos(a) * s; b.vz = Math.sin(a) * s;
  b.fx = 'putt'; b.fxv = 2 + p * 8;
  return true;
}

function addBonus(id, pts, tag) {
  const sim = S.sim; const e = sim.bonus.get(id) || { pts: 0, tags: '' };
  e.pts += pts; e.tags += tag; sim.bonus.set(id, e);
}
function hostEvent(msg, s, b, extra) { broadcast({ t: 'ev', msg, s, x: b ? +b.x.toFixed(2) : 0, y: b ? +b.y.toFixed(2) : 0, z: b ? +b.z.toFixed(2) : 0, ...extra }); }
const stat = (id, k) => { const p = S.players.find(p => p.id === id); if (p) p.stats[k]++; };

function useItem(id) {
  const sim = S.sim; if (!sim || S.phase !== 'playing' || sim.intro > 0) return;
  const b = sim.balls.get(id); if (!b || !b.item || b.sunk || b.out) return;
  const it = b.item, arr = [...sim.balls.values()], nm = pname(id);
  const others = arr.filter(o => o !== b && !o.sunk && !o.out);
  if (it === 6) {
    const tgt = others.sort((p, q) => C.distToCup(sim.hole, p.x, p.z) - C.distToCup(sim.hole, q.x, q.z))[0];
    if (!tgt) return;
    for (const k of ['x', 'y', 'z']) { const v = b[k]; b[k] = tgt[k]; tgt[k] = v; }
    b.vx = b.vy = b.vz = tgt.vx = tgt.vy = tgt.vz = 0; b.air = tgt.air = false;
    hostEvent(`🔀 ${nm} swapped places with ${pname(tgt.id)}!`, 'swap', b);
  } else if (it === 7) {
    const sp = Math.hypot(b.vx, b.vz);
    if (sp < 0.4) { const c = S.conns.get(id); const m = { t: 'ev', msg: '🚀 Rocket only works while your ball is rolling' }; if (c) send(c, m); else if (id === S.myId) onMessage(m); return; }
    const k = Math.max(sp, 11.5) / sp; b.vx *= k; b.vz *= k;
    hostEvent(`🚀 ${nm} hit the ROCKET!`, 'rocket', b);
  } else if (it === 1) { b.big = 12; hostEvent(`🔴 ${nm} went BIG!`, 'use', b); }
  else if (it === 2) { b.sticky = 12; hostEvent(`🟢 ${nm} is STICKY`, 'use', b); }
  else if (it === 3) { C.blast(arr, b.x, b.z, b.y, 5, 9, b, id); hostEvent(`💥 ${nm} SHOCKWAVE!`, 'shock', b); }
  else if (it === 4) { b.magnet = 12; hostEvent(`🧲 ${nm} turned on the MAGNET`, 'use', b); }
  else if (it === 5) { b.ghost = 10; hostEvent(`👻 ${nm} went GHOST`, 'use', b); }
  else if (it === 8) { if (sim.mines.length >= 8) sim.mines.shift(); sim.mines.push({ x: b.x, y: b.y, z: b.z, owner: id, arm: sim.t + 1.2 }); hostEvent(`💣 ${nm} dropped a MINE`, 'use', b); }
  else if (it === 9) { for (const o of others) if (!(o.ghost > 0)) { o.frozen = 4; o.vx = o.vz = 0; } hostEvent(`❄️ ${nm} FROZE everyone!`, 'freeze', b); }
  b.item = 0; C.applyEffects(b, sim.hole); stat(id, 'items');
}

function pickItem(b) {
  const sim = S.sim, act = [...sim.balls.values()].filter(o => !o.sunk && !o.out);
  const d = C.distToCup(sim.hole, b.x, b.z), rank = act.filter(o => C.distToCup(sim.hole, o.x, o.z) < d).length / Math.max(1, act.length - 1);
  // leaders get defensive/trap items, trailers get catch-up items
  const pool = rank < 0.34 ? [1, 2, 8, 3, 5, 8, 2] : rank > 0.66 ? [6, 7, 4, 9, 3, 6, 9] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return +params.get('item') || pool[Math.floor(Math.random() * pool.length)];
}

function physicsStep() {
  const sim = S.sim; sim.t += STEP;
  const arr = [...sim.balls.values()];
  for (const b of arr) {
    const ev = C.stepBall(sim.hole, b, sim.t, STEP);
    if (ev === 'water' || ev === 'fell') {
      const ko = b.hitBy && b.hitBy !== b.id && sim.t - b.hitAt < 4 ? b.hitBy : null;
      b.strokes++; stat(b.id, 'splash');
      hostEvent(ev === 'water' ? `💦 ${pname(b.id)} splashed! +1 stroke` : `🕳️ ${pname(b.id)} fell off! +1 stroke`, ev === 'water' ? 'splash' : 'fell', b);
      b.x = b.lastX; b.y = b.lastY; b.z = b.lastZ; b.vx = b.vy = b.vz = 0; b.air = false; b.hitBy = null;
      if (speedMode()) b.frozen = 1.5;
      if (ko && (sim.ko.get(ko) || 0) < 2) {
        sim.ko.set(ko, (sim.ko.get(ko) || 0) + 1); addBonus(ko, speedMode() ? 2 : 1, '💥'); stat(ko, 'ko');
        hostEvent(`💥 ${pname(ko)} KO'd ${pname(b.id)}! (${speedMode() ? '+2' : '−1'})`, 'ko');
      }
    } else if (ev === 'sunk') {
      const first = !sim.first; if (first) { sim.first = b.id; stat(b.id, 'first'); if (!speedMode()) addBonus(b.id, 1, '★'); }
      sim.order.push(b.id);
      const ace = b.strokes === 1; if (ace) { addBonus(b.id, speedMode() ? 3 : 1, '🎯'); stat(b.id, 'ace'); }
      hostEvent(ace ? `🎯 HOLE IN ONE! ${pname(b.id)}!` : `⛳ ${pname(b.id)} sank it in ${b.strokes}!${first ? ' ★ FIRST' : ''}`, 'cup', b, { id: b.id });
    }
  }
  C.collideBalls(arr);
  for (const b of arr) if (b.newHit) { b.hitBy = b.newHit; b.hitAt = sim.t; b.newHit = null; }
}

function hostTick(dt) {
  if (!S.isHost || !S.sim) return;
  const sim = S.sim;
  if (S.phase === 'playing') {
    if (sim.intro > 0) { sim.intro -= dt; sim.snapAcc += dt; if (sim.snapAcc >= 0.2) { sim.snapAcc = 0; if (S.conns.size) broadcast(snapshot(), false); } return; }
    sim.acc += dt;
    let n = 0;
    while (sim.acc >= STEP && n++ < 120) { sim.acc -= STEP; physicsStep(); }
    if (n >= 120) sim.acc = 0;
    sim.timeLeft = Math.max(0, sim.timeLeft - dt);
    const arr = [...sim.balls.values()];
    for (const b of arr) {
      if (b.big > 0 || b.sticky > 0 || b.magnet > 0 || b.ghost > 0 || b.frozen > 0) {
        for (const k of ['big', 'sticky', 'magnet', 'ghost', 'frozen']) b[k] = Math.max(0, b[k] - dt);
        C.applyEffects(b, sim.hole);
      }
      if (!speedMode() && !b.sunk && !b.out && C.isResting(b) && b.strokes >= C.MAX_STROKES) { b.out = true; hostEvent(`${pname(b.id)} is out of strokes`); }
      if (b.sunk || b.out || b.item) continue;
      sim.hole.pickups.forEach((pk, i) => {
        const st = sim.pick[i];
        if (!st.on || Math.hypot(b.x - pk.x, b.z - pk.z) > 0.4 + b.r || Math.abs(b.y - pk.y) > 0.8 || b.item) return;
        st.on = false; st.t = ITEM_RESPAWN[S.opts.items] || 12;
        b.item = pickItem(b);
        hostEvent(`🎁 ${pname(b.id)} got ${C.ITEMS[b.item].n}`, 'pickup', b);
      });
    }
    sim.pick.forEach(st => { if (!st.on && (st.t -= dt) <= 0) st.on = true; });
    // mines
    for (let i = sim.mines.length - 1; i >= 0; i--) {
      const m = sim.mines[i]; if (sim.t < m.arm) continue;
      const hit = arr.find(b => !b.sunk && !b.out && !(b.ghost > 0) && (b.id !== m.owner || sim.t > m.arm + 4) && Math.hypot(b.x - m.x, b.z - m.z) < 0.35 + b.r && Math.abs(b.y - m.y) < 0.6);
      if (!hit) continue;
      C.blast(arr, m.x, m.z, m.y, 4, 12, null, m.owner);
      sim.mines.splice(i, 1);
      hostEvent(`💣 BOOM! ${pname(hit.id)} hit ${pname(m.owner)}'s mine`, 'shock', m);
    }
    botTick(dt, arr);
    const allDone = arr.every(b => b.sunk || b.out);
    if ((allDone || sim.timeLeft <= 0) && !sim.endDelay) { sim.endDelay = allDone ? 1.4 : 0.01; if (!allDone) hostEvent('⏰ Time up!'); }
    if (sim.endDelay) { sim.endDelay -= dt; if (sim.endDelay <= 0) endHole(); }
    sim.snapAcc += dt;
    if (sim.snapAcc >= 0.05) { sim.snapAcc = 0; if (S.conns.size) broadcast(snapshot(), false); }
  } else if (S.phase === 'holeEnd') {
    sim.phaseTimer -= dt;
    if (sim.phaseTimer <= 0) {
      if (S.holeIdx + 1 < S.opts.holes) startHole(S.holeIdx + 1);
      else { S.phase = 'matchEnd'; broadcast({ t: 'matchEnd', players: pubPlayers(), awards: makeAwards() }); }
    }
  }
}

function botTick(dt, arr) {
  const sim = S.sim;
  for (const p of S.players) {
    if (!p.bot) continue;
    const b = sim.balls.get(p.id); if (!b || b.sunk || b.out) continue;
    const others = arr.filter(o => o !== b && !o.sunk && !o.out);
    const dCup = C.distToCup(sim.hole, b.x, b.z);
    if (b.item === 3 && others.some(o => Math.hypot(o.x - b.x, o.z - b.z) < 3.2)) useItem(p.id);
    else if (b.item === 9 && others.length && Math.random() < dt * 0.6) useItem(p.id);
    else if (b.item === 6 && others.some(o => C.distToCup(sim.hole, o.x, o.z) < dCup - 6)) useItem(p.id);
    else if (b.item === 7 && !C.isResting(b) && !b.air && dCup > 9 && Math.hypot(b.vx, b.vz) < 3 && Math.random() < dt * 1.5) useItem(p.id);
    if (b.frozen > 0) continue;
    if (!C.isResting(b)) { sim.bot.delete(p.id); continue; }
    if (!sim.bot.has(p.id)) sim.bot.set(p.id, 0.8 + Math.random() * 1.4);
    const w = sim.bot.get(p.id) - dt; sim.bot.set(p.id, w);
    if (w <= 0) {
      if ([1, 2, 5, 8].includes(b.item) || (b.item === 4 && dCup < 8)) useItem(p.id);
      const sh = C.planShot(sim.hole, b, sim.t + 0.05, p.skill, S.opts.bots === 'easy' ? 0.5 : 1); applyShot(p.id, sh.a, sh.p); sim.bot.delete(p.id);
    }
  }
}

const r3 = v => Math.round(v * 1000) / 1000;
function snapshot() {
  const sim = S.sim;
  return {
    t: 's', ht: r3(sim.t), tl: r3(sim.timeLeft), pk: sim.pick.map(p => p.on ? 1 : 0), mn: sim.mines.map(m => [r3(m.x), r3(m.y), r3(m.z)]),
    b: [...sim.balls.values()].map(b => [b.id, r3(b.x), r3(b.y), r3(b.z), r3(b.vx), r3(b.vy), r3(b.vz),
      (b.sunk ? 1 : 0) | (C.isResting(b) ? 2 : 0) | (b.out ? 4 : 0) | (b.air ? 8 : 0), b.strokes, b.item, r3(b.big), r3(b.sticky), r3(b.magnet), r3(b.ghost), r3(b.frozen)]),
  };
}

function endHole() {
  const sim = S.sim; const idx = S.holeIdx;
  for (const p of S.players) {
    const b = sim.balls.get(p.id), bon = sim.bonus.get(p.id) || { pts: 0, tags: '' };
    if (speedMode()) { const pl = sim.order.indexOf(p.id); p.scores[idx] = pl >= 0 ? PLACE_PTS[Math.min(pl, PLACE_PTS.length - 1)] : 0; }
    else p.scores[idx] = b && b.sunk ? Math.min(b.strokes, C.MAX_STROKES) : C.MAX_STROKES;
    p.bonus[idx] = bon.pts; p.tags[idx] = bon.tags;
  }
  S.phase = 'holeEnd'; sim.phaseTimer = HOLE_END_SECS;
  broadcast({ t: 'holeEnd', players: pubPlayers(), idx });
  if (idx + 1 < S.opts.holes) setTimeout(() => { if (S.isHost && S.phase === 'holeEnd') S.nextPrep = prepareHole(idx + 1); }, 300);
}

function makeAwards() {
  const best = (k, label, min = 1) => { const p = [...S.players].sort((a, b) => b.stats[k] - a.stats[k])[0]; return p && p.stats[k] >= min ? `${label}: ${p.name} (${p.stats[k]})` : null; };
  return [best('ko', '💥 Bully — most KOs'), best('ace', '🎯 Sniper — holes-in-one'), best('first', '★ Speedster — first to sink'), best('splash', '💦 Soggy Socks — most penalties', 2), best('items', '🎁 Gadgeteer — power-ups used', 2)].filter(Boolean);
}

function backToLobby() {
  if (!S.isHost) return;
  S.players = S.players.filter(p => !p.gone);
  S.players.forEach(p => p.pending = false);
  S.phase = 'lobby'; S.sim = null;
  broadcast(lobbyMsg());
}

// ---------------------------------------------------------------- client prediction / reconciliation
function onSnapshot(m) {
  if (!S.csim || !S.hole) return;
  const now = performance.now();
  S.timeLeft = m.tl; S.pick = m.pk || []; S.mines = m.mn || [];
  const lat = Math.min(0.25, S.ping / 2000);
  const srv = m.b.map(([id, x, y, z, vx, vy, vz, f, strokes, item, big, sticky, magnet, ghost, frozen]) => {
    const b = { id, x, y, z, vx, vy, vz, sunk: !!(f & 1), ready: !!(f & 2), out: !!(f & 4), air: !!(f & 8), strokes, item, big, sticky, magnet, ghost, frozen };
    C.applyEffects(b, S.hole); return b;
  });
  // fast-forward a copy by one-way latency so we compare against "now"
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
    if (!predicting && c.srvStrokes !== undefined && s.strokes > c.srvStrokes && !(mine && s.strokes === S.pred.strokes) && Math.hypot(s.vx, s.vz) > 0.5) { c.fx = 'putt'; c.fxv = 5; }
    c.srvStrokes = s.strokes; c.srvReady = s.ready;
    for (const k of ['item', 'big', 'sticky', 'magnet', 'ghost', 'frozen', 'out']) c[k] = s[k];
    C.applyEffects(c, S.hole);
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
  const cs = S.csim; if (!cs || S.phase !== 'playing' || performance.now() < S.introUntil) return;
  cs.acc += Math.min(dt, 0.1);
  const arr = [...cs.balls.values()];
  for (const b of arr) for (const k of ['big', 'sticky', 'magnet', 'ghost', 'frozen']) if (b[k] > 0) b[k] = Math.max(0, b[k] - dt);
  while (cs.acc >= STEP) {
    cs.acc -= STEP; cs.t += STEP;
    for (const b of arr) {
      const ev = C.stepBall(S.hole, b, cs.t, STEP);
      if (ev === 'sunk') b.sunkAt = performance.now();
      else if (ev) { b.hold = true; b.vx = b.vy = b.vz = 0; }
    }
    C.collideBalls(arr);
  }
}

// ---------------------------------------------------------------- messages (host loopback + clients)
function onMessage(m) {
  if (!m || typeof m !== 'object') return;
  const waiting = !S.isHost && S.screen === 'lobby' && S.inMatch; // late joiner waiting for the next hole
  switch (m.t) {
    case 'lobby':
      if (!S.isHost) { S.players = m.players; S.opts = m.opts || S.opts; S.inMatch = !!m.inMatch; }
      S.code = m.code || S.code; if (!m.inMatch) S.phase = 'lobby';
      if (S.screen !== 'lobby') { S.hole = null; S.podium = null; buildDemo(); S.csim = null; $('hud').classList.add('hidden'); $('tabBoard').classList.add('hidden'); S.screen = 'lobby'; show('lobby'); }
      renderLobby();
      break;
    case 'reject': leave(m.reason); break;
    case 'hole': {
      if (!S.isHost) { S.players = m.players; S.opts = m.opts; }
      S.holeIdx = m.idx; S.inMatch = false; S.podium = null;
      S.hole = S.isHost ? S.sim.hole : C.generateHole(m.seed, m.idx, m.gen);
      S.hole.par = m.par;
      S.phase = 'playing'; S.screen = 'game'; S.timeLeft = S.opts.time;
      S.pick = S.hole.pickups.map(() => 1); S.mines = []; S.pred = { strokes: -1, until: 0 }; S.spec = null;
      if (!S.isHost) {
        const bs = new Map();
        S.players.forEach((p, i) => { const t = S.hole.tees[i % S.hole.tees.length]; bs.set(p.id, Object.assign(C.makeBall(p.id, t.x, t.z, t.y, S.hole), { srvReady: true })); });
        S.csim = { balls: bs, t: 0, acc: 0 };
      }
      buildCourse(S.hole); startIntro(); frame.liveAt = 0;
      show(null); $('hud').classList.remove('hidden');
      SFX.play('pickup', 0.5);
      break;
    }
    case 's': if (!S.isHost) onSnapshot(m); break;
    case 'ev':
      if (waiting) break;
      toast(m.msg);
      if (m.s && S.hole) {
        SFX.play(m.s, ['shock', 'cup', 'ko', 'freeze', 'swap'].includes(m.s) ? Math.max(0.4, near(m.x, m.z)) : near(m.x, m.z));
        const cup = S.hole.cup;
        if (m.s === 'shock') { spawnRing(m.x, m.y, m.z, '#7dd3fc'); fxp.emit(m.x, m.y + 0.2, m.z, 60, ['#7dd3fc', '#e0f2fe', '#ffffff', '#ffb347'], 7, 1.5, 0.6, 3); }
        if (m.s === 'splash') { fxp.emit(m.x, m.y + 0.05, m.z, 45, ['#bfe6ff', '#ffffff', '#5fb4ff'], 1.8, 4, 0.9, 12); spawnRing(m.x, m.y - 0.1, m.z, '#ffffff', 2.5); }
        if (m.s === 'cup') { const col = S.players.find(p => p.id === m.id)?.color || '#fff'; fxp.emit(cup.x, cup.y + 0.2, cup.z, 80, [col, col, '#ffd43b', '#ffffff', '#ff7ad9', '#4dabff'], 2.2, 5, 1.6, 7); }
        if (m.s === 'pickup') fxp.emit(m.x, m.y + 0.4, m.z, 30, ['#ffd84a', '#fff3b0', '#f59e0b'], 2, 2.5, 0.8, 5);
        if (m.s === 'fell') fxp.emit(m.x, m.y + 0.1, m.z, 16, ['#8b6b4a', '#c9b08a'], 1.2, 1.5, 0.6, 6);
        if (m.s === 'freeze') { spawnRing(m.x, m.y, m.z, '#bfeaff', 14); fxp.emit(m.x, m.y + 0.3, m.z, 60, ['#ffffff', '#bfeaff', '#7fd0ff'], 6, 2, 1.0, 2); }
        if (m.s === 'use' || m.s === 'rocket' || m.s === 'swap') fxp.emit(m.x, m.y + 0.2, m.z, 24, ['#ffffff', '#ffe14d', '#ff9f43'], 2.5, 2, 0.6, 4);
      }
      break;
    case 'emote': if (!waiting) showEmote(m.id, m.i); break;
    case 'holeEnd': if (waiting) break; if (!S.isHost) S.players = m.players; S.phase = 'holeEnd'; aimCancel(); showBoard(false); break;
    case 'matchEnd': if (waiting) break; if (!S.isHost) S.players = m.players; S.awards = m.awards || []; S.phase = 'matchEnd'; aimCancel(); showBoard(true); break;
    case 'pong': S.ping = S.ping ? S.ping * 0.7 + (performance.now() - m.ts) * 0.3 : performance.now() - m.ts; break;
  }
}

// ---------------------------------------------------------------- course rendering
const sharedMats = new Set(Object.values(G.M));
let flagMesh = null, turnRing = null, demoHole = null, groundY = -1.2, demoN = Math.floor(Math.random() * 5);
function clearCourse() {
  if (course) {
    scene.remove(course);
    course.traverse(o => {
      if (o.geometry && !G.keepGeos.has(o.geometry)) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) if (!sharedMats.has(m) && !G.keepMats.has(m)) { if (m.map && o.userData.ownMap) m.map.dispose(); m.dispose(); }
    });
  }
  course = null; moverMeshes = []; pickupMeshes = []; mineMeshes = []; portalMeshes = []; bubbles = []; ballMeshes.clear();
  aimGroup.visible = false; pullLine.visible = false;
  rings.forEach(r => scene.remove(r.m)); rings = []; flagMesh = null; turnRing = null;
}

// Floor of one tile as a height-mapped grid (ramps, banks, hills, kickers, gaps). UVs follow the lane.
function tileFloor(hole, t) {
  const N = 24, T = C.T, e = 1e-3, pos = [], uv = [], ok = [], idx = [];
  const d = t.d, px = -d[1], pz = d[0];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = t.cx - T / 2 + T * i / N, z = t.cz - T / 2 + T * j / N;
    const h = C.heightAt(hole, Math.min(t.cx + T / 2 - e, Math.max(t.cx - T / 2 + e, x)), Math.min(t.cz + T / 2 - e, Math.max(t.cz - T / 2 + e, z)));
    pos.push(x, h ?? 0, z); ok.push(h !== null);
    uv.push(((x - t.cx) * px + (z - t.cz) * pz) / 2.5 + 0.5, ((x - t.cx) * d[0] + (z - t.cz) * d[1]) / 2.5);
  }
  const v = (i, j) => j * (N + 1) + i;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), dd = v(i + 1, j + 1);
    if (ok[a] && ok[c] && ok[b]) idx.push(a, c, b);
    if (ok[b] && ok[c] && ok[dd]) idx.push(b, c, dd);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, G.M.turf); m.receiveShadow = true;
  return m;
}

function buildCourse(hole) {
  clearCourse();
  course = new THREE.Group(); scene.add(course);
  const T = C.T, M = G.M, th = G.THEMES[hole.themeIdx];
  let gy = Math.min(...hole.tiles.map(t => Math.min(t.h0, t.h1) - (t.cupKind === 'bowl' ? 0.25 : 0))) - 0.45;
  for (const t of hole.tiles) if (t.type === 'jump') gy = Math.min(gy, t.h0 - 1.15);
  groundY = gy; ground.position.y = gy;
  const minX = Math.min(...hole.tiles.map(t => t.cx)) - T, maxX = Math.max(...hole.tiles.map(t => t.cx)) + T;
  const minZ = Math.min(...hole.tiles.map(t => t.cz)) - T, maxZ = Math.max(...hole.tiles.map(t => t.cz)) + T;
  const at = (t, a, l) => [t.cx + t.d[0] * a - t.d[1] * l, t.cz + t.d[1] * a + t.d[0] * l];
  const add = (m, x, y, z) => { m.position.set(x, y, z); course.add(m); return m; };

  for (const t of hole.tiles) {
    course.add(tileFloor(hole, t));
    const low = Math.min(t.h0, t.h1) - (t.type === 'jump' ? 1.1 : t.cupKind === 'bowl' ? 0.27 : 0.02);
    if (low - gy > 0.01) add(G.box(T, low - gy, T, t.type === 'jump' ? M.pit : M.stone, { uvScale: 1.6 }), t.cx, (low + gy) / 2, t.cz).castShadow = false;
    if (t.type === 'jump') {
      for (const s of [-1, 1]) add(G.box(t.d[0] ? T : 0.1, t.h0 - gy, t.d[0] ? 0.1 : T, M.stone, { uvScale: 1.6 }), t.cx - t.d[1] * s * (T / 2 - 0.05), (t.h0 + gy) / 2, t.cz + t.d[0] * s * (T / 2 - 0.05));
      const [fx, fz] = at(t, -T / 2 + 1.5, 0);
      add(G.box(t.d[0] ? 0.06 : T, 1.6, t.d[0] ? T : 0.06, M.pit), fx, t.h0 - 0.55, fz);
      add(G.box(t.d[0] ? 0.12 : T - 0.3, 0.06, t.d[0] ? T - 0.3 : 0.12, M.hazard, { round: 0.02, uvScale: 0.8 }), fx, t.h0 + 0.47, fz);
      const [lx, lz] = at(t, -T / 2 + 3.25, 0);
      add(G.box(t.d[0] ? 0.06 : T, 1.1, t.d[0] ? T : 0.06, M.pit), lx, t.h0 - 0.56, lz);
    }
    if (t.type === 'bank') {
      // raised stone planter fills the corner behind the curved rail
      const N = 14, pos = [], idx = [], ok = [];
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const x = t.cx - T / 2 + T * i / N, z = t.cz - T / 2 + T * j / N; pos.push(x, t.h0 + 0.5, z); ok.push(Math.hypot(x - t.ic[0], z - t.ic[1]) > T - 0.3); }
      const v = (i, j) => j * (N + 1) + i;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1); if (ok[a] && ok[b] && ok[c] && ok[d]) idx.push(a, c, b, b, c, d); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.filter((_, k) => k % 3 !== 1).map(v => v / 1.6), 2)); g.setIndex(idx); g.computeVertexNormals();
      const pm = new THREE.Mesh(g, M.stone); pm.receiveShadow = true; course.add(pm);
      const ox = t.cx + (t.din[0] - t.d[0]) * (T / 2 - 0.75), oz = t.cz + (t.din[1] - t.d[1]) * (T / 2 - 0.75);
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshStandardMaterial({ color: th.bush, flatShading: true, roughness: 0.9 }));
      bush.castShadow = true; add(bush, ox, t.h0 + 0.85, oz).scale.set(1.1, 0.9, 1.1);
    }
    if (t.type === 'tee') {
      const [mx, mz] = at(t, -1.1, 0);
      add(G.box(t.d[0] ? 1.7 : T * 0.86, 0.03, t.d[0] ? T * 0.86 : 1.7, M.rubber, { round: 0.012 }), mx, t.h0 + 0.012, mz).castShadow = false;
      for (const s of [-1, 1]) { const [kx, kz] = at(t, -0.15, s * 2.1); const mk = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10), s < 0 ? M.red : M.white); mk.castShadow = true; add(mk, kx, t.h0 + 0.09, kz); }
    }
  }
  // rails
  const postSeen = new Set();
  const floorRange = (x, z, rad) => { let lo = Infinity, hi = -Infinity; for (const [ox, oz] of [[rad, rad], [-rad, rad], [rad, -rad], [-rad, -rad]]) { const h = C.heightAt(hole, x + ox, z + oz); if (h !== null) { lo = Math.min(lo, h); hi = Math.max(hi, h); } } return [lo, hi]; };
  for (const w0 of hole.walls) {
    const w = { ...w0 };
    if (w.kind === 'border') {
      const along = w.hx > w.hz ? [1, 0] : [0, 1], nrm = [along[1], along[0]], L = Math.max(w.hx, w.hz);
      let lo = Infinity, hi = -Infinity;
      for (const a of [-0.45, -0.2, 0, 0.2, 0.45]) for (const n of [-0.35, 0.35]) {
        const h = C.heightAt(hole, w.x + along[0] * a * L * 2 + nrm[0] * n, w.z + along[1] * a * L * 2 + nrm[1] * n);
        if (h !== null) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
      }
      if (lo !== Infinity) { w.y0 = lo - 0.1; w.y1 = hi + 0.33; }
      // corner posts hide the joints between rails at different heights
      for (const s of [-1, 1]) {
        const px = w.x + along[0] * s * T / 2, pz = w.z + along[1] * s * T / 2, k = px.toFixed(1) + ',' + pz.toFixed(1);
        if (postSeen.has(k)) continue; postSeen.add(k);
        const [plo, phi] = floorRange(px, pz, 0.3); if (plo === Infinity) continue;
        add(G.box(0.36, phi + 0.45 - (plo - 0.12), 0.36, M.wood, { round: 0.06 }), px, (phi + 0.45 + plo - 0.12) / 2, pz);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), M.white); cap.castShadow = true; add(cap, px, phi + 0.5, pz);
      }
    }
    const ww = w.hx * 2, hh = w.y1 - w.y0, dd = w.hz * 2;
    add(w.kind === 'tunnel' ? G.box(ww, hh, dd, M.stone, { uvScale: 1.2 }) : G.box(ww, hh, dd, w.kind === 'inner' ? M.paint : M.wood, { round: 0.05 }), w.x, (w.y0 + w.y1) / 2, w.z);
    if (w.kind === 'inner') add(G.box(ww + 0.02, 0.05, dd + 0.02, M.red, { round: 0.02 }), w.x, w.y1, w.z);
  }
  for (const o of hole.obbs) add(G.box(o.hx * 2, o.y1 - o.y0, o.hz * 2, M.wood, { round: 0.05 }), o.x, (o.y0 + o.y1) / 2, o.z).rotation.y = -o.a;
  for (const { t, y } of hole.tunnels) {
    add(G.box(t.d[0] ? 3.6 : 2.7, 0.06, t.d[0] ? 2.7 : 3.6, M.glass), t.cx, y + 0.95, t.cz).castShadow = false;
    for (const s of [-1, 1]) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.16, 10, 20, Math.PI), M.stone); arch.castShadow = true;
      const [ax, az] = at(t, s * 1.8, 0); add(arch, ax, y, az).rotation.y = t.d[0] ? Math.PI / 2 : 0;
    }
  }
  for (const w of hole.waters) {
    const m = add(G.box(w.hx * 2, 0.02, w.hz * 2, M.water), w.x, w.y + 0.02, w.z); m.castShadow = false; m.receiveShadow = false;
    const rim = 0.09;
    for (const [rx, rz, rw, rd] of [[w.x, w.z - w.hz - rim / 2, w.hx * 2 + rim * 2, rim], [w.x, w.z + w.hz + rim / 2, w.hx * 2 + rim * 2, rim], [w.x - w.hx - rim / 2, w.z, rim, w.hz * 2], [w.x + w.hx + rim / 2, w.z, rim, w.hz * 2]]) {
      const rt = C.tileAt(hole, rx, rz); if (!rt || Math.abs(rx - rt.cx) > T / 2 - 0.15 || Math.abs(rz - rt.cz) > T / 2 - 0.15) continue;
      add(G.box(rw, 0.06, rd, M.stone, { uvScale: 0.6 }), rx, w.y + 0.03, rz).castShadow = false;
    }
  }
  for (const zn of hole.zones) {
    if (zn.kind === 'boost') {
      const alongX = zn.dx !== 0, g = new THREE.PlaneGeometry(alongX ? zn.hz * 2 : zn.hx * 2, alongX ? zn.hx * 2 : zn.hz * 2); g.rotateX(-Math.PI / 2);
      add(new THREE.Mesh(g, M.boost), zn.x, zn.y + 0.012, zn.z).rotation.y = Math.atan2(-zn.dx, -zn.dz);
      add(G.glowSprite('#ffe14d', 2.2), zn.x, zn.y + 0.15, zn.z).material.opacity = 0.35;
    } else {
      add(G.box(zn.hx * 2, 0.02, zn.hz * 2, zn.kind === 'sand' ? M.sand : M.ice, { round: 0.009, uvScale: zn.kind === 'sand' ? 1 : 2.5 }), zn.x, zn.y + 0.011, zn.z).castShadow = false;
    }
  }
  for (const p of hole.portals) {
    for (const [x, y, z, pm, rm, col] of [[p.ax, p.ay, p.az, M.portalA, M.ringA, '#5ad1ff'], [p.bx, p.by, p.bz, M.portalB, M.ringB, '#ffb347']]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.46, 32), pm); disc.rotation.x = -Math.PI / 2; add(disc, x, y + 0.014, z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.035, 8, 36), rm); ring.rotation.x = Math.PI / 2; add(ring, x, y + 0.03, z);
      const glow = add(G.glowSprite(col, 1.8), x, y + 0.35, z); portalMeshes.push({ ring, glow });
    }
  }
  for (const b of hole.bumpers) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 0.38, 32), [M.bumperSide, M.bumperTop, M.bumperTop]);
    m.castShadow = true; m.receiveShadow = true; add(m, b.x, b.y + 0.19, b.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(b.r, 0.035, 8, 32), M.red); ring.rotation.x = Math.PI / 2; add(ring, b.x, b.y + 0.38, b.z);
  }
  for (const mv of hole.movers) {
    const g = new THREE.Group();
    const m = G.box(mv.hx * 2, 0.34, mv.hz * 2, M.hazard, { round: 0.05, uvScale: 0.8 }); m.position.y = 0.17; g.add(m);
    if (mv.kind === 'spinner') {
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.55, 20), M.stone); hub.position.y = 0.28; hub.castShadow = true; g.add(hub);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), M.red); cap.position.y = 0.6; g.add(cap);
    }
    g.position.y = mv.y; course.add(g); moverMeshes.push({ mv, g });
  }
  for (const pk of hole.pickups) {
    const m = add(G.box(0.4, 0.4, 0.4, M.crate, { round: 0.05 }), pk.x, pk.y + 0.45, pk.z);
    const q = add(G.glowSprite('#ffd84a', 1.4), pk.x, pk.y + 0.45, pk.z);
    pickupMeshes.push({ m, q, pk });
  }
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 16), M.mine); body.position.y = 0.05; body.castShadow = true;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), M.mineLight); light.position.y = 0.12;
    g.add(body, light); g.visible = false; course.add(g); mineMeshes.push(g);
  }
  const cup = hole.cup, cr = hole.P.cupR;
  const hole3 = new THREE.Mesh(new THREE.CircleGeometry(cr, 32), M.cup); hole3.rotation.x = -Math.PI / 2; add(hole3, cup.x, cup.y + 0.022, cup.z);
  const rimC = new THREE.Mesh(new THREE.TorusGeometry(cr + 0.012, 0.016, 8, 40), M.white); rimC.rotation.x = Math.PI / 2; add(rimC, cup.x, cup.y + 0.026, cup.z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.75, 10), M.white); pole.castShadow = true; add(pole, cup.x, cup.y + 0.875, cup.z);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), M.red), cup.x, cup.y + 1.77, cup.z);
  flagMesh = add(G.makeFlag((hole.idx ?? 0) + 1), cup.x + 0.02, cup.y + 1.72, cup.z);
  turnRing = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.36, 40), new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.9, depthWrite: false }));
  turnRing.rotation.x = -Math.PI / 2; turnRing.visible = false; course.add(turnRing);
  const ballGeo = new THREE.SphereGeometry(C.BALL_R, 32, 24);
  for (const p of S.players) {
    if (p.pending) continue;
    const ball = new THREE.Mesh(ballGeo, G.ballMaterial(p.color)); ball.castShadow = true;
    const label = G.makeLabel(p.id === S.myId ? 'You' : p.name, p.color);
    course.add(ball, label); ballMeshes.set(p.id, { ball, label, trail: new G.Trail(course, p.color), sink: 0, wasSunk: false });
  }
  course.add(G.buildScenery(hole, gy, th));
  const dir = G.applyTheme(th, themeCtx); weather.set(th.weather);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, ext = Math.max(maxX - minX, maxZ - minZ) / 2 + 3;
  sun.position.set(cx + dir.x * 50, dir.y * 50, cz + dir.z * 50); sun.target.position.set(cx, 0, cz);
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 120 });
  sun.shadow.camera.updateProjectionMatrix();
}

// attract-mode course behind the menu / lobby (a different world each time)
function buildDemo() {
  demoHole = C.generateHole(20261115 + demoN * 77, 4, { theme: params.get('theme') ? +params.get('theme') : demoN % 5 }); demoN++;
  const keep = S.players; S.players = [];
  buildCourse(demoHole); S.players = keep;
}

function spawnRing(x, y, z, color = '#7dd3fc', grow = 10) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  m.rotation.x = Math.PI / 2; m.position.set(x, y + 0.2, z); scene.add(m); rings.push({ m, t: 0, grow });
}

function showEmote(id, i) {
  const bm = ballMeshes.get(id); if (!bm || !course) return;
  bubbles = bubbles.filter(b => { if (b.id === id) { course.remove(b.sp); return false; } return true; });
  const sp = G.makeBubble(EMOTES[i] || EMOTES[0]); course.add(sp);
  bubbles.push({ sp, id, t: 0 });
  SFX.play('tick', 0.8);
}

// winners' podium on the last green
function setupPodium() {
  if (!S.hole || !course) return;
  const t = S.hole.tiles[S.hole.tiles.length - 1], M = G.M;
  const px = -t.d[1], pz = t.d[0], y0 = t.h0 - 0.3;
  const cx = t.cx - t.d[0] * 0.9, cz = t.cz - t.d[1] * 0.9;
  const ps = ranked().filter(p => !p.pending), pos = new Map();
  const steps = [[0, 0.75, M.gold], [-0.72, 0.55, M.silver], [0.72, 0.42, M.bronze]];
  steps.forEach(([off, h, mat], i) => {
    if (!ps[i]) return;
    const b = G.box(0.7, h + 0.3, 0.7, mat, { round: 0.04 }); b.position.set(cx + px * off, y0 + (h + 0.3) / 2, cz + pz * off); course.add(b);
    pos.set(ps[i].id, new THREE.Vector3(cx + px * off, t.h0 + h, cz + pz * off));
  });
  ps.slice(3).forEach((p, i) => { const o = (i - (ps.length - 4) / 2) * 0.5; pos.set(p.id, new THREE.Vector3(cx + px * o + t.d[0] * 1.0, t.h0, cz + pz * o + t.d[1] * 1.0)); });
  S.podium = { pos, c: new THREE.Vector3(cx, t.h0 + 0.6, cz), t0: performance.now(), win: ps[0]?.id };
}

function startIntro() {
  const b = myBall() || [...balls().values()][0]; if (!b || !S.hole) return;
  const xs = S.hole.tiles.map(t => t.cx), zs = S.hole.tiles.map(t => t.cz);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 8;
  const cup = S.hole.cup;
  S.introFrom = { pos: new THREE.Vector3(cx + 3, cup.y + span * 0.75 + 5, cz + span * 0.55), tgt: new THREE.Vector3((cx + cup.x) / 2, cup.y, (cz + cup.z) / 2) };
  S.introUntil = Infinity; S.introArm = true; // the clock starts on the first rendered frame (after shaders compile)
  camera.position.copy(S.introFrom.pos); controls.target.copy(S.introFrom.tgt);
}
function homeCam(b) {
  const t0 = S.hole.tiles[0];
  return { tgt: new THREE.Vector3(b.x, b.y + b.r, b.z), pos: new THREE.Vector3(b.x - t0.d[0] * 7, b.y + 5.5, b.z - t0.d[1] * 7) };
}
function resetCamera() {
  const b = camBall(); if (!b || !S.hole) return;
  const h = homeCam(b);
  controls.target.copy(h.tgt); camera.position.copy(h.pos); controls.update();
}
// ball the camera follows: mine while I'm playing, otherwise whoever I'm spectating
function camBall() {
  const mb = myBall();
  if (mb && !mb.sunk && !mb.out) return mb;
  const act = [...balls().values()].filter(b => !b.sunk && !b.out);
  if (!act.length) return mb;
  let sb = act.find(b => b.id === S.spec);
  if (!sb) { sb = act[0]; S.spec = sb.id; }
  return sb;
}
function cycleSpec(d) {
  const mb = myBall(); if (mb && !mb.sunk && !mb.out) return;
  const act = [...balls().values()].filter(b => !b.sunk && !b.out); if (!act.length) return;
  const i = act.findIndex(b => b.id === S.spec);
  S.spec = act[(i + d + act.length) % act.length].id;
}

// ---------------------------------------------------------------- input: aiming
const aim = { on: false, a: 0, p: 0, hit: new THREE.Vector3() };
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2(); const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function canShoot() {
  const b = myBall(); if (S.phase !== 'playing' || !b || b.sunk || b.out || b.frozen > 0 || !C.isResting(b)) return false;
  const now = performance.now();
  if (now < S.shotLock || now < S.introUntil) return false;
  if (S.isHost) return !(S.sim.intro > 0);
  return b.srvReady && !(now < S.pred.until && b.srvStrokes < S.pred.strokes);
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
  const b = myBall(), s = C.shotSpeed(S.hole, p);
  b.lastX = b.x; b.lastY = b.y; b.lastZ = b.z; b.strokes = (b.srvStrokes ?? b.strokes) + 1;
  b.vx = Math.cos(a) * s; b.vz = Math.sin(a) * s; b.fx = 'putt'; b.fxv = 2 + p * 8;
  S.pred = { strokes: b.strokes, until: performance.now() + 900 + S.ping * 2 };
  send(S.hostConn, { t: 'shot', a, p });
}
function useMyItem() {
  const b = myBall(); if (!b || !b.item || S.phase !== 'playing') return;
  if (S.isHost) useItem(S.myId); else send(S.hostConn, { t: 'use' });
}
let lastEmote = 0;
function emote(i) {
  if (S.screen !== 'game' || performance.now() - lastEmote < 900) return;
  lastEmote = performance.now();
  if (S.isHost) broadcast({ t: 'emote', id: S.myId, i }); else send(S.hostConn, { t: 'emote', i });
}
renderer.domElement.addEventListener('pointerdown', e => {
  SFX.initAudio();
  if (e.button === 2 && aim.on) { aimCancel(); return; }
  if (e.button !== 0) return;
  if (!canShoot()) { const mb = myBall(); if (S.phase === 'playing' && mb && (mb.sunk || mb.out)) cycleSpec(1); return; }
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
document.querySelectorAll('#emotes button').forEach((b, i) => b.addEventListener('click', () => emote(i)));

addEventListener('keydown', e => {
  SFX.initAudio();
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { if (e.key === 'Enter' && e.target.id === 'codeIn') joinRoom(); return; }
  const k = e.key.toLowerCase();
  if (e.key === '`' || e.code === 'Backquote') { $('debug').classList.toggle('hidden'); e.preventDefault(); }
  else if (e.key === 'Escape') aimCancel();
  else if (e.key === 'Tab') { e.preventDefault(); if (S.screen === 'game' && S.phase === 'playing') { $('tabBoard').innerHTML = boardHTML(S.holeIdx, S.holeIdx); $('tabBoard').classList.remove('hidden'); } }
  else if (e.key === ' ' || k === 'c') { if (S.phase === 'playing') resetCamera(); e.preventDefault(); }
  else if (k === 'e') useMyItem();
  else if (k === 'm') toast(SFX.toggleMute() ? '🔇 Sound off' : '🔊 Sound on');
  else if (k === 'g') { S.quality = S.quality === 'low' ? 'high' : 'low'; S.autoQ = false; try { localStorage.setItem('mgb-q', S.quality); } catch { } applyQuality(); toast(`Graphics: ${S.quality}`); }
  else if (e.key === 'ArrowLeft' || k === 'a') cycleSpec(-1);
  else if (e.key === 'ArrowRight' || k === 'd') cycleSpec(1);
  else if (['1', '2', '3', '4'].includes(e.key)) emote(+e.key - 1);
});
addEventListener('keyup', e => { if (e.key === 'Tab') $('tabBoard').classList.add('hidden'); });

// ---------------------------------------------------------------- menu / lobby buttons
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
$('lobbyList').onclick = e => {
  const li = e.target.closest('li'); if (!li || li.dataset.id !== S.myId || S.phase !== 'lobby') return;
  if (S.isHost) cycleColor(S.myId); else send(S.hostConn, { t: 'color' });
};
for (const k of ['mode', 'holes', 'time', 'items', 'bots', 'mods']) $('opt_' + k).onchange = e => {
  if (!S.isHost) return;
  const v = e.target.value;
  S.opts[k] = k === 'holes' || k === 'time' ? +v : k === 'mods' ? v === '1' : v;
  broadcast(lobbyMsg());
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
let lastFrame = performance.now(), fpsFrames = 0, fpsAt = performance.now(), fps = 60, lastSec = 0, slowSecs = 0;
const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const preview = { b: null };
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  fpsFrames++;
  if (now - fpsAt > 1000) {
    fps = Math.round(fpsFrames * 1000 / (now - fpsAt)); fpsFrames = 0; fpsAt = now;
    // auto-drop to low graphics on slow machines
    if (S.autoQ && S.quality !== 'low' && S.screen === 'game') { slowSecs = fps < 24 ? slowSecs + 1 : 0; if (slowSecs >= 5) { S.quality = 'low'; applyQuality(); toast('Graphics set to low for speed (press G to change)'); } }
  }
  const tsec = now / 1000;
  G.animate(tsec); fxp.update(dt);
  weather.update(dt, tsec, controls.target.x, controls.target.y, controls.target.z);
  if (flagMesh) flagMesh.userData.wave(tsec);
  for (const p of portalMeshes) { p.ring.scale.setScalar(1 + Math.sin(tsec * 4) * 0.06); p.glow.material.opacity = 0.45 + Math.sin(tsec * 3) * 0.2; }
  for (const r of rings) { r.t += dt; r.m.scale.setScalar(1 + r.t * r.grow); r.m.material.opacity = Math.max(0, 0.9 - r.t * 1.8); }
  rings = rings.filter(r => { if (r.t > 0.5) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); return false; } return true; });

  if (S.screen !== 'game' && course && demoHole) {
    // slow fly-around of the demo course
    const h = demoHole; const xs = h.tiles.map(t => t.cx), zs = h.tiles.map(t => t.cz);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, a = tsec * 0.08;
    controls.target.set(cx, 0, cz); camera.position.set(cx + Math.cos(a) * 24, 13, cz + Math.sin(a) * 24);
    for (const { mv, g } of moverMeshes) { const p = C.moverPose(mv, tsec); g.position.x = p.x; g.position.z = p.z; g.rotation.y = -p.a; }
    pickupMeshes.forEach(({ m, q, pk }) => { m.rotation.y += dt * 1.5; m.position.y = q.position.y = pk.y + 0.45 + Math.sin(tsec * 2.5) * 0.08; });
  }
  if (S.screen === 'game' && S.hole) {
    const intro = now < S.introUntil;
    if (S.isHost && S.sim) { S.timeLeft = S.sim.timeLeft; S.pick = S.sim.pick.map(p => p.on ? 1 : 0); S.mines = S.sim.mines.map(m => [m.x, m.y, m.z]); }
    else { clientStep(dt); if (S.phase === 'playing' && !intro) S.timeLeft = Math.max(0, S.timeLeft - dt); }
    const ht = S.isHost ? (S.sim ? S.sim.t : 0) : (S.csim ? S.csim.t : 0);
    for (const { mv, g } of moverMeshes) { const p = C.moverPose(mv, ht); g.position.x = p.x; g.position.z = p.z; g.rotation.y = -p.a; }
    pickupMeshes.forEach(({ m, q, pk }, i) => { const on = !!S.pick[i]; m.visible = q.visible = on; m.rotation.y += dt * 1.5; m.position.y = q.position.y = pk.y + 0.45 + Math.sin(tsec * 2.5 + i) * 0.08; });
    mineMeshes.forEach((g, i) => { const m = S.mines[i]; g.visible = !!m; if (m) g.position.set(m[0], m[1], m[2]); });
    const bs = balls(), cup = S.hole.cup, pod = S.phase === 'matchEnd' ? S.podium : null;
    for (const [id, bm] of ballMeshes) {
      const { ball, label, trail } = bm;
      const b = bs.get(id); if (!b) { ball.visible = label.visible = false; continue; }
      const gone = S.players.find(p => p.id === id)?.gone;
      const sc = b.r / C.BALL_R;
      if (pod) {
        const p = pod.pos.get(id); ball.visible = label.visible = !!p && !gone; trail.mesh.visible = false;
        if (p) { const hop = id === pod.win ? Math.abs(Math.sin(tsec * 5)) * 0.35 : 0; ball.scale.setScalar(1); ball.position.set(p.x, p.y + C.BALL_R + hop, p.z); label.position.set(p.x, p.y + C.BALL_R + 0.5 + hop, p.z); ball.material.opacity = 1; }
        continue;
      }
      // sink animation: drop into the cup instead of vanishing
      if (b.sunk && !bm.wasSunk) bm.sink = 0.4;
      bm.wasSunk = b.sunk;
      if (bm.sink > 0) {
        bm.sink -= dt; const k = Math.max(0, bm.sink / 0.4);
        ball.visible = true; label.visible = false; ball.scale.setScalar(sc * (0.6 + 0.4 * k)); ball.position.set(cup.x, cup.y + b.r * k - 0.25 * (1 - k), cup.z);
      } else {
        const vis = !b.sunk && !gone;
        ball.visible = vis; label.visible = vis;
        ball.scale.setScalar(sc); ball.position.set(b.x, b.y + b.r, b.z); label.position.set(b.x, b.y + b.r * 2 + 0.25, b.z);
        ball.rotation.x += b.vz * dt / b.r; ball.rotation.z -= b.vx * dt / b.r;
      }
      ball.material.emissive.set(b.frozen > 0 ? '#3aa8ff' : b.sticky > 0 ? '#2f7a00' : b.magnet > 0 ? '#a01818' : '#000000');
      ball.material.opacity = b.ghost > 0 ? 0.4 : 1;
      trail.update(b.x, b.y, b.z, b.r, Math.hypot(b.vx, b.vz), !b.sunk && !gone);
      if (b.fx) {
        if (b.fx === 'land' && b.fxv > 3) fxp.emit(b.x, b.y + 0.05, b.z, 10, ['#d9c9a3', '#bfae86', '#ffffff'], 1.5, 1.2, 0.5, 6);
        if (b.fx === 'putt') fxp.emit(b.x, b.y + 0.05, b.z, 6, ['#ffffff', '#c8f5c8'], 0.8, 0.8, 0.35, 4);
        if (b.fx === 'sand') fxp.emit(b.x, b.y + 0.05, b.z, 14, ['#ecd6a0', '#d9bf85', '#fff1cc'], 1.6, 1.6, 0.5, 7);
        if (b.fx === 'boost') fxp.emit(b.x, b.y + 0.1, b.z, 14, ['#ffe14d', '#ffffff', '#ff9f43'], 2, 1, 0.4, 2);
        if (b.fx === 'bumper' || (b.fx === 'wall' && b.fxv > 6)) fxp.emit(b.x, b.y + 0.1, b.z, 6, ['#ffffff', '#ffe9a8'], 1.5, 1, 0.3, 3);
        if (b.fx === 'portal') { for (const p of [b.tp || [b.x, b.y, b.z], [b.x, b.y, b.z]]) { fxp.emit(p[0], p[1] + 0.2, p[2], 26, ['#7fdcff', '#ffb347', '#ffffff'], 2, 2.5, 0.6, 2); spawnRing(p[0], p[1], p[2], '#ffffff', 4); } }
        SFX.play(b.fx === 'sand' ? 'land' : b.fx === 'boost' || b.fx === 'portal' ? 'use' : b.fx, Math.min(1, b.fxv / 8) * near(b.x, b.z), id);
        b.fx = null; b.fxv = 0;
      }
    }
    bubbles = bubbles.filter(bb => { bb.t += dt; const bm = ballMeshes.get(bb.id); if (bb.t > 2.4 || !bm) { course && course.remove(bb.sp); bb.sp.material.map.dispose(); bb.sp.material.dispose(); return false; } const p = bm.ball.position; bb.sp.position.set(p.x, p.y + 1.0 + Math.min(0.2, bb.t), p.z); bb.sp.material.opacity = Math.min(1, (2.4 - bb.t) * 3); return true; });

    // camera
    const mb = myBall(), cb = camBall();
    if (pod) {
      const a = (now - pod.t0) / 1000 * 0.35;
      // keep the podium in the left half of the screen (the scorecard sits on the right)
      const ox = Math.sin(a) * 2.2, oz = -Math.cos(a) * 2.2;
      controls.target.lerp(new THREE.Vector3(pod.c.x + ox, pod.c.y, pod.c.z + oz), Math.min(1, dt * 3));
      camera.position.lerp(new THREE.Vector3(pod.c.x + ox + Math.cos(a) * 7, pod.c.y + 3, pod.c.z + oz + Math.sin(a) * 7), Math.min(1, dt * 2.5));
      if (Math.random() < dt * 5) fxp.emit(pod.c.x + (Math.random() - 0.5) * 2.5, pod.c.y + 2.6, pod.c.z + (Math.random() - 0.5) * 2.5, 10, ['#ff5c5c', '#ffd43b', '#4dabff', '#2ee6a8', '#ff7ad9', '#ffffff'], 1.2, 0.5, 2.2, 2.5);
    } else if (intro && S.introFrom && cb) {
      const k = sm(1 - (S.introUntil - now) / (INTRO_SECS * 1000)), h = homeCam(cb);
      camera.position.lerpVectors(S.introFrom.pos, h.pos, k); controls.target.lerpVectors(S.introFrom.tgt, h.tgt, k);
    } else if (cb) {
      const sunk = cb === mb && mb.sunk;
      const tgt = new THREE.Vector3(sunk ? cup.x : cb.x, (sunk ? cup.y : cb.y) + cb.r, sunk ? cup.z : cb.z);
      const d = tgt.sub(controls.target).multiplyScalar(Math.min(1, dt * 6));
      controls.target.add(d); camera.position.add(d);
    }
    if (turnRing) {
      const ready = mb && canShoot();
      turnRing.visible = !!ready;
      if (ready) { turnRing.position.set(mb.x, mb.y + 0.014, mb.z); turnRing.scale.setScalar(mb.r / C.BALL_R * (1 + Math.sin(tsec * 5) * 0.12)); }
    }
    // aim: dotted preview of the real trajectory (first ~0.85s, including bounces)
    if (aim.on && mb) {
      const y = mb.y + mb.r;
      aimMat.color.setHSL((1 - aim.p) * 0.33, 0.9, 0.55);
      aimGroup.visible = true;
      const pb = preview.b = Object.assign(preview.b || {}, mb, { fx: null, hold: false, tp: null });
      const s = C.shotSpeed(S.hole, aim.p); pb.vx = Math.cos(aim.a) * s; pb.vz = Math.sin(aim.a) * s;
      let n = 0, done = false;
      for (let k = 0; k < 52; k++) {
        if (!done && (C.stepBall(S.hole, pb, ht + k / 60, 1 / 60) || C.isResting(pb))) done = true;
        if (k % 2 === 1) { const d = aimDots[n++]; d.visible = !done; d.position.set(pb.x, pb.y + pb.r, pb.z); d.scale.setScalar(1.25 - 0.6 * k / 52); }
      }
      pullLine.visible = true;
      pullLine.geometry.setFromPoints([new THREE.Vector3(mb.x, y, mb.z), new THREE.Vector3(aim.hit.x, y, aim.hit.z)]);
      $('powerFill').style.width = (aim.p * 100).toFixed(0) + '%';
    }
    const sec = Math.ceil(S.timeLeft);
    if (S.phase === 'playing' && sec !== lastSec && sec <= 5 && sec > 0) SFX.play('tick');
    lastSec = sec;
    updateHud(mb, cb);
  }
  controls.update();
  if (post && S.quality !== 'low') post.composer.render(); else renderer.render(scene, camera);
  if (S.introArm && S.screen === 'game' && S.hole) {
    S.introArm = false; S.introUntil = performance.now() + INTRO_SECS * 1000;
    if (S.isHost && S.sim) S.sim.intro = INTRO_SECS + 0.3;
    showIntro(S.hole);
  }
  if (!$('debug').classList.contains('hidden') && now - (frame.dbg || 0) > 250) { frame.dbg = now; updateDebug(); }
}

function updateHud(mb, cb) {
  const hole = S.hole, th = G.THEMES[hole.themeIdx], mod = C.MODS[hole.mod].name;
  $('holeInfo').textContent = `Hole ${S.holeIdx + 1}/${S.opts.holes} · Par ${hole.par}`;
  $('strokeInfo').textContent = speedMode() ? `Speed Golf · Strokes ${mb ? mb.strokes : 0}` : `Strokes ${mb ? mb.strokes : 0} / ${C.MAX_STROKES}`;
  $('modChip').textContent = th.name + (mod ? ` · ⚡ ${mod}` : '');
  const tl = Math.ceil(S.timeLeft), intro = performance.now() < S.introUntil;
  $('timer').textContent = S.phase === 'playing' ? tl : '';
  $('timer').classList.toggle('low', tl <= 10);
  const spec = mb && (mb.sunk || mb.out) && cb && cb !== mb;
  $('hint').textContent = S.phase !== 'playing' || !mb ? '' : intro ? 'Get ready…' : spec ? `Spectating ${pname(cb.id)} — click or ←/→ to switch` : mb.sunk ? 'Sunk! 🎉' : mb.out ? 'Out of strokes' :
    mb.frozen > 0 ? `❄️ Frozen ${Math.ceil(mb.frozen)}s` : aim.on ? 'Release to shoot · right-click/Esc to cancel' : canShoot() ? 'Your shot! Click & drag back from your ball' : 'Ball rolling…';
  if (!frame.liveAt || performance.now() - frame.liveAt > 200) {
    frame.liveAt = performance.now();
    const bs = balls();
    $('live').innerHTML = '<div class="hdr"><span class="s">hole</span><span class="tot">total</span></div>' + S.players.filter(p => !p.pending).map(p => {
      const b = bs.get(p.id);
      const st = !b ? '' : b.sunk ? `${b.strokes} ✓` : b.out ? `${b.strokes} ✗` : b.strokes;
      const fx = !b ? '' : (b.big > 0 ? '🔴' : '') + (b.sticky > 0 ? '🟢' : '') + (b.magnet > 0 ? '🧲' : '') + (b.ghost > 0 ? '👻' : '') + (b.frozen > 0 ? '❄️' : '') + (b.item ? '🎁' : '');
      return `<div><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === S.myId ? ' (you)' : ''} ${fx}<span class="s">${st}</span><span class="tot">${total(p)}</span></div>`;
    }).join('') + `<div class="foot">Tab scores · 1-4 emotes · M sound · G graphics</div>`;
    const slot = $('itemSlot');
    const effs = mb ? [['big', 'BIG'], ['sticky', 'STICKY'], ['magnet', 'MAGNET'], ['ghost', 'GHOST']].filter(([k]) => mb[k] > 0) : [];
    if (mb && (mb.item || effs.length)) {
      slot.classList.remove('hidden');
      const it = C.ITEMS[mb.item];
      slot.innerHTML = (it ? `<div class="big">${it.i}</div><b>[E] ${it.n}</b><div class="desc">${it.d}</div>` : '') + effs.map(([k, n]) => `<div class="eff">${n} ${Math.ceil(mb[k])}s</div>`).join('');
      slot.classList.toggle('ready', !!mb.item);
    } else slot.classList.add('hidden');
  }
  if (S.phase === 'holeEnd' && S.boardEndsAt) $('boardMsg').textContent = `Next hole in ${Math.max(0, Math.ceil((S.boardEndsAt - performance.now()) / 1000))}…`;
}

function updateDebug() {
  const role = S.isHost ? (S.online ? 'host' : 'offline host') : 'client (predicting)';
  $('debug').textContent =
    `FPS     ${fps} (${S.quality} graphics)\n` +
    `Ping    ${S.isHost ? '0 ms (you are host)' : Math.round(S.ping) + ' ms'}\n` +
    `Players ${S.players.length} (${S.players.filter(p => p.bot).length} bots, ${S.isHost ? S.conns.size : '?'} remote)\n` +
    `Role    ${role}${S.code ? ' · room ' + S.code : ''}\n` +
    `Phase   ${S.phase} · hole ${S.holeIdx + 1}/${S.opts.holes} · ${S.opts.mode}\n` +
    `Hole    seed ${S.hole ? S.hole.seed : '-'} · ${S.hole ? S.hole.theme + ' · ' + S.hole.mod : ''}`;
}

applyQuality();
buildDemo();
requestAnimationFrame(frame);
window.__golf = { S, C, applyShot, useItem, balls };
