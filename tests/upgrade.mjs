// A player who joined through the backup relay moves to the direct (WebRTC) link by itself once it works,
// without dropping out of the party or the game. usage: node upgrade.mjs [gameId]
import { startStatic, startPeer, startRelay, RELAY, launch, openPage, waitFor, sleep, check, createParty, joinByCode } from './harness.mjs';
import { play } from './drivers.mjs';
const game = process.argv[2] || 'coingrab';
const srv = await startStatic(8080); await startPeer(9000); await startRelay(9002);
const BASE = `http://127.0.0.1:8080/index.html?dev=1&peer=127.0.0.1:9000${RELAY}&testfps=8`;
const { browser, context } = await launch();
const A = await openPage(await context(), BASE, 'A');
const B = await openPage(await context(), BASE + '&forcerelay=join', 'B');
try {
  const code = await createParty(A, 'Host');
  await joinByCode(B, 'Joiner', code);
  check(await B.evaluate(() => window.__hub.net.via) === 'relay', 'joiner starts on the relay');
  await waitFor(A, () => window.__hub.state.players.find((p) => !p.isBot && p.id !== window.__hub.pid)?.via === 'relay', null, 5000, 'host sees relay');
  check(true, 'host lobby tags the joiner "relay"');
  // start a game while still on the relay, so the switch happens mid-round
  await A.evaluate((g) => { window.__hub.act({ type: 'bot+' }); window.__hub.act({ type: 'choose', game: g }); window.__hub.act({ type: 'ready', v: true }); }, game);
  await B.evaluate(() => window.__hub.act({ type: 'ready', v: true }));
  await sleep(300);
  await A.evaluate(() => window.__hub.act({ type: 'start', force: true }));
  for (const p of [A, B]) { await waitFor(p, () => window.__hub.screen === 'setup', null, 15000, 'setup'); await p.click('#setupReady'); }
  await waitFor(B, () => window.__hub.state.phase === 'playing', null, 60000, 'playing');
  const t0 = Date.now();
  await waitFor(B, () => window.__hub.net.via === 'direct', null, 60000, 'joiner upgraded to direct');
  check(true, `joiner moved to the direct link by itself (${Math.round((Date.now() - t0) / 1000)} s into the round)`);
  await waitFor(A, () => window.__hub.state.players.find((p) => !p.isBot && p.id !== window.__hub.pid)?.via === 'direct', null, 10000, 'host sees direct');
  check(true, 'host lobby now shows the joiner as direct');
  const sys = await A.evaluate(() => [...document.querySelectorAll('#chatPanel .sys')].map((d) => d.textContent).join(' | '));
  if (/disconnected|reconnected/.test(sys)) console.log('    chat:', sys);
  check(!/disconnected|reconnected/.test(sys), 'nobody saw a disconnect / reconnect message');
  // the round keeps working over the new link
  await play(B, game, () => B.evaluate(() => window.__hub.screen === 'results'));
  check(true, 'round played to the results screen after the switch');
  const rep = await B.evaluate(() => window.__hub.netReport());
  console.log(rep.split('\n').map((l) => '    | ' + l).join('\n'));
  check(/upgrade: ok/.test(rep) && /path to host: direct/.test(rep), 'connection report shows the upgrade');
  const errs = [...A.errors, ...B.errors].filter((e) => !/WebSocket|ERR_CONNECTION_REFUSED/.test(e));
  if (errs.length) console.log(errs.join('\n'));
  check(errs.length === 0, 'no console errors');
  console.log('UPGRADE PASSED');
} catch (e) { console.log('UPGRADE FAILED', e.message, [...A.errors, ...B.errors].join('\n')); process.exitCode = 1; }
await browser.close(); srv.close(); setTimeout(() => process.exit(), 100);
