// "Play Solo vs Bots": one click puts you in a lobby with 3 bots; Start plays a game. Run with and without PeerJS.
import { startStatic, startPeer, launch, openPage, waitFor, sleep, check } from './harness.mjs';
const withPeer = process.argv[2] !== 'nopeer';
const srv = await startStatic(8080); if (withPeer) await startPeer(9000);
const { browser, context } = await launch();
const A = await openPage(await context(), `http://127.0.0.1:8080/index.html?peer=127.0.0.1:${withPeer ? 9000 : 9999}&testfps=4`, 'A');
try {
  await A.click('#soloBtn');
  await waitFor(A, () => window.__hub.screen === 'lobby' && window.__hub.state.players.filter((p) => p.isBot).length === 3, null, 40000, 'solo lobby with bots');
  const s = await A.evaluate(() => window.__hub.state);
  check(true, `solo lobby with 3 bots (${s.net === 'local' ? 'fell back to same-computer mode' : 'online, code ' + s.code})`);
  await A.click('[data-game="coingrab"]'); await A.click('#startBtn');
  await sleep(500); if (await A.evaluate(() => window.__hub.state.phase === 'setup')) await A.click('#setupReady');
  await waitFor(A, () => window.__hub.state.phase === 'playing', null, 40000, 'playing');
  await A.evaluate(() => window.__hub.act({ type: 'endGame' }));
  await waitFor(A, () => window.__hub.screen === 'results', null, 15000, 'results');
  check(true, 'solo game played to the results screen');
  const errs = A.errors.filter((e) => !/9999|ERR_CONNECTION_REFUSED|WebSocket/.test(e));
  if (errs.length) console.log(errs.join('\n'));
  check(errs.length === 0, 'no console errors');
  console.log('SOLO PASSED');
} catch (e) { console.log('SOLO FAILED', e.message, A.errors.join('\n')); process.exitCode = 1; }
await browser.close(); srv.close(); setTimeout(() => process.exit(), 100);
