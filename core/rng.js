// Seeded random numbers. The host picks a seed per round and every client builds identical levels from it.
//   const rng = createRng(ctx.seed);  rng() -> [0,1)   rng.int(1, 6)   rng.pick(arr)   rng.shuffle(arr)
// Use Math.random() only for things that never have to match between clients (particles, host-only AI).

export function mulberry32(a) {
  a >>>= 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function createRng(seed) {
  const r = mulberry32(typeof seed === 'string' ? hashString(seed) : seed >>> 0);
  const rng = () => r();
  rng.range = (a, b) => a + r() * (b - a);
  rng.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  rng.pick = (arr) => arr[Math.floor(r() * arr.length)];
  rng.chance = (p) => r() < p;
  rng.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  rng.fork = (salt = 0) => createRng((Math.floor(r() * 4294967296) ^ salt) >>> 0);
  return rng;
}

export const randomSeed = () => (Math.random() * 4294967296) >>> 0;
