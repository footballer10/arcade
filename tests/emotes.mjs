// Emotes (keys 1-4) from host and client must show up once and must not flood the connection or stall the game.
// usage: node emotes.mjs [gameId ...]   (default: golf arena)
import { startStatic, startPeer, launch, openPage, createParty, joinByCode, waitFor, sleep, check } from './harness.mjs';
import { play } from './drivers.mjs';
const games = process.argv.slice(2).length ? process.argv.slice(2) : ['golf', 'arena'];
const BASE = 'http://127.0.0.1:8080/index.html?dev=1&peer=127.0.0.1:9000&testfps=4';
const srv = await startStatic(8080); await startPeer(9000);
const { browser, context } = await launch();
const pages = [];
try {
  const A = await openPage(await context(), BASE, 'A'); pages.push(A);
  const code = await createParty(A, 'Host');
  const B = await openPage(await context(), BASE, 'B'); pages.push(B);
  await joinByCode(B, 'Guest', code);
  await A.click('#addBot');
  for (const p of pages) await p.evaluate(() => { window.__msgs = 0; window.__hub.net.on('game', () => { window.__msgs++; }); });
  for (const game of games) {
    await A.click(`[data-game="${game}"]`); await A.click('#forceStart'); await sleep(500);
    if (await A.evaluate(() => window.__hub.state.phase === 'setup')) {
      if (game === 'golf') await A.click('[data-opt="holes"][data-v="1"]');
      if (game === 'arena') await A.click('[data-opt="wins"][data-v="2"]');
      for (const p of pages) await p.click('#setupReady');
    }
    for (const p of pages) await waitFor(p, () => window.__hub.state.phase === 'playing' && window.__hub.runtime?.started, null, 60000, 'playing');
    await sleep(4000);
    const base = await Promise.all(pages.map((p) => p.evaluate(() => window.__msgs)));
    await sleep(3000);
    const normal = await Promise.all(pages.map((p, i) => p.evaluate(() => window.__msgs).then((n) => n - base[i])));
    for (const p of pages) for (const k of ['Digit1', 'Digit2', 'Digit3']) { await p.keyboard.press(k); await sleep(1000); }
    const b2 = await Promise.all(pages.map((p) => p.evaluate(() => window.__msgs)));
    await sleep(3000);
    const after = await Promise.all(pages.map((p, i) => p.evaluate(() => window.__msgs).then((n) => n - b2[i])));
    check(after.every((n, i) => n < normal[i] * 3 + 50), `${game}: emotes don't flood the connection (msgs in 3 s: before ${normal.join('/')}, after ${after.join('/')})`);
    const until = async () => (await A.evaluate(() => window.__hub.state.phase)) === 'results';
    await Promise.all(pages.map((p) => play(p, game, until)));
    for (const p of pages) await waitFor(p, () => window.__hub.screen === 'results', null, 20000, 'results');
    check(true, `${game}: game still plays to the results screen after emotes`);
    await A.click('#resContinue');
    for (const p of pages) await waitFor(p, () => window.__hub.screen === 'lobby', null, 15000, 'lobby');
  }
  const errs = pages.flatMap((p) => p.errors);
  if (errs.length) console.log(errs.join('\n'));
  check(errs.length === 0, 'no console errors');
  console.log('\nEMOTES PASSED');
} catch (e) { console.error('\nEMOTES FAILED:', e.message); for (const p of pages) console.log(p.errors.join('\n')); process.exitCode = 1; }
finally { await browser.close(); srv.close(); setTimeout(() => process.exit(), 100); }
