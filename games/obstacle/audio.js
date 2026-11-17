// Ultimate Obstacle Course soundscape: synthesized live through the hub's shared buses (ctx.audio.music / .sfx),
// so the volume sliders work. Upbeat game-show band (bouncy bass, offbeat stabs, claps, hats, a whistling lead
// that gets busier in the final), plus rubbery cartoon effects: boing jumps, whoosh dives, squishy landings,
// wooden bonks, big hammer thwacks, crowd cheers and "awww"s, a fanfare for qualifying and a sad trombone.
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
// I - vi - IV - V in F major, bright and cheesy on purpose
const PROG = [[53, 57, 60, 65], [50, 53, 57, 62], [46, 50, 53, 58], [48, 52, 55, 60]];
const LEAD = [72, 74, 77, 74, 72, 69, 72, -1, 74, 77, 79, 77, 74, 72, 74, -1, 70, 74, 77, 79, 81, 79, 77, 74, 72, 76, 79, 81, 79, 76, 72, -1];

export function createSound(audio) {
  const nodes = [];
  let timer = null, step = 0, nextT = 0, intensity = 0, playing = false, tempo = 0.135, crowd = null;
  const A = () => audio.ready && audio.ctx;
  const last = {};
  const gate = (k, ms) => { const n = performance.now(); if (n - (last[k] || 0) < ms) return false; last[k] = n; return true; };
  const T = (...a) => audio.tone(...a);

  function hat(t, v) { audio.burst(0.035, v, 'highpass', 9000, 7000, t, audio.music); }
  function clap(t, v) { audio.burst(0.12, v, 'bandpass', 1800, 1200, t, audio.music); audio.burst(0.08, v * 0.6, 'bandpass', 2400, 1500, t + 0.012, audio.music); }
  function kick(t, v) { T('sine', 150, 45, 0.16, v, t, audio.music); }
  function schedule() {
    const ac = A(); if (!ac) return;
    while (nextT < ac.currentTime + 0.25) {
      const d = nextT - ac.currentTime, bar = Math.floor(step / 16), s = step % 16;
      const chord = PROG[bar % 4];
      if (s % 4 === 0) kick(d, 0.16);
      if (s % 8 === 4) clap(d, 0.1);
      if (s % 2 === 1) hat(d, 0.035 + intensity * 0.02);
      if (s % 2 === 0) { const n = chord[0] - 12 + (s % 4 === 2 ? 12 : 0); T('triangle', midi(n), midi(n), tempo * 0.9, 0.11, d, audio.music); }
      if (s % 4 === 2) for (const n of chord.slice(1)) T('square', midi(n + 12), midi(n + 12), 0.07, 0.022, d, audio.music);
      if (intensity > 0.3) { const n = LEAD[(step) % LEAD.length]; if (n > 0 && s % 2 === 0) T('sine', midi(n), midi(n) * 1.003, tempo * 1.6, 0.04 * intensity, d, audio.music); }
      if (intensity > 0.75 && s % 2 === 1) { const n = chord[(s >> 1) % 4] + 24; T('square', midi(n), midi(n), 0.05, 0.014, d, audio.music); }
      nextT += tempo; step++;
    }
  }
  function ensureCrowd() {
    const ac = A(); if (!ac || crowd) return;
    const src = ac.createBufferSource(); src.buffer = audio.noise; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(bp).connect(g).connect(audio.sfx); src.start();
    nodes.push(src, bp, g); crowd = { g, bp };
  }

  const api = {
    startMusic() {
      const ac = A(); if (!ac || playing) return;
      playing = true; nextT = ac.currentTime + 0.05; step = 0;
      timer = setInterval(schedule, 60);
      ensureCrowd();
    },
    stopMusic() { clearInterval(timer); timer = null; playing = false; },
    // 0 calm (show screens) .. 1 (final, last seconds)
    setIntensity(v) { intensity = v; tempo = 0.135 - v * 0.012; },
    // background crowd murmur level 0..1
    crowd(v) { ensureCrowd(); const ac = A(); if (ac && crowd) crowd.g.gain.setTargetAtTime(0.012 + v * 0.05, ac.currentTime, 0.4); },
    jump() { if (A() && gate('j', 50)) { T('sine', 300, 720, 0.13, 0.09); T('triangle', 600, 1100, 0.08, 0.03); } },
    dive() { if (A() && gate('dv', 60)) { audio.burst(0.28, 0.16, 'bandpass', 700, 2600); T('sine', 520, 260, 0.2, 0.05); } },
    land(k = 0.5) { if (A() && gate('l', 70)) { T('sine', 180, 70, 0.12, 0.06 + k * 0.1); audio.burst(0.06, 0.05 + 0.08 * k, 'lowpass', 1200, 200); } },
    slide() { if (A() && gate('sl', 200)) audio.burst(0.3, 0.07, 'bandpass', 1400, 500); },
    bonk() { if (A() && gate('bk', 120)) { T('square', 880, 860, 0.05, 0.08); T('triangle', 440, 420, 0.12, 0.1, 0.02); T('sine', 1600, 600, 0.25, 0.05, 0.04); } },
    hit(mine) { if (!A() || !gate('h', 60)) return; const v = mine ? 1 : 0.45; T('square', 160, 60, 0.12, 0.12 * v); audio.burst(0.18, 0.28 * v, 'lowpass', 3500, 200); T('sine', 1200, 2400, 0.1, 0.06 * v, 0.03); },
    bump() { if (A() && gate('bp', 90)) { T('sine', 260, 520, 0.08, 0.07); T('sine', 520, 260, 0.1, 0.04, 0.05); } },
    grab() { if (A() && gate('g', 150)) { T('triangle', 500, 320, 0.08, 0.07); audio.burst(0.05, 0.06, 'highpass', 3000, 2000); } },
    hang() { if (A() && gate('hg', 200)) T('triangle', 700, 500, 0.06, 0.05); },
    climb() { if (A()) { T('sine', 400, 900, 0.12, 0.07); } },
    door() { if (A() && gate('d', 80)) { audio.burst(0.3, 0.25, 'lowpass', 2200, 300); T('square', 220, 110, 0.15, 0.06); T('triangle', 900, 1400, 0.08, 0.04, 0.05); } },
    tile(near) { if (A() && gate('t', 60)) { T('square', 1200, 900, 0.03, near ? 0.04 : 0.015); } },
    tileFall(near) { if (A() && near && gate('tf', 70)) audio.burst(0.25, 0.08, 'lowpass', 900, 150); },
    splash(near) { if (!A() || !gate('sp', 90)) return; const v = near ? 1 : 0.35; audio.burst(0.5, 0.2 * v, 'lowpass', 1600, 120); T('sine', 300, 90, 0.35, 0.08 * v); },
    whoosh() { if (A() && gate('w', 300)) audio.burst(0.5, 0.05, 'bandpass', 300, 1200); },
    cheer(v = 1) { if (!A()) return; audio.burst(1.6, 0.12 * v, 'bandpass', 1100, 1600); audio.burst(1.2, 0.08 * v, 'bandpass', 2200, 2600, 0.1); for (let i = 0; i < 4; i++) T('sine', 1500 + Math.random() * 900, 2200 + Math.random() * 800, 0.12, 0.012 * v, 0.1 + Math.random() * 0.8); },
    aww() { if (!A()) return; audio.burst(1.1, 0.08, 'bandpass', 700, 350); },
    qualify(mine) { if (!A()) return; if (mine) { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => T('square', f, f, 0.14, 0.07, i * 0.09)); api.cheer(1); } else T('triangle', 880, 1320, 0.12, 0.05); },
    eliminated(mine) { if (!A()) return; if (mine) { [392, 370, 349, 330].forEach((f, i) => T('sawtooth', f, i === 3 ? f * 0.85 : f, i === 3 ? 0.8 : 0.3, 0.07, i * 0.32)); api.aww(); } else { T('sawtooth', 300, 150, 0.3, 0.04); } },
    tick() { if (A()) T('square', 1000, 1000, 0.05, 0.05); },
    whistle() { if (A()) { T('sine', 2100, 2100, 0.12, 0.08); T('sine', 2400, 2400, 0.3, 0.08, 0.14); } },
    fanfare() { if (!A()) return; [523, 523, 523, 698, 880, 784, 1046].forEach((f, i) => T('square', f, f, i === 6 ? 0.6 : 0.13, 0.08, [0, 0.12, 0.24, 0.36, 0.6, 0.84, 1.0][i])); api.cheer(1.3); },
    firework() { if (!A() || !gate('fw', 120)) return; audio.burst(0.6, 0.12, 'lowpass', 2600, 200, Math.random() * 0.05); T('sine', 1800, 300, 0.4, 0.02); },
    pop() { if (A() && gate('pp', 50)) { T('sine', 900, 1400, 0.05, 0.05); audio.burst(0.05, 0.06, 'highpass', 4000, 3000); } },
    dispose() {
      api.stopMusic();
      for (const n of nodes) { try { n.stop?.(); } catch { /* */ } try { n.disconnect(); } catch { /* */ } }
      nodes.length = 0; crowd = null;
    },
  };
  return api;
}
