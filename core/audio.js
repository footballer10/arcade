// Shared WebAudio engine: one AudioContext for the whole night, with master / music / sfx buses
// controlled by the settings sliders. Games route every sound into audio.sfx (or audio.music):
//   const a = ctx.audio;  if (a.ready) a.tone('square', 600, 600, 0.1, 0.2)   // quick synth beep
//   const o = a.ctx.createOscillator(); o.connect(a.sfx)                     // or build your own graph
// Browsers only allow sound after a click/keypress; the hub calls audio.unlock() on the first gesture.
import { settings } from './settings.js';

let ctx = null, master = null, sfx = null, music = null, noiseBuf = null;

function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(settings.get('master'), t, 0.03);
  sfx.gain.setTargetAtTime(settings.get('sfx'), t, 0.03);
  music.gain.setTargetAtTime(settings.get('music') * 0.5, t, 0.03);
}
settings.on('change', (k) => { if (k === 'master' || k === 'sfx' || k === 'music') applyVolumes(); });

export const audio = {
  get ready() { return !!ctx && ctx.state === 'running'; },
  get ctx() { return ctx; },
  get sfx() { return sfx; },
  get music() { return music; },
  get noise() { return noiseBuf; },
  unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain(); master.connect(ctx.destination);
        sfx = ctx.createGain(); sfx.connect(master);
        music = ctx.createGain(); music.connect(master);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        applyVolumes();
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch { ctx = null; }
  },
  // One-shot synth tone. type: sine|square|triangle|sawtooth. Frequencies glide f0 -> f1 over dur seconds.
  tone(type, f0, f1, dur, vol = 0.2, delay = 0, dest = null) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || sfx); o.start(t); o.stop(t + dur + 0.03);
  },
  // Filtered noise burst (whooshes, hits, splashes).
  burst(dur, vol = 0.2, type = 'lowpass', f0 = 2000, f1 = 200, delay = 0, dest = null) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest || sfx); s.start(t, Math.random()); s.stop(t + dur + 0.03);
  },
  // Stock UI sounds shared by the hub and every game.
  play(name, vol = 1) {
    if (!ctx) return;
    const T = (...a) => audio.tone(...a);
    switch (name) {
      case 'click': T('triangle', 900, 700, 0.06, 0.12 * vol); break;
      case 'tick': T('square', 600, 600, 0.08, 0.1 * vol); break;
      case 'go': T('square', 900, 900, 0.25, 0.12 * vol); T('square', 1350, 1350, 0.25, 0.06 * vol); break;
      case 'join': T('sine', 520, 780, 0.12, 0.15 * vol); T('sine', 780, 1040, 0.12, 0.12 * vol, 0.08); break;
      case 'leave': T('sine', 600, 300, 0.2, 0.12 * vol); break;
      case 'toast': T('triangle', 1200, 1500, 0.07, 0.08 * vol); break;
      case 'coin': T('square', 988, 988, 0.06, 0.1 * vol); T('square', 1319, 1319, 0.18, 0.1 * vol, 0.06); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => T('triangle', f, f, 0.2, 0.15 * vol, i * 0.11)); break;
      case 'fanfare': [392, 523, 659, 784, 659, 784, 1046].forEach((f, i) => T('square', f, f, 0.16, 0.08 * vol, i * 0.12)); break;
      case 'error': T('sawtooth', 220, 160, 0.2, 0.1 * vol); break;
    }
  },
};

// A light, endless lobby tune (two-voice arpeggio) so the music slider has something to control.
let musicTimer = null, step = 0, nextT = 0;
const PROG = [[60, 64, 67, 72], [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67]];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
export function startMusic() {
  if (musicTimer || !ctx) return;
  nextT = ctx.currentTime + 0.1; step = 0;
  musicTimer = setInterval(() => {
    if (!ctx) return;
    while (nextT < ctx.currentTime + 0.3) {
      const chord = PROG[Math.floor(step / 16) % PROG.length];
      const n = chord[[0, 1, 2, 3, 2, 1, 2, 3][step % 8]] + (step % 16 >= 8 ? 12 : 0);
      audio.tone('triangle', midi(n), midi(n), 0.22, 0.05, nextT - ctx.currentTime, music);
      if (step % 4 === 0) audio.tone('sine', midi(chord[0] - 12), midi(chord[0] - 12), 0.45, 0.07, nextT - ctx.currentTime, music);
      nextT += 0.16; step++;
    }
  }, 100);
}
export function stopMusic() { clearInterval(musicTimer); musicTimer = null; }
