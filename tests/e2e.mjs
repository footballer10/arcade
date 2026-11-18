// Full party flow with 3 browser contexts (real WebRTC through a local PeerJS server):
// create → join by link and by code → bot → ready → play GAME to results → lobby → refresh-rejoin → no errors.
// usage: node e2e.mjs [gameId ...]
import { startStatic, startPeer, startRelay, RELAY, launch, openPage, createParty, joinByCode, joinByLink, waitFor, state, sleep, check } from './harness.mjs';
import { play } from './drivers.mjs';

// host choices on the pre-round screen (keep test rounds short)
const SETUP = { golf: (A) => A.click('[data-opt="holes"][data-v="1"]'), arena: (A) => A.click('[data-opt="wins"][data-v="2"]') };
const games = process.argv.slice(2).length ? process.argv.slice(2) : ['coingrab'];
const BASE = 'http://127.0.0.1:8080/index.html?dev=1&peer=127.0.0.1:9000' + RELAY + (process.env.EXTRA || '') + '&testfps=' + (process.env.TESTFPS || 6) + (process.env.NETLOG ? '&netlog=1' : '');
const srv = await startStatic(8080); await startPeer(9000); await startRelay(9002);
const { browser, context } = await launch();
const pages = [];
try {
  const A = await openPage(await context(), BASE, 'A'); pages.push(A);
  const code = await createParty(A, 'Alice');
  check(/^[A-Z]{4}$/.test(code), `party created with code ${code}`);
  const B = await openPage(await context(), `${BASE}&room=${code}`, 'B'); pages.push(B);
  await joinByLink(B, 'Bob');
  const C = await openPage(await context(), BASE, 'C'); pages.push(C);
  await joinByCode(C, 'Cara', code);
  await waitFor(A, () => window.__hub.state.players.length === 3, null, 10000, '3 players');
  check(true, 'B joined by link, C joined by code');
  await A.click('#addBot');
  await waitFor(C, () => window.__hub.state.players.some((p) => p.isBot), null, 5000, 'bot visible on C');
  check(true, 'host added a bot (visible to everyone)');
  // chat
  await B.keyboard.press('Enter'); await waitFor(B, () => document.activeElement?.id === 'chatIn', null, 3000, 'chat focus'); await B.keyboard.type('hello party'); await B.keyboard.press('Enter');
  await waitFor(C, () => document.getElementById('chatPanel').textContent.includes('hello party'), null, 5000, 'chat');
  check(true, 'chat message delivered');

  for (const [gi, game] of games.entries()) {
    console.log(`\n== ${game} ==`);
    await A.click(`[data-game="${game}"]`);
    for (const p of [B, C]) { await waitFor(p, () => window.__hub.screen === 'lobby', null, 15000, 'lobby'); await p.click('#readyBtn'); }
    await waitFor(A, () => window.__hub.state.players.filter((p) => !p.isBot && p.id !== window.__hub.state.hostId).every((p) => p.ready), null, 5000, 'all ready');
    check(true, 'everyone readied up');
    await A.click('#startBtn');
    await waitFor(A, () => ['setup', 'loading', 'countdown', 'playing'].includes(window.__hub.state.phase), null, 5000, 'game starting');
    if ((await state(A)).phase === 'setup') {
      if (SETUP[game]) await SETUP[game](A);
      for (const p of pages) { await waitFor(p, () => window.__hub.screen === 'setup', null, 5000, 'setup'); await p.click('#setupReady'); }
      check(true, 'pre-round setup screen passed');
    }
    for (const p of pages) await waitFor(p, () => window.__hub.state.phase === 'playing' && window.__hub.runtime?.started, null, 40000, 'playing');
    check(true, `${game} loaded on all clients and the shared countdown finished`);
    const until = async () => (await state(A)).phase === 'results';
    await Promise.all(pages.map((p) => play(p, game, until)));
    for (const p of pages) await waitFor(p, () => window.__hub.screen === 'results', null, 10000, 'results');
    const s = await state(A);
    check(s.results.groups.flat().length >= 4, `results screen shows ${s.results.groups.flat().length} placements; winner ${s.results.groups[0].join(',')}`);
    check(s.players.reduce((a, p) => a + p.trophies, 0) > 0, 'trophies awarded');
    await A.click('#resContinue');
    for (const p of pages) await waitFor(p, () => window.__hub.screen === 'lobby' && !window.__hub.runtime, null, 10000, 'back to lobby');
    const s2 = await state(B);
    check(s2.players.filter((p) => !p.isBot).every((p) => p.connected), 'back in lobby, nobody disconnected');
    if (gi === 0) {
      // refresh one client: it must rejoin the same seat automatically
      const before = await C.evaluate(() => window.__hub.pid);
      await C.reload();
      await waitFor(C, () => window.__hub.screen === 'lobby', null, 25000, 'rejoin after refresh');
      check((await C.evaluate(() => window.__hub.pid)) === before && (await state(A)).players.filter((p) => !p.isBot).length === 3, 'refreshed client rejoined with the same identity');
    }
  }
  const errs = pages.flatMap((p) => p.errors);
  if (errs.length) console.log(errs.join('\n'));
  check(errs.length === 0, 'no console errors');
  console.log('\nE2E PASSED');
} catch (e) {
  console.error('\nE2E FAILED:', e.message);
  for (const p of pages) { try { await p.screenshot({ path: `artifacts/fail-${p.label}.png` }); console.log(p.label, await p.evaluate(() => JSON.stringify({ screen: window.__hub.screen, phase: window.__hub.state?.phase, host: window.__hub.net?.isHost, role: window.__hub.net?.role, players: window.__hub.state?.players.map((x) => x.name + ':' + x.connected) }))); } catch { /* */ } console.log(p.errors.join('\n')); }
  process.exitCode = 1;
} finally { await browser.close(); srv.close(); setTimeout(() => process.exit(), 100); }
