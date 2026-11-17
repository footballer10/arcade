// Screenshots of the home screen and a full lobby at laptop and desktop sizes -> artifacts/look-*.png
import { startStatic, launch, openPage, waitFor, sleep } from './harness.mjs';
const srv = await startStatic(8080);
const { browser, context } = await launch();
for (const [w, h] of [[1366, 768], [1920, 1080]]) {
  const ctx = await context({ viewport: { width: w, height: h } });
  const p = await openPage(ctx, 'http://127.0.0.1:8080/index.html?net=local', 'A');
  await sleep(1200);
  if (w === 1366) await p.screenshot({ path: 'artifacts/look-home.png' });
  await p.click('#soloBtn');
  await waitFor(p, () => window.__hub.screen === 'lobby', null, 20000, 'lobby');
  for (let i = 0; i < 4; i++) await p.evaluate(() => window.__hub.act({ type: 'bot+' }));
  await sleep(1800);
  await p.screenshot({ path: `artifacts/look-lobby-${w}.png` });
  console.log(w, p.errors.join('\n') || 'no errors');
  await ctx.close();
}
await browser.close(); srv.close(); process.exit(0);
