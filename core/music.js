// Shared in-game music: small synthesized loops (no audio files), one style per game, played on the music bus so
// the Music slider controls it. Games get it through ctx.music(style) and it stops by itself when the round ends.
//   const m = ctx.music('golf'); m.start();  m.intensity(0..1) adds layers (e.g. final lap, last players standing)
import { audio } from './audio.js';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
// drum rows: 16 steps per bar. x = hit, o = soft hit
const STYLES = {
  // breezy marimba stroll for mini-golf
  golf:    { bpm: 98,  swing: 0.12, chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], scale: [0, 2, 4, 7, 9],
             bass: 'x.....x.x.......', kick: 'x.......x.......', snare: '........o.......', hat: '..o...o...o...o.', arp: 'x.x.x.x.x.x.x.x.',
             lead: 'triangle', leadOct: 12, arpType: 'triangle', bassType: 'triangle', chordType: 'sine', leadEvery: 2, vol: 1 },
  // bright, driving ski-pop
  downhill:{ bpm: 142, swing: 0,    chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], scale: [0, 2, 3, 5, 7, 10],
             bass: 'x.x.x.x.x.x.x.x.', kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', arp: 'xxxxxxxxxxxxxxxx',
             lead: 'square', leadOct: 12, arpType: 'square', bassType: 'sawtooth', chordType: 'triangle', leadEvery: 1, vol: 0.85 },
  // punchy brawl
  arena:   { bpm: 128, swing: 0,    chords: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]], scale: [0, 3, 5, 7, 10],
             bass: 'x.xx..x.x.xx..x.', kick: 'x...x...x...x...', snare: '....x.......x..o', hat: 'x.x.x.x.x.x.x.x.', arp: 'x..x..x.x..x..x.',
             lead: 'sawtooth', leadOct: 12, arpType: 'square', bassType: 'sawtooth', chordType: 'sawtooth', leadEvery: 2, vol: 0.8 },
  // stadium anthem with claps
  stadium: { bpm: 124, swing: 0,    chords: [[52, 56, 59], [49, 52, 56], [57, 61, 64], [59, 63, 66]], scale: [0, 2, 4, 7, 9],
             bass: 'x...x.x.x...x.x.', kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', arp: 'x.......x.......',
             lead: 'square', leadOct: 12, arpType: 'sawtooth', bassType: 'sawtooth', chordType: 'sawtooth', leadEvery: 2, vol: 0.8 },
  // groovy synth funk for snakes
  snake:   { bpm: 108, swing: 0.08, chords: [[53, 56, 60], [49, 53, 56], [51, 55, 58], [48, 52, 55]], scale: [0, 3, 5, 7, 10],
             bass: 'x..x..x...x.x...', kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx', arp: '..x...x...x...x.',
             lead: 'triangle', leadOct: 12, arpType: 'sine', bassType: 'square', chordType: 'triangle', leadEvery: 2, vol: 0.9 },
  // classic chiptune (template / Coin Grab)
  arcade:  { bpm: 120, swing: 0,    chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], scale: [0, 2, 4, 7, 9],
             bass: 'x.x.x.x.x.x.x.x.', kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.', arp: 'x.x.x.x.x.x.x.x.',
             lead: 'square', leadOct: 12, arpType: 'square', bassType: 'triangle', chordType: 'triangle', leadEvery: 1, vol: 0.8 },
};

// A catchy 2-bar melody per style, made once from a fixed seed so it is the same tune every time.
function makeMelody(st, seedStr) {
  let s = [...seedStr].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const notes = []; let deg = 2;
  for (let i = 0; i < 32; i++) {
    const play = i % 4 === 0 ? rnd() < 0.85 : i % 2 === 0 ? rnd() < 0.45 : rnd() < 0.12;
    if (!play) { notes.push(null); continue; }
    deg = Math.max(0, Math.min(st.scale.length * 2 - 1, deg + Math.round((rnd() - 0.5) * 3)));
    notes.push(deg);
  }
  return notes;
}

export function createMusic(style = 'arcade') {
  const st = STYLES[style] || STYLES.arcade;
  const melody = makeMelody(st, style);
  let timer = 0, step = 0, nextT = 0, level = 0;
  const v = st.vol;
  const T = (type, n, dur, vol, at) => audio.tone(type, midi(n), midi(n), dur, vol * v, Math.max(0, at - audio.ctx.currentTime), audio.music);
  const hit = (row, i) => row[i] === 'x' ? 1 : row[i] === 'o' ? 0.5 : 0;
  function playStep(i, t) {
    const sixteenth = 60 / st.bpm / 4, bar = Math.floor(step / 16), chord = st.chords[bar % st.chords.length], root = chord[0];
    const at = t + (i % 2 ? st.swing * sixteenth : 0);
    const now = audio.ctx.currentTime, d = Math.max(0, at - now);
    // drums
    if (hit(st.kick, i)) audio.tone('sine', 140, 42, 0.18, 0.32 * v * hit(st.kick, i), d, audio.music);
    if (hit(st.snare, i)) { audio.burst(0.13, 0.13 * v * hit(st.snare, i), 'bandpass', 2200, 900, d, audio.music); audio.tone('triangle', 220, 150, 0.08, 0.06 * v, d, audio.music); }
    if (hit(st.hat, i) && level >= 0) audio.burst(0.035, 0.05 * v * hit(st.hat, i), 'highpass', 9000, 7000, d, audio.music);
    // bass
    if (hit(st.bass, i)) T(st.bassType, root - 24 + (i % 8 === 6 ? 7 : 0), sixteenth * 1.8, 0.14, at);
    // soft chord pad on the first beat of each bar
    if (i === 0) chord.forEach((n) => T(st.chordType, n, sixteenth * 14, 0.025, at));
    // arpeggio (only once it gets busier, or always for chiptune styles)
    if (hit(st.arp, i) && (level > 0.3 || st.leadEvery === 1)) T(st.arpType, chord[i % chord.length] + 12, sixteenth * 0.9, 0.035, at);
    // melody: plays every `leadEvery` bars (or always when intense)
    if (bar % st.leadEvery === 0 || level > 0.6) {
      const deg = melody[(step % 32)];
      if (deg != null) {
        const oct = Math.floor(deg / st.scale.length), n = st.chords[0][0] + st.leadOct + st.scale[deg % st.scale.length] + 12 * oct;
        T(st.lead, n, sixteenth * 1.7, 0.05, at);
      }
    }
  }
  const api = {
    start() {
      if (timer || !audio.ctx) return api;
      nextT = audio.ctx.currentTime + 0.1; step = 0;
      timer = setInterval(() => {
        if (!audio.ctx) return;
        const sixteenth = 60 / st.bpm / 4 / (1 + level * 0.06);
        while (nextT < audio.ctx.currentTime + 0.25) {
          if (nextT < audio.ctx.currentTime - 0.5) nextT = audio.ctx.currentTime + 0.05;   // tab was asleep: skip ahead
          playStep(step % 16, nextT); step++; nextT += sixteenth;
        }
      }, 60);
      return api;
    },
    stop() { clearInterval(timer); timer = 0; return api; },
    intensity(x) { level = Math.max(0, Math.min(1, x)); return api; },
    get playing() { return !!timer; },
  };
  return api;
}
export const MUSIC_STYLES = Object.keys(STYLES);
