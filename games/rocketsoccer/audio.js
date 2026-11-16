// Rocket Soccer sound: a live stadium crowd bed that swells with the action, the player's own engine and boost
// rumble, punchy ball hits, pad pickups, demolitions, kickoff whistles and a goal horn + roar. All synthesized with
// WebAudio and routed into the shared sfx bus, so the hub's volume sliders work.
export class RSAudio {
  constructor(ctx) { this.a = ctx.audio; this.live = null; this.excite = 0; this.lastHit = 0; }
  get ok() { return this.a.ready && this.a.ctx && this.a.sfx; }
  // persistent loops (created lazily once the AudioContext exists)
  ensure() {
    if (this.live || !this.ok) return;
    const ac = this.a.ctx, out = this.a.sfx;
    const loop = (type, f, q) => { const s = ac.createBufferSource(); s.buffer = this.a.noise; s.loop = true; const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ac.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(out); s.start(); return { s, fl, g }; };
    const crowd = loop('bandpass', 900, 0.6), crowd2 = loop('lowpass', 420, 0.5), boost = loop('bandpass', 700, 1.4);
    const eng = ac.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 60;
    const eng2 = ac.createOscillator(); eng2.type = 'square'; eng2.frequency.value = 30;
    const ef = ac.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 500; ef.Q.value = 3;
    const eg = ac.createGain(); eg.gain.value = 0;
    eng.connect(ef); eng2.connect(ef); ef.connect(eg).connect(out); eng.start(); eng2.start();
    this.live = { crowd, crowd2, boost, eng, eng2, ef, eg };
  }
  // called every frame: speed 0..1 of my car, boosting, on the ground, crowd excitement from the game
  update(dt, { speed = 0, boosting = false, gnd = true, active = true, excite = 0 } = {}) {
    this.ensure(); if (!this.live) return;
    const L = this.live, t = this.a.ctx.currentTime;
    this.excite += (Math.max(excite, 0) - this.excite) * Math.min(1, dt * 1.5);
    const ex = this.excite;
    L.crowd.g.gain.setTargetAtTime(0.05 + ex * 0.22, t, 0.25); L.crowd.fl.frequency.setTargetAtTime(800 + ex * 700, t, 0.3);
    L.crowd2.g.gain.setTargetAtTime(0.06 + ex * 0.12, t, 0.3);
    const on = active ? 1 : 0;
    L.eg.gain.setTargetAtTime(on * (0.035 + speed * 0.05) * (gnd ? 1 : 0.6), t, 0.08);
    L.eng.frequency.setTargetAtTime(48 + speed * 150, t, 0.06); L.eng2.frequency.setTargetAtTime(24 + speed * 75, t, 0.06);
    L.ef.frequency.setTargetAtTime(300 + speed * 1400, t, 0.08);
    L.boost.g.gain.setTargetAtTime(on && boosting ? 0.16 : 0, t, 0.05); L.boost.fl.frequency.setTargetAtTime(500 + speed * 900, t, 0.1);
  }
  sfx(name, k = 1) {
    if (!this.ok) return;
    const A = this.a, T = (...x) => A.tone(...x), B = (...x) => A.burst(...x);
    k = Math.max(0.05, Math.min(1.6, k));
    switch (name) {
      case 'hit': { const now = performance.now(); if (now - this.lastHit < 70) return; this.lastHit = now;
        T('sine', 150 + k * 60, 50, 0.22, 0.32 * k); B(0.12, 0.22 * k, 'bandpass', 2600, 500); T('triangle', 420 + k * 200, 200, 0.08, 0.1 * k); break; }
      case 'bounce': T('sine', 110, 55, 0.18, 0.16 * k); B(0.08, 0.06 * k, 'lowpass', 900, 200); break;
      case 'jump': T('triangle', 260, 520, 0.12, 0.08 * k); B(0.1, 0.05 * k, 'highpass', 1500, 3000); break;
      case 'dodge': B(0.28, 0.14 * k, 'bandpass', 600, 2400); T('triangle', 300, 700, 0.18, 0.06 * k); break;
      case 'land': B(0.12, 0.12 * k, 'lowpass', 700, 120); T('sine', 90, 45, 0.12, 0.12 * k); break;
      case 'bump': T('square', 160, 80, 0.1, 0.1 * k); B(0.14, 0.16 * k, 'bandpass', 1400, 300); break;
      case 'pad': [880, 1175, 1568].forEach((f, i) => T('sine', f, f * 1.02, 0.12, 0.07 * k, i * 0.045)); break;
      case 'padbig': [660, 880, 1175, 1568, 2093].forEach((f, i) => T('triangle', f, f, 0.14, 0.08 * k, i * 0.05)); B(0.3, 0.06, 'highpass', 3000, 6000); break;
      case 'super': B(0.4, 0.12, 'bandpass', 800, 3000); T('sawtooth', 200, 900, 0.3, 0.04); break;
      case 'demo': B(0.9, 0.5 * k, 'lowpass', 1800, 60); T('sine', 120, 30, 0.7, 0.4 * k); T('square', 80, 40, 0.3, 0.1 * k); break;
      case 'whistle': T('sine', 2350, 2350, 0.16, 0.12); T('sine', 2550, 2550, 0.16, 0.06); T('sine', 2350, 2380, 0.4, 0.12, 0.2); break;
      case 'horn': [196, 247, 294].forEach((f) => { T('sawtooth', f, f, 1.4, 0.07); T('square', f / 2, f / 2, 1.4, 0.04); }); break;
      case 'goal': {
        B(1.4, 0.55, 'lowpass', 3000, 50); T('sine', 90, 28, 1.1, 0.5);
        B(2.6, 0.35, 'bandpass', 1200, 700, 0.25); B(2.2, 0.25, 'bandpass', 2200, 1200, 0.35);   // roar
        this.excite = 1.6; break;
      }
      case 'concede': B(1.4, 0.4, 'lowpass', 2500, 50); T('sine', 80, 26, 1.0, 0.4); B(1.6, 0.2, 'lowpass', 500, 120, 0.2); T('triangle', 330, 196, 0.8, 0.06, 0.3); break;
      case 'save': B(1.4, 0.2, 'bandpass', 1300, 800); T('triangle', 523, 784, 0.25, 0.08); this.excite = Math.max(this.excite, 1); break;
      case 'ooh': B(1.4, 0.18, 'bandpass', 600, 380); this.excite = Math.max(this.excite, 0.8); break;
      case 'end': T('sine', 2350, 2350, 0.5, 0.12); T('sine', 2350, 2350, 0.5, 0.12, 0.6); T('sine', 2350, 2300, 1.2, 0.12, 1.2); B(3, 0.3, 'bandpass', 1100, 700, 0.2); this.excite = 1.4; break;
      case 'overtime': [392, 392, 523].forEach((f, i) => T('sawtooth', f, f, 0.35, 0.07, i * 0.3)); break;
      case 'count': T('square', 700, 700, 0.08, 0.08); break;
      case 'respawn': T('sine', 400, 900, 0.25, 0.08); break;
    }
  }
  dispose() {
    if (!this.live) return;
    const L = this.live;
    for (const n of [L.crowd.s, L.crowd2.s, L.boost.s, L.eng, L.eng2]) { try { n.stop(); n.disconnect(); } catch { /* */ } }
    for (const n of [L.crowd.fl, L.crowd.g, L.crowd2.fl, L.crowd2.g, L.boost.fl, L.boost.g, L.ef, L.eg]) { try { n.disconnect(); } catch { /* */ } }
    this.live = null;
  }
}
