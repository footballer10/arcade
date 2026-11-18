// Arena geometry, shared by physics (host + client prediction) and rendering.
// The playable space is a rounded box (curved floor→wall→ceiling transitions you can drive along) united with
// two goal boxes carved into the end walls. Everything collides against one analytic signed distance field:
//   f(p) < 0 inside the free space, f(p) = 0 on the surface, and the gradient points into the solid.
// Blue (team 0) defends the -z goal and attacks +z; Orange (team 1) the opposite.

// Arena layouts (host option `arena`). Units: the car is ~3.1 long, the ball radius is 2.4.
export const ARENAS = {
  stadium: { key: 'stadium', name: 'Sunset Stadium', L: 56, W: 40, H: 34, r: 10, GW: 12, GH: 10, GD: 8, mood: 'sunset' },
  pocket: { key: 'pocket', name: 'Pocket Park', L: 42, W: 30, H: 26, r: 9, GW: 10, GH: 9, GD: 7, mood: 'night' },
};

export function makeArena(key) {
  const A = { ...(ARENAS[key] || ARENAS.stadium) };
  A.cy = A.H / 2;
  A.bx = A.W - A.r; A.by = A.H / 2 - A.r; A.bz = A.L - A.r;
  // goal box: from where the curve starts (z = L - r) to the back of the net (z = L + GD)
  A.gz0 = A.L - A.r; A.gz1 = A.L + A.GD;
  A.gcz = (A.gz0 + A.gz1) / 2; A.ghz = (A.gz1 - A.gz0) / 2;
  // boost pads in normalised coords (u = x / W, v = z / L), mirrored across both axes
  const big = [[0.78, 0.8], [0.9, 0]];
  const small = [[0, 0.86], [0.34, 0.8], [0.6, 0.58], [0.22, 0.56], [0, 0.38], [0.46, 0.3], [0.2, 0.14], [0.62, 0.02]];
  A.pads = [];
  const add = (u, v, isBig) => {
    for (const sx of u ? [1, -1] : [1]) for (const sz of v ? [1, -1] : [1]) A.pads.push({ x: u * sx * A.W, z: v * sz * A.L, big: isBig });
  };
  for (const [u, v] of big) add(u, v, true);
  for (const [u, v] of small) add(u, v, false);
  // kickoff spots for team 0 (team 1 is mirrored through the centre): diagonals, off-centre, far back
  const s = A.L / 56;
  A.kick = [[-22 * s, -30 * s], [22 * s, -30 * s], [-3 * s, -42 * s], [3 * s, -42 * s], [0, -50 * s]];
  A.respawn = [[-14 * s, -(A.L - 8)], [14 * s, -(A.L - 8)], [-26 * s, -(A.L - 12)], [26 * s, -(A.L - 12)]];
  return A;
}

// Rounded-box part only (also used by the goal shader to hide phantom faces). Returns the distance; writes the
// gradient (pointing into the solid) to g if given.
export function sdRoom(A, x, y, z, g) {
  const sx = x < 0 ? -1 : 1, sy = y < A.cy ? -1 : 1, sz = z < 0 ? -1 : 1;
  const qx = Math.abs(x) - A.bx, qy = Math.abs(y - A.cy) - A.by, qz = Math.abs(z) - A.bz;
  const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
  const ol = Math.sqrt(mx * mx + my * my + mz * mz);
  if (ol > 1e-9) {
    if (g) { g[0] = (mx / ol) * sx; g[1] = (my / ol) * sy; g[2] = (mz / ol) * sz; }
    return ol - A.r;
  }
  // deep inside the inner box: nearest face
  if (g) {
    if (qx >= qy && qx >= qz) { g[0] = sx; g[1] = 0; g[2] = 0; } else if (qy >= qz) { g[0] = 0; g[1] = sy; g[2] = 0; } else { g[0] = 0; g[1] = 0; g[2] = sz; }
  }
  return Math.max(qx, qy, qz) - A.r;
}

function sdGoal(A, x, y, z, g) {
  const sz = z < 0 ? -1 : 1, sx = x < 0 ? -1 : 1, sy = y < A.GH / 2 ? -1 : 1;
  const qx = Math.abs(x) - A.GW, qy = Math.abs(y - A.GH / 2) - A.GH / 2;
  const lz = Math.abs(z) - A.gcz, szz = lz < 0 ? -1 : 1, qz = Math.abs(lz) - A.ghz;
  const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
  const ol = Math.sqrt(mx * mx + my * my + mz * mz);
  if (ol > 1e-9) {
    if (g) { g[0] = (mx / ol) * sx; g[1] = (my / ol) * sy; g[2] = (mz / ol) * szz * sz; }
    return ol;
  }
  if (g) {
    if (qx >= qy && qx >= qz) { g[0] = sx; g[1] = 0; g[2] = 0; } else if (qy >= qz) { g[0] = 0; g[1] = sy; g[2] = 0; } else { g[0] = 0; g[1] = 0; g[2] = szz * sz; }
  }
  return Math.max(qx, qy, qz);
}

// Full arena field. g receives the gradient (unit, into the solid).
const gTmp = [0, 0, 0];
export function sdArena(A, x, y, z, g) {
  const d1 = sdRoom(A, x, y, z, g);
  if (Math.abs(z) < A.gz0 - 3) return d1;
  const d2 = sdGoal(A, x, y, z, gTmp);
  if (d2 < d1) { if (g) { g[0] = gTmp[0]; g[1] = gTmp[1]; g[2] = gTmp[2]; } return d2; }
  return d1;
}

// GLSL versions for the arena shader (hide the room surface inside the goal mouth, and phantom goal faces).
export function glslArena(A) {
  const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  return `
float sdRoomG(vec3 p){
  vec3 q = abs(p - vec3(0.0, ${f(A.cy)}, 0.0)) - vec3(${f(A.bx)}, ${f(A.by)}, ${f(A.bz)});
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - ${f(A.r)};
}
bool inGoalCarve(vec3 p){ return abs(p.x) < ${f(A.GW)} && p.y < ${f(A.GH)} && abs(p.z) > ${f(A.gz0)}; }
`;
}
