// Arena Royale - UI, input, game loop and PeerJS networking.
import { Sim, CHARS, CHAR_KEYS, MAX_PLAYERS, ARENA_R, WINS_TO_WIN, DASH_CD, MAPS, MAP_KEYS, MAP, setMap, integrate, applyDash, zoneNextIn, clampTo, TELEPORT_MAX, BOMB_RANGE, WELL_RANGE } from './sim.js';
import { botInput, BOT_NAMES, BOT_LEVELS } from './bots.js';
import { Renderer, cssColor } from './render.js';
import { encodeSnapshot, decodeSnapshot, encodeInput, decodeInput, toB64, fromB64 } from './net.js';
import { sfx, unlockAudio, isMuted, setMuted } from './audio.js';

const $ = (id) => document.getElementById(id);
const STEP = 1 / 60;
const ROOM_PREFIX = 'fb10-arena-royale-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const INTERP_MS = 100;
const SNAP_MS = 50;
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// Snapshot channel: unordered and never retransmitted (stale state is useless).
// PeerJS only exposes `ordered`, so set maxRetransmits on channels we label 'snap'.
if (window.RTCPeerConnection) {
  const orig = RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel = function (label, cfg) {
    if (String(label).startsWith('snap')) cfg = { ordered: false, maxRetransmits: 0 };
    return orig.call(this, label, cfg);
  };
}

let myName = store.get('arena.name', '');
let myChar = CHARS[store.get('arena.char', 'blaster')] ? store.get('arena.char', 'blaster') : 'blaster';
let mapSel = store.get('arena.map', 'random');
if (mapSel !== 'random' && !MAPS[mapSel]) mapSel = 'random';
let botLevel = BOT_LEVELS[store.get('arena.level', 'normal')] ? store.get('arena.level', 'normal') : 'normal';

const renderer = new Renderer($('c'), $('labels'));

// ---------------- state ----------------
let mode = 'menu';      // menu | lobby | game
let role = null;        // local | host | client
let sim = null;
let myId = null;
let hostId = null;
let lobby = [];         // roster: [{id,n,name,char,isBot,color,peer}]
let rosterByN = new Map();
let peer = null, codePeer = null;
const conns = new Map(); // host: remote peer id -> {ctrl, snap, id, lastSeq}
const pendingSnaps = new Map();
let hostCtrl = null, hostSnap = null;
let roomCode = '';
let netFx = [];
let lastSend = 0, lastTick = performance.now(), acc = 0;
const inputs = new Map();
let snaps = [], latest = null, lastSnapTick = -1, lastSnapAt = 0, snapCount = 0, snapRate = 0, snapBytes = 0, snapVia = '—';
let ping = 0, pingTimer = null;
let pred = null, history = [], visOff = { x: 0, z: 0 }, lastSentDash = 0, viewTick = 0;
let spectateId = null;
let lastAim = 0;
let migrating = false;
let lastView = null;
let lastBeep = 0;
window.__arena = {
  get sim() { return sim; }, get mode() { return mode; }, get role() { return role; }, get latest() { return latest; },
  get myId() { return myId; }, get hostId() { return hostId; }, get lobby() { return lobby; }, get snapBytes() { return snapBytes; }, get snapVia() { return snapVia; },
};

// ---------------- input ----------------
const keys = new Set();
const mouse = { nx: 0, ny: 0, left: false };
let dashSeq = 0, spSeq = 0, seq = 0;

window.addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { if (e.key === 'Enter' && e.target.id === 'codeIn') $('joinBtn').click(); return; }
  if (e.code === 'Backquote') { $('debug').classList.toggle('hidden'); e.preventDefault(); return; }
  if (e.code === 'KeyM') { toggleMute(); return; }
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat && mode === 'game') dashSeq++; }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('blur', () => { keys.clear(); mouse.left = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { keys.clear(); mouse.left = false; if (role === 'client') sendInput({ mx: 0, mz: 0, aim: lastAim, atk: false, dashSeq, spSeq, seq: ++seq, vt: Math.round(viewTick) }); }
});
window.addEventListener('contextmenu', (e) => { if (mode === 'game') e.preventDefault(); });
window.addEventListener('mousemove', (e) => { mouse.nx = (e.clientX / innerWidth) * 2 - 1; mouse.ny = -(e.clientY / innerHeight) * 2 + 1; });
$('c').addEventListener('mousedown', (e) => {
  if (mode !== 'game') return;
  if (e.button === 0) { mouse.left = true; if (amSpectating()) cycleSpectate(); }
  if (e.button === 2) spSeq++;
  e.preventDefault();
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; });
window.addEventListener('wheel', (e) => { if (mode === 'game') renderer.camDist = Math.max(0.65, Math.min(1.5, renderer.camDist + e.deltaY * 0.0008)); }, { passive: true });
function toggleMute() { setMuted(!isMuted()); $('muteBtn').textContent = isMuted() ? '🔇' : '🔊'; }
$('muteBtn').textContent = isMuted() ? '🔇' : '🔊';
$('muteBtn').onclick = () => { unlockAudio(); toggleMute(); };

function readInput(pos) {
  let mx = 0, mz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) mz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) mz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  const g = renderer.mouseToGround(mouse.nx, mouse.ny);
  if (g && pos) lastAim = Math.atan2(g.z - pos.z, g.x - pos.x);
  return { mx, mz, aim: lastAim, tx: g ? g.x : undefined, tz: g ? g.z : undefined, atk: mouse.left, dashSeq, spSeq, seq: ++seq };
}

// ---------------- ticker (worker so the host keeps simulating in background tabs) ----------------
let ticker = null;
try {
  const src = 'let id=null;onmessage=e=>{if(e.data==="start"){if(!id)id=setInterval(()=>postMessage(0),1000/60);}else{clearInterval(id);id=null;}}';
  ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  ticker.onmessage = hostTick;
} catch { setInterval(hostTick, 1000 / 60); }
ticker?.postMessage('start');

function hostTick() {
  if (!sim || (role !== 'host' && role !== 'local')) return;
  const now = performance.now();
  if (role === 'local' && document.hidden) { lastTick = now; return; }
  acc += Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;
  let n = 0;
  while (acc >= STEP && n < 15) {
    const me = sim.players.get(myId);
    if (me) inputs.set(myId, readInput(me));
    for (const p of sim.players.values()) if (p.isBot) inputs.set(p.id, botInput(sim, p, STEP));
    sim.step(STEP, inputs);
    acc -= STEP; n++;
  }
  if (n >= 15) acc = 0;
  const fx = sim.drainFx();
  for (const e of fx) handleFx(e);
  if (role === 'host') {
    netFx.push(...fx);
    if (now - lastSend >= SNAP_MS) {
      lastSend = now;
      const buf = encodeSnapshot(sim.snapshot());
      snapBytes = buf.byteLength;
      let b64 = null;
      for (const c of conns.values()) {
        if (c.snap?.open) { try { c.snap.send(buf); continue; } catch { /* fall through */ } }
        if (c.ctrl.open) { b64 = b64 || toB64(buf); c.ctrl.send({ t: 'sb', d: b64 }); }
      }
      if (netFx.length) { broadcast({ t: 'fx', fx: netFx }); netFx = []; }
    }
  }
}

// ---------------- client prediction & interpolation ----------------
function replayStep(p, h) {
  p.dashCd -= h.dt;
  p.slamT = Math.max(0, p.slamT - h.dt);
  p.blastT = Math.max(0, p.blastT - h.dt);
  if (h.dash && p.dashCd <= 0) { p.aim = h.aim; applyDash(p, h); }
  integrate(p, h, h.dt, p.spMul);
}
function onSnapshot(s) {
  const now = performance.now();
  lastSnapAt = now;
  snaps.push({ time: now, s });
  if (snaps.length > 40) snaps.shift();
  latest = snaps[snaps.length - 1];
  snapCount++;
  const me = s.players.find((p) => p.id === myId);
  if (!me || !me.alive || me.falling || s.phase !== 'play') { pred = null; history = []; visOff = { x: 0, z: 0 }; return; }
  const base = { x: me.x, z: me.z, mvx: me.mvx, mvz: me.mvz, kbx: me.kbx, kbz: me.kbz, dvx: me.dvx, dvz: me.dvz, char: me.char, aim: me.aim, dashCd: me.dashCd, slamT: me.slamT, blastT: me.blastT, bumpT: 0.2, spMul: me.speedT > 0 ? 1.5 : 1 };
  history = history.filter((h) => h.seq > me.ack);
  if (history.length > 120) history = history.slice(-120);
  for (const h of history) replayStep(base, h);
  if (pred) {
    const ex = pred.x - base.x, ez = pred.z - base.z;
    if (Math.hypot(ex + visOff.x, ez + visOff.z) < 3) { visOff.x += ex; visOff.z += ez; } else { visOff.x = 0; visOff.z = 0; }
  }
  pred = base;
}
function sendInput(inp) {
  if (hostSnap?.open) { try { hostSnap.send(encodeInput(inp)); return; } catch { /* */ } }
  if (hostCtrl?.open) hostCtrl.send({ t: 'ib', d: toB64(encodeInput(inp)) });
}
function clientFrame(dt) {
  if (!latest || migrating) return;
  const me = latest.s.players.find((p) => p.id === myId);
  const pos = pred || me;
  const inp = readInput(pos);
  inp.vt = Math.round(viewTick);
  inp.dash = inp.dashSeq !== lastSentDash; lastSentDash = inp.dashSeq;
  sendInput(inp);
  if (pred) { const h = { ...inp, dt }; history.push(h); replayStep(pred, h); }
  const k = Math.exp(-dt * 12); visOff.x *= k; visOff.z *= k;
}
const lerp = (a, b, f) => a + (b - a) * f;
function lerpAng(a, b, f) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * f; }
function clientView(now) {
  if (!latest) return null;
  const rt = now - INTERP_MS;
  let a = null, b = null;
  for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].time <= rt) { a = snaps[i]; b = snaps[i + 1] || null; break; }
  if (!a) a = snaps[0];
  const f = b ? Math.min(1, (rt - a.time) / Math.max(1, b.time - a.time)) : 0;
  viewTick = b ? lerp(a.s.tick, b.s.tick, f) : a.s.tick;
  const players = latest.s.players.map((lp) => {
    const o = { ...lp };
    const pa = a.s.players.find((q) => q.id === lp.id), pb = b && b.s.players.find((q) => q.id === lp.id);
    if (pa && pb && pa.alive === pb.alive) { o.x = lerp(pa.x, pb.x, f); o.z = lerp(pa.z, pb.z, f); o.y = lerp(pa.y, pb.y, f); o.aim = lerpAng(pa.aim, pb.aim, f); }
    else if (pa && pa.alive === lp.alive) { o.x = pa.x; o.z = pa.z; o.y = pa.y; o.aim = pa.aim; }
    if (lp.id === myId) {
      if (pred) { o.x = pred.x + visOff.x; o.z = pred.z + visOff.z; o.y = 0; }
      if (lp.alive) o.aim = lastAim;
    }
    return o;
  });
  const age = (rt - latest.time) / 1000;
  const proj = latest.s.proj.map((p) => p.kind === 1
    ? { ...p, f: Math.min(1, Math.max(0, p.f + age / Math.max(0.05, p.T))), x: lerp(p.x, p.tx, Math.min(1, Math.max(0, age / Math.max(0.05, p.T * (1 - p.f))))), z: lerp(p.z, p.tz, Math.min(1, Math.max(0, age / Math.max(0.05, p.T * (1 - p.f))))) }
    : { ...p, x: p.x + p.vx * age, z: p.z + p.vz * age });
  const zoneR = b ? lerp(a.s.zoneR, b.s.zoneR, f) : latest.s.zoneR;
  const t = b ? lerp(a.s.t, b.s.t, f) : a.s.t;
  return { ...latest.s, players, proj, zoneR, t };
}

// ---------------- render loop ----------------
let lastFrame = performance.now(), frames = 0, fps = 0, fpsT = 0;
let bannerT = 0, bannerText = '';
const idleView = { players: [], proj: [], pu: [], wells: [], zoneR: ARENA_R, t: 0 };
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  frames++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; snapRate = Math.round(snapCount * 2); snapCount = 0; updateDebug(); }
  if (mode !== 'game') { renderer.camDist = 1.25; idleView.t = now / 1000; renderer.render(idleView, null, dt, { x: Math.sin(now / 4000) * 3, z: Math.cos(now / 4000) * 3 }); return; }
  if (role === 'client') clientFrame(dt);
  const view = role === 'client' ? clientView(now) : (sim ? sim.snapshot() : null);
  if (!view) { renderer.render(idleView, null, dt, { x: 0, z: 0 }); return; }
  lastView = view;
  const me = view.players.find((p) => p.id === myId);
  let focus = me && me.alive ? me : null;
  if (!focus) {
    let t = view.players.find((p) => p.id === spectateId && p.alive);
    if (!t) { t = view.players.find((p) => p.alive); spectateId = t ? t.id : null; }
    focus = t || { x: 0, z: 0 };
  }
  let aimPt = null, tp = null;
  if (me && me.alive && !me.falling) {
    const g = renderer.mouseToGround(mouse.nx, mouse.ny);
    if (g) {
      if (me.char === 'bomber') { const c = clampTo(me.x, me.z, g.x, g.z, BOMB_RANGE, 2); aimPt = { x: c.x, z: c.z }; }
      else aimPt = g;
      if (me.char === 'trickster' && me.spCd <= 0) { const c = clampTo(me.x, me.z, g.x, g.z, TELEPORT_MAX); tp = { x: c.x, z: c.z }; }
      if (me.char === 'bomber' && me.spCd <= 0) { const c = clampTo(me.x, me.z, g.x, g.z, WELL_RANGE); tp = { x: c.x, z: c.z, r: 5.5 }; }
    }
  }
  renderer.render(view, myId, dt, focus, aimPt, tp);
  updateHud(view, me, dt);
}
requestAnimationFrame(frame);

// ---------------- HUD ----------------
const hudCache = {};
function setText(id, txt) { if (hudCache[id] !== txt) { hudCache[id] = txt; $(id).textContent = txt; } }
function setHTML(id, html) { if (hudCache[id] !== html) { hudCache[id] = html; $(id).innerHTML = html; } }
function viewPlayers() { return sim ? [...sim.players.values()] : latest?.s.players || []; }
function playerById(id) { return sim ? sim.players.get(id) : (lastView?.players.find((q) => q.id === id) || latest?.s.players.find((q) => q.id === id)); }
function nameOf(id) {
  const p = playerById(id) || lobby.find((q) => q.id === id);
  return p ? p.name : '?';
}
function amSpectating() { const me = viewPlayers().find((p) => p.id === myId); return !me || !me.alive; }
function cycleSpectate() {
  const players = viewPlayers().filter((p) => p.alive);
  if (!players.length) return;
  const i = players.findIndex((p) => p.id === spectateId);
  spectateId = players[(i + 1) % players.length].id;
}
function updateHud(v, me, dt) {
  const alive = v.players.filter((p) => p.alive).length;
  setText('roundInfo', `${MAPS[MAP.key].name} · Round ${v.round} · First to ${WINS_TO_WIN}`);
  setText('aliveInfo', `Alive ${alive}/${v.players.length}`);
  const zn = zoneNextIn(v.t);
  setText('zoneInfo', v.phase !== 'play' ? 'Zone: —' : zn > 0 ? `Zone shrinks in ${Math.ceil(zn)}s` : 'SUDDEN DEATH');
  $('zoneInfo').classList.toggle('warn', v.phase === 'play' && zn < 5);

  bannerT -= dt;
  let banner = '';
  if (v.phase === 'countdown') {
    const n = Math.max(1, Math.ceil(v.phaseT));
    banner = v.round === 1 && v.phaseT > 2.4 ? `ROUND ${v.round}` : String(n);
    if (n !== lastBeep) { lastBeep = n; sfx('beep'); }
  } else lastBeep = 0;
  if (v.phase !== 'countdown' && bannerT > 0) banner = bannerText;
  if (migrating) banner = 'Host left — switching host…';
  setText('banner', banner);
  $('banner').classList.toggle('small', migrating || banner.length > 12);

  if (me) {
    const f = Math.max(0, me.hp / me.maxHp);
    const hpEl = $('myHp');
    const w = (f * 100).toFixed(1) + '%';
    if (hpEl.style.width !== w) { hpEl.style.width = w; hpEl.style.background = f > 0.5 ? '#4cd964' : f > 0.25 ? '#ffcc00' : '#ff3b30'; }
    $('myShield').style.width = Math.min(100, me.shield / 40 * 100) + '%';
    setHTML('myName', `<span style="color:${cssColor(me.color)}">${esc(me.name)}</span> · ${CHARS[me.char].name} · ${Math.ceil(me.hp)} HP`);
    const buffs = [];
    if (me.speedT > 0) buffs.push(`⚡ Speed ${Math.ceil(me.speedT)}s`);
    if (me.dmgT > 0) buffs.push(`🔥 Damage ${Math.ceil(me.dmgT)}s`);
    if (me.shield > 0) buffs.push(`🛡 Shield ${Math.ceil(me.shield)}`);
    setText('myBuffs', buffs.join('  '));
    setText('atkName', CHARS[me.char].attack);
    setText('spName', CHARS[me.char].special);
    const dashF = Math.max(0, me.dashCd / DASH_CD), spF = Math.max(0, me.spCd / CHARS[me.char].spCd);
    $('cdDash').querySelector('.cdfill').style.height = (dashF * 100) + '%';
    $('cdSp').querySelector('.cdfill').style.height = (spF * 100) + '%';
    $('cdDash').classList.toggle('ready', dashF <= 0);
    $('cdSp').classList.toggle('ready', spF <= 0);
  }
  const spect = (!me || !me.alive) && v.phase === 'play';
  $('spectate').classList.toggle('hidden', !spect);
  $('bottom').style.opacity = me && me.alive ? 1 : 0.35;
  if (spect) setHTML('spectate', `<span>${me ? 'You were eliminated' : 'You joined mid-round'} — spectating <b>${esc(nameOf(spectateId))}</b> (click to switch)</span>`);

  const showBoard = (v.phase === 'roundEnd' && v.phaseT < 4.3) || v.phase === 'matchEnd';
  $('board').classList.toggle('hidden', !showBoard);
  if (v.phase === 'roundEnd' && v.phaseT >= 4.3) { bannerText = v.roundWinner ? `${nameOf(v.roundWinner)} wins the round!` : 'Draw!'; bannerT = 0.1; }
  if (showBoard) renderBoard(v);
}
function renderBoard(v) {
  const isMatch = v.phase === 'matchEnd';
  $('board').classList.toggle('round', !isMatch);
  const rows = [...v.players].sort((a, b) => b.wins - a.wins || b.kills - a.kills);
  const title = isMatch ? `🏆 ${nameOf(v.matchWinner)} WINS THE MATCH!` : v.roundWinner ? `${nameOf(v.roundWinner)} wins round ${v.round}` : `Round ${v.round}: draw`;
  setText('boardTitle', title);
  const body = rows.map((p) => {
    let pips = '';
    for (let i = 0; i < WINS_TO_WIN; i++) pips += `<span class="pip ${i < p.wins ? 'on' : ''}"></span>`;
    const win = isMatch ? p.id === v.matchWinner : p.id === v.roundWinner;
    return `<tr class="${win ? 'win' : ''}"><td><span class="dot" style="background:${cssColor(p.color)}"></span></td><td>${esc(p.name)}${p.id === myId ? ' (you)' : ''}${p.isBot ? ' 🤖' : ''}</td><td>${CHARS[p.char].name}</td><td>${pips}</td><td>${p.kills}</td></tr>`;
  }).join('');
  setHTML('boardTbody', body);
  const isHost = role === 'host' || role === 'local';
  setText('boardNote', isMatch ? (isHost ? '' : 'Waiting for host to start another match…') : `Next round in ${Math.max(0, Math.ceil(v.phaseT))}s`);
  $('boardBtns').classList.toggle('hidden', !isMatch);
  $('againBtn').classList.toggle('hidden', !isHost);
  $('toLobbyBtn').classList.toggle('hidden', role !== 'host');
}
$('boardTable').querySelector('tbody').id = 'boardTbody';

// ---------------- effects: sound, shake, hit-stop, damage numbers, kill feed ----------------
const feed = [];
function fxPos(e) {
  if (e.x !== undefined) return e;
  if (e.x1 !== undefined) return { x: e.x1, z: e.z1 };
  const p = e.id && (lastView?.players.find((q) => q.id === e.id) || playerById(e.id));
  return p || null;
}
function nearVol(e) {
  const p = fxPos(e);
  if (!p) return 0.6;
  const c = renderer.camTarget;
  return Math.max(0, Math.min(1, 1.15 - Math.hypot(p.x - c.x, p.z - c.z) / 26));
}
function handleFx(e) {
  renderer.addFx(e);
  const mine = e.id === myId;
  const vol = mine ? 1 : nearVol(e);
  switch (e.k) {
    case 'shot': sfx('shot', mine ? 1 : vol * 0.5); break;
    case 'swing': sfx('swing', vol); break;
    case 'lob': sfx('lob', vol); break;
    case 'hit': {
      const amt = e.d >= 1 ? Math.round(e.d) : e.d;
      if (mine) { sfx(e.s ? 'shieldhit' : 'hurt', 1); renderer.shake(e.s ? 0.15 : 0.35); renderer.hitstop(e.s ? 30 : 70); renderer.popText(e.x, e.z, '-' + amt, 'hurt'); }
      else if (e.by === myId) { sfx(e.s ? 'shieldhit' : 'hit', 1); renderer.shake(0.12); renderer.hitstop(45); renderer.popText(e.x, e.z, String(amt), 'dealt'); }
      else { sfx(e.s ? 'shieldhit' : 'hit', vol * 0.5); if (vol > 0.3) renderer.popText(e.x, e.z, String(amt), 'other'); }
      break;
    }
    case 'charge': sfx('charge', vol); break;
    case 'ring': sfx(e.slam ? 'slam' : 'blast', vol); renderer.shake((e.slam ? 0.6 : 0.45) * vol); break;
    case 'boom': sfx('boom', vol); renderer.shake(0.4 * vol); break;
    case 'well': sfx('well', vol); break;
    case 'tp': sfx('tp', vol); break;
    case 'dash': sfx('dash', mine ? 0.8 : vol * 0.4); break;
    case 'bump': sfx('bump', vol); if (mine) renderer.shake(0.25); break;
    case 'sweep': sfx('sweep', vol); if (mine) { renderer.shake(0.5); renderer.hitstop(60); } break;
    case 'pickup': sfx('pickup', mine ? 1 : vol * 0.4); if (mine) renderer.popText(e.x, e.z, { speed: 'SPEED!', shield: 'SHIELD!', dmg: 'DAMAGE!' }[e.type], 'buff'); break;
    case 'falling': sfx('fall', vol); break;
    case 'fight': sfx('fight'); bannerText = 'FIGHT!'; bannerT = 0.8; break;
    case 'zone': sfx('zone'); bannerText = 'The zone is closing!'; bannerT = 1.5; break;
    case 'roundEnd': if (e.winner === myId) sfx('win'); break;
    case 'elim': {
      sfx('elim', vol);
      const v = nameOf(e.id);
      const txt = e.by ? `${nameOf(e.by)} ✖ ${v}${e.how === 'fall' ? ' (ring out)' : ''}` : `${v} ${e.how === 'fall' ? 'fell off' : e.how === 'zone' ? 'was eaten by the zone' : 'was KO\'d'}`;
      feed.push({ txt, t: performance.now() });
      if (mine) { bannerText = 'ELIMINATED'; bannerT = 1.5; renderer.shake(0.9); renderer.hitstop(120); }
      if (e.by === myId) renderer.hitstop(90);
      renderFeed();
      break;
    }
  }
}
function feedNote(txt) { feed.push({ txt, t: performance.now() }); renderFeed(); }
function renderFeed() {
  const now = performance.now();
  while (feed.length && (feed.length > 5 || now - feed[0].t > 6000)) feed.shift();
  $('killfeed').innerHTML = feed.map((f) => `<div>${esc(f.txt)}</div>`).join('');
}
setInterval(renderFeed, 1000);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function updateDebug() {
  if ($('debug').classList.contains('hidden')) return;
  const players = sim ? [...sim.players.values()] : latest?.s.players || lobby;
  const bots = players.filter((p) => p.isBot).length;
  const alive = players.filter((p) => p.alive).length;
  const pingTxt = role === 'client' ? `${Math.round(ping)} ms` : role === 'host' ? '0 ms (you are host)' : role === 'local' ? 'n/a (offline)' : '—';
  const lines = [
    `FPS      ${fps}`,
    `Ping     ${pingTxt}`,
    `Players  ${players.length} (${players.length - bots} human, ${bots} bot)${mode === 'game' ? `, ${alive} alive` : ''}`,
    `Role     ${role || '—'}${roomCode ? '  room ' + roomCode : ''}`,
    `Mode     ${mode}${sim ? ' / ' + sim.phase : latest ? ' / ' + latest.s.phase : ''}  map ${MAP.key}`,
  ];
  if (role === 'client') lines.push(`Snaps/s  ${snapRate}  (${snapBytes} B, ${snapVia})`, `Pred err ${Math.hypot(visOff.x, visOff.z).toFixed(2)}  rewind ${Math.round((latest ? latest.s.tick - viewTick : 0) * 1000 / 60)} ms`);
  if (role === 'host') {
    const rws = sim ? [...sim.players.values()].filter((p) => p.rw).map((p) => Math.round(p.rw * 1000 / 60) + 'ms') : [];
    lines.push(`Peers    ${conns.size}  snapshot ${snapBytes} B`, `Rewind   ${rws.join(' ') || '—'}`);
  }
  $('debug').textContent = lines.join('\n');
}

// ---------------- screens ----------------
function show(screen) {
  for (const s of ['menu', 'lobby']) $(s).classList.toggle('hidden', s !== screen);
  $('hud').classList.toggle('hidden', screen !== 'game');
  if (screen !== 'game') $('board').classList.add('hidden');
}
function buildCharPick(el) {
  el.innerHTML = CHAR_KEYS.map((k) => `<button data-c="${k}">${CHARS[k].name}<small>${CHARS[k].attack} · ${CHARS[k].special}</small></button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setChar(b.dataset.c);
  });
}
function setChar(c) {
  myChar = c; store.set('arena.char', c);
  for (const b of document.querySelectorAll('.charpick button')) b.classList.toggle('sel', b.dataset.c === c);
  if (mode === 'lobby') {
    if (role === 'host') { const me = lobby.find((p) => p.id === myId); if (me) me.char = c; broadcastRoster(); }
    else if (role === 'client' && hostCtrl?.open) hostCtrl.send({ t: 'char', char: c });
  }
}
function buildSelects() {
  const mapOpts = `<option value="random">Random arena</option>` + MAP_KEYS.map((k) => `<option value="${k}">${MAPS[k].name}</option>`).join('');
  const lvlOpts = Object.keys(BOT_LEVELS).map((k) => `<option value="${k}">${BOT_LEVELS[k].label} bots</option>`).join('');
  for (const id of ['mapSelMenu', 'mapSelLobby']) { $(id).innerHTML = mapOpts; $(id).value = mapSel; $(id).onchange = (e) => { mapSel = e.target.value; store.set('arena.map', mapSel); syncSelects(); if (role === 'host') broadcastRoster(); }; }
  for (const id of ['lvlSelMenu', 'lvlSelLobby']) { $(id).innerHTML = lvlOpts; $(id).value = botLevel; $(id).onchange = (e) => { botLevel = e.target.value; store.set('arena.level', botLevel); syncSelects(); if (role === 'host') broadcastRoster(); }; }
}
function syncSelects() { for (const id of ['mapSelMenu', 'mapSelLobby']) $(id).value = mapSel; for (const id of ['lvlSelMenu', 'lvlSelLobby']) $(id).value = botLevel; }
buildCharPick($('charPickMenu'));
buildCharPick($('charPickLobby'));
buildSelects();
setChar(myChar);
$('nameIn').value = myName;
$('nameIn').addEventListener('input', () => { myName = $('nameIn').value.trim(); store.set('arena.name', myName); });
const getName = () => (myName || 'Player').slice(0, 12);
function menuMsg(t) { $('menuMsg').textContent = t || ''; }

function renderLobby() {
  setText('roomCode', roomCode);
  $('lobbyList').innerHTML = lobby.map((p) => {
    const tags = [CHARS[p.char].name];
    if (p.id === hostId) tags.push('Host');
    if (p.isBot) tags.push('Bot');
    if (p.id === myId) tags.push('You');
    return `<li><span><span class="dot" style="background:${cssColor(p.color)}"></span>${esc(p.name)}</span><span class="tag">${tags.join(' · ')}</span></li>`;
  }).join('') + `<li class="tag" style="justify-content:center;opacity:.5">${lobby.length}/${MAX_PLAYERS} players</li>`;
  const host = role === 'host';
  $('hostCtrls').classList.toggle('hidden', !host);
  $('lobbySettings').classList.toggle('hidden', !host);
  $('lobbySettingsText').classList.toggle('hidden', host);
  setText('lobbySettingsText', `${mapSel === 'random' ? 'Random arena' : MAPS[mapSel].name} · ${BOT_LEVELS[botLevel].label} bots`);
  $('startBtn').disabled = lobby.length < 2;
  $('addBotBtn').disabled = lobby.length >= MAX_PLAYERS;
  $('remBotBtn').disabled = !lobby.some((p) => p.isBot);
  $('lobbyHint').textContent = host ? 'Share this code with friends. 2–8 players. Add bots to fill the arena.' : 'Waiting for the host to start…';
}
function freeColor() { for (let i = 0; i < 8; i++) if (!lobby.some((p) => p.color === i)) return i; return 0; }
function freeN() { let n = 0; while (lobby.some((p) => p.n === n)) n++; return n; }
function nextId(prefix) { let k = 1; while (lobby.some((p) => p.id === prefix + k)) k++; return prefix + k; }
function makeBot() {
  const used = new Set(lobby.map((p) => p.name));
  const name = BOT_NAMES.find((n) => !used.has('Bot ' + n)) || 'X' + lobby.length;
  return { id: nextId('b'), n: freeN(), name: 'Bot ' + name, char: CHAR_KEYS[Math.floor(Math.random() * CHAR_KEYS.length)], isBot: true, color: freeColor() };
}
const pickMap = () => (mapSel === 'random' ? MAP_KEYS[Math.floor(Math.random() * MAP_KEYS.length)] : mapSel);

function startMatchFromLobby() {
  sim = new Sim(pickMap());
  sim.botLevel = botLevel;
  for (const p of lobby) sim.addPlayer(p);
  sim.startMatch();
  inputs.clear();
  acc = 0; lastTick = performance.now();
  enterGame();
}
function enterGame() {
  mode = 'game';
  renderer.clearPlayers();
  renderer.camDist = 1;
  feed.length = 0; renderFeed();
  spectateId = null; pred = null; history = []; snaps = []; latest = null; lastSnapTick = -1;
  show('game');
}

// ---------------- buttons ----------------
$('quickBtn').onclick = () => {
  unlockAudio();
  leaveNet();
  role = 'local'; myId = 'p1'; hostId = 'p1'; roomCode = '';
  lobby = [{ id: 'p1', n: 0, name: getName(), char: myChar, isBot: false, color: 0 }];
  for (let i = 0; i < 5; i++) lobby.push(makeBot());
  startMatchFromLobby();
};
$('createBtn').onclick = () => { unlockAudio(); hostRoom(); };
$('joinBtn').onclick = () => {
  unlockAudio();
  const code = $('codeIn').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { menuMsg('Enter the 4-letter room code.'); return; }
  joinRoom(code);
};
$('addBotBtn').onclick = () => { if (lobby.length < MAX_PLAYERS) { lobby.push(makeBot()); broadcastRoster(); } };
$('remBotBtn').onclick = () => { const i = lobby.map((p) => p.isBot).lastIndexOf(true); if (i >= 0) { lobby.splice(i, 1); broadcastRoster(); } };
$('startBtn').onclick = () => {
  if (role !== 'host' || lobby.length < 2) return;
  startMatchFromLobby();
  broadcastRoster();
  broadcast({ t: 'start', map: MAP.key });
};
$('leaveBtn').onclick = () => toMenu();
$('toMenuBtn').onclick = () => toMenu();
$('againBtn').onclick = () => {
  if (!sim) return;
  if (mapSel === 'random') { const k = pickMap(); setMap(k); sim.map = k; }
  sim.botLevel = botLevel;
  sim.startMatch();
  renderer.clearPlayers(); feed.length = 0; renderFeed();
  if (role === 'host') broadcast({ t: 'start', map: MAP.key });
};
$('toLobbyBtn').onclick = () => {
  if (role !== 'host') return;
  sim = null; mode = 'lobby';
  broadcast({ t: 'toLobby' });
  broadcastRoster();
  show('lobby');
};

function toMenu(msg) {
  leaveNet();
  sim = null; role = null; myId = null; hostId = null; lobby = []; roomCode = ''; latest = null; snaps = []; migrating = false;
  mode = 'menu';
  renderer.clearPlayers();
  show('menu');
  menuMsg(msg || '');
}

// ---------------- networking ----------------
let PeerCls = null;
async function loadPeer() {
  if (PeerCls) return PeerCls;
  const mod = await import('peerjs');
  PeerCls = mod.Peer || mod.default;
  return PeerCls;
}
function openPeer(id) {
  return new Promise((res, rej) => {
    const p = id ? new PeerCls(id, { debug: 1 }) : new PeerCls({ debug: 1 });
    const onErr = (e) => { clearTimeout(t); p.destroy(); rej(e); };
    const t = setTimeout(() => onErr(new Error('Timed out reaching the PeerJS server')), 12000);
    p.on('error', onErr);
    p.on('open', () => { clearTimeout(t); p.off('error', onErr); res(p); });
  });
}
function closeHostConns() {
  const a = hostCtrl, b = hostSnap;
  hostCtrl = null; hostSnap = null;
  try { a?.close(); } catch { /* */ }
  try { b?.close(); } catch { /* */ }
}
function leaveNet() {
  clearInterval(pingTimer); pingTimer = null;
  for (const c of conns.values()) { try { c.ctrl.close(); c.snap?.close(); } catch { /* */ } }
  conns.clear(); pendingSnaps.clear();
  closeHostConns();
  try { peer?.destroy(); } catch { /* */ }
  try { codePeer?.destroy(); } catch { /* */ }
  peer = null; codePeer = null;
}
function setBusy(b) { for (const id of ['quickBtn', 'createBtn', 'joinBtn']) $(id).disabled = b; }
function toAB(d) {
  if (d instanceof ArrayBuffer) return d;
  if (ArrayBuffer.isView(d)) return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
  return null;
}
function withAB(d, fn) { const ab = toAB(d); if (ab) fn(ab); else if (d instanceof Blob) d.arrayBuffer().then(fn); }

async function hostRoom() {
  leaveNet(); setBusy(true); menuMsg('Creating room…');
  try {
    await loadPeer();
    let lastErr = null;
    for (let i = 0; i < 5 && !peer; i++) {
      const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      try { peer = await openPeer(ROOM_PREFIX + code); roomCode = code; } catch (e) { lastErr = e; if (e.type !== 'unavailable-id') break; }
    }
    if (!peer) throw lastErr || new Error('Could not create room');
  } catch (e) { setBusy(false); menuMsg('Could not create room: ' + (e.message || e.type || e)); return; }
  setBusy(false); menuMsg('');
  role = 'host'; myId = 'p1'; hostId = 'p1'; mode = 'lobby';
  lobby = [{ id: 'p1', n: 0, name: getName(), char: myChar, isBot: false, color: 0, peer: peer.id }];
  attachPeerHandlers(peer);
  show('lobby'); renderLobby();
}
function attachPeerHandlers(p) {
  p.on('connection', onConn);
  p.on('disconnected', () => { if (p === peer && !p.destroyed) { try { p.reconnect(); } catch { /* */ } } });
}
function onConn(conn) {
  if (role === 'client') {
    // a client only connects to us if it thinks the old host is gone and we're next in line
    becomeHost(hostId);
  }
  if (role !== 'host') { setTimeout(() => conn.close(), 200); return; }
  if (conn.label === 'snap') {
    conn.on('data', (d) => withAB(d, (ab) => onInputPacket(conn.peer, ab)));
    const c = conns.get(conn.peer);
    if (c) c.snap = conn; else pendingSnaps.set(conn.peer, conn);
    conn.on('close', () => { const c2 = conns.get(conn.peer); if (c2 && c2.snap === conn) c2.snap = null; });
    return;
  }
  conn.on('data', (msg) => hostOnData(conn, msg));
  conn.on('close', () => dropConn(conn));
  conn.on('error', () => dropConn(conn));
}
function onInputPacket(peerId, ab) {
  const c = conns.get(peerId);
  if (!c) return;
  const inp = decodeInput(ab);
  if (!inp || inp.seq <= c.lastSeq) return; // unordered channel: ignore stale packets
  c.lastSeq = inp.seq;
  inputs.set(c.id, inp);
}
function admit(conn, entry) {
  const c = { ctrl: conn, snap: pendingSnaps.get(conn.peer) || null, id: entry.id, lastSeq: 0 };
  pendingSnaps.delete(conn.peer);
  conns.set(conn.peer, c);
  entry.peer = conn.peer;
  delete entry.pending;
  conn.send({ t: 'welcome', id: entry.id, code: roomCode, hostId });
  broadcastRoster();
  if (mode === 'game') conn.send({ t: 'start', map: MAP.key });
}
function hostOnData(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  const c = conns.get(conn.peer);
  switch (msg.t) {
    case 'hello': {
      if (c) return;
      if (lobby.length >= MAX_PLAYERS) { conn.send({ t: 'reject', reason: 'Room is full (8 players).' }); setTimeout(() => conn.close(), 500); return; }
      const entry = { id: nextId('p'), n: freeN(), name: String(msg.name || 'Player').slice(0, 12), char: CHARS[msg.char] ? msg.char : 'blaster', isBot: false, color: freeColor() };
      lobby.push(entry);
      if (sim) sim.addPlayer(entry); // joins mid-match as a spectator, plays from next round
      admit(conn, entry);
      if (mode === 'game') broadcast({ t: 'note', txt: `${entry.name} joined (plays next round)` });
      break;
    }
    case 'rejoin': {
      if (c) return;
      const entry = lobby.find((p) => p.id === msg.id && !p.isBot);
      if (!entry) { hostOnData(conn, { ...msg, t: 'hello' }); return; }
      admit(conn, entry);
      break;
    }
    case 'char': {
      if (!c || !CHARS[msg.char] || mode !== 'lobby') return;
      const p = lobby.find((q) => q.id === c.id); if (p) p.char = msg.char;
      broadcastRoster();
      break;
    }
    case 'ib': if (c) onInputPacket(conn.peer, fromB64(msg.d)); break;
    case 'ping': conn.send({ t: 'pong', ts: msg.ts }); break;
  }
}
function dropConn(conn) {
  const c = conns.get(conn.peer);
  if (!c || c.ctrl !== conn) return;
  conns.delete(conn.peer);
  try { c.snap?.close(); } catch { /* */ }
  const p = lobby.find((q) => q.id === c.id);
  lobby = lobby.filter((q) => q.id !== c.id);
  inputs.delete(c.id);
  if (sim) sim.removePlayer(c.id);
  if (p && mode === 'game') { feedNote(`${p.name} left`); broadcast({ t: 'note', txt: `${p.name} left` }); }
  broadcastRoster();
}
function broadcast(msg) { for (const c of conns.values()) if (c.ctrl.open) { try { c.ctrl.send(msg); } catch { /* */ } } }
function broadcastRoster() {
  broadcast({ t: 'roster', players: lobby, hostId, code: roomCode, map: mapSel, level: botLevel });
  if (mode === 'lobby') renderLobby();
}

// ----- client side -----
async function joinRoom(code) {
  leaveNet(); setBusy(true); menuMsg('Connecting…');
  try {
    await loadPeer();
    peer = await openPeer(null);
  } catch (e) { setBusy(false); menuMsg('Could not reach PeerJS server: ' + (e.message || e.type || e)); return; }
  attachPeerHandlers(peer);
  try {
    await connectToHost(ROOM_PREFIX + code, { t: 'hello', name: getName(), char: myChar }, 12000);
  } catch (e) {
    leaveNet(); setBusy(false);
    if (e && e.reason) toMenu(e.reason); else menuMsg(e && e.type === 'peer-unavailable' ? `Room ${code} not found.` : `Could not connect to room ${code}.`);
    return;
  }
  setBusy(false); menuMsg('');
}

// Opens the control (reliable JSON) + snapshot (unreliable binary) channels and waits for 'welcome'.
function connectToHost(peerId, hello, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => { if (done) return; done = true; clearTimeout(timer); peer.off('error', onErr); if (err) { try { ctrl.close(); snap.close(); } catch { /* */ } reject(err); } else resolve(); };
    const onErr = (e) => { if (e.type === 'peer-unavailable' && String(e.message || '').includes(peerId)) finish(e); else if (e.type === 'peer-unavailable') finish(e); };
    peer.on('error', onErr);
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    const ctrl = peer.connect(peerId, { label: 'ctrl', reliable: true, serialization: 'json' });
    const snap = peer.connect(peerId, { label: 'snap', reliable: false, serialization: 'raw' });
    ctrl.on('open', () => ctrl.send(hello));
    snap.on('data', (d) => withAB(d, (ab) => { if (snap === hostSnap) onSnapPacket(ab, 'unreliable'); }));
    ctrl.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'welcome' && !done) {
        closeHostConns();
        hostCtrl = ctrl; hostSnap = snap;
        role = 'client'; myId = msg.id; roomCode = msg.code; hostId = msg.hostId; migrating = false;
        if (mode !== 'game') { mode = 'lobby'; show('lobby'); renderLobby(); }
        clearInterval(pingTimer);
        pingTimer = setInterval(() => { if (hostCtrl?.open) hostCtrl.send({ t: 'ping', ts: performance.now() }); }, 1000);
        finish();
        return;
      }
      if (msg.t === 'reject') { finish({ reason: msg.reason }); return; }
      if (ctrl === hostCtrl) clientOnCtrl(msg);
    });
    ctrl.on('close', () => { if (ctrl === hostCtrl) onHostLost(); else finish(new Error('closed')); });
  });
}
function onSnapPacket(ab, via) {
  const s = decodeSnapshot(ab, rosterByN);
  if (!s || s.tick <= lastSnapTick) return; // drop stale/out-of-order snapshots
  lastSnapTick = s.tick;
  snapBytes = ab.byteLength; snapVia = via;
  if (role !== 'client') return;
  if (mode !== 'game') enterGame();
  onSnapshot(s);
}
function clientOnCtrl(msg) {
  switch (msg.t) {
    case 'roster':
      lobby = msg.players; hostId = msg.hostId; roomCode = msg.code; mapSel = msg.map; botLevel = msg.level;
      rosterByN = new Map(lobby.map((p) => [p.n, p]));
      syncSelects();
      if (mode === 'lobby') renderLobby();
      break;
    case 'start':
      setMap(msg.map);
      if (mode !== 'game') enterGame(); else { renderer.clearPlayers(); feed.length = 0; renderFeed(); }
      break;
    case 'toLobby': mode = 'lobby'; latest = null; snaps = []; lastSnapTick = -1; renderer.clearPlayers(); show('lobby'); renderLobby(); break;
    case 'sb': onSnapPacket(fromB64(msg.d), 'fallback'); break;
    case 'fx': for (const e of msg.fx) handleFx(e); break;
    case 'note': feedNote(msg.txt); break;
    case 'pong': ping = performance.now() - msg.ts; break;
  }
}

// ---------------- host migration ----------------
// Every client knows the roster in join order. When the host vanishes, the first remaining human
// becomes host (rebuilding the game from its last snapshot) and everyone else reconnects to it.
setInterval(() => {
  if (role === 'client' && mode === 'game' && !migrating && lastSnapAt && performance.now() - lastSnapAt > 3000) onHostLost();
}, 500);
async function onHostLost() {
  if (role !== 'client' || migrating) return;
  migrating = true;
  const oldHost = hostId;
  closeHostConns();
  pred = null; history = [];
  const cands = lobby.filter((p) => !p.isBot && p.id !== oldHost && p.peer);
  feedNote(`${nameOf(oldHost)} (host) left`);
  for (const c of cands) {
    if (role !== 'client') return; // someone already made us host
    if (c.id === myId) { becomeHost(oldHost); return; }
    try {
      await connectToHost(c.peer, { t: 'rejoin', id: myId, name: getName(), char: myChar }, 7000);
      lastSnapAt = performance.now();
      return;
    } catch { /* try the next candidate */ }
  }
  if (role === 'client') toMenu('The host left and no one could take over.');
}
function becomeHost(oldHost) {
  if (role === 'host') return;
  closeHostConns();
  clearInterval(pingTimer);
  migrating = false;
  role = 'host';
  const old = lobby.find((p) => p.id === oldHost);
  lobby = lobby.filter((p) => p.id !== oldHost);
  hostId = myId;
  for (const p of lobby) if (!p.isBot && p.id !== myId) p.pending = true;
  if (mode === 'game' && latest) {
    sim = Sim.fromSnapshot(latest.s, lobby, MAP.key, botLevel);
    inputs.clear(); acc = 0; lastTick = performance.now();
    pred = null; history = [];
  } else { sim = null; mode = 'lobby'; show('lobby'); }
  feedNote('You are now the host');
  if (old) bannerText = 'You are now the host', bannerT = 2;
  // drop players that never reconnect
  setTimeout(() => {
    for (const p of lobby.filter((q) => q.pending)) { lobby = lobby.filter((q) => q !== p); sim?.removePlayer(p.id); }
    broadcastRoster();
  }, 10000);
  claimRoomCode();
  if (mode === 'lobby') renderLobby();
}
// Re-register the room code so new players can still join with the same code.
async function claimRoomCode(tries = 0) {
  if (role !== 'host' || !roomCode || codePeer || tries > 20) return;
  try {
    codePeer = await openPeer(ROOM_PREFIX + roomCode);
    codePeer.on('connection', onConn);
  } catch { setTimeout(() => claimRoomCode(tries + 1), 3000); }
}

show('menu');
