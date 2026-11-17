// Screenshots of the pre-round "settings + how to play" screen and the loading screen -> artifacts/setup-<game>.png
import { startStatic, launch, openPage, waitFor, sleep } from './harness.mjs';
const games = process.argv.slice(2).length ? process.argv.slice(2) : ['golf', 'downhill'];
const srv = await startStatic(8080);
const { browser, context } = await launch();
const p = await openPage(await context({ viewport: { width: 1366, height: 768 } }), 'http://127.0.0.1:8080/index.html?net=local&testfps=2', 'A');
await p.click('#soloBtn'); await waitFor(p, () => window.__hub.screen === 'lobby', null, 20000, 'lobby');
for (const g of games) {
  await p.click(`[data-game="${g}"]`); await p.click('#startBtn');
  await waitFor(p, () => window.__hub.screen === 'setup', null, 10000, 'setup'); await sleep(600);
  await p.screenshot({ path: `artifacts/setup-${g}.png` });
  await p.click('#setupReady');
  await waitFor(p, () => window.__hub.screen === 'loading' || window.__hub.state.phase !== 'setup', null, 10000, 'loading'); await sleep(200);
  if (await p.evaluate(() => window.__hub.screen === 'loading')) await p.screenshot({ path: `artifacts/loading-${g}.png` });
  await waitFor(p, () => window.__hub.state.phase === 'playing', null, 60000, 'playing');
  await p.evaluate(() => window.__hub.act({ type: 'endGame' }));
  await waitFor(p, () => window.__hub.screen === 'results', null, 15000, 'results');
  await p.click('#resContinue'); await waitFor(p, () => window.__hub.screen === 'lobby', null, 10000, 'lobby');
}
console.log(p.errors.join('\n') || 'no errors');
await browser.close(); srv.close(); process.exit(0);
