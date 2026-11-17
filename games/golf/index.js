// Mini-Golf Battle — party hub plug-in. Everyone plays the same procedurally generated hole at the same time;
// balls collide. Host-authoritative physics (240 Hz) with client-side prediction; bots; 9 power-ups; KOs;
// themed worlds; hole modifiers; Classic and Speed Golf modes; emotes; flyover intros; podium.
// Net (ctx.net): client→host {t:'hi'} {t:'shot',a,p} {t:'use'} {t:'emote',i}
//                host→all  {t:'hole'} {t:'s'} {t:'ev'} {t:'emoted'} {t:'holeEnd'} {t:'matchEnd'}
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './tuning.js';
import * as C from './course.js';
import * as SFX from './sfx.js';
import * as G from './gfx.js';
export { manifest } from './manifest.js';

const EMOTES = ['😂', '😡', '👏 Nice!', '😱 Oops!'];
const PLACE_PTS = [10, 7, 5, 4, 3, 2, 1, 1];
const STEP = 1 / 240, HOLE_END_SECS = 6, INTRO_SECS = 3.0, PODIUM_SECS = 4.5;
const ITEM_RESPAWN = { normal: 12, chaos: 4 };
const BOT_SKILL = { easy: [0.2, 0.45], normal: [0.55, 0.9], hard: [0.92, 1] };
const CSS = `
.golf-sb{border-collapse:separate;border-spacing:0;background:rgba(10,20,80,.35);border:3px solid var(--ink);border-radius:12px;overflow:hidden;margin:8px auto}
.golf-sb th{background:var(--ink);padding:5px 8px;font-weight:400}.golf-sb td{padding:4px 8px;text-align:center;text-shadow:var(--stroke)}.golf-sb td.n{text-align:left;white-space:nowrap}
.golf-sb tr.me td{background:rgba(255,210,63,.35)}.golf-sb .cur{background:rgba(255,210,63,.25)}.golf-sb .star{color:var(--yellow);font-size:.85em}
.golf-intro{position:absolute;left:50%;top:26%;transform:translate(-50%,-50%);text-align:center;color:#fff;text-shadow:var(--stroke),0 6px 0 var(--ink);animation:golfIntro 3s forwards;white-space:nowrap;pointer-events:none}
.golf-intro .h{font-size:4.5rem;line-height:1}.golf-intro .s{font-size:1.5rem}.golf-intro .m{font-size:1.7rem;color:var(--yellow);margin-top:6px}
@keyframes golfIntro{0%{opacity:0;transform:translate(-50%,-50%) scale(.7)}12%{opacity:1;transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-60%) scale(1)}}
.golf-emotes{position:absolute;left:14px;bottom:20px;display:flex;gap:6px}
.golf-emotes button{font-size:1.2rem;padding:4px 9px}`;

export async function start(ctx) {
  const { net, ui } = ctx;
  const esc = ui.esc;
  const o = ctx.options;
  // ---------------------------------------------------------------- state
  const S = {
    isHost: net.isHost, myId: ctx.myId,
    opts: { mode: o.mode === 'speed' ? 'speed' : 'classic', holes: Math.max(1, Math.min(9, parseInt(o.holes) || 3)), time: parseInt(o.time) || 60, items: ['normal', 'chaos', 'off'].includes(o.items) ? o.items : 'normal', mods: o.mods !== 'off', bots: ctx.bots.level.key },
    players: ctx.players.map((p) => { const [a, b] = BOT_SKILL[ctx.bots.level.key] || BOT_SKILL.normal; return { id: p.id, name: p.name, bot: p.isBot, color: p.colorCss, scores: [], bonus: [], tags: [], stats: { ko: 0, splash: 0, ace: 0, first: 0, items: 0 }, skill: a + Math.random() * (b - a) }; }),
    phase: 'waiting', holeIdx: 0, seed: ctx.seed >>> 0, hole: null,
    sim: null, csim: null, pick: [], mines: [], awards: [], timeLeft: 60, ht: 0,
    pred: { strokes: -1, until: 0 }, shotLock: 0, introUntil: 0, introFrom: null, introArm: false,
    boardEndsAt: 0, themeOrder: [0, 1, 2, 3, 4], spec: null, podium: null, ended: false,
  };
  S.timeLeft = S.opts.time;
  { const R = C.rng(S.seed ^ 0x51ed); for (let i = 4; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [S.themeOrder[i], S.themeOrder[j]] = [S.themeOrder[j], S.themeOrder[i]]; } }
  const balls = () => S.isHost ? (S.sim ? S.sim.balls : new Map()) : (S.csim ? S.csim.balls : new Map());
  const myBall = () => balls().get(S.myId);
  const speedMode = () => S.opts.mode === 'speed';
  const pname = (id) => S.players.find((p) => p.id === id)?.name ?? '?';
  const sum = (a) => (a || []).reduce((x, y) => x + (y || 0), 0);
  const total = (p) => (speedMode() ? sum(p.scores) + sum(p.bonus) : sum(p.scores) - sum(p.bonus));
  const ranked = () => [...S.players].sort((a, b) => (speedMode() ? total(b) - total(a) : total(a) - total(b)));

  // ---------------------------------------------------------------- three.js setup
  const style = document.createElement('style'); style.textContent = CSS; ctx.container.appendChild(style);
  const renderer = ctx.three.createRenderer({ antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
  const hemi = new THREE.HemisphereLight('#d8eeff', '#5b7a3a', 1.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3dc', 2.6);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
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
  const W = () => ctx.container.clientWidth, H = () => ctx.container.clientHeight;
  function applyQuality() {
    const q = ctx.quality();
    renderer.shadowMap.enabled = q.shadows; sun.castShadow = q.shadows;
    sun.shadow.mapSize.set(q.shadowMap || 1024, q.shadowMap || 1024); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.pixelRatio));
    renderer.setSize(W(), H()); if (post) post.setSize(W(), H());
    scene.traverse((ob) => { if (ob.material) (Array.isArray(ob.material) ? ob.material : [ob.material]).forEach((m) => { m.needsUpdate = true; }); });
  }
  const resize = () => { camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H()); if (post) post.setSize(W(), H()); };
  ctx.on('resize', resize);
  ctx.on('settings', (k) => { if (k === 'quality') applyQuality(); if (k === 'sens') controls.rotateSpeed = ctx.settings.get('sens'); });
  applyQuality(); resize();

  let course = null;
  let moverMeshes = [], pickupMeshes = [], rings = [], mineMeshes = [], portalMeshes = [], bubbles = [];
  const ballMeshes = new Map();
  const aimGroup = new THREE.Group();
  const aimMat = new THREE.MeshBasicMaterial({ color: '#4ade80' });
  const aimDots = []; const dotGeo = new THREE.SphereGeometry(0.05, 10, 6);
  for (let i = 0; i < 26; i++) { const d = new THREE.Mesh(dotGeo, aimMat); d.visible = false; aimDots.push(d); aimGroup.add(d); }
  const pullLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
  aimGroup.visible = false; pullLine.visible = false;
  scene.add(aimGroup, pullLine);

  // play-area panels: hole intro, between-hole scorecard, emote buttons
  const intro = ui.el('div', 'golf-intro hidden', '<div class="h"></div><div class="s"></div><div class="m"></div>'); ctx.container.appendChild(intro);
  const card = ui.el('div', 'ph-panel'); Object.assign(card.style, { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 5, display: 'none', maxWidth: '94vw' });
  ctx.container.appendChild(card);
  const emoteBar = ui.el('div', 'golf-emotes', EMOTES.map((e, i) => `<button class="ph-btn small" data-e="${i}">${e.split(' ')[0]}</button>`).join(''));
  if (!ctx.spectator) ctx.container.appendChild(emoteBar);
  ctx.listen(emoteBar, 'click', (e) => { const b = e.target.closest('[data-e]'); if (b) emote(+b.dataset.e); });

  // ---------------------------------------------------------------- UI helpers
  const near = (x, z) => Math.max(0, Math.min(1, 1.25 - Math.hypot(x - controls.target.x, z - controls.target.z) / 22));
  function boardHTML(curIdx, played) {
    const ps = ranked(), n = S.opts.holes;
    let h = '<table class="golf-sb"><tr><th></th>';
    for (let i = 0; i < n; i++) h += `<th class="${i === curIdx ? 'cur' : ''}">${i + 1}</th>`;
    h += '<th>Total</th></tr>';
    for (const p of ps) {
      h += `<tr class="${p.id === S.myId ? 'me' : ''}"><td class="n"><span class="ph-dot" style="background:${p.color}"></span> ${esc(p.name)}</td>`;
      for (let i = 0; i < n; i++) h += `<td class="${i === curIdx ? 'cur' : ''}">${i < played ? (p.scores[i] ?? '') : ''}${i < played && p.tags[i] ? `<span class="star">${p.tags[i]}</span>` : ''}</td>`;
      h += `<td><b>${total(p)}</b></td></tr>`;
    }
    return h + '</table><div class="ph-sub" style="margin:0;font-size:.9rem">' + (speedMode()
      ? 'Speed Golf: points for finishing order (10·7·5·4…) · 💥 KO +2 · 🎯 hole-in-one +3'
      : `Fewest strokes wins · ★ first to sink −1 · 💥 KO −1 · 🎯 hole-in-one −1 · unfinished = ${C.MAX_STROKES}`) + '</div>';
  }
  function showCard(on) {
    card.style.display = on ? '' : 'none';
    if (on) card.innerHTML = `<h2>Hole ${S.holeIdx + 1} complete</h2>${boardHTML(S.holeIdx, S.holeIdx + 1)}<div class="ph-sub" data-next></div>`;
  }
  ui.setScoreboard(() => boardHTML(S.holeIdx, S.phase === 'playing' ? S.holeIdx : S.holeIdx + 1));
  function showIntro(hole) {
    const th = G.THEMES[hole.themeIdx], mod = C.MODS[hole.mod].name;
    intro.children[0].textContent = `Hole ${hole.idx + 1}`;
    intro.children[1].textContent = `Par ${hole.par} · ${th.name}`;
    intro.children[2].textContent = mod ? `⚡ ${mod}` : '';
    intro.classList.remove('hidden'); intro.style.animation = 'none'; void intro.offsetWidth; intro.style.animation = '';
    ctx.setTimeout(() => intro.classList.add('hidden'), INTRO_SECS * 1000);
  }

  // ---------------------------------------------------------------- host game logic
  const pubPlayers = () => S.players.map(({ id, scores, bonus, tags }) => ({ id, scores, bonus, tags }));
  function mergePlayers(list) { for (const r of list || []) { const p = S.players.find((x) => x.id === r.id); if (p) Object.assign(p, { scores: r.scores, bonus: r.bonus, tags: r.tags }); } }
  // Hole prep (bot test runs set par) runs in a Web Worker so the host never freezes. Cached per hole.
  let worker = null, reqId = 0;
  const waiting = new Map(), prepCache = new Map();
  try {
    worker = new Worker(new URL('./prep-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const r = waiting.get(e.data.id); waiting.delete(e.data.id); r?.(e.data); };
  } catch { worker = null; }
  function holeOpt(idx) {
    const theme = S.themeOrder[idx % S.themeOrder.length];
    const modKeys = Object.keys(C.MODS).filter((k) => k !== 'none');
    const mod = S.opts.mods && idx > 0 && Math.random() < 0.45 ? modKeys[Math.floor(Math.random() * modKeys.length)] : 'none';
    return { theme, mod, pickups: S.opts.items === 'off' ? 0 : S.opts.items === 'chaos' ? 5 : 3 };
  }
  function prepSync(idx, opt) {
    for (let k = 0; k < 4; k++) {
      const seed = (S.seed + idx * 1013 + k * 7919) >>> 0, hole = C.generateHole(seed, idx, opt);
      const runs = [C.botRun(hole, 0.8), C.botRun(hole, 0.8)];
      if (runs.some((r) => r !== null) || k === 3) return { seed, par: Math.max(2, Math.min(6, Math.round(runs.reduce((a, r) => a + (r ?? C.MAX_STROKES), 0) / runs.length))) };
    }
  }
  function prepare(idx) {
    if (!prepCache.has(idx)) {
      const opt = holeOpt(idx);
      const p = worker ? new Promise((res) => { const id = ++reqId; waiting.set(id, res); worker.postMessage({ id, seed: S.seed, idx, opt, phys: { ...C.PHYS } }); }) : Promise.resolve(prepSync(idx, opt));
      prepCache.set(idx, p.then(({ seed, par }) => { const hole = C.generateHole(seed, idx, opt); hole.par = par; return { seed, hole, par, opt }; }));
    }
    return prepCache.get(idx);
  }
  let lastPrep = null;
  const holeMsg = () => ({ t: 'hole', seed: lastPrep.seed, idx: S.holeIdx, par: lastPrep.par, gen: lastPrep.opt, phase: S.phase, players: pubPlayers(), timeLeft: S.sim?.timeLeft ?? S.opts.time, ht: S.sim?.t ?? 0, intro: S.sim?.intro ?? 0 });
  let starting = -1;
  async function startHole(idx) {
    if (starting === idx) return;
    starting = idx;
    const prep = await prepare(idx);
    if (S.ended || !S.isHost) return;
    lastPrep = prep;
    const hole = prep.hole;
    const bs = new Map();
    S.players.forEach((p, i) => { const t = hole.tees[i % hole.tees.length]; const b = C.makeBall(p.id, t.x, t.z, t.y, hole); if (p.gone) b.out = true; bs.set(p.id, b); });
    S.sim = { hole, balls: bs, t: 0, acc: 0, timeLeft: S.opts.time, first: null, endDelay: 0, snapAcc: 0, intro: INTRO_SECS + 0.3, bot: new Map(), mines: [], order: [], bonus: new Map(), ko: new Map(), pick: hole.pickups.map(() => ({ on: true, t: 0 })) };
    S.players.forEach((p) => { if (p.bot) S.sim.bot.set(p.id, 0.6 + Math.random() * 2); });
    S.holeIdx = idx;
    if (S.phase !== 'waiting') S.phase = 'playing';
    net.toAll(holeMsg());
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
  function addBonus(id, pts, tag) { const e = S.sim.bonus.get(id) || { pts: 0, tags: '' }; e.pts += pts; e.tags += tag; S.sim.bonus.set(id, e); }
  function hostEvent(msg, s, b, extra) { net.toAll({ t: 'ev', msg, s, x: b ? +b.x.toFixed(2) : 0, y: b ? +b.y.toFixed(2) : 0, z: b ? +b.z.toFixed(2) : 0, ...extra }); }
  const stat = (id, k) => { const p = S.players.find((q) => q.id === id); if (p) p.stats[k]++; };
  function useItem(id) {
    const sim = S.sim; if (!sim || S.phase !== 'playing' || sim.intro > 0) return;
    const b = sim.balls.get(id); if (!b || !b.item || b.sunk || b.out) return;
    const it = b.item, arr = [...sim.balls.values()], nm = pname(id);
    const others = arr.filter((q) => q !== b && !q.sunk && !q.out);
    if (it === 6) {
      const tgt = others.sort((p, q) => C.distToCup(sim.hole, p.x, p.z) - C.distToCup(sim.hole, q.x, q.z))[0];
      if (!tgt) return;
      for (const k of ['x', 'y', 'z']) { const v = b[k]; b[k] = tgt[k]; tgt[k] = v; }
      b.vx = b.vy = b.vz = tgt.vx = tgt.vy = tgt.vz = 0; b.air = tgt.air = false;
      hostEvent(`🔀 ${nm} swapped places with ${pname(tgt.id)}!`, 'swap', b);
    } else if (it === 7) {
      const sp = Math.hypot(b.vx, b.vz);
      if (sp < 0.4) { net.to(id, { t: 'ev', msg: '🚀 Rocket only works while your ball is rolling' }); return; }
      const k = Math.max(sp, 11.5) / sp; b.vx *= k; b.vz *= k;
      hostEvent(`🚀 ${nm} hit the ROCKET!`, 'rocket', b);
    } else if (it === 1) { b.big = 12; hostEvent(`🔴 ${nm} went BIG!`, 'use', b); }
    else if (it === 2) { b.sticky = 12; hostEvent(`🟢 ${nm} is STICKY`, 'use', b); }
    else if (it === 3) { C.blast(arr, b.x, b.z, b.y, 5, 9, b, id); hostEvent(`💥 ${nm} SHOCKWAVE!`, 'shock', b); }
    else if (it === 4) { b.magnet = 12; hostEvent(`🧲 ${nm} turned on the MAGNET`, 'use', b); }
    else if (it === 5) { b.ghost = 10; hostEvent(`👻 ${nm} went GHOST`, 'use', b); }
    else if (it === 8) { if (sim.mines.length >= 8) sim.mines.shift(); sim.mines.push({ x: b.x, y: b.y, z: b.z, owner: id, arm: sim.t + 1.2 }); hostEvent(`💣 ${nm} dropped a MINE`, 'use', b); }
    else if (it === 9) { for (const q of others) if (!(q.ghost > 0)) { q.frozen = 4; q.vx = q.vz = 0; } hostEvent(`❄️ ${nm} FROZE everyone!`, 'freeze', b); }
    b.item = 0; C.applyEffects(b, sim.hole); stat(id, 'items');
  }
  function pickItem(b) {
    const sim = S.sim, act = [...sim.balls.values()].filter((q) => !q.sunk && !q.out);
    const d = C.distToCup(sim.hole, b.x, b.z), rank = act.filter((q) => C.distToCup(sim.hole, q.x, q.z) < d).length / Math.max(1, act.length - 1);
    const pool = rank < 0.34 ? [1, 2, 8, 3, 5, 8, 2] : rank > 0.66 ? [6, 7, 4, 9, 3, 6, 9] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
    return pool[Math.floor(Math.random() * pool.length)];
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
    if (!S.isHost || !S.sim || S.ended) return;
    const sim = S.sim;
    if (S.phase === 'playing') {
      if (sim.intro > 0) { sim.intro -= dt; sim.snapAcc += dt; if (sim.snapAcc >= 0.2) { sim.snapAcc = 0; net.toAll(snapshot(), false); } return; }
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
      sim.pick.forEach((st) => { if (!st.on && (st.t -= dt) <= 0) st.on = true; });
      for (let i = sim.mines.length - 1; i >= 0; i--) {
        const m = sim.mines[i]; if (sim.t < m.arm) continue;
        const hit = arr.find((b) => !b.sunk && !b.out && !(b.ghost > 0) && (b.id !== m.owner || sim.t > m.arm + 4) && Math.hypot(b.x - m.x, b.z - m.z) < 0.35 + b.r && Math.abs(b.y - m.y) < 0.6);
        if (!hit) continue;
        C.blast(arr, m.x, m.z, m.y, 4, 12, null, m.owner);
        sim.mines.splice(i, 1);
        hostEvent(`💣 BOOM! ${pname(hit.id)} hit ${pname(m.owner)}'s mine`, 'shock', m);
      }
      botTick(dt, arr);
      const allDone = arr.every((b) => b.sunk || b.out);
      if ((allDone || sim.timeLeft <= 0) && !sim.endDelay) { sim.endDelay = allDone ? 1.4 : 0.01; if (!allDone) hostEvent('⏰ Time up!'); }
      if (sim.endDelay) { sim.endDelay -= dt; if (sim.endDelay <= 0) endHole(); }
      sim.snapAcc += dt;
      if (sim.snapAcc >= 0.05) { sim.snapAcc = 0; net.toAll(snapshot(), false); }
    } else if (S.phase === 'holeEnd') {
      sim.phaseTimer -= dt;
      if (sim.phaseTimer <= 0) {
        if (S.holeIdx + 1 < S.opts.holes) startHole(S.holeIdx + 1);
        else { S.phase = 'matchEnd'; S.awards = makeAwards(); net.toAll({ t: 'matchEnd', players: pubPlayers(), awards: S.awards }); ctx.setTimeout(finishMatch, PODIUM_SECS * 1000); }
      }
    }
  }
  function botTick(dt, arr) {
    const sim = S.sim;
    for (const p of S.players) {
      if (!p.bot) continue;
      const b = sim.balls.get(p.id); if (!b || b.sunk || b.out) continue;
      const others = arr.filter((q) => q !== b && !q.sunk && !q.out);
      const dCup = C.distToCup(sim.hole, b.x, b.z);
      if (b.item === 3 && others.some((q) => Math.hypot(q.x - b.x, q.z - b.z) < 3.2)) useItem(p.id);
      else if (b.item === 9 && others.length && Math.random() < dt * 0.6) useItem(p.id);
      else if (b.item === 6 && others.some((q) => C.distToCup(sim.hole, q.x, q.z) < dCup - 6)) useItem(p.id);
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
  const r3 = (v) => Math.round(v * 1000) / 1000;
  function snapshot() {
    const sim = S.sim;
    return {
      t: 's', ht: r3(sim.t), tl: r3(sim.timeLeft), pk: sim.pick.map((p) => (p.on ? 1 : 0)), mn: sim.mines.map((m) => [r3(m.x), r3(m.y), r3(m.z)]),
      b: [...sim.balls.values()].map((b) => [b.id, r3(b.x), r3(b.y), r3(b.z), r3(b.vx), r3(b.vy), r3(b.vz),
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
    S.phase = 'holeEnd'; sim.phaseTimer = idx + 1 < S.opts.holes ? HOLE_END_SECS : 1.5;
    net.toAll({ t: 'holeEnd', players: pubPlayers(), idx, last: idx + 1 >= S.opts.holes });
    if (idx + 1 < S.opts.holes) prepare(idx + 1);
  }
  function makeAwards() {
    const best = (k, label, min = 1) => { const p = [...S.players].sort((a, b) => b.stats[k] - a.stats[k])[0]; return p && p.stats[k] >= min ? `${label}: ${p.name} (${p.stats[k]})` : null; };
    return [best('ko', '💥 Bully — most KOs'), best('ace', '🎯 Sniper — holes-in-one'), best('first', '★ Speedster — first to sink'), best('splash', '💦 Soggy Socks — most penalties', 2), best('items', '🎁 Gadgeteer — power-ups used', 2)].filter(Boolean);
  }
  function standings() {
    const live = S.phase === 'playing' && !speedMode();
    const ps = S.players.map((p) => ({ id: p.id, t: total(p) + (live ? (balls().get(p.id)?.strokes || 0) : 0) })).sort((a, b) => (speedMode() ? b.t - a.t : a.t - b.t));
    const groups = [];
    for (const p of ps) { const g = groups[groups.length - 1]; if (g && g.t === p.t) g.ids.push(p.id); else groups.push({ t: p.t, ids: [p.id] }); }
    return groups.map((g) => g.ids);
  }
  function finishMatch() {
    if (S.ended) return;
    S.ended = true;
    const stats = Object.fromEntries(S.players.map((p) => [p.id, speedMode() ? `${total(p)} pts` : `${total(p)} strokes`]));
    ctx.endGame(standings(), { stats, note: S.awards.join('   ') });
  }
  // ---------------------------------------------------------------- client prediction / reconciliation
  function onSnapshot(m) {
    if (!S.csim || !S.hole) return;
    const now = performance.now();
    S.timeLeft = m.tl; S.pick = m.pk || []; S.mines = m.mn || [];
    const lat = Math.min(0.25, net.ping() / 2000);
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

  const sharedMats = new Set(Object.values(G.M));
  let flagMesh = null, turnRing = null, groundY = -1.2;
  function clearCourse() {
    if (course) {
      scene.remove(course);
      course.traverse(o => {
        if (o.geometry && !G.keepGeos.has(o.geometry)) o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) if (!sharedMats.has(m) && !G.keepMats.has(m)) { if (m.map && (o.userData.ownMap || o.isSprite)) m.map.dispose(); m.dispose(); }
      });
    }
    course = null; moverMeshes = []; pickupMeshes = []; mineMeshes = []; portalMeshes = []; bubbles = []; ballMeshes.clear();
    aimGroup.visible = false; pullLine.visible = false;
    rings.forEach(r => { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); }); rings = []; flagMesh = null; turnRing = null;
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
      if (low - gy > 0.01) add(G.box(T, low - gy, T, t.type === 'jump' ? M.pit : M.stone, { uvScale: 1.6 }), t.cx, (low + gy) / 2, t.cz).userData.noInk = true;
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
        const pm = new THREE.Mesh(g, M.stone); pm.receiveShadow = true; pm.userData.noInk = true; course.add(pm);
        const ox = t.cx + (t.din[0] - t.d[0]) * (T / 2 - 0.75), oz = t.cz + (t.din[1] - t.d[1]) * (T / 2 - 0.75);
        const bush = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), G.toon({ color: th.bush })); bush.userData.inkMe = true;
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
        const rim = add(G.box(rw, 0.06, rd, M.stone, { uvScale: 0.6 }), rx, w.y + 0.03, rz); rim.castShadow = false; rim.userData.noInk = true;
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
      for (const p of S.players) {
      const ball = new THREE.Mesh(ballGeo, G.ballMaterial(p.color)); ball.castShadow = true; ball.userData.inkMe = true;
      const blob = new THREE.Mesh(G.blobGeo, M.blob); blob.renderOrder = 1;
      const label = G.makeLabel(p.id === S.myId ? 'You' : p.name, p.color);
      course.add(ball, label, blob); ballMeshes.set(p.id, { ball, label, blob, trail: new G.Trail(course, p.color), sink: 0, wasSunk: false });
    }
    G.inkCourse(course);
    course.add(G.buildScenery(hole, gy, th));
    const dir = G.applyTheme(th, themeCtx); weather.set(th.weather);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, ext = Math.max(maxX - minX, maxZ - minZ) / 2 + 3;
    sun.position.set(cx + dir.x * 50, dir.y * 50, cz + dir.z * 50); sun.target.position.set(cx, 0, cz);
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 120 });
    sun.shadow.camera.updateProjectionMatrix();
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
      const b = G.box(0.7, h + 0.3, 0.7, mat, { round: 0.04 }); b.position.set(cx + px * off, y0 + (h + 0.3) / 2, cz + pz * off); G.outline(b); course.add(b);
      pos.set(ps[i].id, new THREE.Vector3(cx + px * off, t.h0 + h, cz + pz * off));
    });
    ps.slice(3).forEach((p, i) => { const o = (i - (ps.length - 4) / 2) * 0.5; pos.set(p.id, new THREE.Vector3(cx + px * o + t.d[0] * 1.0, t.h0, cz + pz * o + t.d[1] * 1.0)); });
    S.podium = { pos, c: new THREE.Vector3(cx, t.h0 + 0.6, cz), t0: performance.now(), win: ps[0]?.id };
  }

  // arm=false only parks the camera on the flyover's first shot (hole 1, before the hub countdown ends)
  function startIntro(arm = true) {
    const b = myBall() || [...balls().values()][0]; if (!b || !S.hole) return;
    const xs = S.hole.tiles.map(t => t.cx), zs = S.hole.tiles.map(t => t.cz);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 8;
    const cup = S.hole.cup;
    S.introFrom = { pos: new THREE.Vector3(cx + 3, cup.y + span * 0.75 + 5, cz + span * 0.55), tgt: new THREE.Vector3((cx + cup.x) / 2, cup.y, (cz + cup.z) / 2) };
    camera.position.copy(S.introFrom.pos); controls.target.copy(S.introFrom.tgt);
    if (!arm) return;
    S.introUntil = Infinity; S.introArm = true; // the clock starts on the first rendered frame (after shaders compile)
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
  const ballGeo = new THREE.SphereGeometry(C.BALL_R, 32, 24);

  // ---------------------------------------------------------------- messages
  function loadHole(m) {
    mergePlayers(m.players);
    const same = S.hole && S.hole.seed === m.seed && S.holeIdx === m.idx;
    S.holeIdx = m.idx;
    if (!S.isHost && !same) {
      S.hole = C.generateHole(m.seed, m.idx, m.gen);
      const bs = new Map();
      S.players.forEach((p, i) => { const t = S.hole.tees[i % S.hole.tees.length]; bs.set(p.id, Object.assign(C.makeBall(p.id, t.x, t.z, t.y, S.hole), { srvReady: true })); });
      S.csim = { balls: bs, t: m.ht || 0, acc: 0 };
    }
    if (S.isHost) S.hole = S.sim.hole;
    S.hole.par = m.par;
    if (!S.isHost) { S.timeLeft = m.timeLeft ?? S.opts.time; if (m.phase === 'playing' || (ctx.started && m.phase !== 'holeEnd')) S.phase = 'playing'; }
    if (same) return;
    S.pick = S.hole.pickups.map(() => 1); S.mines = []; S.pred = { strokes: -1, until: 0 }; S.spec = null; S.podium = null;
    buildCourse(S.hole); liveAt = 0; showCard(false);
    // flyover intro: starts when the round is live (after the hub countdown for hole 1)
    if (S.phase === 'playing' && (m.intro ?? 1) > 0.5) startIntro();
    else if (!ctx.started) startIntro(false);
    else resetCamera();
    SFX.play('pickup', 0.5);
  }
  net.onMessage((m, from) => {
    if (!m || typeof m !== 'object') return;
    if (S.isHost) {
      if (m.t === 'hi' && lastPrep) net.to(from, holeMsg());
      else if (m.t === 'shot') applyShot(from, +m.a, +m.p);
      else if (m.t === 'use') useItem(from);
      // relay as a different type: the host's own copy comes back through the loopback and must not be relayed again
      else if (m.t === 'emote') net.toAll({ t: 'emoted', id: from, i: Math.abs(m.i | 0) % EMOTES.length });
      if (from !== S.myId || ['shot', 'use', 'hi', 'emote'].includes(m.t)) return;
    }
    switch (m.t) {
      case 'hole': loadHole(m); break;
      case 's': if (!S.isHost) onSnapshot(m); break;
      case 'ev':
        ui.toast(m.msg, m.s === 'cup' ? 'good' : m.s === 'splash' || m.s === 'fell' ? 'bad' : m.s === 'ko' ? 'gold' : '', 2600);
        if (m.s && S.hole) {
          SFX.play(m.s, ['shock', 'cup', 'ko', 'freeze', 'swap'].includes(m.s) ? Math.max(0.4, near(m.x, m.z)) : near(m.x, m.z));
          const cup = S.hole.cup;
          if (m.s === 'shock') { spawnRing(m.x, m.y, m.z, '#7dd3fc'); fxp.emit(m.x, m.y + 0.2, m.z, 60, ['#7dd3fc', '#e0f2fe', '#ffffff', '#ffb347'], 7, 1.5, 0.6, 3); }
          if (m.s === 'splash') { fxp.emit(m.x, m.y + 0.05, m.z, 45, ['#bfe6ff', '#ffffff', '#5fb4ff'], 1.8, 4, 0.9, 12); spawnRing(m.x, m.y - 0.1, m.z, '#ffffff', 2.5); }
          if (m.s === 'cup') { const col = S.players.find((p) => p.id === m.id)?.color || '#fff'; fxp.emit(cup.x, cup.y + 0.2, cup.z, 80, [col, col, '#ffd43b', '#ffffff', '#ff7ad9', '#4dabff'], 2.2, 5, 1.6, 7); }
          if (m.s === 'pickup') fxp.emit(m.x, m.y + 0.4, m.z, 30, ['#ffd84a', '#fff3b0', '#f59e0b'], 2, 2.5, 0.8, 5);
          if (m.s === 'fell') fxp.emit(m.x, m.y + 0.1, m.z, 16, ['#8b6b4a', '#c9b08a'], 1.2, 1.5, 0.6, 6);
          if (m.s === 'freeze') { spawnRing(m.x, m.y, m.z, '#bfeaff', 14); fxp.emit(m.x, m.y + 0.3, m.z, 60, ['#ffffff', '#bfeaff', '#7fd0ff'], 6, 2, 1.0, 2); }
          if (m.s === 'use' || m.s === 'rocket' || m.s === 'swap') fxp.emit(m.x, m.y + 0.2, m.z, 24, ['#ffffff', '#ffe14d', '#ff9f43'], 2.5, 2, 0.6, 4);
        }
        break;
      case 'emoted': showEmote(m.id, m.i); break;
      case 'holeEnd':
        mergePlayers(m.players); S.phase = 'holeEnd'; aimCancel();
        if (!m.last) { showCard(true); S.boardEndsAt = performance.now() + HOLE_END_SECS * 1000; }
        break;
      case 'matchEnd': mergePlayers(m.players); S.awards = m.awards || []; S.phase = 'matchEnd'; aimCancel(); showCard(false); ctx.audio.play('win'); setupPodium(); break;
    }
  });

  // ---------------------------------------------------------------- input: aiming (left drag), E item, Space recenter, 1-4 emotes, ←/→ spectate
  const aim = { on: false, a: 0, p: 0, hit: new THREE.Vector3() };
  const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2(); const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function canShoot() {
    const b = myBall(); if (S.phase !== 'playing' || !ctx.started || !b || b.sunk || b.out || b.frozen > 0 || !C.isResting(b)) return false;
    const now = performance.now();
    if (now < S.shotLock || now < S.introUntil) return false;
    if (S.isHost) return !!S.sim && !(S.sim.intro > 0);
    return b.srvReady && !(now < S.pred.until && b.srvStrokes < S.pred.strokes);
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
    const b = myBall(), s = C.shotSpeed(S.hole, p);
    b.lastX = b.x; b.lastY = b.y; b.lastZ = b.z; b.strokes = (b.srvStrokes ?? b.strokes) + 1;
    b.vx = Math.cos(a) * s; b.vz = Math.sin(a) * s; b.fx = 'putt'; b.fxv = 2 + p * 8;
    S.pred = { strokes: b.strokes, until: performance.now() + 900 + net.ping() * 2 };
    net.toHost({ t: 'shot', a, p });
  }
  function useMyItem() { const b = myBall(); if (b && b.item && S.phase === 'playing') net.toHost({ t: 'use' }); }
  let lastEmote = 0;
  function emote(i) { if (ctx.spectator || performance.now() - lastEmote < 900) return; lastEmote = performance.now(); net.toHost({ t: 'emote', i }); }
  ctx.listen(renderer.domElement, 'pointerdown', (e) => {
    if (!ctx.input.enabled) return;
    if (e.button === 2 && aim.on) { aimCancel(); return; }
    if (e.button !== 0) return;
    if (!canShoot()) { const mb = myBall(); if (S.phase === 'playing' && (!mb || mb.sunk || mb.out)) cycleSpec(1); return; }
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
    else if (a === 'left') cycleSpec(-1);
    else if (a === 'right') cycleSpec(1);
  });
  ctx.input.on('key', (code, down) => { if (down && /^Digit[1-4]$/.test(code)) emote(+code.slice(5) - 1); });
  ctx.input.on('release', () => { if (!ctx.input.enabled) aimCancel(); });

  // ---------------------------------------------------------------- host migration, late joiners, leavers
  function becomeHost() {
    S.isHost = true;
    if (!S.hole || !lastPrepFromClient) { startHole(S.holeIdx); return; }
    lastPrep = lastPrepFromClient;
    const bs = new Map();
    for (const p of S.players) {
      const c = S.csim?.balls.get(p.id), t0 = S.hole.tees[0];
      const b = Object.assign(C.makeBall(p.id, c ? c.x : t0.x, c ? c.z : t0.z, c ? c.y : t0.y, S.hole), c ? { vx: c.vx, vy: c.vy, vz: c.vz, strokes: c.strokes, item: c.item || 0, big: c.big || 0, sticky: c.sticky || 0, magnet: c.magnet || 0, ghost: c.ghost || 0, frozen: c.frozen || 0, sunk: !!c.sunk, air: !!c.air } : {});
      b.out = c ? !!c.out || !ctx.connected(p.id) : true;
      b.lastX = b.x; b.lastY = b.y; b.lastZ = b.z; C.applyEffects(b, S.hole);
      bs.set(p.id, b);
    }
    S.sim = { hole: S.hole, balls: bs, t: S.csim?.t || 0, acc: 0, timeLeft: S.timeLeft, first: null, endDelay: 0, snapAcc: 0, intro: Math.max(0, (S.introUntil - performance.now()) / 1000), bot: new Map(), mines: S.mines.map(([x, y, z]) => ({ x, y, z, owner: null, arm: 0 })), order: [], bonus: new Map(), ko: new Map(), pick: S.hole.pickups.map((_, i) => ({ on: S.pick[i] !== 0, t: ITEM_RESPAWN[S.opts.items] || 12 })), phaseTimer: Math.max(1, (S.boardEndsAt - performance.now()) / 1000) };
    S.csim = null;
    if (S.phase === 'matchEnd') ctx.setTimeout(finishMatch, 1500);
    else if (S.phase === 'holeEnd' && S.holeIdx + 1 >= S.opts.holes) { S.phase = 'matchEnd'; S.awards = makeAwards(); ctx.setTimeout(finishMatch, 1500); }
    net.toAll(holeMsg());
  }
  let lastPrepFromClient = null;
  net.onMessage((m) => { if (m?.t === 'hole' && !S.isHost) lastPrepFromClient = { seed: m.seed, par: m.par, opt: m.gen }; });
  ctx.on('hostchange', ({ amHost }) => { if (amHost && !S.isHost) becomeHost(); });
  ctx.on('join', (id) => { if (S.isHost && lastPrep) net.to(id, holeMsg()); });
  ctx.on('leave', (id) => { const p = S.players.find((x) => x.id === id); if (!p) return; p.gone = true; if (S.sim) { const b = S.sim.balls.get(id); if (b) b.out = true; } });
  ctx.on('go', () => {
    if (S.isHost) { S.phase = 'playing'; if (S.sim) { S.sim.timeLeft = S.opts.time; S.sim.intro = INTRO_SECS + 0.3; net.toAll(holeMsg()); } }
    else if (S.phase === 'waiting') S.phase = 'playing';
    if (S.hole) startIntro();
  });
  if (S.isHost) startHole(0); else net.toHost({ t: 'hi' });

  // ---------------------------------------------------------------- loops
  ctx.tick((dt) => { try { hostTick(dt); } catch (e) { console.error(e); } });
  let lastSec = 0, liveAt = 0, fpsFrames = 0, fpsAt = performance.now(), slowSecs = 0, autoDone = false;
  const sm = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const preview = { b: null };
  ctx.frame((dt, now) => {
    fpsFrames++;
    if (now - fpsAt > 1000) {
      const fps = Math.round(fpsFrames * 1000 / (now - fpsAt)); fpsFrames = 0; fpsAt = now;
      if (!autoDone && ctx.settings.get('quality') !== 'low') { slowSecs = fps < 24 ? slowSecs + 1 : 0; if (slowSecs >= 5) { autoDone = true; ctx.settings.set('quality', 'low'); ui.toast('Graphics set to low for speed (Esc → Settings)'); } }
    }
    const tsec = now / 1000;
    G.animate(tsec); fxp.update(dt);
    weather.update(dt, tsec, controls.target.x, controls.target.y, controls.target.z);
    if (flagMesh) flagMesh.userData.wave(tsec);
    for (const p of portalMeshes) { p.ring.scale.setScalar(1 + Math.sin(tsec * 4) * 0.06); p.glow.material.opacity = 0.45 + Math.sin(tsec * 3) * 0.2; }
    for (const r of rings) { r.t += dt; r.m.scale.setScalar(1 + r.t * r.grow); r.m.material.opacity = Math.max(0, 0.9 - r.t * 1.8); }
    rings = rings.filter((r) => { if (r.t > 0.5) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); return false; } return true; });
    if (S.hole && course) {
      const inIntro = now < S.introUntil;
      if (S.isHost && S.sim) { S.timeLeft = S.sim.timeLeft; S.ht = S.sim.t; S.pick = S.sim.pick.map((p) => (p.on ? 1 : 0)); S.mines = S.sim.mines.map((m) => [m.x, m.y, m.z]); }
      else { clientStep(dt); if (S.phase === 'playing' && ctx.started && !inIntro) S.timeLeft = Math.max(0, S.timeLeft - dt); }
      const ht = S.isHost ? (S.sim ? S.sim.t : 0) : (S.csim ? S.csim.t : 0);
      for (const { mv, g } of moverMeshes) { const p = C.moverPose(mv, ht); g.position.x = p.x; g.position.z = p.z; g.rotation.y = -p.a; }
      pickupMeshes.forEach(({ m, q, pk }, i) => { const on = !!S.pick[i]; m.visible = q.visible = on; m.rotation.y += dt * 1.5; m.position.y = q.position.y = pk.y + 0.45 + Math.sin(tsec * 2.5 + i) * 0.08; });
      mineMeshes.forEach((g, i) => { const m = S.mines[i]; g.visible = !!m; if (m) g.position.set(m[0], m[1], m[2]); });
      const bs = balls(), cup = S.hole.cup, pod = S.phase === 'matchEnd' ? S.podium : null;
      for (const [id, bm] of ballMeshes) {
        const { ball, label, trail, blob } = bm;
        const b = bs.get(id); if (!b) { ball.visible = label.visible = blob.visible = false; continue; }
        const gone = S.players.find((p) => p.id === id)?.gone;
        const sc = b.r / C.BALL_R;
        if (pod) {
          const p = pod.pos.get(id); ball.visible = label.visible = !!p && !gone; trail.mesh.visible = false;
          blob.visible = !!p && !gone;
          if (p) { const hop = id === pod.win ? Math.abs(Math.sin(tsec * 5)) * 0.35 : 0; ball.scale.setScalar(1); ball.position.set(p.x, p.y + C.BALL_R + hop, p.z); label.position.set(p.x, p.y + C.BALL_R + 0.5 + hop, p.z); ball.material.opacity = 1; blob.position.set(p.x, p.y + 0.01, p.z); blob.scale.setScalar(C.BALL_R * 1.5); }
          continue;
        }
        if (b.sunk && !bm.wasSunk) bm.sink = 0.4;
        bm.wasSunk = b.sunk;
        if (bm.sink > 0) {
          bm.sink -= dt; const k = Math.max(0, bm.sink / 0.4);
          ball.visible = true; label.visible = blob.visible = false; ball.scale.setScalar(sc * (0.6 + 0.4 * k)); ball.position.set(cup.x, cup.y + b.r * k - 0.25 * (1 - k), cup.z);
        } else {
          const vis = !b.sunk && !gone;
          ball.visible = vis; label.visible = vis;
          ball.scale.setScalar(sc); ball.position.set(b.x, b.y + b.r, b.z); label.position.set(b.x, b.y + b.r * 2 + 0.25, b.z);
          ball.rotation.x += b.vz * dt / b.r; ball.rotation.z -= b.vx * dt / b.r;
          const fy = vis ? C.heightAt(S.hole, b.x, b.z) : null;
          blob.visible = fy !== null && b.y - fy < 3;
          if (blob.visible) { const k = Math.max(0.35, 1 - (b.y - fy) * 0.4); blob.position.set(b.x, fy + 0.035, b.z); blob.scale.setScalar(b.r * 1.5 * k); }
        }
        bm.ink ??= ball.children.find((c) => c.userData.ink);
        if (bm.ink) bm.ink.visible = !(b.ghost > 0);
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
      bubbles = bubbles.filter((bb) => { bb.t += dt; const bm = ballMeshes.get(bb.id); if (bb.t > 2.4 || !bm) { course && course.remove(bb.sp); bb.sp.material.map.dispose(); bb.sp.material.dispose(); return false; } const p = bm.ball.position; bb.sp.position.set(p.x, p.y + 1.0 + Math.min(0.2, bb.t), p.z); bb.sp.material.opacity = Math.min(1, (2.4 - bb.t) * 3); return true; });
      const mb = myBall(), cb = camBall();
      if (pod) {
        const a = (now - pod.t0) / 1000 * 0.35;
        controls.target.lerp(new THREE.Vector3(pod.c.x, pod.c.y, pod.c.z), Math.min(1, dt * 3));
        camera.position.lerp(new THREE.Vector3(pod.c.x + Math.cos(a) * 6, pod.c.y + 2.6, pod.c.z + Math.sin(a) * 6), Math.min(1, dt * 2.5));
        if (Math.random() < dt * 5) fxp.emit(pod.c.x + (Math.random() - 0.5) * 2.5, pod.c.y + 2.6, pod.c.z + (Math.random() - 0.5) * 2.5, 10, ['#ff5c5c', '#ffd43b', '#4dabff', '#2ee6a8', '#ff7ad9', '#ffffff'], 1.2, 0.5, 2.2, 2.5);
      } else if (inIntro && S.introFrom && cb) {
        const k = sm(1 - (S.introUntil - now) / (INTRO_SECS * 1000)), h = homeCam(cb);
        camera.position.lerpVectors(S.introFrom.pos, h.pos, k); controls.target.lerpVectors(S.introFrom.tgt, h.tgt, k);
      } else if (cb && ctx.started) {
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
      }
      const sec = Math.ceil(S.timeLeft);
      if (S.phase === 'playing' && ctx.started && sec !== lastSec && sec <= 5 && sec > 0) SFX.play('tick');
      lastSec = sec;
      updateHud(mb, cb);
    }
    controls.update();
    if (post && ctx.quality().effects) post.composer.render(); else renderer.render(scene, camera);
    if (S.introArm) { S.introArm = false; S.introUntil = performance.now() + INTRO_SECS * 1000; if (S.isHost && S.sim) S.sim.intro = INTRO_SECS + 0.3; showIntro(S.hole); }
  });

  // ---------------------------------------------------------------- HUD (shared zones)
  function updateHud(mb, cb) {
    const hole = S.hole, th = G.THEMES[hole.themeIdx], mod = C.MODS[hole.mod].name;
    const inIntro = performance.now() < S.introUntil;
    ui.status(`⛳ Hole ${S.holeIdx + 1}/${S.opts.holes} · Par ${hole.par}<br><small>${ctx.spectator ? '👀 Spectating' : speedMode() ? `Speed Golf · Strokes ${mb ? mb.strokes : 0}` : `Strokes ${mb ? mb.strokes : 0} / ${C.MAX_STROKES}`}</small><br><small style="color:var(--yellow)">${esc(th.name)}${mod ? ` · ⚡ ${esc(mod)}` : ''}</small>`);
    ui.timer(S.phase === 'playing' && ctx.started ? S.timeLeft : null, { warn: 10 });
    const spec = cb && cb !== mb;
    const hint = S.phase !== 'playing' || !ctx.started ? '' : inIntro ? 'Get ready…' : spec ? `Spectating ${pname(cb.id)} — click or ←/→ to switch` : !mb ? '' : mb.sunk ? 'Sunk! 🎉' : mb.out ? 'Out of strokes' :
      mb.frozen > 0 ? `❄️ Frozen ${Math.ceil(mb.frozen)}s` : aim.on ? 'Release to shoot · right-click to cancel' : canShoot() ? 'Your shot! Drag back from your ball' : 'Ball rolling…';
    ui.bar(S.phase === 'playing' ? (aim.on ? aim.p : 0) : null, hint);
    const effs = mb ? [['big', 'BIG'], ['sticky', 'STICKY'], ['magnet', 'MAGNET'], ['ghost', 'GHOST']].filter(([k]) => mb[k] > 0) : [];
    const it = mb && C.ITEMS[mb.item];
    ui.abilities([{ key: 'E', label: it ? `${it.i} ${it.n}` : effs.length ? effs.map(([k, n]) => `${n} ${Math.ceil(mb[k])}s`).join(' · ') : 'No power-up', ready: !!it, dim: !it && !effs.length, wide: true }]);
    if (S.phase === 'holeEnd' && S.boardEndsAt) { const n = card.querySelector('[data-next]'); if (n) n.textContent = `Next hole in ${Math.max(0, Math.ceil((S.boardEndsAt - performance.now()) / 1000))}…`; }
    if (!liveAt || performance.now() - liveAt > 200) {
      liveAt = performance.now();
      const bs = balls();
      ui.mini(S.players.map((p) => {
        const b = bs.get(p.id);
        const st = !b ? '' : b.sunk ? `${b.strokes}✓` : b.out ? `${b.strokes}✗` : b.strokes;
        const fx = !b ? '' : (b.big > 0 ? '🔴' : '') + (b.sticky > 0 ? '🟢' : '') + (b.magnet > 0 ? '🧲' : '') + (b.ghost > 0 ? '👻' : '') + (b.frozen > 0 ? '❄️' : '') + (b.item ? '🎁' : '');
        return { id: p.id, name: `${p.name} ${fx}`, color: p.color, value: `${st} · ${total(p)}`, me: p.id === S.myId, out: p.gone };
      }), 'hole · total');
    }
  }

  window.__golf = { S, C, applyShot, useItem, balls, canShoot, shoot };
  return {
    standings,
    stop() {
      clearCourse();
      controls.dispose();
      worker?.terminate();
      if (post) { post.composer.renderTarget1.dispose(); post.composer.renderTarget2.dispose(); for (const p of post.composer.passes) p.dispose?.(); }
      ctx.three.dispose(scene, new Set([...G.SHARED, ...G.keepGeos, ...G.keepMats]));
      ballGeo.dispose(); dotGeo.dispose(); aimMat.dispose();
      delete window.__golf;
    },
  };
}
