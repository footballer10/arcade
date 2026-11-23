// Downhill Rush — party hub plug-in. Race (or trick-battle) down a seeded mountain on skis or a snowboard.
// Host-authoritative: the host simulates every rider from inputs; each client predicts its own rider and
// replays unacknowledged inputs; other riders are interpolated ~0.1 s in the past.
// Net (ctx.net): client→host {t:'in', i:[[seq,...input]]}; host→each player {t:'snap', rt, e, me, ack, pr, ip, ib, endIn}.
import * as THREE from 'three';
import './tuning.js';
import { makeCourse, mulberry32, MAPS, MAP_IDS } from './course.js';
import { CLASSES, newEntity, stepEntity, bump, botInput, newBrain, sanitizeInput, packInput, trickName, landingPreview, grabValue, GRAB_KEYS, ITEMS, snowballHit, iceHit } from './physics.js';
import { createRenderer, buildCourse, disposeGroup, makeRider, poseRider, COLORS, Spray, makeMinimap, Trails, AirGuide, buildItemBoxes, spinItemBoxes, Snowballs, IcePatches } from './render.js';
import { sfx, setRide, shutdown as audioShutdown } from './audio.js';
import { AdaptiveDelay } from '../../core/interp.js';
export { manifest } from './manifest.js';

const SEND_HZ = 20;
const FIXED = 1 / 60;
const DIFFS = { easy: { name: 'Easy bots', h: 1.22, trick: 0.6 }, normal: { name: 'Normal bots', h: 1.07, trick: 1 }, hard: { name: 'Hard bots', h: 0.97, trick: 1.25 },
  // Extreme gets no drag handicap and no rubber-banding: it wins by driving better, with the same physics as a player
  extreme: { name: 'Extreme bots', h: 1, trick: 4, ext: true } };
const fmtTime = (t) => { if (t == null) return 'DNF'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

const CSS = `
.dh-layer{position:absolute;inset:0;pointer-events:none;font-family:var(--font);color:#fff;text-shadow:var(--stroke)}
.dh-layer canvas.lines{position:absolute;inset:0;width:100%;height:100%}
.dh-vig{position:absolute;inset:0;background:linear-gradient(to top,rgba(14,22,38,.42),rgba(14,22,38,0) 32%),radial-gradient(ellipse at center,rgba(0,0,0,0) 60%,rgba(10,16,32,.28) 100%)}
.dh-msg{position:absolute;top:30%;left:50%;transform:translateX(-50%);font-size:2rem;white-space:nowrap;transition:opacity .3s}
.dh-live{position:absolute;top:19%;left:50%;transform:translateX(-50%);text-align:center;font-size:1.6rem;color:#ffe27a;transition:opacity .15s;white-space:nowrap}
.dh-live small{display:block;font-size:1rem;color:#fff}
.dh-fin{position:absolute;top:22%;left:50%;transform:translateX(-50%);text-align:center;font-size:2.4rem}
.dh-fin small{display:block;font-size:1.1rem}
.dh-mapname{position:absolute;top:58%;left:50%;transform:translateX(-50%);text-align:center;font-size:2.2rem;transition:opacity .8s}
.dh-mapname small{display:block;font-size:1rem}
.dh-hint{position:absolute;bottom:150px;left:50%;transform:translateX(-50%);font-size:1rem;opacity:.9}
.dh-ghost{position:absolute;top:120px;right:18px;font-size:.95rem}
.dh-mini{position:absolute;right:14px;top:50%;transform:translateY(-35%);border-radius:10px;border:3px solid var(--ink)}
.dh-help{position:absolute;left:14px;top:150px;width:240px;background:var(--pill);border:3px solid var(--ink);border-radius:14px;padding:8px 10px;font-size:.78rem;line-height:1.45;transition:opacity .2s;opacity:.65}
.dh-help.air{opacity:1}.dh-help b{font-size:.9rem;color:var(--yellow)}
.dh-help .grabs{display:grid;grid-template-columns:1fr 1fr;gap:2px 6px;margin:4px 0}.dh-help .g{padding:1px 4px;border-radius:5px}.dh-help .g.on{background:var(--yellow);color:var(--ink);text-shadow:none}
.dh-prog{position:relative;width:46vw;height:12px;background:rgba(0,0,0,.4);border:3px solid var(--ink);border-radius:8px}
.dh-prog .m{position:absolute;top:-5px;width:12px;height:18px;border-radius:4px;margin-left:-6px;border:2px solid var(--ink)}.dh-prog .m.me{height:22px;top:-7px;border-color:#fff}`;

export async function start(ctx) {
  const { net, ui, input } = ctx;
  // ---------------------------------------------------------------- DOM + renderer
  const style = document.createElement('style'); style.textContent = CSS; ctx.container.appendChild(style);
  const R3 = ctx.three.createRenderer({ antialias: true });
  const { renderer, scene, camera, env } = createRenderer(R3);
  const layer = ui.el('div', 'dh-layer', `<canvas class="lines"></canvas><div class="dh-vig"></div><div class="dh-msg"></div><div class="dh-live"></div><div class="dh-mapname"></div>
    <div class="dh-fin"></div><div class="dh-hint"></div><div class="dh-ghost"></div><div class="dh-help"></div><canvas class="dh-mini" width="120" height="330"></canvas>`);
  ctx.container.appendChild(layer);
  const q = (c) => layer.querySelector('.' + c);
  const linesCv = layer.querySelector('canvas.lines'), lctx = linesCv.getContext('2d');
  const miniCv = q('dh-mini'), mctx = miniCv.getContext('2d');
  const fitLines = () => { linesCv.width = ctx.container.clientWidth; linesCv.height = ctx.container.clientHeight; env.resize(); };
  ctx.on('resize', fitLines); fitLines();
  const spray = new Spray(scene), trails = new Trails(scene), airGuide = new AirGuide(scene), snowballs = new Snowballs(scene), icePatches = new IcePatches(scene);
  const setGfx = () => { const qv = ctx.settings.get('quality'); env.setQuality(qv === 'high' ? 'high' : 'low'); renderer.shadowMap.enabled = qv !== 'low'; };
  setGfx();
  ctx.on('settings', (k) => { if (k === 'quality') setGfx(); });
  // progress bar (bottom-center zone)
  const prog = ui.el('div', 'dh-prog'); ui.zone('bc').appendChild(prog);

  // ---------------------------------------------------------------- state
  const S = {
    mode: net.isHost ? 'host' : 'client', myId: ctx.myId, race: null, help: true, ghosts: new Map(),
    viewers: new Set(),   // host: spectators that joined mid-race and also need snapshots
  };
  const hostSays = () => S.mode === 'host';

  // ---------------------------------------------------------------- race setup (everyone builds the same mountain from the seed)
  function startRace(seed, list, map, opts) {
    env.applyMap(map);
    trails.clear();
    opts = { gmode: opts.gmode === 'tricks' ? 'tricks' : 'race', items: opts.items !== false, diff: DIFFS[opts.diff] ? opts.diff : 'normal' };
    const course = makeCourse(seed, map, { items: opts.items });
    const mesh = buildCourse(course); scene.add(mesh);
    const boxes = buildItemBoxes(course); if (boxes) mesh.add(boxes);
    const rnd = mulberry32(seed ^ 0x5bd1e995);
    const race = { seed, course, mesh, startAt: performance.now() + 1e9, phase: 'countdown', ents: new Map(), firstFinish: null,
      over: false, sendT: 0, endIn: null, list, seq: 0, history: [], outbox: [], ghostRec: [], ghostRecT: 0,
      opts, boxes, projectiles: [], patches: [], finCount: 0, hostOff: null, map, ghostKey: map + ':' + seed };
    list.forEach((p, i) => {
      const row = Math.floor(i / 4), colI = i % 4;
      const z = 8 - row * 4, x = course.cxMain(z) + (colI - 1.5) * 4 + (row % 2) * 2;
      const e = newEntity(p.id, p.cls, x, z, course);
      const rider = makeRider(p.cls, p.color, p.id === S.myId ? null : p.name, false, p.hat);
      scene.add(rider.root, rider.shadow);
      const local = p.id === S.myId, bot = p.bot && S.mode !== 'client';
      const ent = { e, rider, info: { ...p }, local, bot, remote: null,
        hostSim: S.mode === 'host' && !local && !bot, inQ: [], ack: 0, lastInp: null,
        off: new THREE.Vector3(), prevAir: false, prevState: 'ride', prevMsg: 0,
        pv: { x: e.x, y: e.y, z: e.z, h: 0 }, view: { x: e.x, y: e.y, z: e.z, h: 0 }, pose: Object.create(e), buf: [], lastFire: 0, lastDrop: 0 };
      if (ent.bot) giveBrain(ent, rnd);
      race.ents.set(p.id, ent);
    });
    race.me = race.ents.get(S.myId) || null;
    race.mini = makeMinimap(course, miniCv.width, miniCv.height);
    spray.clear();
    S.race = race;
    camState.init = false;
    buildProgressMarkers();
    q('dh-fin').innerHTML = ''; q('dh-msg').textContent = '';
    q('dh-mapname').innerHTML = `${MAPS[map].name}<small>${MAPS[map].desc}</small>`; q('dh-mapname').style.opacity = 1;
    q('dh-hint').textContent = opts.gmode === 'tricks' ? 'TRICK BATTLE — most style points wins. Hit every kicker and rail!' : 'RACE — tricks give speed boosts. H shows the trick list.';
    buildHelp();
  }
  function giveBrain(ent, rnd = Math.random) {
    const r = S.race?.opts || opts;
    ent.brain = newBrain(mulberry32(Math.floor(rnd() * 1e9)), ent.info.cls);
    ent.brain.trickProb = Math.min(0.95, ent.brain.trickProb * DIFFS[r.diff].trick); ent.e.handicap = DIFFS[r.diff].h;
    if (DIFFS[r.diff].ext) { ent.brain.ext = true; ent.brain.skill = 1; }
  }
  function removeEnt(id) {
    const r = S.race; if (!r) return;
    const ent = r.ents.get(id); if (!ent) return;
    scene.remove(ent.rider.root, ent.rider.shadow); disposeGroup(ent.rider.root); disposeGroup(ent.rider.shadow);
    r.ents.delete(id);
    buildProgressMarkers();
  }

  // ---------------------------------------------------------------- network state sync
  const packEntR = (n, k = 100) => Math.round(n * k) / k;
  function packEnt(e) {
    const st = (e.state === 'wipe' ? 2 : e.air ? 1 : 0) | (e.tuck ? 4 : 0) | (e.finished ? 8 : 0) | (e.ghostT > 0 ? 16 : 0) | (e.grind >= 0 ? 32 : 0) | (e.shieldT > 0 ? 64 : 0) | (e.hitT > 0 ? 128 : 0);
    const r = packEntR;
    return [r(e.x), r(e.y), r(e.z), r(e.h, 1000), r(e.spin, 100), r(e.flip, 100), r(e.v), st, e.finished ? r(e.finishTime, 1000) : 0, r(e.lean), e.stance ? 1 : 0, e.grab || 0, r(e.slideAng || 0), Math.round(e.score), e.item || 0, r(e.butterT || 0), Math.round(e.bestPts), e.bestName];
  }
  const FULL_KEYS = ['x', 'y', 'z', 'h', 'v', 'vy', 'airT', 'spin', 'flip', 'wipeT', 'ghostT', 'jumpCD', 'boostT', 'pushX', 'pushZ', 'finishTime', 'lean', 'stance', 'grab', 'grind', 'grindT', 'slideAng', 'gpts', 'gname',
    'score', 'bestPts', 'bestName', 'lastTrick', 'tricks', 'butterT', 'butterCD', 'item', 'itemCD', 'shieldT', 'hitT', 'fireId', 'pickups', 'rankFrac'];
  function packFull(e) { return [...FULL_KEYS.map((k) => e[k]), (e.air ? 1 : 0) | (e.state === 'wipe' ? 2 : 0) | (e.finished ? 4 : 0) | (e.tuck ? 8 : 0) | (e.airSwitch ? 16 : 0), e.gt, e.gu]; }
  function applyFull(e, a) { FULL_KEYS.forEach((k, i) => { e[k] = a[i]; }); const f = a[FULL_KEYS.length]; e.air = !!(f & 1); e.state = (f & 2) ? 'wipe' : 'ride'; e.finished = !!(f & 4); e.tuck = !!(f & 8); e.airSwitch = !!(f & 16); e.gt = Array.isArray(a[FULL_KEYS.length + 1]) ? a[FULL_KEYS.length + 1].slice(0, 6) : [0, 0, 0, 0, 0, 0]; e.gu = Array.isArray(a[FULL_KEYS.length + 2]) ? a[FULL_KEYS.length + 2].slice(0, 6) : [0, 0, 0, 0, 0, 0]; }
  // Client-side prediction: rewind to the host's state for my rider, replay unacknowledged inputs.
  function reconcile(me, full, ack) {
    const r = S.race, e = me.e;
    const ox = e.x, oy = e.y, oz = e.z, oPush = Math.hypot(e.pushX, e.pushZ), wasFinished = e.finished, oFin = e.finishTime, oHit = e.hitT, oSh = e.shieldT;
    const msgId = e.msgId, msg = e.msg;
    applyFull(e, full);
    r.history = r.history.filter((h) => h.seq > ack);
    for (const h of r.history) stepEntity(e, h.inp, FIXED, r.course);
    e.msgId = msgId; e.msg = msg;
    if (wasFinished && !e.finished) { e.finished = true; e.finishTime = oFin; }
    const dx = ox - e.x, dy = oy - e.y, dz = oz - e.z;
    if (dx * dx + dy * dy + dz * dz < 64) me.off.add(new THREE.Vector3(dx, dy, dz)); else me.off.set(0, 0, 0);
    if (Math.hypot(e.pushX, e.pushZ) > oPush + 2.5) { flash('BUMP!', null, 500); sfx.bump(); }
    if (e.hitT > 0.5 && oHit <= 0) { flash('SNOWBALLED!', false); sfx.wipe(); }
    if (oSh > 0.5 && e.shieldT <= 0) { flash('BLOCKED!', true); sfx.bump(); }
  }
  function applyRemoteState(id, s, rt) {
    const ent = S.race && S.race.ents.get(id);
    if (!ent || ent.local || !Array.isArray(s)) return;
    ent.buf.push({ t: rt, x: s[0], y: s[1], z: s[2], h: s[3], spin: s[4], flip: s[5], v: s[6], slide: s[12] || 0 });
    if (ent.buf.length > 14) ent.buf.shift();
    const e = ent.e;
    e.v = s[6]; e.lean = s[9] || 0; e.stance = s[10] ? Math.PI : 0; e.grab = s[11] || 0; e.grind = (s[7] & 32) ? 0 : -1;
    e.state = (s[7] & 3) === 2 ? 'wipe' : 'ride'; e.air = (s[7] & 3) === 1; e.tuck = !!(s[7] & 4); e.ghostT = (s[7] & 16) ? 1 : 0;
    e.shieldT = (s[7] & 64) ? 1 : 0; e.hitT = (s[7] & 128) ? 1 : 0;
    e.score = s[13] || 0; e.item = s[14] || 0; e.butterT = s[15] || 0; e.bestPts = s[16] || 0; e.bestName = s[17] || '';
    if ((s[7] & 8) && !e.finished) { e.finished = true; e.finishTime = s[8]; onFinish(ent); }
  }
  function applySnap(msg) {
    const r = S.race;
    r.endIn = msg.endIn;
    if (r.phase === 'countdown' && msg.rt > 0) { r.startAt = performance.now() - msg.rt * 1000; }
    const off = performance.now() / 1000 - msg.rt;
    r.hostOff = r.hostOff == null ? off : Math.min(r.hostOff + 0.0004, off);
    interpDelay.observe(off - r.hostOff);   // how late vs the fastest snapshots (jitter): the relay needs more delay
    r.projectiles = Array.isArray(msg.pr) ? msg.pr : [];
    r.patches = Array.isArray(msg.ip) ? msg.ip.map(([x, z]) => ({ x, z })) : [];
    if (Array.isArray(msg.ib)) { const had = new Set(r.course.hiddenIndices()); for (const i of msg.ib) if (!had.has(i)) r.course.hideItem(i); }
    for (const row of msg.e) { const id = row[0]; if (id === S.myId) continue; applyRemoteState(id, row.slice(1), msg.rt); }
    if (msg.me && r.me && r.phase === 'race') reconcile(r.me, msg.me, msg.ack);
    for (const id of [...r.ents.keys()]) if (id !== S.myId && !msg.e.some((row) => row[0] === id)) removeEnt(id);
  }
  const INTERP_DELAY = 0.11;   // on a direct link; grows on a jittery one (relay)
  const interpDelay = new AdaptiveDelay({ min: INTERP_DELAY, start: INTERP_DELAY, interval: 0.05 });
  function interpRemote(ent) {
    const b = ent.buf, r = S.race; if (!b.length || r.hostOff == null) return;
    const t = performance.now() / 1000 - r.hostOff - interpDelay.value, e = ent.e;
    let i = b.length - 1; while (i > 0 && b[i].t > t) i--;
    const A = b[i], B = b[i + 1];
    if (B && t >= A.t) {
      const k = Math.min(1, (t - A.t) / Math.max(1e-3, B.t - A.t)), L = (p, qq) => p + (qq - p) * k;
      const jump = (B.x - A.x) ** 2 + (B.z - A.z) ** 2 > 400;
      if (jump) { e.x = B.x; e.y = B.y; e.z = B.z; e.h = B.h; e.spin = B.spin; e.flip = B.flip; e.slideAng = B.slide; }
      else { e.x = L(A.x, B.x); e.y = L(A.y, B.y); e.z = L(A.z, B.z); e.h = L(A.h, B.h); e.spin = L(A.spin, B.spin); e.flip = L(A.flip, B.flip); e.slideAng = L(A.slide, B.slide); }
    } else {
      const ex = Math.max(0, Math.min(0.25, t - A.t)), mv = e.state !== 'wipe' && !e.finished ? A.v : 0;
      e.x = A.x + Math.sin(A.h) * mv * ex; e.z = A.z + Math.cos(A.h) * mv * ex; e.h = A.h; e.spin = A.spin; e.flip = A.flip; e.slideAng = A.slide;
      e.y = e.air || e.grind >= 0 ? A.y : r.course.groundH(e.x, e.z);
    }
  }
  net.onMessage((m, from) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'in' && hostSays()) {
      const ent = S.race && S.race.ents.get(from);
      if (!ent || !ent.hostSim || !Array.isArray(m.i)) return;
      for (const a of m.i.slice(0, 40)) {
        const inp = sanitizeInput(a);
        if (inp && Number.isInteger(a[0]) && a[0] > (ent.inQ.length ? ent.inQ[ent.inQ.length - 1].seq : ent.ack)) ent.inQ.push({ seq: a[0], inp });
      }
      if (ent.inQ.length > 45) ent.inQ.splice(0, ent.inQ.length - 45);
    } else if (m.t === 'snap' && !hostSays() && S.race) applySnap(m);
  });

  // ---------------------------------------------------------------- input (standard map + downhill extras)
  let jumpBuf = 0, useBuf = 0, butterBuf = 0;
  const stale = new Set();
  const K = (c) => input.key(c);
  const fresh = (c) => K(c) && !stale.has(c);
  input.on('press', (a) => { if (a === 'jump') jumpBuf = 0.18; else if (a === 'use' || a === 'primary') useBuf = 0.2; else if (a === 'special') butterBuf = 0.15; });
  input.on('key', (code, down) => {
    if (!down) { stale.delete(code); return; }
    if (code === 'KeyB') butterBuf = 0.15;
    if (code === 'KeyX') useBuf = 0.2;
    if (code === 'KeyH') { S.help = !S.help; q('dh-help').style.display = S.help ? '' : 'none'; }
  });
  let steerDir = 0, steerHeld = 0;
  function steerAmount() {
    const L = K('KeyA') || K('ArrowLeft'), Rr = K('KeyD') || K('ArrowRight');
    const dir = (Rr ? 1 : 0) - (L ? 1 : 0);
    if (dir !== steerDir) { steerDir = dir; steerHeld = 0; }
    if (!dir) return 0;
    steerHeld += FIXED;
    return dir * Math.min(1, 0.14 + steerHeld * steerHeld * 9 + steerHeld * 0.6);
  }
  const GRAB_CODES = [['KeyR', 'KeyJ'], ['KeyF', 'KeyK'], ['KeyT', 'KeyL'], ['KeyG', 'KeyI'], ['KeyC', 'KeyU'], ['KeyV', 'KeyO']];
  function localInput(e) {
    if (S.autopilot && S.race?.me) { const me = S.race.me; me.brain ||= newBrain(mulberry32(7), me.info.cls); return botInput(e, me.brain, S.race.course, FIXED); }
    const inp = { steer: steerAmount(), tuck: !!(K('KeyW') || K('ArrowUp')), brake: !!(K('KeyS') || K('ArrowDown')), jump: jumpBuf > 0, spin: 0, flip: 0, grab: 0, use: useBuf > 0, butter: butterBuf > 0 };
    if (e.air) {
      inp.grab = GRAB_CODES.findIndex(([a, b]) => K(a) || K(b)) + 1;
      // ignore steer taps for a beat after liftoff: a mogul bump shouldn't turn a steering
      // correction into a trick spin — only a real jump stays airborne long enough for this to matter
      if (e.airT > 0.12) {
        inp.spin = ((fresh('ArrowRight') || fresh('KeyD')) ? 1 : 0) - ((fresh('ArrowLeft') || fresh('KeyA')) ? 1 : 0);
        inp.flip = ((fresh('ArrowUp') || fresh('KeyW')) ? 1 : 0) - ((fresh('ArrowDown') || fresh('KeyS')) ? 1 : 0);
      }
    }
    return inp;
  }

  // ---------------------------------------------------------------- simulation
  let acc = 0;
  const raceTime = () => (S.race ? (performance.now() - S.race.startAt) / 1000 : 0);
  function simStep(dt) {
    const r = S.race; const rt = raceTime();
    r.course.tickItems(dt);
    for (const ent of r.ents.values()) {
      if (!ent.local && !ent.bot && !ent.hostSim) continue;
      const e = ent.e;
      const wasAir = e.air, wasState = e.state, airT0 = e.airT;
      let steps = 1, inp;
      if (ent.local) {
        inp = localInput(e);
        if (S.mode === 'client') { const seq = ++r.seq; r.history.push({ seq, inp }); r.outbox.push(packInput(seq, inp)); if (r.history.length > 300) r.history.shift(); }
      } else if (ent.bot) inp = botInput(e, ent.brain, r.course, dt);
      for (let k = 0; k < steps; k++) {
        if (ent.hostSim) {
          const qq = ent.inQ.shift();
          if (qq) { inp = qq.inp; ent.ack = qq.seq; ent.lastInp = { ...qq.inp, jump: false }; if (ent.inQ.length > 6 && k === 0) steps = 2; }
          else inp = ent.lastInp || { steer: 0 };
        }
        const m = e.msgId;
        stepEntity(e, inp, dt, r.course);
        if (ent.local) {
          if (!wasAir && e.air) { stale.clear(); for (const c of input.keysDown?.() || []) stale.add(c); jumpBuf = 0; if (inp.jump) sfx.jump(); }
          if (wasAir && !e.air && e.state === 'ride' && airT0 > 0.35) sfx.land(e.msg && e.msgId !== m && e.msg.good);
          if (e.msgId !== m && e.msg) {
            flash(e.msg.text, e.msg.good);
            const tx = e.msg.text;
            if (tx.includes(' pts')) sfx.trick(); else if (tx === 'BOOST!' || tx === 'ROCKET!' || tx === 'BALLOON BOOST!') sfx.boost();
            else if (tx.startsWith('GOT') || tx === 'SHIELD UP' || tx === 'ICE TRAP SET') sfx.beep(true);
            else if (tx === 'SNOWBALLED!' || tx === 'SLIPPED ON ICE!') sfx.wipe();
          }
          if (wasState !== 'wipe' && e.state === 'wipe') sfx.wipe();
        }
      }
      if (e.finished && !e.finishTime) { e.finishTime = rt; onFinish(ent); }
    }
    if (S.mode === 'client') return;
    const list = [...r.ents.values()];
    for (const a of list) for (const b of list) {
      if (a !== b && a.e.shieldT <= 0 && bump(a.e, b.e) && a.local) { flash('BUMP!', null, 500); sfx.bump(); }
    }
    const st = standings();
    st.forEach((ent, i) => { ent.e.rankFrac = st.length > 1 ? i / (st.length - 1) : 0.5; });
    const humans = list.filter((x) => !x.info.bot);
    const refZ = humans.length ? humans.reduce((a, x) => a + x.e.z, 0) / humans.length : 0;
    for (const ent of list) {
      const e = ent.e;
      if (ent.bot) {
        e.handicap = DIFFS[r.opts.diff].h + (ent.brain.ext ? 0 : Math.max(-1, Math.min(1, (e.z - refZ) / 160)) * 0.08);
        ent.brain.threatBehind = ent.brain.ext && list.some((o) => o !== ent && e.z - o.e.z > 3 && e.z - o.e.z < 35 && Math.abs(o.e.x - e.x) < 5);
        ent.brain.targetAhead = list.some((o) => o !== ent && o.e.z - e.z > 4 && o.e.z - e.z < 45 && Math.abs(o.e.x - e.x - Math.sin(e.h) * (o.e.z - e.z)) < 3.5);
      }
      if (e.fireId !== ent.lastFire) {
        ent.lastFire = e.fireId;
        const sp = Math.max(e.v, 14) + 26;
        r.projectiles.push({ x: e.x + Math.sin(e.h) * 1.5, z: e.z + Math.cos(e.h) * 1.5, y: e.y + 0.8, vx: Math.sin(e.h) * sp, vz: Math.cos(e.h) * sp, life: 2.6, owner: ent });
        if (ent.local) sfx.jump();
      }
      if (e.dropId !== ent.lastDrop) {
        ent.lastDrop = e.dropId;
        r.patches.push({ x: e.x - Math.sin(e.h) * 2.2, z: e.z - Math.cos(e.h) * 2.2, t: 6.5, owner: ent });
      }
    }
    for (const p of r.projectiles) {
      if (Array.isArray(p)) continue;
      p.x += p.vx * dt; p.z += p.vz * dt; p.life -= dt;
      p.y += (r.course.groundH(p.x, p.z) + 0.7 - p.y) * Math.min(1, dt * 12);
      for (const ent of list) {
        const e = ent.e;
        if (ent === p.owner || (e.x - p.x) ** 2 + (e.z - p.z) ** 2 > 2.6 || Math.abs(e.y - p.y) > 2.6) continue;
        if (snowballHit(e)) { p.life = 0; spray.emit(p.x, p.y, p.z, 0, 3, 0, 9, 40); if (ent.local && e.msg) { flash(e.msg.text, e.msg.good); sfx.wipe(); } else if (p.owner.local) { flash('HIT ' + ent.info.name + '!', true, 900); sfx.trick(); } break; }
      }
    }
    r.projectiles = r.projectiles.filter((p) => !Array.isArray(p) && p.life > 0);
    for (const p of r.patches) {
      p.t -= dt;
      for (const ent of list) {
        if (ent === p.owner) continue;
        const e = ent.e;
        if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 > 2.4) continue;
        if (iceHit(e)) { if (ent.local && e.msg) { flash(e.msg.text, e.msg.good); sfx.bump(); } p.t = Math.min(p.t, 2); }
      }
    }
    r.patches = r.patches.filter((p) => p.t > 0);
  }
  function onFinish(ent) {
    const r = S.race;
    if (r.firstFinish == null) r.firstFinish = raceTime();
    if (S.mode !== 'client' && r.opts.gmode === 'tricks') { const bonus = [500, 300, 150][r.finCount] || 0; ent.e.score += bonus; if (ent.local && bonus) flash(`Finish bonus +${bonus} pts`, true, 1800); }
    r.finCount++;
    if (ent.local) {
      sfx.finish();
      const best = S.ghosts.get(r.ghostKey);
      if (r.ghostRec.length && (!best || ent.e.finishTime < best.time)) S.ghosts.set(r.ghostKey, { time: ent.e.finishTime, frames: r.ghostRec, cls: ent.e.cls });
      q('dh-fin').innerHTML = `FINISHED ${ordinal(rankOf(ent))}!<small>${fmtTime(ent.e.finishTime)}</small>`;
    }
  }
  function standings() {
    const arr = [...S.race.ents.values()];
    if (S.race.opts.gmode === 'tricks') return arr.sort((a, b) => b.e.score - a.e.score || b.e.z - a.e.z);
    arr.sort((a, b) => {
      if (a.e.finished && b.e.finished) return a.e.finishTime - b.e.finishTime;
      if (a.e.finished) return -1; if (b.e.finished) return 1;
      return b.e.z - a.e.z;
    });
    return arr;
  }
  const rankOf = (ent) => standings().indexOf(ent) + 1;
  function hostCheckEnd() {
    const r = S.race; if (r.over || r.phase !== 'race') return;
    const rt = raceTime();
    const ents = [...r.ents.values()];
    const humans = ents.filter((x) => !x.info.bot && ctx.connected(x.info.id));
    const allHumansDone = humans.every((x) => x.e.finished);
    const allDone = ents.every((x) => x.e.finished);
    r.endIn = r.firstFinish != null ? Math.max(0, 30 - (rt - r.firstFinish)) : null;
    if (allHumansDone && !allDone) {
      if (r.humansDoneAt == null) r.humansDoneAt = rt;
      r.endIn = Math.min(r.endIn ?? 99, Math.max(0, 12 - (rt - r.humansDoneAt)));
    }
    if (allDone || r.endIn === 0 || rt > 200) {
      r.over = true;
      const order = standings(), notes = [];
      const bestTrick = [...order].sort((a, b) => b.e.bestPts - a.e.bestPts)[0];
      if (bestTrick && bestTrick.e.bestPts > 0) notes.push(`🏅 Best trick: ${bestTrick.info.name} — ${bestTrick.e.bestName} (${bestTrick.e.bestPts} pts)`);
      const style = [...order].sort((a, b) => b.e.score - a.e.score)[0];
      if (r.opts.gmode === 'race' && style && style.e.score > 0) notes.push(`✨ Most style: ${style.info.name} (${Math.round(style.e.score)} pts)`);
      const stats = Object.fromEntries(order.map((x) => [x.info.id, `${fmtTime(x.e.finished ? x.e.finishTime : null)} · ${Math.round(x.e.score).toLocaleString()} style`]));
      ctx.setTimeout(() => ctx.endGame(order.map((x) => x.info.id), { stats, note: notes.join('   ') }), 1500);
    }
  }
  function netTick(dt) {
    const r = S.race; if (!r) return;
    r.sendT -= dt;
    if (r.sendT > 0) return;
    r.sendT = 1 / SEND_HZ;
    if (S.mode === 'client' && r.outbox.length) { net.toHost({ t: 'in', i: r.outbox }); r.outbox = []; }
    if (S.mode === 'host') {
      const e = [];
      for (const [id, ent] of r.ents) e.push([id, ...packEnt(ent.e)]);
      const rt = Math.round(raceTime() * 1000) / 1000;
      const pr = r.projectiles.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10]);
      const ip = r.patches.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]);
      const ib = r.course.hiddenIndices();
      const targets = new Set([...ctx.players.filter((p) => !p.isBot && p.id !== S.myId && ctx.connected(p.id)).map((p) => p.id), ...S.viewers]);
      for (const pid of targets) {
        const ent = r.ents.get(pid);
        net.to(pid, { t: 'snap', rt: r.phase === 'race' ? rt : -1, e, endIn: r.endIn, me: ent ? packFull(ent.e) : null, ack: ent ? ent.ack : 0, pr, ip, ib });
      }
    }
  }

  // ---------------------------------------------------------------- HUD
  let msgTimer = 0;
  function flash(text, good, ms = 1400) {
    const el = q('dh-msg'); el.textContent = text;
    el.style.color = good === true ? '#7dffb0' : good === false ? '#ff7a8a' : '#fff';
    el.style.opacity = 1; msgTimer = ms / 1000;
  }
  const helpEls = [];
  function buildHelp() {
    const P = CLASSES[S.race?.me?.e.cls || 'ski'], el = q('dh-help');
    el.innerHTML = `<b>TRICKS</b> <small>(H hides)</small>
      <div><kbd>←</kbd><kbd>→</kbd> spin &nbsp; <kbd>↑</kbd><kbd>↓</kbd> flip</div>
      <div class="grabs">${P.grabs.map((g, i) => `<span class="g"><kbd>${GRAB_KEYS[i]}</kbd> ${g}</span>`).join('')}</div>
      <div>hold a grab in the air, <u>let go before landing</u></div>
      <div>flip + spin = Rodeo / Misty · mix them for more points</div>
      <div><kbd>Q</kbd> butter 180 · rails: <kbd>A</kbd><kbd>D</kbd> slide, <kbd>Space</kbd> pop</div>
      <div>arrow on the snow: <span style="color:#5dffa5">green</span> = clean landing, <span style="color:#ff6b7a">red</span> = crash</div>`;
    helpEls.length = 0; el.querySelectorAll('.g').forEach((g) => helpEls.push(g));
    el.style.display = S.help && S.race?.me ? '' : 'none';
  }
  function buildProgressMarkers() {
    prog.innerHTML = '';
    if (!S.race) return;
    for (const ent of S.race.ents.values()) {
      const d = document.createElement('div'); d.className = 'm' + (ent.local ? ' me' : '');
      d.style.background = '#' + ent.info.color.toString(16).padStart(6, '0');
      prog.appendChild(d); ent.marker = d;
    }
  }
  function updateHud(dt) {
    const r = S.race; if (!r) return;
    const rt = raceTime();
    const me = r.me;
    const st = standings();
    if (me) {
      const e = me.e;
      ui.status(`${ordinal(rankOf(me))} <small>/ ${r.ents.size}</small><br><small>✨ STYLE ${Math.round(e.score).toLocaleString()}</small>`);
      const it = ITEMS[e.item];
      const slots = [{ key: 'Speed', label: `${Math.round(e.v * 3.6)} km/h${e.boostT > 0 ? ' 🔥' : ''}`, ready: e.boostT > 0, wide: true }];
      if (r.opts.items) slots.push({ key: 'E', label: it ? `${it.icon} ${it.name}` : 'no item', ready: !!it, dim: !it });
      ui.abilities(slots);
      if (e.finished) {
        const left = r.endIn != null && !r.over ? `<small>Results in ${Math.ceil(r.endIn)}s</small>` : '';
        q('dh-fin').innerHTML = `FINISHED ${ordinal(rankOf(me))}!<small>${fmtTime(e.finishTime)}</small>${left}`;
      } else if (r.endIn != null && r.endIn < 30) q('dh-fin').innerHTML = `<small>Race closes in ${Math.ceil(r.endIn)}s</small>`;
    } else ui.status(`👀 Spectating<br><small>${MAPS[r.map].name}</small>`);
    ui.timer(null, { text: fmtTime(me?.e.finished ? me.e.finishTime : Math.max(0, r.phase === 'race' ? rt : 0)) });
    ui.mini(st.map((x, i) => ({ id: x.info.id, name: `${i + 1}. ${x.info.name}`, color: '#' + x.info.color.toString(16).padStart(6, '0'), value: r.opts.gmode === 'tricks' ? Math.round(x.e.score) : x.e.finished ? fmtTime(x.e.finishTime) : '', me: x.local })), r.opts.gmode === 'tricks' ? 'Trick Battle' : 'Race');
    const dots = [];
    if (r.ghost && me) { const g = r.ghost.e; dots.push({ x: g.x, z: g.z, color: '#ffffff', alpha: 0.5 }); }
    for (const ent of r.ents.values()) if (!ent.local) dots.push({ x: ent.e.x, z: ent.e.z, color: '#' + ent.info.color.toString(16).padStart(6, '0') });
    if (me) dots.push({ x: me.e.x, z: me.e.z, color: '#' + me.info.color.toString(16).padStart(6, '0'), me: true });
    r.mini.draw(mctx, dots);
    for (const ent of r.ents.values()) if (ent.marker) ent.marker.style.left = (Math.max(0, Math.min(1, ent.e.z / r.course.L)) * 100) + '%';
    if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) q('dh-msg').style.opacity = 0; }
    const live = q('dh-live');
    if (me && me.e.grind >= 0) {
      const e = me.e;
      live.innerHTML = `${Math.abs(e.slideAng) > 1 ? 'Boardslide' : '50-50'}<small>${e.grindT.toFixed(1)}s · A/D slide · Space pops off</small>`; live.style.opacity = 1;
    } else if (me && me.e.air && me.e.airT > 0.2 && me.e.state === 'ride') {
      const e = me.e, deg = Math.round(Math.abs(e.spin) * 180 / Math.PI / 10) * 10, pv = landingPreview(e);
      const name = trickName(e);
      const col = pv.q < 0 ? '#ff6b7a' : pv.q > 0.85 ? '#5dffa5' : pv.q > 0.5 ? '#c4ff6b' : '#ffcf5a';
      live.innerHTML = `${name || '&nbsp;'}<small>${deg ? deg + '° · ' : ''}<span style="color:${col}">landing: ${pv.label}${pv.sw && pv.q >= 0 ? ' (switch)' : ''}</span>${e.grab ? ' · let go of the grab!' : ''}</small>`;
      live.style.opacity = 1;
    } else live.style.opacity = 0;
    if (S.help && me) {
      const e = me.e;
      for (let i = 0; i < 6; i++) { helpEls[i]?.classList.toggle('on', e.grab === i + 1); if (helpEls[i]) helpEls[i].style.opacity = (0.4 + 0.6 * grabValue(e, i)).toFixed(2); }
      q('dh-help').classList.toggle('air', e.air || e.grind >= 0);
    }
    if (rt > 8) q('dh-hint').textContent = '';
    if (rt > 3) q('dh-mapname').style.opacity = 0;
  }
  function drawSpeedLines(v) {
    lctx.clearRect(0, 0, linesCv.width, linesCv.height);
    if (v < 27) return;
    const k = Math.min(1, (v - 27) / 20);
    const W = linesCv.width, H = linesCv.height, cx = W / 2, cy = H * 0.45;
    const n = Math.floor(12 + k * 40);
    lctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.4 * k})`; lctx.lineWidth = 2; lctx.beginPath();
    const maxR = Math.hypot(W, H) / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = maxR * (0.45 + Math.random() * 0.3), r1 = r0 + maxR * (0.1 + 0.25 * k * Math.random());
      lctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); lctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    }
    lctx.stroke();
  }

  // ---------------------------------------------------------------- camera (spectators follow the leader)
  const camState = { init: false, h: 0, pos: new THREE.Vector3() };
  const tmpV = new THREE.Vector3(), lookV = new THREE.Vector3();
  function focusEnt() { const r = S.race; return r.me || standings().find((x) => !x.e.finished) || standings()[0]; }
  function updateCamera(dt) {
    const r = S.race; const f = r && focusEnt(); if (!f) return;
    const e0 = f.view, o = f.off;
    const e = { x: e0.x + o.x, y: e0.y + o.y, z: e0.z + o.z, h: e0.h, v: f.e.v };
    const inAir = f.e.air && f.e.airT > 0.25;
    if (!camState.init || camState.target !== f) { camState.target = f; camState.h = e.h; camState.init = true; camState.pos.set(e.x - Math.sin(e.h) * 9, e.y + 4, e.z - Math.cos(e.h) * 9); }
    camState.h += (e.h - camState.h) * (1 - Math.exp(-5 * dt));
    const sx = Math.sin(camState.h), sz = Math.cos(camState.h);
    camState.air = (camState.air || 0) + ((inAir ? 1 : 0) - (camState.air || 0)) * (1 - Math.exp(-4 * dt));
    const dist = 7.9 + Math.min(e.v, 50) * 0.035 + camState.air * 1.8;
    tmpV.set(e.x - sx * dist, 0, e.z - sz * dist);
    const gy = r.course.groundH(tmpV.x, tmpV.z);
    tmpV.y = Math.max(e.y + 7.2 + camState.air * 1.2, gy + 5.2);
    camState.pos.lerp(tmpV, 1 - Math.exp(-9 * dt));
    camera.position.copy(camState.pos);
    lookV.set(e.x + sx * 6, e.y + 0.4, e.z + sz * 6);
    camera.lookAt(lookV);
    const fov = 70 + Math.max(0, Math.min(1, (e.v - 18) / 32)) * 20;
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt)); camera.updateProjectionMatrix(); }
  }

  // ---------------------------------------------------------------- main loop
  let lastT = performance.now(), slowT = 0, autoLowDone = false, fpsAcc = 0, fpsN = 0;
  function tick(render) {
    const now = performance.now();
    const dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
    const r = S.race;
    if (r) {
      if (r.phase === 'countdown' && raceTime() >= 0) r.phase = 'race';
      if (r.phase === 'race' && !r.over) {
        acc += dt;
        let n = 0;
        while (acc >= FIXED && n < 16) {
          for (const ent of r.ents.values()) { const e = ent.e, p = ent.pv; p.x = e.x; p.y = e.y; p.z = e.z; p.h = e.h; }
          simStep(FIXED); acc -= FIXED; n++;
          if (jumpBuf > 0) jumpBuf -= FIXED; if (useBuf > 0) useBuf -= FIXED; if (butterBuf > 0) butterBuf -= FIXED;
        }
        if (n === 16) acc = 0;
        if (r.me && !r.me.e.finished) { r.ghostRecT -= dt; if (r.ghostRecT <= 0) { r.ghostRecT += 0.1; const e = r.me.e; r.ghostRec.push([e.x, e.y, e.z, e.h, e.spin, e.flip, raceTime()]); } }
        if (S.mode !== 'client') hostCheckEnd();
      } else if (r.phase === 'race' && r.over) {
        for (const ent of r.ents.values()) if (ent.local || ent.bot || ent.hostSim) stepEntity(ent.e, { steer: 0, brake: true }, dt, r.course);
      }
      netTick(dt);
    }
    if (!render || !r) return;
    const c = r.course;
    const al = r.phase === 'race' && !r.over ? Math.min(1, acc / FIXED) : 1;
    for (const ent of r.ents.values()) {
      const e0 = ent.e, v = ent.view, p = ent.pv;
      const simulated = ent.local || ent.bot || ent.hostSim;
      if (!simulated) interpRemote(ent);
      if (simulated && al < 1 && (e0.x - p.x) ** 2 + (e0.z - p.z) ** 2 < 16) { v.x = p.x + (e0.x - p.x) * al; v.y = p.y + (e0.y - p.y) * al; v.z = p.z + (e0.z - p.z) * al; v.h = p.h + (e0.h - p.h) * al; }
      else { v.x = e0.x; v.y = e0.y; v.z = e0.z; v.h = e0.h; }
      ent.off.multiplyScalar(Math.exp(-8 * dt));
      const e = ent.pose; e.x = v.x; e.y = v.y; e.z = v.z; e.h = v.h;
      const gy = c.groundH(e.x, e.z);
      const sh = Math.sin(e.h), ch = Math.cos(e.h);
      const slope = (c.groundH(e.x - sh, e.z - ch) - c.groundH(e.x + sh, e.z + ch)) / 2;
      poseRider(ent.rider, e, gy, now / 1000, slope, dt, ent.off);
      const nearCam = Math.abs(e.z - camera.position.z) < 120;
      if (nearCam && r.phase === 'race') {
        if (!e.air && e.grind < 0 && e.state === 'ride' && e.v > 6) {
          const carve = Math.abs(e.lean || 0);
          const rate = (e.v / 40) * 25 + carve * 70 * Math.min(1, e.v / 15);
          const n = Math.floor(rate * dt + Math.random());
          if (n > 0) { const sideX = Math.cos(e.h), sideZ = -Math.sin(e.h), sgn = (e.lean || 0) >= 0 ? 1 : -1; spray.emit(e.x - sh * 0.7, gy, e.z - ch * 0.7, sh * e.v * 0.35 + sideX * sgn * carve * 7, 2 + carve * 2, ch * e.v * 0.35 + sideZ * sgn * carve * 7, 2.2, n); }
        }
        if (ent.prevAir && !e.air && e.state === 'ride') spray.emit(e.x, gy, e.z, sh * e.v * 0.3, 3, ch * e.v * 0.3, 6, 35);
        if (ent.prevState !== 'wipe' && e.state === 'wipe') spray.emit(e.x, gy, e.z, sh * e.v * 0.4, 4, ch * e.v * 0.4, 8, 70);
      }
      ent.prevAir = e.air; ent.prevState = e.state;
      if (nearCam) trails.add(ent.info.id, e.x, gy, e.z, e.h, e.cls === 'ski' ? [-0.15, 0.15] : [0], e.cls === 'ski' ? 0.05 : 0.14, !e.air && e.grind < 0 && e.state === 'ride' && e.y - gy < 0.15);
    }
    spray.update(dt);
    spinItemBoxes(r.boxes, r.course, now / 1000);
    snowballs.update(r.projectiles.map((p) => (Array.isArray(p) ? p : [p.x, p.y, p.z])), now / 1000);
    icePatches.update(r.patches.map((p) => [p.x, p.z]), r.course.groundH);
    { const m = r.me, e = m && m.pose;
      const showG = !!e && e.air && e.airT > 0.12 && e.state === 'ride' && !e.finished;
      if (showG) { const pv = landingPreview(m.e); airGuide.update(true, e.x + m.off.x, c.groundH(e.x, e.z), e.z + m.off.z, e.h, e.h + e.stance + e.spin, pv.q); } else airGuide.update(false); }
    const me = r.me?.e;
    setRide(me ? me.v : 0, me ? Math.abs(me.lean || 0) : 0, me ? !me.air : false, !!me && r.phase === 'race' && !r.over && me.state === 'ride' && !me.finished);
    updateHud(dt);
    updateCamera(dt);
    { const fe = focusEnt()?.view; if (fe) env.follow(fe.x, fe.y, fe.z + 10, dt); }
    drawSpeedLines(me ? me.v : 0);
    env.render();
    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 0.5) {
      const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
      if (env.quality === 'high' && !autoLowDone) { slowT = fps < 28 ? slowT + 0.5 : 0; if (slowT >= 3) { autoLowDone = true; ctx.settings.set('quality', 'med'); ui.toast('Switched to medium graphics for speed (Esc → Settings)', '', 4000); } }
    }
  }
  ctx.frame(() => tick(true));
  ctx.tick(() => { if (document.hidden) tick(false); });   // background tabs: keep simulating + sending

  // ---------------------------------------------------------------- party hooks
  const opts = { gmode: ctx.options.gmode, items: ctx.options.items !== 'off', diff: ctx.bots.level.tier || ctx.bots.level.key };
  const map = MAP_IDS.includes(ctx.options.map) ? ctx.options.map : ctx.rng(0xd0).pick(MAP_IDS);
  const list = ctx.players.map((p) => ({ id: p.id, name: p.name, cls: ctx.picks[p.id]?.cls === 'board' ? 'board' : 'ski', bot: p.isBot, color: p.colorHex, hat: p.hat }));
  startRace(ctx.seed, list, map, opts);
  const bgm = ctx.music('downhill');   // in-game music (core/music.js), stops by itself when the round ends
  ctx.on('go', () => bgm.start());
  ctx.on('go', () => { if (S.race) { S.race.startAt = performance.now(); } });
  ctx.on('leave', (id) => { if (!hostSays() || !S.race) return; const ent = S.race.ents.get(id); if (ent) { ent.left = true; removeEnt(id); } });
  ctx.on('join', (id) => { if (hostSays()) S.viewers.add(id); });
  ctx.on('hostchange', ({ amHost }) => {
    const r = S.race; if (!r) return;
    if (!amHost) { r.history = []; r.outbox = []; return; }       // new host doesn't know our old input sequence numbers
    if (S.mode === 'host') return;
    S.mode = 'host';
    for (const ent of r.ents.values()) {
      if (ent.local) continue;
      if (ent.info.bot) { ent.bot = true; giveBrain(ent); }
      else { ent.hostSim = true; ent.inQ = []; ent.ack = 0; ent.lastInp = null; }
      if (ent.buf.length) { const b = ent.buf[ent.buf.length - 1]; Object.assign(ent.e, { x: b.x, y: b.y, z: b.z, h: b.h }); }
    }
    r.history = []; r.outbox = [];
  });
  window.__dh = S;
  return {
    standings: () => (S.race ? standings().map((x) => x.info.id) : null),
    stop() {
      audioShutdown();
      for (const id of [...(S.race?.ents.keys() || [])]) removeEnt(id);
      if (S.race) { scene.remove(S.race.mesh); disposeGroup(S.race.mesh); }
      env.dispose();
      ctx.three.dispose(scene);
      S.race = null;
      delete window.__dh;
    },
  };
}
