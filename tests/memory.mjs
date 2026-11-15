// Load and unload games 10 times in a row (host + a client) and check memory and WebGL contexts don't keep climbing.
// usage: node memory.mjs [gameId ...]   (cycles through the given games)
import { startStatic, startPeer, launch, openPage, createParty, joinByCode, waitFor, sleep, heap, check, wiggle } from './harness.mjs';

const games = process.argv.slice(2).length ? process.argv.slice(2) : ['coingrab'];
const BASE = 'http://127.0.0.1:8080/index.html?dev=1&peer=127.0.0.1:9000&testfps=' + (process.env.TESTFPS || 6) + (process.env.NETLOG ? '&netlog=1' : '');
const srv = await startStatic(8080); await startPeer(9000);
const { browser, context } = await launch();
const pages = [];
try {
  const A = await openPage(await context(), BASE, 'A'); pages.push(A);
  const code = await createParty(A, 'Host');
  const B = await openPage(await context(), BASE, 'B'); pages.push(B);
  await joinByCode(B, 'Guest', code);
  await A.click('#addBot'); await A.click('#addBot');
  const heaps = [];
  for (let i = 0; i < 10; i++) {
    const game = games[i % games.length];
    await A.click(`[data-game="${game}"]`);
    await A.click('#forceStart');
    await waitFor(A, () => ['setup', 'loading', 'countdown', 'playing'].includes(window.__hub.state.phase), null, 8000, 'start');
    if (await A.evaluate(() => window.__hub.state.phase === 'setup')) { for (const p of pages) await p.click('#setupReady'); }
    for (const p of pages) await waitFor(p, () => window.__hub.state.phase === 'playing' && window.__hub.runtime?.started, null, 40000, 'playing');
    await Promise.all(pages.map((p) => wiggle(p, 2500)));
    await A.evaluate(() => window.__hub.act({ type: 'endGame' }));
    await waitFor(A, () => window.__hub.screen === 'results', null, 10000, 'results');
    await A.click('#resContinue');
    for (const p of pages) await waitFor(p, () => window.__hub.screen === 'lobby' && !window.__hub.runtime, null, 10000, 'lobby');
    await sleep(500);
    const live = await A.evaluate(() => ({ ...window.__hub.liveStats, canvases: document.querySelectorAll('#stage canvas').length, roots: document.querySelectorAll('.game-root').length, hud: document.getElementById('hud').childElementCount }));
    check(live.renderers === 0 && live.mounted === 0 && live.canvases === 0 && live.roots === 0 && live.hud === 0, `cycle ${i + 1} (${game}): game fully unloaded ${JSON.stringify(live)}`);
    heaps.push(await heap(A));
    console.log(`     heap after cycle ${i + 1}: ${(heaps[i] / 1048576).toFixed(1)} MB`);
  }
  const first = Math.min(...heaps.slice(0, 3)), last = Math.min(...heaps.slice(-3));
  check(last < first * 1.25 + 4 * 1048576, `memory stable: ${(first / 1048576).toFixed(1)} MB → ${(last / 1048576).toFixed(1)} MB over 10 loads`);
  const disc = (await A.evaluate(() => window.__hub.state.players.filter((p) => !p.isBot && !p.connected).length));
  check(disc === 0, 'no disconnects during 10 game switches');
  const errs = pages.flatMap((p) => p.errors).filter((e) => !/WebGL context was lost/i.test(e));
  if (errs.length) console.log(errs.join('\n'));
  check(errs.length === 0, 'no console errors');
  console.log('\nMEMORY PASSED');
} catch (e) {
  console.error('\nMEMORY FAILED:', e.message);
  for (const p of pages) { try { await p.screenshot({ path: `artifacts/mem-fail-${p.label}.png` }); } catch { /* */ } console.log(p.errors.join('\n')); }
  process.exitCode = 1;
} finally { await browser.close(); srv.close(); setTimeout(() => process.exit(), 100); }
