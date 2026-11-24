// The shared player character: a chunky cartoon person — skin tone, hairstyle + hair color, a face, a shirt in the
// player's party color, arms, trousers and shoes, plus one hat. Shown in the lobby and podium and used by any game
// where a player body makes sense, so you look like you everywhere.
//   const a = ctx.avatar.build(player)            // THREE.Group, ~1.7 units tall, feet at y=0, faces +z
//   a.userData.setPose({ run: 0..1, t: seconds, jump: 0..1 })   // idle bob / run cycle / jump tuck
//   a.userData.rig                                 // the body group (tilt it for leans, stuns, etc.)
//   scene.add(ctx.avatar.hat(player.hat))          // just the hat (put it on your own character's head)
//   ctx.avatar.dispose(a)                          // frees its own materials (shared geometry is kept)
// player fields used: color (palette index), hat, skin (0-5), hair (style key), hairColor (0-5). Missing fields get
// stable defaults derived from the player id, so older callers keep working.
import * as THREE from 'three';
import { hex } from './palette.js';

export const HATS = ['none', 'cap', 'tophat', 'crown', 'beanie', 'party', 'horns', 'halo', 'propeller', 'wizard', 'viking'];
export const HAT_LABELS = { none: 'No hat', cap: 'Cap', tophat: 'Top hat', crown: 'Crown', beanie: 'Beanie', party: 'Party hat', horns: 'Horns', halo: 'Halo', propeller: 'Propeller', wizard: 'Wizard', viking: 'Viking' };
export const SKINS = [0xffdcc0, 0xf3c39b, 0xe0a678, 0xc68655, 0x9a6440, 0x6b4428];
export const HAIRS = ['short', 'spiky', 'curly', 'long', 'ponytail', 'bun', 'mohawk', 'bald'];
export const HAIR_LABELS = { short: 'Short', spiky: 'Spiky', curly: 'Curly', long: 'Long', ponytail: 'Ponytail', bun: 'Bun', mohawk: 'Mohawk', bald: 'Bald' };
export const HAIR_COLORS = [0x2a1d18, 0x6b3e22, 0xb7742e, 0xf2cf6b, 0xc8452f, 0x4a6cff];

const GRAD = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
GRAD.needsUpdate = true;
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: GRAD, ...extra });
const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 5, 12);
const sph = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
// Shared (never disposed): geometries and fixed-color materials.
const G = {
  head: sph(0.36, 24, 18), torso: cap(0.27, 0.28), hip: sph(0.27, 16, 10), arm: cap(0.085, 0.3), hand: sph(0.1, 12, 8),
  leg: cap(0.105, 0.26), shoe: new THREE.BoxGeometry(0.2, 0.13, 0.32), eye: sph(0.085, 14, 10), pupil: sph(0.05, 12, 8),
  glint: sph(0.018, 6, 4), brow: new THREE.BoxGeometry(0.13, 0.03, 0.03), mouth: new THREE.TorusGeometry(0.075, 0.018, 6, 14, Math.PI),
  nose: sph(0.045, 10, 8), cheek: new THREE.CircleGeometry(0.05, 14), ear: sph(0.07, 10, 8), collar: new THREE.TorusGeometry(0.17, 0.035, 8, 20),
  hairCap: new THREE.SphereGeometry(0.385, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), spike: new THREE.ConeGeometry(0.09, 0.26, 8),
  curl: sph(0.12, 10, 8), hairBack: cap(0.3, 0.22), tail: cap(0.08, 0.26), bun: sph(0.15, 12, 10), mohawk: new THREE.BoxGeometry(0.1, 0.18, 0.62),
  belt: new THREE.CylinderGeometry(0.275, 0.275, 0.07, 18),
  // hats
  visor: new THREE.CylinderGeometry(0.36, 0.36, 0.04, 20, 1, false, -Math.PI / 2, Math.PI),
  dome: new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.52, 0.52, 0.05, 24), tall: new THREE.CylinderGeometry(0.3, 0.32, 0.55, 20),
  band: new THREE.CylinderGeometry(0.33, 0.33, 0.1, 20), crown: new THREE.CylinderGeometry(0.34, 0.3, 0.26, 10, 1, true),
  gem: new THREE.OctahedronGeometry(0.07), pom: new THREE.SphereGeometry(0.11, 10, 8), cone: new THREE.ConeGeometry(0.26, 0.6, 18),
  horn: new THREE.ConeGeometry(0.09, 0.38, 10), halo: new THREE.TorusGeometry(0.3, 0.05, 8, 28),
};
const M = {
  white: toon(0xffffff), ink: new THREE.MeshBasicMaterial({ color: 0x1d1633 }), black: toon(0x22202e), gold: toon(0xffcc33, { emissive: 0x332200 }),
  red: toon(0xe23b3b), blue: toon(0x3e6dff), horn: toon(0xf3ead2), halo: new THREE.MeshBasicMaterial({ color: 0xfff27a }),
  pants: toon(0x2f3a63), shoe: toon(0x26222e), sole: toon(0xf4f1ea), mouth: new THREE.MeshBasicMaterial({ color: 0x5a1f2a }),
  cheek: new THREE.MeshBasicMaterial({ color: 0xff8f9a, transparent: true, opacity: 0.45, depthWrite: false }),
  outline: new THREE.MeshBasicMaterial({ color: 0x1d1633, side: THREE.BackSide }),
};
const SHARED_GEO = new Set(Object.values(G)), SHARED_MAT = new Set(Object.values(M));

function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true;
  if (parent) parent.add(m);
  return m;
}
function inked(m, s = 1.07) { const o = new THREE.Mesh(m.geometry, M.outline); o.scale.setScalar(s); o.castShadow = false; m.add(o); return m; }
const hashId = (s) => { let h = 7; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

// A hat on its own, origin at the top of the wearer's head (sized for a ~0.4 radius head).
export function buildHat(kind, color = 0xffffff) {
  const g = new THREE.Group(); g.name = 'hat';
  const tint = toon(new THREE.Color(color).lerp(new THREE.Color(0x1d1633), 0.25).getHex());
  g.userData.ownMats = [tint];
  switch (kind) {
    case 'cap': { const d = mesh(G.dome, tint, 0, -0.05, 0); d.scale.set(1, 0.75, 1); const v = mesh(G.visor, tint, 0, -0.02, 0.18); v.scale.set(1, 1, 1.5); g.add(d, v); break; }
    case 'tophat': g.add(mesh(G.brim, M.black, 0, 0, 0), mesh(G.tall, M.black, 0, 0.28, 0), mesh(G.band, M.red, 0, 0.08, 0)); break;
    case 'crown': { const c = mesh(G.crown, M.gold, 0, 0.1, 0); c.material.side = THREE.DoubleSide; g.add(c); for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; g.add(mesh(G.gem, i % 2 ? M.red : M.blue, Math.sin(a) * 0.33, 0.1, Math.cos(a) * 0.33)); } break; }
    case 'beanie': { const d = mesh(G.dome, tint, 0, -0.06, 0); d.scale.set(1.05, 0.95, 1.05); g.add(d, mesh(G.pom, M.white, 0, 0.36, 0)); break; }
    case 'party': { const c = mesh(G.cone, tint, 0, 0.25, 0); c.rotation.z = 0.15; g.add(c, mesh(G.pom, M.gold, -0.08, 0.56, 0)); break; }
    case 'horns': for (const s of [-1, 1]) { const h = mesh(G.horn, M.horn, s * 0.3, 0.05, 0); h.rotation.z = -s * 0.7; g.add(h); } break;
    case 'propeller': {   // beanie with a little spinning propeller (it spins while the avatar moves its head)
      const d = mesh(G.dome, tint, 0, -0.06, 0); d.scale.set(1.02, 0.8, 1.02); g.add(d, mesh(G.pom, M.gold, 0, 0.3, 0));
      const blades = new THREE.Group(); blades.position.y = 0.36;
      for (const s of [-1, 1]) { const b = mesh(G.gem, s > 0 ? M.red : M.blue, s * 0.16, 0, 0); b.scale.set(2.6, 0.35, 0.9); blades.add(b); }
      g.add(blades); g.userData.spin = blades; break;
    }
    case 'wizard': { const b = mesh(G.brim, tint, 0, -0.02, 0); b.scale.set(1.08, 1, 1.08); const c = mesh(G.cone, tint, 0, 0.36, 0); c.scale.set(1.25, 1.35, 1.25); c.rotation.z = -0.18; g.add(b, c, mesh(G.gem, M.gold, -0.05, 0.42, 0.27)); break; }
    case 'viking': { const d = mesh(G.dome, M.horn, 0, -0.04, 0); d.material = toon(0xb8c2d6); g.userData.ownMats.push(d.material); g.add(d, mesh(G.band, M.gold, 0, -0.02, 0)); for (const s of [-1, 1]) { const h = mesh(G.horn, M.horn, s * 0.38, 0.12, 0); h.rotation.z = -s * 1.0; g.add(h); } break; }
    case 'halo': { const h = mesh(G.halo, M.halo, 0, 0.28, 0); h.rotation.x = Math.PI / 2; h.castShadow = false; g.add(h); break; }
  }
  return g;
}

function buildHair(style, mat, head) {
  const g = new THREE.Group(); head.add(g);
  if (style === 'bald') return g;
  const capM = mesh(G.hairCap, mat, 0, 0.02, -0.02, g);
  capM.rotation.x = -0.25; capM.scale.set(1.02, 1, 1.04);
  if (style === 'spiky') for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const s = mesh(G.spike, mat, Math.sin(a) * 0.2, 0.32, Math.cos(a) * 0.2 - 0.04, g); s.rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6); }
  if (style === 'curly') for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2; mesh(G.curl, mat, Math.sin(a) * 0.3, 0.22 + (i % 2) * 0.07, Math.cos(a) * 0.28 - 0.05, g); }
  if (style === 'long') { const b = mesh(G.hairBack, mat, 0, -0.16, -0.17, g); b.scale.set(1.1, 1, 0.55); }
  if (style === 'ponytail') { const t = mesh(G.tail, mat, 0, 0.0, -0.42, g); t.rotation.x = 0.5; mesh(G.curl, mat, 0, 0.12, -0.34, g); }
  if (style === 'bun') mesh(G.bun, mat, 0, 0.36, -0.12, g);
  if (style === 'mohawk') { g.remove(capM); const m = mesh(G.mohawk, mat, 0, 0.36, -0.04, g); m.rotation.x = -0.2; }
  return g;
}

// player: {id, color (palette index), hat, skin, hair, hairColor}
export function buildAvatar(player = {}) {
  const h = hashId(player.id || player.name);
  const shirt = hex(player.color ?? 0);
  const skinM = toon(SKINS[player.skin ?? (h % SKINS.length)] ?? SKINS[1]);
  const hairM = toon(HAIR_COLORS[player.hairColor ?? ((h >> 3) % HAIR_COLORS.length)] ?? HAIR_COLORS[0]);
  const shirtM = toon(shirt);
  const darkShirt = toon(new THREE.Color(shirt).lerp(new THREE.Color(0x1d1633), 0.35).getHex());
  const root = new THREE.Group(); root.name = 'avatar';
  const rig = new THREE.Group(); root.add(rig);
  const body = new THREE.Group(); body.position.y = 0.62; rig.add(body);   // pelvis pivot
  // torso + hips
  const torso = inked(mesh(G.torso, shirtM, 0, 0.3, 0, body)); torso.scale.set(1.08, 1, 0.82);
  mesh(G.collar, darkShirt, 0, 0.6, 0, body).rotation.x = Math.PI / 2;
  const hips = mesh(G.hip, M.pants, 0, 0.02, 0, body); hips.scale.set(1.02, 0.55, 0.8);
  const belt = mesh(G.belt, darkShirt, 0, 0.1, 0, body); belt.scale.set(1.0, 1, 0.82);
  // head
  const neck = new THREE.Group(); neck.position.set(0, 0.7, 0); body.add(neck);
  const head = new THREE.Group(); head.position.y = 0.34; neck.add(head);
  inked(mesh(G.head, skinM, 0, 0, 0, head), 1.05);
  for (const s of [-1, 1]) {
    mesh(G.ear, skinM, s * 0.35, -0.02, -0.02, head).scale.set(0.6, 1, 0.8);
    const eye = mesh(G.eye, M.white, s * 0.13, 0.04, 0.3, head); eye.scale.set(1, 1.25, 0.7);
    mesh(G.pupil, M.ink, s * 0.13, 0.03, 0.355, head);
    mesh(G.glint, M.white, s * 0.13 + 0.02, 0.07, 0.395, head);
    const brow = mesh(G.brow, hairM, s * 0.13, 0.17, 0.32, head); brow.rotation.z = s * -0.18;
    const ck = mesh(G.cheek, M.cheek, s * 0.21, -0.08, 0.3, head); ck.rotation.y = s * 0.45; ck.castShadow = false;
  }
  mesh(G.nose, skinM, 0, -0.04, 0.36, head);
  const mouth = mesh(G.mouth, M.mouth, 0, -0.14, 0.32, head); mouth.rotation.set(0.15, 0, Math.PI);
  buildHair(HAIRS.includes(player.hair) ? player.hair : HAIRS[(h >> 6) % (HAIRS.length - 1)], hairM, head);
  const hat = buildHat(player.hat || 'none', shirt); hat.position.set(0, 0.25, 0); hat.scale.setScalar(0.92); head.add(hat);
  // arms (shoulder pivots) + legs (hip pivots)
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.33, 0.52, 0); body.add(sh);
    const up = inked(mesh(G.arm, shirtM, 0, -0.2, 0, sh), 1.12); up.rotation.z = s * 0.12;
    mesh(G.hand, skinM, s * 0.05, -0.43, 0.02, sh);
    sh.rotation.z = s * 0.18; arms.push(sh);
    const hp = new THREE.Group(); hp.position.set(s * 0.14, 0.0, 0); body.add(hp);
    inked(mesh(G.leg, M.pants, 0, -0.22, 0, hp), 1.1);
    const shoe = mesh(G.shoe, M.shoe, 0, -0.52, 0.06, hp);
    mesh(G.shoe, M.sole, 0, -0.575, 0.06, hp).scale.set(1.05, 0.25, 1.05); void shoe;
    legs.push(hp);
  }
  root.userData = {
    rig, body, head, arms, legs, hat, ownMats: [skinM, hairM, shirtM, darkShirt, ...hat.userData.ownMats],
    setPose({ run = 0, t = performance.now() / 1000, jump = 0 } = {}) {
      const ph = t * 11, sw = Math.sin(ph) * run;
      const breathe = Math.sin(t * 2.2) * (1 - run);
      rig.position.y = Math.abs(Math.sin(ph)) * 0.08 * run + breathe * 0.015 + jump;
      body.rotation.x = 0.12 * run;                       // lean into the run
      rig.rotation.z = Math.sin(ph) * 0.04 * run;
      legs[0].rotation.x = sw * 0.9 - jump * 0.8; legs[1].rotation.x = -sw * 0.9 - jump * 0.4;
      arms[0].rotation.x = -sw * 1.0 + jump * -1.2; arms[1].rotation.x = sw * 1.0 + jump * -1.2;
      arms[0].rotation.z = -0.18 - breathe * 0.04 - jump * 0.4; arms[1].rotation.z = 0.18 + breathe * 0.04 + jump * 0.4;
      head.rotation.z = Math.sin(t * 1.3) * 0.05 * (1 - run);
      head.position.y = 0.34 + breathe * 0.01;
      if (hat.userData.spin) hat.userData.spin.rotation.y = t * 14;
    },
  };
  root.userData.setPose({ t: 0 });
  return root;
}

export function disposeAvatar(obj) {
  obj.traverse((o) => {
    if (o.geometry && !SHARED_GEO.has(o.geometry)) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (!SHARED_MAT.has(m)) m.dispose();
  });
  obj.removeFromParent();
}

// Victory dances (unlocked with lifetime trophies; core/profile.js). Call every frame instead of setPose.
export const DANCE_IDS = ['bounce', 'spin', 'sway', 'disco', 'flip'];
export function dance(a, kind, t) {
  const u = a.userData; if (!u?.rig) return;
  u.setPose({ t });
  const { rig, arms } = u, TAU = Math.PI * 2;
  rig.rotation.x = 0; rig.rotation.y = 0;
  const armsUp = (k = 1) => { arms[0].rotation.z = -0.18 - 2.3 * k; arms[1].rotation.z = 0.18 + 2.3 * k; };
  switch (kind) {
    case 'spin': rig.rotation.y = t * 5; rig.position.y = Math.abs(Math.sin(t * 5)) * 0.12; armsUp(0.6); break;
    case 'sway': rig.rotation.z = Math.sin(t * 4) * 0.22; armsUp(1); arms[0].rotation.z += Math.sin(t * 8) * 0.35; arms[1].rotation.z -= Math.sin(t * 8) * 0.35; break;
    case 'disco': { const up = Math.sin(t * 4) > 0; arms[1].rotation.z = up ? 2.7 : 0.4; arms[0].rotation.z = up ? -0.4 : -2.7; rig.rotation.y = Math.sin(t * 4) * 0.35; rig.position.y = Math.abs(Math.sin(t * 8)) * 0.06; break; }
    case 'flip': { const ph = (t % 2.2) / 2.2; if (ph < 0.45) { const k = ph / 0.45; rig.position.y = Math.sin(k * Math.PI) * 0.9; rig.rotation.x = -k * TAU; armsUp(1); } else { rig.position.y = 0; armsUp(Math.sin((ph - 0.45) * 12) > 0 ? 1 : 0.7); } break; }
    default: rig.position.y = Math.abs(Math.sin(t * 6)) * 0.28; armsUp(0.9);
  }
}
