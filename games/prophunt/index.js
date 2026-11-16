// PROP HUNT — hiders disguise themselves as objects in a furnished house; seekers hunt them before time runs out.
// Hiders: look at an object + E to become it, Q to rotate, right click to lock (no wobble), F to taunt for points.
// Seekers: blindfolded for 20 s, then bonk suspicious objects with a squeaky hammer (wrong guesses cost health).
// Roles rotate every round until everyone has hunted; highest total score wins.
//
// Net model: the host runs HostSim (sim.js) at 60 Hz with every bot and broadcasts 12 Hz JSON snapshots
// (to itself too, so every screen renders the same way). Each player moves their own body locally (prediction is
// exact: there are no player collisions) and reports it at 20 Hz; the host checks it and decides everything that
// matters (roles, timers, bonks, finds, taunt points). Discrete actions ('act') are sent reliably.
export { manifest } from './manifest.js';
import { KINDS } from './props.js';
import { makeLevel, stepBody, bodySize, roomAt, lineOfSight, MAP_IDS, BEAN } from './level.js';
import { HostSim, makePlan, standingsOf, applyRow, pickTarget, T, R, TAUNTS } from './sim.js';
import { makeBrain } from './bots.js';
import { createView } from './render.js';
import { createSound } from './audio.js';

const CSS = `
.ph-tag{position:absolute;left:0;top:0;font:.9rem var(--font);color:#fff;white-space:nowrap;text-shadow:var(--stroke);padding:0 8px;border-radius:10px;pointer-events:none;
  background:color-mix(in srgb,var(--c) 60%,transparent);border:2px solid var(--ink);z-index:2}
.pr-cross{position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#fff;border:2px solid var(--ink);pointer-events:none;z-index:3;transition:transform .1s}
.pr-cross.hot{background:var(--yellow);transform:scale(1.6)}
.pr-hint{position:absolute;left:50%;top:calc(50% + 26px);transform:translateX(-50%);font:1.05rem var(--font);color:#fff;text-shadow:var(--stroke);pointer-events:none;white-space:nowrap;z-index:3}
.pr-blind{position:absolute;inset:0;z-index:4;display:grid;place-items:center;pointer-events:none;background:radial-gradient(ellipse at center,#2a1f4a,#0c0818);transition:opacity .5s}
.pr-blind .mask{font:4.5rem var(--font);text-shadow:var(--stroke),0 8px 0 var(--ink);text-align:center;color:#fff;line-height:1.05}
.pr-blind .mask small{display:block;font-size:1.3rem;opacity:.9;margin-top:10px}
.pr-vig{position:absolute;inset:0;pointer-events:none;z-index:2;box-shadow:inset 0 0 120px 20px rgba(255,60,80,0);transition:box-shadow .2s}
.pr-sniff{position:absolute;left:50%;bottom:118px;transform:translateX(-50%);font:1.4rem var(--font);color:#fff;text-shadow:var(--stroke);padding:4px 16px;border:3px solid var(--ink);border-radius:16px;pointer-events:none;z-index:3;transition:opacity .3s}
`;
const SNAP_HZ = 12, SEND_HZ = 20, STEP = 1 / 60;
const HUNT = (o) => T.HUNT[o.time] || T.HUNT.normal;
const KEY_TAUNT = 'KeyF';

export async function start(ctx) {
  const { ui, input, net } = ctx;
  const ids = ctx.players.map((p) => p.id);
  const opt = { map: ctx.options.map || 'mix', seekers: ctx.options.seekers || 'auto', time: ctx.options.time || 'normal' };
  const plan = makePlan(ctx.rng(0x9A1), ids, opt, MAP_IDS);
  const levels = new Map();
  const levelFor = (k) => { const kk = Math.max(0, Math.min(plan.length - 1, k)); if (!levels.has(kk)) levels.set(kk, makeLevel(ctx.rng(0x100 + kk * 977), plan[kk].map)); return levels.get(kk); };
  const tauntOf = (id) => (TAUNTS.includes(ctx.picks[id]?.taunt) ? ctx.picks[id].taunt : 'kazoo');
  const api = { autopilot: false, turbo: 1, stats: { snaps: 0, finds: 0, taunts: 0 } };   // test-only hooks
  window.__prophunt = api;

  const style = document.createElement('style'); style.textContent = CSS; ctx.container.appendChild(style);
  const cross = ui.el('div', 'pr-cross'); const hint = ui.el('div', 'pr-hint'); const vig = ui.el('div', 'pr-vig');
  const blind = ui.el('div', 'pr-blind hidden', '<div class="mask"></div>'); const sniffEl = ui.el('div', 'pr-sniff hidden');
  ctx.container.append(cross, hint, vig, blind, sniffEl);

  const gfx = createView(ctx);
  const sfx = createSound(ctx);
  ctx.on('resize', gfx.resize);
  ctx.on('settings', (k) => { if (k === 'quality') gfx.applyQ(); });

  // ---------------------------------------------------------------- shared client state
  let round = -1, phase = 'wait', pt = 0, ft = -1, L = null, lastSnap = null, ended = false;
  let score = Object.fromEntries(ids.map((id) => [id, 0])), stats = {};
  const view = new Map();      // id -> rendered player (interpolated; mine = my local body)
  const participant = !ctx.spectator && ids.includes(ctx.myId);
  const me = participant ? { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, gr: true, ...BEAN, yaw: 0, pitch: 0, kind: -1, rot: 0, locked: false, ep: -1, alive: true, role: 'H' } : null;
  let spec = null, highlight = -1, lastTauntAt = -99, lastBonk = 0, sniffAt = -99, clock = 0;

  function useRound(k) {
    if (k === round || k < 0) return;
    round = k; L = levelFor(k); gfx.buildLevel(L);
    gfx.cam.intro = 1; spec = null; highlight = -1;
  }

  // ---------------------------------------------------------------- input
  const myInput = { j: false };
  input.on('press', (a) => {
    if (!me || ended) return;
    const alive = me.alive && phase !== 'post' && phase !== 'intro' && phase !== 'wait';
    if (a === 'primary' && !input.mouse.locked) { input.lockPointer(); if (!(alive && me.role === 'S')) return; }
    if (!alive || (me.role === 'S' && phase === 'hide')) { if (a === 'jump' || a === 'primary' || a === 'secondary') cycleSpec(); return; }
    if (a === 'jump') myInput.j = true;
    if (me.role === 'H') {
      if (a === 'use' && highlight >= 0) {
        const d = L.decoys[highlight]; if (d.k !== me.kind) { me.kind = d.k; me.rot = d.ry; me.locked = false; Object.assign(me, bodySize(d.k)); act({ a: 'dis', k: d.k, r: d.ry }); }
      }
      if (a === 'special' && me.kind >= 0) { me.rot = Math.round((me.rot + Math.PI / 4) / (Math.PI / 4)) * (Math.PI / 4); act({ a: 'rot', r: me.rot }); sfx.rotate(); }
      if (a === 'secondary' && me.kind >= 0) { if (me.gr || me.locked) { me.locked = !me.locked; if (me.locked) { me.vx = me.vz = 0; } act({ a: 'lock', v: me.locked }); sfx.lock(me.locked); } }
    } else if (phase === 'hunt') {
      if (a === 'primary' && clock - lastBonk >= R.BONK_CD) bonk();
      if (a === 'special') { if (clock - sniffAt >= R.SNIFF_CD) { sniffAt = clock; act({ a: 'sniff' }); } else ui.toast(`👃 Sniff ready in ${Math.ceil(R.SNIFF_CD - (clock - sniffAt))} s`, '', 1200); }
    }
  });
  input.on('key', (code, down) => {
    if (code !== KEY_TAUNT || !down || !me || !me.alive || me.role !== 'H' || ended) return;
    if (phase !== 'hunt' && phase !== 'hide') return;
    if (clock - lastTauntAt < R.TAUNT_CD) { ui.toast(`📢 Taunt ready in ${Math.ceil(R.TAUNT_CD - (clock - lastTauntAt))} s`, '', 1000); return; }
    lastTauntAt = clock; act({ a: 'taunt' });
  });
  input.on('wheel', (e) => { gfx.cam.dist = Math.max(1.6, Math.min(6, gfx.cam.dist + e.deltaY * 0.004)); });
  function bonk() {
    lastBonk = clock;
    const { o, d } = gfx.centerRay();
    const eye = [me.x, me.y + R.EYE, me.z];
    const pk = pickTarget(L, [...view.values()], eye, d, R.REACH, ctx.myId);
    gfx.fx.swing(ctx.myId); sfx.swing(true);
    act({ a: 'tag', o: eye, d, tg: pk.tg });
    void o;
  }
  const act = (a) => net.toHost({ t: 'act', a });
  function cycleSpec() {
    const alive = ids.filter((id) => view.get(id)?.alive && id !== ctx.myId);
    if (!alive.length) return;
    spec = alive[(alive.indexOf(spec) + 1) % alive.length];
  }

  // ---------------------------------------------------------------- host
  let sim = null;
  const isBot = (id) => !!ctx.player(id)?.isBot;
  const cfg = () => ({ ids, isBot: (id) => isBot(id) || (id === ctx.myId && api.autopilot), connected: (id) => id === ctx.myId || ctx.connected(id) || isBot(id), plan, levelFor, hunt: HUNT(opt), ev: hostEvent, makeBrain: (id, s) => makeBrain(id, s, ctx.bots.level, ctx.bots.Brain) });
  function hostEvent(e, d) {
    if (e === 'done') { finish(); return; }
    if (e === 'sniff') { const b = sim?.brains.get(d.id); if (b) b.onSniff(d.d); }
    net.toAll({ t: 'ev', e, ...d });
  }
  function finish() {
    if (ended || !sim) return; ended = true;
    const st = {};
    for (const id of ids) { const s = sim.stats[id] || {}; st[id] = `${sim.score[id] || 0} pts · ${s.finds || 0} found · ${Math.round(s.surv || 0)} s hidden · ${s.taunts || 0} taunts`; }
    const pl = sim.standings();
    const champ = pl[0]?.length === 1 ? ctx.player(pl[0][0])?.name : null;
    net.toAll(sim.snapshot());
    ctx.endGame(pl, { stats: st, title: champ ? `${champ} is the Prop Master!` : 'What a hide-and-seek!' });
  }
  if (net.isHost) sim = new HostSim(cfg());
  function becomeHost() {
    sim = HostSim.fromSnap(cfg(), lastSnap);
    if (ctx.started && sim.phase === 'wait') sim.go();
  }
  ctx.on('hostchange', ({ amHost }) => { if (amHost && !sim) becomeHost(); });
  ctx.on('join', (id) => { if (net.isHost && sim) net.to(id, sim.snapshot()); });
  ctx.on('go', () => { if (net.isHost && sim) sim.go(); });

  // ---------------------------------------------------------------- messages
  net.onMessage((m, from) => {
    switch (m.t) {
      case 'in': if (net.isHost && sim) sim.input(from, m); break;
      case 'act': if (net.isHost && sim && !(from === ctx.myId && api.autopilot)) sim.act(from, m.a); break;
      case 's': onSnap(m); break;
      case 'ev': onEvent(m); break;
    }
  });
  function onSnap(s) {
    lastSnap = s; api.stats.snaps++;
    if (s.r !== round) useRound(s.r);
    if (s.ph !== phase) onPhase(s.ph, phase);
    phase = s.ph; pt = s.pt; ft = s.ft; score = s.sc || score; stats = s.st || stats;
    const now = performance.now();
    for (const r of s.p) {
      const id = r[0];
      let v = view.get(id); if (!v) { v = { id }; view.set(id, v); applyRow(v, r); v.tx = v.x; v.ty = v.y; v.tz = v.z; }
      if (id === ctx.myId && me) {
        if (r[10] !== me.ep || api.autopilot) {   // host moved me (new round / correction) or a bot drives me
          me.ep = r[10]; me.x = r[1]; me.y = r[2]; me.z = r[3]; me.vx = me.vy = me.vz = 0; me.kind = r[6]; me.rot = r[7]; me.locked = !!(r[8] & 1); Object.assign(me, bodySize(me.kind));
          if (!api.autopilot) { gfx.cam.yaw = r[4]; gfx.cam.pitch = (r[8] & 4) ? 0 : -0.3; }
        }
        me.alive = !!(r[8] & 2); me.role = r[8] & 4 ? 'S' : 'H'; me.hp = r[9];
        continue;
      }
      v.px = v.x ?? r[1]; v.py = v.y ?? r[2]; v.pz = v.z ?? r[3];
      applyRow(v, r); v.tx = r[1]; v.ty = r[2]; v.tz = r[3]; v.x = v.px; v.y = v.py; v.z = v.pz;
      v.at = now; v.span = Math.max(40, Math.min(250, now - (v.lastAt || now - 83))); v.lastAt = now;
    }
  }
  function onPhase(ph, prev) {
    if (!me) return;
    if (ph === 'intro') {
      const seeker = levelFor(round) && plan[round].seekers.includes(ctx.myId);
      ui.banner(seeker ? '🔨 YOU ARE A SEEKER' : '🫖 YOU ARE A HIDER', 2600);
      ctx.setTimeout(() => ui.toast(seeker ? 'You will be blindfolded while they hide. Then bonk anything suspicious!' : 'Look at an object and press E to become it. Right click locks you in place.', 'gold', 4200), 900);
      sfx.roleStinger(seeker); sfx.music(true, 'calm');
      ui.toast(`Round ${round + 1}/${plan.length} · ${L.map.name}`, '', 2400);
    }
    if (ph === 'hide') { sfx.music(true, 'hide'); if (me.role === 'H') ui.banner('HIDE! 20 seconds', 1500); }
    if (ph === 'hunt') { sfx.music(true, 'calm'); ui.banner(me.role === 'S' ? '🔨 GO FIND THEM!' : '🙈 HERE THEY COME…', 1600); sfx.warn(); }
    if (ph === 'post' && prev === 'hunt') sfx.music(true, 'calm');
  }
  function onEvent(m) {
    const p = (id) => ctx.player(id), nm = (id) => p(id)?.name || '?';
    switch (m.e) {
      case 'poof': gfx.fx.poof(m.x, m.y, m.z); sfx.poof(m.x, m.y, m.z); if (m.id !== ctx.myId) gfx.fx.pop(m.id); break;
      case 'taunt': {
        api.stats.taunts++;
        sfx.taunt(tauntOf(m.id), m.x, m.y, m.z, m.forced ? 1.3 : 1);
        gfx.fx.notes(m.x, m.y, m.z, p(m.id)?.colorHex ?? 0xffffff, m.daring || m.forced);
        if (m.id === ctx.myId) { ui.toast(m.forced ? '📢 Forced taunt!' : m.daring ? `😈 DARING TAUNT! +${m.pts}` : `📢 Taunt +${m.pts}`, m.daring ? 'gold' : '', 1600); if (m.forced) lastTauntAt = clock; }
        break;
      }
      case 'fwarn': ui.banner(`📢 FORCED TAUNT IN ${m.in}`, 1800, { small: true }); sfx.warn(); break;
      case 'swing': if (m.id !== ctx.myId) gfx.fx.swing(m.id); break;
      case 'found': {
        api.stats.finds++;
        gfx.fx.stars(m.x, m.y, m.z, p(m.id)?.colorHex); gfx.fx.poof(m.x, m.y, m.z, 0xffffff, 10);
        sfx.squeak(m.x, m.y, m.z); sfx.found(m.id === ctx.myId, m.by === ctx.myId, m.x, m.y, m.z);
        const what = m.k >= 0 ? `the ${KINDS[m.k].name.toLowerCase()}` : 'in plain sight';
        if (m.id === ctx.myId) { ui.banner('🔨 BONK! FOUND!', 1800); gfx.fx.shake(0.8); ctx.setTimeout(() => ui.toast('You are out this round. Space / click = switch who you watch', '', 3500), 1500); }
        else if (m.by === ctx.myId) { ui.toast(`🔨 Found ${nm(m.id)} (${what})! +${R.FIND}`, 'good', 2200); gfx.fx.shake(0.4); }
        else ui.toast(`🔨 ${nm(m.by)} found ${nm(m.id)} ${m.k >= 0 ? 'hiding as ' + what : what}`, '', 2600);
        break;
      }
      case 'oops': {
        gfx.fx.oops(m.i); const dc = L?.decoys[m.i]; if (dc) sfx.squeak(dc.x, dc.y, dc.z);
        if (m.by === ctx.myId) { sfx.oops(true); ui.toast(`❌ Just a real ${KINDS[dc?.k ?? 0].name.toLowerCase()}! -${R.WRONG} ❤`, 'bad', 1500); gfx.fx.shake(0.3); vigT = 0.6; } else sfx.oops(false);
        break;
      }
      case 'faint': ui.toast(m.id === ctx.myId ? '😵 You bonked yourself silly. Out this round!' : `😵 ${nm(m.id)} fainted from wrong guesses!`, 'bad', 2600); sfx.faint(); gfx.fx.stars(m.x, m.y + 1, m.z, 0xffffff, 8); break;
      case 'sniff': if (m.id === ctx.myId) showSniff(m.d); break;
      case 'left': break;
      case 'roundEnd': {
        const mineWin = (m.winner === 'S') === (me?.role === 'S');
        const txt = m.winner === 'S' ? '🔨 SEEKERS FOUND EVERYONE!' : m.surv.length ? `🫖 ${m.surv.map(nm).join(', ')} stayed hidden!` : '🫖 HIDERS WIN!';
        ui.banner(txt, 3200, { small: txt.length > 22 }); if (me) sfx.roundEnd(mineWin);
        if (!m.last) ctx.setTimeout(() => ui.toast('Next round: roles swap!', 'gold', 2500), 3000);
        break;
      }
      case 'round': break;
      case 'phase': break;
    }
  }
  let vigT = 0, sniffT = 0;
  function showSniff(d) {
    const [txt, col] = d < 5 ? ['🔥 BURNING HOT!', '#ff4d5e'] : d < 10 ? ['♨️ Warm…', '#ff8c42'] : d < 18 ? ['🌬️ Cool', '#3ea6ff'] : ['🧊 Ice cold', '#8fd3ff'];
    sniffEl.textContent = '👃 ' + txt; sniffEl.style.background = col; sniffEl.classList.remove('hidden'); sniffT = R.SNIFF_T;
    sfx.sniff(d < 10);
  }

  // ---------------------------------------------------------------- host tick (60 Hz, also in background tabs)
  let snapAcc = 0, myBrainOn = false;
  ctx.tick((dt) => {
    if (!net.isHost || !sim) return;
    sim.timeScale = api.turbo || 1;
    if (api.autopilot && !myBrainOn && sim.players.has(ctx.myId)) { myBrainOn = true; sim.brains.set(ctx.myId, makeBrain(ctx.myId, sim, ctx.bots.level, ctx.bots.Brain)); }
    sim.step(dt);
    snapAcc += dt;
    if (snapAcc >= 1 / SNAP_HZ && !ended) { snapAcc = 0; net.toAll(sim.snapshot()); }
  });

  // ---------------------------------------------------------------- frame: local movement, camera, render, HUD
  let sendAcc = 0, predAcc = 0, stepSnd = 0, lastTick = -1;
  const canMove = () => me && me.alive && !api.autopilot && (phase === 'hunt' || (phase === 'hide' && me.role === 'H'));
  ctx.frame((dt, now) => {
    clock += dt;
    if (!L) { const k = Math.max(0, round); useRound(k); }
    const cam = gfx.cam;
    const fpMode = me && me.alive && me.role === 'S' && phase !== 'post' && !api.autopilot;
    // --- mouse look
    if (input.mouse.locked) {
      const d = input.takeMouseDelta(ctx.settings.get('sens') || 1);
      if (!(me && me.role === 'S' && phase === 'hide')) {
        cam.yaw -= d.x * 0.0028;
        cam.pitch = fpMode ? Math.max(-1.35, Math.min(1.35, cam.pitch - d.y * 0.0024)) : Math.max(-1.25, Math.min(0.55, cam.pitch - d.y * 0.0024));
      }
    }
    // --- my body (fixed steps)
    if (me && L) {
      if (canMove() && !me.locked) {
        const ax = input.axis();
        const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
        let mx = rx * ax.x + fx * -ax.y, mz = rz * ax.x + fz * -ax.y; const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
        const speed = R.SPEED[me.role] * (input.down('boost') ? R.SPRINT : 1);
        predAcc += dt; let k = 0;
        while (predAcc >= STEP && k < 8) {
          const land = stepBody(me, { mx, mz, speed, jump: myInput.j }, STEP, L); myInput.j = false;
          if (land > 6) sfx.step(me.x, me.y, me.z);
          predAcc -= STEP; k++;
        }
        if (k >= 8) predAcc = 0;
        if (Math.hypot(me.vx, me.vz) > 0.8 && me.gr) { stepSnd -= dt; if (stepSnd <= 0) { stepSnd = me.kind >= 0 ? 0.2 : 0.32; me.kind >= 0 ? sfx.hop(me.x, me.y, me.z, KINDS[me.kind].size[1]) : sfx.step(me.x, me.y, me.z); } }
      } else { predAcc = 0; myInput.j = false; me.vx = me.vz = 0; }
      if (me.role === 'S') { me.yaw = cam.yaw; me.pitch = cam.pitch; } else me.yaw = cam.yaw;
      sendAcc += dt;
      if (sendAcc >= 1 / SEND_HZ && !api.autopilot) { sendAcc = 0; net.toHost({ t: 'in', ep: me.ep, p: [+me.x.toFixed(3), +me.y.toFixed(3), +me.z.toFixed(3), +me.yaw.toFixed(3), +me.pitch.toFixed(3)] }); }
      // my own view entry
      let v = view.get(ctx.myId); if (!v) { v = { id: ctx.myId }; view.set(ctx.myId, v); }
      if (api.autopilot) { /* interpolated like others below */ }
      else Object.assign(v, { x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch, kind: me.kind, rot: me.rot, locked: me.locked, alive: me.alive, role: me.role, hp: me.hp ?? 100, moving: Math.hypot(me.vx, me.vz) > 0.4 ? 1 : 0 });
    }
    // --- others: interpolate between snapshots, hop sounds for moving objects
    for (const [id, v] of view) {
      if (id === ctx.myId && !api.autopilot && me) continue;
      if (v.tx == null || v.at == null) continue;
      const f = Math.min(1.25, (now - v.at) / v.span);
      v.x = v.px + (v.tx - v.px) * f; v.y = v.py + (v.ty - v.py) * f; v.z = v.pz + (v.tz - v.pz) * f;
      if (v.alive && v.moving && phase !== 'post') { v.snd = (v.snd || 0) - dt; if (v.snd <= 0) { v.snd = v.kind >= 0 && v.role === 'H' ? 0.22 : 0.34; if (v.kind >= 0 && v.role === 'H') sfx.hop(v.x, v.y, v.z, KINDS[v.kind].size[1]); else sfx.step(v.x, v.y, v.z); } }
    }
    // --- spectating / camera focus
    const alive = me && me.alive && phase !== 'post';
    let focusId = ctx.myId, mode = 'tp';
    if (fpMode) mode = 'fp';
    else if (!me || !me.alive || api.autopilot) {
      if (!spec || !view.get(spec)?.alive) spec = ids.find((id) => id !== ctx.myId && view.get(id)?.alive) || ids.find((id) => id !== ctx.myId);
      focusId = me && me.alive ? ctx.myId : spec;
      if (!input.mouse.locked) cam.yaw += dt * 0.25;
    }
    if (api.autopilot && me && me.role === 'S') { focusId = ctx.myId; }
    if (cam.intro > 0) cam.intro = Math.max(0, cam.intro - dt / (phase === 'intro' ? T.INTRO * 0.9 : 1.5));
    // --- what am I looking at (hider: copyable object; seeker: crosshair)
    highlight = -1; let hintTxt = '';
    if (alive && L && me.role === 'H' && (phase === 'hide' || phase === 'hunt') && !api.autopilot) {
      const { o, d } = gfx.centerRay();
      const pk = pickTarget(L, [], o, d, gfx.cam.dist + 5, ctx.myId);
      if (pk.tg && pk.tg.startsWith('d:')) {
        const dc = L.decoys[+pk.tg.slice(2)];
        if (Math.hypot(dc.x - me.x, dc.z - me.z) < 4.2 && dc.k !== me.kind) { highlight = dc.i; hintTxt = `<kbd>E</kbd> become ${KINDS[dc.k].icon} ${KINDS[dc.k].name}`; }
      }
      if (!hintTxt && me.kind >= 0 && !me.locked && phase === 'hunt' && Math.hypot(me.vx, me.vz) < 0.2) hintTxt = '<kbd>Right click</kbd> lock in place (stops the wobble)';
      if (!hintTxt && me.kind < 0) hintTxt = 'Look at an object nearby and press <kbd>E</kbd>';
    }
    if (fpMode && phase === 'hunt') {
      const { d } = gfx.centerRay();
      const pk = pickTarget(L, [...view.values()], [me.x, me.y + R.EYE, me.z], d, R.REACH, ctx.myId);
      cross.classList.toggle('hot', !!pk.tg);
    } else cross.classList.remove('hot');
    cross.classList.toggle('hidden', !(fpMode && phase === 'hunt') && !(alive && me.role === 'H' && (phase === 'hide' || phase === 'hunt')));
    if (!alive && me && phase !== 'post' && phase !== 'intro' && !api.autopilot) hintTxt = `Watching ${ui.esc(ctx.player(focusId)?.name || '…')} · <kbd>Space</kbd> switch`;
    if (hint.innerHTML !== hintTxt) hint.innerHTML = hintTxt;
    // --- blindfold
    const isBlind = me && me.role === 'S' && me.alive && phase === 'hide';
    blind.classList.toggle('hidden', !isBlind);
    if (isBlind) { const s = Math.ceil(pt); blind.firstChild.innerHTML = `🙈 ${s}<small>Blindfolded! Counting while they hide…</small>`; if (s !== lastTick && s <= 20) { lastTick = s; sfx.tick(s <= 3); } }
    // --- audio listener
    const lp = gfx.camera.position;
    sfx.setListener({ x: lp.x, z: lp.z, yaw: cam.yaw }, (x, y, z) => !!L && !lineOfSight(L, [lp.x, lp.y, lp.z], [x, y + 0.3, z]));
    if (phase === 'hunt' && pt < 30) sfx.music(true, 'tense');
    // --- render
    const viewerRole = ctx.spectator || !me || !me.alive ? 'spec' : me.role;
    gfx.update(dt, now, {
      players: view, me: ctx.myId, mode, focusId, highlight, phase, moving: me && Math.hypot(me.vx, me.vz) > 0.5,
      showTag: (id, p) => viewerRole === 'spec' || phase === 'post' || (viewerRole === 'H' && p.role === 'H') || (p.role === 'S' && !!L && lineOfSight(L, [lp.x, lp.y, lp.z], [p.x, p.y + 1.5, p.z])),
    });
    // --- HUD
    vigT = Math.max(0, vigT - dt); sniffT = Math.max(0, sniffT - dt);
    if (sniffT <= 0) sniffEl.classList.add('hidden');
    const lowHp = me && me.role === 'S' && me.alive && (me.hp ?? 100) <= 30;
    vig.style.boxShadow = `inset 0 0 120px 20px rgba(255,60,80,${(vigT * 0.9 + (lowHp ? 0.25 + Math.sin(now / 200) * 0.1 : 0)).toFixed(2)})`;
    const sc = ctx.spectator ? '👀 Spectating' : !me ? '' : me.role === 'S'
      ? (me.alive ? `🔨 SEEKER · ❤ ${me.hp ?? 100}` : '😵 Fainted · watching')
      : (me.alive ? `🫖 HIDER · ${me.kind >= 0 ? `${KINDS[me.kind].icon} ${KINDS[me.kind].name}${me.locked ? ' 🔒' : ''}` : 'not disguised!'}` : '💥 Found · watching');
    ui.status(`${sc}<div style="font-size:.8rem;opacity:.85">Round ${Math.max(1, round + 1)}/${plan.length}${L ? ' · ' + L.map.name : ''}${L && me ? ' · ' + (L.rooms[roomAt(L, me.x, me.z)]?.name || '') : ''}</div>`);
    if (phase === 'intro') ui.timer(null, { text: 'GET READY' });
    else if (phase === 'hide') ui.timer(pt, { warn: 5 });
    else if (phase === 'hunt') ui.timer(pt, { warn: 30 });
    else ui.timer(null);
    const order = standingsOf(ids, score).flat();
    ui.mini(order.map((id) => { const v = view.get(id); return { id, name: (v?.role === 'S' ? '🔨 ' : '🫖 ') + (ctx.player(id)?.name || id), color: ctx.player(id)?.color ?? 0, value: score[id] || 0, me: id === ctx.myId, out: v && !v.alive && phase !== 'post' }; }), `Round ${Math.max(1, round + 1)}/${plan.length}`);
    if (me && me.alive && phase !== 'post' && phase !== 'intro' && !(me.role === 'S' && phase === 'hide')) {
      if (me.role === 'H') {
        const tcd = Math.max(0, R.TAUNT_CD - (clock - lastTauntAt));
        ui.abilities([
          { key: 'E', label: 'Disguise', ready: highlight >= 0 },
          { key: 'Q', label: 'Rotate', ready: me.kind >= 0, dim: me.kind < 0 },
          { key: 'RMB', label: me.locked ? 'Unlock' : 'Lock', ready: me.kind >= 0, dim: me.kind < 0 },
          { key: 'F', label: 'Taunt', cd: tcd / R.TAUNT_CD, ready: tcd <= 0 && phase === 'hunt', wide: false },
        ]);
        ui.bar(ft >= 0 && ft < 20 ? 1 - ft / 20 : null, ft >= 0 && ft < 20 ? `📢 Forced taunt in ${Math.ceil(ft)} s` : '');
      } else {
        const bcd = Math.max(0, R.BONK_CD - (clock - lastBonk)), scd = Math.max(0, R.SNIFF_CD - (clock - sniffAt));
        ui.abilities([
          { key: 'Click', label: '🔨 Bonk', cd: bcd / R.BONK_CD, ready: bcd <= 0 && phase === 'hunt' },
          { key: 'Q', label: '👃 Sniff', cd: scd / R.SNIFF_CD, ready: scd <= 0 && phase === 'hunt' },
          { key: 'Shift', label: 'Sprint', ready: true },
        ]);
        ui.bar((me.hp ?? 100) / R.HP, `❤ ${me.hp ?? 100}`);
      }
    } else { ui.abilities([]); ui.bar(null); }
  });

  ui.setScoreboard(() => ({ columns: ['Player', 'Score', 'Found', 'Hidden', 'Taunts'], rows: standingsOf(ids, score).flat().map((id) => { const s = stats[id] || {}; return [ui.esc(ctx.player(id)?.name || id), score[id] || 0, s.finds || 0, `${Math.round(s.surv || 0)} s`, s.taunts || 0]; }) }));

  return {
    standings: () => (sim ? sim.standings() : standingsOf(ids, score)),
    stop() {
      sfx.dispose(); gfx.dispose(); levels.clear();
      if (window.__prophunt === api) delete window.__prophunt;
    },
  };
}
