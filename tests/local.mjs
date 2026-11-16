// BroadcastChannel transport (no internet, no PeerJS server): two TABS of one browser play together.
import { startStatic, launch, openPage, createParty, joinByCode, waitFor, state, check, wiggle } from './harness.mjs';

const BASE = 'http://127.0.0.1:8080/index.html?dev=1&net=local';
const srv = await startStatic(8080);
const { browser, context } = await launch();
const ctx = await context();
const pages = [];
try {
  const A = await openPage(ctx, BASE, 'tab1'); pages.push(A);
  const code = await createParty(A, 'TabOne');
  check((await state(A)).net === 'local', `local party ${code} created (BroadcastChannel)`);
  const B = await openPage(ctx, BASE, 'tab2'); pages.push(B);
  await joinByCode(B, 'TabTwo', code);
  await A.click('#addBot');
  await A.click('#forceStart');
  if (await A.evaluate(() => window.__hub.state.phase === 'setup')) for (const p of pages) await p.click('#setupReady');
  for (const p of pages) await waitFor(p, () => window.__hub.state.phase === 'playing' && window.__hub.runtime?.started, null, 40000, 'playing');
  await Promise.all(pages.map((p) => wiggle(p, 2500)));
  const posB = await B.evaluate(() => window.__hub.state.players.length);
  check(posB === 3, 'both tabs + bot in the game');
  await A.evaluate(() => window.__hub.act({ type: 'endGame' }));
  for (const p of pages) await waitFor(p, () => window.__hub.screen === 'results', null, 10000, 'results');
  await A.click('#resContinue');
  for (const p of pages) await waitFor(p, () => window.__hub.screen === 'lobby', null, 10000, 'lobby');
  // host tab closes -> second tab takes over
  await A.close(); pages.shift();
  await waitFor(B, () => window.__hub.net.isHost, null, 30000, 'tab2 becomes host');
  check(true, 'tab 2 took over as host after tab 1 closed');
  const errs = pages.flatMap((p) => p.errors);
  if (errs.length) console.log(errs.join('\n'));
  check(errs.length === 0, 'no console errors');
  console.log('\nLOCAL PASSED');
} catch (e) {
  console.error('\nLOCAL FAILED:', e.message);
  for (const p of pages) { try { await p.screenshot({ path: `artifacts/local-fail-${p.label}.png` }); } catch { /* */ } console.log(p.errors.join('\n')); }
  process.exitCode = 1;
} finally { await browser.close(); srv.close(); setTimeout(() => process.exit(), 100); }
