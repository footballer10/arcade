// Party features: vote mode, Shuffle playlist ending on the champion podium, mid-game join (spectate, then play),
// host handover ("make host"), kick.
import { startStatic, startPeer, launch, openPage, createParty, joinByCode, waitFor, state, sleep, check } from './harness.mjs';

const BASE = 'http://127.0.0.1:8080/index.html?dev=1&peer=127.0.0.1:9000&testfps=' + (process.env.TESTFPS || 4) + (process.env.NETLOG ? '&netlog=1' : '');
const srv = await startStatic(8080); await startPeer(9000);
const { browser, context } = await launch();
const pages = [];
const setupReadyAll = async (ps) => { for (const p of ps) { if (await p.evaluate(() => window.__hub.screen === 'setup' && !window.__hub.state.game.setupReady[window.__hub.pid]).catch(() => false)) await p.click('#setupReady').catch(() => {}); } };
async function playUntil(ps, host, phase) {
  for (const p of ps) await waitFor(p, () => ['setup', 'loading', 'countdown', 'playing'].includes(window.__hub.state.phase), null, 15000, 'game flow');
  for (let i = 0; i < 40 && (await state(host)).phase === 'setup'; i++) { await setupReadyAll(ps); await sleep(300); }
  for (const p of ps) await waitFor(p, (ph) => window.__hub.state.phase === ph, phase, 60000, phase);
}
try {
  const A = await openPage(await context(), BASE, 'A'); pages.push(A);
  const code = await createParty(A, 'Ana');
  const B = await openPage(await context(), BASE, 'B'); pages.push(B);
  await joinByCode(B, 'Ben', code);
  await A.click('#addBot');
  // ---- vote
  await A.click('[data-mode="vote"]');
  await waitFor(B, () => window.__hub.state.mode === 'vote', null, 5000, 'vote mode');
  await A.click('[data-game="coingrab"]'); await B.click('[data-game="coingrab"]');
  await waitFor(A, () => Object.keys(window.__hub.state.votes).length === 2, null, 5000, 'votes');
  await B.click('#readyBtn');
  await A.click('#startBtn');
  await playUntil([A, B], A, 'playing');
  check((await state(A)).game.id === 'coingrab', 'vote mode launched the voted game (Coin Grab, 2 votes)');
  // ---- mid-game join: spectates this round, plays the next
  const C = await openPage(await context(), BASE, 'C'); pages.push(C);
  await joinByCode(C, 'Cal', code).catch(async () => { await waitFor(C, () => window.__hub.runtime, null, 20000, 'C in game'); });
  await waitFor(C, () => window.__hub.runtime?.ctx?.spectator === true, null, 30000, 'C spectating');
  check(true, 'player who joined mid-game is spectating the running round');
  await A.evaluate(() => window.__hub.act({ type: 'endGame' }));
  for (const p of pages) await waitFor(p, () => window.__hub.screen === 'results', null, 15000, 'results');
  await A.click('#resContinue');
  for (const p of pages) await waitFor(p, () => window.__hub.screen === 'lobby', null, 10000, 'lobby');
  // ---- shuffle of 3, ended early each time, then podium
  await A.click('[data-mode="shuffle"]');
  await A.selectOption('#shuffleLen', '3');
  await waitFor(B, () => window.__hub.state.mode === 'shuffle' && window.__hub.state.shuffleLen === 3, null, 5000, 'shuffle mode');
  await A.click('#forceStart');
  const played = [];
  for (let g = 0; g < 3; g++) {
    await playUntil(pages, A, 'playing');
    const s = await state(A);
    played.push(s.game.id);
    check(s.game.participants.includes(await C.evaluate(() => window.__hub.pid)), `shuffle game ${g + 1}/3 (${s.game.id}) includes the late joiner as a player`);
    await sleep(1500);
    await A.evaluate(() => window.__hub.act({ type: 'endGame' }));
    for (const p of pages) await waitFor(p, () => window.__hub.screen === 'results', null, 15000, 'results');
    await A.click('#resContinue');
  }
  for (const p of pages) await waitFor(p, () => window.__hub.screen === 'podium', null, 15000, 'podium');
  const pod = (await state(B)).podium;
  check(pod && pod.top.length === 3, `champion podium after the shuffle (${played.join(' → ')}): ${pod.top.map((t) => t.name + ' +' + t.trophies).join(', ')}`);
  await A.screenshot({ path: 'artifacts/podium.png' });
  await A.click('#podContinue');
  for (const p of pages) await waitFor(p, () => window.__hub.screen === 'lobby', null, 10000, 'lobby after podium');
  const tot = (await state(A)).players.reduce((a, p) => a + p.trophies, 0);
  check(tot > 0, `trophies accumulate across games (${tot} total handed out)`);
  // ---- make host (handover)
  const bPid = await B.evaluate(() => window.__hub.pid);
  await A.evaluate((id) => window.__hub.act({ type: 'makeHost', id }), bPid);
  await waitFor(B, () => window.__hub.net.isHost, null, 30000, 'B becomes host');
  await waitFor(A, (id) => window.__hub.state.hostId === id && !window.__hub.net.isHost && window.__hub.state.players.filter((p) => !p.isBot && p.connected).length === 3, bPid, 40000, 'A and C follow the new host');
  check(true, 'host handed over to Ben; everyone is still in the party');
  // ---- kick
  const cPid = await C.evaluate(() => window.__hub.pid);
  await B.evaluate((id) => window.__hub.act({ type: 'kick', id }), cPid);
  await waitFor(C, () => window.__hub.screen === 'home', null, 15000, 'C kicked to home');
  await waitFor(A, () => window.__hub.state.players.filter((p) => !p.isBot).length === 2, null, 10000, 'C removed');
  check(true, 'kicked player is sent home and removed');
  const errs = pages.flatMap((p) => p.errors);
  if (errs.length) console.log(errs.join('\n'));
  check(errs.length === 0, 'no console errors');
  console.log('\nPARTY PASSED');
} catch (e) {
  console.error('\nPARTY FAILED:', e.message);
  for (const p of pages) { try { await p.screenshot({ path: `artifacts/party-fail-${p.label}.png` }); console.log(p.label, await p.evaluate(() => JSON.stringify({ screen: window.__hub.screen, phase: window.__hub.state?.phase, host: window.__hub.net?.isHost }))); } catch { /* */ } console.log(p.errors.join('\n')); }
  process.exitCode = 1;
} finally { await browser.close(); srv.close(); setTimeout(() => process.exit(), 100); }
