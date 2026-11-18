// Joining when the direct link can't connect: the relay must get the player in within a few seconds; and when
// nothing gets through, the player sees a clear message and a "Copy details" button with useful information.
import { startStatic, startPeer, startRelay, RELAY, launch, openPage, waitFor, check, createParty } from './harness.mjs';
const srv = await startStatic(8080); await startPeer(9000); await startRelay(9002);
const { browser, context } = await launch();
const base = `http://127.0.0.1:8080/index.html?dev=1&peer=127.0.0.1:9000&testfps=4`;
async function tryJoin(extraB, wantOk) {
  const cA = await context(), cB = await context();
  await cB.grantPermissions(['clipboard-read', 'clipboard-write']);
  const A = await openPage(cA, base + RELAY, 'A'), B = await openPage(cB, base + extraB, 'B');
  const code = await createParty(A, 'Host');
  await B.fill('#nameIn', 'Joiner'); await B.fill('#codeIn', code);
  const t0 = Date.now(); await B.click('#joinBtn');
  let r;
  if (wantOk) { await waitFor(B, () => window.__hub.screen === 'lobby', null, 30000, 'lobby'); r = { ms: Date.now() - t0, via: await B.evaluate(() => window.__hub.net.via) }; }
  else {
    await waitFor(B, () => !document.getElementById('failReport').classList.contains('hidden'), null, 40000, 'failure + Copy details');
    await B.click('#failReport');
    await waitFor(B, () => document.getElementById('failReport').textContent.includes('Copy details'), null, 15000, 'report copied');
    r = { ms: Date.now() - t0, msg: await B.evaluate(() => document.getElementById('homeMsg').textContent), report: await B.evaluate(() => navigator.clipboard.readText()) };
  }
  await cA.close(); await cB.close();
  return r;
}
try {
  let r = await tryJoin(RELAY, true);
  check(r.via === 'direct', `normal network: joined direct in ${r.ms} ms`);
  r = await tryJoin(RELAY + '&blockdirect=1', true);
  check(r.via === 'relay' && r.ms < 8000, `direct link blocked: joined through the relay in ${r.ms} ms`);
  r = await tryJoin('&relay=ws://127.0.0.1:9002,ws://127.0.0.1:9999', true);
  check(r.ms < 8000, `one relay server down: still joined (${r.via}) in ${r.ms} ms`);
  r = await tryJoin('&relay=ws://127.0.0.1:9999&blockdirect=1', false);
  check(/couldn't connect|Could not/.test(r.msg), `nothing gets through: clear message after ${Math.round(r.ms / 1000)} s`);
  console.log(r.report.split('\n').map((l) => '    | ' + l).join('\n'));
  check(/direct link:/.test(r.report) && /relay:/.test(r.report) && /connection servers from this computer/.test(r.report), 'Copy details gives the direct + relay reasons and the server check');
  console.log('JOINPATHS PASSED');
} catch (e) { console.log('JOINPATHS FAILED', e.message); process.exitCode = 1; }
await browser.close(); srv.close(); setTimeout(() => process.exit(), 100);
