// Three.js helpers that make cleanup easy. ctx.three.* in games.
import * as THREE from 'three';
import { settings, QUALITY } from './settings.js';

// Free every geometry, material and texture under obj (skips anything listed in `keep`).
export function disposeObject(obj, keep = null) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry && !keep?.has(o.geometry)) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (keep?.has(m)) continue;
      for (const v of Object.values(m)) if (v && v.isTexture && !keep?.has(v)) v.dispose();
      m.dispose();
    }
  });
  obj.removeFromParent?.();
}

// A WebGLRenderer configured from the graphics-quality setting. The hub disposes it (and forces the
// GL context to be released) when the game stops, even if the game forgets.
export function createRenderer(container, opts = {}) {
  const q = QUALITY[settings.get('quality')] || QUALITY.high;
  const r = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance', ...opts });
  r.setPixelRatio(Math.min(devicePixelRatio || 1, q.pixelRatio));
  r.setSize(container.clientWidth || innerWidth, container.clientHeight || innerHeight);
  r.shadowMap.enabled = q.shadows;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.domElement.classList.add('game-canvas');
  container.appendChild(r.domElement);
  return r;
}
export function applyQuality(renderer, light = null) {
  const q = QUALITY[settings.get('quality')] || QUALITY.high;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.pixelRatio));
  renderer.shadowMap.enabled = q.shadows;
  if (light?.shadow && q.shadowMap) { light.castShadow = q.shadows; if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; } light.shadow.mapSize.set(q.shadowMap, q.shadowMap); }
  else if (light) light.castShadow = false;
  return q;
}
