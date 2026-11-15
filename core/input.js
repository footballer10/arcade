// The ONE control map for every game (see CLAUDE.md). Games ask for actions, not keys:
//   ctx.input.axis()            -> {x, y} from WASD / arrows (x right+, y down+, i.e. screen/forward = -y)
//   ctx.input.down('jump')      -> true while Space is held
//   ctx.input.presses('jump')   -> counter that goes up on every press (great for networking: send the counter)
//   ctx.input.on('press', (action) => ...)   ctx.input.on('key', (code, isDown) => ...) for game-specific extra keys
//   ctx.input.mouse             -> {x, y, nx, ny, dx, dy}  (nx/ny are -1..1; dx/dy accumulate while pointer-locked)
// Reserved by the hub (games never bind these): Tab (scoreboard), Esc (pause menu), Enter (chat).
import { Emitter } from './emitter.js';

export const BINDINGS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], boost: ['ShiftLeft', 'ShiftRight'], use: ['KeyE'], special: ['KeyQ'],
};
export const MOUSE_ACTIONS = { 0: 'primary', 2: 'secondary' };
export const HUB_KEYS = ['Tab', 'Escape', 'Enter', 'NumpadEnter'];
const ACTION_OF = new Map();
for (const [a, codes] of Object.entries(BINDINGS)) for (const c of codes) ACTION_OF.set(c, a);
const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

// Human-readable control map (shown in the hub's help panel and docs).
export const CONTROL_MAP = [
  ['WASD / Arrows', 'Move'], ['Mouse', 'Aim / look'], ['Left click', 'Primary action'], ['Space', 'Jump / action'],
  ['Shift', 'Boost / dash'], ['E', 'Use item'], ['Q', 'Special'], ['Tab', 'Scoreboard'], ['Esc', 'Pause menu'], ['Enter', 'Chat'],
];

const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const isUi = (t) => t && t.closest && t.closest('button, a, input, select, textarea, label, .ui-block');

class Input extends Emitter {
  constructor() {
    super();
    this.keys = new Set();
    this.held = new Set();      // actions held
    this.count = {};            // action -> press counter
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, dx: 0, dy: 0, wheel: 0, locked: false };
    this.enabled = true;        // false while chat / pause menu are open
    this.gameActive = false;    // a game is mounted: prevent page scrolling keys
    this.surface = null;        // the element mouse actions count on (game container)
    addEventListener('keydown', (e) => this._key(e, true));
    addEventListener('keyup', (e) => this._key(e, false));
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    addEventListener('mousemove', (e) => {
      const m = this.mouse;
      m.x = e.clientX; m.y = e.clientY; m.nx = (e.clientX / innerWidth) * 2 - 1; m.ny = -(e.clientY / innerHeight) * 2 + 1;
      if (m.locked && this.enabled) { m.dx += e.movementX; m.dy += e.movementY; }
      this.emit('mousemove', e);
    });
    addEventListener('pointerdown', (e) => {
      if (!this.enabled || !this.gameActive || isUi(e.target)) return;
      if (this.surface && !this.surface.contains(e.target)) return;
      const a = MOUSE_ACTIONS[e.button];
      if (a) this._press(a, true);
      this.emit('mousedown', e);
    });
    addEventListener('pointerup', (e) => {
      const a = MOUSE_ACTIONS[e.button];
      if (a && this.held.has(a)) this._press(a, false);
      this.emit('mouseup', e);
    });
    addEventListener('wheel', (e) => { if (this.enabled && this.gameActive) { this.mouse.wheel += e.deltaY; this.emit('wheel', e); } }, { passive: true });
    addEventListener('contextmenu', (e) => { if (this.gameActive && !isUi(e.target)) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => { this.mouse.locked = !!document.pointerLockElement; });
  }
  _key(e, down) {
    if (down && isTyping(e.target)) return;
    if (HUB_KEYS.includes(e.code)) { if (down) this.emit('hubkey', e); return; }
    if (this.gameActive && PREVENT.has(e.code)) e.preventDefault();
    if (!this.enabled && down) return;
    if (down) { if (this.keys.has(e.code) && e.repeat) return; this.keys.add(e.code); } else this.keys.delete(e.code);
    const a = ACTION_OF.get(e.code);
    if (a) {
      const still = BINDINGS[a].some((c) => this.keys.has(c));
      if (down && !this.held.has(a)) this._press(a, true);
      else if (!down && !still) this._press(a, false);
    }
    this.emit('key', e.code, down, e);
  }
  _press(a, down) {
    if (down) { this.held.add(a); this.count[a] = (this.count[a] || 0) + 1; this.emit('press', a); }
    else { this.held.delete(a); this.emit('release', a); }
  }
  releaseAll() {
    for (const a of [...this.held]) this._press(a, false);
    for (const c of [...this.keys]) { this.keys.delete(c); this.emit('key', c, false, null); }
  }
  setEnabled(v) { if (this.enabled === v) return; this.enabled = v; if (!v) { this.releaseAll(); if (document.pointerLockElement) document.exitPointerLock(); } }
  down(action) { return this.enabled && this.held.has(action); }
  key(code) { return this.enabled && this.keys.has(code); }
  presses(action) { return this.count[action] || 0; }
  axis() {
    if (!this.enabled) return { x: 0, y: 0 };
    const x = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    const y = (this.held.has('down') ? 1 : 0) - (this.held.has('up') ? 1 : 0);
    return { x, y };
  }
  // Mouse movement since last call (for pointer-locked mouse look), scaled by the sensitivity setting.
  takeMouseDelta(sens = 1) { const d = { x: this.mouse.dx * sens, y: this.mouse.dy * sens }; this.mouse.dx = 0; this.mouse.dy = 0; return d; }
  takeWheel() { const w = this.mouse.wheel; this.mouse.wheel = 0; return w; }
}
export const input = new Input();

// Per-game view of the input. Everything subscribed through it is removed automatically on stop().
export function scopedInput(surface) {
  const offs = [];
  input.surface = surface;
  return {
    get mouse() { return input.mouse; },
    get enabled() { return input.enabled; },
    down: (a) => input.down(a), key: (c) => input.key(c), presses: (a) => input.presses(a), axis: () => input.axis(),
    takeMouseDelta: (s) => input.takeMouseDelta(s), takeWheel: () => input.takeWheel(),
    on(type, fn) { const off = input.on(type, (...a) => { if (input.enabled || type === 'release' || type === 'key') fn(...a); }); offs.push(off); return off; },
    lockPointer() { if (input.enabled && surface && document.pointerLockElement !== surface) surface.requestPointerLock?.()?.catch?.(() => {}); },
    unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); },
    dispose() { offs.splice(0).forEach((f) => f()); if (document.pointerLockElement) document.exitPointerLock(); if (input.surface === surface) input.surface = null; },
  };
}
