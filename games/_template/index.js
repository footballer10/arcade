// COIN GRAB — the template game. Copy this folder to start a new game (see docs/ADDING_A_GAME.md).
// It is small on purpose but uses every core feature: seeded level, host-authoritative net channel with
// client prediction, bots with difficulty, the shared avatar, HUD zones, the hub countdown ('go'),
// host migration ('hostchange'), mid-round spectators ('join'), endGame(placements) and full cleanup.
import * as THREE from 'three';
export { manifest } from './manifest.js';
import { RULES } from './tuning.js';   // tunable feel constants (developer portal)
import { SnapBuffer } from '../../core/interp.js';   // smooth drawing of others, even over the slow relay

const SIZE = 13, R = 0.55, SNAP_HZ = 15;

// ---------------------------------------------------------------- shared rules (host AND clients run this)
function stepPlayer(p, inp, dt, level) {
  const len = Math.hypot(inp.mx, inp.mz) || 1;
  const k = Math.min(1, Math.hypot(inp.mx, inp.mz));
  let tx = (inp.mx / len) * RULES.SPEED * k, tz = (inp.mz / len) * RULES.SPEED * k;
  p.vx += (tx - p.vx) * Math.min(1, dt * RULES.ACCEL); p.vz += (tz - p.vz) * Math.min(1, dt * RULES.ACCEL);
  if (inp.jump !== p.lastJump) { p.lastJump = inp.jump; if (p.y <= 0) p.vy = RULES.JUMP; }
  let vx = p.vx, vz = p.vz;
  p.x += vx * dt; p.z += vz * dt;
  p.vy -= RULES.GRAV * dt; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0) p.vy = Math.max(0, p.vy);
  // arena walls + pillars (from the seeded level)
  p.x = Math.max(-SIZE + R, Math.min(SIZE - R, p.x)); p.z = Math.max(-SIZE + R, Math.min(SIZE - R, p.z));
  for (const o of level.pillars) {
    const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = o.r + R;
    if (d < min && d > 1e-4) { p.x = o.x + (dx / d) * min; p.z = o.z + (dz / d) * min; }
  }
  if (Math.hypot(vx, vz) > 0.5) p.face = Math.atan2(vx, vz);
}
const newPlayer = (id, i, n) => { const a = (i / Math.max(1, n)) * Math.PI * 2; return { id, x: Math.sin(a) * 6, z: Math.cos(a) * 6, y: 0, vx: 0, vz: 0, vy: 0, face: a + Math.PI, score: 0, lastJump: 0 }; };

// Seeded level: every client builds the same pillars and the same coin spawn sequence.
function makeLevel(rng) {
  const pillars = [];
  for (let i = 0; i < 7; i++) {
    for (let tries = 0; tries < 20; tries++) {
      const x = rng.range(-SIZE + 3, SIZE - 3), z = rng.range(-SIZE + 3, SIZE - 3), r = rng.range(0.7, 1.4);
      if (Math.hypot(x, z) < 4 || pillars.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 2.2)) continue;
      pillars.push({ x, z, r, h: rng.range(1.2, 3) }); break;
    }
  }
  return { pillars, tint: rng.pick([0x7ed957, 0x8fd3ff, 0xffc36b, 0xd59bff]) };
}

export async function start(ctx) {
  const { ui, input, net } = ctx;
  const level = makeLevel(ctx.rng());
  const coinRng = ctx.rng(0xC01);                 // host spawns coins from a seeded sequence
  const gems = ctx.options.gems !== 'off';

  // ---------------------------------------------------------------- scene
  const renderer = ctx.three.createRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd8ff);
  scene.fog = new THREE.Fog(0x8fd8ff, 40, 90);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a8a5a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(10, 20, 8); sun.castShadow = ctx.quality().shadows;
  sun.shadow.mapSize.set(ctx.quality().shadowMap || 512, ctx.quality().shadowMap || 512);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 });
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(SIZE * 2, 1, SIZE * 2), new THREE.MeshToonMaterial({ color: level.tint }));
  floor.position.y = -0.5; floor.receiveShadow = true; scene.add(floor);
  const wallMat = new THREE.MeshToonMaterial({ color: 0xffffff });
  for (const [x, z, w, d] of [[0, -SIZE, SIZE * 2 + 1, 1], [0, SIZE, SIZE * 2 + 1, 1], [-SIZE, 0, 1, SIZE * 2], [SIZE, 0, 1, SIZE * 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), wallMat); m.position.set(x, 0.4, z); m.castShadow = m.receiveShadow = true; scene.add(m);
  }
  const pillarMat = new THREE.MeshToonMaterial({ color: 0xff8c42 });
  for (const p of level.pillars) { const m = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 1.1, p.h, 18), pillarMat); m.position.set(p.x, p.h / 2, p.z); m.castShadow = m.receiveShadow = true; scene.add(m); }
  const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.12, 20), gemGeo = new THREE.OctahedronGeometry(0.45);
  const coinMat = new THREE.MeshToonMaterial({ color: 0xffd23f, emissive: 0x553300 }), gemMat = new THREE.MeshToonMaterial({ color: 0x4de1ff, emissive: 0x0a3a55 });
  const resize = () => { renderer.setSize(ctx.container.clientWidth, ctx.container.clientHeight); camera.aspect = ctx.container.clientWidth / ctx.container.clientHeight; camera.updateProjectionMatrix(); };
  ctx.on('resize', resize); resize();
  ctx.on('settings', (k) => { if (k === 'quality') { ctx.three.applyQuality(renderer, sun); } });

  // Shared avatars: everyone looks like "themselves" (their color + hat).
  const bodies = new Map();
  for (const p of ctx.players) { const a = ctx.avatar.build(p); a.traverse((o) => { o.castShadow = true; }); scene.add(a); bodies.set(p.id, a); }
  const coinMeshes = new Map();

  // ---------------------------------------------------------------- state
  // HOST: authoritative `sim`. CLIENTS: `view` = latest host snapshot (+ local prediction for my own player).
  let sim = null, view = null, prevView = null, viewAt = 0, prevAt = 0, me = null, timeLeft = RULES.ROUND, ended = false;
  // Lag handling (copy this pattern): others are drawn from a timestamped buffer on the host's round clock (tOff maps
  // our clock to it), and my own predicted position is checked against where I was one round trip ago, not now.
  const bufs = new Map(), myHist = []; let tOff = null;
  const inputs = new Map();
  const myInput = { mx: 0, mz: 0, jump: 0 };

  function createSim(fromView) {
    const s = { players: new Map(), coins: [], nextCoin: 1, t: 0, bots: new Map() };
    ctx.players.forEach((p, i) => s.players.set(p.id, newPlayer(p.id, i, ctx.players.length)));
    if (fromView) { // host migration: continue from the last snapshot we saw
      s.t = RULES.ROUND - fromView.left;
      for (const [id, x, z, y, score] of fromView.p) { const q = s.players.get(id); if (q) Object.assign(q, { x, z, y, score }); }
      s.coins = fromView.c.map(([id, x, z, kind]) => ({ id, x, z, kind }));
      s.nextCoin = Math.max(1, ...s.coins.map((c) => c.id + 1));
    }
    for (const p of ctx.players) if (p.isBot) s.bots.set(p.id, { brain: new ctx.bots.Brain(ctx.bots.level), inp: { mx: 0, mz: 0, jump: 0 } });
    return s;
  }
  function spawnCoin() {
    for (let i = 0; i < 30; i++) {
      const x = coinRng.range(-SIZE + 1.5, SIZE - 1.5), z = coinRng.range(-SIZE + 1.5, SIZE - 1.5);
      if (level.pillars.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 1)) continue;
      sim.coins.push({ id: sim.nextCoin++, x, z, kind: gems && coinRng() < 0.15 ? 1 : 0 }); return;
    }
  }
  function botThink(p, b, dt) {
    if (!b.brain.ready(dt)) return;
    let best = null, bd = 1e9;
    for (const c of sim.coins) { const d = Math.hypot(c.x - p.x, c.z - p.z) / (c.kind ? 2 : 1); if (d < bd) { bd = d; best = c; } }
    if (!best) { b.inp.mx = b.inp.mz = 0; return; }
    const a = b.brain.jitter(Math.atan2(best.x - p.x, best.z - p.z));
    b.inp.mx = Math.sin(a); b.inp.mz = Math.cos(a);
    if (b.brain.mistake()) b.inp.jump++;
  }
  function hostStep(dt) {
    if (!ctx.started || ended) return;
    sim.t += dt;
    while (sim.coins.length < 9) spawnCoin();
    for (const [id, b] of sim.bots) botThink(sim.players.get(id), b, dt);
    for (const p of sim.players.values()) {
      if (!ctx.connected(p.id) && !ctx.player(p.id).isBot) continue;   // left: freeze
      const inp = p.id === ctx.myId ? myInput : sim.bots.get(p.id)?.inp || inputs.get(p.id) || { mx: 0, mz: 0, jump: p.lastJump };
      stepPlayer(p, inp, dt, level);
      for (let i = sim.coins.length - 1; i >= 0; i--) {
        const c = sim.coins[i];
        if (Math.hypot(c.x - p.x, c.z - p.z) < 1 && p.y < 1.5) { p.score += c.kind ? 3 : 1; sim.coins.splice(i, 1); net.toAll({ t: 'got', id: p.id, kind: c.kind, x: c.x, z: c.z }); }
      }
    }
    if (sim.t >= RULES.ROUND) finish();
  }
  function snapshot() {
    return { t: 's', left: Math.max(0, RULES.ROUND - sim.t), p: [...sim.players.values()].map((p) => [p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.y.toFixed(2), p.score]), c: sim.coins.map((c) => [c.id, +c.x.toFixed(2), +c.z.toFixed(2), c.kind]) };
  }
  function standings() {
    const src = sim ? [...sim.players.values()].map((p) => [p.id, p.score]) : (view?.p || []).map((r) => [r[0], r[4]]);
    const sorted = src.sort((a, b) => b[1] - a[1]);
    const groups = [];
    for (const [id, s] of sorted) { const g = groups[groups.length - 1]; if (g && g.s === s) g.ids.push(id); else groups.push({ s, ids: [id] }); }
    return groups.map((g) => g.ids);
  }
  function finish() {
    if (ended) return; ended = true;
    const scores = Object.fromEntries([...sim.players.values()].map((p) => [p.id, `${p.score} coins`]));
    ctx.endGame(standings(), { stats: scores });
  }

  // ---------------------------------------------------------------- networking
  net.onMessage((m, from) => {
    if (m.t === 'in' && net.isHost) inputs.set(from, m.i);               // client -> host: inputs
    else if (m.t === 's' && !net.isHost) {                               // host -> clients: snapshots
      prevView = view; prevAt = viewAt; view = m; viewAt = performance.now(); timeLeft = m.left;
      const t = RULES.ROUND - m.left, nowS = viewAt / 1000, off = t - nowS;     // host round clock
      tOff = tOff == null || off > tOff ? off : tOff + (off - tOff) * 0.04;
      for (const r of m.p) if (r[0] !== ctx.myId) { let b = bufs.get(r[0]); if (!b) bufs.set(r[0], (b = new SnapBuffer())); b.push(t, { x: r[1], z: r[2], y: r[3] }, nowS + tOff); }
      const mine = m.p.find((r) => r[0] === ctx.myId);
      if (mine && me) {
        me.score = mine[4];
        // the host's position for me is one trip old: compare it with where I predicted I'd be back then
        const back = viewAt - (net.ping() || 60) - 1000 / SNAP_HZ / 2;
        const then = myHist.find((h) => h.t >= back) || { x: me.x, z: me.z };
        const ex = mine[1] - then.x, ez = mine[2] - then.z;
        if (Math.hypot(ex, ez) > 3) { me.x = mine[1]; me.z = mine[2]; myHist.length = 0; }   // way off (respawn, desync): snap
        else if (Math.hypot(ex, ez) > 0.3) { me.x += ex * 0.1; me.z += ez * 0.1; }            // drifted: ease back
      }
    } else if (m.t === 'got') {
      if (m.id === ctx.myId) { ctx.audio.play('coin'); ui.toast(m.kind ? '💎 +3' : '🪙 +1', 'gold', 900); } else ctx.audio.tone('triangle', 900, 1200, 0.06, 0.04);
    }
  });
  function becomeHost() { sim = createSim(view); }
  if (net.isHost) sim = createSim(null);
  ctx.on('hostchange', ({ amHost }) => { if (amHost && !sim) becomeHost(); });
  const bgm = ctx.music('arcade');   // in-game music (core/music.js), stops by itself when the round ends
  ctx.on('go', () => bgm.start());
  ctx.on('go', () => ui.banner('GRAB THE COINS!', 1200));

  // Host: 60 Hz simulation (keeps running in background tabs) + snapshots at 15 Hz.
  let snapAcc = 0;
  ctx.tick((dt) => {
    if (!net.isHost || !sim) return;
    hostStep(dt);
    snapAcc += dt;
    if (snapAcc >= 1 / SNAP_HZ) { snapAcc = 0; net.toAll(snapshot(), false); view = snapshot(); timeLeft = view.left; }
  });

  // ---------------------------------------------------------------- input (camera-relative), prediction, render
  if (!ctx.spectator) me = newPlayer(ctx.myId, ctx.players.findIndex((p) => p.id === ctx.myId), ctx.players.length);
  let sendAcc = 0, camYaw = 0;
  ctx.frame((dt, now) => {
    const ax = input.axis();
    myInput.mx = ax.x; myInput.mz = ax.y; myInput.jump = input.presses('jump');
    if (!ctx.started) { myInput.mx = myInput.mz = 0; }
    if (!net.isHost && me && ctx.started && !ended) {
      stepPlayer(me, myInput, dt, level);                                // client prediction (host corrects softly)
      myHist.push({ t: performance.now(), x: me.x, z: me.z }); while (myHist.length && myHist[0].t < performance.now() - 1500) myHist.shift();
      sendAcc += dt; if (sendAcc > 1 / 30) { sendAcc = 0; net.toHost({ t: 'in', i: { ...myInput } }); }
    }
    // positions to draw
    const pos = new Map();
    if (net.isHost && sim) for (const p of sim.players.values()) pos.set(p.id, p);
    else if (view) {
      for (const r of view.p) {
        const b = bufs.get(r[0])?.sample(performance.now() / 1000 + (tOff ?? 0));
        pos.set(r[0], b ? { x: b.x, z: b.z, y: b.y, score: r[4] } : { x: r[1], z: r[2], y: r[3], score: r[4] });
      }
      if (me) pos.set(ctx.myId, me);
    }
    for (const [id, a] of bodies) {
      const p = pos.get(id); a.visible = !!p; if (!p) continue;
      const lx = a.position.x, lz = a.position.z;
      a.position.set(p.x, p.y || 0, p.z);
      const sp = Math.hypot(p.x - lx, p.z - lz) / Math.max(dt, 1e-3);
      if (sp > 0.3) a.rotation.y = Math.atan2(p.x - lx, p.z - lz);
      a.userData.setPose({ run: Math.min(1, sp / RULES.SPEED), t: now / 1000 });
    }
    // coins
    const coins = net.isHost && sim ? sim.coins.map((c) => [c.id, c.x, c.z, c.kind]) : view?.c || [];
    const live = new Set();
    for (const [id, x, z, kind] of coins) {
      live.add(id);
      let m = coinMeshes.get(id);
      if (!m) { m = new THREE.Mesh(kind ? gemGeo : coinGeo, kind ? gemMat : coinMat); m.castShadow = true; if (!kind) m.rotation.x = Math.PI / 2; scene.add(m); coinMeshes.set(id, m); }
      m.position.set(x, 0.8 + Math.sin(now / 300 + id) * 0.15, z); m.rotation.y = now / 400 + id; if (!kind) m.rotation.z = now / 400;
    }
    for (const [id, m] of coinMeshes) if (!live.has(id)) { scene.remove(m); coinMeshes.delete(id); }
    // camera follows me (or the leader when spectating)
    const focus = pos.get(ctx.myId) || [...pos.values()].sort((a, b) => (b.score || 0) - (a.score || 0))[0] || { x: 0, z: 0 };
    camYaw += (0 - camYaw) * dt;
    camera.position.lerp(new THREE.Vector3(focus.x * 0.6, 17, focus.z * 0.6 + 15), Math.min(1, dt * 4));
    camera.lookAt(focus.x * 0.8, 0, focus.z * 0.8);
    renderer.render(scene, camera);
    // HUD (shared zones)
    if (net.isHost && sim) timeLeft = Math.max(0, RULES.ROUND - sim.t);
    else if (ctx.started && !ended) timeLeft = Math.max(0, timeLeft - dt);
    const scores = [...pos.entries()].map(([id, p]) => ({ id, s: p.score || 0 })).sort((a, b) => b.s - a.s);
    const myScore = pos.get(ctx.myId)?.score ?? 0;
    ui.status(ctx.spectator ? '👀 Spectating' : `🪙 ${myScore} coin${myScore === 1 ? '' : 's'}`);
    ui.timer(ctx.started ? timeLeft : RULES.ROUND, { warn: 10 });
    ui.mini(scores.map(({ id, s }) => { const pl = ctx.player(id); return { id, name: pl?.name || '?', color: pl?.color ?? 0, value: s, me: id === ctx.myId }; }));
    ui.abilities([{ key: 'Space', label: 'Jump', ready: true }]);   // only show the actions your game really has
  });

  // Tab scoreboard rows (the hub adds party standings and pings below).
  ui.setScoreboard(() => ({ columns: ['Player', 'Coins'], rows: standings().flat().map((id) => [ui.esc(ctx.player(id)?.name || id), (net.isHost ? sim?.players.get(id)?.score : view?.p.find((r) => r[0] === id)?.[4]) ?? 0]) }));

  return {
    standings,           // used if the host ends the game early
    stop() {             // dispose everything this game created (renderer/listeners/timers are also auto-released by the hub)
      ctx.three.dispose(scene);
      coinGeo.dispose(); gemGeo.dispose();
      for (const a of bodies.values()) ctx.avatar.dispose(a);
    },
  };
}
