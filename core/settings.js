// Player settings, saved to localStorage. Games read these through ctx.settings and may listen for changes:
//   ctx.settings.get('sens')   ctx.settings.on('change', (key, value) => ...)
import { Emitter } from './emitter.js';

const KEY = 'partyhub.settings.v1';
export const DEFAULTS = {
  name: '', color: -1, hat: 'cap', skin: -1, hair: '', hairColor: -1,
  master: 0.8, music: 0.35, sfx: 0.8,   // 0..1
  sens: 1,                               // mouse sensitivity multiplier 0.2..3
  quality: 'high',                       // low | med | high
  showFps: false,
};
export const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 0, antialias: false, effects: false },
  med: { pixelRatio: 1.25, shadows: true, shadowMap: 1024, antialias: true, effects: false },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, antialias: true, effects: true },
};

class Settings extends Emitter {
  constructor() {
    super();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
    this.data = { ...DEFAULTS, ...saved };
    if (!QUALITY[this.data.quality]) this.data.quality = 'high';
    // High graphics is the default: switch everyone to it once (players can still pick Low / Medium afterwards).
    if (saved.qv !== 2) { this.data.quality = 'high'; this.data.qv = 2; try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* */ } }
  }
  get(k) { return this.data[k]; }
  set(k, v) {
    if (this.data[k] === v) return;
    this.data[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ }
    this.emit('change', k, v);
  }
  get quality() { return QUALITY[this.data.quality] || QUALITY.high; }
}
export const settings = new Settings();

// Small helpers for per-game remembered choices (e.g. last character picked).
export const store = {
  get(k, d) { try { const v = localStorage.getItem('partyhub.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('partyhub.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
