// Rising Lava soundscape, all synthesized through the hub's shared buses (ctx.audio.sfx / .music) so the volume
// sliders work: a deep volcanic rumble (filtered noise + sub sine) that swells as the lava gets close to you and
// before each surge, bubbling lava "bloops", crackle under hot platforms, and punchy jump / dash / shove / hit
// / crumble / burn effects.
const C_BOMB = 1.3;
export function createSound(audio) {
  const nodes = [];
  let rumble = null, last = {}, beatT = 0, beatN = 0;
  const A = () => audio.ready && audio.ctx;
  const gate = (k, ms) => { const n = performance.now(); if (n - (last[k] || 0) < ms) return false; last[k] = n; return true; };

  function ensure() {
    const ac = A(); if (!ac || rumble) return;
    // rumble: looping brown-ish noise -> lowpass -> gain; plus a sub sine with slow wobble
    const src = ac.createBufferSource(); src.buffer = audio.noise; src.loop = true;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120; lp.Q.value = 0.7;
    const lp2 = ac.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 220;
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(lp).connect(lp2).connect(g).connect(audio.sfx); src.start();
    const sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = 38;
    const subG = ac.createGain(); subG.gain.value = 0;
    const wob = ac.createOscillator(); wob.frequency.value = 0.35; const wobG = ac.createGain(); wobG.gain.value = 6; wob.connect(wobG).connect(sub.frequency); wob.start();
    sub.connect(subG).connect(audio.music); sub.start();
    nodes.push(src, lp, lp2, g, sub, subG, wob, wobG);
    rumble = { g, lp, subG };
  }

  return {
    // danger 0..1 (lava close below me), surge 0..1 (surge warning), heat 0..1 (my platform)
    update(dt, { danger = 0, surge = 0, active = true, intensity = 0, final = false }) {
      ensure(); const ac = A(); if (!ac || !rumble) return;
      const t = ac.currentTime;
      const v = active ? 0.16 + danger * 0.45 + surge * 0.5 : 0.06;
      rumble.g.gain.setTargetAtTime(v, t, 0.25);
      rumble.lp.frequency.setTargetAtTime(90 + danger * 160 + surge * 200, t, 0.3);
      rumble.subG.gain.setTargetAtTime(active ? 0.1 + danger * 0.18 + surge * 0.2 : 0.03, t, 0.4);
      // tension drums on the music bus: a heartbeat that speeds up as the lava climbs (and in the final two)
      if (active) {
        const bpm = 78 + intensity * 70 + (final ? 22 : 0);
        beatT -= dt;
        if (beatT <= 0) {
          beatT += 60 / bpm; beatN++;
          const accent = beatN % 2 === 1;
          audio.tone('sine', accent ? 105 : 80, 38, 0.22, accent ? 0.32 : 0.2, 0, audio.music);
          if (beatN % 4 === 0 && intensity > 0.35) audio.tone('triangle', 196, 150, 0.12, 0.08, 0.02, audio.music);
          if (intensity > 0.6 && beatN % 2 === 0) audio.burst(0.05, 0.05, 'highpass', 6000, 4000, 60 / bpm / 2, audio.music);
        }
      } else beatT = 0.2;
      // random lava bloops
      if (active && Math.random() < dt * (0.7 + danger * 2)) { const f = 70 + Math.random() * 90; audio.tone('sine', f, f * 2.4, 0.18, 0.05 + danger * 0.06); }
    },
    jump() { if (A() && gate('j', 60)) { audio.tone('square', 260, 520, 0.09, 0.05); audio.tone('sine', 400, 800, 0.12, 0.06); } },
    land(k = 0.5) { if (A() && gate('l', 70)) { audio.burst(0.08, 0.12 * k + 0.05, 'lowpass', 900, 120); audio.tone('sine', 140, 60, 0.1, 0.08 * k + 0.03); } },
    dash() { if (A()) { audio.burst(0.22, 0.18, 'bandpass', 900, 3200); audio.tone('sawtooth', 300, 700, 0.12, 0.03); } },
    shove(hit) { if (!A()) return; audio.burst(0.12, 0.16, 'bandpass', 500, 1600); if (!hit) audio.tone('triangle', 330, 220, 0.1, 0.05); },
    hit(mine) { if (!A()) return; const v = mine ? 1 : 0.6; audio.tone('square', 200, 70, 0.14, 0.14 * v); audio.burst(0.18, 0.3 * v, 'lowpass', 3000, 200); audio.tone('sine', 900, 1500, 0.06, 0.05 * v, 0.02); },
    crack() { if (A() && gate('c', 90)) { audio.burst(0.12, 0.12, 'highpass', 2500, 1200); audio.tone('square', 1800, 900, 0.04, 0.03); } },
    crumble(near) { if (!A() || !gate('cr', 80)) return; const v = near ? 1 : 0.4; audio.burst(0.5, 0.28 * v, 'lowpass', 1400, 90); audio.tone('sawtooth', 110, 45, 0.45, 0.07 * v); },
    sizzle(k) { if (A() && Math.random() < k * 0.5 && gate('s', 120)) audio.burst(0.1, 0.03 + k * 0.05, 'highpass', 5000, 3500); },
    burn(mine) { if (!A()) return; const v = mine ? 1 : 0.5; audio.burst(0.9, 0.35 * v, 'bandpass', 3500, 400); audio.tone('sawtooth', 520, 90, 0.7, 0.09 * v); audio.tone('sine', 900, 300, 0.4, 0.06 * v, 0.05); },
    whistle() { if (A()) audio.tone('sine', 1400, 500, C_BOMB, 0.04); },
    boom(near) { if (!A()) return; const v = near ? 1 : 0.5; audio.burst(0.7, 0.4 * v, 'lowpass', 2200, 70); audio.tone('sine', 120, 35, 0.5, 0.22 * v); audio.tone('square', 90, 40, 0.25, 0.06 * v); },
    erupt() { if (!A()) return; audio.burst(1.4, 0.45, 'lowpass', 900, 60); audio.tone('sine', 70, 28, 1.2, 0.3); audio.tone('sawtooth', 55, 30, 0.9, 0.08); },
    rise() { if (A() && gate('r', 250)) { audio.burst(0.6, 0.12, 'lowpass', 300, 900); audio.tone('sine', 55, 90, 0.5, 0.1); } },
    surge() { if (A()) { audio.burst(1.6, 0.35, 'lowpass', 160, 600); audio.tone('sawtooth', 45, 70, 1.4, 0.12); } },
    roundWin(mine) { if (mine) audio.play('fanfare'); else audio.play('win', 0.7); },
    dispose() {
      for (const n of nodes) { try { n.stop?.(); } catch { /* */ } try { n.disconnect(); } catch { /* */ } }
      nodes.length = 0; rumble = null;
    },
  };
}
