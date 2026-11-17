// Prop Hunt sound: everything is synthesized and routed into ctx.audio.sfx / ctx.audio.music so the volume
// sliders work. Taunts and hopping props are positional (stereo pan + distance + muffled through walls): that is
// how seekers track hiders down, so sound is part of the game, not decoration.
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export function createSound(ctx) {
  const A = ctx.audio;
  const nodes = new Set();
  let listener = { x: 0, z: 0, yaw: 0 }, occl = () => false;
  const ac = () => A.ctx;

  // a destination for one positional sound: gain (distance) -> pan -> (muffle) -> sfx
  function spot(x, y, z, vol = 1, range = 22) {
    const c = ac(); if (!c || !A.sfx) return null;
    const dx = x - listener.x, dz = z - listener.z, d = Math.hypot(dx, dz);
    if (d > range * 1.6) return null;
    const g = c.createGain(); g.gain.value = vol * Math.max(0.06, 1 / (1 + (d / (range * 0.25)) ** 1.4));
    const p = c.createStereoPanner();
    // listener forward = (sin yaw, cos yaw); right = (-cos yaw, sin yaw)  (camera looks along +forward)
    const rx = -Math.cos(listener.yaw), rz = Math.sin(listener.yaw);
    p.pan.value = d > 0.3 ? Math.max(-0.9, Math.min(0.9, (dx * rx + dz * rz) / d)) : 0;
    let out = p;
    g.connect(p);
    if (occl(x, y, z)) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; p.connect(f); out = f; g.gain.value *= 0.75; }
    out.connect(A.sfx);
    const node = { g, p, out };
    nodes.add(node); ctx.setTimeout(() => { try { g.disconnect(); p.disconnect(); out.disconnect(); } catch { /* */ } nodes.delete(node); }, 4000);
    return g;
  }
  const T = (type, f0, f1, dur, vol, delay = 0, dest) => A.tone(type, f0, f1, dur, vol, delay, dest);
  const N = (dur, vol, type, f0, f1, delay = 0, dest) => A.burst(dur, vol, type, f0, f1, delay, dest);
  // a tone with vibrato (kazoo / horn voices)
  function voice(dest, type, f, dur, vol, delay = 0, vib = 0, glide = 1, filter = 0) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain(); o.type = type;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * glide, t + dur);
    if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 6; lg.gain.value = vib; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.setValueAtTime(vol, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let last = o.connect(g);
    if (filter) { const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = filter; f2.Q.value = 1.4; last = g.connect(f2); }
    last.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  const TAUNT = {
    kazoo(d) { [[67, 0.16], [67, 0.16], [69, 0.16], [72, 0.5]].reduce((t, [n, l]) => { voice(d, 'sawtooth', midi(n), l, 0.22, t, 9, 1, 1300); return t + l + 0.03; }, 0); },
    quack(d) { for (const t of [0, 0.28]) { voice(d, 'sawtooth', 520, 0.2, 0.25, t, 0, 0.55, 900); N(0.12, 0.08, 'bandpass', 1400, 600, t, d); } },
    honk(d) { for (const t of [0, 0.3]) { voice(d, 'square', 330, 0.24, 0.18, t, 0, 0.98, 700); voice(d, 'square', 415, 0.24, 0.12, t, 0, 0.98, 700); } },
    slide(d) { voice(d, 'sine', 500, 0.45, 0.3, 0, 12, 3.2); voice(d, 'sine', 1600, 0.5, 0.3, 0.5, 12, 0.3); },
    boing(d) { const c = ac(); if (!c) return; const t = c.currentTime; const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.08); for (let i = 0; i < 8; i++) o.frequency.setValueAtTime(i % 2 ? 300 : 360, t + 0.1 + i * 0.05); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6); o.connect(g).connect(d); o.start(t); o.stop(t + 0.65); },
    cuckoo(d) { for (const t of [0, 0.5]) { voice(d, 'sine', midi(84), 0.18, 0.3, t); voice(d, 'sine', midi(80), 0.3, 0.3, t + 0.2); } T('square', 1200, 1200, 0.03, 0.05, 0, d); },
  };

  // ---------------------------------------------------------------- music: cozy lounge loop (electric piano chords, walking bass, brushes)
  let musicOn = false, step = 0, nextT = 0, tempo = 0.27, mood = 'calm';
  const PROG = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [55, 59, 62, 65]];   // Fmaj7 Em7 Dm7 G7
  const BASS = [[41, 45, 48, 45], [40, 43, 47, 43], [38, 41, 45, 41], [43, 47, 50, 47]];
  function tickMusic() {
    const c = ac(); if (!c || !musicOn || !A.music) return;
    while (nextT < c.currentTime + 0.35) {
      const dl = nextT - c.currentTime, bar = Math.floor(step / 8) % 4, s = step % 8;
      const beat = mood === 'hide' ? 0.5 : mood === 'tense' ? 0.8 : 1;
      if (mood === 'hide') { if (s % 2 === 0) T('square', s % 4 === 0 ? 1800 : 1500, s % 4 === 0 ? 1800 : 1500, 0.03, 0.05, dl, A.music); }
      if (s === 0 || s === 5) for (const n of PROG[bar]) T('triangle', midi(n + 12), midi(n + 12), tempo * 2.4, 0.032 * beat, dl, A.music);
      if (s % 2 === 0 && mood !== 'hide') T('sine', midi(BASS[bar][s / 2]), midi(BASS[bar][s / 2]), tempo * 1.6, 0.12, dl, A.music);
      if (mood !== 'hide') N(0.06, s % 2 ? 0.015 : 0.03, 'highpass', 6000, 4000, dl, A.music);
      if (mood === 'tense' && s % 2 === 1) N(0.04, 0.02, 'highpass', 8000, 7000, dl, A.music);
      if (mood !== 'hide' && s === 6 && Math.random() < 0.5) { const n = PROG[bar][Math.floor(Math.random() * 4)] + 24; T('sine', midi(n), midi(n), 0.25, 0.03, dl, A.music); }
      nextT += mood === 'tense' ? tempo * 0.8 : tempo; step++;
    }
  }
  ctx.setInterval(tickMusic, 100);

  return {
    setListener(l, occluded) { listener = l; occl = occluded; },
    music(on, m = 'calm') { if (on && !musicOn && ac()) { nextT = ac().currentTime + 0.1; step = 0; } musicOn = on; mood = m; },
    taunt(name, x, y, z, loud = 1) { const d = spot(x, y, z, 1.25 * loud, 30); if (d) (TAUNT[name] || TAUNT.kazoo)(d); },
    tauntLocal(name) { if (A.sfx) (TAUNT[name] || TAUNT.kazoo)(A.sfx); },
    hop(x, y, z, size) { const d = spot(x, y, z, 0.5, 10); if (d) { const f = 900 - size * 600; T('sine', f, f * 0.7, 0.06, 0.12, 0, d); N(0.03, 0.05, 'bandpass', 2500, 1500, 0, d); } },
    step(x, y, z) { const d = spot(x, y, z, 0.35, 9); if (d) N(0.05, 0.08, 'lowpass', 900, 300, 0, d); },
    swing(mine) { if (mine) N(0.16, 0.12, 'bandpass', 600, 2400); },
    squeak(x, y, z) { const d = spot(x, y, z, 1, 18); if (d) { T('sine', 1000, 2100, 0.12, 0.2, 0, d); T('sine', 1900, 1300, 0.1, 0.15, 0.1, d); N(0.15, 0.15, 'lowpass', 600, 100, 0, d); } },
    oops(mine) { T('triangle', 300, 160, 0.25, 0.22); if (mine) { T('sawtooth', 220, 110, 0.35, 0.1, 0.12); T('sine', 880, 440, 0.2, 0.08, 0.05); } },
    found(mine, byMe, x, y, z) {
      const d = spot(x, y, z, 1.2, 40) || A.sfx;
      if (!d) return;
      N(0.18, 0.25, 'bandpass', 3000, 800, 0, d); T('sine', 400, 1400, 0.12, 0.2, 0, d);
      if (byMe) [72, 76, 79, 84].forEach((n, i) => T('square', midi(n), midi(n), 0.12, 0.08, 0.12 + i * 0.08));
      if (mine) [67, 66, 65, 64].forEach((n, i) => voice(A.sfx, 'sawtooth', midi(n - 12), i === 3 ? 0.7 : 0.3, 0.1, 0.2 + i * 0.32, i === 3 ? 7 : 0, i === 3 ? 0.97 : 1, 900));
    },
    poof(x, y, z) { const d = spot(x, y, z, 0.8, 16); if (d) { N(0.35, 0.18, 'bandpass', 500, 2500, 0, d); T('sine', 300, 900, 0.15, 0.08, 0, d); } },
    lock(on) { T('square', on ? 700 : 500, on ? 1000 : 350, 0.06, 0.06); },
    rotate() { T('triangle', 600, 760, 0.05, 0.05); },
    sniff(hot) { for (let i = 0; i < 3; i++) N(0.09, 0.12, 'bandpass', 2200, 1200, i * 0.13); T('sine', hot ? 900 : 300, hot ? 1200 : 200, 0.3, 0.08, 0.45); },
    warn() { for (const t of [0, 0.35]) { T('sawtooth', 300, 300, 0.28, 0.1, t); T('sawtooth', 450, 450, 0.28, 0.07, t); } },
    tick(last) { T('square', last ? 1400 : 1000, last ? 1400 : 1000, 0.05, 0.06); },
    roleStinger(seeker) { (seeker ? [55, 58, 62, 67] : [72, 76, 79, 74]).forEach((n, i) => T(seeker ? 'sawtooth' : 'triangle', midi(n), midi(n), 0.18, 0.08, i * 0.11)); },
    roundEnd(win) { (win ? [60, 64, 67, 72, 76] : [67, 63, 60]).forEach((n, i) => T('triangle', midi(n), midi(n), 0.22, 0.13, i * 0.12)); },
    faint() { voice(A.sfx, 'sine', 900, 0.8, 0.15, 0, 20, 0.25); },
    dispose() { musicOn = false; for (const n of nodes) { try { n.g.disconnect(); n.p.disconnect(); n.out.disconnect(); } catch { /* */ } } nodes.clear(); },
  };
}
