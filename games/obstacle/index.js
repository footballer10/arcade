// ULTIMATE OBSTACLE COURSE — a bouncy elimination show for up to 8 beans. A match is 3–4 rounds drawn from a
// pool of race / survival stages; qualifying spots shrink every round until a final crowns one winner.
// Signature mechanic: physical, bouncy movement (run, jump, dive, belly-slide, ledge hang, grab) against
// spinning sweepers, hammers, punchers, moving platforms, fake doors and dropping tiles.
//
// Net model (like the hub's other action games): the host runs HostSim (host.js) at 60 Hz with every bot and
// sends 20 Hz binary snapshots on the unreliable channel. Obstacles are pure functions of the stage clock, so
// clients predict them exactly; clients predict their own bean and send input + predicted state at 30 Hz.
// The host adopts a client's state when it is close to its own and otherwise forces a correction (auth
// counter). Bumps, grabs, tiles, qualifying and eliminations are decided by the host.
export { manifest } from './manifest.js';
import './tuning.js';
import { C, EV, setPoses, stepPlayer, separate, knock, newPlayer, syncCounters, encodeSnap, decodeSnap, groundAt, isDown } from './world.js';
import { STAGES, planMatch, buildStage, makeWorld, spawnOf, respawnOf, quota, progressOf } from './stages.js';
import { HostSim, standingsOf, INTRO_T } from './host.js';
import { makeBot, botThink, resetBot } from './bots.js';
import { createView } from './render.js';
import { createSound } from './audio.js';

const SNAP_HZ = 20, SEND_HZ = 30, STEP = 1 / 60;
const CSS = `
.oc-tags{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2}
.oc-tag{position:absolute;left:0;top:0;font:.9rem var(--font);color:#fff;white-space:nowrap;text-shadow:var(--stroke);padding:0 8px;border-radius:10px;
  background:color-mix(in srgb,var(--c) 60%,transparent);border:2px solid var(--ink)}
.oc-card,.oc-show,.oc-hint{z-index:3;pointer-events:none}
.oc-card{position:absolute;left:50%;top:17%;transform:translate(-50%,-30px) scale(.8);opacity:0;transition:transform .35s cubic-bezier(.2,1.6,.4,1),opacity .25s;
  background:linear-gradient(180deg,#ff8fd0,#ff4fa8);border:4px solid var(--ink);border-radius:22px;padding:10px 26px 12px;text-align:center;color:#fff;box-shadow:0 7px 0 var(--ink);max-width:min(560px,86vw)}
.oc-card.on{opacity:1;transform:translate(-50%,0) scale(1)}
.oc-card .ic{font-size:2.4rem;line-height:1}
.oc-card .nm{font-size:2.1rem;text-shadow:var(--stroke),0 4px 0 var(--ink)}
.oc-card .ds{font-size:1rem;text-shadow:var(--stroke);opacity:.95}
.oc-card .qt{display:inline-block;margin-top:6px;background:var(--ink);color:var(--yellow);border-radius:10px;padding:2px 12px;font-size:1rem}
.oc-show{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;opacity:0;transition:opacity .3s;
  background:radial-gradient(circle at 50% 40%,rgba(255,120,200,.55),rgba(60,30,140,.85))}
.oc-show.on{opacity:1}
.oc-show h1{margin:0;font-weight:400;font-size:clamp(2.2rem,7vw,4.6rem);color:#fff;text-shadow:4px 0 0 var(--ink),-4px 0 0 var(--ink),0 4px 0 var(--ink),0 -4px 0 var(--ink),0 10px 0 var(--ink);animation:oc-pop .5s cubic-bezier(.2,1.8,.4,1)}
.oc-show h1.bad{color:#ff6b7a}.oc-show h1.good{color:#7dff8a}
.oc-show .sub{font-size:1.2rem;color:#fff;text-shadow:var(--stroke)}
.oc-chips{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;max-width:min(860px,94vw)}
.oc-chip{display:flex;align-items:center;gap:8px;padding:6px 14px 6px 8px;border:3px solid var(--ink);border-radius:14px;font-size:1.05rem;color:#fff;text-shadow:var(--stroke);
  background:color-mix(in srgb,var(--c) 70%,#222);animation:oc-pop .4s cubic-bezier(.2,1.8,.4,1) both}
.oc-chip.out{filter:grayscale(.85) brightness(.75)}
.oc-chip.me{outline:3px solid #fff;outline-offset:2px}
.oc-chip b{font-weight:400;font-size:1.25rem}
.oc-next{margin-top:8px;padding:8px 20px;border:4px solid var(--ink);border-radius:18px;background:linear-gradient(180deg,#ffe680,#ffc21f);color:var(--ink);font-size:1.15rem;text-align:center;box-shadow:0 5px 0 var(--ink)}
.oc-next .nm{font-size:1.6rem}
.oc-hint{position:absolute;left:50%;bottom:104px;transform:translateX(-50%);font:1.05rem var(--font);color:#fff;text-shadow:var(--stroke);white-space:nowrap}
@keyframes oc-pop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
`;

export async function start(ctx) {
  const { ui, input, net } = ctx;
  const ids = ctx.players.map((p) => p.id), N = ids.length, myIdx = ids.indexOf(ctx.myId);
  const opts = { rounds: ctx.options.rounds || '3', pool: ctx.options.pool || 'all', final: ctx.options.final || 'random' };
  const plan = planMatch(ctx.rng(0x0B5), opts, N);
  let devStage = new URLSearchParams(location.search).get('ocstage'); try { devStage ||= localStorage.getItem('oc.devstage'); } catch { /* */ }      // dev/test only: ?ocstage=hop plays that stage first
  if (devStage && STAGES[devStage]) plan[0] = devStage;
  const stages = new Map();
  const stageFor = (k) => { if (!stages.has(k)) stages.set(k, buildStage(plan[k], ctx.rng(0x500 + k * 131))); return stages.get(k); };
  const api = { autopilot: false, turbo: 1, plan, stats: { corrections: 0, snaps: 0 } };   // test-only hooks (tests/drivers.mjs)
  window.__obstacle = api;

  const style = document.createElement('style'); style.textContent = CSS; ctx.container.appendChild(style);
  const tagsEl = ui.el('div', 'oc-tags'); ctx.container.appendChild(tagsEl);
  const card = ui.el('div', 'oc-card'); ctx.container.appendChild(card);
  const show = ui.el('div', 'oc-show'); ctx.container.appendChild(show);
  const hint = ui.el('div', 'oc-hint'); ctx.container.appendChild(hint);
  const tags = new Map();
  for (const p of ctx.players) { const t = ui.el('div', 'oc-tag'); t.textContent = p.name; t.style.setProperty('--c', p.colorCss); tagsEl.appendChild(t); tags.set(p.id, t); }

  const gfx = createView(ctx);
  const sfx = createSound(ctx.audio);
  ctx.on('resize', gfx.resize);
  ctx.on('settings', (k) => { if (k === 'quality') gfx.applyQ(); });

  // ---------------------------------------------------------------- shared (mirrored) match info
  let info = { k: 0, roundIn: [...ids], status: Object.fromEntries(ids.map((id) => [id, 'in'])), order: [], outOrder: [], elim: [], winner: null, phase: 'wait' };
  let round = -1, st = null, W = null, phase = 'wait', phaseT = 0, tC = 0, lastSnap = null, lastEnd = null;
  const view = new Map();           // id -> render state (others interpolated; me predicted)
  let me = null, mySlot = -1;       // my predicted bean (clients); the host reads sim directly
  const myBot = makeBot(ctx.bots.Brain, ctx.bots.level);
  let sim = null, ended = false;
  const inputs = new Map();
  let graceUntil = 0, qualifiedAt = {}, spec = null;

  function useRound(k, roundIn) {
    if (k === round) return;
    round = k; st = stageFor(k); W = makeWorld(st);
    phase = k === 0 ? 'wait' : 'intro'; phaseT = 0; tC = 0;
    setPoses(W, 0, STEP);
    gfx.buildStage(st);
    view.clear(); qualifiedAt = {};
    roundIn.forEach((id, i) => { const s = spawnOf(st, i); view.set(id, { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, face: s.face, flags: 1, grounded: true, visible: true }); });
    mySlot = roundIn.indexOf(ctx.myId);
    me = null;
    if (mySlot >= 0) { const s = spawnOf(st, mySlot); me = newPlayer(ctx.myId, s.x, s.y, s.z, s.face); me.auth = -1; me.slot = mySlot; syncCounters(me, myInput); }
    resetBot(myBot);
    const sp = me || view.get(roundIn[0]) || { x: 0, y: 0, z: 0, face: 0 };
    Object.assign(gfx.cam, { x: sp.x, y: sp.y, z: sp.z, yaw: st.len ? 0 : Math.atan2(-sp.x, -sp.z), mode: 'intro', introT: 0, orbit: Math.random() * 6 });
    spec = null;
    showCard(k);
    show.classList.remove('on');
  }
  function qText(k, n) {
    const id = plan[k], meta = STAGES[id], q = quota(plan, k, n, N);
    if (meta.kind === 'final') return id === 'crown' ? 'FINAL · first to the crown wins' : 'FINAL · last bean standing wins';
    if (q >= n) return n === 1 ? 'Solo show · finish to qualify' : 'Everyone can qualify!';
    return meta.kind === 'race' ? `First ${q} of ${n} qualify` : `${q} of ${n} survive · or outlast the clock`;
  }
  function showCard(k) {
    const id = plan[k], meta = STAGES[id];
    card.innerHTML = `<div class="ic">${meta.icon}</div><div class="nm">${ui.esc(meta.name)}</div><div class="ds">${ui.esc(meta.desc)}</div><div class="qt">Round ${k + 1}/${plan.length} · ${ui.esc(qText(k, info.k === k ? info.roundIn.length : N))}</div>`;
    card.classList.add('on');
    ctx.setTimeout(() => { if (round === k) card.classList.remove('on'); }, k === 0 ? 4200 : INTRO_T * 1000 - 400);
  }

  // ---------------------------------------------------------------- input
  const myInput = { mx: 0, mz: 0, jh: false, j: 0, d: 0, g: false };
  const statusOf = (id) => info.status[id] || 'gone';
  const amActive = () => !ctx.spectator && statusOf(ctx.myId) === 'in' && info.roundIn.includes(ctx.myId) && !(me && me.falling) && round === info.k;
  input.on('press', (a) => {
    if ((a === 'primary') && amActive() && !input.mouse.locked && phase === 'play') input.lockPointer();
    if ((a === 'jump' || a === 'primary' || a === 'secondary') && !amActive()) cycleSpectate();
    if (!amActive() || (phase !== 'play' && phase !== 'post')) return;
  });
  input.on('wheel', (e) => { gfx.cam.dist = Math.max(5, Math.min(16, gfx.cam.dist + e.deltaY * 0.006)); });
  function readInput() {
    const ax = input.axis(), yaw = gfx.cam.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
    let mx = rx * ax.x + fx * -ax.y, mz = rz * ax.x + fz * -ax.y;
    const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    myInput.mx = mx; myInput.mz = mz; myInput.jh = input.down('jump'); myInput.j = input.presses('jump'); myInput.d = input.presses('boost'); myInput.g = input.down('use');
  }
  function cycleSpectate() {
    const live = info.roundIn.filter((id) => statusOf(id) === 'in' && id !== ctx.myId);
    if (!live.length) return;
    spec = live[(live.indexOf(spec) + 1) % live.length];
  }

  // ---------------------------------------------------------------- host
  const cfg = () => ({ ids, bots: new Set(ctx.players.filter((p) => p.isBot).map((p) => p.id)), plan, stageFor, N, botLevel: ctx.bots.level, Brain: ctx.bots.Brain, ev: hostEvent });
  const sendInfo = () => { if (sim) net.toAll({ t: 'info', ...sim.info() }); };
  function hostEvent(type, d) {
    switch (type) {
      case 'play': net.toAll({ t: 'play', k: d.k }); sendInfo(); break;
      case 'hit': net.toAll({ t: 'hit', a: d.a, v: d.v, vx: +d.vx.toFixed(2), vy: +d.vy.toFixed(2), vz: +d.vz.toFixed(2) }); break;
      case 'q': net.toAll({ t: 'q', id: d.id, place: d.place, final: d.final }); sendInfo(); break;
      case 'out': net.toAll({ t: 'out', id: d.id, by: d.by, x: +d.x.toFixed(1), z: +d.z.toFixed(1) }); sendInfo(); break;
      case 'end': net.toAll({ t: 'end', ...d }); sendInfo(); break;
      case 'show': net.toAll({ t: 'show', k: d.k }); sendInfo(); break;
      case 'round': sendInfo(); break;
      case 'grab': net.toAll({ t: 'grab', a: d.a, v: d.v }); break;
      case 'door': net.toAll({ t: 'door', d: d.d, id: d.id }); break;
      case 'fell': net.toAll({ t: 'fell', id: d.id }); break;
      case 'done': finish(); break;
    }
  }
  function finish() {
    if (ended || !sim) return; ended = true;
    const pl = sim.standings();
    const stats = {};
    const champ = sim.winner?.length === 1 ? sim.winner[0] : null;
    for (const id of ids) {
      if (sim.winner?.includes(id)) stats[id] = sim.winner.length > 1 ? '👑 Shared the crown' : '👑 Champion of the show!';
      else { const r = sim.elim.findIndex((g) => g.includes(id)); stats[id] = r >= plan.length - 1 ? `Finalist · ${STAGES[plan[r]].name}` : r >= 0 ? `Out in round ${r + 1} · ${STAGES[plan[r]].name}` : 'Took part'; }
    }
    ctx.endGame(pl, { stats, title: champ ? `${ctx.player(champ)?.name} wins the show!` : 'What a show!' });
  }
  if (net.isHost) sim = new HostSim(cfg());
  function becomeHost() {
    sim = HostSim.fromView(cfg(), info, lastSnap);
    const mine = sim.players.get(ctx.myId);
    if (mine && me) Object.assign(mine, { x: me.x, y: me.y, z: me.z, vx: me.vx, vy: me.vy, vz: me.vz, face: me.face, cp: me.cp, rs: me.rs, lj: me.lj, ld: me.ld });
    if (ctx.started && sim.phase === 'wait') sim.go();
    graceUntil = performance.now() + 4000;
    inputs.clear();
    sendInfo();
  }
  ctx.on('hostchange', ({ amHost }) => { if (amHost && !sim) becomeHost(); });
  ctx.on('join', (id) => { if (net.isHost && sim) net.to(id, { t: 'info', ...sim.info() }); });
  ctx.on('go', () => { if (net.isHost && sim) sim.go(); });

  function adopt(from, m) {
    const p = sim.players.get(from);
    if (!p || sim.status[from] !== 'in' || !Array.isArray(m.p) || m.a !== p.auth) return;
    if (sim.phase !== 'play' && sim.phase !== 'post') return;
    const now = performance.now();
    if (now - (sim.kbAt[from] || 0) < 450) return;
    const [x, y, z, vx, vy, vz, face] = m.p;
    if (![x, y, z, vx, vy, vz, face].every(Number.isFinite)) return;
    if (m.rs !== p.rs) { Object.assign(p, { x, y, z, vx, vy, vz, face, rs: m.rs, gr: -1, down: 0, dive: false, hang: -1 }); p.cp = Math.max(p.cp, m.cp | 0); return; }
    const d = Math.hypot(x - p.x, y - p.y, z - p.z);
    if (d < 2.5 || now < graceUntil) {
      Object.assign(p, { x, y, z, vx, vy, vz, face });
      p.dive = !!(m.f & 4);
      if (m.h >= 0 && sim.W.solids[m.h] && Array.isArray(m.hl)) { if (p.hang !== m.h) { p.hang = m.h; p.hangT = 0; } p.hl[0] = m.hl[0]; p.hl[1] = m.hl[1]; p.hn[0] = m.hl[2]; p.hn[1] = m.hl[3]; }
      else if (p.hang >= 0) p.hang = -1;
      p.cp = Math.max(p.cp, m.cp | 0);
    } else { p.auth = (p.auth + 1) & 255; }
  }

  // ---------------------------------------------------------------- messages (host loops its own broadcasts back here too)
  net.onMessage((m, from) => {
    switch (m.t) {
      case 'in': if (net.isHost && sim && from !== ctx.myId && m.i) { inputs.set(from, { mx: +m.i.mx || 0, mz: +m.i.mz || 0, jh: !!m.i.jh, j: m.i.j | 0, d: m.i.d | 0, g: !!m.i.g }); adopt(from, m); } break;
      case 'info': {
        const { t, ...rest } = m; info = rest;
        if (info.k !== round && info.k >= round) useRound(info.k, info.roundIn);
        if (info.phase === 'show' && lastEnd) renderShow();
        break;
      }
      case 'play': if (m.k === round) { phase = 'play'; phaseT = 0; if (m.k > 0) { ui.countdown(0); sfx.whistle(); } } break;
      case 'hit': onHit(m); break;
      case 'q': onQualify(m); break;
      case 'out': onOut(m); break;
      case 'end': onEnd(m); break;
      case 'show': phase = 'show'; renderShow(); break;
      case 'grab': if (m.a === ctx.myId || m.v === ctx.myId) { sfx.grab(); if (m.v === ctx.myId) ui.toast(`✋ ${ctx.player(m.a)?.name} grabbed you!`, '', 1500); } else if (near(m.v, 12)) sfx.grab(); break;
      case 'door': { const v = view.get(m.id); if (v && near(m.id, 18)) { sfx.door(); gfx.fx.dust(v.x, v.y + 1.2, v.z + 0.6, 1); } break; }
      case 'fell': { const v = view.get(m.id); if (v && near(m.id, 25)) { gfx.fx.splash(v.x, st.killY + 3.6, v.z); sfx.splash(m.id === ctx.myId); } break; }
    }
  });
  function near(id, r) { const v = view.get(id), f = view.get(camFocus); return v && f && Math.hypot(v.x - f.x, v.z - f.z) < r; }
  function onHit(m) {
    const v = view.get(m.v);
    if (v) gfx.fx.stars(v.x, v.y, v.z);
    const mine = m.v === ctx.myId || m.a === ctx.myId;
    sfx.hit(mine); if (mine) gfx.fx.shake(m.v === ctx.myId ? 0.7 : 0.35);
    if (m.v === ctx.myId && !net.isHost && me) knock(me, m.vx, m.vy, m.vz, 0.8);
    if (m.v === ctx.myId) ui.toast(`💥 ${ctx.player(m.a)?.name} dived into you!`, '', 1800);
  }
  function onQualify(m) {
    info.status[m.id] = 'q'; if (!info.order.includes(m.id)) info.order.push(m.id);
    qualifiedAt[m.id] = performance.now();
    const v = view.get(m.id), mine = m.id === ctx.myId, name = ctx.player(m.id)?.name || '?';
    if (v) gfx.fx.confetti(v.x, v.y + 1, v.z, mine ? 90 : 40);
    sfx.qualify(mine);
    if (m.final) { ui.banner(mine ? '👑 YOU WIN THE CROWN!' : `👑 ${name} WINS!`, 3200); sfx.fanfare(); return; }
    if (mine) { ui.banner('✅ QUALIFIED!', 2000); gfx.fx.shake(0.3); }
    else if (st?.mode === 'race') ui.toast(`✅ ${name} qualified (${m.place}/${quota(plan, round, info.roundIn.length, N)})`, m.place <= 1 ? 'gold' : '', 1800);
  }
  function onOut(m) {
    info.status[m.id] = 'out'; if (!info.outOrder.includes(m.id)) info.outOrder.push(m.id);
    const mine = m.id === ctx.myId, name = ctx.player(m.id)?.name || '?';
    gfx.fx.splash(m.x, st.killY + 3.6, m.z);
    sfx.splash(mine); sfx.eliminated(mine);
    if (mine) { if (me) me.falling = true; ui.banner('💥 ELIMINATED!', 2200); gfx.fx.shake(0.6); ctx.setTimeout(() => { if (!amActive()) ui.toast('👀 You\'re out: Space / click to watch someone else', '', 3000); }, 2300); }
    else ui.toast(m.by ? `💥 ${ctx.player(m.by)?.name} knocked ${name} out!` : `💦 ${name} is out!`, m.by === ctx.myId ? 'gold' : '', 2200);
  }
  function onEnd(m) {
    lastEnd = m; phase = 'post'; phaseT = 0;
    info.order = [...m.qualified];
    for (const id of m.qualified) info.status[id] = 'q';
    for (const id of m.eliminated) info.status[id] = 'out';
    if (m.final) {
      const w = (m.winner || []).map((id) => ctx.player(id)?.name || '?');
      if (!m.winner?.includes(ctx.myId) || st.mode === 'last') ui.banner(w.length ? `👑 ${w.join(' & ')} ${w.length > 1 ? 'SHARE' : 'WINS'} THE SHOW!` : 'SHOW OVER!', 4000);
      sfx.fanfare(); fireworksT = 4;
    } else {
      const mineQ = m.qualified.includes(ctx.myId), mineOut = m.eliminated.includes(ctx.myId);
      ui.banner(m.timeUp ? '⏰ TIME!' : 'ROUND OVER!', 1800);
      sfx.whistle();
      if (mineOut && statusOf(ctx.myId) === 'out' && st.mode === 'race') ctx.setTimeout(() => sfx.eliminated(true), 600);
      if (mineQ && st.mode !== 'race') { sfx.qualify(true); }
    }
  }
  function renderShow() {
    if (!lastEnd) return;
    const m = lastEnd, mine = ctx.myId;
    const q = m.qualified, out = m.eliminated;
    const head = ctx.spectator ? 'ROUND RESULTS' : q.includes(mine) ? 'QUALIFIED!' : out.includes(mine) ? 'ELIMINATED!' : 'ROUND RESULTS';
    const cls = q.includes(mine) ? 'good' : out.includes(mine) ? 'bad' : '';
    const chip = (id, ok, i) => { const p = ctx.player(id); return `<div class="oc-chip ${ok ? '' : 'out'} ${id === mine ? 'me' : ''}" style="--c:${p?.colorCss};animation-delay:${(i * 0.08).toFixed(2)}s"><span class="ph-dot" style="background:${p?.colorCss}"></span>${ui.esc(p?.name || '?')}<b>${ok ? '✔' : '✖'}</b></div>`; };
    const nk = m.k + 1, nid = plan[nk];
    show.innerHTML = `<h1 class="${cls}">${head}</h1><div class="sub">Round ${m.k + 1} · ${ui.esc(STAGES[plan[m.k]].name)}</div>
      <div class="oc-chips">${q.map((id, i) => chip(id, true, i)).join('')}${out.map((id, i) => chip(id, false, q.length + i)).join('')}</div>
      ${nid ? `<div class="oc-next">Next up${nk === plan.length - 1 ? ': THE FINAL' : ''}<div class="nm">${STAGES[nid].icon} ${ui.esc(STAGES[nid].name)}</div>${ui.esc(qText(nk, q.length))}</div>` : ''}`;
    show.classList.add('on');
    if (!ctx.spectator) { if (q.includes(mine)) sfx.cheer(0.8); }
  }

  // ---------------------------------------------------------------- snapshots (clients)
  net.onRaw((buf) => {
    if (net.isHost) return;
    const s = decodeSnap(buf); if (!s) return;
    api.stats.snaps++;
    lastSnap = s;
    if (s.round !== round) {
      if (s.round < round) return;
      useRound(s.round, s.players.map((r) => ids[r.idx]));
    }
    phase = s.phase; phaseT = s.phaseT;
    const lat = (net.ping() || 60) / 2000 * (api.turbo || 1);
    const target = s.t + (phase === 'play' || phase === 'post' ? lat : 0);
    if (Math.abs(target - tC) > 0.3) tC = target; else tC += (target - tC) * 0.15;
    if (W && s.dyn.length === W.dyn.length) for (let i = 0; i < s.dyn.length; i++) if (s.dyn[i] > W.dyn[i]) W.dyn[i] = s.dyn[i];
    const now = performance.now();
    for (const r of s.players) {
      const id = ids[r.idx]; if (!id) continue;
      let v = view.get(id); if (!v) { v = { visible: true }; view.set(id, v); }
      const fl = r.flags;
      if (id === ctx.myId && me) {
        if (r.auth !== me.auth || ((r.rs !== me.rs) && Math.hypot(r.x - me.x, r.z - me.z) > 3)) {
          if (me.auth !== -1) api.stats.corrections++;
          Object.assign(me, { x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz, face: r.face, auth: r.auth, rs: r.rs, gr: -1, hang: -1, dive: !!(fl & 4) });
          me.down = r.down; me.cp = Math.max(me.cp, r.cp);
        }
        me.grab = fl & 64 ? 'x' : null;
        me.gby = s.players.find((o) => o.grabIdx === myIdx) ? 'x' : null;
        continue;
      }
      const big = v.tx != null && Math.hypot(r.x - v.tx, r.z - v.tz) > 4;
      v.px = big ? r.x : (v.x ?? r.x); v.py = big ? r.y : (v.y ?? r.y); v.pz = big ? r.z : (v.z ?? r.z); v.pface = v.face ?? r.face;
      v.tx = r.x; v.ty = r.y; v.tz = r.z; v.tface = r.face; v.at = now; v.span = Math.max(30, now - (v.lastAt || now - 50)); v.lastAt = now;
      Object.assign(v, { vx: r.vx, vy: r.vy, vz: r.vz, flags: fl, grounded: !!(fl & 2), dive: !!(fl & 4), down: !!(fl & 8), hang: !!(fl & 16), slide: !!(fl & 128), grabIdx: r.grabIdx });
    }
  });

  // ---------------------------------------------------------------- host tick (60 Hz, runs in background tabs)
  let snapAcc = 0, hostAcc = 0;
  const flagsOf = (p, id) => (sim.status[id] === 'in' ? 1 : 0) | (p.gr >= 0 ? 2 : 0) | (p.dive ? 4 : 0) | (isDown(p) ? 8 : 0) | (p.hang >= 0 ? 16 : 0) | (sim.status[id] === 'q' ? 32 : 0) | (p.grab ? 64 : 0) | (p.slide ? 128 : 0);
  ctx.tick((dt) => {
    if (!net.isHost || !sim || ended) return;
    hostAcc += dt * (api.turbo || 1); let n = 0;
    while (hostAcc >= STEP && n < 12 * (api.turbo || 1)) {
      const mine = sim.players.get(ctx.myId);
      if (mine && !ctx.spectator && sim.status[ctx.myId] === 'in') {
        if (api.autopilot) inputs.set(ctx.myId, { ...botThink({ st: sim.st, W: sim.W, players: sim.inRound(), dt: STEP }, mine, myBot, STEP) });
        else inputs.set(ctx.myId, { ...myInput });
      }
      const k0 = sim.k;
      sim.step(STEP, inputs, (id) => id === ctx.myId || ctx.connected(id));
      if (sim.k !== k0) inputs.clear();
      hostAcc -= STEP; n++;
      if (ended) return;
    }
    if (n >= 12 * (api.turbo || 1)) hostAcc = 0;
    snapAcc += dt;
    if (snapAcc >= 1 / SNAP_HZ) {
      snapAcc = 0;
      const players = [...sim.players.values()].map((p) => ({ ...p, idx: ids.indexOf(p.id), flags: flagsOf(p, p.id), grabIdx: p.grab ? ids.indexOf(p.grab) : 255 }));
      net.rawToAll(encodeSnap({ round: sim.k, phase: sim.phase, t: sim.t, phaseT: sim.phaseT, players, dyn: sim.W.dyn }));
    }
  });

  // ---------------------------------------------------------------- frame: prediction, camera, render, HUD
  let camFocus = ctx.myId, sendAcc = 0, predAcc = 0, lastPhase = 'wait', lastCount = 0, fireworksT = 0, hype = 0, musicOn = false;
  useRound(0, ids);
  const TMPG = { st: null, W: null, players: [], dt: STEP };
  ctx.frame((dt, now) => {
    readInput();
    if (!ctx.started) { myInput.mx = myInput.mz = 0; }
    if (!musicOn && ctx.audio.ready) { musicOn = true; sfx.startMusic(); }
    const host = net.isHost && sim;
    const turbo = api.turbo || 1;
    // ---- state for this frame
    if (host) {
      if (sim.k !== round) useRound(sim.k, sim.roundIn);
      phase = sim.phase; phaseT = sim.phaseT; tC = sim.t; info = sim.info(); W = sim.W;
      for (const p of sim.players.values()) {
        let v = view.get(p.id); if (!v) { v = {}; view.set(p.id, v); }
        Object.assign(v, { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, face: p.face, flags: flagsOf(p, p.id), grounded: p.gr >= 0, dive: p.dive, down: isDown(p), hang: p.hang >= 0, slide: p.slide, landV: p.landV, grabIdx: p.grab ? ids.indexOf(p.grab) : -1 });
      }
      const mp = sim.players.get(ctx.myId);
      if (mp) localFx(mp);
    } else if (st) {
      phaseT += dt * turbo;
      if (phase === 'play' || phase === 'post') tC += dt * turbo;
      if (me && !me.falling && statusOf(ctx.myId) === 'in' && (phase === 'play' || phase === 'post') && round === info.k) {
        predAcc += dt * turbo; let k = 0; const t0 = tC - predAcc;
        TMPG.st = st; TMPG.W = W; TMPG.players = info.roundIn.filter((id) => statusOf(id) === 'in').map((id) => (id === ctx.myId ? me : { id, ...view.get(id) }));
        while (predAcc >= STEP && k < 8 * turbo) {
          const ts = t0 + (k + 1) * STEP;
          setPoses(W, ts, STEP);
          const inp = api.autopilot ? botThink(TMPG, me, myBot, STEP) : myInput;
          if (phase !== 'play') { me.lj = inp.j; me.ld = inp.d; }
          const ev = stepPlayer(me, phase === 'play' ? inp : { mx: 0, mz: 0, jh: false, j: inp.j, d: inp.d, g: false }, STEP, W);
          myEvents(ev, me);
          for (const [id, v] of view) if (id !== ctx.myId && statusOf(id) === 'in' && v.visible !== false) separate(me, v, false);
          if (ev & EV.FELL) {
            if (st.mode === 'race' || st.mode === 'crown') { const s = respawnOf(st, me.cp, mySlot); Object.assign(me, { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, face: s.face, down: 0, tumble: false, dive: false, slide: false, gr: -1, hang: -1 }); me.rs = (me.rs + 1) & 255; }
            else me.falling = true;
          }
          if (st.cps.length) for (let i = me.cp; i < st.cps.length; i++) { const c = st.cps[i]; if (me.z > c.z - 2.4 && me.y > c.y - 0.6 && me.gr >= 0) me.cp = i + 1; }
          predAcc -= STEP; k++;
        }
        if (k >= 8 * turbo) predAcc = 0;
        api.lastInp = TMPG;
      } else { predAcc = 0; if (W) setPoses(W, tC, STEP); if (me) syncCounters(me, myInput); }
      if (me && me.falling) { me.vy -= C.GRAV * dt; me.y += me.vy * dt; me.x += me.vx * dt; me.z += me.vz * dt; }
      // others: interpolate between the last two snapshots
      for (const [id, v] of view) {
        if (id === ctx.myId && me || v.tx == null) continue;
        const f = Math.min(1.25, (now - v.at) / v.span);
        v.x = v.px + (v.tx - v.px) * f; v.y = v.py + (v.ty - v.py) * f; v.z = v.pz + (v.tz - v.pz) * f;
        let da = v.tface - v.pface; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; v.face = v.pface + da * Math.min(1, f);
      }
      if (me) { const v = view.get(ctx.myId) || {}; view.set(ctx.myId, Object.assign(v, { x: me.x, y: me.y, z: me.z, vx: me.vx, vy: me.vy, vz: me.vz, face: me.face, grounded: me.gr >= 0, dive: me.dive, down: isDown(me), hang: me.hang >= 0, slide: me.slide, landV: me.landV, grabIdx: -1 })); }
      // send input + predicted state
      sendAcc += dt;
      if (me && !ctx.spectator && statusOf(ctx.myId) === 'in' && !me.falling && sendAcc >= 1 / SEND_HZ) {
        sendAcc = 0;
        const i = api.autopilot ? myBot.inp : myInput;
        net.toHost({ t: 'in', i: { mx: +i.mx.toFixed(3), mz: +i.mz.toFixed(3), jh: i.jh, j: i.j, d: i.d, g: i.g }, p: [+me.x.toFixed(3), +me.y.toFixed(3), +me.z.toFixed(3), +me.vx.toFixed(2), +me.vy.toFixed(2), +me.vz.toFixed(2), +me.face.toFixed(3)],
          f: (me.dive ? 4 : 0), h: me.hang, hl: me.hang >= 0 ? [+me.hl[0].toFixed(3), +me.hl[1].toFixed(3), me.hn[0], me.hn[1]] : null, a: me.auth, rs: me.rs, cp: me.cp });
      }
    }
    // ---- phase cues
    if (phase !== lastPhase) {
      if (phase === 'play') { gfx.cam.mode = 'follow'; card.classList.remove('on'); show.classList.remove('on'); }
      if (phase === 'intro') { gfx.cam.mode = 'intro'; gfx.cam.introT = 0; }
      if (phase === 'show') renderShow();
      lastPhase = phase;
    }
    if (phase === 'intro') { const c = Math.ceil(INTRO_T - phaseT); if (c >= 1 && c <= 3 && c !== lastCount) { lastCount = c; ui.countdown(c); } } else lastCount = 0;
    if (gfx.cam.mode === 'intro') { gfx.cam.introT = Math.min(1, gfx.cam.introT + dt / (phase === 'intro' ? INTRO_T - 0.4 : 3.3)); if (ctx.started && phase !== 'intro' && phase !== 'wait') gfx.cam.mode = 'follow'; }
    if (phase === 'wait' && ctx.started && !host) { /* waiting for the host's 'play' */ }
    if (phase === 'post' && fireworksT > 0) { fireworksT -= dt; if (Math.random() < dt * 5) { const f = view.get(camFocus) || { x: 0, y: 0, z: 0 }; gfx.fx.firework(f.x + (Math.random() - 0.5) * 24, f.y + 9 + Math.random() * 8, f.z + 6 + Math.random() * 10); sfx.firework(); } }
    // ---- camera focus
    const active = amActive();
    let focusId = ctx.myId;
    if (!active) {
      const live = info.roundIn.filter((id) => statusOf(id) === 'in' && id !== ctx.myId);
      if (!spec || !live.includes(spec)) spec = live.sort((a, b) => prog(b) - prog(a))[0] || (statusOf(ctx.myId) === 'q' && st?.mode !== 'race' ? ctx.myId : null) || spec;
      focusId = spec || (info.winner?.[0]) || ctx.myId;
    }
    camFocus = focusId;
    const f = view.get(focusId) || [...view.values()][0];
    const cam = gfx.cam;
    if (f) { const k = Math.min(1, dt * 9); cam.x += (f.x - cam.x) * k; cam.z += (f.z - cam.z) * k; cam.y += ((f.grounded || f.hang ? f.y : Math.min(cam.y + 3, f.y)) - cam.y) * Math.min(1, dt * 5); }
    if (input.mouse.locked) { const d = input.takeMouseDelta(ctx.settings.get('sens') || 1); cam.yaw -= d.x * 0.0032; cam.pitch = Math.max(0.05, Math.min(1.25, cam.pitch + d.y * 0.0026)); }
    else if (st?.crown && f && Math.hypot(f.x - st.crown.x, f.z - st.crown.z) < 11 && f.y > 0.8) {
      // on the tower: the camera swings round behind the direction you're running, so the column is always beside you
      const sp = Math.hypot(f.vx || 0, f.vz || 0);
      if (sp > 2) { let da = Math.atan2(f.vx, f.vz) - cam.yaw; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; cam.yaw += da * Math.min(1, dt * 2.4); }
    }
    else if (st?.len && f) { let da = 0 - cam.yaw; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; cam.yaw += da * Math.min(1, dt * 0.8); }
    // ---- audio bed
    const left = info.roundIn.filter((id) => statusOf(id) === 'in').length;
    const meta = st ? STAGES[st.id] : null;
    const tLeft = meta ? meta.time - tC : 99;
    hype += (((phase === 'play' ? 0.25 : 0.1) + (meta?.kind === 'final' ? 0.45 : 0) + (tLeft < 15 && phase === 'play' ? 0.3 : 0) + (phase === 'post' ? 0.4 : 0)) - hype) * Math.min(1, dt * 1.5);
    sfx.setIntensity(Math.min(1, hype)); sfx.crowd(hype);
    // ---- render
    for (const [id, v] of view) {
      const s = statusOf(id), inRound = info.roundIn.includes(id) && round === info.k;
      let vis = inRound && (s === 'in' || (s === 'q' && (st.mode !== 'race' || now - (qualifiedAt[id] || now) < 700)));
      if (s === 'q' && st.mode === 'race' && qualifiedAt[id] && now - qualifiedAt[id] >= 700 && !v.poofed) { v.poofed = true; gfx.fx.poof(v.x, v.y, v.z, ctx.player(id)?.colorHex ?? 0xffffff); sfx.pop(); }
      if (id === ctx.myId && me?.falling && me.y < st.killY + 2) vis = false;
      if (s === 'out' && v.y > st.killY + 3) vis = vis || false;
      v.visible = vis;
      const gi = W ? groundAt(W, v.x, v.z, v.y - 40, v.y + 0.15) : -1;
      v.groundY = gi >= 0 ? W.solids[gi].y + W.solids[gi].hy : -1e9;
      if (v.grabIdx >= 0 && ids[v.grabIdx]) { const o = view.get(ids[v.grabIdx]); if (o) { v.grabX = o.x; v.grabY = o.y; v.grabZ = o.z; } else v.grabX = null; } else v.grabX = null;
    }
    gfx.update(dt, now, { t: tC, W, players: view, hype, crownTaken: !!info.winner && st?.mode === 'crown',
      onTile: (s) => { if (near2(s, 9)) sfx.tile(true); }, onTileFall: (s) => sfx.tileFall(near2(s, 10)) });
    // name tags
    for (const [id, t] of tags) {
      const v = view.get(id);
      if (!v || !v.visible || (id === ctx.myId && active)) { t.style.display = 'none'; continue; }
      const p = gfx.project(v.x, v.y + 2.3, v.z);
      if (!p) { t.style.display = 'none'; continue; }
      t.style.display = ''; t.style.transform = `translate(${p[0].toFixed(0)}px,${p[1].toFixed(0)}px) translate(-50%,-100%)`;
    }
    // ---- HUD
    hud(active, focusId, tLeft, left);
  });
  function near2(s, r) { const f = view.get(camFocus); return f && Math.hypot(s.x - f.x, s.z - f.z) < r && Math.abs(s.y - f.y) < 4; }
  function prog(id) { const v = view.get(id); return v && st ? progressOf(st, v) : -1e9; }

  // local effects for my own bean (clients: from prediction events; host: from sim state edges)
  function myEvents(ev, p) {
    if (!ev) return;
    if (ev & EV.JUMP) sfx.jump();
    if (ev & EV.DIVE) { sfx.dive(); gfx.fx.dust(p.x, p.y, p.z, 0.5); }
    if (ev & EV.LAND) { const k = Math.min(1, p.landV / 18); sfx.land(k); if (p.landV > 6) gfx.fx.dust(p.x, p.y, p.z, k); if (p.slide) sfx.slide(); if (p.landV > 15) gfx.fx.shake(0.2); }
    if (ev & EV.BONK) { sfx.bonk(); gfx.fx.stars(p.x, p.y, p.z); gfx.fx.shake(0.3); if (p.wall >= 0 && W.solids[p.wall]?.door >= 0) gfx.wobbleDoor(W.solids[p.wall].door); }
    if (ev & EV.HIT) { sfx.hit(true); gfx.fx.stars(p.x, p.y, p.z); gfx.fx.shake(0.8); }
    if (ev & EV.HANG) sfx.hang();
    if (ev & EV.CLIMB) sfx.climb();
    if (ev & EV.BOUNCE) sfx.jump();
  }
  const edge = { hang: -1 };
  function localFx(p) {
    let ev = 0;
    if (p.dive && !edge.dive) ev |= EV.DIVE;
    if (p.gr >= 0 && edge.air) ev |= EV.LAND;
    if (p.gr < 0 && !edge.air && p.vy > 5 && !p.dive) ev |= EV.JUMP;
    if (isDown(p) && !edge.down && !p.slide) ev |= EV.HIT;
    if (p.hang >= 0 && edge.hang < 0) ev |= EV.HANG;
    edge.dive = p.dive; edge.air = p.gr < 0; edge.down = isDown(p); edge.hang = p.hang;
    if (ev && sim.status[ctx.myId] === 'in') myEvents(ev, p);
  }

  function hud(active, focusId, tLeft, left) {
    const meta = st ? STAGES[st.id] : null;
    const s = statusOf(ctx.myId);
    const n = info.roundIn.length, q = quota(plan, round, n, N);
    const head = meta ? `${meta.icon} ${ui.esc(meta.name)} · R${round + 1}/${plan.length}` : '';
    let status;
    if (ctx.spectator) status = `👀 Spectating · ${head}`;
    else if (!info.roundIn.includes(ctx.myId) || round !== info.k) status = `💀 Out · watching ${ui.esc(ctx.player(focusId)?.name || '…')}`;
    else if (s === 'q') status = `✅ Qualified! · ${head}`;
    else if (s === 'out') status = `💀 Eliminated · watching ${ui.esc(ctx.player(focusId)?.name || '…')}`;
    else status = head;
    ui.status(status);
    if (phase === 'play') ui.timer(Math.max(0, tLeft), { warn: 10 }); else ui.timer(null);
    // mini scoreboard: this round's contestants
    const order = standingsOf(info, prog).flat().filter((id) => info.roundIn.includes(id));
    let title = '';
    if (meta?.kind === 'race' && q < n) title = `Qualified ${info.order.length}/${q}`;
    else if (meta?.kind === 'survival') title = `Still in ${left}/${n}${q < n ? ` · ${q} survive` : ''}`;
    else if (meta?.kind === 'final') title = '👑 THE FINAL';
    ui.mini(order.map((id) => { const p = ctx.player(id), ss = statusOf(id); const pi = info.order.indexOf(id); return { id, name: p?.name || '?', color: p?.color ?? 0, value: ss === 'q' ? (meta?.kind === 'race' ? `✔ ${pi + 1}` : '✔') : ss === 'out' ? '✖' : '', me: id === ctx.myId, out: ss === 'out' }; }), title);
    const mp = net.isHost && sim ? sim.players.get(ctx.myId) : me;
    const dim = !active;
    ui.abilities([
      { key: 'Space', label: mp?.hang >= 0 ? 'Climb' : 'Jump', ready: !dim, dim },
      { key: 'Shift', label: 'Dive', ready: !dim && !!mp && (mp.diveOk || mp.gr >= 0) && !mp.dive, dim },
      { key: 'E', label: mp?.grab ? 'Holding!' : mp?.hang >= 0 ? 'Hanging' : 'Grab', cd: mp ? Math.max(0, mp.gcd || 0) / C.GRAB_CD : 0, ready: !dim, dim },
    ]);
    const htxt = !active && phase === 'play' && !ctx.spectator ? 'Space / click: watch someone else' : (active && mp?.hang >= 0 ? 'Space: climb up · let go of E to drop' : '');
    if (hint.textContent !== htxt) hint.textContent = htxt;
  }

  ui.setScoreboard(() => {
    const order = standingsOf(info, prog).flat();
    return { columns: ['Player', 'This round', 'Show'], rows: order.map((id) => {
      const s = statusOf(id), r = info.elim.findIndex((g) => g.includes(id));
      const now = !info.roundIn.includes(id) ? '—' : s === 'q' ? '✔ qualified' : s === 'out' ? '✖ out' : 'racing';
      return [ui.esc(ctx.player(id)?.name || id), now, info.winner?.includes(id) ? '👑 winner' : r >= 0 ? `out in R${r + 1}` : 'still in'];
    }) };
  });

  return {
    standings: () => (sim ? sim.standings() : standingsOf(info, prog)),
    stop() {
      sfx.dispose(); gfx.dispose(); stages.clear(); view.clear();
      if (window.__obstacle === api) delete window.__obstacle;
    },
  };
}
