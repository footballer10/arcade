// Per-game "players" used by the tests: they generate input until the game reaches the results screen.
import { sleep, wiggle } from './harness.mjs';

export const DRIVERS = {
  // Downhill: the game's own bot AI rides for us (test-only autopilot hook).
  async downhill(page, until) {
    await page.evaluate(() => { if (window.__dh) window.__dh.autopilot = true; }).catch(() => {});
    while (!(await until())) await sleep(1500);
  },
  // Golf: line up a real shot at the cup with the game's own planner, then putt.
  async golf(page, until) {
    while (!(await until())) {
      await page.evaluate(() => {
        const g = window.__golf; if (!g || !g.canShoot()) return;
        const b = g.balls().get(window.__hub.pid); const sh = g.C.planShot(g.S.hole, b, g.S.ht + 0.05, 0.9);
        g.shoot(sh.a, sh.p);
      }).catch(() => {});
      await sleep(700);
    }
  },
  async coingrab(page, until) { while (!(await until())) await wiggle(page, 1200); },
};
export async function play(page, gameId, until) { const d = DRIVERS[gameId] || DRIVERS.coingrab; await d(page, until); }
