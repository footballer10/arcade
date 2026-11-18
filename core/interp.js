// Smooth drawing of things the host simulates (other players, the ball…) from snapshots that arrive late, bunched
// together or after a pause, as they do over the relay. Keep one SnapBuffer per entity:
//
//   const buf = new SnapBuffer({ angles: ['face'] });
//   on snapshot:  buf.push(snap.t, { x, y, z, face }, hostNow)   // t and hostNow in the same clock (seconds),
//                                                                // e.g. the round clock: hostNow = your estimate of
//                                                                // the host's clock right now
//   every frame:  const s = buf.sample(hostNow)                  // → { x, y, z, face } or null
//
// It draws each entity slightly in the past (how late snapshots have recently been arriving, plus a little), so there
// is almost always a newer snapshot to blend towards. The delay adapts: about one snapshot interval on a good
// connection, more on a jittery one. If snapshots stop coming it keeps moving along the last velocity for a moment,
// then holds still.
// Just the adaptive delay, for games that already keep their own snapshot buffer with a fixed "draw others N ms in
// the past" constant: call observe(hostNow - snapshotHostTime) when a snapshot arrives, and use .value (seconds)
// instead of the constant. On a direct link it settles near the old ~0.1 s; on the relay it grows to cover the delay.
export class AdaptiveDelay {
  constructor({ min = 0.08, max = 0.35, start = 0.1, interval = 0.05 } = {}) { this.min = min; this.max = max; this.value = start; this.interval = interval; this.late = []; }
  observe(late) {
    if (!Number.isFinite(late)) return this.value;
    this.late.push(late); if (this.late.length > 40) this.late.shift();
    const sorted = [...this.late].sort((a, b) => a - b);
    const target = Math.min(this.max, Math.max(this.min, sorted[Math.floor(sorted.length * 0.9)] + this.interval * 0.5));
    this.value += (target - this.value) * (target > this.value ? 0.3 : 0.03);    // grow fast, shrink slowly
    return this.value;
  }
}

export class SnapBuffer {
  constructor({ angles = [], maxExtrap = 0.25, minDelay = 0.03, maxDelay = 0.35 } = {}) {
    this.angles = new Set(angles); this.maxExtrap = maxExtrap; this.minDelay = minDelay; this.maxDelay = maxDelay;
    this.snaps = [];        // [{ t, s }] oldest → newest
    this.late = [];         // recent (hostNow - t) at arrival
    this.delay = 0.1; this.out = {};
  }
  clear() { this.snaps.length = 0; this.late.length = 0; }
  push(t, state, hostNow) {
    const n = this.snaps.length;
    if (n && t <= this.snaps[n - 1].t) { if (t < this.snaps[n - 1].t - 1) this.clear(); else return; }   // old / duplicate (or the clock restarted)
    this.snaps.push({ t, s: { ...state } });
    if (this.snaps.length > 40) this.snaps.shift();
    if (hostNow !== undefined) {
      this.late.push(hostNow - t); if (this.late.length > 40) this.late.shift();
      const sorted = [...this.late].sort((a, b) => a - b);
      const gap = n ? Math.min(0.2, t - this.snaps[n - 1].t) : 0.05;
      const want = sorted[Math.floor(sorted.length * 0.9)] + gap * 0.5;   // nearly every snapshot is here in time
      const target = Math.min(this.maxDelay, Math.max(this.minDelay, want));
      this.delay += (target - this.delay) * (target > this.delay ? 0.3 : 0.03);    // grow fast, shrink slowly
    }
  }
  sample(hostNow) {
    const a = this.snaps; if (!a.length) return null;
    const rt = hostNow - this.delay;
    let i = a.length - 1;
    while (i > 0 && a[i - 1].t > rt) i--;
    const out = this.out;
    if (rt >= a[a.length - 1].t) {                        // ran out: extrapolate briefly along the last velocity
      const last = a[a.length - 1], prev = a.length > 1 ? a[a.length - 2] : null;
      const k = Math.min(rt - last.t, this.maxExtrap);
      for (const key in last.s) {
        const v = last.s[key];
        if (typeof v !== 'number') { out[key] = v; continue; }
        if (!prev || typeof prev.s[key] !== 'number' || last.t === prev.t) { out[key] = v; continue; }
        let d = v - prev.s[key]; if (this.angles.has(key)) d = wrap(d);
        out[key] = v + (d / (last.t - prev.t)) * k * (this.angles.has(key) ? 0 : 1);
      }
      return out;
    }
    if (i === 0 && rt < a[0].t) { Object.assign(out, a[0].s); return out; }
    const A = a[i - 1] || a[0], B = a[i], f = B.t > A.t ? (rt - A.t) / (B.t - A.t) : 1;
    for (const key in B.s) {
      const v = B.s[key], u = A.s[key];
      if (typeof v !== 'number' || typeof u !== 'number') { out[key] = v; continue; }
      out[key] = this.angles.has(key) ? u + wrap(v - u) * f : u + (v - u) * f;
    }
    return out;
  }
}
function wrap(d) { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
