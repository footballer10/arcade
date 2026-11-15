import { startStatic, startPeer, launch, openPage, createParty, joinByCode, waitFor, sleep } from './harness.mjs';
const q = process.argv[2] || 'high';
const BASE = 'http://127.0.0.1:8080/index.html?peer=127.0.0.1:9000';
const srv = await startStatic(8080); await startPeer(9000);
const { browser, context } = await launch();
const pages = [];
for (const n of ['A', 'B', 'C']) { const c = await context(); await c.addInitScript((qq) => { localStorage.setItem('partyhub.settings.v1', JSON.stringify({ quality: qq })); }, q); pages.push(await openPage(c, BASE, n)); }
const code = await createParty(pages[0], 'A'); await joinByCode(pages[1], 'B', code); await joinByCode(pages[2], 'C', code);
await pages[0].click('[data-game="golf"]'); await pages[0].click('#forceStart'); await sleep(500);
for (const p of pages) await p.click('#setupReady');
for (const p of pages) await waitFor(p, () => window.__hub.state.phase === 'playing', null, 60000, 'playing');
for (const p of pages) await p.evaluate(() => { window.__gaps = []; let last = performance.now(); setInterval(() => { const n = performance.now(); window.__gaps.push(n - last); last = n; }, 200); let f = 0; window.__f = () => f; (function l() { f++; requestAnimationFrame(l); })(); });
await sleep(15000);
for (const p of pages) console.log(p.label, q, await p.evaluate(() => ({ fps: (window.__f() / 15).toFixed(1), maxGap: Math.max(...window.__gaps).toFixed(0), host: window.__hub.state.hostId === window.__hub.pid })));
await browser.close(); srv.close(); process.exit(0);
