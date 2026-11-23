// Off-main-thread hole preparation: generates candidate holes and bot-tests them to set par, so the
// host's game loop (and its network heartbeat) never stalls.
// in: {id, seed, idx, opt:{theme, mod, pickups}}   out: {id, seed, par}
import * as C from './course.js';
// Extreme-bot shot planning: {id, plan:true, seed, idx, opt, ball, t0, skill, ex, phys}  ->  {id, plan:{a,p}}
const holes = new Map();
onmessage = (e) => {
  const { id, seed: base, idx, opt, phys } = e.data;
  if (phys) Object.assign(C.PHYS, phys);   // the developer portal's tuned ball physics
  if (e.data.plan) {
    const key = base + '/' + idx;
    let hole = holes.get(key);
    if (!hole) { if (holes.size > 4) holes.clear(); hole = C.generateHole(base, idx, opt); holes.set(key, hole); }
    postMessage({ id, plan: C.planShot(hole, e.data.ball, e.data.t0, e.data.skill, 1, e.data.ex) });
    return;
  }
  let best = null;
  for (let k = 0; k < 4; k++) {
    const seed = (base + idx * 1013 + k * 7919) >>> 0;
    const hole = C.generateHole(seed, idx, opt);
    const runs = [C.botRun(hole, 0.8), C.botRun(hole, 0.8), C.botRun(hole, 0.8)];
    const avg = runs.reduce((a, r) => a + (r ?? C.MAX_STROKES), 0) / runs.length;
    const par = Math.max(2, Math.min(6, Math.round(avg)));
    if (runs.some((r) => r !== null)) { postMessage({ id, seed, par }); return; }
    if (!best) best = { id, seed, par: hole.par };
  }
  postMessage(best);
};
