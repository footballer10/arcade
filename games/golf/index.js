// Mini-Golf Battle — party hub plug-in. Everyone plays the same procedurally generated hole at the same time;
// balls collide. Host-authoritative physics (240 Hz) with client-side prediction; bots; power-ups.
// Net messages (ctx.net): client→host {t:'hi'} {t:'shot',a,p} {t:'use'};  host→all {t:'hole'} {t:'s'} {t:'ev'} {t:'holeEnd'}.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as C from './course.js';
import * as SFX from './sfx.js';
import * as G from './gfx.js';
export { manifest } from './manifest.js';

const STEP = 1 / 240;
const HOLE_END_SECS = 6;
const EFFECT_SECS = 12;
const PICKUP_RESPAWN = 12;

export async function start(ctx) {
  const { net, ui } = ctx;
  const $ = (id) => ctx.container.querySelector('#' + id);
  const esc = ui.esc;

  // ---------------------------------------------------------------- state
  const S = {
    isHost: net.isHost, myId: ctx.myId,
    players: ctx.players.map((p) => ({ id: p.id, name: p.name, bot: p.isBot, color: p.colorCss, scores: [], first: [], skill: Math.max(0.3, Math.min(1, ctx.bots.level.skill + (Math.random() - 0.5) * 0.25)) })),
    phase: 'waiting', holeIdx: 0, seed: ctx.seed >>> 0, holes: Math.max(1, Math.min(9, parseInt(ctx.options.holes) || 3)), hole: null, par: 3,
    sim: null,     // host: authoritative {balls, t, acc, timeLeft, first, endDelay, snapAcc, bot, pick}
    csim: null,    // client: predicted local copy {balls, t, acc}
    pick: [], timeLeft: C.HOLE_TIME, ht: 0,
    pred: { strokes: -1, until: 0 }, shotLock: 0, boardEndsAt: 0, ended: false,
  };
  const balls = () => S.isHost ? (S.sim ? S.sim.balls : new Map()) : (S.csim ? S.csim.balls : new Map());
  const myBall = () => balls().get(S.myId);
  const pname = (id) => S.players.find((p) => p.id === id)?.name ?? '?';
  const total = (p) => p.scores.reduce((a, s) => a + (s || 0), 0) - p.first.filter(Boolean).length;

  // ---------------------------------------------------------------- three.js setup
  const renderer = ctx.three.createRenderer();
  const q = ctx.quality();
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bfe1f7');
  scene.fog = new THREE.Fog('#cde6f5', 70, 230);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1200);
  camera.position.set(0, 8, 10);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.12;
  controls.minDistance = 2.5; controls.maxDistance = 45; controls.maxPolarAngle = Math.PI * 0.47;
  controls.rotateSpeed = ctx.settings.get('sens');
  scene.add(new THREE.HemisphereLight('#d8eeff', '#5b7a3a', 1.1));
  const sun = new THREE.DirectionalLight('#fff3dc', 2.6);
  sun.castShadow = q.shadows; sun.shadow.mapSize.set(q.shadowMap || 1024, q.shadowMap || 1024); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  G.initEnv(renderer);
  G.buildSky(scene);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), G.M.grass);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1.2; ground.receiveShadow = true; scene.add(ground);
  const fxp = new G.Particles(scene);
  const resize = () => { const w = ctx.container.clientWidth, h = ctx.container.clientHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
  ctx.on('resize', resize); resize();
  ctx.on('settings', (k) => { if (k === 'quality') ctx.three.applyQuality(renderer, sun); if (k === 'sens') controls.rotateSpeed = ctx.settings.get('sens'); });

  let course = null;
  let moverMeshes = [], pickupMeshes = [], rings = [];
  const ballMeshes = new Map();
  const aimGroup = new THREE.Group();
  const aimBar = new THREE.Group(); aimBar.material = new THREE.MeshBasicMaterial({ color: '#4ade80' });
  const aimDots = []; const dotGeo = new THREE.SphereGeometry(0.045, 10, 6);
  for (let i = 0; i < 18; i++) { const d = new THREE.Mesh(dotGeo, aimBar.material); aimDots.push(d); aimBar.add(d); }
  const aimHead = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.32, 14), aimBar.material);
  const pullLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
  aimHead.rotation.z = -Math.PI / 2;
  aimGroup.add(aimBar, aimHead); aimGroup.visible = false; pullLine.visible = false;
  scene.add(aimGroup, pullLine);

  // Game-specific panel inside the play area: the scorecard between holes.
  const card = ui.el('div', 'ph-panel', '');
  Object.assign(card.style, { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 5, display: 'none', maxWidth: '94vw' });
  ctx.container.appendChild(card);
  const cardCss = document.createElement('style');
  cardCss.textContent = `.golf-sb{border-collapse:separate;border-spacing:0;background:rgba(10,20,80,.35);border:3px solid var(--ink);border-radius:12px;overflow:hidden;margin:8px auto}
    .golf-sb th{background:var(--ink);padding:5px 8px;font-weight:400}.golf-sb td{padding:4px 8px;text-align:center;text-shadow:var(--stroke)}.golf-sb td.n{text-align:left;white-space:nowrap}
    .golf-sb tr.me td{background:rgba(255,210,63,.35)}.golf-sb .cur{background:rgba(255,210,63,.25)}.golf-sb .star{color:var(--yellow)}`;
  ctx.container.appendChild(cardCss);

  // ---------------------------------------------------------------- UI helpers
  const near = (x, z) => Math.max(0, Math.min(1, 1.25 - Math.hypot(x - controls.target.x, z - controls.target.z) / 22));
  function boardHTML(curIdx, played) {
    const ps = [...S.players].sort((a, b) => total(a) - total(b));
    let h = '<table class="golf-sb"><tr><th></th>';
    for (let i = 0; i < S.holes; i++) h += `<th class="${i === curIdx ? 'cur' : ''}">${i + 1}</th>`;
    h += '<th>Total</th></tr>';
    for (const p of ps) {
      h += `<tr class="${p.id === S.myId ? 'me' : ''}"><td class="n"><span class="ph-dot" style="background:${p.color}"></span> ${esc(p.name)}</td>`;
      for (let i = 0; i < S.holes; i++) {
        const s = i < played ? p.scores[i] : '';
        h += `<td class="${i === curIdx ? 'cur' : ''}">${s ?? ''}${i < played && p.first[i] ? '<span class="star">★</span>' : ''}</td>`;
      }
      h += `<td><b>${total(p)}</b></td></tr>`;
    }
    return h + '</table><div class="ph-sub" style="margin:0;font-size:.9rem">Fewest strokes wins · <span class="star">★</span> first to sink = −1 · unfinished = ' + C.MAX_STROKES + '</div>';
  }
  function showCard(on) {
    card.style.display = on ? '' : 'none';
    if (on) card.innerHTML = `<h2>Hole ${S.holeIdx + 1} complete</h2>${boardHTML(S.holeIdx, S.holeIdx + 1)}<div class="ph-sub" id="nextHole"></div>`;
  }
  ui.setScoreboard(() => boardHTML(S.holeIdx, S.phase === 'playing' ? S.holeIdx : S.holeIdx + 1));

  // ---------------------------------------------------------------- host game logic
  const pubPlayers = () => S.players.map(({ id, scores, first }) => ({ id, scores, first }));
  function mergePlayers(list) { for (const r of list || []) { const p = S.players.find((x) => x.id === r.id); if (p) { p.scores = r.scores; p.first = r.first; } } }
  // Pick a seed whose hole a bot can finish, and set par from bot test runs — in a Web Worker (prep-worker.js)
  // so the host never freezes. Results are cached per hole index.
  let worker = null, reqId = 0;
  const waiting = new Map(), prepCache = new Map();
  try {
    worker = new Worker(new URL('./prep-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const r = waiting.get(e.data.id); waiting.delete(e.data.id); r?.(e.data); };
  } catch { worker = null; }
  function prepSync(idx) {
    for (let k = 0; k < 4; k++) {
      const seed = (S.seed + idx * 1013 + k * 7919) >>> 0, hole = C.generateHole(seed, idx);
      const runs = [C.botRun(hole, 0.8), C.botRun(hole, 0.8)];
      if (runs.some((r) => r !== null) || k === 3) return { seed, par: Math.max(2, Math.min(6, Math.round(runs.reduce((a, r) => a + (r ?? C.MAX_STROKES), 0) / runs.length))) };
    }
  }
  function prepare(idx) {
    if (!prepCache.has(idx)) {
      const p = worker ? new Promise((res) => { const id = ++reqId; waiting.set(id, res); worker.postMessage({ id, seed: S.seed, idx }); }) : Promise.resolve(prepSync(idx));
      prepCache.set(idx, p.then(({ seed, par }) => { const hole = C.generateHole(seed, idx); hole.par = par; return { seed, hole, par }; }));
    }
    return prepCache.get(idx);
  }
  function holeMsg() { return { t: 'hole', seed: S.hole.seed, idx: S.holeIdx, holes: S.holes, par: S.hole.par, phase: S.phase, players: pubPlayers(), timeLeft: S.sim?.timeLeft ?? C.HOLE_TIME, ht: S.sim?.t ?? 0 }; }
  let starting = -1;
  async function startHole(idx) {
    if (starting === idx) return;
    starting = idx;
    const prep = await prepare(idx);
    if (S.ended || !S.isHost) return;
    const hole = prep.hole;
    const bs = new Map();
    S.players.forEach((p, i) => { const t = hole.tees[i % hole.tees.length]; const b = C.makeBall(p.id, t.x, t.z, t.y); if (p.gone) b.out = true; bs.set(p.id, b); });
    S.sim = { hole, balls: bs, t: 0, acc: 0, timeLeft: C.HOLE_TIME, first: null, endDelay: 0, snapAcc: 0, bot: new Map(), pick: hole.pickups.map(() => ({ on: true, t: 0 })) };
    S.players.forEach((p) => { if (p.bot) S.sim.bot.set(p.id, 1.5 + Math.random() * 2); });
    S.holeIdx = idx; S.hole = hole;
    if (S.phase !== 'waiting') S.phase = 'playing';
    net.toAll(holeMsg());
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
  function hostEvent(msg, s, b) { net.toAll({ t: 'ev', msg, s, x: b ? +b.x.toFixed(2) : 0, y: b ? +b.y.toFixed(2) : 0, z: b ? +b.z.toFixed(2) : 0 }); }
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
    if (!S.isHost || !S.sim || S.ended) return;
    const sim = S.sim;
    if (S.phase === 'playing') {
      sim.acc += dt;
      let n = 0;
      while (sim.acc >= STEP && n++ < 120) { sim.acc -= STEP; physicsStep(); }
      if (n >= 120) sim.acc = 0;
      sim.timeLeft = Math.max(0, sim.timeLeft - dt);
      const arr = [...sim.balls.values()];
      for (const b of arr) {
        if (b.big > 0 || b.sticky > 0) { b.big = Math.max(0, b.big - dt); b.sticky = Math.max(0, b.sticky - dt); C.applyEffects(b); }
        if (!b.sunk && !b.out && C.isResting(b) && b.strokes >= C.MAX_STROKES) { b.out = true; hostEvent(`${pname(b.id)} is out of strokes`); }
        if (b.sunk || b.out || b.item) continue;
        sim.hole.pickups.forEach((pk, i) => {
          const st = sim.pick[i];
          if (!st.on || Math.hypot(b.x - pk.x, b.z - pk.z) > 0.55 || Math.abs(b.y - pk.y) > 0.8 || b.item) return;
          st.on = false; st.t = PICKUP_RESPAWN;
          b.item = 1 + Math.floor(Math.random() * 3);
          hostEvent(`🎁 ${pname(b.id)} got ${C.ITEMS[b.item]}`, 'pickup', b);
        });
      }
      sim.pick.forEach((st) => { if (!st.on && (st.t -= dt) <= 0) st.on = true; });
      for (const p of S.players) {   // bots
        if (!p.bot) continue;
        const b = sim.balls.get(p.id); if (!b || b.sunk || b.out) continue;
        if (b.item === 3 && arr.some((o) => o !== b && !o.sunk && !o.out && Math.hypot(o.x - b.x, o.z - b.z) < 3.2)) useItem(p.id);
        if (!C.isResting(b)) { sim.bot.delete(p.id); continue; }
        if (!sim.bot.has(p.id)) sim.bot.set(p.id, 0.8 + Math.random() * 1.4);
        const w = sim.bot.get(p.id) - dt; sim.bot.set(p.id, w);
        if (w <= 0) {
          if (b.item === 1 || b.item === 2) useItem(p.id);
          const sh = C.planShot(sim.hole, b, sim.t + 0.05, p.skill); applyShot(p.id, sh.a, sh.p); sim.bot.delete(p.id);
        }
      }
      const allDone = arr.every((b) => b.sunk || b.out);
      if ((allDone || sim.timeLeft <= 0) && !sim.endDelay) { sim.endDelay = allDone ? 1.2 : 0.01; if (!allDone) hostEvent('⏰ Time up!'); }
      if (sim.endDelay) { sim.endDelay -= dt; if (sim.endDelay <= 0) endHole(); }
      sim.snapAcc += dt;
      if (sim.snapAcc >= 0.05) { sim.snapAcc = 0; net.toAll(snapshot(), false); }
    } else if (S.phase === 'holeEnd') {
      sim.phaseTimer -= dt;
      if (sim.phaseTimer <= 0) {
        if (S.holeIdx + 1 < S.holes) startHole(S.holeIdx + 1);
        else finishMatch();
      }
    }
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  function snapshot() {
    const sim = S.sim;
    return {
      t: 's', ht: r3(sim.t), tl: r3(sim.timeLeft), pk: sim.pick.map((p) => (p.on ? 1 : 0)),
      b: [...sim.balls.values()].map((b) => [b.id, r3(b.x), r3(b.y), r3(b.z), r3(b.vx), r3(b.vy), r3(b.vz),
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
    S.phase = 'holeEnd'; sim.phaseTimer = idx + 1 < S.holes ? HOLE_END_SECS : 2.5;
    net.toAll({ t: 'holeEnd', players: pubPlayers(), idx, last: idx + 1 >= S.holes });
    if (idx + 1 < S.holes) prepare(idx + 1);   // ready long before the scorecard closes
  }
  function standings() {
    const ps = [...S.players].map((p) => ({ id: p.id, t: total(p) + (S.phase === 'playing' ? (balls().get(p.id)?.strokes || 0) : 0) })).sort((a, b) => a.t - b.t);
    const groups = [];
    for (const p of ps) { const g = groups[groups.length - 1]; if (g && g.t === p.t) g.ids.push(p.id); else groups.push({ t: p.t, ids: [p.id] }); }
    return groups.map((g) => g.ids);
  }
  function finishMatch() {
    if (S.ended) return;
    S.ended = true; S.phase = 'matchEnd';
    const stats = Object.fromEntries(S.players.map((p) => [p.id, `${total(p)} strokes${p.first.filter(Boolean).length ? ' · ' + '★'.repeat(p.first.filter(Boolean).length) : ''}`]));
    ctx.endGame(standings(), { stats });
  }

  // ---------------------------------------------------------------- client prediction / reconciliation
  function onSnapshot(m) {
    if (!S.csim || !S.hole) return;
    const now = performance.now();
    S.ht = m.ht; S.timeLeft = m.tl; S.pick = m.pk || [];
    const lat = Math.min(0.25, net.ping() / 2000);
    const srv = m.b.map(([id, x, y, z, vx, vy, vz, f, strokes, item, big, sticky]) => {
      const b = { id, x, y, z, vx, vy, vz, sunk: !!(f & 1), ready: !!(f & 2), out: !!(f & 4), air: !!(f & 8), strokes, item, big, sticky };
      C.applyEffects(b); return b;
    });
    const fw = srv.map((b) => ({ ...b }));
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
        else if (ev) { b.hold = true; b.vx = b.vy = b.vz = 0; }
      }
      C.collideBalls(arr);
    }
  }

  // ---------------------------------------------------------------- messages
  function loadHole(m) {
    mergePlayers(m.players);
    S.holes = m.holes;
    const same = S.hole && S.hole.seed === m.seed && S.holeIdx === m.idx;
    S.holeIdx = m.idx;
    if (!S.isHost && !same) {
      S.hole = C.generateHole(m.seed, m.idx);
      const bs = new Map();
      S.players.forEach((p, i) => { const t = S.hole.tees[i % S.hole.tees.length]; bs.set(p.id, Object.assign(C.makeBall(p.id, t.x, t.z, t.y), { srvReady: true })); });
      S.csim = { balls: bs, t: m.ht || 0, acc: 0 };
    }
    S.hole.par = m.par;
    if (!S.isHost) { S.timeLeft = m.timeLeft ?? C.HOLE_TIME; if (m.phase === 'playing' || (ctx.started && m.phase !== 'holeEnd')) S.phase = 'playing'; }
    if (same) return;
    S.pick = S.hole.pickups.map(() => 1); S.pred = { strokes: -1, until: 0 };
    buildCourse(S.hole); resetCamera(); liveAt = 0;
    showCard(false);
    if (S.phase === 'playing' || ctx.started) ui.toast(`Hole ${m.idx + 1} of ${m.holes} — par ${m.par}`, 'good');
  }
  net.onMessage((m, from) => {
    if (!m || typeof m !== 'object') return;
    if (S.isHost) {
      if (m.t === 'hi' && S.hole) net.to(from, holeMsg());
      else if (m.t === 'shot') applyShot(from, +m.a, +m.p);
      else if (m.t === 'use') useItem(from);
      if (from !== S.myId) return;
    }
    switch (m.t) {
      case 'hole': loadHole(m); break;
      case 's': if (!S.isHost) onSnapshot(m); break;
      case 'ev':
        ui.toast(m.msg, m.s === 'cup' ? 'good' : m.s === 'splash' || m.s === 'fell' ? 'bad' : '', 2600);
        if (m.s) SFX.play(m.s, m.s === 'shock' || m.s === 'cup' ? Math.max(0.35, near(m.x, m.z)) : near(m.x, m.z));
        if (m.s === 'shock') { spawnRing(m.x, m.y, m.z); fxp.emit(m.x, m.y + 0.2, m.z, 50, ['#7dd3fc', '#e0f2fe', '#ffffff'], 7, 1.5, 0.6, 3); }
        if (m.s === 'splash') fxp.emit(m.x, m.y + 0.05, m.z, 45, ['#bfe6ff', '#ffffff', '#5fb4ff'], 1.8, 4, 0.9, 12);
        if (m.s === 'cup' && S.hole) fxp.emit(S.hole.cup.x, S.hole.cup.y + 0.2, S.hole.cup.z, 70, ['#ff5c5c', '#ffd43b', '#4dabff', '#2ee6a8', '#ff7ad9', '#ffffff'], 2.2, 5, 1.6, 7);
        if (m.s === 'pickup') fxp.emit(m.x, m.y + 0.4, m.z, 30, ['#ffd84a', '#fff3b0', '#f59e0b'], 2, 2.5, 0.8, 5);
        if (m.s === 'fell') fxp.emit(m.x, m.y + 0.1, m.z, 16, ['#8b6b4a', '#c9b08a'], 1.2, 1.5, 0.6, 6);
        break;
      case 'holeEnd':
        mergePlayers(m.players); S.phase = 'holeEnd'; aimCancel();
        if (!m.last) { showCard(true); S.boardEndsAt = performance.now() + HOLE_END_SECS * 1000; }
        if (m.last) ctx.audio.play('win');
        break;
    }
  });

  // ---------------------------------------------------------------- course rendering
  const sharedMats = G.SHARED;
  let flagMesh = null, turnRing = null, groundY = -1.2;
  function clearCourse() {
    if (course) {
      scene.remove(course);
      course.traverse((o) => {
        if (o.geometry && o.geometry !== ballGeo) o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) if (!sharedMats.has(m)) { if (m.map && (o.isSprite || m.map.isCanvasTexture)) m.map.dispose(); m.dispose(); }
      });
    }
    course = null; moverMeshes = []; pickupMeshes = []; ballMeshes.clear(); aimGroup.visible = false; pullLine.visible = false;
    rings.forEach((r) => { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); }); rings = []; flagMesh = null; turnRing = null;
  }
  function tileFloor(hole, t) {
    const N = 20, T = C.T, e = 1e-3, pos = [], uv = [], ok = [], idx = [];
    const d = t.d, px = -d[1], pz = d[0];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = t.cx - T / 2 + T * i / N, z = t.cz - T / 2 + T * j / N;
      const h = C.heightAt(hole, Math.min(t.cx + T / 2 - e, Math.max(t.cx - T / 2 + e, x)), Math.min(t.cz + T / 2 - e, Math.max(t.cz - T / 2 + e, z)));
      const cut = t.type === 'bank' && Math.hypot(x - t.ic[0], z - t.ic[1]) > T + 0.3;
      pos.push(x, h ?? 0, z); ok.push(h !== null && !cut);
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
  const ballGeo = new THREE.SphereGeometry(C.BALL_R, 32, 24);
  function buildCourse(hole) {
    clearCourse();
    course = new THREE.Group(); scene.add(course);
    const T = C.T, M = G.M;
    let gy = Math.min(...hole.tiles.map(t => Math.min(t.h0, t.h1))) - 0.45;
    for (const t of hole.tiles) if (t.type === 'jump') gy = Math.min(gy, t.h0 - 1.15);
    groundY = gy; ground.position.y = gy;
    const minX = Math.min(...hole.tiles.map(t => t.cx)) - T, maxX = Math.max(...hole.tiles.map(t => t.cx)) + T;
    const minZ = Math.min(...hole.tiles.map(t => t.cz)) - T, maxZ = Math.max(...hole.tiles.map(t => t.cz)) + T;
    const at = (t, a, l) => [t.cx + t.d[0] * a - t.d[1] * l, t.cz + t.d[1] * a + t.d[0] * l];

    for (const t of hole.tiles) {
      course.add(tileFloor(hole, t));
      // raised stone base under each tile (dark soil pit under jump gaps)
      const low = Math.min(t.h0, t.h1) - (t.type === 'jump' ? 1.1 : 0.02);
      if (low - gy > 0.01) {
        const base = G.box(T, low - gy, T, t.type === 'jump' ? M.pit : M.stone, { uvScale: 1.6 });
        base.position.set(t.cx, (low + gy) / 2, t.cz); base.castShadow = false; course.add(base);
      }
      if (t.type === 'jump') {
        // stone retaining walls under the jump tile + dark kicker face
        for (const s of [-1, 1]) {
          const lat = [-t.d[1] * s * (T / 2 - 0.05), t.d[0] * s * (T / 2 - 0.05)];
          const w = G.box(t.d[0] ? T : 0.1, t.h0 - gy, t.d[0] ? 0.1 : T, M.stone, { uvScale: 1.6 });
          w.position.set(t.cx + lat[0], (t.h0 + gy) / 2, t.cz + lat[1]); course.add(w);
        }
        const face = G.box(t.d[0] ? 0.06 : T, 1.6, t.d[0] ? T : 0.06, M.pit);
        const [fx, fz] = at(t, -T / 2 + 1.5, 0); face.position.set(fx, t.h0 - 0.55, fz); course.add(face);
        const lip = G.box(t.d[0] ? 0.12 : T - 0.3, 0.06, t.d[0] ? T - 0.3 : 0.12, M.wood, { round: 0.02 });
        lip.position.set(fx, t.h0 + 0.47, fz); course.add(lip);
      }
      if (t.type === 'tee') {
        const [mx, mz] = at(t, -1.1, 0);
        const mat = G.box(t.d[0] ? 1.7 : T * 0.86, 0.03, t.d[0] ? T * 0.86 : 1.7, M.rubber, { round: 0.012 });
        mat.position.set(mx, t.h0 + 0.012, mz); mat.castShadow = false; course.add(mat);
        for (const s of [-1, 1]) {
          const [kx, kz] = at(t, -0.15, s * 2.1);
          const mk = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10), s < 0 ? M.red : M.white);
          mk.position.set(kx, t.h0 + 0.09, kz); mk.castShadow = true; course.add(mk);
        }
      }
    }
    for (const w0 of hole.walls) {
      const w = { ...w0 };
      if (w.kind === 'border') {
        // rail hugs the turf on either side of it (physics walls are infinitely tall anyway)
        const along = w.hx > w.hz ? [1, 0] : [0, 1], nrm = [along[1], along[0]], L = Math.max(w.hx, w.hz);
        let lo = Infinity, hi = -Infinity;
        for (const a of [-0.45, 0, 0.45]) for (const n of [-0.35, 0.35]) {
          const h = C.heightAt(hole, w.x + along[0] * a * L * 2 + nrm[0] * n, w.z + along[1] * a * L * 2 + nrm[1] * n);
          if (h !== null) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
        }
        if (lo !== Infinity) { w.y0 = lo - 0.1; w.y1 = hi + 0.33; }
      }
      const ww = w.hx * 2, hh = w.y1 - w.y0, dd = w.hz * 2;
      const m = w.kind === 'tunnel' ? G.box(ww, hh, dd, M.stone, { uvScale: 1.2 })
        : G.box(ww, hh, dd, w.kind === 'inner' ? M.paint : M.wood, { round: 0.05 });
      m.position.set(w.x, (w.y0 + w.y1) / 2, w.z); course.add(m);
      if (w.kind === 'inner') { const cap = G.box(ww + 0.02, 0.05, dd + 0.02, M.red, { round: 0.02 }); cap.position.set(w.x, w.y1, w.z); course.add(cap); }
    }
    for (const o of hole.obbs) {
      const m = G.box(o.hx * 2, o.y1 - o.y0, o.hz * 2, M.wood, { round: 0.05 });
      m.position.set(o.x, (o.y0 + o.y1) / 2, o.z); m.rotation.y = -o.a; course.add(m);
    }
    for (const { t, y } of hole.tunnels) {
      const roof = G.box(t.d[0] ? 3.6 : 2.7, 0.06, t.d[0] ? 2.7 : 3.6, M.glass); roof.castShadow = false;
      roof.position.set(t.cx, y + 0.95, t.cz); course.add(roof);
      for (const s of [-1, 1]) {
        const arch = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.16, 10, 20, Math.PI), M.stone);
        const [ax, az] = at(t, s * 1.8, 0);
        arch.position.set(ax, y, az); arch.rotation.y = t.d[0] ? Math.PI / 2 : 0; arch.castShadow = true; course.add(arch);
      }
    }
    for (const w of hole.waters) {
      const m = G.box(w.hx * 2, 0.02, w.hz * 2, M.water); m.castShadow = false; m.receiveShadow = false; m.position.set(w.x, w.y + 0.02, w.z); course.add(m);
      const rim = 0.09;
      for (const [rx, rz, rw, rd] of [[w.x, w.z - w.hz - rim / 2, w.hx * 2 + rim * 2, rim], [w.x, w.z + w.hz + rim / 2, w.hx * 2 + rim * 2, rim], [w.x - w.hx - rim / 2, w.z, rim, w.hz * 2], [w.x + w.hx + rim / 2, w.z, rim, w.hz * 2]]) {
        const rt = C.tileAt(hole, rx, rz); if (!rt || Math.abs(rx - rt.cx) > T / 2 - 0.15 || Math.abs(rz - rt.cz) > T / 2 - 0.15) continue;
        const r = G.box(rw, 0.06, rd, M.stone, { uvScale: 0.6 }); r.position.set(rx, w.y + 0.03, rz); r.castShadow = false; course.add(r);
      }
    }
    for (const b of hole.bumpers) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 0.38, 32), [M.bumperSide, M.bumperTop, M.bumperTop]);
      m.castShadow = true; m.receiveShadow = true; m.position.set(b.x, b.y + 0.19, b.z); course.add(m);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(b.r, 0.035, 8, 32), M.red); ring.rotation.x = Math.PI / 2; ring.position.set(b.x, b.y + 0.38, b.z); course.add(ring);
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
      const m = G.box(0.4, 0.4, 0.4, M.crate, { round: 0.05 }); m.position.set(pk.x, pk.y + 0.45, pk.z);
      const q = G.glowSprite(); q.position.set(pk.x, pk.y + 0.45, pk.z);
      course.add(m, q); pickupMeshes.push({ m, q, pk });
    }
    const cup = hole.cup;
    const hole3 = new THREE.Mesh(new THREE.CircleGeometry(C.CUP_R, 32), M.cup);
    hole3.rotation.x = -Math.PI / 2; hole3.position.set(cup.x, cup.y + 0.005, cup.z); course.add(hole3);
    const rimC = new THREE.Mesh(new THREE.TorusGeometry(C.CUP_R + 0.012, 0.016, 8, 40), M.white);
    rimC.rotation.x = Math.PI / 2; rimC.position.set(cup.x, cup.y + 0.008, cup.z); course.add(rimC);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.75, 10), M.white); pole.castShadow = true;
    pole.position.set(cup.x, cup.y + 0.875, cup.z); course.add(pole);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), M.red); knob.position.set(cup.x, cup.y + 1.77, cup.z); course.add(knob);
    flagMesh = G.makeFlag((hole.idx ?? 0) + 1); flagMesh.position.set(cup.x + 0.02, cup.y + 1.72, cup.z); course.add(flagMesh);
    turnRing = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.36, 40), new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.9, depthWrite: false }));
    turnRing.rotation.x = -Math.PI / 2; turnRing.visible = false; course.add(turnRing);
    for (const p of S.players) {
      const ball = new THREE.Mesh(ballGeo, G.ballMaterial(p.color)); ball.castShadow = true;
      const label = G.makeLabel(p.id === S.myId ? 'You' : p.name, p.color);
      course.add(ball, label); ballMeshes.set(p.id, { ball, label });
    }
    course.add(G.buildScenery(hole, gy));
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, ext = Math.max(maxX - minX, maxZ - minZ) / 2 + 3;
    sun.position.set(cx + 18, 34, cz + 12); sun.target.position.set(cx, 0, cz);
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 100 });
    sun.shadow.camera.updateProjectionMatrix();
  }


  function spawnRing(x, y, z) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.9 }));
    m.rotation.x = Math.PI / 2; m.position.set(x, y + 0.2, z); scene.add(m); rings.push({ m, t: 0 });
  }
  function focusBall() {
    const b = myBall();
    if (b && !b.out) return b;
    // spectators (or finished players) follow whoever is still playing
    return [...balls().values()].find((x) => !x.sunk && !x.out) || b || [...balls().values()][0];
  }
  function resetCamera() {
    const b = focusBall(); if (!b || !S.hole) return;
    const t0 = S.hole.tiles[0];
    controls.target.set(b.x, b.y + b.r, b.z);
    camera.position.set(b.x - t0.d[0] * 7, b.y + 5.5, b.z - t0.d[1] * 7);
    controls.update();
  }

  // ---------------------------------------------------------------- input: aiming (left drag), item (E), recenter (Space)
  const aim = { on: false, a: 0, p: 0, hit: new THREE.Vector3() };
  const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2(); const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function canShoot() {
    const b = myBall(); if (S.phase !== 'playing' || !ctx.started || !b || b.sunk || b.out || !C.isResting(b)) return false;
    if (performance.now() < S.shotLock) return false;
    if (S.isHost) return true;
    return b.srvReady && !(performance.now() < S.pred.until && b.srvStrokes < S.pred.strokes);
  }
  function updateAim(e) {
    const b = myBall(); if (!b) return;
    const y = b.y + b.r, r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera); plane.constant = -y;
    if (!raycaster.ray.intersectPlane(plane, aim.hit)) return;
    const dx = b.x - aim.hit.x, dz = b.z - aim.hit.z, len = Math.hypot(dx, dz);
    aim.p = Math.min(1, len / 3.5); aim.a = Math.atan2(dz, dx);
  }
  function aimCancel() { aim.on = false; aimGroup.visible = false; pullLine.visible = false; }
  function shoot(a, p) {
    S.shotLock = performance.now() + 250;
    if (S.isHost) { applyShot(S.myId, a, p); return; }
    const b = myBall();   // client: predict the shot locally right away, host confirms
    b.lastX = b.x; b.lastY = b.y; b.lastZ = b.z; b.strokes = (b.srvStrokes ?? b.strokes) + 1;
    b.vx = Math.cos(a) * p * C.MAX_SPEED; b.vz = Math.sin(a) * p * C.MAX_SPEED;
    S.pred = { strokes: b.strokes, until: performance.now() + 900 + net.ping() * 2 };
    SFX.play('putt', 0.5 + p * 0.5);
    net.toHost({ t: 'shot', a, p });
  }
  function useMyItem() {
    const b = myBall(); if (!b || !b.item || S.phase !== 'playing') return;
    net.toHost({ t: 'use' });
  }
  ctx.listen(renderer.domElement, 'pointerdown', (e) => {
    if (!ctx.input.enabled) return;
    if (e.button === 2 && aim.on) { aimCancel(); return; }
    if (e.button !== 0 || !canShoot()) return;
    aim.on = true; updateAim(e);
  });
  ctx.listen(window, 'pointermove', (e) => { if (aim.on) updateAim(e); });
  ctx.listen(window, 'pointerup', (e) => {
    if (e.button !== 0 || !aim.on) return;
    updateAim(e); const { a, p } = aim; aimCancel();
    if (p < 0.03 || !canShoot() || !ctx.input.enabled) return;
    shoot(a, p);
  });
  ctx.input.on('press', (a) => {
    if (a === 'use') useMyItem();
    else if (a === 'jump' && S.phase === 'playing') resetCamera();
  });
  ctx.input.on('release', () => { if (!ctx.input.enabled) aimCancel(); });

  // ---------------------------------------------------------------- host migration, late joiners, leavers
  function becomeHost() {
    S.isHost = true;
    if (!S.hole) { startHole(S.holeIdx); return; }
    // continue the hole from our predicted copy of the balls
    const bs = new Map();
    for (const p of S.players) {
      const c = S.csim?.balls.get(p.id);
      const b = c ? Object.assign(C.makeBall(p.id, c.x, c.z, c.y), { vx: c.vx, vy: c.vy, vz: c.vz, strokes: c.strokes, item: c.item || 0, big: c.big || 0, sticky: c.sticky || 0, sunk: !!c.sunk, out: !!c.out || !ctx.connected(p.id), air: !!c.air })
        : Object.assign(C.makeBall(p.id, S.hole.tees[0].x, S.hole.tees[0].z, S.hole.tees[0].y), { out: true });
      b.lastX = b.x; b.lastY = b.y; b.lastZ = b.z; C.applyEffects(b);
      bs.set(p.id, b);
    }
    S.sim = { hole: S.hole, balls: bs, t: S.csim?.t || 0, acc: 0, timeLeft: S.timeLeft, first: null, endDelay: 0, snapAcc: 0, bot: new Map(), pick: S.hole.pickups.map((_, i) => ({ on: S.pick[i] !== 0, t: PICKUP_RESPAWN })), phaseTimer: Math.max(1, (S.boardEndsAt - performance.now()) / 1000) };
    S.csim = null;
    if (S.phase === 'holeEnd' && S.holeIdx + 1 >= S.holes) finishMatch();
    net.toAll(holeMsg());
  }
  ctx.on('hostchange', ({ amHost }) => { if (amHost && !S.isHost) becomeHost(); });
  ctx.on('join', (id) => { if (S.isHost && S.hole) net.to(id, holeMsg()); });
  ctx.on('leave', (id) => { const p = S.players.find((x) => x.id === id); if (!p) return; p.gone = true; if (S.sim) { const b = S.sim.balls.get(id); if (b) b.out = true; } });
  ctx.on('go', () => {
    if (S.isHost) { S.phase = 'playing'; if (S.sim) { S.sim.timeLeft = C.HOLE_TIME; net.toAll(holeMsg()); } }
    else if (S.phase === 'waiting') S.phase = 'playing';
    ui.toast(`Hole 1 of ${S.holes} — par ${S.hole?.par ?? '?'}`, 'good');
  });

  // Host builds hole 1 now (during the loading screen); clients ask for it.
  if (S.isHost) startHole(0);
  else net.toHost({ t: 'hi' });

  // ---------------------------------------------------------------- loops
  ctx.tick((dt) => { try { hostTick(dt); } catch (e) { console.error(e); } });
  let lastSec = 0, liveAt = 0;
  ctx.frame((dt, now) => {
    const tsec = now / 1000;
    G.animate(tsec); fxp.update(dt);
    if (flagMesh) flagMesh.userData.wave(tsec);
    if (S.hole) {
      if (S.isHost && S.sim) { S.timeLeft = S.sim.timeLeft; S.ht = S.sim.t; S.pick = S.sim.pick.map((p) => (p.on ? 1 : 0)); }
      else { clientStep(dt); if (S.phase === 'playing' && ctx.started) S.timeLeft = Math.max(0, S.timeLeft - dt); }
      const ht = S.isHost ? S.ht : (S.csim ? S.csim.t : 0);
      for (const { mv, g } of moverMeshes) { const p = C.moverPose(mv, ht); g.position.x = p.x; g.position.z = p.z; g.rotation.y = -p.a; }
      pickupMeshes.forEach(({ m, q: qq, pk }, i) => { const on = !!S.pick[i]; m.visible = qq.visible = on; m.rotation.y += dt * 1.5; m.position.y = qq.position.y = pk.y + 0.45 + Math.sin(tsec * 2.5 + i) * 0.08; });
      const bs = balls();
      for (const [id, { ball, label }] of ballMeshes) {
        const b = bs.get(id);
        const vis = !!b && !b.sunk && !(S.players.find((p) => p.id === id)?.gone);
        ball.visible = vis; label.visible = vis;
        if (!b) continue;
        const sc = b.r / C.BALL_R;
        ball.scale.setScalar(sc); ball.position.set(b.x, b.y + b.r, b.z); label.position.set(b.x, b.y + b.r + 0.4, b.z);
        ball.material.emissive.set(b.sticky > 0 ? '#2f7a00' : '#000000');
        ball.rotation.x += b.vz * dt / b.r; ball.rotation.z -= b.vx * dt / b.r;
        if (b.fx === 'land' && b.fxv > 3) fxp.emit(b.x, b.y + 0.05, b.z, 10, ['#d9c9a3', '#bfae86', '#ffffff'], 1.5, 1.2, 0.5, 6);
        if (b.fx === 'putt') fxp.emit(b.x, b.y + 0.05, b.z, 6, ['#ffffff', '#c8f5c8'], 0.8, 0.8, 0.35, 4);
        if (b.fx) { SFX.play(b.fx, Math.min(1, b.fxv / 8) * near(b.x, b.z), id); b.fx = null; b.fxv = 0; }
      }
      for (const r of rings) { r.t += dt; r.m.scale.setScalar(1 + r.t * 10); r.m.material.opacity = Math.max(0, 0.9 - r.t * 1.8); }
      rings = rings.filter((r) => { if (r.t > 0.5) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); return false; } return true; });
      const mb = myBall(), fb = focusBall();
      if (fb) {
        const tgt = new THREE.Vector3(fb.sunk ? S.hole.cup.x : fb.x, (fb.sunk ? S.hole.cup.y : fb.y) + fb.r, fb.sunk ? S.hole.cup.z : fb.z);
        const d = tgt.sub(controls.target).multiplyScalar(Math.min(1, dt * 6));
        controls.target.add(d); camera.position.add(d);
      }
      if (turnRing) {
        const ready = mb && canShoot();
        turnRing.visible = !!ready;
        if (ready) { turnRing.position.set(mb.x, mb.y + 0.012, mb.z); turnRing.scale.setScalar(mb.r / C.BALL_R * (1 + Math.sin(tsec * 5) * 0.12)); }
      }
      if (aim.on && mb) {
        const y = mb.y + mb.r, L = 0.5 + aim.p * 4.5;
        aimBar.material.color.setHSL((1 - aim.p) * 0.33, 0.9, 0.5);
        aimGroup.visible = true; aimGroup.position.set(mb.x, y, mb.z); aimGroup.rotation.y = -aim.a;
        aimDots.forEach((d, i) => { const x = 0.3 + i * 0.3; d.visible = x < L; d.position.set(x, 0, 0); d.scale.setScalar(1 - 0.35 * x / 5.5); });
        aimHead.position.x = L + 0.2;
        pullLine.visible = true;
        pullLine.geometry.setFromPoints([new THREE.Vector3(mb.x, y, mb.z), new THREE.Vector3(aim.hit.x, y, aim.hit.z)]);
      }
      const sec = Math.ceil(S.timeLeft);
      if (S.phase === 'playing' && ctx.started && sec !== lastSec && sec <= 5 && sec > 0) SFX.play('tick');
      lastSec = sec;
      updateHud(mb);
    }
    controls.update();
    renderer.render(scene, camera);
  });

  // ---------------------------------------------------------------- HUD (shared zones)
  function updateHud(mb) {
    ui.status(`⛳ Hole ${S.holeIdx + 1}/${S.holes} · Par ${S.hole.par}<br><small>${ctx.spectator ? '👀 Spectating' : `Strokes ${mb ? mb.strokes : 0} / ${C.MAX_STROKES}`}</small>`);
    ui.timer(S.phase === 'playing' && ctx.started ? S.timeLeft : null, { warn: 10 });
    const hint = S.phase !== 'playing' || !ctx.started || !mb ? '' : mb.sunk ? 'Sunk! Watch the others…' : mb.out ? 'Out of strokes' :
      aim.on ? 'Release to shoot · right-click to cancel' : canShoot() ? 'Your shot! Drag back from your ball' : 'Ball rolling…';
    ui.bar(aim.on ? aim.p : (S.phase === 'playing' ? 0 : null), hint);
    const slots = [];
    if (mb && (mb.item || mb.big > 0 || mb.sticky > 0)) slots.push({ key: 'E', label: (mb.item ? C.ITEMS[mb.item] : '') + (mb.big > 0 ? ` BIG ${Math.ceil(mb.big)}s` : '') + (mb.sticky > 0 ? ` STICKY ${Math.ceil(mb.sticky)}s` : ''), ready: !!mb.item, wide: true });
    else slots.push({ key: 'E', label: 'No power-up', dim: true, wide: true });
    ui.abilities(slots);
    if (S.phase === 'holeEnd' && S.boardEndsAt) { const n = card.querySelector('#nextHole'); if (n) n.textContent = `Next hole in ${Math.max(0, Math.ceil((S.boardEndsAt - performance.now()) / 1000))}…`; }
    if (!liveAt || performance.now() - liveAt > 200) {
      liveAt = performance.now();
      const bs = balls();
      ui.mini(S.players.map((p) => {
        const b = bs.get(p.id);
        const st = !b ? '' : b.sunk ? `${b.strokes} ✓` : b.out ? `${b.strokes} ✗` : b.strokes;
        const fx = !b ? '' : (b.big > 0 ? ' 🔴' : '') + (b.sticky > 0 ? ' 🟢' : '') + (b.item ? ' 🎁' : '');
        return { id: p.id, name: p.name + fx, color: p.color, value: st, me: p.id === S.myId, out: p.gone };
      }), `Hole ${S.holeIdx + 1} strokes`);
    }
  }

  window.__golf = { S, C, applyShot, useItem, balls, canShoot, shoot, camera, renderer };
  return {
    standings,
    stop() {
      clearCourse();
      controls.dispose();
      worker?.terminate();
      ctx.three.dispose(scene, G.SHARED);
      ballGeo.dispose(); dotGeo.dispose();
      delete window.__golf;
    },
  };
}
