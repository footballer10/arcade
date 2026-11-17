// Game runtime: builds the ctx a game's start(ctx) receives, and guarantees cleanup on stop.
// Everything registered through ctx (timers, listeners, frame loops, ticks, renderers, HUD, input, net) is
// released by the hub after the game's own stop() runs, so the 10th game in a row runs like the first.
import { Emitter } from './emitter.js';
import { makeChannel } from './net.js';
import { scopedInput } from './input.js';
import { scopedUI } from './ui.js';
import { audio } from './audio.js';
import { settings, QUALITY } from './settings.js';
import { buildAvatar, buildHat, disposeAvatar } from './avatar.js';
import { createRenderer, disposeObject, applyQuality } from './three-utils.js';
import { createRng } from './rng.js';
import { BOT_LEVELS, BotBrain } from './bots.js';
import { css, hex } from './palette.js';

// One worker-driven ticker for the whole page: keeps host simulations running when the tab is in the background.
const tickFns = new Set();
let tickWorker = null, lastTick = 0;
function ensureTicker() {
  if (tickWorker) return;
  try {
    tickWorker = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),1000/60)'], { type: 'text/javascript' })));
    tickWorker.onmessage = runTicks;
  } catch { setInterval(runTicks, 1000 / 60); tickWorker = true; }
  lastTick = performance.now();
}
function runTicks() {
  const now = performance.now(), dt = Math.min(0.25, (now - lastTick) / 1000); lastTick = now;
  for (const f of [...tickFns]) { try { f(dt, now); } catch (e) { console.error('tick failed', e); } }
}

export const liveStats = { renderers: 0, mounted: 0 };
// ?testfps=N caps game rendering. Only for the automated tests, which run several software-rendered (no GPU)
// pages on one machine; it has no use for real players.
const TEST_FPS = +new URLSearchParams(location.search).get('testfps') || 0;

export class GameRuntime extends Emitter {
  constructor({ hub, net, manifest, game, players, myId }) {
    super();
    this.hub = hub; this.net = net; this.manifest = manifest; this.instance = null; this.stopped = false;
    this.timeouts = new Set(); this.intervals = new Set(); this.listeners = []; this.frames = new Set(); this.ticks = new Set();
    this.renderers = new Set(); this.cleanups = []; this.started = false;
    this.container = document.createElement('div');
    this.container.className = 'game-root'; this.container.dataset.game = manifest.id;
    document.getElementById('stage').appendChild(this.container);
    this.ui = scopedUI(hub);
    this.input = scopedInput(this.container);
    this.channel = makeChannel(net, game.round, () => net.isHost);
    const rt = this;
    const level = BOT_LEVELS[game.botLevel] || BOT_LEVELS.normal;
    const plist = players.map((p) => ({ id: p.id, name: p.name, color: p.color, colorHex: hex(p.color), colorCss: css(p.color), hat: p.hat, skin: p.skin, hair: p.hair, hairColor: p.hairColor, isBot: !!p.isBot }));
    this.ctx = {
      container: this.container, manifest, round: game.round, seed: game.seed, options: game.options || {}, picks: game.picks || {},
      players: plist, myId, spectator: !plist.some((p) => p.id === myId),
      get isHost() { return net.isHost; }, get hostId() { return net.hostPid; },
      get started() { return rt.started; },
      player: (id) => plist.find((p) => p.id === id),
      connected: (id) => hub.isConnected(id),
      net: this.channel, input: this.input, ui: this.ui, audio, settings,
      quality: () => QUALITY[settings.get('quality')] || QUALITY.high,
      avatar: { build: buildAvatar, hat: buildHat, dispose: disposeAvatar },
      three: {
        createRenderer: (opts) => { const r = createRenderer(this.container, opts); this.renderers.add(r); liveStats.renderers++; return r; },
        dispose: disposeObject, applyQuality,
      },
      rng: (salt = 0) => createRng((game.seed ^ salt) >>> 0),
      bots: { level, list: plist.filter((p) => p.isBot), Brain: BotBrain },
      endGame: (placements, extra = {}) => { if (!net.isHost) return; if (!rt.stopped) hub.gameEnded(game.round, placements, extra); },
      on: (type, fn) => { const off = this.on(type, fn); this.cleanups.push(off); return off; },
      setTimeout: (fn, ms) => { const id = setTimeout(() => { this.timeouts.delete(id); if (!this.stopped) fn(); }, ms); this.timeouts.add(id); return id; },
      clearTimeout: (id) => { clearTimeout(id); this.timeouts.delete(id); },
      setInterval: (fn, ms) => { const id = setInterval(() => { if (!this.stopped) fn(); }, ms); this.intervals.add(id); return id; },
      clearInterval: (id) => { clearInterval(id); this.intervals.delete(id); },
      listen: (target, type, fn, opts) => { target.addEventListener(type, fn, opts); this.listeners.push([target, type, fn, opts]); },
      frame: (fn) => { this.frames.add(fn); return () => this.frames.delete(fn); },           // fn(dt, now) every animation frame
      tick: (fn) => { ensureTicker(); this.ticks.add(fn); tickFns.add(fn); return () => { this.ticks.delete(fn); tickFns.delete(fn); }; }, // 60 Hz, also in background tabs
      onCleanup: (fn) => this.cleanups.push(fn),
      log: (...a) => console.log(`[${manifest.id}]`, ...a),
    };
    this._raf = 0; this._last = performance.now();
    const loop = (now) => {
      if (this.stopped) return;
      this._raf = requestAnimationFrame(loop);
      // While the party is re-forming (host migration / reconnect) render only ~3 fps so a slow machine's main
      // thread is free for the WebRTC handshakes. Simulation ticks (ctx.tick) keep running at full rate.
      if (hub.netBusy?.() && now - this._last < 330) return;
      if (TEST_FPS && now - this._last < 1000 / TEST_FPS) return;   // automated tests only (?testfps=N)
      const dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
      for (const f of [...this.frames]) { try { f(dt, now); } catch (e) { console.error(`[${manifest.id}] frame failed`, e); } }
    };
    this._raf = requestAnimationFrame(loop);
    this._onResize = () => this.emit('resize', this.container.clientWidth, this.container.clientHeight);
    addEventListener('resize', this._onResize);
    this._onSettings = settings.on('change', (k, v) => this.emit('settings', k, v));
    liveStats.mounted++;
  }
  async start(mod) {
    this.instance = (await mod.start(this.ctx)) || {};
    return this.instance;
  }
  go() { if (this.started || this.stopped) return; this.started = true; this.emit('go'); }
  standings() { try { return this.instance?.standings?.() || null; } catch (e) { console.error(e); return null; } }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    try { this.instance?.stop?.(); } catch (e) { console.error(`[${this.manifest.id}] stop() failed`, e); }
    cancelAnimationFrame(this._raf);
    for (const f of this.cleanups.splice(0)) { try { f(); } catch (e) { console.error(e); } }
    this.timeouts.forEach(clearTimeout); this.intervals.forEach(clearInterval);
    for (const [t, type, fn, o] of this.listeners) t.removeEventListener(type, fn, o);
    for (const f of this.ticks) tickFns.delete(f);
    this.frames.clear(); this.ticks.clear(); this.listeners = [];
    for (const r of this.renderers) {
      try { r.dispose(); r.forceContextLoss(); } catch { /* */ }
      r.domElement.remove(); liveStats.renderers--;
    }
    this.renderers.clear();
    removeEventListener('resize', this._onResize); this._onSettings();
    this.channel.dispose(); this.input.dispose(); this.ui.dispose();
    this.container.remove();
    this.clearListeners();
    this.ctx = null; this.instance = null;
    liveStats.mounted--;
  }
}
