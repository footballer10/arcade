import { startStatic, startPeer, launch, openPage, createParty, sleep } from './harness.mjs';
const srv = await startStatic(8080); const ps = await startPeer(9000);
const { browser, context } = await launch();
const ctx = await context();
const p = await openPage(ctx, 'http://127.0.0.1:8080/index.html?peer=127.0.0.1:9000', 'A');
await sleep(1500);
console.log('screen', await p.evaluate(() => window.__hub?.screen));
try { const code = await createParty(p, 'Alice'); console.log('code', code); } catch (e) { console.log('ERR', e.message); }
await sleep(1000);
await p.screenshot({ path: 'artifacts/smoke-lobby.png' });
console.log(p.errors.join('\n'));
await browser.close(); srv.close(); process.exit(0);
