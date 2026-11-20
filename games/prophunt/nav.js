// Grid pathfinding for bots. The level's solids (walls, furniture) are rasterized once per level into a grid of 0.4 m
// cells, grown by the body radius, so a bot can plan a route AROUND tables, shelves and counters instead of walking
// into them. A* with 8 neighbours, then string-pulled so the route has few corners.
const CS = 0.4, BODY = 0.4;   // a little more than a bean's radius: the body collides as a square, so corners need room

export function navFor(L) {
  if (L._nav) return L._nav;
  const nx = Math.ceil(L.w / CS), nz = Math.ceil(L.d / CS), blocked = new Uint8Array(nx * nz);
  const cx = (i) => L.ox + (i + 0.5) * CS, cz = (j) => L.oz + (j + 0.5) * CS;
  for (const s of L.solids) {
    if (!(s.y0 < 1.0 && s.y1 > 0.3)) continue;          // low things we can step over / high things we pass under don't block
    const i0 = Math.max(0, Math.ceil((s.x0 - BODY - L.ox) / CS - 0.5)), i1 = Math.min(nx - 1, Math.floor((s.x1 + BODY - L.ox) / CS - 0.5));
    const j0 = Math.max(0, Math.ceil((s.z0 - BODY - L.oz) / CS - 0.5)), j1 = Math.min(nz - 1, Math.floor((s.z1 + BODY - L.oz) / CS - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * nx + i] = 1;
  }
  // label connected free regions; bots only ever route inside the biggest one (small sealed gaps between furniture are ignored)
  const label = new Int32Array(nx * nz).fill(-1), sizes = [];
  for (let c0 = 0; c0 < nx * nz; c0++) {
    if (blocked[c0] || label[c0] !== -1) continue;
    const id = sizes.length; let n = 0; const stack = [c0]; label[c0] = id;
    while (stack.length) { const c = stack.pop(); n++; const ci = c % nx, cj = (c / nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = ci + di, b = cj + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue; const ni = b * nx + a; if (!blocked[ni] && label[ni] === -1) { label[ni] = id; stack.push(ni); } } }
    sizes.push(n);
  }
  let main = 0; for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
  return (L._nav = { nx, nz, blocked, label, main, cx, cz });
}

const cellOf = (N, L, x, z) => [Math.max(0, Math.min(N.nx - 1, Math.floor((x - L.ox) / CS))), Math.max(0, Math.min(N.nz - 1, Math.floor((z - L.oz) / CS)))];
// nearest free cell to (i, j), searching outward
function snapFree(N, i, j) {
  if (!N.blocked[j * N.nx + i] && N.label[j * N.nx + i] === N.main) return [i, j];
  for (let r = 1; r <= 14; r++) {
    let best = null, bd = 1e9;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N.nx || b >= N.nz || N.blocked[b * N.nx + a] || N.label[b * N.nx + a] !== N.main) continue;
      const d = di * di + dj * dj; if (d < bd) { bd = d; best = [a, b]; }
    }
    if (best) return best;
  }
  return null;
}
function lineClear(N, L, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 0.2));
  for (let k = 1; k <= n; k++) { const t = k / n, [i, j] = cellOf(N, L, ax + (bx - ax) * t, az + (bz - az) * t); if (N.blocked[j * N.nx + i]) return false; }
  return true;
}

// tiny binary min-heap of [f, idx]
class Heap {
  constructor() { this.a = []; }
  push(f, v) { const a = this.a; a.push([f, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = i * 2 + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

// Route from (sx, sz) to (tx, tz): array of [x, z] waypoints (the last one is the target, or the closest free spot to it).
// Returns null when there is no route.
export function findPath(L, sx, sz, tx, tz) {
  const N = navFor(L), { nx, nz, blocked } = N;
  const s0 = cellOf(N, L, sx, sz), t0 = cellOf(N, L, tx, tz);
  const s = snapFree(N, s0[0], s0[1]), t = snapFree(N, t0[0], t0[1]);
  if (!s || !t) return null;
  const goalIdx = t[1] * nx + t[0], startIdx = s[1] * nx + s[0];
  const g = new Float32Array(nx * nz).fill(1e9), from = new Int32Array(nx * nz).fill(-1), closed = new Uint8Array(nx * nz);
  const h = (i, j) => { const dx = Math.abs(i - t[0]), dz = Math.abs(j - t[1]); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
  const heap = new Heap(); g[startIdx] = 0; heap.push(h(s[0], s[1]), startIdx);
  let found = false, iters = 0;
  while (heap.size && iters++ < 40000) {
    const [, cur] = heap.pop(); if (closed[cur]) continue; closed[cur] = 1;
    if (cur === goalIdx) { found = true; break; }
    const ci = cur % nx, cj = (cur / nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = ci + di, b = cj + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const ni = b * nx + a; if (blocked[ni] || closed[ni]) continue;
      if (di && dj && (blocked[cj * nx + a] || blocked[b * nx + ci])) continue;      // no cutting corners
      const ng = g[cur] + (di && dj ? Math.SQRT2 : 1);
      if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; heap.push(ng + h(a, b), ni); }
    }
  }
  if (!found) return null;
  const cells = []; for (let c = goalIdx; c !== -1; c = from[c]) cells.push(c); cells.reverse();
  const pts = cells.map((c) => [N.cx(c % nx), N.cz((c / nx) | 0)]);
  // the real target if its own cell was free, otherwise the closest free cell
  if (!blocked[t0[1] * nx + t0[0]] && N.label[t0[1] * nx + t0[0]] === N.main) pts[pts.length - 1] = [tx, tz];
  // string pulling: skip waypoints we can walk straight past
  const out = []; let a = [sx, sz], k = 0;
  while (k < pts.length) {
    let far = k;
    for (let m = pts.length - 1; m > k; m--) if (lineClear(N, L, a[0], a[1], pts[m][0], pts[m][1])) { far = m; break; }
    out.push(pts[far]); a = pts[far]; k = far + 1;
  }
  return out;
}
