// Developer tuning portal (tools/portal.py + core/portal.js): every game's tuning file loads with its defaults,
// sliders change values live, next-round values wait, Download / Save write a correct tuning.js, and on any host
// other than localhost the portal and saved overrides do nothing.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, startPeer, startRelay, RELAY, launch, openPage, waitFor, sleep, check } from './harness.mjs';

const PORT = 8091;
await startPeer(9000); await startRelay(9002);
const py = spawn('python3', ['-u', path.join(ROOT, 'tools/portal.py'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, BROWSER: 'true' } });
await new Promise((r) => py.stdout.once('data', r));
const TFILE = path.join(ROOT, 'games/_template/tuning.js');
const original = fs.readFileSync(TFILE, 'utf8');
const { browser, context } = await launch();
const ctx = await context({ full: true });
const A = await openPage(ctx, `http://localhost:${PORT}/?portal=1&peer=127.0.0.1:9000${RELAY}&testfps=4`, 'A');
const rules = () => A.evaluate(() => import('/games/_template/tuning.js').then((m) => ({ ...m.RULES })));
try {
  await waitFor(A, () => !!document.querySelector('#devPortal .dp-item, #devPortal .dp-empty:not(:empty)'), null, 20000, 'portal panel');
  check(true, 'portal panel shows on localhost');
  await waitFor(A, () => !!document.querySelector('#devPortal [data-a=save]'), null, 5000, 'save button (portal.py detected)');
  check(true, 'portal.py detected: "Save as defaults" offered');

  // Every game: tuning file loads, sliders appear, current values are the defaults (no overrides yet).
  const ids = await A.evaluate(() => [...document.querySelectorAll('#dpGame option')].map((o) => o.value));
  check(ids.length >= 11, `game list has ${ids.length} games`);
  for (const id of ids) {
    await A.selectOption('#dpGame', id);
    await waitFor(A, (g) => document.querySelector('#dpGame').value === g && document.querySelectorAll('#dpList .dp-item').length > 0, id, 15000, `${id} sliders`);
    const r = await A.evaluate(async (g) => {
      const t = await import('/core/tune.js'); const e = t.tuningOf(g);
      const bad = [...e.items.values()].filter((it) => it.target[it.prop] !== it.value && it.live !== false).map((it) => it.name);
      return { n: e.items.size, rows: document.querySelectorAll('#dpList .dp-item').length, bad, marks: document.querySelectorAll('#dpList .dp-mark').length, drift: t.drift(g) };
    }, id);
    check(r.n > 0 && r.rows === r.n && r.marks === r.n && !r.bad.length, `${id}: ${r.n} tunables, each with a default mark, values = defaults`);
    check(!r.drift.length, `${id}: tuning.js matches the game's code` + (r.drift.length ? ` — DRIFT ${r.drift.map((d) => `${d.name}: tuning.js ${d.tuning} vs code ${d.code}`).join(', ')}. tuning.js wins at runtime, so put the value you want in BOTH files (or only tuning.js)` : ''));
  }
  // Every tuning.js default matches what its game was using before (each file's value is written into the target).
  // Change a live value and a next-round value on Coin Grab.
  await A.selectOption('#dpGame', 'coingrab');
  await waitFor(A, () => !!document.querySelector('#dpList [data-k=SPEED]'), null, 5000, 'coingrab rows');
  const setNum = async (k, v) => { await A.fill(`#dpList [data-k=${k}] input[type=number]`, String(v)); await A.press(`#dpList [data-k=${k}] input[type=number]`, 'Enter'); await A.evaluate(() => document.activeElement?.blur()); };
  await setNum('SPEED', 12); await setNum('ROUND', 30);
  let R = await rules();
  check(R.SPEED === 12 && R.ROUND === 45, 'live value applies at once; next-round value waits');
  check(await A.evaluate(() => document.querySelector('#dpList [data-k=SPEED]').classList.contains('changed')), 'changed value is highlighted');
  check(/2 changed/.test(await A.evaluate(() => document.querySelector('#dpGame option[value=coingrab]').textContent)), 'game list counts changed values');

  // Play from the portal: solo party with bots, straight into the game.
  await A.click('#devPortal [data-a=play]');
  await waitFor(A, () => window.__hub.state?.phase === 'playing' && window.__hub.runtime?.manifest.id === 'coingrab', null, 60000, 'playing coingrab');
  R = await rules();
  check(R.ROUND === 30 && R.SPEED === 12, 'round started with the tuned values');
  await setNum('SPEED', 9);
  check((await rules()).SPEED === 9, 'slider change while playing is live');
  // Slider drag path too
  await A.evaluate(() => { const r = document.querySelector('#dpList [data-k=JUMP] input[type=range]'); r.value = 10; r.dispatchEvent(new Event('input')); });
  check((await rules()).JUMP === 10, 'range slider changes the value');
  await A.click('#devPortal [data-a=restart]');
  await waitFor(A, () => window.__hub.state?.phase === 'playing' && window.__hub.runtime?.started, null, 60000, 'restarted round');
  check(true, 'restart round works');

  // Download: a tuning.js with the new values as defaults.
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('#devPortal [data-a=download]')]);
  const text = fs.readFileSync(await dl.path(), 'utf8');
  check(/SPEED: \{ value: 9,/.test(text) && /ROUND: \{ value: 30,/.test(text) && /JUMP:  \{ value: 10,/.test(text) && /GRAV:  \{ value: 22,/.test(text), 'downloaded tuning.js has the tuned values and keeps the rest');

  // Save as defaults: writes the file, the marks move, nothing is "changed" any more.
  await A.click('#devPortal [data-a=save]');
  await waitFor(A, () => !document.querySelector('#dpList .dp-item.changed'), null, 8000, 'saved');
  const saved = fs.readFileSync(TFILE, 'utf8');
  check(/SPEED: \{ value: 9,/.test(saved) && saved.replace(/value: [0-9.]+/g, '') === original.replace(/value: [0-9.]+/g, ''), 'Save wrote games/_template/tuning.js (only the numbers changed)');
  const def = await A.evaluate(() => document.querySelector('#dpList [data-k=SPEED] .dp-def').textContent);
  check(/default 9/.test(def), 'default mark moved to the saved value');
  check(await A.evaluate(() => localStorage.getItem('partyhub.tune.coingrab')) === '{}', 'overrides cleared after saving');

  // Per-item reset
  await setNum('GRAV', 30);
  await A.click('#dpList [data-k=GRAV] .dp-reset');
  check((await rules()).GRAV === 22, 'reset button restores the default');
  const errs = A.errors.filter((e) => !/WebSocket|ERR_CONNECTION_REFUSED/.test(e));
  if (errs.length) console.log(errs.join('\n'));
  check(errs.length === 0, 'no console errors');

  // Any other host: no portal, saved overrides ignored.
  const ctx2 = await context({ full: true });
  await ctx2.route('http://arcade.test/**', (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname);
    const f = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    const ext = path.extname(f);
    route.fulfill({ status: 200, path: f, contentType: ext === '.js' ? 'text/javascript' : ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream' });
  });
  await ctx2.addInitScript(() => localStorage.setItem('partyhub.tune.coingrab', JSON.stringify({ SPEED: 20 })));
  const B = await openPage(ctx2, 'http://arcade.test/?portal=1&dev=1&peer=127.0.0.1:9000', 'B');
  await waitFor(B, () => !!window.__hub, null, 15000, 'hub on the other host');
  await sleep(1500);
  check(await B.evaluate(() => !document.querySelector('#devPortal')), 'no portal on a non-localhost address');
  const rb = await B.evaluate(() => import('/games/_template/tuning.js').then((m) => m.RULES.SPEED));
  check(rb === 9, 'saved browser overrides are ignored on a non-localhost address (file defaults used)');
  console.log('PORTAL PASSED');
} catch (e) { console.log('PORTAL FAILED', e.message, A.errors.join('\n')); process.exitCode = 1; }
fs.writeFileSync(TFILE, original);   // the test's Save wrote the template's tuning file: put it back
await browser.close(); py.kill(); setTimeout(() => process.exit(), 100);
