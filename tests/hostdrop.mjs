// A host waiting in the lobby gets dropped by the connection servers (server restart, Wi-Fi blip, laptop asleep,
// background tab). The host must reconnect by itself and friends must be able to join again, on both routes.
import { spawn } from 'node:child_process';
import { startStatic, startRelay, RELAY, launch, openPage, waitFor, sleep, check, createParty } from './harness.mjs';

const peerServer = () => spawn(process.execPath, ['-e', "require('peer').PeerServer({ port: 9000, host: '127.0.0.1', path: '/' })"], { cwd: import.meta.dirname, stdio: 'ignore' });
const srv = await startStatic(8080);
let peer = peerServer(); let relay = await startRelay(9002);
await sleep(1500);
const { browser, context } = await launch();
const base = `http://127.0.0.1:8080/index.html?dev=1&peer=127.0.0.1:9000${RELAY}&testfps=4`;
const A = await openPage(await context(), base, 'A');
const reach = () => A.evaluate(() => window.__hub.net.t.reachable());
async function join(name, extra) {
  const c = await context(); const P = await openPage(c, base + extra, name);
  await P.fill('#nameIn', name); await P.fill('#codeIn', code); const t0 = Date.now(); await P.click('#joinBtn');
  await waitFor(P, () => window.__hub.screen === 'lobby', null, 30000, name + ' lobby');
  const r = { ms: Date.now() - t0, via: await P.evaluate(() => window.__hub.net.via) };
  await c.close(); return r;
}
let code;
try {
  code = await createParty(A, 'Host');
  let r = await reach();
  check(r.direct && r.relay >= 1, `host reachable on both routes (direct ${r.direct}, relay servers ${r.relay})`);
  check(/Friends can join/.test(await A.evaluate(() => document.getElementById('netBadge').textContent)), 'lobby badge says friends can join');

  // 1) the direct-link (PeerJS) server goes away and comes back
  peer.kill(); await sleep(4000);
  peer = peerServer();
  await waitFor(A, () => window.__hub.net.t.reachable().direct, null, 40000, 'party code re-registered on the direct-link server');
  check(true, 'direct-link server restarted: host re-registered the party code by itself');
  r = await join('B', '');
  check(r.via === 'direct', `a friend joins directly again (${r.ms} ms)`);

  // 2) the relay server goes away and comes back
  relay.close(); await sleep(3000);
  r = await reach(); check(r.relay === 0, 'relay server gone: host notices');
  relay = await startRelay(9002);
  await waitFor(A, () => window.__hub.net.t.reachable().relay >= 1, null, 30000, 'relay reconnected');
  check(true, 'relay server back: host reconnected by itself');
  r = await join('C', '&blockdirect=1');
  check(r.via === 'relay', `a friend whose direct link is blocked joins through the relay again (${r.ms} ms)`);
  const errs = A.errors.filter((e) => !/WebSocket|ERR_CONNECTION_REFUSED|Lost connection|server/i.test(e));
  if (errs.length) console.log(errs.join('\n'));
  check(errs.length === 0, 'no unexpected console errors on the host');
  console.log('HOSTDROP PASSED');
} catch (e) { console.log('HOSTDROP FAILED', e.message, A.errors.slice(0, 6).join('\n')); process.exitCode = 1; }
await browser.close(); peer.kill(); relay.close(); srv.close(); setTimeout(() => process.exit(), 100);
