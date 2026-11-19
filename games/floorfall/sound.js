// Floor Is Falling soundscape, all synthesized through the hub's shared buses (ctx.audio.sfx / .music) so the
// volume sliders work. Glassy "tink" cracks, crunchy drops with a low thump, a whoosh when you fall a layer,
// and a tense minor-key loop (pulsing bass, ticking hats, glass arpeggio) that speeds up and adds voices as
// players drop out.
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
// A minor → F → G → E: four bars, 16 sixteenths each
const BASS = [45, 41, 43, 40];
const ARP = [[69, 72, 76, 81], [65, 69, 72, 77], [67, 71, 74, 79], [64, 68, 71, 76]];

export function createSound(ctx) {
  const audio = ctx.audio;
  const last = {};
  const A = () => audio.ready && audio.ctx;
  const gate = (k, ms) => { const n = performance.now(); if (n - (last[k] || 0) < ms) return false; last[k] = n; return true; };
  let intensity = 0, playing = false, step = 0, nextT = 0;

  function note(type, f, dur, vol, at, dest) { audio.tone(type, f, f, dur, vol, Math.max(0, at - audio.ctx.currentTime), dest); }
  function schedule() {
    const ac = A(); if (!ac || !playing) return;
    if (nextT < ac.currentTime) nextT = ac.currentTime + 0.05;
    const bpm = 108 + intensity * 52, s16 = 60 / bpm / 4;
    while (nextT < ac.currentTime + 0.25) {
      const bar = Math.floor(step / 16) % 4, s = step % 16, M = audio.music;
      // kick on the beat, extra kicks when it gets tense
      if (s % 4 === 0 || (intensity > 0.6 && s === 14)) { audio.tone('sine', 150, 42, 0.16, 0.22, nextT - ac.currentTime, M); }
      // pulsing octave bass on eighths
      if (s % 2 === 0) note('sawtooth', midi(BASS[bar] + (s % 4 === 2 ? 12 : 0)), s16 * 1.6, 0.05, nextT, M);
      // hats: offbeats, sixteenths when tense
      if (s % 4 === 2 || (intensity > 0.35 && s % 2 === 1)) audio.burst(0.04, s % 4 === 2 ? 0.07 : 0.035, 'highpass', 7000, 5000, nextT - ac.currentTime, M);
      // glass arpeggio (joins once someone is out)
      if (intensity > 0.15 && s % 2 === 0) { const ch = ARP[bar]; note('triangle', midi(ch[(s / 2) % 4] + (s >= 8 ? 12 : 0)), s16 * 1.3, 0.035, nextT, M); }
      // snare-ish clap on 2 and 4
      if (s === 4 || s === 12) audio.burst(0.12, 0.09, 'bandpass', 1800, 900, nextT - ac.currentTime, M);
      // high tension drone stab at the top of each bar in the endgame
      if (intensity > 0.7 && s === 0) note('square', midi(BASS[bar] + 36), s16 * 6, 0.025, nextT, M);
      nextT += s16; step++;
    }
  }
  const timer = ctx.setInterval(schedule, 90);

  return {
    music(on) { playing = on; if (on && A()) nextT = audio.ctx.currentTime + 0.05; },
    intensity(v) { intensity = Math.max(0, Math.min(1, v)); },
    crack(near) { if (!A() || !gate('c', 45)) return; const v = near ? 1 : 0.35, f = 2200 + Math.random() * 1600; audio.tone('sine', f, f * 0.98, 0.09, 0.05 * v); audio.burst(0.05, 0.05 * v, 'highpass', 5000, 3000); },
    drop(near) { if (!A() || !gate('d', 55)) return; const v = near ? 1 : 0.3; audio.burst(0.22, 0.13 * v, 'bandpass', 2600, 500); audio.tone('triangle', 900 + Math.random() * 500, 300, 0.18, 0.04 * v); audio.tone('sine', 120, 50, 0.2, 0.08 * v, 0.05); },
    step() { if (A() && gate('s', 120)) audio.tone('triangle', 1500 + Math.random() * 400, 1300, 0.03, 0.025); },
    jump() { if (A() && gate('j', 60)) { audio.tone('square', 300, 620, 0.08, 0.04); audio.tone('sine', 500, 900, 0.1, 0.05); } },
    land(k = 0.5) { if (A() && gate('l', 70)) { audio.tone('sine', 2400, 2300, 0.06, 0.03 + 0.03 * k); audio.burst(0.07, 0.07 + 0.08 * k, 'lowpass', 1400, 200); audio.tone('sine', 150, 60, 0.1, 0.05 + 0.08 * k); } },
    fall() { if (A() && gate('f', 250)) audio.burst(0.55, 0.12, 'bandpass', 600, 2400); },
    jump2() { if (A() && gate('j2', 60)) { audio.tone('triangle', 520, 1100, 0.1, 0.06); audio.tone('sine', 780, 1500, 0.12, 0.05, 0.03); } },
    dive() { if (A() && gate('dv', 80)) { audio.burst(0.22, 0.14, 'bandpass', 2600, 500); audio.tone('sawtooth', 700, 160, 0.2, 0.05); } },
    dash() { if (A()) { audio.burst(0.18, 0.15, 'bandpass', 900, 3400); audio.tone('sawtooth', 320, 760, 0.1, 0.03); } },
    hit(mine) { if (!A()) return; const v = mine ? 1 : 0.5; audio.tone('square', 220, 80, 0.14, 0.12 * v); audio.burst(0.15, 0.25 * v, 'lowpass', 3200, 250); audio.tone('sine', 700, 1400, 0.12, 0.06 * v, 0.03); },
    out(mine) { if (!A()) return; const v = mine ? 1 : 0.45; audio.tone('sawtooth', 600, 70, 0.9, 0.07 * v); audio.burst(1.1, 0.18 * v, 'lowpass', 1800, 80, 0.1); audio.tone('sine', 90, 30, 1.0, 0.16 * v, 0.25); },
    round() { if (A()) [0, 0.12, 0.24].forEach((d, i) => audio.tone('triangle', 660 + i * 220, 660 + i * 220, 0.14, 0.08, d)); },
    roundWin(mine) { if (mine) audio.play('fanfare'); else audio.play('win', 0.7); },
    collapse() { if (A()) { audio.burst(1.6, 0.3, 'lowpass', 300, 1200); audio.tone('sawtooth', 55, 40, 1.6, 0.1); } },
    dispose() { playing = false; ctx.clearInterval(timer); },
  };
}
