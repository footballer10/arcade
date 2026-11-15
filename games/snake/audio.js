// Snake Royale soundscape, all synthesized and routed through the shared buses (ctx.audio.sfx / .music) so the
// volume sliders work: a low pulsing synth drone, pentatonic "plinks" that climb as you chain orbs, a filtered
// whoosh while boosting, crunchy pops for deaths and a siren when the ring starts to close.
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export function createSound(audio) {
  const nodes = [];
  let combo = 0, comboT = 0, lastEat = 0, boostGain = null, boostFilter = null, drone = null;
  const A = () => audio.ready && audio.ctx;

  function ensureLoops() {
    const ac = A(); if (!ac || boostGain) return;
    // boost whoosh: looping noise -> bandpass -> gain (0 until boosting)
    const src = ac.createBufferSource(); src.buffer = audio.noise; src.loop = true;
    boostFilter = ac.createBiquadFilter(); boostFilter.type = 'bandpass'; boostFilter.frequency.value = 900; boostFilter.Q.value = 1.4;
    boostGain = ac.createGain(); boostGain.gain.value = 0;
    src.connect(boostFilter).connect(boostGain).connect(audio.sfx); src.start();
    nodes.push(src, boostFilter, boostGain);
    // drone on the music bus: two detuned saws through a slowly breathing low-pass
    const g = ac.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(0.11, ac.currentTime, 1.5);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 6;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.9; const lfoG = ac.createGain(); lfoG.gain.value = 140; lfo.connect(lfoG).connect(lp.frequency); lfo.start();
    for (const [f, d] of [[55, -7], [55, 7], [82.4, 0]]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; o.connect(lp); o.start(); nodes.push(o); }
    lp.connect(g).connect(audio.music);
    nodes.push(g, lp, lfo, lfoG);
    drone = { g, lp };
  }

  return {
    update(dt, { boosting, danger = 0, intensity = 0 }) {
      ensureLoops();
      const ac = A(); if (!ac || !boostGain) return;
      const t = ac.currentTime;
      boostGain.gain.setTargetAtTime(boosting ? 0.22 : 0, t, boosting ? 0.04 : 0.12);
      boostFilter.frequency.setTargetAtTime(boosting ? 1500 : 700, t, 0.2);
      drone.lp.frequency.setTargetAtTime(260 + intensity * 900 + danger * 400, t, 0.4);
      if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
    },
    eat(v = 1, big = false) {
      if (!A()) return;
      const now = performance.now(); if (now - lastEat < 45) return; lastEat = now;
      combo = Math.min(PENTA.length - 1, combo + 1); comboT = 0.6;
      const f = 523.25 * Math.pow(2, PENTA[combo] / 12);
      audio.tone('sine', f, f * 1.01, 0.12, 0.07 + Math.min(0.06, v * 0.012));
      audio.tone('triangle', f * 2, f * 2, 0.05, 0.025);
      if (big) audio.tone('sine', f * 1.5, f * 1.5, 0.2, 0.05, 0.04);
    },
    boostStart() { if (A()) audio.burst(0.25, 0.12, 'highpass', 600, 3000); },
    death(mine, near) {
      if (!A()) return;
      const v = mine ? 1 : near ? 0.7 : 0.35;
      audio.burst(0.5, 0.35 * v, 'lowpass', 2400, 80);
      audio.tone('square', 300, 40, 0.45, 0.14 * v);
      audio.tone('sawtooth', 180, 30, 0.6, 0.08 * v, 0.03);
      for (let i = 0; i < 5; i++) audio.tone('sine', 1200 + Math.random() * 1600, 2400 + Math.random() * 1000, 0.08, 0.035 * v, 0.06 + i * 0.05);
    },
    kill() { if (!A()) return; [659, 784, 988, 1319].forEach((f, i) => audio.tone('square', f, f, 0.12, 0.06, i * 0.06)); },
    ring() { if (!A()) return; for (let i = 0; i < 3; i++) { audio.tone('sawtooth', 380, 760, 0.35, 0.05, i * 0.4); audio.tone('sawtooth', 760, 380, 0.35, 0.05, i * 0.4 + 0.2); } },
    tick() { if (A()) audio.tone('square', 1100, 1100, 0.05, 0.05); },
    win() { audio.play('fanfare'); },
    dispose() {
      for (const n of nodes) { try { n.stop?.(); } catch { /* */ } try { n.disconnect(); } catch { /* */ } }
      nodes.length = 0; boostGain = null; drone = null;
    },
  };
}
