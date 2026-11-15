// Host migration: 3 players in a game, the host closes their tab mid-game, the party must survive,
// the game must continue under the new host, finish, and everyone returns to the lobby together.
// usage: node migration.mjs [gameId]
import { startStatic, startPeer, launch, openPage, createParty, joinByCode, waitFor, state, sleep, check, wiggle } from './harness.mjs';
import { play } from './drivers.mjs';

const game = process.argv[2] || 'coingrab';
const BASE = 'http://127.0.0.1:8080/index.html?peer=127.0.0.1:9000';
const srv = await startStatic(8080); await startPeer(9000);
const { browser, context } = await launch();
const pages = [];
try {
  const A = await openPage(await context(), BASE, 'A'); pages.push(A);
  const code = await createParty(A, 'Host');
  const B = await openPage(await context(), BASE, 'B'); pages.push(B);
  await joinByCode(B, 'Bea', code);
  const C = await openPage(await context(), BASE, 'C'); pages.push(C);
  await joinByCode(C, 'Cy', code);
  await A.click('#addBot');
  await A.click(`[data-game="${game}"]`);
  await A.click('#forceStart');
  if (await A.evaluate(() => window.__hub.state.phase === 'setup')) for (const p of pages) await p.click('#setupReady');
  for (const p of pages) await waitFor(p, () => window.__hub.state.phase === 'playing' && window.__hub.runtime?.started, null, 40000, 'playing');
  await Promise.all(pages.map((p) => wiggle(p, 3000)));
  const before = await state(B);
  const oldHost = before.hostId;
  await A.close(); pages.shift();
  console.log('  host tab closed');
  await waitFor(B, (h) => window.__hub.state.hostId !== h && window.__hub.state.players.filter((p) => !p.isBot && p.connected).length === 2, oldHost, 30000, 'new host');
  await waitFor(C, (h) => window.__hub.state.hostId !== h && !document.getElementById('reconnect').classList.contains('hidden') === false, oldHost, 30000, 'C reconnected');
  const s = await state(B);
  const newHost = s.hostId;
  check(newHost !== oldHost, `new host is ${s.players.find((p) => p.id === newHost).name}`);
  check(s.phase === 'playing' && (await B.evaluate(() => !!window.__hub.runtime)) && (await C.evaluate(() => !!window.__hub.runtime)), 'game kept running for both remaining players');
  const until = async () => (await state(B)).phase === 'results';
  await Promise.all(pages.map((p) => play(p, game, until)));
  for (const p of pages) await waitFor(p, () => window.__hub.screen === 'results', null, 15000, 'results');
  check(true, 'game finished under the new host');
  const H = (await B.evaluate(() => window.__hub.net.isHost)) ? B : C;
  await H.click('#resContinue');
  for (const p of pages) await waitFor(p, () => window.__hub.screen === 'lobby', null, 10000, 'lobby');
  const s2 = await state(C);
  check(s2.players.filter((p) => !p.isBot && p.connected).length === 2, 'both survivors are together in the lobby');
  // the party keeps working: start another round under the new host
  await H.click('#forceStart');
  if (await H.evaluate(() => window.__hub.state.phase === 'setup')) for (const p of pages) await p.click('#setupReady');
  for (const p of pages) await waitFor(p, () => window.__hub.state.phase === 'playing', null, 40000, 'playing again');
  check(true, 'new host can start another game');
  const errs = pages.flatMap((p) => p.errors);
  if (errs.length) console.log(errs.join('\n'));
  check(errs.length === 0, 'no console errors');
  console.log('\nMIGRATION PASSED');
} catch (e) {
  console.error('\nMIGRATION FAILED:', e.message);
  for (const p of pages) { try { await p.screenshot({ path: `artifacts/mig-fail-${p.label}.png` }); } catch { /* */ } console.log(p.errors.join('\n')); }
  process.exitCode = 1;
} finally { await browser.close(); srv.close(); setTimeout(() => process.exit(), 100); }
