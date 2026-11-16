// Per-game "players" used by the tests: they generate input until the game reaches the results screen.
import { sleep, wiggle } from './harness.mjs';

export const DRIVERS = {
  // Arena: run around, aim at the middle, hold attack, dash now and then.
  async arena(page, until) {
    while (!(await until())) {
      await page.mouse.move(300 + Math.random() * 60, 200 + Math.random() * 60);
      await page.mouse.down().catch(() => {});
      await wiggle(page, 1200);
      await page.mouse.up().catch(() => {});
    }
  },
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
  // Neon Rush: the game's own bot driver races for us (test-only autopilot hook), holding W as a fallback.
  async neon(page, until) {
    while (!(await until())) {
      await page.evaluate(() => { if (window.__neon) window.__neon.autopilot = true; }).catch(() => {});
      await sleep(1500);
    }
  },
  // Snake: steer with keys + boost bursts (wiggle). Rounds end when one snake is left or the clock runs out.
  async snake(page, until) { while (!(await until())) await wiggle(page, 1500); },
  // Rising Lava: the game's own bot AI plays for us (test-only autopilot) and the lava clock runs 3x faster.
  async lava(page, until) {
    while (!(await until())) {
      await page.evaluate(() => { if (window.__lava) { window.__lava.autopilot = true; window.__lava.turbo = 3; } }).catch(() => {});
      await sleep(1000);
    }
  },
  // Ultimate Obstacle Course: the game's own bot AI plays for us (test-only autopilot); the show runs 3x faster.
  async obstacle(page, until) {
    while (!(await until())) {
      await page.evaluate(() => { if (window.__obstacle) { window.__obstacle.autopilot = true; window.__obstacle.turbo = 3; } }).catch(() => {});
      await sleep(1000);
    }
  },
  // Floor Is Falling: the game's own bot AI plays for us (test-only autopilot) and the collapse comes 3x sooner.
  async floorfall(page, until) {
    while (!(await until())) {
      await page.evaluate(() => { if (window.__ff) { window.__ff.autopilot = true; window.__ff.turbo = 3; } }).catch(() => {});
      await sleep(1000);
    }
  },
  // Prop Hunt: the round clock runs 6x faster (test-only hook); the host's own player is driven by the bot AI,
  // the others wander around (and get found, or not).
  async prophunt(page, until) {
    while (!(await until())) {
      await page.evaluate(() => { const g = window.__prophunt; if (g) { g.turbo = 6; if (window.__hub?.net?.isHost) g.autopilot = true; } }).catch(() => {});
      await wiggle(page, 1200);
    }
  },
  async coingrab(page, until) { while (!(await until())) await wiggle(page, 1200); },
};
export async function play(page, gameId, until) { const d = DRIVERS[gameId] || DRIVERS.coingrab; await d(page, until); }
