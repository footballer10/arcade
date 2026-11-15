import { startStatic, launch, openPage, sleep } from './harness.mjs';
const srv = await startStatic(8080);
const { browser, context } = await launch();
const p = await openPage(await context({ full: true }), 'http://127.0.0.1:8080/index.html?room=ABCD', 'A');
await sleep(1500); await p.screenshot({ path: 'artifacts/home.png' });
console.log(p.errors.join('\n') || 'no errors');
await browser.close(); srv.close(); process.exit(0);
