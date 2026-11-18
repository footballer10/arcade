// PARTY HUB — the single page that owns the party connection for the whole session.
// Lobby → choose game (host picks / vote / shuffle) → pre-round picks → loading → shared countdown → play
// → results (+trophies) → lobby. Games are loaded with import() and unloaded when done; the page never reloads.
import * as THREE from 'three';
import { PartyNet, randomCode, prewarm } from './net.js';
import { iceCheck } from './transport-peer.js';
import { settings, store } from './settings.js';
import { audio, startMusic, stopMusic } from './audio.js';
import { input, CONTROL_MAP } from './input.js';
import { $, el, esc, toast, banner, countdown, clearCenter, tableHTML } from './ui.js';
import { buildAvatar, disposeAvatar, HATS, HAT_LABELS, SKINS, HAIRS, HAIR_LABELS, HAIR_COLORS } from './avatar.js';
import { PALETTE, css } from './palette.js';
import { makeBot, BOT_LEVELS } from './bots.js';
import { randomSeed } from './rng.js';
import { GameRuntime, liveStats } from './runtime.js';
import { DEV_HOST } from './tune.js';
import { GAMES, GAME_MAP, loadGame } from '../games/registry.js';

const params = new URLSearchParams(location.search);
const TROPHY_POINTS = [5, 3, 2];                       // 1st, 2nd, 3rd — everyone else gets 1
const MAX_PARTY = 8, GRACE_MS = 60000;
const SESSION_KEY = 'partyhub.session', SAVE_KEY = 'partyhub.saved';
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const MEDAL = ['🥇', '🥈', '🥉'];
const ss = { get: (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } }, del: (k) => { try { sessionStorage.removeItem(k); } catch { /* */ } } };

// ---------------------------------------------------------------- identity (per tab; survives refresh)
let pid = ss.get('partyhub.pid');
if (!pid) { pid = 'p' + Math.random().toString(36).slice(2, 9); ss.set('partyhub.pid', pid); }
try { // "Duplicate tab" copies sessionStorage: make sure no other open tab uses our id.
  const bc = new BroadcastChannel('partyhub-pid');
  bc.onmessage = (e) => { if (e.data?.q === pid) bc.postMessage({ taken: pid }); if (e.data?.taken === pid && !net) { pid = 'p' + Math.random().toString(36).slice(2, 9); ss.set('partyhub.pid', pid); ss.del(SESSION_KEY); } };
  bc.postMessage({ q: pid });
} catch { /* */ }

// ---------------------------------------------------------------- state
let net = null;          // PartyNet for the current party
let lastFail = '';       // what went wrong in the last failed join (Copy details)
let S = null;            // party state (host: authoritative; clients: mirror of the host's)
let runtime = null, mountingRound = null, pings = {};
const chat = [];
const isHost = () => !!net?.isHost;
const me = () => S?.players.find((p) => p.id === pid);
const find = (id) => S?.players.find((p) => p.id === id);
const humans = () => S.players.filter((p) => !p.isBot);
const connectedHumans = () => S.players.filter((p) => !p.isBot && p.connected);
const hnow = () => (net ? net.now() : performance.now());
// Online (PeerJS) always, except ?net=local (automated tests) or the offline fallback for Play Solo.
let forceLocal = params.get('net') === 'local';
const netKind = () => (forceLocal ? 'local' : 'peer');
const profile = () => ({ name: (settings.get('name') || '').trim().slice(0, 14) || 'Player', color: settings.get('color'), hat: settings.get('hat'), skin: settings.get('skin'), hair: settings.get('hair'), hairColor: settings.get('hairColor') });

// ---------------------------------------------------------------- screens
const SCREENS = ['home', 'lobby', 'setup', 'loading', 'results', 'podium'];
let screen = null;
function show(name) {
  screen = name;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
  document.body.dataset.screen = name || 'game';
  stageSync();
  musicSync();
}
function openOverlay(id) { $(id).classList.remove('hidden'); if (id === 'settings') syncSettingsUI(); if (id === 'controls') renderControls(); if (id === 'profile') renderProfile(); input.setEnabled(false); stageSync(); }
function closeOverlay(id) { $(id).classList.add('hidden'); if (!anyOverlay()) input.setEnabled(true); stageSync(); }
const anyOverlay = () => ['pause', 'settings', 'controls', 'profile'].some((id) => !$(id).classList.contains('hidden')) || !$('chatBox').classList.contains('hidden');
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]'); if (o) { audio.play('click'); openOverlay(o.dataset.open); }
  const c = e.target.closest('[data-close]'); if (c) { audio.play('click'); closeOverlay(c.closest('.ph-screen').id); }
});
addEventListener('pointerdown', () => { audio.unlock(); musicSync(); }, { capture: true });
addEventListener('keydown', () => { audio.unlock(); }, { capture: true });
function musicSync() { if (!runtime && audio.ready) startMusic(); else stopMusic(); }

// ---------------------------------------------------------------- hub 3D stage (avatar previews, podium)
const stage = { renderer: null, scene: null, camera: null, items: [], key: '', mode: '', t: 0, confetti: null };
function stageInit() {
  if (stage.renderer) return;
  const r = new THREE.WebGLRenderer({ canvas: $('hubCanvas'), antialias: true, alpha: true });
  r.setPixelRatio(Math.min(2, devicePixelRatio)); r.shadowMap.enabled = true;
  stage.renderer = r; stage.scene = new THREE.Scene(); stage.camera = new THREE.PerspectiveCamera(35, 2, 0.1, 100);
  stage.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899cc, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 1.8); d.position.set(3, 6, 5); stage.scene.add(d);
  requestAnimationFrame(stageLoop);
}
function stageTarget() {
  if (runtime || document.body.classList.contains('in-game')) return null;
  if (!$('profile').classList.contains('hidden')) return { el: $('profileAvatar'), mode: 'me', z: 61 };
  if (anyOverlay()) return null;
  if (screen === 'home') return { el: $('homeAvatar'), mode: 'me', z: 40 };
  if (screen === 'lobby') return { el: $('lobbyAvatars'), mode: 'party', z: 40 };
  if (screen === 'podium') return { el: $('podiumStage'), mode: 'podium', z: 40 };
  return null;
}
function stageSync() { stageInit(); const t = stageTarget(); $('hubCanvas').style.display = t ? 'block' : 'none'; }
function stageBuild(mode) {
  let list = [];
  if (mode === 'me') list = [{ id: pid, ...profile(), color: me()?.color ?? (settings.get('color') >= 0 ? settings.get('color') : 1), hat: me()?.hat ?? settings.get('hat') }];
  else if (mode === 'party') list = S ? S.players.filter((p) => p.connected) : [];
  else if (mode === 'podium') list = (S?.podium?.top || []).map((t) => find(t.id) || t).filter(Boolean);
  const key = mode + '|' + list.map((p) => [p.id, p.color, p.hat, p.skin, p.hair, p.hairColor].join(':')).join(',');
  if (key === stage.key) return;
  stage.key = key; stage.mode = mode;
  for (const it of stage.items) disposeAvatar(it);
  stage.items = [];
  stage.scene.children.filter((o) => o.userData.podium).forEach((o) => { o.removeFromParent(); o.geometry?.dispose(); o.material?.dispose(); });
  const n = list.length;
  list.forEach((p, i) => {
    const a = buildAvatar(p);
    if (mode === 'podium') {
      const place = i; const x = [0, -2.2, 2.2][place], h = [1.6, 1.1, 0.7][place];
      const block = new THREE.Mesh(new THREE.BoxGeometry(1.9, h, 1.6), new THREE.MeshToonMaterial({ color: [0xffd23f, 0xd9e2f2, 0xe59a5c][place] }));
      block.position.set(x, h / 2 - 1.2, 0); block.userData.podium = true; stage.scene.add(block);
      a.position.set(x, h - 1.2, 0.1);
    } else {
      const sp = mode === 'me' ? 0 : 1.15;
      a.position.set((i - (n - 1) / 2) * sp, mode === 'me' ? -0.95 : -0.85, 0);
    }
    a.userData.phase = i * 0.7;
    stage.scene.add(a); stage.items.push(a);
  });
  if (mode === 'party') {
    const row = $('lobbyAvatars'); row.querySelectorAll('.name').forEach((e) => e.remove());
    stage.labels = list.map((p) => { const e = el('div', 'name'); e.textContent = p.name; row.appendChild(e); return e; });
  } else stage.labels = [];
}
function stageLoop(now) {
  requestAnimationFrame(stageLoop);
  const t = stageTarget();
  if (!t) return;
  const r = t.el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return;
  const c = $('hubCanvas');
  c.style.left = r.left + 'px'; c.style.top = r.top + 'px'; c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; c.style.zIndex = t.z;
  const w = Math.round(r.width), h = Math.round(r.height);
  const size = stage.renderer.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) stage.renderer.setSize(w, h, false);
  stageBuild(t.mode);
  const cam = stage.camera; cam.aspect = w / h;
  if (t.mode === 'me') { cam.fov = 30; cam.position.set(0, 0.75, 4.7); cam.lookAt(0, 0.02, 0); }
  else if (t.mode === 'party') {
    const span = stage.items.length * 1.15 + 0.5, tan = Math.tan(15 * Math.PI / 180);
    cam.fov = 30; cam.position.set(0, 0.25, Math.max(2.3 / (2 * tan), span / (2 * tan * (w / h))) + 0.5); cam.lookAt(0, -0.05, 0);
  }
  else { cam.fov = 38; cam.position.set(0, 1.4, 9); cam.lookAt(0, 0.2, 0); }
  cam.updateProjectionMatrix();
  const ts = now / 1000;
  stage.items.forEach((a, i) => {
    a.rotation.y = t.mode === 'me' ? Math.sin(ts * 0.8) * 0.5 : Math.sin(ts * 0.7 + a.userData.phase) * 0.35;
    a.userData.setPose({ t: ts + a.userData.phase, run: 0, jump: t.mode === 'podium' && i === 0 ? Math.abs(Math.sin(ts * 3)) * 0.35 : 0 });
  });
  stage.renderer.render(stage.scene, cam);
  if (t.mode === 'party') stage.items.forEach((a, i) => {
    const v = new THREE.Vector3(a.position.x, -0.95, 0).project(cam), lab = stage.labels[i];
    if (lab) { lab.style.left = ((v.x + 1) / 2 * 100) + '%'; lab.style.top = ((1 - v.y) / 2 * 100) + '%'; lab.style.bottom = 'auto'; lab.style.maxWidth = Math.max(60, (r.width / Math.max(1, stage.items.length)) - 4) + 'px'; }
  });
}

// ---------------------------------------------------------------- home / profile
const LOOKS = [['skin', SKINS.length], ['hairColor', HAIR_COLORS.length]];
function buildLookPickers(skinId, hairId, hairColId) {
  const hx = (n) => '#' + n.toString(16).padStart(6, '0');
  $(skinId).innerHTML = SKINS.map((c, i) => `<button data-v="${i}" style="background:${hx(c)}" title="Skin tone"></button>`).join('');
  $(hairColId).innerHTML = HAIR_COLORS.map((c, i) => `<button data-v="${i}" style="background:${hx(c)}" title="Hair color"></button>`).join('');
  $(hairId).innerHTML = HAIRS.map((h) => `<button data-v="${h}">${HAIR_LABELS[h]}</button>`).join('');
  $(skinId).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; audio.play('click'); settings.set('skin', +b.dataset.v); profileChanged(); };
  $(hairColId).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; audio.play('click'); settings.set('hairColor', +b.dataset.v); profileChanged(); };
  $(hairId).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; audio.play('click'); settings.set('hair', b.dataset.v); profileChanged(); };
}
function buildPickers(colorId, hatId) {
  $(colorId).innerHTML = PALETTE.map((_, i) => `<button data-c="${i}" style="background:${css(i)}" title="Color"></button>`).join('');
  $(hatId).innerHTML = HATS.map((h) => `<button data-h="${h}">${HAT_LABELS[h]}</button>`).join('');
  $(colorId).onclick = (e) => { const b = e.target.closest('button'); if (!b || b.classList.contains('taken')) return; audio.play('click'); settings.set('color', +b.dataset.c); profileChanged(); };
  $(hatId).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; audio.play('click'); settings.set('hat', b.dataset.h); profileChanged(); };
}
function renderProfile() {
  const myColor = me()?.color ?? settings.get('color');
  const taken = new Set(S ? S.players.filter((p) => p.id !== pid).map((p) => p.color) : []);
  for (const id of ['colorPick', 'colorPick2']) for (const b of $(id).children) { b.classList.toggle('sel', +b.dataset.c === myColor); b.classList.toggle('taken', taken.has(+b.dataset.c)); }
  for (const id of ['hatPick', 'hatPick2']) for (const b of $(id).children) b.classList.toggle('sel', b.dataset.h === (me()?.hat ?? settings.get('hat')));
  for (const [k, ids] of [['skin', ['skinPick', 'skinPick2']], ['hairColor', ['hairColPick', 'hairColPick2']], ['hair', ['hairPick', 'hairPick2']]]) for (const id of ids) for (const b of $(id).children) b.classList.toggle('sel', String(settings.get(k)) === b.dataset.v);
  if (document.activeElement !== $('nameIn')) $('nameIn').value = settings.get('name');
  if (document.activeElement !== $('nameIn2')) $('nameIn2').value = settings.get('name');
}
let profileT = 0;
function profileChanged() {
  renderProfile(); stage.key = '';
  clearTimeout(profileT);
  profileT = setTimeout(() => { if (S) act({ type: 'profile', ...profile() }); }, 150);
}
buildPickers('colorPick', 'hatPick'); buildPickers('colorPick2', 'hatPick2');
buildLookPickers('skinPick', 'hairPick', 'hairColPick'); buildLookPickers('skinPick2', 'hairPick2', 'hairColPick2');
for (const id of ['nameIn', 'nameIn2']) $(id).addEventListener('input', () => { settings.set('name', $(id).value.trim().slice(0, 14)); profileChanged(); });
if (settings.get('color') < 0) settings.set('color', Math.floor(Math.random() * 8));
if (settings.get('skin') < 0) settings.set('skin', Math.floor(Math.random() * SKINS.length));
if (!HAIRS.includes(settings.get('hair'))) settings.set('hair', HAIRS[Math.floor(Math.random() * (HAIRS.length - 1))]);
if (settings.get('hairColor') < 0) settings.set('hairColor', Math.floor(Math.random() * HAIR_COLORS.length));
renderProfile();

function homeMsg(t) { $('homeMsg').textContent = t || ''; }
function busy(b) { for (const id of ['createBtn', 'joinBtn', 'joinLinkBtn', 'soloBtn']) $(id).disabled = b; }
$('createBtn').onclick = () => { audio.play('click'); createParty(); };
// Solo: straight into a lobby with 3 bots. Uses the online party (so friends can still join with the code);
// if the PeerJS server can't be reached it quietly falls back to same-computer mode so solo always works.
$('soloBtn').onclick = async () => {
  audio.play('click');
  let ok = await createParty();
  if (!ok) { forceLocal = true; ok = await createParty(); forceLocal = params.get('net') === 'local'; }   // server unreachable: offline solo
  if (!ok) return;
  for (let i = 0; i < 3; i++) act({ type: 'bot+' });
  toast('Solo party with 3 bots — pick a game and press Start!', 'good', 4000);
};
$('joinBtn').onclick = () => { audio.play('click'); joinParty($('codeIn').value); };
$('joinLinkBtn').onclick = () => { audio.play('click'); joinParty(params.get('room')); };
$('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinParty($('codeIn').value); });
function needName() { if (!settings.get('name')) { settings.set('name', 'Player' + Math.floor(10 + Math.random() * 89)); renderProfile(); } }

// ---------------------------------------------------------------- connecting
function newNet(kind) {
  const n = new PartyNet(kind, pid);
  n.on('msg', onMsg);
  n.on('status', (st) => {
    $('reconnect').classList.toggle('hidden', st !== 'reconnecting');
    $('reconnectText').textContent = runtime ? 'Host left — switching host…' : 'Connection lost — reconnecting…';
    if (st === 'offline') { leaveParty('Lost connection to the party.'); }
  });
  n.on('kicked', (reason) => leaveParty(reason));
  n.on('host', onHostChange);
  n.on('peerjoin', onPeerJoin);
  n.on('peerleave', onPeerLeave);
  n.onHello = admit;
  return n;
}
function setUrl(code, kind) {
  const q = new URLSearchParams();
  if (code) q.set('room', code);
  if (kind === 'local') q.set('net', 'local');
  for (const k of ['peer', 'relay', 'forcerelay', 'dev', 'testfps', 'netlog', 'portal']) if (params.get(k) !== null) q.set(k, params.get(k));
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
}
function shareLink() {
  const q = new URLSearchParams({ room: S.code });
  if (net.kind === 'local') q.set('net', 'local');
  for (const k of ['peer', 'relay', 'dev']) if (params.get(k) !== null) q.set(k, params.get(k));
  return location.origin + location.pathname + '?' + q;
}

async function createParty(code = null, restored = null) {
  needName(); busy(true); homeMsg('Creating party…');
  const kind = restored?.net || netKind();
  net = newNet(kind);
  try { await net.host(code); } catch (e) {
    net.leave(); net = null; busy(false);
    homeMsg('Could not reach the game server (' + (e.type || e.message) + '). Check your internet connection and try again.');
    return false;
  }
  busy(false); homeMsg('');
  S = restored ? { ...restored, code: net.code, hostId: pid, net: kind } : {
    v: 0, code: net.code, hostId: pid, net: kind, phase: 'lobby', mode: 'pick', shuffleLen: 5, pick: GAMES[0].id, votes: {},
    botLevel: 'normal', round: 0, game: null, results: null, shuffle: null, podium: null, history: [], banned: [], players: [],
  };
  if (!restored) addHuman(pid, { addr: net.addr, ...profile() });
  else { const m = me(); if (m) { m.connected = true; m.addr = net.addr; } for (const p of S.players) if (!p.isBot && p.id !== pid) { p.connected = false; p.leftAt = performance.now(); } }
  ss.set(SESSION_KEY, { code: net.code, net: kind });
  setUrl(net.code, kind);
  commit();
  return true;
}
async function joinParty(code, quiet = false) {
  code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) { homeMsg('Enter the 4-letter party code.'); return false; }
  needName(); busy(true); if (!quiet) homeMsg('Joining ' + code + '…');
  const kind = netKind();
  net = newNet(kind);
  const stage = (st) => { if (!quiet) homeMsg(st === 'server' ? 'Connecting to the game server…' : `Connecting to party ${code}… (can take up to 20 s on some networks)`); };
  $('failReport').classList.add('hidden');
  try { await net.join(code, { ...profile(), rejoin: !!ss.get(SESSION_KEY) }, stage); } catch (e) {
    lastFail = [`Join failed: party ${code} at ${new Date().toISOString()}`, `error: ${e.type || ''} ${e.reason || e.message || ''}`,
      `direct link: ${net.t?.peerOk === false ? 'server UNREACHABLE' : e.directErr || (e.ice ? `${e.type} · ${e.ice}` : '-')}`,
      `relay: ${net.t?.relayOk === false ? 'no relay server reachable' : e.relayErr || '-'} · servers: ${net.t?.relayInfo?.() || '-'}`, `browser: ${navigator.userAgent}`].join('\n');
    net.leave(); net = null; busy(false);
    const msg = e.reason
      || (e.type === 'peer-unavailable' ? `No party with code ${code}. Check the code, and make sure the host still has the game open.`
      : e.type === 'timeout' || e.type === 'closed' || e.type === 'ice-failed' ? `Found party ${code} but couldn't connect to it: neither the direct link nor the backup relay got through. Try again in a moment. If it keeps happening, press Copy details and send it to whoever looks after the arcade.`
      : e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' ? 'Could not reach the game server. Check your internet connection and try again.'
      : 'Could not join: ' + (e.message || e.type));
    if (!quiet) { homeMsg(msg); if (!e.reason) $('failReport').classList.remove('hidden'); }
    return e.reason ? 'rejected' : false;
  }
  busy(false); homeMsg('');
  ss.set(SESSION_KEY, { code, net: kind });
  setUrl(code, kind);
  $('reconnect').classList.add('hidden');
  return true;
}
function leaveParty(msg = '') {
  unmountGame();
  if (net) { const n = net; net = null; n.leave(); }
  S = null; ss.del(SESSION_KEY); ss.del(SAVE_KEY);
  setUrl(null);
  $('reconnect').classList.add('hidden');
  for (const id of ['pause', 'settings', 'controls', 'profile', 'scoreboard']) $(id).classList.add('hidden');
  input.setEnabled(true);
  show('home'); $('joinBox').classList.add('hidden'); homeMsg(msg);
  setTimeout(() => { if (!net) prewarm(netKind()); }, 1000);
}

// ---------------------------------------------------------------- host: admission & roster
function freeColor(pref) {
  const used = new Set(S.players.map((p) => p.color));
  if (pref >= 0 && pref < 8 && !used.has(pref)) return pref;
  for (let i = 0; i < 8; i++) if (!used.has(i)) return i;
  return 0;
}
function addHuman(id, h) {
  S.players.push({ id, name: cleanName(h.name), color: freeColor(h.color), hat: HATS.includes(h.hat) ? h.hat : 'cap', ...cleanLooks(h), isBot: false, connected: true, ready: false, trophies: 0, wins: 0, addr: h.addr, joinedAt: Date.now() });
}
const cleanLooks = (h) => ({
  skin: Number.isInteger(h.skin) && h.skin >= 0 && h.skin < SKINS.length ? h.skin : 1,
  hair: HAIRS.includes(h.hair) ? h.hair : 'short',
  hairColor: Number.isInteger(h.hairColor) && h.hairColor >= 0 && h.hairColor < HAIR_COLORS.length ? h.hairColor : 0,
});
const cleanName = (n) => String(n || 'Player').replace(/[<>]/g, '').trim().slice(0, 14) || 'Player';
function admit(id, hello) {
  if (!S) return { ok: false, reason: 'Party is starting, try again.' };
  if (S.banned.includes(id)) return { ok: false, reason: 'You were removed from this party.' };
  if (find(id)) return { ok: true };
  if (S.players.length >= MAX_PARTY) {
    const bot = [...S.players].reverse().find((p) => p.isBot && !(S.game?.participants || []).includes(p.id));
    if (!bot) return { ok: false, reason: 'This party is full (8 players).' };
    S.players = S.players.filter((p) => p !== bot);
  }
  return { ok: true };
}
function onPeerJoin(id, hello, via = 'direct') {
  const p = find(id);
  if (p) {
    const was = p.connected;
    p.connected = true; p.addr = hello.addr; p.via = via; delete p.leftAt;
    if (!was) { sys(`${p.name} reconnected`); runtime?.emit('rejoin', id); }
  } else {
    addHuman(id, hello); find(id).via = via;
    sys(`${cleanName(hello.name)} joined the party${via === 'relay' ? ' (via relay)' : ''}`); audio.play('join');
  }
  commit();
}
function onPeerLeave(id) {
  const p = find(id); if (!p || !S) return;
  p.connected = false; p.leftAt = performance.now(); p.ready = false;
  sys(`${p.name} disconnected`); audio.play('leave');
  runtime?.emit('leave', id);
  commit();
}
function onHostChange(hostPid, amI, info = {}) {
  if (!S) return;
  if (amI) {
    const off = info.offset || 0;            // deadlines were in the old host's clock
    if (S.game) for (const k of ['deadline', 'goAt']) if (S.game[k]) S.game[k] -= off;
    if (S.deadline) S.deadline -= off;
    S.hostId = pid;
    const now = performance.now();
    reformUntil = now + 25000;
    for (const p of S.players) if (!p.isBot && p.id !== pid) { p.connected = false; p.leftAt = now; }
    const old = find(info.oldHost);
    if (S.game && S.phase === 'loading') S.game.loaded = S.game.loaded.filter((id) => id === pid);
    if (info.why !== 'rejoin') { toast(info.why === 'handover' ? 'You are now the host 👑' : `${old?.name || 'The host'} left — you are the host now 👑`, 'gold', 4000); sys(info.why === 'handover' ? 'Host handed over' : 'Host migrated'); }
    commit();
    runtime?.emit('hostchange', { amHost: true, hostId: pid, oldHost: info.oldHost });
  } else {
    runtime?.emit('hostchange', { amHost: false, hostId: hostPid });
    if (S.phase === 'loading' && runtime?.loaded) act({ type: 'loaded', round: runtime.round });
  }
}

// ---------------------------------------------------------------- actions (every user action goes through the host)
function act(a) { if (!net) return; net.toHost({ h: 'act', ...a }); }
function onMsg(m, from) {
  if (!m || typeof m !== 'object') return;
  if (m.h === 'act') { if (isHost()) reduce(m, from); return; }
  if (isHost() && from !== pid) return;     // only the host speaks to clients
  switch (m.h) {
    case 'state': if (!isHost()) applyState(m.s); break;
    case 'chat': addChat(m); break;
    case 'pings': pings = m.p; break;
    case 'notice': toast(m.text, m.kind || ''); break;
  }
}
function hostOnly(from) { return from === pid && isHost(); }
function notice(to, text, kind = 'bad') { net.send(to, { h: 'notice', text, kind }); }
function reduce(a, from) {
  const p = find(from);
  if (!p) return;
  const host = hostOnly(from);
  const g = S.game;
  switch (a.type) {
    case 'profile': {
      p.name = cleanName(a.name);
      if (Number.isInteger(a.color) && a.color >= 0 && a.color < 8 && !S.players.some((q) => q !== p && q.color === a.color)) p.color = a.color;
      if (HATS.includes(a.hat)) p.hat = a.hat;
      Object.assign(p, cleanLooks(a));
      break;
    }
    case 'ready': if (S.phase === 'lobby') p.ready = !!a.v; break;
    case 'mode': if (host && S.phase === 'lobby' && ['pick', 'vote', 'shuffle'].includes(a.mode)) { S.mode = a.mode; S.votes = {}; if (a.n) S.shuffleLen = Math.max(2, Math.min(9, a.n | 0)); } break;
    case 'choose': if (host && GAME_MAP[a.game]) S.pick = a.game; break;
    case 'vote': if (S.phase === 'lobby' && S.mode === 'vote' && GAME_MAP[a.game]) S.votes[from] = a.game; break;
    case 'bot+': if (host && S.players.length < MAX_PARTY) { S.players.push(makeBot(S.players, freeColor(-1))); } break;
    case 'bot-': if (host) { const b = a.id ? find(a.id) : [...S.players].reverse().find((q) => q.isBot); if (b?.isBot) S.players = S.players.filter((q) => q !== b); } break;
    case 'botLevel': if (host && BOT_LEVELS[a.level]) S.botLevel = a.level; break;
    case 'kick': {
      const t = find(a.id); if (!host || !t || t.id === pid) break;
      if (t.isBot) { S.players = S.players.filter((q) => q !== t); break; }
      net.kick(t.id, 'The host removed you from the party.'); S.banned.push(t.id);
      S.players = S.players.filter((q) => q !== t); runtime?.emit('leave', t.id); sys(`${t.name} was removed`);
      break;
    }
    case 'makeHost': {
      const t = find(a.id); if (!host || !t || t.isBot || !t.connected || t.id === pid) break;
      if (!['lobby', 'results'].includes(S.phase)) { notice(from, 'You can hand over the host between games.'); break; }
      sys(`${p.name} made ${t.name} the host`); commit(); flush();
      net.handOver(t.id);
      return;
    }
    case 'start': if (host && S.phase === 'lobby') startFlow(!!a.force); break;
    case 'pick': {
      if (S.phase !== 'setup' || !g) break;
      const def = GAME_MAP[g.id].picks?.find((x) => x.key === a.key);
      if (def && def.choices.some((c) => c.value === a.value)) (g.picks[from] ||= {})[a.key] = a.value;
      break;
    }
    case 'option': {
      if (!host || S.phase !== 'setup' || !g) break;
      const def = GAME_MAP[g.id].options?.find((x) => x.key === a.key);
      if (def && def.choices.some((c) => c.value === a.value)) g.options[a.key] = a.value;
      break;
    }
    case 'setupReady': if (S.phase === 'setup' && g) g.setupReady[from] = !!a.v; break;
    case 'loaded': {
      if (!g || a.round !== g.round || !['loading', 'countdown', 'playing'].includes(S.phase)) break;
      if (!g.loaded.includes(from)) g.loaded.push(from);
      if (S.phase !== 'loading' || !g.participants.includes(from)) runtime?.emit('join', from);   // late joiner / rejoin: game can send a full sync
      break;
    }
    case 'endGame': if (host) endEarly(); break;
    case 'continue': if (host && (S.phase === 'results' || S.phase === 'podium')) advance(); break;
    case 'chat': {
      const text = String(a.text || '').trim().slice(0, 120);
      if (text) net.broadcast({ h: 'chat', id: from, name: p.name, color: p.color, text }, true);
      return;
    }
    default: return;
  }
  commit();
}

// ---------------------------------------------------------------- host: the party loop
function fits(m, n) { return n >= m.minPlayers && n <= m.maxPlayers; }
const partyCount = () => S.players.filter((p) => p.connected).length;
function startFlow(force) {
  const notReady = connectedHumans().filter((p) => !p.ready && p.id !== pid);
  if (!force && notReady.length) { notice(pid, `Waiting for ${notReady.map((p) => p.name).join(', ')} to ready up`); return; }
  let id;
  const n = partyCount();
  if (S.mode === 'shuffle') {
    const pool = GAMES.filter((m) => fits(m, n) && !m.hidden).map((m) => m.id);
    if (!pool.length) { notice(pid, 'No game fits this many players.'); return; }
    const list = [];
    let bag = [];
    while (list.length < S.shuffleLen) { if (!bag.length) bag = [...pool].sort(() => Math.random() - 0.5); const x = bag.pop(); if (x === list[list.length - 1] && pool.length > 1) { bag.unshift(x); continue; } list.push(x); }
    S.shuffle = { list, idx: 0, start: Object.fromEntries(S.players.map((p) => [p.id, p.trophies])) };
    id = list[0];
  } else if (S.mode === 'vote') {
    const tally = {};
    for (const [voter, gid] of Object.entries(S.votes)) if (find(voter)?.connected) tally[gid] = (tally[gid] || 0) + 1;
    const best = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally).filter((k) => tally[k] === best);
    const pool = top.length ? top : GAMES.filter((m) => fits(m, n)).map((m) => m.id);
    id = pool[Math.floor(Math.random() * pool.length)];
    sys(`Vote winner: ${GAME_MAP[id].name}${best ? ` (${best} vote${best > 1 ? 's' : ''})` : ''}`);
  } else id = S.pick;
  const m = GAME_MAP[id];
  if (!fits(m, n)) { notice(pid, `${m.name} needs ${m.minPlayers}–${m.maxPlayers} players. Add or remove bots.`); S.shuffle = null; return; }
  beginGame(id);
}
function beginGame(id) {
  const m = GAME_MAP[id];
  const opts = Object.fromEntries((m.options || []).map((o) => [o.key, store.get(`opt.${id}.${o.key}`, o.default)]));
  for (const o of m.options || []) if (!o.choices.some((c) => c.value === opts[o.key])) opts[o.key] = o.default;
  S.votes = {}; S.results = null;
  S.game = { id, round: null, options: opts, picks: {}, setupReady: {}, botLevel: S.botLevel };
  for (const b of S.players.filter((p) => p.isBot)) S.game.picks[b.id] = Object.fromEntries((m.picks || []).map((pk) => [pk.key, pk.choices[Math.floor(Math.random() * pk.choices.length)].value]));
  // Every game gets the pre-round screen: settings / picks on one side, How to play + controls on the other.
  // It ends early as soon as every human presses Ready.
  const hasChoices = (m.picks || []).length || (m.options || []).length;
  S.phase = 'setup'; S.game.deadline = hnow() + (S.shuffle ? (hasChoices ? 15000 : 12000) : (hasChoices ? 30000 : 25000));
}
function startLoading() {
  const g = S.game, m = GAME_MAP[g.id];
  S.round++;
  g.round = S.round; g.seed = randomSeed(); g.loaded = [];
  const list = S.players.filter((p) => p.connected).sort((a, b) => a.isBot - b.isBot).slice(0, m.maxPlayers);
  g.participants = list.map((p) => p.id);
  g.roster = list.map(({ id, name, color, hat, skin, hair, hairColor, isBot }) => ({ id, name, color, hat, skin, hair, hairColor, isBot }));
  for (const p of list) { g.picks[p.id] = { ...Object.fromEntries((m.picks || []).map((pk) => [pk.key, pk.default])), ...(g.picks[p.id] || {}) }; }
  g.deadline = hnow() + 20000;
  for (const [k, v] of Object.entries(g.options)) store.set(`opt.${g.id}.${k}`, v);
  S.phase = 'loading';
}
function hostTick() {
  if (!isHost() || !S) return;
  const now = hnow(), g = S.game;
  let dirty = false;
  if (S.phase === 'setup' && g) {
    const waiting = connectedHumans().filter((p) => !g.setupReady[p.id]);
    if (!waiting.length || now > g.deadline) { startLoading(); dirty = true; }
  } else if (S.phase === 'loading' && g) {
    const waiting = g.participants.filter((id) => { const p = find(id); return p && !p.isBot && p.connected && !g.loaded.includes(id); });
    if (!waiting.length || now > g.deadline) { S.phase = 'countdown'; g.goAt = now + 3200; dirty = true; }
  } else if (S.phase === 'countdown' && g && now >= g.goAt) { S.phase = 'playing'; dirty = true; }
  else if ((S.phase === 'results' || S.phase === 'podium') && S.deadline && now > S.deadline) { advance(); dirty = true; }
  const t = performance.now();
  for (const p of [...S.players]) if (!p.isBot && !p.connected && p.leftAt && t - p.leftAt > GRACE_MS) { S.players = S.players.filter((q) => q !== p); sys(`${p.name} left the party`); dirty = true; }
  if (dirty) commit();
}
setInterval(hostTick, 200);
setInterval(() => { if (isHost() && S) { const p = {}; for (const id of net.connectedPids()) p[id] = Math.round(net.peerPing(id)); net.broadcast({ h: 'pings', p }); pings = p; } }, 2000);

// Called by the host's game runtime via ctx.endGame(placements, extra).
function gameEnded(round, placements, extra) {
  if (!isHost() || !S.game || S.game.round !== round || !['playing', 'countdown'].includes(S.phase)) return;
  finishGame(placements, extra, false);
  commit();
}
function normalizePlacements(placements, participants) {
  const seen = new Set(), groups = [];
  for (const g of placements || []) {
    const ids = (Array.isArray(g) ? g : [g]).filter((id) => participants.includes(id) && !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (ids.length) groups.push(ids);
  }
  const rest = participants.filter((id) => !seen.has(id));
  if (rest.length) groups.push(rest);
  return groups;
}
function finishGame(placements, extra = {}, early = false) {
  const g = S.game;
  const groups = placements ? normalizePlacements(placements, g.participants) : [];
  const awards = {}, places = {};
  let place = 1;
  for (const grp of groups) {
    const pts = TROPHY_POINTS[place - 1] ?? 1;
    for (const id of grp) { awards[id] = pts; places[id] = place; const p = find(id); if (p) { p.trophies += pts; if (place === 1) p.wins++; } }
    place += grp.length;
  }
  S.results = { gameId: g.id, round: g.round, groups, awards, places, early, title: extra.title || '', stats: extra.stats || {}, note: extra.note || '', roster: g.roster };
  S.history.push({ gameId: g.id, round: g.round, winners: groups[0] || [] });
  S.phase = 'results'; S.deadline = hnow() + 16000;
}
function endEarly() {
  const g = S.game; if (!g) return;
  if (S.phase === 'playing' || S.phase === 'countdown') {
    const st = runtime && runtime.round === g.round ? runtime.standings() : null;
    finishGame(st, { title: 'Game ended early', note: st ? 'Trophies awarded from the standings at the time.' : 'No trophies this round.' }, true);
  } else if (S.phase === 'setup' || S.phase === 'loading') { S.phase = 'lobby'; S.game = null; S.shuffle = null; }
}
function advance() {
  if (S.phase === 'podium') { S.shuffle = null; S.podium = null; toLobby(); return; }
  if (S.shuffle) {
    S.shuffle.idx++;
    if (S.shuffle.idx < S.shuffle.list.length) {
      let id = S.shuffle.list[S.shuffle.idx];
      if (!fits(GAME_MAP[id], partyCount())) id = GAMES.find((m) => fits(m, partyCount()))?.id;
      if (id) { beginGame(id); return; }
    }
    const gained = S.players.map((p) => ({ id: p.id, name: p.name, color: p.color, hat: p.hat, skin: p.skin, hair: p.hair, hairColor: p.hairColor, trophies: p.trophies - (S.shuffle.start[p.id] ?? 0) })).sort((a, b) => b.trophies - a.trophies);
    S.podium = { top: gained.slice(0, 3), all: gained, games: S.shuffle.list.length };
    S.phase = 'podium'; S.deadline = hnow() + 25000; S.game = null; S.results = null;
    return;
  }
  toLobby();
}
function toLobby() { S.phase = 'lobby'; S.game = null; S.results = null; S.deadline = 0; for (const p of S.players) if (!p.isBot) p.ready = false; }

let commitQueued = false;
function commit() {
  if (!isHost() || !S) return;
  S.v++;
  if (commitQueued) return;
  commitQueued = true;
  queueMicrotask(flush);
}
function flush() {
  if (!commitQueued || !net) return;
  commitQueued = false;
  net.broadcast({ h: 'state', s: S });
  applyState(S);
  ss.set(SAVE_KEY, { ...S, game: null, phase: 'lobby', results: null, podium: null, shuffle: null });
}
function sys(text) { addChat({ sys: true, text }); }

// ---------------------------------------------------------------- everyone: react to the state
function applyState(s) {
  const prev = S?.phase, prevV = S?.v;
  S = s;
  if (!net) return;
  net.setRoster(S.players.filter((p) => !p.isBot).map((p) => ({ pid: p.id, addr: p.addr, human: true, connected: p.connected })));
  const want = phaseScreen();
  if (want !== screen) show(want);
  if (prev !== S.phase) onPhase(prev);
  render();
  syncGame();
  void prevV;
}
function phaseScreen() {
  switch (S.phase) {
    case 'lobby': return 'lobby';
    case 'setup': return 'setup';
    case 'loading': return 'loading';
    case 'results': return 'results';
    case 'podium': return 'podium';
    default: return null;   // countdown / playing: the game is the screen
  }
}
function onPhase(prev) {
  if (S.phase === 'loading' || S.phase === 'countdown') net.relax(45000);
  if (S.phase === 'results') { audio.play(S.results?.places?.[pid] === 1 ? 'win' : 'toast'); }
  if (S.phase === 'podium') audio.play('fanfare');
  if (S.phase === 'setup') { const g = GAME_MAP[S.game.id]; for (const pk of g.picks || []) { const v = store.get(`pick.${g.id}.${pk.key}`, pk.default); act({ type: 'pick', key: pk.key, value: v }); } }
  if (S.phase === 'lobby' && prev && prev !== 'lobby') { closeOverlay('pause'); }
}
function render() {
  document.querySelectorAll('.host-only').forEach((e) => e.classList.toggle('hidden', !isHost()));
  if (screen === 'lobby') renderLobby();
  else if (screen === 'setup') renderSetup();
  else if (screen === 'loading') renderLoading();
  else if (screen === 'results') renderResults();
  else if (screen === 'podium') renderPodium();
  renderProfile();
}

// ---------------------------------------------------------------- game mount / unmount
async function syncGame() {
  const g = S && ['loading', 'countdown', 'playing'].includes(S.phase) ? S.game : null;
  if (runtime && (!g || g.round !== runtime.round)) unmountGame();
  if (!g || runtime || mountingRound === g.round) return;
  mountingRound = g.round;
  let mod;
  try { mod = await loadGame(g.id); } catch (e) { console.error(e); toast('Could not load ' + GAME_MAP[g.id].name, 'bad'); mountingRound = null; return; }
  if (!S || S.game?.round !== g.round || !['loading', 'countdown', 'playing'].includes(S.phase) || runtime) { mountingRound = null; return; }
  stopMusic();
  document.body.classList.add('in-game'); input.gameActive = true; stageSync();
  const rt = new GameRuntime({ hub: hubApi, net, manifest: GAME_MAP[g.id], game: g, players: g.roster, myId: pid });
  rt.round = g.round;
  runtime = rt;
  try { await rt.start(mod); } catch (e) { console.error(`[${g.id}] start() failed`, e); toast('The game failed to start', 'bad'); }
  mountingRound = null;
  if (runtime !== rt) return;
  rt.loaded = true;
  net.relax(15000);   // first frames after loading still compile shaders
  act({ type: 'loaded', round: g.round });
  if (S.phase === 'playing') rt.go();
}
function unmountGame() {
  if (!runtime) return;
  const rt = runtime; runtime = null;
  rt.stop();
  document.body.classList.remove('in-game'); input.gameActive = false;
  clearCenter(); banner('');
  $('scoreboard').classList.add('hidden'); closeOverlay('pause');
  lastCount = null;
  stageSync(); musicSync();
}
let reformUntil = 0;
const hubApi = {
  netBusy: () => !!net && (net.migrating || (isHost() && performance.now() < reformUntil && S?.players.some((p) => !p.isBot && !p.connected && p.leftAt))),
  gameEnded: (round, placements, extra) => gameEnded(round, placements, extra),
  isConnected: (id) => { const p = find(id); return !!p && (p.isBot || p.connected); },
};
// Shared countdown: everyone counts down to the same host-clock moment, then the game gets 'go'.
let lastCount = null;
setInterval(() => {
  if (!S || !runtime) return;
  if (S.phase === 'countdown' && S.game?.goAt) {
    const n = Math.ceil((S.game.goAt - hnow()) / 1000);
    if (n > 0 && n <= 3 && n !== lastCount) { lastCount = n; countdown(n); }
    if (n <= 0 && !runtime.started && runtime.loaded) { lastCount = 0; countdown(0); runtime.go(); }
  } else if (S.phase === 'playing' && runtime.loaded && !runtime.started) { countdown(0); runtime.go(); }
}, 50);

// ---------------------------------------------------------------- lobby rendering
// Connection status under the party code: the host sees whether friends can reach the party right now.
function netBadgeSync() {
  if (!net || !S) return;
  let t;
  if (net.kind === 'local') t = '⚠ Offline party: the game server could not be reached, so friends can\'t join (bots only)';
  else if (isHost()) {
    const r = net.t.reachable?.() || { direct: true, relay: 0 };
    t = r.direct || r.relay ? `🌐 Friends can join · direct ${r.direct ? '✔' : '✖'} · relay ${r.relay ? '✔' : '✖'}`
      : '⚠ Friends can\'t reach this party right now: reconnecting to the servers…';
  } else t = net.via === 'relay' ? '🐢 On the backup relay (slower) · retrying direct' : '🌐 Connected directly to the host';
  if ($('netBadge').textContent !== t) $('netBadge').textContent = t;
}
setInterval(() => { if (screen === 'lobby') netBadgeSync(); }, 2000);
function renderLobby() {
  const host = isHost(), m = me();
  $('roomCode').textContent = S.code;
  netBadgeSync();
  $('playerList').innerHTML = S.players.map((p) => {
    const tags = [];
    if (p.id === S.hostId) tags.push('<span class="ph-tag gold">HOST</span>');
    if (p.isBot) tags.push('<span class="ph-tag">BOT</span>');
    const ping = (!p.isBot && pings[p.id] ? `<span class="ph-tag">${pings[p.id]}ms</span>` : '') + (p.via === 'relay' && p.connected ? '<span class="ph-tag" title="Connected through the backup relay (a direct link was blocked). Works fine, just a little slower.">relay</span>' : '');
    const acts = host && p.id !== pid ? (p.isBot ? `<button class="ph-btn small danger" data-kick="${p.id}" title="Remove bot">✕</button>`
      : `<button class="ph-btn small" data-host="${p.id}" title="Make host">👑</button><button class="ph-btn small danger" data-kick="${p.id}" title="Kick">✕</button>`) : '';
    const rdy = p.isBot || p.ready;
    return `<li class="${p.connected ? '' : 'off'} ${p.id === pid ? 'me' : ''}" style="--pc:${css(p.color)}" title="${p.id === pid ? 'You' : ''}"><span class="ph-dot" style="background:${css(p.color)}"></span><span class="nm">${esc(p.name)}</span><span class="tags">${tags.join('')}${ping}</span>
      <span class="trophy">🏆 ${p.trophies}</span><span class="ready ${rdy ? 'on' : ''}">${rdy ? 'READY' : 'not ready'}</span><span class="acts">${acts}</span></li>`;
  }).join('') + `<li class="count-row">${S.players.length}/${MAX_PARTY} players${S.players.some((p) => !p.connected) ? ' · faded = reconnecting' : ''}</li>`;
  $('botLevel').value = S.botLevel;
  $('addBot').disabled = S.players.length >= MAX_PARTY;
  $('remBot').disabled = !S.players.some((p) => p.isBot);
  $('readyBtn').textContent = m?.ready ? '✔ Ready! (click to cancel)' : 'Ready up!';
  $('readyBtn').classList.toggle('green', !!m?.ready);
  document.querySelectorAll('.mode').forEach((b) => { b.classList.toggle('on', b.dataset.mode === S.mode); b.disabled = !host; });
  $('shuffleLen').value = String(S.shuffleLen); $('shuffleLen').classList.toggle('hidden', !host || S.mode !== 'shuffle');
  const n = partyCount();
  $('gameGrid').innerHTML = GAMES.map((g) => {
    const sel = (S.mode === 'pick' && S.pick === g.id) || (S.mode === 'vote' && S.votes[pid] === g.id);
    const votes = S.mode === 'vote' ? Object.entries(S.votes).filter(([, v]) => v === g.id).map(([id]) => `<span class="ph-dot" style="background:${css(find(id)?.color ?? 0)}"></span>`).join('') : '';
    return `<button class="game-card ${sel ? 'sel' : ''} ${fits(g, n) ? '' : 'off'}" data-game="${g.id}" title="${esc(g.tagline)}">
      <img src="${g.thumbnail}" alt=""><span class="gp">${g.minPlayers}–${g.maxPlayers}</span><span class="votes">${votes}</span>
      <div class="gi"><div class="gn">${esc(g.name)}</div><div class="gt">${esc(g.tagline)}</div></div></button>`;
  }).join('');
  const notReady = connectedHumans().filter((p) => !p.ready && p.id !== S.hostId);
  const pickName = GAME_MAP[S.pick]?.name;
  let hint = S.mode === 'pick' ? (host ? `Pick a game, then Start.` : `${esc(find(S.hostId)?.name || 'The host')} is picking: <b>${esc(pickName)}</b>`)
    : S.mode === 'vote' ? `Vote! Click the game you want. (${Object.keys(S.votes).length} vote${Object.keys(S.votes).length === 1 ? '' : 's'})`
    : `Shuffle: ${S.shuffleLen} random games in a row, then a champion is crowned.`;
  if (notReady.length) hint += `<br>Waiting for: ${notReady.map((p) => esc(p.name)).join(', ')}`;
  if (host && connectedHumans().length === 1) hint += `<br><small>Playing solo is fine: bots fill the empty seats. Friends can join any time with code <b>${esc(S.code)}</b>.</small>`;
  $('lobbyHint').innerHTML = hint;
  $('startBtn').textContent = S.mode === 'pick' ? `Start ${pickName}` : S.mode === 'vote' ? 'Start vote winner' : `Start Shuffle (${S.shuffleLen})`;
  $('startBtn').disabled = notReady.length > 0;
  $('forceStart').classList.toggle('hidden', !host || !notReady.length);
  renderLeaderboard($('leaderboard'));
}
function renderLeaderboard(target) {
  const rows = [...S.players].sort((a, b) => b.trophies - a.trophies || b.wins - a.wins);
  const any = rows.some((p) => p.trophies > 0);
  target.innerHTML = rows.map((p, i) => `<div class="lb-row ${any && i < 3 ? 'top' + (i + 1) : ''} ${p.id === pid ? 'me' : ''}"><span class="pl">${any && i < 3 && p.trophies > 0 ? MEDAL[i] : i + 1}</span><span class="ph-dot" style="background:${css(p.color)}"></span><span class="n">${esc(p.name)}</span><span class="tr">🏆 ${p.trophies}</span></div>`).join('')
    + `<div class="lb-note">${S.history.length} game${S.history.length === 1 ? '' : 's'} played · 1st +5 · 2nd +3 · 3rd +2 · others +1</div>`;
}
$('playerList').onclick = (e) => {
  const k = e.target.closest('[data-kick]'), h = e.target.closest('[data-host]');
  if (k) { audio.play('click'); act({ type: 'kick', id: k.dataset.kick }); }
  if (h && confirm(`Make ${find(h.dataset.host)?.name} the host?`)) act({ type: 'makeHost', id: h.dataset.host });
};
$('gameGrid').onclick = (e) => {
  const c = e.target.closest('[data-game]'); if (!c) return; audio.play('click');
  if (S.mode === 'vote') act({ type: 'vote', game: c.dataset.game });
  else if (S.mode === 'pick' && isHost()) act({ type: 'choose', game: c.dataset.game });
};
document.querySelectorAll('.mode').forEach((b) => { b.onclick = () => { audio.play('click'); act({ type: 'mode', mode: b.dataset.mode, n: +$('shuffleLen').value }); }; });
$('shuffleLen').onchange = () => act({ type: 'mode', mode: 'shuffle', n: +$('shuffleLen').value });
$('addBot').onclick = () => { audio.play('click'); act({ type: 'bot+' }); };
$('remBot').onclick = () => { audio.play('click'); act({ type: 'bot-' }); };
$('botLevel').onchange = () => act({ type: 'botLevel', level: $('botLevel').value });
$('readyBtn').onclick = () => { audio.play('click'); act({ type: 'ready', v: !me()?.ready }); };
$('startBtn').onclick = () => { audio.play('click'); act({ type: 'start' }); };
$('forceStart').onclick = () => { audio.play('click'); act({ type: 'start', force: true }); };
$('leaveBtn').onclick = () => { if (confirm('Leave the party?')) leaveParty(); };
$('editProfile').onclick = () => openOverlay('profile');
$('copyLink').onclick = async () => { try { await navigator.clipboard.writeText(shareLink()); toast('Invite link copied!', 'good'); } catch { prompt('Copy this link:', shareLink()); } };

// ---------------------------------------------------------------- setup (per-game picks) / loading / results / podium
function countdownText(deadline, label) { const s = Math.max(0, Math.ceil((deadline - hnow()) / 1000)); return `${label} ${s}s`; }
function renderSetup() {
  const g = S.game, m = GAME_MAP[g.id], host = isHost();
  $('setupTitle').textContent = m.name;
  const shuf = S.shuffle ? ` · Shuffle game ${S.shuffle.idx + 1} of ${S.shuffle.list.length}` : '';
  $('setupCount').textContent = countdownText(g.deadline, 'Starting in') + shuf;
  const mine = g.picks[pid] || {};
  let html = '';
  for (const pk of m.picks || []) {
    html += `<div class="pick-group"><h3>${esc(pk.label)}</h3><div class="choices">${pk.choices.map((c) => `<button class="ph-btn choice ${mine[pk.key] === c.value ? 'sel' : ''}" data-pick="${pk.key}" data-v="${esc(c.value)}">${esc(c.label)}${c.desc ? `<small>${esc(c.desc)}</small>` : ''}</button>`).join('')}</div></div>`;
  }
  for (const o of m.options || []) {
    const cur = o.choices.find((c) => c.value === g.options[o.key]);
    html += host ? `<div class="pick-group"><h3>${esc(o.label)} <small class="muted">(host)</small></h3><div class="choices">${o.choices.map((c) => `<button class="ph-btn small choice ${g.options[o.key] === c.value ? 'sel' : ''}" data-opt="${o.key}" data-v="${esc(c.value)}">${esc(c.label)}</button>`).join('')}</div></div>`
      : `<div class="ph-sub">${esc(o.label)}: <b>${esc(cur?.label || '')}</b></div>`;
  }
  if (!html) html = '<p class="ph-sub">No settings for this game. Read how to play, then press Ready!</p>';
  if ($('setupBody').dataset.html !== html) { $('setupBody').innerHTML = html; $('setupBody').dataset.html = html; }
  if ($('howList').dataset.game !== m.id) {
    $('howList').dataset.game = m.id;
    $('howTag').textContent = m.tagline;
    $('howList').innerHTML = (m.howTo || []).map((t) => `<li>${esc(t)}</li>`).join('');
    $('howList').classList.toggle('hidden', !(m.howTo || []).length);
    $('howControls').innerHTML = controlsHTML(m);
  }
  const ready = !!g.setupReady[pid];
  $('setupReady').textContent = ready ? 'Ready ✔' : 'Ready!';
  $('setupReady').classList.toggle('green', ready);
  $('setupWho').innerHTML = S.players.filter((p) => p.connected && !p.isBot).map((p) => `<span class="load-chip ${g.setupReady[p.id] ? 'ok' : ''}">${esc(p.name)}</span>`).join(' ');
}
$('setupBody').onclick = (e) => {
  const b = e.target.closest('[data-pick],[data-opt]'); if (!b) return; audio.play('click');
  if (b.dataset.pick) { store.set(`pick.${S.game.id}.${b.dataset.pick}`, b.dataset.v); act({ type: 'pick', key: b.dataset.pick, value: b.dataset.v }); }
  else act({ type: 'option', key: b.dataset.opt, value: b.dataset.v });
};
$('setupReady').onclick = () => { audio.play('click'); act({ type: 'setupReady', v: !S.game.setupReady[pid] }); };
function controlsHTML(m) {
  const rows = [...(m?.controlsHelp || []), ['Tab', 'Scoreboard'], ['Esc', 'Pause menu'], ['Enter', 'Chat']];
  return rows.map(([k, v]) => `<div class="k">${k.split(' / ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' / ')}</div><div>${esc(v)}</div>`).join('');
}
function renderLoading() {
  const g = S.game, m = GAME_MAP[g.id];
  $('loadTitle').textContent = m.name; $('loadTag').textContent = m.tagline;
  $('loadSub').textContent = S.shuffle ? `Shuffle · game ${S.shuffle.idx + 1} of ${S.shuffle.list.length}` : `Round ${g.round}`;
  $('loadWho').innerHTML = g.roster.filter((p) => !p.isBot).map((p) => `<span class="load-chip ${g.loaded.includes(p.id) ? 'ok' : ''}">${g.loaded.includes(p.id) ? '✔' : '⏳'} ${esc(p.name)}</span>`).join(' ')
    + (g.participants.includes(pid) ? '' : '<div class="ph-sub" style="width:100%">You joined mid-party: you\'ll spectate this round.</div>');
}
function renderResults() {
  const r = S.results; if (!r) return;
  const m = GAME_MAP[r.gameId];
  const nm = (id) => r.roster.find((p) => p.id === id) || find(id) || { name: '?', color: 0 };
  const winners = (r.groups[0] || []).map((id) => nm(id).name);
  $('resSub').textContent = m.name + (S.shuffle ? ` · Shuffle ${S.shuffle.idx + 1}/${S.shuffle.list.length}` : '');
  $('resTitle').textContent = r.title || (winners.length ? `${winners.join(' & ')} win${winners.length > 1 ? '' : 's'}!` : 'Results');
  let html = '', i = 0;
  for (const grp of r.groups) for (const id of grp) {
    const pl = r.places[id], p = nm(id);
    html += `<div class="res-row p${Math.min(pl, 4)} ${id === pid ? 'me' : ''}" style="animation-delay:${i++ * 0.08}s;--pc:${css(p.color)}"><span class="place">${MEDAL[pl - 1] || ordinal(pl)}</span><span class="ph-dot" style="background:${css(p.color)}"></span>
      <span class="nm">${esc(p.name)}${id === pid ? ' (you)' : ''}${p.isBot ? ' 🤖' : ''}</span><span class="stat">${esc(r.stats[id] || '')}</span><span class="gain">${r.awards[id] ? '+' + r.awards[id] + ' 🏆' : ''}</span></div>`;
  }
  if ($('resBody').dataset.k !== S.v + '') { $('resBody').innerHTML = html || '<div class="ph-sub">No placements.</div>'; $('resBody').dataset.k = S.v; }
  $('resExtra').textContent = r.note || '';
  renderLeaderboard($('resStandings'));
  const next = S.shuffle ? (S.shuffle.idx + 1 < S.shuffle.list.length ? `Next: ${GAME_MAP[S.shuffle.list[S.shuffle.idx + 1]].name}` : 'Crown the champion!') : 'Back to lobby';
  $('resContinue').textContent = next;
  $('resWait').textContent = countdownText(S.deadline, isHost() ? 'Continuing automatically in' : `${next} in`);
}
function renderPodium() {
  const P = S.podium; if (!P) return;
  const top = P.top;
  $('podTitle').textContent = top[0] ? `${top[0].name} is the party champion!` : 'Champion!';
  $('podNames').innerHTML = [1, 0, 2].map((i) => top[i] ? `<div>${MEDAL[i]} ${esc(top[i].name)} <small>(+${top[i].trophies}🏆)</small></div>` : '').join('');
  $('podWait').textContent = countdownText(S.deadline, 'Back to the lobby in');
}
$('resContinue').onclick = () => { audio.play('click'); act({ type: 'continue' }); };
$('podContinue').onclick = () => { audio.play('click'); act({ type: 'continue' }); };
setInterval(() => { if (S && (screen === 'setup' || screen === 'results' || screen === 'podium')) render(); }, 500);

// ---------------------------------------------------------------- overlays: pause, settings, controls, scoreboard, chat
function syncSettingsUI() {
  document.querySelectorAll('[data-set]').forEach((e) => { const v = settings.get(e.dataset.set); if (e.type === 'checkbox') e.checked = !!v; else e.value = v; });
}
document.querySelectorAll('[data-set]').forEach((e) => e.addEventListener('input', () => {
  const k = e.dataset.set; settings.set(k, e.type === 'checkbox' ? e.checked : e.type === 'range' ? +e.value : e.value);
}));
settings.on('change', (k) => { if (k === 'showFps') $('fps').classList.toggle('hidden', !settings.get('showFps')); });
$('fps').classList.toggle('hidden', !settings.get('showFps'));
function renderControls() {
  const m = runtime ? GAME_MAP[runtime.manifest.id] : null;
  $('controlsBody').innerHTML = (m ? `<div class="k"><b>${esc(m.name)}</b></div><div></div>` + (m.howTo || []).map((t, i) => `<div class="k">${i + 1}.</div><div>${esc(t)}</div>`).join('') + '<div class="k" style="margin-top:8px"><b>Controls</b></div><div></div>' + controlsHTML(m) + '<div class="k" style="margin-top:8px"><b>Everywhere</b></div><div></div>' : '')
    + CONTROL_MAP.map(([k, v]) => `<div class="k">${k.split(' / ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' / ')}</div><div>${esc(v)}</div>`).join('');
}
$('resumeBtn').onclick = () => closeOverlay('pause');
$('pauseLeave').onclick = () => { if (confirm('Leave the party?')) leaveParty(); };
$('endGameBtn').onclick = () => { if (confirm('End this game for everyone?')) { act({ type: 'endGame' }); closeOverlay('pause'); } };
function showBoard(on) {
  if (!on) { $('scoreboard').classList.add('hidden'); return; }
  if (!S || !runtime) return;
  const fn = runtime.ui.scoreboard;
  let html = '';
  if (fn) { try { const b = fn(); html += `<h2>${esc(runtime.manifest.name)}</h2>` + (typeof b === 'string' ? b : tableHTML(b)); } catch (e) { console.error(e); } }
  html += '<h2 style="margin-top:12px">Party</h2>' + tableHTML({ columns: ['', 'Player', 'Trophies', 'Wins', 'Ping'], rows: [...S.players].sort((a, b) => b.trophies - a.trophies).map((p) => ({ cls: p.id === pid ? 'me' : '', cells: [`<span class="ph-dot" style="background:${css(p.color)}"></span>`, esc(p.name) + (p.id === S.hostId ? ' 👑' : '') + (p.isBot ? ' 🤖' : ''), '🏆 ' + p.trophies, p.wins, p.isBot ? '—' : p.id === S.hostId ? 'host' : (pings[p.id] ?? '…') + ' ms'] })) });
  $('boardBody').innerHTML = html;
  $('scoreboard').classList.remove('hidden');
}
input.on('hubkey', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); if (runtime && !e.repeat) showBoard(true); return; }
  if (e.code === 'Escape') {
    e.preventDefault();
    if (!$('chatBox').classList.contains('hidden')) { closeChat(); return; }
    for (const id of ['settings', 'controls', 'profile', 'pause']) if (!$(id).classList.contains('hidden')) { closeOverlay(id); return; }
    if (runtime) openOverlay('pause');
    return;
  }
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && S && !anyOverlay()) { e.preventDefault(); openChat(); }
});
addEventListener('keyup', (e) => { if (e.code === 'Tab') showBoard(false); });
addEventListener('blur', () => showBoard(false));
function openChat() { $('chatBox').classList.remove('hidden'); input.setEnabled(false); $('chatIn').focus(); }
function closeChat() { $('chatBox').classList.add('hidden'); $('chatIn').value = ''; $('chatIn').blur(); if (!anyOverlay()) input.setEnabled(true); }
$('chatIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const t = $('chatIn').value.trim(); if (t) act({ type: 'chat', text: t }); closeChat(); e.preventDefault(); e.stopPropagation(); }
  else if (e.key === 'Escape') { closeChat(); e.stopPropagation(); }
});
function addChat(m) {
  chat.push(m); if (chat.length > 60) chat.shift();
  const line = m.sys ? `<div class="sys">• ${esc(m.text)}</div>` : `<div><span style="color:${css(m.color)}">${esc(m.name)}:</span> ${esc(m.text)}</div>`;
  const panel = $('chatPanel'); panel.insertAdjacentHTML('beforeend', line); while (panel.children.length > 60) panel.firstChild.remove(); panel.scrollTop = 1e9;
  if (!m.sys || runtime) { const d = el('div'); d.innerHTML = line.replace(/^<div[^>]*>|<\/div>$/g, ''); $('chatlog').appendChild(d); setTimeout(() => d.remove(), 8000); while ($('chatlog').children.length > 6) $('chatlog').firstChild.remove(); }
  if (!m.sys && m.id !== pid) audio.play('toast', 0.6);
}

// FPS meter
let fpsN = 0, fpsT = performance.now();
(function fpsLoop(now) { requestAnimationFrame(fpsLoop); fpsN++; if (now - fpsT > 500) { if (settings.get('showFps')) $('fps').textContent = `${Math.round(fpsN * 1000 / (now - fpsT))} fps`; fpsN = 0; fpsT = now; } })(performance.now());

// ---------------------------------------------------------------- boot
async function boot() {
  show('home');
  const room = (params.get('room') || '').toUpperCase();
  const sess = ss.get(SESSION_KEY);
  if (room) { $('joinBox').classList.remove('hidden'); $('joinCodeShow').textContent = room; $('codeIn').value = room; }
  if (sess && (!room || sess.code === room)) {
    // Refresh / dropped Wi-Fi: rejoin the party we were in (and become host again if we were alone).
    $('reconnect').classList.remove('hidden'); $('reconnectText').textContent = `Rejoining party ${sess.code}…`;
    if (sess.net === 'local') forceLocal = true;
    const saved = ss.get(SAVE_KEY);
    const end = performance.now() + 20000;
    while (performance.now() < end) {
      const r = await joinParty(sess.code, true);
      if (r === true) return;
      if (r === 'rejected') break;
      const alone = saved && saved.hostId === pid && !saved.players.some((p) => !p.isBot && p.id !== pid && p.connected);
      if (alone && await createParty(sess.code, saved)) { $('reconnect').classList.add('hidden'); return; }
      await new Promise((r2) => setTimeout(r2, 2000));
    }
    $('reconnect').classList.add('hidden');
    ss.del(SESSION_KEY);
    homeMsg(`Couldn't get back into party ${sess.code}.`);
  }
}
boot();
setTimeout(() => { if (!net) prewarm(netKind()); }, 300);   // get the servers connected before Create / Join is clicked

// Both reports end with a quick check of which free STUN/TURN servers work from this computer (~4 s).
async function withIceCheck(text) { try { return text + '\nconnection servers from this computer:\n  ' + (await iceCheck()).join('\n  '); } catch (e) { return text + '\n(server check failed: ' + e.message + ')'; } }
$('failReport').onclick = async () => {
  $('failReport').disabled = true; $('failReport').textContent = '⏳ Checking connection…';
  const text = await withIceCheck(lastFail || 'No failed join recorded.');
  $('failReport').disabled = false; $('failReport').textContent = '📋 Copy details';
  try { await navigator.clipboard.writeText(text); toast('Details copied', 'good'); } catch { prompt('Copy this:', text); }
};
$('connReport').onclick = async () => {
  $('connReport').disabled = true;
  const text = await withIceCheck(net ? net.report() : (lastFail || 'Not in a party yet: join or create one, then copy the report.'));
  $('connReport').disabled = false;
  try { await navigator.clipboard.writeText(text); toast('Connection report copied', 'good'); } catch { prompt('Copy this report:', text); }
};
$('chatOpen').onclick = () => { if (S) openChat(); };
// Home: a strip of every game in the arcade
$('homeGames').innerHTML = GAMES.filter((g) => !g.hidden).map((g) => `<div class="hg" title="${esc(g.name)}: ${esc(g.tagline)}"><img src="${g.thumbnail}" alt=""><span>${esc(g.name)}</span></div>`).join('');
// Handy for debugging and for the automated tests.
window.__hub = {
  get state() { return S; }, get pid() { return pid; }, get net() { return net; }, get runtime() { return runtime; }, get screen() { return screen; },
  act, liveStats, leaveParty, netReport: () => net?.report(),
};

// Developer tuning portal: only on this computer (localhost) and only with ?portal=1. See docs/PORTAL.md.
if (DEV_HOST && params.has('portal')) {
  import('./portal.js').then((m) => m.initPortal({
    act, GAME_MAP, get state() { return S; }, get pid() { return pid; },
    solo: () => $('soloBtn').onclick(),
  })).catch((e) => console.error('portal failed to load', e));
}
