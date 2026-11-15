// Mini-Golf sounds: synthesized (no files), played through the hub's shared audio engine (sfx volume bus).
import { audio } from '../../core/audio.js';
let ctx = null, master = null, noiseBuf = null;
function initAudio() { ctx = audio.ctx; master = audio.sfx; noiseBuf = audio.noise; return !!ctx; }

function tone(f, dur, type = 'sine', vol = 0.3, f2 = null, at = 0) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, freq, vol = 0.3, at = 0, q = 1) {
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

const last = new Map();
export function play(kind, vol = 1, tag = '') {
  if (!initAudio() || vol < 0.02) return;
  const k = kind + tag, now = performance.now();
  if (now - (last.get(k) || 0) < 70) return; last.set(k, now);
  vol = Math.min(1, vol);
  switch (kind) {
    case 'putt': tone(220, 0.09, 'triangle', 0.5 * vol, 120); noise(0.04, 4000, 0.25 * vol); break;
    case 'clack': tone(1900, 0.05, 'square', 0.12 * vol); tone(2600, 0.04, 'sine', 0.2 * vol); break;
    case 'wall': tone(140, 0.1, 'sine', 0.45 * vol, 70); noise(0.05, 900, 0.2 * vol); break;
    case 'bumper': tone(320, 0.2, 'square', 0.18 * vol, 760); break;
    case 'land': tone(110, 0.13, 'sine', 0.5 * vol, 50); break;
    case 'splash': noise(0.6, 1400, 0.5 * vol, 0, 0.7); tone(500, 0.3, 'sine', 0.15 * vol, 150); break;
    case 'fell': tone(700, 0.6, 'sine', 0.25 * vol, 120); break;
    case 'cup': tone(160, 0.07, 'sine', 0.5 * vol); tone(880, 0.18, 'triangle', 0.3 * vol, null, 0.09); tone(1320, 0.3, 'triangle', 0.3 * vol, null, 0.2); break;
    case 'pickup': [660, 880, 1100, 1320].forEach((f, i) => tone(f, 0.08, 'square', 0.12 * vol, null, i * 0.06)); break;
    case 'use': tone(400, 0.2, 'triangle', 0.35 * vol, 1200); break;
    case 'shock': tone(90, 0.6, 'sawtooth', 0.35 * vol, 30); noise(0.5, 500, 0.5 * vol); break;
    case 'ko': tone(520, 0.25, 'sawtooth', 0.25 * vol, 90); tone(980, 0.12, 'square', 0.15 * vol, null, 0.05); break;
    case 'freeze': [1800, 2400, 3000].forEach((f, i) => tone(f, 0.25, 'sine', 0.14 * vol, f * 0.7, i * 0.05)); noise(0.3, 6000, 0.15 * vol); break;
    case 'swap': tone(400, 0.12, 'triangle', 0.3 * vol, 900); tone(900, 0.12, 'triangle', 0.3 * vol, 400, 0.12); break;
    case 'rocket': noise(0.5, 2500, 0.45 * vol); tone(160, 0.45, 'sawtooth', 0.25 * vol, 900); break;
    case 'tick': tone(1000, 0.06, 'square', 0.12 * vol); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.3 * vol, null, i * 0.12)); break;
  }
}
