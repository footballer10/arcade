// Arena Royale — party hub plug-in. Top-down brawler: last one standing wins the round, first to N rounds wins.
// Netcode (unchanged from the original): host-authoritative 60 Hz sim with lag compensation; compact binary
// snapshots (net.js) on the unreliable channel at 20 Hz; binary inputs; client prediction + interpolation.
// ctx.net: raw host→all = snapshots, raw client→host = inputs; JSON {t:'fx'} {t:'emote'} {t:'chars'}.
import './tuning.js';
import { Sim, CHARS, CHAR_KEYS, ARENA_R, WINS_TO_WIN, MOVE, CUBE, MAPS, MAP_KEYS, MAP, setMap, integrate, applyDash, zoneNextIn, clampTo, TELEPORT_MAX, BOMB_RANGE, WELL_RANGE, MUTATORS, MUT_KEYS, MUT, BOO_CD, cdRate } from './sim.js';
import { botInput } from './bots.js';
import { Renderer, cssColor } from './render.js';
import { encodeSnapshot, decodeSnapshot, encodeInput, decodeInput } from './net.js';
import { sfx, unlockAudio, shutdownAudio } from './audio.js';
import { AdaptiveDelay } from '../../core/interp.js';
export { manifest } from './manifest.js';

const STEP = 1 / 60, INTERP_MS = 100, SNAP_MS = 50;
const EMOTES = ['😂', '😡', '👍', '💀'];
const CSS = `
.ar-labels{position:absolute;inset:0;pointer-events:none;z-index:2;font-family:var(--font);color:#fff}
.ar-labels .plabel{position:absolute;left:0;top:0;text-align:center;white-space:nowrap}
.ar-labels .pname{font-size:14px;text-shadow:var(--stroke);line-height:1.1}
.ar-labels .plabel.me .pname{color:var(--green)!important}
.ar-labels .hpbar{position:relative;width:74px;height:16px;margin:2px auto 0;background:#3b1b2a;border:2.5px solid var(--ink);border-radius:6px;overflow:hidden}
.ar-labels .hpfill{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(180deg,#ff8a95,var(--red) 60%);transition:width .12s}
.ar-labels .plabel.me .hpfill{background:linear-gradient(180deg,#a8ff8e,var(--green) 60%)}
.ar-labels .shfill{position:absolute;left:0;top:0;height:4px;background:#7fefff}
.ar-labels .hpnum{position:relative;display:block;font-size:11px;line-height:11px;text-shadow:var(--stroke)}
.ar-labels .buffs{font-size:12px;height:14px}
.ar-labels .pop{position:absolute;left:0;top:0;font-size:18px;text-shadow:var(--stroke);white-space:nowrap;color:#fff}
.ar-labels .pop.dealt{color:var(--yellow);font-size:24px}.ar-labels .pop.hurt{color:var(--red);font-size:24px}.ar-labels .pop.other{font-size:14px;opacity:.85}.ar-labels .pop.buff{color:#7cf7ff;font-size:22px}
.ar-labels .ammo{display:none;gap:3px;justify-content:center;margin-top:2px}.ar-labels .plabel.me .ammo{display:flex}
.ar-labels .plabel.ghost .hpbar,.ar-labels .plabel.ghost .ammo{display:none!important}
.ar-labels .ammo i{display:block;width:22px;height:8px;background:#3b2a1a;border:2px solid var(--ink);border-radius:4px;overflow:hidden}
.ar-labels .ammo i b{display:block;height:100%;width:0;background:#b98a3a}.ar-labels .ammo i.full b{background:#ffa31a}
.ar-labels .emote{position:absolute;left:50%;bottom:100%;transform:translate(-50%,0) scale(0);font-size:30px;background:#fff;border:3px solid var(--ink);border-radius:16px 16px 16px 4px;padding:0 8px;line-height:1.35;opacity:0}
.ar-labels .emote.show{animation:aremote 2.2s ease-out forwards}
@keyframes aremote{0%{transform:translate(-50%,0) scale(0);opacity:1}10%{transform:translate(-50%,-6px) scale(1.25);opacity:1}18%,85%{transform:translate(-50%,-6px) scale(1);opacity:1}100%{transform:translate(-50%,-16px) scale(.8);opacity:0}}
.ar-feed{position:absolute;top:150px;left:14px;font-size:.95rem;z-index:3;pointer-events:none;font-family:var(--font)}
.ar-feed div{display:table;background:var(--pill);border:2px solid var(--ink);padding:2px 10px;border-radius:10px;margin-bottom:4px;text-shadow:var(--stroke)}
.ar-spec{position:absolute;top:118px;width:100%;text-align:center;font-size:1.1rem;z-index:3;pointer-events:none;text-shadow:var(--stroke)}
.ar-spec span{background:var(--pill);border:3px solid var(--ink);padding:4px 14px;border-radius:12px}
.ar-board{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(620px,94vw);z-index:5}
.ar-board table{width:100%;border-collapse:separate;border-spacing:0 5px}
.ar-board td,.ar-board th{padding:5px 8px;text-shadow:var(--stroke)}.ar-board th{font-weight:400;font-size:.85rem}
.ar-board td{background:rgba(10,20,80,.35);border-top:3px solid var(--ink);border-bottom:3px solid var(--ink)}
.ar-board td:first-child{border-left:3px solid var(--ink);border-radius:12px 0 0 12px}.ar-board td:last-child{border-right:3px solid var(--ink);border-radius:0 12px 12px 0}
.ar-board tr.win td{background:linear-gradient(180deg,#ffe680,var(--yellow))}
.ar-board .charrow{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:10px}
.ar-board .charbtn{font-family:var(--font);font-size:.85rem;color:#fff;text-shadow:var(--stroke);background:rgba(10,20,80,.45);border:3px solid var(--ink);border-radius:12px;padding:6px 10px;cursor:pointer}
.ar-board .charbtn:hover{background:rgba(10,20,80,.7)}
.ar-board .charbtn.sel{background:var(--yellow);color:var(--ink);text-shadow:none}
.pip{display:inline-block;width:14px;height:14px;border-radius:50%;border:3px solid var(--ink);background:#2a3a8a;margin:0 2px;vertical-align:-2px}.pip.on{background:var(--yellow)}
.ar-hp{width:300px;background:var(--pill);border:3px solid var(--ink);border-radius:16px;padding:6px 12px 8px;text-shadow:var(--stroke)}
.ar-hp .bighp{position:relative;height:20px;background:#3b1b2a;border:3px solid var(--ink);border-radius:9px;overflow:hidden;margin-top:4px}
.ar-hp .hp{position:absolute;left:0;top:0;bottom:0;transition:width .1s}.ar-hp .sh{position:absolute;left:0;top:0;height:6px;background:#7fefff}
.ar-hp .bf{font-size:.9rem;min-height:1em;margin-top:3px}
.ar-debug{position:absolute;bottom:150px;left:18px;z-index:20;background:rgba(0,0,0,.75);color:#7CFC00;font:12px/1.45 ui-monospace,monospace;padding:8px 12px;border-radius:8px;white-space:pre;pointer-events:none}`;

export async function start(ctx) {
  const { net, ui, input } = ctx;
  const esc = ui.esc;
  const style = document.createElement('style'); style.textContent = CSS; ctx.container.appendChild(style);
  const labels = ui.el('div', 'ar-labels'); ctx.container.appendChild(labels);
  const feedEl = ui.el('div', 'ar-feed'); ctx.container.appendChild(feedEl);
  const specEl = ui.el('div', 'ar-spec hidden'); ctx.container.appendChild(specEl);
  const boardEl = ui.el('div', 'ph-panel ar-board hidden'); ctx.container.appendChild(boardEl);
  const debugEl = ui.el('div', 'ar-debug hidden'); ctx.container.appendChild(debugEl);
  const hpEl = ui.el('div', 'ar-hp', '<div class="nm"></div><div class="bighp"><div class="hp"></div><div class="sh"></div></div><div class="bf"></div>');
  ui.zone('bc').appendChild(hpEl);

  const gl = ctx.three.createRenderer({ antialias: true });
  const renderer = new Renderer(gl, labels);
  const applyQ = () => { const q = ctx.quality(); gl.shadowMap.enabled = q.shadows; gl.setPixelRatio(Math.min(devicePixelRatio || 1, q.pixelRatio)); renderer.resize(); };
  applyQ();
  ctx.on('settings', (k) => { if (k === 'quality') applyQ(); });
  ctx.on('resize', () => renderer.resize());

  // ---------------------------------------------------------------- roster (party players → arena roster numbers)
  const level = ctx.bots.level.key;
  const opts = { map: ctx.options.map, mut: MUTATORS[ctx.options.mut] ? ctx.options.mut : 'none', wins: Math.max(2, Math.min(3, +ctx.options.wins || WINS_TO_WIN)) };
  const lobby = ctx.players.map((p, n) => ({ id: p.id, n, name: p.name, char: CHARS[ctx.picks[p.id]?.char] ? ctx.picks[p.id].char : 'blaster', isBot: p.isBot, color: p.color, hat: p.hat }));
  const rosterByN = new Map(lobby.map((p) => [p.n, p]));
  const pickMap = (r) => (MAPS[opts.map] ? opts.map : MAP_KEYS[Math.floor(r() * MAP_KEYS.length)]);
  const mapRng = ctx.rng(0xA7);
  setMap(pickMap(mapRng));
  const myId = ctx.myId;

  // ---------------------------------------------------------------- state
  let sim = null;
  const inputs = new Map(), lastSeqs = new Map();
  let snaps = [], latest = null, lastSnapTick = -1, lastSnapAt = 0, snapBytes = 0;
  // Snapshots are placed on the HOST's timeline (tick × 1/60 s), not by when they arrived: over the relay they arrive
  // bunched together, and arrival times would make others stutter. hostOff maps our clock to the host's (fastest
  // arrivals); interpDelay grows on a jittery link.
  let hostOff = null; const interpDelay = new AdaptiveDelay({ min: INTERP_MS / 1000, start: INTERP_MS / 1000, interval: SNAP_MS / 1000 });
  let pred = null, history = [], visOff = { x: 0, z: 0 }, lastSentDash = 0, viewTick = 0;
  let spectateId = null, lastAim = 0, lastView = null, lastBeep = 0, ended = false, netFx = [], lastSend = 0, acc = 0, lastTick = performance.now();
  const isHost = () => net.isHost;
  function makeSim(fromSnap) {
    const s = fromSnap ? Sim.fromSnapshot(fromSnap, lobby, MAP.key, level, opts.mut) : new Sim(MAP.key);
    s.botLevel = level; s.mutSetting = opts.mut; s.winsToWin = opts.wins;
    if (!fromSnap) for (const p of lobby) s.addPlayer(p);
    return s;
  }
  if (isHost()) sim = makeSim(null);
  const bgm = ctx.music('arena');   // in-game music (core/music.js), stops by itself when the round ends
  ctx.on('go', () => bgm.start());
  ctx.on('go', () => {
    if (!isHost() || !sim || sim.phase !== 'lobby') return;
    sim.startMatch();
    sim.phaseT = 0.9;   // the hub already counted down: just a short "1 … FIGHT!"
    acc = 0; lastTick = performance.now();
  });

  // ---------------------------------------------------------------- input (standard control map)
  let dashSeq = 0, spSeq = 0, seq = 0, lastEmote = 0;
  input.on('press', (a) => {
    unlockAudio();
    if (a === 'jump' || a === 'boost') dashSeq++;
    else if (a === 'secondary' || a === 'special') spSeq++;
    else if (a === 'primary' && amSpectating()) cycleSpectate();
  });
  input.on('key', (code, down) => {
    if (!down) return;
    if (/^Digit[1-4]$/.test(code)) sendEmote(+code.slice(5) - 1);
    if (code === 'Backquote') debugEl.classList.toggle('hidden');
  });
  input.on('wheel', (e) => { renderer.camDist = Math.max(0.65, Math.min(1.5, renderer.camDist + e.deltaY * 0.0008)); });
  function sendEmote(i) {
    const now = performance.now(); if (now - lastEmote < 600 || ctx.spectator) return; lastEmote = now;
    net.toHost({ t: 'emote', e: i });
  }
  function readInput(pos) {
    const ax = input.axis();
    const m = input.mouse;
    const g = renderer.mouseToGround(m.nx, m.ny);
    if (g && pos) lastAim = Math.atan2(g.z - pos.z, g.x - pos.x);
    return { mx: ax.x, mz: ax.y, aim: lastAim, tx: g ? g.x : undefined, tz: g ? g.z : undefined, atk: input.down('primary'), dashSeq, spSeq, seq: ++seq };
  }

  // ---------------------------------------------------------------- host simulation (60 Hz, keeps running in background tabs)
  ctx.tick(() => {
    if (!isHost() || !sim) return;
    const now = performance.now();
    acc += Math.min(0.25, (now - lastTick) / 1000); lastTick = now;
    let n = 0;
    while (acc >= STEP && n < 15) {
      const me = sim.players.get(myId);
      if (me) inputs.set(myId, readInput(me));
      for (const p of sim.players.values()) if (p.isBot) inputs.set(p.id, botInput(sim, p, STEP));
      sim.step(STEP, inputs);
      acc -= STEP; n++;
    }
    if (n >= 15) acc = 0;
    if (sim.rosterDirty) {   // Shuffle mutator changed everyone's character
      sim.rosterDirty = false;
      const chars = {};
      for (const p of lobby) { const sp = sim.players.get(p.id); if (sp) { p.char = sp.char; chars[p.id] = sp.char; } }
      net.toAll({ t: 'chars', c: chars }, false);
    }
    const fx = sim.drainFx();
    for (const e of fx) handleFx(e);
    netFx.push(...fx);
    if (now - lastSend >= SNAP_MS) {
      lastSend = now;
      const buf = encodeSnapshot(sim.snapshot());
      snapBytes = buf.byteLength;
      net.rawToAll(buf);
      if (netFx.length) { net.toAll({ t: 'fx', fx: netFx }, false); netFx = []; }
    }
    if (sim.phase === 'matchEnd' && !ended) { ended = true; ctx.setTimeout(finish, 3500); }
  });
  function standings() {
    const ps = sim ? [...sim.players.values()] : latest?.s.players || [];
    const sorted = [...ps].sort((a, b) => b.wins - a.wins || b.kills - a.kills);
    const groups = [];
    for (const p of sorted) { const g = groups[groups.length - 1]; if (g && g.w === p.wins && g.k === p.kills) g.ids.push(p.id); else groups.push({ w: p.wins, k: p.kills, ids: [p.id] }); }
    return groups.map((g) => g.ids);
  }
  function finish() {
    const ps = [...sim.players.values()];
    const top = (key) => [...ps].sort((a, b) => b[key] - a[key])[0];
    const k = top('kills'), d = top('dmg'), f = top('falls'), c = top('cubesTotal'), aw = [];
    if (k && k.kills) aw.push(`💥 Most KOs: ${k.name} (${k.kills})`);
    if (d && d.dmg) aw.push(`🥊 Heavy hitter: ${d.name} (${d.dmg * 10})`);
    if (f && f.falls) aw.push(`🤿 Splash champ: ${f.name} (${f.falls} dunks)`);
    if (c && c.cubesTotal) aw.push(`📦 Power player: ${c.name} (${c.cubesTotal} cubes)`);
    ctx.endGame(standings(), { stats: Object.fromEntries(ps.map((p) => [p.id, `${p.wins} round${p.wins === 1 ? '' : 's'} · ${p.kills} KO`])), note: aw.join('   ') });
  }

  // ---------------------------------------------------------------- networking
  net.onRaw((ab, from) => {
    if (isHost()) {   // client inputs
      if (from === myId) return;
      const inp = decodeInput(ab);
      if (!inp || inp.seq <= (lastSeqs.get(from) || 0)) return;   // unordered channel: ignore stale packets
      lastSeqs.set(from, inp.seq); inputs.set(from, inp);
    } else {          // host snapshots
      const s = decodeSnapshot(ab, rosterByN);
      if (!s || s.tick <= lastSnapTick) return;
      lastSnapTick = s.tick; snapBytes = ab.byteLength;
      onSnapshot(s);
    }
  });
  net.onMessage((m, from) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'emote' && isHost() && sim) sim.fx.push({ k: 'emote', id: from, e: Math.max(0, Math.min(3, m.e | 0)) });
    else if (m.t === 'fx' && !isHost()) for (const e of m.fx) handleFx(e);
    else if (m.t === 'chars' && !isHost()) for (const [id, c] of Object.entries(m.c)) { const p = lobby.find((q) => q.id === id); if (p && CHARS[c]) p.char = c; }
    else if (m.t === 'pickChar' && isHost() && sim) {
      const sp = sim.players.get(from);
      if (sp && CHARS[m.c] && sim.phase === 'roundEnd') {
        sp.char = m.c;
        const lp = lobby.find((q) => q.id === from); if (lp) lp.char = m.c;
        net.toAll({ t: 'chars', c: { [from]: m.c } }, false);
      }
    }
  });
  ctx.on('leave', (id) => { if (isHost() && sim) { sim.removePlayer(id); inputs.delete(id); } feedNote(`${ctx.player(id)?.name || 'Someone'} left`); });
  ctx.on('hostchange', ({ amHost, oldHost }) => {
    if (!amHost) { pred = null; history = []; return; }
    if (sim) return;
    // Host migration: rebuild the running match from the last snapshot we received.
    sim = latest ? makeSim(latest.s) : makeSim(null);
    if (oldHost) sim.removePlayer(oldHost);
    inputs.clear(); acc = 0; lastTick = performance.now(); pred = null; history = [];
    if (!latest && ctx.started) { sim.startMatch(); }
    ui.banner('You are now the host', 2000);
  });

  // ---------------------------------------------------------------- client prediction & interpolation
  function replayStep(p, h) {
    p.dashCd -= h.dt * cdRate();
    p.slamT = Math.max(0, p.slamT - h.dt);
    p.blastT = Math.max(0, p.blastT - h.dt);
    if (h.dash && p.dashCd <= 0) { p.aim = h.aim; applyDash(p, h); }
    integrate(p, h, h.dt, p.spMul);
  }
  function onSnapshot(s) {
    const now = performance.now();
    lastSnapAt = now;
    const ht = s.tick * STEP * 1000, off = ht - now;
    if (snaps.length && ht < snaps[snaps.length - 1].time - 1000) { snaps = []; hostOff = null; }   // host tick restarted
    hostOff = hostOff == null || off > hostOff ? off : hostOff + (off - hostOff) * 0.04;
    interpDelay.observe((now + hostOff - ht) / 1000);
    snaps.push({ time: ht, s });
    if (snaps.length > 40) snaps.shift();
    latest = snaps[snaps.length - 1];
    MUT.key = MUT_KEYS[s.mut] || 'none';
    const me = s.players.find((p) => p.id === myId);
    const canPredict = me && !me.falling && (me.alive ? s.phase === 'play' : me.ghost && (s.phase === 'play' || s.phase === 'roundEnd'));
    if (!canPredict) { pred = null; history = []; visOff = { x: 0, z: 0 }; return; }
    const base = { x: me.x, z: me.z, mvx: me.mvx, mvz: me.mvz, kbx: me.kbx, kbz: me.kbz, dvx: me.dvx, dvz: me.dvz, char: me.char, aim: me.aim, dashCd: me.dashCd, slamT: me.slamT, blastT: me.blastT, chargeT: me.chargeT, slowT: me.slowT, ghost: !me.alive && me.ghost, bumpT: 0.2, spMul: me.speedT > 0 ? 1.5 : 1 };
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
    if (!latest || ctx.spectator) return;
    const me = latest.s.players.find((p) => p.id === myId);
    const inp = readInput(pred || me);
    inp.vt = Math.round(viewTick);
    inp.dash = inp.dashSeq !== lastSentDash; lastSentDash = inp.dashSeq;
    net.rawToHost(encodeInput(inp));
    if (pred) { const h = { ...inp, dt }; history.push(h); replayStep(pred, h); }
    const k = Math.exp(-dt * 12); visOff.x *= k; visOff.z *= k;
  }
  const lerp = (a, b, f) => a + (b - a) * f;
  function lerpAng(a, b, f) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * f; }
  function clientView(now) {
    if (!latest) return null;
    const rt = now + (hostOff ?? 0) - interpDelay.value * 1000;
    let a = null, b = null;
    for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].time <= rt) { a = snaps[i]; b = snaps[i + 1] || null; break; }
    if (!a) a = snaps[0];
    const f = b ? Math.min(1, (rt - a.time) / Math.max(1, b.time - a.time)) : 0;
    viewTick = b ? lerp(a.s.tick, b.s.tick, f) : a.s.tick;
    const players = latest.s.players.map((lp) => {
      const o = { ...lp, char: lobby.find((q) => q.id === lp.id)?.char || lp.char, hat: lobby.find((q) => q.id === lp.id)?.hat };
      const pa = a.s.players.find((q) => q.id === lp.id), pb = b && b.s.players.find((q) => q.id === lp.id);
      if (pa && pb && pa.alive === pb.alive) { o.x = lerp(pa.x, pb.x, f); o.z = lerp(pa.z, pb.z, f); o.y = lerp(pa.y, pb.y, f); o.aim = lerpAng(pa.aim, pb.aim, f); }
      else if (pa && pa.alive === lp.alive) { o.x = pa.x; o.z = pa.z; o.y = pa.y; o.aim = pa.aim; }
      if (lp.id === myId) {
        if (pred) { o.x = pred.x + visOff.x; o.z = pred.z + visOff.z; o.y = 0; }
        if (lp.alive || lp.ghost) o.aim = lastAim;
      }
      return o;
    });
    const age = (rt - latest.time) / 1000;
    const proj = latest.s.proj.map((p) => (p.kind === 1
      ? { ...p, f: Math.min(1, Math.max(0, p.f + age / Math.max(0.05, p.T))), x: lerp(p.x, p.tx, Math.min(1, Math.max(0, age / Math.max(0.05, p.T * (1 - p.f))))), z: lerp(p.z, p.tz, Math.min(1, Math.max(0, age / Math.max(0.05, p.T * (1 - p.f))))) }
      : { ...p, x: p.x + p.vx * age, z: p.z + p.vz * age }));
    const zoneR = b ? lerp(a.s.zoneR, b.s.zoneR, f) : latest.s.zoneR;
    const t = b ? lerp(a.s.t, b.s.t, f) : a.s.t;
    return { ...latest.s, players, proj, zoneR, t };
  }

  // ---------------------------------------------------------------- render loop
  let bannerT = 0, bannerText = '', frames = 0, fpsT = 0, fps = 0;
  const idleView = { players: [], proj: [], pu: [], wells: [], zoneR: ARENA_R, t: 0 };
  ctx.frame((dt, now) => {
    frames++; fpsT += dt; if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; updateDebug(); }
    if (!isHost()) clientFrame(dt);
    let view = isHost() ? (sim ? sim.snapshot() : null) : clientView(now);
    if (view && isHost()) for (const p of view.players) p.hat = lobby.find((q) => q.id === p.id)?.hat;
    if (!view || view.phase === 'lobby') { idleView.t = now / 1000; renderer.render(view && view.phase === 'lobby' ? { ...idleView, players: [] } : idleView, null, dt, { x: Math.sin(now / 4000) * 3, z: Math.cos(now / 4000) * 3 }); updateHud(null, null, dt); return; }
    lastView = view;
    const me = view.players.find((p) => p.id === myId);
    let focus = me && (me.alive || me.ghost) ? me : null;
    if (!focus) {
      let t = view.players.find((p) => p.id === spectateId && p.alive);
      if (!t) { t = view.players.find((p) => p.alive); spectateId = t ? t.id : null; }
      focus = t || { x: 0, z: 0 };
    }
    let aimPt = null, tp = null;
    if (me && me.alive && !me.falling) {
      const g = renderer.mouseToGround(input.mouse.nx, input.mouse.ny);
      if (g) {
        if (me.char === 'bomber') { const c = clampTo(me.x, me.z, g.x, g.z, BOMB_RANGE, 2); aimPt = { x: c.x, z: c.z }; } else aimPt = g;
        if (me.char === 'trickster' && me.spCd <= 0) { const c = clampTo(me.x, me.z, g.x, g.z, TELEPORT_MAX); tp = { x: c.x, z: c.z }; }
        if (me.char === 'bomber' && me.spCd <= 0) { const c = clampTo(me.x, me.z, g.x, g.z, WELL_RANGE); tp = { x: c.x, z: c.z, r: 5.5 }; }
      }
    }
    renderer.render(view, myId, dt, focus, aimPt, tp);
    updateHud(view, me, dt);
  });

  // ---------------------------------------------------------------- HUD (shared zones)
  const viewPlayers = () => (sim ? [...sim.players.values()] : latest?.s.players || []);
  const playerById = (id) => (sim ? sim.players.get(id) : (lastView?.players.find((q) => q.id === id) || latest?.s.players.find((q) => q.id === id)));
  const nameOf = (id) => (playerById(id) || lobby.find((q) => q.id === id))?.name || '?';
  function amSpectating() { const me = viewPlayers().find((p) => p.id === myId); return !me || (!me.alive && !me.ghost); }
  function cycleSpectate() { const ps = viewPlayers().filter((p) => p.alive); if (!ps.length) return; const i = ps.findIndex((p) => p.id === spectateId); spectateId = ps[(i + 1) % ps.length].id; }
  function updateHud(v, me, dt) {
    if (!v) { ui.status(`⚔️ ${esc(MAPS[MAP.key].name)}<br><small>Get ready…</small>`); ui.timer(null); return; }
    const alive = v.players.filter((p) => p.alive).length;
    const mk = MUT_KEYS[v.mut] || 'none';
    ui.status(`⚔️ ${esc(MAPS[MAP.key].name)} · Round ${v.round}<br><small>First to ${opts.wins}${mk !== 'none' ? ' · ' + esc(MUTATORS[mk].name) : ''} · Alive ${alive}/${v.players.length}</small>`);
    const zn = zoneNextIn(v.t);
    ui.timer(v.phase === 'play' && zn > 0 ? zn : null, { warn: 5, text: v.phase === 'play' && zn <= 0 ? 'SUDDEN DEATH' : v.phase !== 'play' ? '—' : null });
    ui.mini([...v.players].sort((a, b) => b.wins - a.wins || b.kills - a.kills).map((p) => ({ id: p.id, name: p.name, color: p.color, value: '★'.repeat(p.wins) + ` ${p.kills}`, me: p.id === myId, out: !p.alive })), 'Rounds ★ · KOs');
    bannerT -= dt;
    let banner = '';
    if (v.phase === 'countdown') {
      const n = Math.max(1, Math.ceil(v.phaseT));
      banner = v.phaseT > 2 ? (mk !== 'none' ? MUTATORS[mk].name.toUpperCase() + '!' : `ROUND ${v.round}`) : String(n);
      if (n !== lastBeep) { lastBeep = n; sfx('beep'); }
    } else lastBeep = 0;
    if (v.phase !== 'countdown' && bannerT > 0) banner = bannerText;
    if (banner !== hudBanner) { hudBanner = banner; ui.banner(banner, 0, { small: banner.length > 12 }); }
    if (me) {
      const f = me.alive ? Math.max(0, me.hp / me.maxHp) : 0;
      const hp = hpEl.querySelector('.hp');
      hp.style.width = (f * 100).toFixed(1) + '%'; hp.style.background = f > 0.5 ? '#4cd964' : f > 0.25 ? '#ffcc00' : '#ff3b30';
      hpEl.querySelector('.sh').style.width = Math.min(100, me.shield / 40 * 100) + '%';
      const nm = `<span style="color:${cssColor(me.color)}">${esc(me.name)}</span> · ${me.alive ? CHARS[me.char].name + ' · ' + Math.ceil(me.hp * 10) + ' HP' : me.ghost ? '👻 Ghost' : 'Out'}`;
      if (hpEl.firstChild.innerHTML !== nm) hpEl.firstChild.innerHTML = nm;
      const buffs = [];
      if (me.speedT > 0) buffs.push(`⚡ ${Math.ceil(me.speedT)}s`); if (me.dmgT > 0) buffs.push(`🔥 ${Math.ceil(me.dmgT)}s`); if (me.shield > 0) buffs.push(`🛡 ${Math.ceil(me.shield * 10)}`);
      const cubes = Math.max(0, Math.round((me.maxHp / CHARS[me.char].hp - 1) / CUBE.HP_PCT));
      if (cubes > 0) buffs.push(`📦 x${cubes}`);
      hpEl.lastChild.textContent = buffs.join('  ');
      const gh = !me.alive && me.ghost;
      const dashF = Math.max(0, me.dashCd / MOVE.DASH_CD), spF = gh ? 1 : Math.max(0, me.spCd / CHARS[me.char].spCd);
      ui.abilities([
        { key: 'Shift', label: 'Dash', cd: dashF, ready: dashF <= 0 },
        { key: 'LMB', label: gh ? 'Boo!' : CHARS[me.char].attack, cd: gh ? Math.max(0, me.spCd / BOO_CD) : 1 - Math.min(1, me.ammo), ready: me.ammo >= 1 },
        { key: 'RMB / Q', label: gh ? '—' : CHARS[me.char].special, cd: spF, ready: spF <= 0 },
      ]);
      hpEl.style.opacity = me.alive || me.ghost ? 1 : 0.4;
    } else hpEl.style.display = 'none';
    const spect = (!me || !me.alive) && v.phase === 'play';
    specEl.classList.toggle('hidden', !spect);
    if (spect) specEl.innerHTML = me && me.ghost ? `<span>👻 You're a ghost! Fly next to someone and <b>left click to BOO</b> them off the edge</span>` : `<span>${me ? 'You were eliminated' : 'Spectating'} — watching <b>${esc(nameOf(spectateId))}</b> (click to switch)</span>`;
    const showBoard = (v.phase === 'roundEnd' && v.phaseT < 4.3) || v.phase === 'matchEnd';
    boardEl.classList.toggle('hidden', !showBoard);
    if (v.phase === 'roundEnd' && v.phaseT >= 4.3) { bannerText = v.roundWinner ? `${nameOf(v.roundWinner)} wins the round!` : 'Draw!'; bannerT = 0.1; }
    if (showBoard) renderBoard(v);
  }
  function pickChar(key) {
    if (ctx.spectator || !CHARS[key]) return;
    const mine = lobby.find((p) => p.id === myId);
    if (!mine || mine.char === key) return;
    mine.char = key;   // optimistic; the host confirms (or the Shuffle mutator may override next round)
    net.toHost({ t: 'pickChar', c: key });
    for (const b of boardEl.querySelectorAll('.charbtn')) b.classList.toggle('sel', b.dataset.c === key);
  }
  ctx.listen(boardEl, 'click', (e) => { const b = e.target.closest('.charbtn'); if (b) pickChar(b.dataset.c); });
  function charRow(v) {
    if (v.phase !== 'roundEnd' || ctx.spectator || opts.mut === 'shuffle') return '';
    const mine = lobby.find((p) => p.id === myId);
    if (!mine) return '';
    const btns = CHAR_KEYS.map((k) => `<button type="button" class="charbtn${k === mine.char ? ' sel' : ''}" data-c="${k}">${esc(CHARS[k].name)}</button>`).join('');
    return `<div class="ph-sub" style="margin:10px 0 2px">Pick your character for next round</div><div class="charrow">${btns}</div>`;
  }
  let hudBanner = '';
  function boardRows(v, isMatch) {
    return [...v.players].sort((a, b) => b.wins - a.wins || b.kills - a.kills).map((p) => {
      let pips = ''; for (let i = 0; i < opts.wins; i++) pips += `<span class="pip ${i < p.wins ? 'on' : ''}"></span>`;
      const win = isMatch ? p.id === v.matchWinner : p.id === v.roundWinner;
      return `<tr class="${win ? 'win' : ''}"><td><span class="ph-dot" style="background:${cssColor(p.color)}"></span></td><td>${esc(p.name)}${p.id === myId ? ' (you)' : ''}${p.isBot ? ' 🤖' : ''}</td><td>${CHARS[lobby.find((q) => q.id === p.id)?.char || p.char]?.name || ''}</td><td>${pips}</td><td>${p.kills}</td></tr>`;
    }).join('');
  }
  // The board's standings/char-picker are rebuilt only when what they show actually changes (new round, new
  // winner): rebuilding every frame would tear out and replace the .charbtn elements mid-click, which silently
  // swallows real mouse clicks (mousedown lands on one node, mouseup on its freshly-rebuilt replacement, so no
  // 'click' ever fires). Only the "Next round in Xs" countdown is cheap-and-safe to update every frame.
  let boardKey = null, boardSub = null;
  function renderBoard(v) {
    const isMatch = v.phase === 'matchEnd';
    const key = `${v.phase}:${v.round}:${v.roundWinner}:${v.matchWinner}`;
    if (key !== boardKey) {
      boardKey = key;
      const title = isMatch ? `🏆 ${nameOf(v.matchWinner)} WINS THE MATCH!` : v.roundWinner ? `${nameOf(v.roundWinner)} wins round ${v.round}` : `Round ${v.round}: draw`;
      boardEl.innerHTML = `<h2 style="color:var(--yellow)">${esc(title)}</h2><table><tr><th></th><th>Player</th><th>Class</th><th>Rounds</th><th>KOs</th></tr>${boardRows(v, isMatch)}</table>${isMatch ? '' : charRow(v)}<div class="ph-sub"></div>`;
      boardSub = boardEl.querySelector(':scope > .ph-sub');
    }
    if (boardSub) boardSub.textContent = isMatch ? 'Final results coming up…' : `Next round in ${Math.max(0, Math.ceil(v.phaseT))}s`;
  }
  ui.setScoreboard(() => { const v = lastView || latest?.s; return v ? `<table class="ph-table"><tr><th></th><th>Player</th><th>Class</th><th>Rounds</th><th>KOs</th></tr>${boardRows(v, false)}</table>` : ''; });

  // ---------------------------------------------------------------- effects: sound, shake, hit-stop, damage numbers, kill feed
  const feed = [];
  const streak = new Map();
  function fxPos(e) {
    if (e.x !== undefined) return e;
    if (e.x1 !== undefined) return { x: e.x1, z: e.z1 };
    return (e.id && (lastView?.players.find((q) => q.id === e.id) || playerById(e.id))) || null;
  }
  function nearVol(e) { const p = fxPos(e); if (!p) return 0.6; const c = renderer.camTarget; return Math.max(0, Math.min(1, 1.15 - Math.hypot(p.x - c.x, p.z - c.z) / 26)); }
  function handleFx(e) {
    renderer.addFx(e);
    const mine = e.id === myId;
    const vol = mine ? 1 : nearVol(e);
    switch (e.k) {
      case 'shot': sfx(e.c === 'ranger' ? 'arrow' : e.c === 'frost' ? 'ice' : 'shot', mine ? 1 : vol * 0.5); break;
      case 'emote': renderer.emote(e.id, EMOTES[e.e] || '😂'); sfx('emote', 0.6); break;
      case 'boo': sfx('boo', vol); renderer.popText(e.x, e.z, 'BOO!', 'buff'); break;
      case 'hookshot': sfx('lob', vol); break;
      case 'hooked': sfx('hook', vol); if (mine) renderer.shake(0.2); break;
      case 'bonk': sfx('bonk', vol); if (mine) { renderer.shake(0.5); renderer.hitstop(60); } renderer.popText(e.x, e.z, 'BONK!', 'other'); break;
      case 'blizzard': sfx('ice', vol); break;
      case 'stampede': sfx('stampede', vol); break;
      case 'volley': sfx('arrow', vol); break;
      case 'swing': sfx('swing', vol); break;
      case 'lob': sfx('lob', vol); break;
      case 'hit': {
        const amt = Math.max(1, Math.round(e.d * 10));
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
      case 'portal': sfx('tp', mine ? 0.9 : vol * 0.5); break;
      case 'dash': sfx('dash', mine ? 0.8 : vol * 0.4); break;
      case 'bump': sfx('bump', vol); if (mine) renderer.shake(0.25); break;
      case 'sweep': sfx('sweep', vol); if (mine) { renderer.shake(0.5); renderer.hitstop(60); } break;
      case 'pickup': sfx('pickup', mine ? 1 : vol * 0.4); if (mine) renderer.popText(e.x, e.z, { speed: 'SPEED!', shield: 'SHIELD!', dmg: 'DAMAGE!', heal: '+HEAL', giant: 'GIANT!', cube: 'POWER CUBE!' }[e.type], 'buff'); break;
      case 'falling': sfx('fall', vol); break;
      case 'fight': sfx('fight'); bannerText = 'FIGHT!'; bannerT = 0.8; break;
      case 'zone': sfx('zone'); bannerText = 'The zone is closing!'; bannerT = 1.5; break;
      case 'roundEnd': { if (e.winner === myId) sfx('win'); const w = e.winner && playerById(e.winner); if (w) renderer.addFx({ k: 'confetti', x: w.x, z: w.z }); streak.clear(); break; }
      case 'elim': {
        sfx(e.how === 'fall' ? 'splash' : 'elim', Math.max(vol, 0.4));
        if (e.how === 'fall') renderer.popText(e.x, e.z, 'SPLASH!', 'buff');
        if (e.by) {
          const t = performance.now(), k = streak.get(e.by) || { n: 0, t: 0 };
          k.n = t - k.t < 4500 ? k.n + 1 : 1; k.t = t; streak.set(e.by, k);
          if (k.n >= 2) { bannerText = `${nameOf(e.by)}: ${k.n === 2 ? 'DOUBLE' : k.n === 3 ? 'TRIPLE' : 'MEGA'} KO!`; bannerT = 1.6; sfx('win', 0.7); }
        }
        const v = nameOf(e.id);
        feedNote(e.by ? `${nameOf(e.by)} ✖ ${v}${e.how === 'fall' ? ' (ring out)' : ''}` : `${v} ${e.how === 'fall' ? 'fell off' : e.how === 'zone' ? 'was eaten by the zone' : 'was KO\'d'}`);
        if (mine) { bannerText = 'ELIMINATED'; bannerT = 1.5; renderer.shake(0.9); renderer.hitstop(120); }
        if (e.by === myId) renderer.hitstop(90);
        break;
      }
    }
  }
  function feedNote(txt) { feed.push({ txt, t: performance.now() }); renderFeed(); }
  function renderFeed() {
    const now = performance.now();
    while (feed.length && (feed.length > 5 || now - feed[0].t > 6000)) feed.shift();
    feedEl.innerHTML = feed.map((f) => `<div>${esc(f.txt)}</div>`).join('');
  }
  ctx.setInterval(renderFeed, 1000);
  function updateDebug() {
    if (debugEl.classList.contains('hidden')) return;
    debugEl.textContent = [`FPS      ${fps}`, `Ping     ${isHost() ? 'host' : Math.round(net.ping()) + ' ms'}`, `Snapshot ${snapBytes} B`, `Map      ${MAP.key}`, `Pred err ${Math.hypot(visOff.x, visOff.z).toFixed(2)}`].join('\n');
  }

  window.__arena = { get sim() { return sim; }, get latest() { return latest; }, readInput };
  return {
    standings,
    stop() {
      renderer.clearPlayers();
      ctx.three.dispose(renderer.scene);
      shutdownAudio();
      delete window.__arena;
    },
  };
}
