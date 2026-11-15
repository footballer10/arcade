// The shared player character: a chunky cartoon "bean" in the player's color plus one hat.
// Shown in the lobby and podium, and used by any game where a player body makes sense, so you look like you everywhere.
//   const a = ctx.avatar.build(player)            // THREE.Group, ~1.6 units tall, feet at y=0, faces +z
//   a.userData.setPose({ run: 0..1, t: seconds })  // simple bob/waddle animation
//   scene.add(ctx.avatar.hat(player.hat))          // just the hat (put it on your own character's head)
//   ctx.avatar.dispose(a)                          // frees its geometries/materials (shared ones are kept)
import * as THREE from 'three';
import { hex } from './palette.js';

export const HATS = ['none', 'cap', 'tophat', 'crown', 'beanie', 'party', 'horns', 'halo'];
export const HAT_LABELS = { none: 'No hat', cap: 'Cap', tophat: 'Top hat', crown: 'Crown', beanie: 'Beanie', party: 'Party hat', horns: 'Horns', halo: 'Halo' };

const GRAD = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
GRAD.needsUpdate = true;
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: GRAD, ...extra });
// Shared (never disposed): geometries and fixed-color materials.
const G = {
  body: new THREE.CapsuleGeometry(0.5, 0.55, 6, 16),
  eye: new THREE.SphereGeometry(0.11, 12, 8),
  pupil: new THREE.SphereGeometry(0.06, 10, 6),
  foot: new THREE.SphereGeometry(0.17, 10, 8),
  visor: new THREE.CylinderGeometry(0.36, 0.36, 0.04, 20, 1, false, -Math.PI / 2, Math.PI),
  dome: new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.52, 0.52, 0.05, 24),
  tall: new THREE.CylinderGeometry(0.3, 0.32, 0.55, 20),
  band: new THREE.CylinderGeometry(0.33, 0.33, 0.1, 20),
  crown: new THREE.CylinderGeometry(0.34, 0.3, 0.26, 10, 1, true),
  gem: new THREE.OctahedronGeometry(0.07),
  pom: new THREE.SphereGeometry(0.11, 10, 8),
  cone: new THREE.ConeGeometry(0.26, 0.6, 18),
  horn: new THREE.ConeGeometry(0.09, 0.38, 10),
  halo: new THREE.TorusGeometry(0.3, 0.05, 8, 28),
};
const M = {
  white: toon(0xffffff), ink: new THREE.MeshBasicMaterial({ color: 0x1d1633 }), black: toon(0x22202e), gold: toon(0xffcc33, { emissive: 0x332200 }),
  red: toon(0xe23b3b), blue: toon(0x3e6dff), horn: toon(0xf3ead2), halo: new THREE.MeshBasicMaterial({ color: 0xfff27a }),
  outline: new THREE.MeshBasicMaterial({ color: 0x1d1633, side: THREE.BackSide }),
};
const SHARED_GEO = new Set(Object.values(G)), SHARED_MAT = new Set(Object.values(M));

function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; }

// A hat on its own, origin at the top of the wearer's head.
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
    case 'halo': { const h = mesh(G.halo, M.halo, 0, 0.28, 0); h.rotation.x = Math.PI / 2; h.castShadow = false; g.add(h); break; }
  }
  return g;
}

// player: {color (palette index), hat}
export function buildAvatar(player = {}) {
  const color = hex(player.color ?? 0);
  const root = new THREE.Group(); root.name = 'avatar';
  const bodyMat = toon(color);
  const rig = new THREE.Group(); root.add(rig);
  const body = mesh(G.body, bodyMat, 0, 0.82, 0);
  const out = new THREE.Mesh(G.body, M.outline); out.scale.setScalar(1.06); body.add(out);
  rig.add(body);
  const face = new THREE.Group(); face.position.set(0, 1.05, 0.38); rig.add(face);
  for (const s of [-1, 1]) { face.add(mesh(G.eye, M.white, s * 0.17, 0, 0.05)); face.add(mesh(G.pupil, M.ink, s * 0.17, 0, 0.14)); }
  const feet = [];
  for (const s of [-1, 1]) { const f = mesh(G.foot, bodyMat, s * 0.22, 0.12, 0.05); f.scale.set(1, 0.7, 1.35); rig.add(f); feet.push(f); }
  const hat = buildHat(player.hat || 'none', color); hat.position.set(0, 1.5, 0); rig.add(hat);
  root.userData = {
    rig, body, feet, hat, ownMats: [bodyMat, ...hat.userData.ownMats],
    setPose({ run = 0, t = performance.now() / 1000, jump = 0 } = {}) {
      const w = Math.sin(t * 14) * run;
      rig.position.y = Math.abs(Math.sin(t * 14)) * 0.1 * run + Math.sin(t * 2.2) * 0.02 * (1 - run) + jump;
      rig.rotation.z = w * 0.08;
      feet[0].position.z = 0.05 + w * 0.22; feet[1].position.z = 0.05 - w * 0.22;
      body.scale.set(1 + Math.sin(t * 2.2) * 0.015, 1 - Math.sin(t * 2.2) * 0.015, 1);
    },
  };
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
