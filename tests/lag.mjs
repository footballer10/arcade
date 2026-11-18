// How a game feels for a player who joined, with and without relay-like lag (?netsim). Records, every frame on the
// joiner's screen, where their own character and everyone else are drawn, and counts "glitches": frames where the
// sideways speed changes by more than a character can (rubber-banding, teleports, freezing then jumping).
// usage: node lag.mjs [gameIds...]     env SECS=20 (seconds measured), NETSIM=100,30,250,4
import { startStatic, startPeer, startRelay, RELAY, launch, openPage, waitFor, sleep, createParty, joinByCode } from './harness.mjs';

const GAMES = process.argv.slice(2).length ? process.argv.slice(2) : ['lava', 'rocketsoccer', 'obstacle', 'floorfall', 'prophunt', 'coingrab'];
const SECS = +(process.env.SECS || 20), NETSIM = process.env.NETSIM || '100,30,250,4';
const AUTOPILOT = { lava: '__lava', obstacle: '__obstacle', rocketsoccer: '__rs', neon: '__neon', downhill: '__dh' };
const srv = await startStatic(8080); await startPeer(9000); await startRelay(9002);
const { browser, context } = await launch();

async function run(game, lag) {
  const extra = lag ? `&netsim=${NETSIM}&forcerelay=1` : '';
  const base = `http://127.0.0.1:8080/index.html?dev=1&peer=127.0.0.1:9000${RELAY}&testfps=30${extra}`;
  const cA = await context(), cB = await context();
  const A = await openPage(cA, base.replace('testfps=30', 'testfps=2'), 'A'), B = await openPage(cB, base, 'B');   // host barely renders: its sim still runs at 60 Hz
  try {
    const code = await createParty(A, 'Host');
    await joinByCode(B, 'Joiner', code);
    await A.evaluate((g) => { window.__hub.act({ type: 'bot+' }); window.__hub.act({ type: 'bot+' }); window.__hub.act({ type: 'choose', game: g }); window.__hub.act({ type: 'ready', v: true }); }, game);
    await B.evaluate(() => window.__hub.act({ type: 'ready', v: true }));
    await sleep(300);
    await A.evaluate(() => window.__hub.act({ type: 'start', force: true }));
    for (const p of [A, B]) { await waitFor(p, () => window.__hub.screen === 'setup', null, 15000, 'setup'); await p.click('#setupReady'); }
    await waitFor(B, () => window.__hub.state.phase === 'playing' && window.__hub.runtime?.started, null, 90000, 'playing');
    await sleep(2500);
    // sample positions every frame
    await B.evaluate(() => {
      const rt = window.__hub.runtime, me = window.__hub.pid; const tracks = window.__tracks = new Map();
      let last = performance.now();
      (function loop(now) {
        if (!window.__tracks) return;
        requestAnimationFrame(loop);
        const dt = (now - last) / 1000; last = now; if (dt <= 0) return;
        for (const [id, o] of rt.avatars) {
          o.updateWorldMatrix(true, false);
          const e = o.matrixWorld.elements, x = e[12], z = e[14];
          let t = tracks.get(id); if (!t) tracks.set(id, (t = { me: id === me, n: 0, glitch: 0, px: null, pz: null, vx: 0, vz: 0, dist: 0 }));
          if (t.px !== null) {
            const vx = (x - t.px) / dt, vz = (z - t.pz) / dt;
            if (t.n > 0 && Math.hypot(vx - t.vx, vz - t.vz) > 12 && dt < 0.12) t.glitch++;
            t.vx = vx; t.vz = vz; t.n++; t.dist += Math.hypot(x - t.px, z - t.pz);
          }
          t.px = x; t.pz = z;
        }
      })(performance.now());
    });
    const ap = AUTOPILOT[game];
    const end = Date.now() + SECS * 1000;
    while (Date.now() < end && await B.evaluate(() => window.__hub.state?.phase === 'playing')) {
      if (ap) await B.evaluate((k) => { if (window[k]) window[k].autopilot = true; }, ap).catch(() => {});
      else {
        const k = ['KeyW', 'KeyA', 'KeyS', 'KeyD'][Math.floor(Math.random() * 4)];
        await B.keyboard.down(k); await sleep(250 + Math.random() * 300); await B.keyboard.up(k);
        if (Math.random() < 0.3) await B.keyboard.press('Space');
        continue;
      }
      await sleep(500);
    }
    const r = await B.evaluate((secs) => {
      const out = { own: null, others: [] };
      for (const t of window.__tracks.values()) {
        const v = { frames: t.n, glitchPerSec: +(t.glitch / secs).toFixed(2), moved: +t.dist.toFixed(1) };
        if (t.me) out.own = v; else out.others.push(v);
      }
      window.__tracks = null;
      return out;
    }, SECS);
    const ping = await B.evaluate(() => Math.round(window.__hub.net.rtt || 0));
    const oth = r.others.filter((o) => o.moved > 1);
    const avg = oth.length ? +(oth.reduce((a, o) => a + o.glitchPerSec, 0) / oth.length).toFixed(2) : null;
    return { ping, ownGlitch: r.own?.glitchPerSec ?? null, ownMoved: r.own?.moved ?? null, othersGlitch: avg, frames: r.own?.frames ?? r.others[0]?.frames, errors: [...A.errors, ...B.errors].filter((e) => !/WebSocket|ERR_CONNECTION_REFUSED/.test(e)).length };
  } finally { await cA.close(); await cB.close(); }
}

console.log(`lag = ?netsim=${NETSIM} over the relay; ${SECS}s measured on the joiner. glitches/sec (lower is better)`);
for (const g of GAMES) {
  for (const lag of [false, true]) {
    try {
      const r = await run(g, lag);
      console.log(`${g.padEnd(13)} ${lag ? 'LAG   ' : 'no lag'}  ping ${String(r.ping).padStart(4)} ms  own ${String(r.ownGlitch).padStart(5)}/s (moved ${r.ownMoved})  others ${String(r.othersGlitch).padStart(5)}/s  frames ${r.frames}  errors ${r.errors}`);
    } catch (e) { console.log(`${g.padEnd(13)} ${lag ? 'LAG   ' : 'no lag'}  FAILED ${e.message}`); }
  }
}
await browser.close(); srv.close(); setTimeout(() => process.exit(), 100);
