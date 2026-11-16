// NEON RUSH — sound: a synthwave music loop (music bus) and the ship's engine / drift / boost sounds (sfx bus).
// Everything is synthesized through ctx.audio so the hub's volume sliders work; stop() releases every node.
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class NeonAudio {
  constructor(ctx) {
    this.a = ctx.audio; this.ctx = ctx; this.nodes = []; this.on = false;
    this.music = { step: 0, next: 0, timer: 0, intensity: 0, bpm: 116 };
    this.engine = null;
  }
  get ac() { return this.a.ctx; }
  ensure() {
    if (this.on || !this.a.ctx) return !!this.engine;
    const ac = this.a.ctx; if (!ac) return false;
    this.on = true;
    // engine: two detuned saws + sub sine through a lowpass
    const g = ac.createGain(); g.gain.value = 0;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 4;
    const o1 = ac.createOscillator(); o1.type = 'sawtooth';
    const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 9;
    const sub = ac.createOscillator(); sub.type = 'sine';
    const subG = ac.createGain(); subG.gain.value = 0.6;
    o1.connect(lp); o2.connect(lp); sub.connect(subG).connect(lp); lp.connect(g).connect(this.a.sfx);
    // drift hiss: looped noise through a bandpass
    const nz = ac.createBufferSource(); nz.buffer = this.a.noise; nz.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 1.4;
    const dg = ac.createGain(); dg.gain.value = 0;
    nz.connect(bp).connect(dg).connect(this.a.sfx);
    // wind / speed rush
    const nz2 = ac.createBufferSource(); nz2.buffer = this.a.noise; nz2.loop = true;
    const wl = ac.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 800;
    const wg = ac.createGain(); wg.gain.value = 0;
    nz2.connect(wl).connect(wg).connect(this.a.sfx);
    for (const o of [o1, o2, sub, nz, nz2]) o.start();
    this.engine = { g, lp, o1, o2, sub, dg, bp, wg, wl };
    this.nodes.push(o1, o2, sub, nz, nz2, g, lp, subG, bp, dg, wl, wg);
    return true;
  }
  // per frame: speed 0..~90, boost 0/1/2, drift tier -1(no drift)..3, air
  engineUpdate(v, boost, tier, air, active) {
    if (!this.ensure()) return;
    const e = this.engine, t = this.ac.currentTime;
    const f = 48 + Math.max(0, v) * 2.1 + boost * 28;
    e.o1.frequency.setTargetAtTime(f, t, 0.05); e.o2.frequency.setTargetAtTime(f * 1.005, t, 0.05); e.sub.frequency.setTargetAtTime(f / 2, t, 0.05);
    e.lp.frequency.setTargetAtTime(380 + v * 22 + boost * 900 + (air ? -200 : 0), t, 0.06);
    e.g.gain.setTargetAtTime(active ? 0.07 + Math.min(1, v / 80) * 0.05 + boost * 0.02 : 0, t, 0.08);
    e.dg.gain.setTargetAtTime(tier >= 0 && active ? 0.05 + tier * 0.02 : 0, t, 0.04);
    e.bp.frequency.setTargetAtTime(2200 + Math.max(0, tier) * 900, t, 0.05);
    e.wg.gain.setTargetAtTime(active ? Math.min(1, v / 90) * 0.06 + boost * 0.03 : 0, t, 0.1);
    e.wl.frequency.setTargetAtTime(500 + v * 25, t, 0.1);
  }
  // ---- one-shot effects
  sfx(name, k = 1) {
    const A = this.a; if (!A.ctx) return;
    const T = (...x) => A.tone(...x);
    switch (name) {
      case 'driftStart': A.burst(0.12, 0.08 * k, 'highpass', 2500, 5000); break;
      case 'tier1': T('square', 880, 1320, 0.09, 0.07 * k); break;
      case 'tier2': T('square', 1046, 1568, 0.09, 0.07 * k); T('square', 1568, 1568, 0.08, 0.05 * k, 0.07); break;
      case 'tier3': [1318, 1661, 1975, 2637].forEach((f, i) => T('square', f, f, 0.07, 0.05 * k, i * 0.045)); break;
      case 'release': A.burst(0.45, 0.16 * k, 'bandpass', 600, 3200); T('sawtooth', 160, 520, 0.35, 0.08 * k); break;
      case 'chain': { const base = 523 * Math.pow(2, Math.min(4, k - 1) / 6); [1, 1.25, 1.5, 2].forEach((m, i) => T('triangle', base * m, base * m, 0.11, 0.08, i * 0.05)); break; }
      case 'fizzle': T('sawtooth', 300, 120, 0.18, 0.05 * k); break;
      case 'wall': A.burst(0.25, 0.22 * k, 'lowpass', 1800, 200); T('square', 110, 60, 0.15, 0.08 * k); break;
      case 'bump': A.burst(0.15, 0.18 * k, 'lowpass', 900, 200); T('sine', 140, 70, 0.14, 0.12 * k); break;
      case 'pad': T('sawtooth', 300, 1200, 0.25, 0.06 * k); A.burst(0.3, 0.08 * k, 'highpass', 1500, 6000); break;
      case 'jump': A.burst(0.4, 0.1 * k, 'bandpass', 500, 2500); break;
      case 'land': A.burst(0.2, 0.2 * k, 'lowpass', 900, 120); T('sine', 90, 45, 0.18, 0.18 * k); break;
      case 'fall': T('sawtooth', 600, 80, 0.8, 0.08 * k); break;
      case 'respawn': T('triangle', 400, 900, 0.25, 0.08 * k); break;
      case 'boost': A.burst(0.6, 0.12 * k, 'bandpass', 300, 1800); T('sawtooth', 110, 330, 0.4, 0.06 * k); break;
      case 'draft': T('sine', 600, 900, 0.2, 0.05 * k); break;
      case 'lap': [784, 988, 1175].forEach((f, i) => T('square', f, f, 0.12, 0.06 * k, i * 0.09)); break;
      case 'final': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => T('square', f, f, 0.12, 0.07 * k, i * 0.08)); break;
      case 'pass': T('triangle', 900, 1400, 0.08, 0.05 * k); break;
      case 'passed': T('triangle', 700, 450, 0.1, 0.04 * k); break;
      case 'finish': A.play('fanfare'); break;
      case 'overheat': A.burst(0.5, 0.18 * k, 'highpass', 800, 6000); T('sawtooth', 500, 90, 0.45, 0.08 * k); break;
      case 'derez': [880, 660, 440, 220].forEach((f, i) => T('square', f, f * 0.7, 0.14, 0.08 * k, i * 0.08)); A.burst(0.8, 0.16 * k, 'bandpass', 3000, 200); break;
      case 'derezOther': A.burst(0.5, 0.08 * k, 'bandpass', 2500, 300); T('square', 500, 200, 0.3, 0.04 * k); break;
      case 'whoosh': A.burst(0.35, 0.09 * k, 'bandpass', 900, 3500); break;
      case 'firework': A.burst(0.5, 0.06 * k, 'lowpass', 3000, 200, Math.random() * 0.1); break;
      case 'shortcut': T('sine', 300, 1600, 0.3, 0.05 * k); break;
    }
  }
  // ---- music: driving synthwave (kick, offbeat bass, arpeggio, pads). intensity 0..2 adds layers.
  startMusic() {
    if (this.music.timer || !this.a.ctx) return;
    const ac = this.a.ctx, m = this.music;
    m.next = ac.currentTime + 0.1; m.step = 0;
    const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];   // Am F C G
    m.timer = this.ctx.setInterval(() => {
      if (!this.a.ctx) return;
      const s16 = 60 / m.bpm / 4;
      while (m.next < ac.currentTime + 0.25) {
        const st = m.step, bar = Math.floor(st / 16), chord = PROG[bar % 4], d = m.next - ac.currentTime;
        const out = this.a.music;
        // kick on every beat
        if (st % 4 === 0) { this.a.tone('sine', 150, 42, 0.22, 0.38, d, out); }
        // snare on 2 and 4
        if (st % 16 === 4 || st % 16 === 12) this.a.burst(0.16, 0.14, 'bandpass', 1800, 900, d, out);
        // hats
        if (m.intensity >= 1 && st % 2 === 1) this.a.burst(0.04, 0.05, 'highpass', 7000, 9000, d, out);
        // offbeat bass (8ths, root)
        if (st % 2 === 0) { const n = chord[0] - 24 + (st % 4 === 2 ? 12 : 0); this.a.tone('sawtooth', midi(n), midi(n), 0.14, 0.09, d, out); }
        // arpeggio 16ths
        const arp = chord[[0, 1, 2, 1][st % 4]] + 12 + (st % 8 >= 4 ? 12 : 0);
        this.a.tone('square', midi(arp), midi(arp), 0.09, m.intensity >= 2 ? 0.035 : 0.022, d, out);
        // pad chord each bar
        if (st % 16 === 0) for (const n of chord) this.a.tone('triangle', midi(n), midi(n), s16 * 15, 0.03, d, out);
        // final-lap lead
        if (m.intensity >= 2 && st % 8 === 0) { const n = chord[2] + 24; this.a.tone('sawtooth', midi(n), midi(n + (st % 16 ? 0 : 2)), s16 * 3, 0.03, d, out); }
        m.next += s16; m.step++;
      }
    }, 60);
  }
  // 0..1 pulse on every beat of the music (1 right on the beat, decaying), for lights that breathe with it
  beat() {
    const m = this.music, ac = this.a.ctx;
    if (!m.timer || !ac) return 0;
    const s16 = 60 / m.bpm / 4, stepNow = m.step - (m.next - ac.currentTime) / s16;
    const ph = ((stepNow / 4) % 1 + 1) % 1;
    return Math.exp(-ph * 5);
  }
  setIntensity(i) { this.music.intensity = i; if (i >= 2) this.music.bpm = 124; }
  stop() {
    if (this.music.timer) this.ctx.clearInterval(this.music.timer);
    this.music.timer = 0;
    for (const n of this.nodes) { try { n.stop?.(); } catch { /* */ } try { n.disconnect(); } catch { /* */ } }
    this.nodes = []; this.engine = null;
  }
}
