// Minimal event emitter used across /core.  on() returns an unsubscribe function.
export class Emitter {
  constructor() { this._ev = new Map(); }
  on(type, fn) {
    if (!this._ev.has(type)) this._ev.set(type, new Set());
    this._ev.get(type).add(fn);
    return () => this.off(type, fn);
  }
  once(type, fn) { const off = this.on(type, (...a) => { off(); fn(...a); }); return off; }
  off(type, fn) { this._ev.get(type)?.delete(fn); }
  emit(type, ...args) {
    const set = this._ev.get(type);
    if (!set) return;
    for (const fn of [...set]) { try { fn(...args); } catch (e) { console.error(`[${type}] handler failed`, e); } }
  }
  clearListeners() { this._ev.clear(); }
}
