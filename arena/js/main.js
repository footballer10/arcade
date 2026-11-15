// Arena Royale - UI, input, game loop and PeerJS networking.
import { Sim, CHARS, CHAR_KEYS, MAX_PLAYERS, ARENA_R, WINS_TO_WIN, DASH_CD, integrate, applyDash, zoneNextIn } from './sim.js';
import { botInput, BOT_NAMES } from './bots.js';
import { Renderer, cssColor } from './render.js';

const $ = (id) => document.getElementById(id);
const STEP = 1 / 60;
const ROOM_PREFIX = 'fb10-arena-royale-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const INTERP_MS = 100;
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

let myName = store.get('arena.name', '');
let myChar = CHARS[store.get('arena.char', 'blaster')] ? store.get('arena.char', 'blaster') : 'blaster';

const renderer = new Renderer($('c'), $('labels'));
window.__arena = { get sim() { return sim; }, get mode() { return mode; }, get role() { return role; }, get latest() { return latest; } };

// ---------------- state ----------------
let mode = 'menu';      // menu | lobby | game
let role = null;        // local | host | client
let sim = null;
let myId = null;
let lobby = [];         // [{id,name,char,isBot,color}]
let peer = null;
const conns = new Map(); // host: conn.peer -> {conn, id}
let hostConn = null;
let roomCode = '';
let nextPid = 1, nextBot = 0;
let netFx = [];
let lastSend = 0, lastTick = performance.now(), acc = 0;
const inputs = new Map();
let snaps = [], latest = null, snapCount = 0, snapRate = 0;
let ping = 0, pingTimer = null;
let pred = null, history = [], visOff = { x: 0, z: 0 }, lastSentDash = 0;
let spectateId = null;
let lastAim = 0;

// ---------------- input ----------------
const keys = new Set();
const mouse = { nx: 0, ny: 0, left: false };
let dashSeq = 0, spSeq = 0, seq = 0;

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter' && e.target.id === 'codeIn') $('joinBtn').click(); return; }
  if (e.code === 'Backquote') { $('debug').classList.toggle('hidden'); e.preventDefault(); return; }
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat && mode === 'game') dashSeq++; }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouse.left = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); mouse.left = false; if (role === 'client' && hostConn?.open) hostConn.send({ t: 'i', i: { mx: 0, mz: 0, aim: lastAim, atk: false, dashSeq, spSeq, seq: ++seq } }); } });
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

function readInput(pos) {
  let mx = 0, mz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) mz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) mz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  const g = renderer.mouseToGround(mouse.nx, mouse.ny);
  if (g && pos) lastAim = Math.atan2(g.z - pos.z, g.x - pos.x);
  return { mx, mz, aim: lastAim, tx: g ? +g.x.toFixed(2) : undefined, tz: g ? +g.z.toFixed(2) : undefined, atk: mouse.left, dashSeq, spSeq, seq: ++seq };
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
    if (now - lastSend >= 50) {
      lastSend = now;
      const s = sim.snapshot(); s.fx = netFx; netFx = [];
      broadcast({ t: 's', s });
    }
  }
}

// ---------------- client prediction ----------------
function replayStep(p, h) {
  p.dashCd -= h.dt;
  p.slamT = Math.max(0, p.slamT - h.dt);
  if (h.dash && p.dashCd <= 0) { p.aim = h.aim; applyDash(p, h); }
  integrate(p, h, h.dt, p.spMul);
}
function onSnapshot(s) {
  const now = performance.now();
  snaps.push({ time: now, s });
  if (snaps.length > 40) snaps.shift();
  latest = snaps[snaps.length - 1];
  snapCount++;
  for (const e of s.fx || []) handleFx(e);
  const me = s.players.find((p) => p.id === myId);
  if (!me || !me.alive || me.falling || s.phase !== 'play') { pred = null; history = []; visOff = { x: 0, z: 0 }; return; }
  const base = { x: me.x, z: me.z, mvx: me.mvx, mvz: me.mvz, kbx: me.kbx, kbz: me.kbz, dvx: me.dvx, dvz: me.dvz, char: me.char, aim: me.aim, dashCd: me.dashCd, slamT: me.slamT, spMul: me.speedT > 0 ? 1.5 : 1 };
  history = history.filter((h) => h.seq > me.ack);
  if (history.length > 120) history = history.slice(-120);
  for (const h of history) replayStep(base, h);
  if (pred) {
    const ex = pred.x - base.x, ez = pred.z - base.z;
    if (Math.hypot(ex + visOff.x, ez + visOff.z) < 3) { visOff.x += ex; visOff.z += ez; } else { visOff.x = 0; visOff.z = 0; }
  }
  pred = base;
}
function clientFrame(dt) {
  if (!hostConn?.open || !latest) return;
  const me = latest.s.players.find((p) => p.id === myId);
  const pos = pred || me;
  const inp = readInput(pos);
  inp.dash = inp.dashSeq !== lastSentDash; lastSentDash = inp.dashSeq;
  hostConn.send({ t: 'i', i: inp });
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
  const proj = latest.s.proj.map((p) => ({ ...p, x: p.x + p.vx * age, z: p.z + p.vz * age }));
  const zoneR = b ? lerp(a.s.zoneR, b.s.zoneR, f) : latest.s.zoneR;
  return { ...latest.s, players, proj, zoneR };
}

// ---------------- render loop ----------------
let lastFrame = performance.now(), frames = 0, fps = 0, fpsT = 0;
let bannerT = 0, bannerText = '';
const idleView = { players: [], proj: [], pu: [], zoneR: ARENA_R };
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  frames++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; snapRate = Math.round(snapCount * 2); snapCount = 0; updateDebug(); }
  if (mode !== 'game') { renderer.camDist = 1.25; renderer.render(idleView, null, dt, { x: Math.sin(now / 4000) * 3, z: Math.cos(now / 4000) * 3 }); return; }
  if (role === 'client') clientFrame(dt);
  const view = role === 'client' ? clientView(now) : { ...sim.snapshot(), proj: sim.proj, pu: sim.pu };
  if (!view) return;
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
      aimPt = g;
      if (me.char === 'trickster' && me.spCd <= 0) {
        const dx = g.x - me.x, dz = g.z - me.z, d = Math.hypot(dx, dz), k = d > 7 ? 7 / d : 1;
        tp = { x: me.x + dx * k, z: me.z + dz * k };
      }
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
function nameOf(id) {
  const p = sim ? sim.players.get(id) : latest?.s.players.find((q) => q.id === id);
  return p ? p.name : '?';
}
function amSpectating() {
  const players = sim ? [...sim.players.values()] : latest?.s.players || [];
  const me = players.find((p) => p.id === myId);
  return !me || !me.alive;
}
function cycleSpectate() {
  const players = (sim ? [...sim.players.values()] : latest?.s.players || []).filter((p) => p.alive);
  if (!players.length) return;
  const i = players.findIndex((p) => p.id === spectateId);
  spectateId = players[(i + 1) % players.length].id;
}
function updateHud(v, me, dt) {
  const alive = v.players.filter((p) => p.alive).length;
  setText('roundInfo', `Round ${v.round} · First to ${WINS_TO_WIN}`);
  setText('aliveInfo', `Alive ${alive}/${v.players.length}`);
  const zn = zoneNextIn(v.t);
  const zt = v.phase !== 'play' ? 'Zone: —' : zn > 0 ? `Zone shrinks in ${Math.ceil(zn)}s` : 'SUDDEN DEATH';
  setText('zoneInfo', zt);
  $('zoneInfo').classList.toggle('warn', v.phase === 'play' && zn < 5);

  // banner
  bannerT -= dt;
  let banner = '';
  if (v.phase === 'countdown') banner = v.round === 1 && v.phaseT > 2.4 ? `ROUND ${v.round}` : String(Math.max(1, Math.ceil(v.phaseT)));
  else if (bannerT > 0) banner = bannerText;
  setText('banner', banner);

  // me
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
  if (spect) setHTML('spectate', `<span>You were eliminated — spectating <b>${esc(nameOf(spectateId))}</b> (click to switch)</span>`);

  // scoreboard
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

const feed = [];
function handleFx(e) {
  renderer.addFx(e);
  if (e.k === 'elim') {
    const v = nameOf(e.id);
    const txt = e.by ? `${nameOf(e.by)} ✖ ${v}${e.how === 'fall' ? ' (ring out)' : ''}` : `${v} ${e.how === 'fall' ? 'fell off' : e.how === 'zone' ? 'was eaten by the zone' : 'was KO\'d'}`;
    feed.push({ txt, t: performance.now() });
    if (e.id === myId) { bannerText = 'ELIMINATED'; bannerT = 1.5; }
    renderFeed();
  } else if (e.k === 'fight') { bannerText = 'FIGHT!'; bannerT = 0.8; }
}
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
    `Mode     ${mode}${sim ? ' / ' + sim.phase : latest ? ' / ' + latest.s.phase : ''}`,
  ];
  if (role === 'client') lines.push(`Snaps/s  ${snapRate}`, `Pred err ${Math.hypot(visOff.x, visOff.z).toFixed(2)}`);
  if (role === 'host') lines.push(`Peers    ${conns.size}`);
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
    if (role === 'host') { const me = lobby.find((p) => p.id === myId); if (me) me.char = c; broadcastLobby(); }
    else if (role === 'client' && hostConn?.open) hostConn.send({ t: 'char', char: c });
  }
}
buildCharPick($('charPickMenu'));
buildCharPick($('charPickLobby'));
setChar(myChar);
$('nameIn').value = myName;
$('nameIn').addEventListener('input', () => { myName = $('nameIn').value.trim(); store.set('arena.name', myName); });
const getName = () => (myName || 'Player').slice(0, 12);
function menuMsg(t) { $('menuMsg').textContent = t || ''; }

function renderLobby() {
  setText('roomCode', roomCode);
  $('lobbyList').innerHTML = lobby.map((p) => {
    const tags = [CHARS[p.char].name];
    if (p.id === 'p1') tags.push('Host');
    if (p.isBot) tags.push('Bot');
    if (p.id === myId) tags.push('You');
    return `<li><span><span class="dot" style="background:${cssColor(p.color)}"></span>${esc(p.name)}</span><span class="tag">${tags.join(' · ')}</span></li>`;
  }).join('') + `<li class="tag" style="justify-content:center;opacity:.5">${lobby.length}/${MAX_PLAYERS} players</li>`;
  const host = role === 'host';
  $('hostCtrls').classList.toggle('hidden', !host);
  $('startBtn').disabled = lobby.length < 2;
  $('addBotBtn').disabled = lobby.length >= MAX_PLAYERS;
  $('remBotBtn').disabled = !lobby.some((p) => p.isBot);
  $('lobbyHint').textContent = host ? 'Share this code with friends. 2–8 players. Add bots to fill the arena.' : 'Waiting for the host to start…';
}
function freeColor() { for (let i = 0; i < 8; i++) if (!lobby.some((p) => p.color === i)) return i; return 0; }
function makeBot() {
  const used = new Set(lobby.map((p) => p.name));
  let name = BOT_NAMES.find((n) => !used.has('Bot ' + n)) || ('X' + nextBot);
  return { id: 'b' + (++nextBot), name: 'Bot ' + name, char: CHAR_KEYS[Math.floor(Math.random() * 3)], isBot: true, color: freeColor() };
}

function startMatchFromLobby() {
  sim = new Sim();
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
  spectateId = null; pred = null; history = []; snaps = []; latest = null;
  show('game');
}

// ---------------- buttons ----------------
$('quickBtn').onclick = () => {
  leaveNet();
  role = 'local'; myId = 'p1'; roomCode = '';
  lobby = [{ id: 'p1', name: getName(), char: myChar, isBot: false, color: 0 }];
  for (let i = 0; i < 5; i++) lobby.push(makeBot());
  startMatchFromLobby();
};
$('createBtn').onclick = () => hostRoom();
$('joinBtn').onclick = () => {
  const code = $('codeIn').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { menuMsg('Enter the 4-letter room code.'); return; }
  joinRoom(code);
};
$('addBotBtn').onclick = () => { if (lobby.length < MAX_PLAYERS) { lobby.push(makeBot()); broadcastLobby(); } };
$('remBotBtn').onclick = () => { const i = lobby.map((p) => p.isBot).lastIndexOf(true); if (i >= 0) { lobby.splice(i, 1); broadcastLobby(); } };
$('startBtn').onclick = () => { if (role !== 'host' || lobby.length < 2) return; startMatchFromLobby(); broadcast({ t: 'start' }); };
$('leaveBtn').onclick = () => toMenu();
$('toMenuBtn').onclick = () => toMenu();
$('againBtn').onclick = () => {
  if (!sim) return;
  sim.startMatch();
  renderer.clearPlayers(); feed.length = 0; renderFeed();
};
$('toLobbyBtn').onclick = () => {
  if (role !== 'host') return;
  sim = null; mode = 'lobby';
  broadcast({ t: 'toLobby' });
  broadcastLobby();
  show('lobby');
};

function toMenu(msg) {
  leaveNet();
  sim = null; role = null; myId = null; lobby = []; roomCode = ''; latest = null; snaps = [];
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
function leaveNet() {
  clearInterval(pingTimer); pingTimer = null;
  for (const c of conns.values()) { try { c.conn.close(); } catch { /* */ } }
  conns.clear();
  try { hostConn?.close(); } catch { /* */ }
  hostConn = null;
  try { peer?.destroy(); } catch { /* */ }
  peer = null;
}
function setBusy(b) { for (const id of ['quickBtn', 'createBtn', 'joinBtn']) $(id).disabled = b; }

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
  role = 'host'; myId = 'p1'; nextPid = 1; mode = 'lobby';
  lobby = [{ id: 'p1', name: getName(), char: myChar, isBot: false, color: 0 }];
  peer.on('connection', onConn);
  peer.on('disconnected', () => { if (peer && !peer.destroyed) peer.reconnect(); });
  peer.on('error', (e) => console.warn('peer error', e.type, e));
  show('lobby'); renderLobby();
}
function onConn(conn) {
  conn.on('data', (msg) => hostOnData(conn, msg));
  conn.on('close', () => dropConn(conn));
  conn.on('error', () => dropConn(conn));
}
function hostOnData(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  const c = conns.get(conn.peer);
  switch (msg.t) {
    case 'hello': {
      if (c) return;
      if (mode === 'game') { conn.send({ t: 'reject', reason: 'Match already in progress — try again after it ends.' }); setTimeout(() => conn.close(), 500); return; }
      if (lobby.length >= MAX_PLAYERS) { conn.send({ t: 'reject', reason: 'Room is full (8 players).' }); setTimeout(() => conn.close(), 500); return; }
      const id = 'p' + (++nextPid);
      lobby.push({ id, name: String(msg.name || 'Player').slice(0, 12), char: CHARS[msg.char] ? msg.char : 'blaster', isBot: false, color: freeColor() });
      conns.set(conn.peer, { conn, id });
      conn.send({ t: 'welcome', id, code: roomCode });
      broadcastLobby();
      break;
    }
    case 'char': {
      if (!c || !CHARS[msg.char]) return;
      const p = lobby.find((q) => q.id === c.id); if (p) p.char = msg.char;
      broadcastLobby();
      break;
    }
    case 'i': if (c && msg.i) inputs.set(c.id, msg.i); break;
    case 'ping': conn.send({ t: 'pong', ts: msg.ts }); break;
  }
}
function dropConn(conn) {
  const c = conns.get(conn.peer);
  if (!c) return;
  conns.delete(conn.peer);
  lobby = lobby.filter((p) => p.id !== c.id);
  inputs.delete(c.id);
  if (sim) sim.removePlayer(c.id);
  broadcastLobby();
}
function broadcast(msg) { for (const c of conns.values()) if (c.conn.open) { try { c.conn.send(msg); } catch { /* */ } } }
function broadcastLobby() {
  broadcast({ t: 'lobby', players: lobby, code: roomCode });
  if (mode === 'lobby') renderLobby();
}

async function joinRoom(code) {
  leaveNet(); setBusy(true); menuMsg('Connecting…');
  try {
    await loadPeer();
    peer = await openPeer(null);
  } catch (e) { setBusy(false); menuMsg('Could not reach PeerJS server: ' + (e.message || e.type || e)); return; }
  const failT = setTimeout(() => { if (role !== 'client') { leaveNet(); setBusy(false); menuMsg('Could not connect to room ' + code + '.'); } }, 12000);
  peer.on('error', (e) => {
    if (role === 'client') { console.warn('peer error', e.type); return; }
    clearTimeout(failT); leaveNet(); setBusy(false);
    menuMsg(e.type === 'peer-unavailable' ? `Room ${code} not found.` : 'Connection error: ' + (e.type || e.message));
  });
  const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
  hostConn = conn;
  conn.on('open', () => conn.send({ t: 'hello', name: getName(), char: myChar }));
  conn.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        clearTimeout(failT); setBusy(false); menuMsg('');
        role = 'client'; myId = msg.id; roomCode = msg.code; mode = 'lobby';
        show('lobby'); renderLobby();
        pingTimer = setInterval(() => { if (conn.open) conn.send({ t: 'ping', ts: performance.now() }); }, 1000);
        break;
      case 'reject': clearTimeout(failT); setBusy(false); toMenu(msg.reason); break;
      case 'lobby':
        lobby = msg.players;
        if (mode === 'lobby') renderLobby();
        break;
      case 'start': enterGame(); break;
      case 'toLobby': mode = 'lobby'; latest = null; snaps = []; renderer.clearPlayers(); show('lobby'); renderLobby(); break;
      case 's': if (role === 'client') { if (mode !== 'game') enterGame(); onSnapshot(msg.s); } break;
      case 'pong': ping = performance.now() - msg.ts; break;
    }
  });
  conn.on('close', () => { if (role === 'client') toMenu('Disconnected from host.'); });
}

show('menu');
