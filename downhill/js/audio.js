// Tiny synthesized sound kit (WebAudio, no files). Call unlock() from a user gesture.
let ctx = null, master = null, noiseBuf = null;
let wind = null, carve = null;
let muted = false;
try { muted = localStorage.getItem('dh_mute') === '1'; } catch { }

function makeNoise() {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
  return b;
}
function loop(type, freq, q) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f); f.connect(g); g.connect(master); src.start();
  return { f, g };
}

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination);
  noiseBuf = makeNoise();
  wind = loop('lowpass', 400, 0.7);
  carve = loop('bandpass', 2500, 1.2);
}

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('dh_mute', muted ? '1' : '0'); } catch { }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.6, ctx.currentTime, 0.05);
  return muted;
}

// Continuous layers: speed (m/s), carving amount 0..1, on ground?
export function setRide(speed, carveAmt, grounded, active) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const k = active ? Math.min(1, speed / 45) : 0;
  wind.g.gain.setTargetAtTime(0.05 + k * 0.5 * (active ? 1 : 0.1), t, 0.1);
  wind.f.frequency.setTargetAtTime(250 + k * 1400, t, 0.1);
  const c = active && grounded ? Math.min(1, speed / 25) * (0.12 + carveAmt * 0.5) : 0;
  carve.g.gain.setTargetAtTime(c, t, 0.05);
  carve.f.frequency.setTargetAtTime(1800 + carveAmt * 1600 + speed * 20, t, 0.1);
}

function tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function burst(dur, freq, vol, type = 'lowpass', delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = 1;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
}

export const sfx = {
  jump() { burst(0.25, 1200, 0.25, 'bandpass'); tone(220, 0.18, 'sine', 0.12, 420); },
  land(hard) { burst(0.22, hard ? 500 : 900, hard ? 0.6 : 0.35); tone(90, 0.15, 'sine', 0.3, 50); },
  trick() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.18, null, i * 0.06)); },
  boost() { tone(300, 0.35, 'sawtooth', 0.12, 1200); burst(0.3, 3000, 0.15, 'highpass'); },
  wipe() { burst(0.6, 700, 0.7); tone(160, 0.5, 'square', 0.12, 50); },
  bump() { burst(0.12, 400, 0.5); tone(120, 0.1, 'sine', 0.3, 70); },
  beep(hi) { tone(hi ? 880 : 440, hi ? 0.5 : 0.18, 'square', 0.15); },
  finish() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.2, null, i * 0.11)); },
};
