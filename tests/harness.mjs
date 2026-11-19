// Test harness: serves the repo, runs a local PeerJS server, launches Chromium and routes the CDN
// (three.js / peerjs / Google Fonts) to local copies so tests work offline and fast.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
const NM = path.join(here, 'node_modules');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.md': 'text/plain' };

export function startStatic(port = 8080) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/arcade-prototypes/')) p = p.slice('/arcade-prototypes'.length);
    let f = path.join(ROOT, p);
    if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}

export async function startPeer(port = 9000) {
  const { PeerServer } = await import('peer');
  return new Promise((r) => { const s = PeerServer({ port, host: '127.0.0.1', path: '/' }, () => r(s)); });
}

async function peerBundle() {
  const out = path.join(here, '.cache', 'peerjs.esm.js');
  if (!fs.existsSync(out)) {
    const esbuild = await import('esbuild');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await esbuild.build({ entryPoints: [path.join(NM, 'peerjs/dist/bundler.mjs')], bundle: true, format: 'esm', outfile: out, minify: true, logLevel: 'error' });
  }
  return fs.readFileSync(out);
}

// Local MQTT broker over WebSocket (ws://127.0.0.1:<port>) for the relay transport (?relay=ws://127.0.0.1:9002).
export async function startRelay(port = 9002) {
  const { createBroker } = require('aedes');
  const { createServer } = require('aedes-server-factory');
  const broker = createBroker();
  const server = createServer(broker, { ws: true });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { close: () => { server.close(); broker.close(); } };
}
export const RELAY = '&relay=ws://127.0.0.1:9002';

export async function launch({ headless = true, realChrome = false } = {}) {
  // realChrome: keep Chrome's normal WebRTC privacy (local addresses hidden behind random .local names)
  const browser = await chromium.launch({ headless, args: [...(realChrome ? [] : ['--disable-features=WebRtcHideLocalIpsWithMdns']), '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'] });
  const peerjs = await peerBundle();
  // Tests run several 3D pages on one machine with software WebGL, so by default they use a smaller window and
  // the Low graphics setting (pass {full:true} for screenshots). Real players each have their own GPU.
  async function context({ full = false, viewport = null } = {}) {
    if (viewport) full = true;
    const ctx = await browser.newContext({ viewport: viewport || (full ? { width: 1366, height: 800 } : { width: 640, height: 400 }) });
    if (!full) await ctx.addInitScript(() => { try { const k = 'partyhub.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); if (!s.quality) localStorage.setItem(k, JSON.stringify({ ...s, quality: 'low', qv: 2 })); } catch { /* */ } });
    await ctx.route('https://cdn.jsdelivr.net/**', (route) => {
      const u = new URL(route.request().url());
      const m = u.pathname.match(/^\/npm\/three@0\.160\.0\/(.*)$/);
      if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, 'three', m[1])) });
      if (u.pathname.startsWith('/npm/peerjs@')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: peerjs });
      return route.fulfill({ status: 404, body: '' });
    });
    await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ status: 404, body: '' }));
    return ctx;
  }
  return { browser, context };
}

// Opens a hub page and collects console errors / page errors.
export async function openPage(ctx, url, name) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'info' && m.text().startsWith('[net]')) console.log('    ' + name + ' ' + m.text()); if (m.type() === 'error') page.errors.push(`[${name}] console: ${m.text()}`); });
  page.on('pageerror', (e) => page.errors.push(`[${name}] pageerror: ${e.message}`));
  page.label = name;
  await page.goto(url);
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(page, fn, arg, timeout = 30000, what = 'condition') {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 200 }); } catch (e) { throw new Error(`[${page.label}] timed out waiting for ${what}`); }
}
export const state = (page) => page.evaluate(() => { const s = window.__hub.state; return s && JSON.parse(JSON.stringify(s)); });
export const hub = (page, expr) => page.evaluate(expr);

export async function createParty(page, name) {
  await page.fill('#nameIn', name);
  await page.click('#createBtn');
  await waitFor(page, () => window.__hub.screen === 'lobby', null, 20000, 'lobby');
  return page.evaluate(() => window.__hub.state.code);
}
export async function joinByCode(page, name, code) {
  await page.fill('#nameIn', name);
  await page.fill('#codeIn', code);
  await page.click('#joinBtn');
  await waitFor(page, () => window.__hub.screen === 'lobby', null, 20000, 'lobby after join');
}
export async function joinByLink(page, name) {
  await page.fill('#nameIn', name);
  await page.click('#joinLinkBtn');
  await waitFor(page, () => window.__hub.screen === 'lobby', null, 20000, 'lobby after link join');
}
// Press/hold keys for a while to move around.
export async function wiggle(page, ms = 1500) {
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const k = keys[Math.floor(Math.random() * 4)];
    await page.keyboard.down(k); await sleep(150 + Math.random() * 250); await page.keyboard.up(k);
    if (Math.random() < 0.3) await page.keyboard.press('ShiftLeft');
  }
}
export async function heap(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  return usedSize;
}
export function check(cond, msg) { if (!cond) throw new Error('CHECK FAILED: ' + msg); console.log('  ✔ ' + msg); }
