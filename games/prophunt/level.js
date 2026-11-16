// Seeded level generation for Prop Hunt + the shared world rules every client runs: AABB collisions, ray casts
// and a room-graph navigator for bots.
//
// A map is a grid of square rooms (CELL m). Each room gets a template (furniture against the walls, clear
// middle so the doorways in the middle of every wall stay walkable), turned by a seeded quarter turn.
// Furniture registers solids (axis-aligned boxes with a bottom and a top, so small props can stand on tables,
// counters and shelf boards) and SLOTS: the spots where an object naturally belongs ("counter", "bed", "shelf"…).
// About half the slots get a decoy object; the empty ones are the perfect hiding spots.
import { Batch, KINDS, KIND_INDEX } from './props.js';

export const CELL = 10, WT = 0.3, WH = 2.8, H = CELL / 2 - WT / 2, DOOR = 1.9;
const Q = Math.PI / 2;

// ---------------------------------------------------------------------------------------------- furniture
// Each builder draws into the batch (already placed with b.at) in local coords (front = +z, back at -d/2) and
// returns { w, d, solids: [[x0,y0,z0,x1,y1,z1]], slots: [[x,y,z,cats,ry,free]] } in local coords.
const WOOD = 0xc98f55, WOOD_D = 0x9a6436, CREAM = 0xfff3dc, INK = 0x2a2140;
const FURN = {
  counter(b, o) {
    const L = o.len || 2.4, top = 0.92, col = o.col || 0x8fd6c0;
    b.box(0, 0.45, 0, L, 0.86, 0.6, col); b.box(0, 0.9, 0, L + 0.04, 0.05, 0.64, o.top || 0xf2ede4);
    b.box(0, 0.05, 0.03, L - 0.05, 0.1, 0.56, 0x5a4a6a, { out: false });
    for (let x = -L / 2 + 0.3; x < L / 2 - 0.1; x += 0.6) { b.box(x, 0.55, 0.305, 0.5, 0.02, 0.01, 0x6aa894, { out: false }); b.box(x, 0.66, 0.31, 0.14, 0.03, 0.02, CREAM, { out: false }); }
    b.box(0, 1.95, -0.12, L, 0.6, 0.36, col, { shade: 1.06 });
    const skip = [];
    if (o.sink) { b.box(-0.3, 0.9, 0.02, 0.6, 0.06, 0.42, 0x9aa8bb, { out: false }); b.cyl(-0.3, 1.05, -0.22, 0.02, 0.02, 0.3, 0xc8d0dc); b.cyl(-0.3, 1.18, -0.1, 0.018, 0.018, 0.25, 0xc8d0dc, { rx: Q }); skip.push(-0.3); }
    if (o.stove) { for (const [x, z] of [[0.15, -0.13], [0.45, -0.13], [0.15, 0.13], [0.45, 0.13]]) b.cyl(x, 0.93, z, 0.1, 0.1, 0.02, 0x2a2a35, { out: false }); b.box(0.3, 0.5, 0.31, 0.56, 0.5, 0.02, 0x2a2a35, { out: false }); skip.push(0.15, 0.45); }
    const slots = [];
    for (let x = -L / 2 + 0.35; x < L / 2 - 0.2; x += 0.55) if (!skip.some((s) => Math.abs(s - x) < 0.35)) slots.push([x, top, 0.04, ['counter'], 0, false]);
    return { w: L, d: 0.64, solids: [[-L / 2, 0, -0.32, L / 2, top, 0.32]], slots };
  },
  fridge(b) {
    b.box(0, 0.92, 0, 0.8, 1.84, 0.7, 0xeaf6ff); b.box(0, 1.3, 0.352, 0.78, 0.015, 0.01, 0x9ab0c8, { out: false });
    for (const y of [1.0, 1.55]) b.box(0.3, y, 0.37, 0.04, 0.3, 0.04, 0x9ab0c8);
    for (const [x, y, c] of [[-0.15, 1.5, 0xff5a5f], [0.0, 1.6, 0xffcc00], [-0.2, 1.1, 0x3ea6ff]]) b.box(x, y, 0.358, 0.08, 0.08, 0.01, c, { out: false });
    return { w: 0.8, d: 0.7, solids: [[-0.4, 0, -0.35, 0.4, 1.84, 0.35]], slots: [] };
  },
  table(b, o) {
    const w = o.w || 1.6, d = o.d || 0.9, h = o.h || 0.76, col = o.col || WOOD;
    b.box(0, h - 0.03, 0, w, 0.06, d, col);
    const lx = w / 2 - 0.08, lz = d / 2 - 0.08;
    for (const [x, z] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) b.box(x, (h - 0.06) / 2, z, 0.07, h - 0.06, 0.07, WOOD_D);
    const solids = [[-w / 2, h - 0.06, -d / 2, w / 2, h, d / 2]];
    for (const [x, z] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) solids.push([x - 0.04, 0, z - 0.04, x + 0.04, h - 0.06, z + 0.04]);
    const slots = [];
    const n = Math.max(1, Math.round(w / 0.55)); for (let i = 0; i < n; i++) slots.push([(i - (n - 1) / 2) * (w / n), h, 0, o.cats || ['table'], 0, true]);
    if (o.chairs) for (const s of [-1, 1]) for (let i = 0; i < Math.max(1, Math.floor(w / 0.75)); i++) { const cx = (i - (Math.max(1, Math.floor(w / 0.75)) - 1) / 2) * 0.75; slots.push([cx, 0, s * (d / 2 + 0.25), ['chair'], s > 0 ? Math.PI : 0, false]); }
    return { w, d, solids, slots };
  },
  sofa(b, o) {
    const w = o.w || 2.1, col = o.col || 0x6f8cff;
    b.box(0, 0.22, 0.04, w, 0.44, 0.84, col); b.box(0, 0.62, -0.32, w, 0.8, 0.22, col, { shade: 0.92 });
    for (const s of [-1, 1]) b.box(s * (w / 2 - 0.11), 0.36, 0.04, 0.22, 0.72, 0.9, col, { shade: 0.85 });
    for (const s of [-1, 1]) b.box(s * (w / 4 - 0.05), 0.48, 0.07, w / 2 - 0.26, 0.1, 0.66, col, { shade: 1.1 });
    return { w, d: 0.9, solids: [[-w / 2, 0, -0.43, w / 2, 0.53, 0.46], [-w / 2, 0, -0.43, w / 2, 1.02, -0.21], [-w / 2, 0, -0.43, -w / 2 + 0.22, 0.72, 0.46], [w / 2 - 0.22, 0, -0.43, w / 2, 0.72, 0.46]],
      slots: [[-w / 4 + 0.05, 0.53, 0.05, ['sofa'], 0, true], [w / 4 - 0.05, 0.53, 0.05, ['sofa'], 0, true]] };
  },
  tvstand(b, o) {
    const w = o.w || 1.6;
    b.box(0, 0.25, 0, w, 0.5, 0.45, WOOD_D); b.box(0, 0.25, 0.226, w - 0.1, 0.36, 0.01, WOOD, { out: false });
    b.box(0, 0.88, -0.08, 1.1, 0.66, 0.08, 0x1d1a2a); b.box(0, 0.88, -0.035, 1.0, 0.56, 0.01, 0x3d6dd8, { out: false }); b.box(0, 0.53, -0.08, 0.3, 0.06, 0.2, 0x1d1a2a);
    return { w, d: 0.45, solids: [[-w / 2, 0, -0.23, w / 2, 0.5, 0.23], [-0.55, 0.5, -0.13, 0.55, 1.22, -0.03]], slots: [[-w / 2 + 0.22, 0.5, 0.06, ['table'], 0, true], [w / 2 - 0.22, 0.5, 0.06, ['table'], 0, true]] };
  },
  bookshelf(b, o) {
    const w = o.w || 1.0, h = 1.9, d = 0.36, col = o.col || WOOD, cats = o.cats || ['shelf'];
    b.box(0, h / 2, -d / 2 + 0.015, w, h, 0.03, col, { shade: 0.8 });
    for (const s of [-1, 1]) b.box(s * (w / 2 - 0.02), h / 2, 0, 0.04, h, d, col);
    b.box(0, 0.05, 0, w, 0.1, d, col); b.box(0, h - 0.02, 0, w, 0.04, d, col);
    const boards = [0.6, 1.15]; for (const y of boards) b.box(0, y, 0, w - 0.06, 0.04, d - 0.02, col);
    // books fill the right half of each level (decor); objects go on the left/right free spots
    const BK = [0xff5a5f, 0x3ea6ff, 0x4cd964, 0xffcc00, 0xb57bff, 0xff8c42];
    for (const [i, y] of [0.1, 0.62, 1.17].entries()) for (let k = 0; k < 5; k++) b.box(0.08 + k * 0.07, y + 0.13 + (k % 2) * 0.02, -0.02, 0.06, 0.26 + (k % 2) * 0.04, 0.26, BK[(k + i * 2) % 6], { out: false });
    const solids = [[-w / 2, 0, -d / 2, w / 2, h, -d / 2 + 0.03], [-w / 2, 0, -d / 2, -w / 2 + 0.04, h, d / 2], [w / 2 - 0.04, 0, -d / 2, w / 2, h, d / 2], [-w / 2, 0, -d / 2, w / 2, 0.1, d / 2], [-w / 2, h - 0.04, -d / 2, w / 2, h, d / 2]];
    for (const y of boards) solids.push([-w / 2, y - 0.02, -d / 2, w / 2, y + 0.02, d / 2]);
    const slots = [[-w / 4, 0.1, 0.02, cats, 0, false], [-w / 4, 0.62, 0.02, cats, 0, false], [-w / 4, 1.17, 0.02, cats, 0, false], [0, h, 0, cats, 0, false]];
    return { w, d, solids, slots };
  },
  fireplace(b) {
    b.box(0, 0.6, 0, 1.6, 1.2, 0.5, 0xc8644a); b.box(0, 1.22, 0.03, 1.8, 0.08, 0.6, 0xf2ede4);
    b.box(0, 0.38, 0.2, 0.8, 0.62, 0.12, 0x2a1a18, { out: false });
    b.sph(0, 0.2, 0.22, 0.22, 0xffa63a, { sy: 0.9, sz: 0.4, out: false }); b.sph(0, 0.18, 0.24, 0.13, 0xfff07a, { sz: 0.4, out: false });
    for (const x of [-0.18, 0.18]) b.cyl(x, 0.12, 0.2, 0.05, 0.05, 0.4, 0x6b3b1f, { rz: Q, out: false });
    return { w: 1.8, d: 0.6, solids: [[-0.8, 0, -0.25, 0.8, 1.2, 0.25], [-0.9, 1.18, -0.3, 0.9, 1.26, 0.3]], slots: [[-0.55, 1.26, 0.05, ['shelf'], 0, false], [0.55, 1.26, 0.05, ['shelf'], 0, false]], glow: [0, 0.3, 0.3] };
  },
  bed(b, o) {
    const w = o.w || 1.5, l = o.l || 2.1, col = o.col || 0xff9ab8;
    b.box(0, 0.15, 0, w, 0.3, l, WOOD); b.box(0, 0.42, 0.04, w - 0.08, 0.24, l - 0.12, CREAM);
    b.box(0, 0.55, 0.3, w - 0.02, 0.04, l * 0.62, col); b.box(0, 0.5, -l / 2 + 0.05, w + 0.08, 1.0, 0.1, WOOD_D);
    return { w, d: l, solids: [[-w / 2, 0, -l / 2, w / 2, 0.55, l / 2], [-w / 2 - 0.04, 0, -l / 2, w / 2 + 0.04, 1.0, -l / 2 + 0.1]],
      slots: [[-w / 4, 0.55, -l / 2 + 0.38, ['bed'], 0, false], [w / 4, 0.55, -l / 2 + 0.38, ['bed'], 0, false], [0, 0.57, 0.45, ['bed'], 0, true]] };
  },
  nightstand(b) {
    b.box(0, 0.27, 0, 0.5, 0.54, 0.44, WOOD); b.box(0, 0.36, 0.222, 0.4, 0.14, 0.01, WOOD_D, { out: false }); b.box(0, 0.36, 0.23, 0.08, 0.03, 0.02, CREAM, { out: false });
    return { w: 0.5, d: 0.44, solids: [[-0.25, 0, -0.22, 0.25, 0.54, 0.22]], slots: [[0, 0.54, 0.02, ['night', 'table'], 0, true]] };
  },
  dresser(b, o) {
    const col = o.col || 0xf6c78a;
    b.box(0, 0.45, 0, 1.2, 0.9, 0.5, col); for (const y of [0.22, 0.48, 0.74]) { b.box(0, y, 0.252, 1.1, 0.2, 0.01, col, { shade: 0.9, out: false }); b.box(0, y, 0.26, 0.2, 0.03, 0.02, INK, { out: false }); }
    return { w: 1.2, d: 0.5, solids: [[-0.6, 0, -0.25, 0.6, 0.9, 0.25]], slots: [[-0.33, 0.9, 0.02, ['table'], 0, true], [0.33, 0.9, 0.02, ['table'], 0, true]] };
  },
  desk(b, o) {
    const w = o.w || 1.3, col = o.col || 0xe9b97a;
    b.box(0, 0.73, 0, w, 0.06, 0.65, col); b.box(-w / 2 + 0.22, 0.35, 0, 0.42, 0.7, 0.6, col, { shade: 0.88 }); b.box(w / 2 - 0.03, 0.35, 0, 0.05, 0.7, 0.6, col, { shade: 0.88 });
    return { w, d: 0.65, solids: [[-w / 2, 0.7, -0.33, w / 2, 0.76, 0.33], [-w / 2, 0, -0.3, -w / 2 + 0.43, 0.7, 0.3], [w / 2 - 0.06, 0, -0.3, w / 2, 0.7, 0.3]],
      slots: [[-w / 2 + 0.3, 0.76, 0, ['desk', 'table'], 0, true], [w / 2 - 0.3, 0.76, 0, ['desk', 'table'], 0, true], [0.1, 0, 0.6, ['chair'], Math.PI, false]] };
  },
  tub(b) {
    const c = 0xf4f8ff;
    b.box(0, 0.08, 0, 1.7, 0.16, 0.8, c); for (const s of [-1, 1]) { b.box(0, 0.32, s * 0.36, 1.7, 0.64, 0.08, c); b.box(s * 0.81, 0.32, 0, 0.08, 0.64, 0.8, c); }
    b.box(0, 0.36, 0, 1.54, 0.04, 0.64, 0x8fe0ff, { out: false }); b.cyl(0.75, 0.75, -0.3, 0.02, 0.02, 0.25, 0xc8d0dc);
    return { w: 1.7, d: 0.8, solids: [[-0.85, 0, -0.4, 0.85, 0.16, 0.4], [-0.85, 0, -0.4, 0.85, 0.64, -0.32], [-0.85, 0, 0.32, 0.85, 0.64, 0.4], [-0.85, 0, -0.4, -0.77, 0.64, 0.4], [0.77, 0, -0.4, 0.85, 0.64, 0.4]],
      slots: [[-0.4, 0.16, 0, ['bath'], 0, true], [0.3, 0.16, 0, ['bath'], 0, true], [-0.6, 0.64, -0.36, ['bath'], 0, true]] };
  },
  toilet(b) {
    const c = 0xf4f8ff;
    b.box(0, 0.6, -0.27, 0.42, 0.42, 0.18, c); b.cyl(0, 0.2, 0.05, 0.16, 0.12, 0.4, c); b.cyl(0, 0.42, 0.07, 0.2, 0.2, 0.05, c, { sz: 1.2 });
    return { w: 0.45, d: 0.7, solids: [[-0.21, 0, -0.35, 0.21, 0.81, -0.18], [-0.2, 0, -0.18, 0.2, 0.44, 0.3]], slots: [[0, 0.81, -0.27, ['bath'], 0, true]] };
  },
  basin(b) {
    b.box(0, 0.42, 0, 0.6, 0.84, 0.45, 0xb9e6d8); b.box(0, 0.86, 0.02, 0.62, 0.05, 0.47, 0xf4f8ff); b.box(0, 1.5, -0.21, 0.5, 0.6, 0.03, 0xbfe9ff);
    return { w: 0.6, d: 0.45, solids: [[-0.3, 0, -0.23, 0.3, 0.88, 0.23]], slots: [[0.15, 0.88, 0.05, ['bath'], 0, true]] };
  },
  washer(b) {
    b.box(0, 0.45, 0, 0.64, 0.9, 0.64, 0xf4f8ff); b.cyl(0, 0.45, 0.32, 0.2, 0.2, 0.03, 0x8fb8ff, { rx: Q, seg: 20 }); b.box(0, 0.82, 0.322, 0.5, 0.08, 0.01, 0x9aa8bb, { out: false });
    return { w: 0.64, d: 0.64, solids: [[-0.32, 0, -0.32, 0.32, 0.9, 0.32]], slots: [[0, 0.9, 0, ['bath'], 0, true]] };
  },
  workbench(b) {
    b.box(0, 0.88, 0, 1.8, 0.06, 0.62, WOOD); for (const [x, z] of [[-0.82, -0.25], [0.82, -0.25], [-0.82, 0.25], [0.82, 0.25]]) b.box(x, 0.43, z, 0.08, 0.86, 0.08, 0x6a6a7a);
    b.box(0, 0.25, 0, 1.7, 0.04, 0.55, WOOD_D); b.box(0, 1.6, -0.3, 1.8, 1.0, 0.03, 0xd8c08a);
    for (const [x, y] of [[-0.5, 1.6], [0, 1.75], [0.5, 1.5]]) b.box(x, y, -0.27, 0.06, 0.35, 0.03, 0x5a5a6a, { out: false });
    return { w: 1.8, d: 0.62, solids: [[-0.9, 0.85, -0.31, 0.9, 0.91, 0.31], [-0.9, 0.23, -0.3, 0.9, 0.27, 0.3], [-0.9, 0, -0.3, -0.75, 0.85, 0.3], [0.75, 0, -0.3, 0.9, 0.85, 0.3]],
      slots: [[-0.5, 0.91, 0.02, ['table', 'storage'], 0, true], [0.4, 0.91, 0.02, ['table', 'storage'], 0, true], [0, 0.27, 0, ['storage'], 0, true]] };
  },
  rack(b, o) { return FURN.bookshelf(b, { w: o.w || 1.4, col: 0x8a94a8, cats: ['storage', 'shelf'] }); },
  rug(b, o) { b.box(0, 0.01, 0, o.w, 0.02, o.d, o.col || 0xff8a7a, { out: false }); b.box(0, 0.012, 0, o.w - 0.3, 0.02, o.d - 0.3, o.col2 || 0xffd08a, { out: false }); return { w: o.w, d: o.d, solids: [], slots: [] }; },
};

// ---------------------------------------------------------------------------------------------- rooms
// ['w', type, side, along, opts]: against a wall. side 0 = north (z=-H, facing +z), 1 = east, 2 = south, 3 = west.
// ['f', type, x, z, quarterTurns, opts]: free placement.  ['s', x, z, cats, free]: a floor slot.
const ROOMS = {
  living: { name: 'Living Room', wall: 0xffe2b8, floor: 0xd9a066, items: [
    ['w', 'sofa', 0, -2.8, {}], ['f', 'table', -2.8, -2.75, 0, { w: 1.1, d: 0.6, h: 0.42, col: WOOD_D }], ['f', 'rug', -2.8, -3.0, 0, { w: 3.0, d: 2.4 }],
    ['w', 'fireplace', 2, 2.9], ['w', 'tvstand', 1, -3.0, {}], ['w', 'bookshelf', 3, 2.6], ['w', 'bookshelf', 3, 3.75],
    ['s', 4.2, -4.2, ['floor', 'lamp'], true], ['s', -4.3, 4.3, ['floor', 'lamp'], true], ['s', -1.0, -4.3, ['floor'], true], ['s', 4.3, 3.8, ['floor'], true], ['s', -4.3, 1.8, ['floor'], true],
  ] },
  kitchen: { name: 'Kitchen', wall: 0xd8f3e6, floor: 0xf2e6d2, items: [
    ['w', 'counter', 0, -3.0, { len: 3.4, sink: true }], ['w', 'counter', 0, 3.0, { len: 3.4, stove: true }], ['w', 'fridge', 1, -4.0], ['w', 'counter', 1, 3.0, { len: 3.0 }],
    ['f', 'table', -2.6, 2.6, 0, { w: 1.4, d: 0.9, chairs: true }], ['s', -4.3, -1.5, ['floor'], true], ['s', 4.3, 4.3, ['floor'], true], ['s', -1.5, 4.3, ['floor'], true],
  ] },
  dining: { name: 'Dining Room', wall: 0xf7d6e6, floor: 0xc98f55, items: [
    ['f', 'rug', 2.6, -2.6, 0, { w: 3.4, d: 2.6, col: 0xb57bff, col2: 0xe0c4ff }], ['f', 'table', 2.6, -2.6, 0, { w: 2.2, d: 1.0, chairs: true }],
    ['w', 'dresser', 2, -3.0, {}], ['w', 'dresser', 3, 3.0, { col: 0xb8e0ff }], ['w', 'bookshelf', 0, -3.6], ['s', -4.3, -4.3, ['floor', 'lamp'], true], ['s', 4.3, 4.3, ['floor'], true], ['s', -4.3, 4.3, ['floor'], true],
  ] },
  bedroom: { name: 'Bedroom', wall: 0xd6dcff, floor: 0xc98f55, items: [
    ['w', 'bed', 0, -2.7, {}], ['w', 'nightstand', 0, -1.45], ['w', 'nightstand', 0, -4.1], ['w', 'dresser', 1, 3.0, {}], ['w', 'desk', 2, -3.0, {}],
    ['f', 'rug', -2.7, -0.9, 0, { w: 2.2, d: 1.4, col: 0x6fc3ff, col2: 0xc8ecff }], ['s', 4.3, -4.3, ['floor', 'lamp'], true], ['s', -4.3, 2.0, ['floor'], true], ['s', 2.2, -4.3, ['floor'], true], ['s', 4.3, 4.3, ['floor'], true],
  ] },
  bath: { name: 'Bathroom', wall: 0xc8f0ff, floor: 0xeaf3f8, items: [
    ['w', 'tub', 0, -3.0], ['w', 'toilet', 1, -3.9], ['w', 'basin', 3, 3.2], ['w', 'washer', 2, -3.6], ['w', 'washer', 2, -2.85],
    ['f', 'rug', -1.6, 2.6, 0, { w: 1.6, d: 1.0, col: 0x7ed957, col2: 0xc8f5b0 }], ['s', 4.3, 4.3, ['floor', 'bath'], true], ['s', -4.3, -1.6, ['floor'], true], ['s', 3.0, -4.3, ['floor', 'bath'], true],
  ] },
  kids: { name: 'Kids Room', wall: 0xfff0a0, floor: 0xf2b8c8, items: [
    ['w', 'bed', 3, -2.8, { w: 1.2, l: 1.9, col: 0x7ed957 }], ['w', 'bookshelf', 0, 2.8, { col: 0xff8ab0 }], ['w', 'desk', 1, 3.0, { w: 1.1, col: 0x8fd6ff }], ['w', 'nightstand', 3, -1.5],
    ['f', 'rug', 1.8, -1.8, 0, { w: 2.4, d: 2.4, col: 0xffcc00, col2: 0xff8c42 }], ['s', 1.4, -1.4, ['toy'], true], ['s', 2.4, -2.2, ['toy'], true], ['s', 4.3, -4.3, ['floor', 'toy'], true], ['s', -4.3, 4.3, ['floor'], true], ['s', -1.6, 4.3, ['toy', 'floor'], true],
  ] },
  garage: { name: 'Garage', wall: 0xd8d8e0, floor: 0xa9a9b8, items: [
    ['w', 'workbench', 0, -2.8], ['w', 'rack', 1, -3.0, {}], ['w', 'rack', 1, 3.0, {}], ['w', 'rack', 3, 3.0, {}],
    ['s', -4.2, 2.0, ['storage', 'floor'], true], ['s', -3.4, 4.2, ['storage', 'floor'], true], ['s', 4.2, 4.2, ['storage', 'floor'], true], ['s', 2.0, -4.2, ['storage', 'floor'], true], ['s', -4.2, -1.6, ['storage', 'floor'], true], ['s', -2.4, 4.2, ['storage', 'floor'], true],
  ] },
  office: { name: 'Study', wall: 0xe4f5c8, floor: 0xb07a48, items: [
    ['w', 'desk', 0, 2.8, { col: WOOD }], ['w', 'bookshelf', 1, -3.4], ['w', 'bookshelf', 1, -2.3], ['w', 'bookshelf', 3, 3.4], ['w', 'sofa', 2, 2.8, { w: 1.7, col: 0xff8c42 }],
    ['f', 'rug', -2.2, -2.4, 0, { w: 2.2, d: 2.2, col: 0x3ea6ff, col2: 0xffe2b8 }], ['s', -4.3, -4.3, ['floor', 'lamp'], true], ['s', 4.3, 4.3, ['floor'], true], ['s', -4.3, 1.8, ['floor'], true],
  ] },
};

export const MAPS = {
  house: { name: 'Cozy House', cols: 3, rows: 2, required: ['living', 'kitchen', 'bedroom', 'bath'], extra: ['dining', 'kids', 'garage', 'office'], extraDoors: 2,
    kinds: ['toaster', 'kettle', 'mug', 'microwave', 'fruitbowl', 'plant', 'floorlamp', 'tablelamp', 'books', 'box', 'trash', 'chair', 'teddy', 'clock', 'vase', 'duck', 'laundry', 'pillow'],
    outside: 0xe8a07a, sky: [0xffd7a8, 0x8fd0ff], fill: 0.5 },
};
export const MAP_IDS = Object.keys(MAPS);

// ---------------------------------------------------------------------------------------------- generation
function rot(x, z, a) { const c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, -x * s + z * c]; }
function rotBox(bx, a, ox, oz) {
  const [x0, y0, z0, x1, y1, z1] = bx;
  const p = [rot(x0, z0, a), rot(x1, z1, a)];
  return { x0: Math.min(p[0][0], p[1][0]) + ox, z0: Math.min(p[0][1], p[1][1]) + oz, x1: Math.max(p[0][0], p[1][0]) + ox, z1: Math.max(p[0][1], p[1][1]) + oz, y0, y1 };
}

export function makeLevel(rng, mapId) {
  const M = MAPS[mapId] || MAPS.house;
  const cols = M.cols, rows = M.rows, n = cols * rows;
  const types = [...M.required, ...rng.shuffle([...M.extra])].slice(0, n);
  rng.shuffle(types);
  const ox = -(cols * CELL) / 2, oz = -(rows * CELL) / 2;
  const rooms = types.map((t, i) => { const c = i % cols, r = Math.floor(i / cols); return { i, type: t, def: ROOMS[t], name: ROOMS[t].name, c, r, x: ox + (c + 0.5) * CELL, z: oz + (r + 0.5) * CELL, q: rng.int(0, 3), doors: [] }; });
  // doors: random spanning tree + a few extra loops
  const edges = [];
  for (const rm of rooms) { if (rm.c < cols - 1) edges.push([rm.i, rm.i + 1]); if (rm.r < rows - 1) edges.push([rm.i, rm.i + cols]); }
  rng.shuffle(edges);
  const parent = rooms.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const open = new Set(), extra = [];
  for (const [a, b] of edges) { if (find(a) !== find(b)) { parent[find(a)] = find(b); open.add(a + ',' + b); } else extra.push([a, b]); }
  for (const [a, b] of extra.slice(0, M.extraDoors)) open.add(a + ',' + b);
  const doors = [];
  for (const k of open) {
    const [a, b] = k.split(',').map(Number), A = rooms[a], B = rooms[b];
    const d = { a, b, x: (A.x + B.x) / 2, z: (A.z + B.z) / 2, vertical: A.r === B.r };   // vertical: wall runs along z (rooms side by side in x)
    doors.push(d); A.doors.push(d); B.doors.push(d);
  }
  const solids = [], slots = [], glows = [];
  const geo = new Batch(0.03);
  // floors, ceilings are drawn by the renderer from rooms; walls here
  const wall = (x0, z0, x1, z1, col) => { solids.push({ x0, z0, x1, z1, y0: 0, y1: WH }); geo.at(0, 0, 0).box((x0 + x1) / 2, WH / 2, (z0 + z1) / 2, x1 - x0, WH, z1 - z0, col, { t: 0.02 }); };
  const W2 = WT / 2;
  for (const A of rooms) {
    const hw = CELL / 2;
    // each room draws the inner half of its 4 walls in its own wallpaper color (gaps for doors)
    for (let side = 0; side < 4; side++) {
      const nb = side === 0 ? (A.r > 0 ? A.i - cols : -1) : side === 1 ? (A.c < cols - 1 ? A.i + 1 : -1) : side === 2 ? (A.r < rows - 1 ? A.i + cols : -1) : (A.c > 0 ? A.i - 1 : -1);
      const door = nb >= 0 && A.doors.find((d) => (d.a === nb && d.b === A.i) || (d.b === nb && d.a === A.i));
      const ext = nb < 0;
      const e = ext ? W2 : 0;               // exterior walls also reach outwards (outer face painted separately)
      const segs = door ? [[-hw, -DOOR / 2], [DOOR / 2, hw]] : [[-hw - e, hw + e]];
      for (const [u0, u1] of segs) {
        if (side === 0) wall(A.x + u0, A.z - hw - e, A.x + u1, A.z - hw + W2, A.def.wall);
        if (side === 2) wall(A.x + u0, A.z + hw - W2, A.x + u1, A.z + hw + e, A.def.wall);
        if (side === 3) wall(A.x - hw - e, A.z + u0, A.x - hw + W2, A.z + u1, A.def.wall);
        if (side === 1) wall(A.x + hw - W2, A.z + u0, A.x + hw + e, A.z + u1, A.def.wall);
      }
      if (ext) { // outside paint + roof-line trim
        const L = CELL + WT, o2 = hw + W2 + 0.01;
        if (side === 0) geo.box(A.x, WH / 2, A.z - o2, L, WH, 0.02, M.outside, { out: false });
        if (side === 2) geo.box(A.x, WH / 2, A.z + o2, L, WH, 0.02, M.outside, { out: false });
        if (side === 3) geo.box(A.x - o2, WH / 2, A.z, 0.02, WH, L, M.outside, { out: false });
        if (side === 1) geo.box(A.x + o2, WH / 2, A.z, 0.02, WH, L, M.outside, { out: false });
      }
      if (door) { // door frame trim (white) on this room's side
        const dc = 0xfffaf0;
        if (side === 0 || side === 2) { const zz = side === 0 ? A.z - hw + W2 : A.z + hw - W2; for (const s of [-1, 1]) geo.box(A.x + s * (DOOR / 2 + 0.05), 1.1, zz, 0.1, 2.2, 0.05, dc, { out: false }); geo.box(A.x, 2.25, zz, DOOR + 0.2, 0.1, 0.05, dc, { out: false }); geo.box(A.x, 2.53, zz - (side === 0 ? 0.075 : -0.075), DOOR, 0.55, WT / 2, A.def.wall); }
        else { const xx = side === 3 ? A.x - hw + W2 : A.x + hw - W2; for (const s of [-1, 1]) geo.box(xx, 1.1, A.z + s * (DOOR / 2 + 0.05), 0.05, 2.2, 0.1, dc, { out: false }); geo.box(xx, 2.25, A.z, 0.05, 0.1, DOOR + 0.2, dc, { out: false }); geo.box(xx - (side === 3 ? 0.075 : -0.075), 2.53, A.z, WT / 2, 0.55, DOOR, A.def.wall); }
      }
    }
    // baseboards
    const bb = 0xfffaf0;
    for (const s of [-1, 1]) { geo.box(A.x, 0.06, A.z + s * (hw - W2 - 0.02), CELL - 0.6, 0.12, 0.04, bb, { out: false }); geo.box(A.x + s * (hw - W2 - 0.02), 0.06, A.z, 0.04, 0.12, CELL - 0.6, bb, { out: false }); }
    // furniture + slots
    const a = A.q * Q;
    for (const it of A.def.items) {
      if (it[0] === 's') { const [lx, lz] = rot(it[1], it[2], a); slots.push({ x: A.x + lx, y: 0, z: A.z + lz, cats: it[3], ry: a, free: !!it[4], room: A.i }); continue; }
      let lx, lz, ry, f = FURN[it[1]], o;
      const tmp = new Batch(0.025); // measure: build once to get w/d (cheap: furniture is small)
      if (it[0] === 'w') {
        o = it[4] || {}; const probe = f(tmp, o); const pb = tmp.build(); pb.geo?.dispose(); pb.line?.dispose();
        const side = it[2], along = it[3], d = probe.d;
        if (side === 0) { lx = along; lz = -H + d / 2 + 0.02; ry = 0; }
        if (side === 2) { lx = along; lz = H - d / 2 - 0.02; ry = Math.PI; }
        if (side === 3) { lx = -H + d / 2 + 0.02; lz = along; ry = Q; }
        if (side === 1) { lx = H - d / 2 - 0.02; lz = along; ry = -Q; }
      } else { o = it[5] || {}; lx = it[2]; lz = it[3]; ry = it[4] * Q; }
      const [wx, wz] = rot(lx, lz, a), wr = ry + a;
      geo.at(A.x + wx, 0, A.z + wz, wr);
      const out = f(geo, o);
      for (const s of out.solids) solids.push(rotBox(s, wr, A.x + wx, A.z + wz));
      for (const [sx, sy, sz, cats, sry, free] of out.slots) { const [px, pz] = rot(sx, sz, wr); slots.push({ x: A.x + wx + px, y: sy, z: A.z + wz + pz, cats, ry: wr + sry, free, room: A.i }); }
      if (out.glow) { const [gx, gz] = rot(out.glow[0], out.glow[2], wr); glows.push({ x: A.x + wx + gx, y: out.glow[1], z: A.z + wz + gz }); }
    }
  }
  geo.at(0, 0, 0);
  const built = geo.build();
  // decoys: fill slots with objects that belong there (every kind of the map appears at least once if possible)
  const kinds = M.kinds.map((k) => KIND_INDEX[k]);
  const fits = (s) => kinds.filter((k) => KINDS[k].cats.some((c) => s.cats.includes(c)));
  for (const s of slots) { s.kinds = fits(s); s.reach = s.y <= 1.0; }
  const usable = slots.filter((s) => s.kinds.length);
  const order = rng.shuffle(usable.map((_, i) => i));
  const decoys = [], taken = new Set();
  const place = (si, k) => { const s = usable[si]; taken.add(si); s.decoy = decoys.length; decoys.push({ i: decoys.length, k, x: s.x, y: s.y, z: s.z, ry: s.free ? s.ry + rng.int(0, 7) * (Math.PI / 4) : s.ry, room: s.room }); };
  for (const k of rng.shuffle([...kinds])) { const si = order.find((i) => !taken.has(i) && usable[i].kinds.includes(k)); if (si != null) place(si, k); }
  const target = Math.round(usable.length * M.fill);
  for (const si of order) { if (decoys.length >= target) break; if (!taken.has(si)) place(si, rng.pick(usable[si].kinds)); }
  // which kinds exist (a hider can only copy something that's really in the level)
  const present = [...new Set(decoys.map((d) => d.k))];
  // spawns: seekers start in one room, hiders spread over the others
  const seekRoom = rng.int(0, n - 1);
  const free = rooms.filter((r) => r.i !== seekRoom);
  return {
    mapId: mapId in MAPS ? mapId : 'house', map: M, rooms, doors, solids, slots: usable, decoys, present, glows, cols, rows, seekRoom,
    geo: built, ox, oz, w: cols * CELL, d: rows * CELL,
    seekerSpawn: (i) => { const r = rooms[seekRoom]; const a = i * 2.1; return [r.x + Math.sin(a) * 0.9, r.z + Math.cos(a) * 0.9]; },
    hiderSpawn: (i) => { const r = free[i % free.length]; const a = Math.floor(i / free.length) * 2.4 + 0.5; return [r.x + Math.sin(a) * 0.8, r.z + Math.cos(a) * 0.8]; },
  };
}

export function roomAt(L, x, z) {
  const c = Math.floor((x - L.ox) / CELL), r = Math.floor((z - L.oz) / CELL);
  if (c < 0 || r < 0 || c >= L.cols || r >= L.rows) return -1;
  return r * L.cols + c;
}

// ---------------------------------------------------------------------------------------------- physics
export const PHYS = { G: 22, JUMP: 7.0, STEP: 0.36, ACC: 16, AIR: 5 };
// body: {x,y,z,vx,vy,vz,gr,r,h}. inp: {mx,mz (world, |m|<=1), speed, jump (bool edge)}
export function stepBody(p, inp, dt, L) {
  const tx = inp.mx * inp.speed, tz = inp.mz * inp.speed, k = Math.min(1, dt * (p.gr ? PHYS.ACC : PHYS.AIR));
  p.vx += (tx - p.vx) * k; p.vz += (tz - p.vz) * k;
  if (inp.jump && p.gr) { p.vy = PHYS.JUMP; p.gr = false; }
  p.vy -= PHYS.G * dt;
  const S = L.solids, r = p.r;
  p.x += p.vx * dt; collideAxis(p, S, r, 0);
  p.z += p.vz * dt; collideAxis(p, S, r, 1);
  const py = p.y; p.y += p.vy * dt; let land = 0, wasAir = !p.gr; p.gr = false;
  if (p.vy <= 0) {
    let top = 0;
    for (const s of S) { if (p.x + r <= s.x0 || p.x - r >= s.x1 || p.z + r <= s.z0 || p.z - r >= s.z1) continue; if (s.y1 <= py + 0.06 && s.y1 > top) top = s.y1; }
    if (p.y <= top) { if (wasAir) land = -p.vy; p.y = top; p.vy = 0; p.gr = true; }
  } else {
    for (const s of S) { if (p.x + r <= s.x0 || p.x - r >= s.x1 || p.z + r <= s.z0 || p.z - r >= s.z1) continue; if (s.y0 >= py + p.h - 0.06 && s.y0 < p.y + p.h) { p.y = s.y0 - p.h; p.vy = 0; } }
  }
  // stay inside the building
  const lim = 0.05;
  p.x = Math.max(L.ox + lim + r, Math.min(L.ox + L.w - lim - r, p.x)); p.z = Math.max(L.oz + lim + r, Math.min(L.oz + L.d - lim - r, p.z));
  return land;
}
function collideAxis(p, S, r, axis) {
  for (const s of S) {
    if (p.x + r <= s.x0 || p.x - r >= s.x1 || p.z + r <= s.z0 || p.z - r >= s.z1) continue;
    if (p.y >= s.y1 - 1e-3 || p.y + p.h <= s.y0 + 1e-3) continue;
    if (s.y1 - p.y <= PHYS.STEP && p.gr && s.y1 - s.y0 > 0.02) { p.y = s.y1; continue; }   // step up
    if (axis === 0) { const c = (s.x0 + s.x1) / 2; p.x = p.x < c ? s.x0 - r - 1e-4 : s.x1 + r + 1e-4; p.vx = 0; }
    else { const c = (s.z0 + s.z1) / 2; p.z = p.z < c ? s.z0 - r - 1e-4 : s.z1 + r + 1e-4; p.vz = 0; }
  }
}

// ---------------------------------------------------------------------------------------------- rays
// slab test against {x0,y0,z0,x1,y1,z1}; returns entry distance or Infinity
export function rayBox(o, d, b, max = Infinity) {
  let t0 = 0, t1 = max;
  for (const [oa, da, a0, a1] of [[o[0], d[0], b.x0, b.x1], [o[1], d[1], b.y0, b.y1], [o[2], d[2], b.z0, b.z1]]) {
    if (Math.abs(da) < 1e-9) { if (oa < a0 || oa > a1) return Infinity; continue; }
    let ta = (a0 - oa) / da, tb = (a1 - oa) / da; if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return Infinity;
  }
  return t0;
}
export function rayWorld(L, o, d, max) { let best = max; for (const s of L.solids) { const t = rayBox(o, d, s, best); if (t < best) best = t; } return best; }
// box of an object of kind k at (x,y,z) turned by ry (axis-aligned bound), optionally inflated
export function kindBox(k, x, y, z, ry, pad = 0) {
  const [w, h, d] = KINDS[k].size, c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
  const hx = Math.max(0.15, (w * c + d * s) / 2) + pad, hz = Math.max(0.15, (w * s + d * c) / 2) + pad;
  return { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0: y - pad, y1: y + Math.max(0.25, h) + pad };
}
export const BEAN = { r: 0.34, h: 1.7 };
export function bodySize(kind) { if (kind < 0) return BEAN; const [w, h, d] = KINDS[kind].size; return { r: Math.max(0.1, Math.min(w, d) / 2 * 0.9), h }; }
export function lineOfSight(L, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2]) || 1;
  return rayWorld(L, a, [d[0] / len, d[1] / len, d[2] / len], len) >= len - 0.05;
}

// ---------------------------------------------------------------------------------------------- navigation
// path of [x,z] points from (x,z) to (tx,tz) through room centers and doorways (BFS over the room graph)
export function navPath(L, x, z, tx, tz) {
  const a = roomAt(L, x, z), b = roomAt(L, tx, tz);
  if (a < 0 || b < 0 || a === b) return [[tx, tz]];
  const prev = new Map([[a, null]]), q = [a];
  while (q.length) { const r = q.shift(); if (r === b) break; for (const d of L.rooms[r].doors) { const nb = d.a === r ? d.b : d.a; if (!prev.has(nb)) { prev.set(nb, [r, d]); q.push(nb); } } }
  if (!prev.has(b)) return [[tx, tz]];
  const pts = []; let cur = b;
  while (prev.get(cur)) { const [r, d] = prev.get(cur); const R = L.rooms[cur], P = L.rooms[r];
    pts.unshift([R.x, R.z]);
    // step through the door: a point on each side
    const ux = Math.sign(R.x - P.x) * 0.9, uz = Math.sign(R.z - P.z) * 0.9;
    pts.unshift([d.x + ux, d.z + uz]); pts.unshift([d.x - ux, d.z - uz]);
    cur = r; }
  pts.unshift([L.rooms[a].x, L.rooms[a].z]);
  pts.push([tx, tz]);
  return pts;
}
