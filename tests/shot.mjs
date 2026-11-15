// Screenshot helper: node shot.mjs <gameId> [seconds-into-game]  -> artifacts/shot-<game>.png (+ lobby/results shots)
import { startStatic, startPeer, launch, openPage, createParty, joinByCode, waitFor, sleep, wiggle } from './harness.mjs';
const game = process.argv[2] || 'coingrab', secs = +(process.argv[3] || 5);
const BASE = 'http://127.0.0.1:8080/index.html?dev=1&peer=127.0.0.1:9000&testfps=' + (process.env.TESTFPS || 10) + (process.env.NETLOG ? '&netlog=1' : '');
const srv = await startStatic(8080); await startPeer(9000);
const { browser, context } = await launch();
const A = await openPage(await context({ full: true }), BASE, 'A');
const code = await createParty(A, 'Alice');
const B = await openPage(await context({ full: true }), BASE, 'B');
await joinByCode(B, 'Bob', code);
await A.click('#addBot'); await A.click('#addBot');
await A.click(`[data-game="${game}"]`); await sleep(300);
await A.screenshot({ path: `artifacts/shot-lobby.png` });
await A.click('#forceStart');
await sleep(500);
if (await A.evaluate(() => window.__hub.state.phase === 'setup')) { await B.screenshot({ path: `artifacts/shot-setup-${game}.png` }); for (const p of [A, B]) await p.click('#setupReady'); }
await sleep(400); await B.screenshot({ path: `artifacts/shot-loading-${game}.png` });
for (const p of [A, B]) await waitFor(p, () => window.__hub.state.phase === 'playing', null, 40000, 'playing');
await Promise.all([wiggle(B, secs * 1000), A.evaluate(() => { if (window.__dh) window.__dh.autopilot = true; })]);
await B.screenshot({ path: `artifacts/shot-${game}.png` });
await B.keyboard.down('Tab'); await sleep(300); await B.screenshot({ path: `artifacts/shot-tab-${game}.png` }); await B.keyboard.up('Tab');
await A.evaluate(() => window.__hub.act({ type: 'endGame' }));
await waitFor(B, () => window.__hub.screen === 'results', null, 10000, 'results'); await sleep(800);
await B.screenshot({ path: `artifacts/shot-results-${game}.png` });
console.log([...A.errors, ...B.errors].join('\n') || 'no errors');
await browser.close(); srv.close(); process.exit(0);
