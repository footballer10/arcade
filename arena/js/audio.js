// Tiny synthesized sound effects (WebAudio, no asset files).
let ctx = null, master = null, noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('arena.muted') === '1'; } catch { /* */ }

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('arena.muted', m ? '1' : '0'); } catch { /* */ }
  if (master) master.gain.value = m ? 0 : 0.5;
}
export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}

function tone(type, f0, f1, dur, vol, delay = 0) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, filter = 'lowpass', f0 = 2000, f1 = 200, delay = 0) {
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter(); fl.type = filter; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(fl).connect(g).connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

// vol: 0..1 distance attenuation computed by the caller
export function sfx(name, vol = 1) {
  if (!ctx || muted || vol <= 0.02) return;
  const v = Math.min(1, vol);
  switch (name) {
    case 'shot': tone('square', 900, 420, 0.07, 0.06 * v); break;
    case 'swing': noise(0.09, 0.18 * v, 'highpass', 3000, 900); break;
    case 'lob': tone('sine', 300, 600, 0.12, 0.12 * v); break;
    case 'hit': tone('sine', 180, 60, 0.12, 0.3 * v); noise(0.05, 0.15 * v, 'lowpass', 4000, 800); break;
    case 'hurt': tone('sawtooth', 220, 70, 0.18, 0.22 * v); noise(0.08, 0.25 * v, 'lowpass', 3000, 300); break;
    case 'shieldhit': tone('triangle', 1200, 900, 0.12, 0.12 * v); break;
    case 'charge': tone('sine', 200, 700, 0.18, 0.12 * v); break;
    case 'blast': noise(0.45, 0.45 * v, 'lowpass', 2500, 80); tone('sine', 110, 40, 0.4, 0.4 * v); break;
    case 'slam': tone('sine', 90, 28, 0.45, 0.55 * v); noise(0.35, 0.4 * v, 'lowpass', 1200, 60); break;
    case 'boom': noise(0.5, 0.5 * v, 'lowpass', 3000, 60); tone('sine', 140, 35, 0.4, 0.45 * v); break;
    case 'well': tone('sine', 120, 60, 0.8, 0.2 * v); tone('triangle', 240, 120, 0.8, 0.08 * v); break;
    case 'tp': tone('sine', 300, 1400, 0.16, 0.15 * v); break;
    case 'dash': noise(0.16, 0.18 * v, 'bandpass', 1800, 500); break;
    case 'bump': tone('sine', 180, 520, 0.18, 0.25 * v); break;
    case 'sweep': noise(0.2, 0.3 * v, 'bandpass', 900, 300); tone('square', 160, 90, 0.15, 0.1 * v); break;
    case 'pickup': [660, 880, 1320].forEach((f, i) => tone('triangle', f, f, 0.09, 0.15 * v, i * 0.06)); break;
    case 'elim': tone('sawtooth', 500, 70, 0.55, 0.2 * v); noise(0.3, 0.2 * v, 'lowpass', 2000, 100); break;
    case 'fall': tone('sine', 700, 120, 0.9, 0.18 * v); break;
    case 'beep': tone('square', 600, 600, 0.09, 0.1 * v); break;
    case 'fight': tone('square', 900, 900, 0.25, 0.12 * v); tone('square', 1350, 1350, 0.25, 0.06 * v); break;
    case 'zone': tone('sawtooth', 110, 90, 0.9, 0.15 * v); tone('sawtooth', 116, 92, 0.9, 0.12 * v); break;
    case 'splash': noise(0.7, 0.55 * v, 'lowpass', 5000, 300); noise(0.25, 0.35 * v, 'highpass', 2500, 6000); tone('sine', 420, 70, 0.35, 0.3 * v); break;
    case 'boo': tone('sine', 520, 260, 0.45, 0.25 * v); tone('sine', 530, 250, 0.45, 0.2 * v, 0.03); break;
    case 'hook': tone('square', 240, 620, 0.12, 0.12 * v); noise(0.1, 0.2 * v, 'bandpass', 2500, 900); break;
    case 'bonk': tone('triangle', 330, 110, 0.2, 0.4 * v); tone('square', 660, 660, 0.05, 0.1 * v); break;
    case 'ice': tone('triangle', 1800, 900, 0.1, 0.1 * v); noise(0.12, 0.12 * v, 'highpass', 5000, 3000); break;
    case 'arrow': noise(0.12, 0.2 * v, 'bandpass', 3500, 1200); tone('sine', 700, 300, 0.1, 0.08 * v); break;
    case 'stampede': noise(0.5, 0.35 * v, 'lowpass', 600, 150); tone('sawtooth', 90, 140, 0.4, 0.15 * v); break;
    case 'emote': tone('sine', 880, 1320, 0.09, 0.12 * v); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.18, 0.15 * v, i * 0.11)); break;
  }
}
