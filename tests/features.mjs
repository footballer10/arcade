// Party features: team mode, rematch, lifetime profile + unlock UI, crowd bar (out players: tomato splat), crown + awards.
import { startStatic, startPeer, startRelay, RELAY, launch, openPage, waitFor, sleep, check, createParty, joinByCode } from './harness.mjs';
const srv = await startStatic(8080); await startPeer(9000); await startRelay(9002);
const { browser, context } = await launch();
const base = `http://127.0.0.1:8080/index.html?dev=1&peer=127.0.0.1:9000${RELAY}&testfps=4`;
const A = await openPage(await context(), base, 'A'), B = await openPage(await context(), base, 'B');
const st = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__hub.state)));
async function playCoinGrab(rematch = false) {
  if (!rematch) {
    await A.evaluate(() => { window.__hub.act({ type: 'mode', mode: 'pick' }); window.__hub.act({ type: 'choose', game: 'coingrab' }); window.__hub.act({ type: 'start', force: true }); });
  } else await A.click('#resRematch');
  for (const p of [A, B]) { await waitFor(p, () => window.__hub.screen === 'setup', null, 15000, 'setup'); await p.click('#setupReady'); }
  await waitFor(B, () => window.__hub.state.phase === 'playing' && window.__hub.runtime?.started, null, 60000, 'playing');
}
try {
  const code = await createParty(A, 'Host'); await joinByCode(B, 'Guest', code);
  for (let i = 0; i < 2; i++) await A.evaluate(() => window.__hub.act({ type: 'bot+' }));
  await A.click('#teamsBtn'); await sleep(500);
  let s = await st(A);
  const teams = s.players.map((p) => p.team), reds = [0, 5, 3, 7];
  check(s.teams && teams.filter((t) => t === 0).length === 2 && teams.filter((t) => t === 1).length === 2, 'teams on: 2 vs 2, humans split first');
  check(s.players.every((p) => (p.team === 0) === reds.includes(p.color)), 'everyone wears their team color');
  check(s.players.find((p) => !p.isBot && p.id !== s.hostId).team !== s.players.find((p) => p.id === s.hostId).team, 'the two humans are on different teams');

  await playCoinGrab();
  // crowd: B is out -> crowd bar; tomato at the host
  await B.evaluate(() => window.__hub.runtime.ctx.setOut(true));
  await waitFor(B, () => !document.getElementById('crowdBar').classList.contains('hidden'), null, 5000, 'crowd bar');
  check(true, 'a knocked-out player gets the crowd bar');
  await B.evaluate((id) => { document.getElementById('crowdTarget').value = id; document.querySelector('[data-crowd=tomato]').click(); }, s.hostId);
  await waitFor(A, () => document.querySelectorAll('#splats .splat').length > 0, null, 5000, 'splat on host');
  check(true, 'tomato splats on the target\'s screen');
  await B.evaluate(() => document.querySelector('[data-crowd=cheer]').click());
  await waitFor(A, () => document.querySelectorAll('#crowdFeed .cf').length > 0, null, 5000, 'cheer shows');
  check(true, 'cheers float up for everyone');
  await A.evaluate(() => window.__hub.runtime.ctx.crowd.chaos([{ id: 'a', label: 'Low gravity' }, { id: 'b', label: 'Big heads' }]));
  check((await st(A)).game.chaos?.length === 2, 'host game can offer chaos events');
  await A.evaluate(() => { window.__chaos = null; window.__hub.runtime.on('chaos', (id) => { window.__chaos = id; }); window.__hub.state.game.nextVote = 0; });
  await waitFor(B, () => !document.getElementById('crowdVote').classList.contains('hidden'), null, 5000, 'vote shows for the crowd');
  await B.evaluate(() => document.querySelector('[data-vote="1"]').click()); await sleep(800);
  const picked = await A.evaluate(() => { const v = window.__hub.state.game.vote; v.until = 0; return v.opts[1].id; });
  await waitFor(A, () => !!window.__chaos, null, 5000, 'chaos delivered to the game');
  check(await A.evaluate(() => window.__chaos) === picked, 'the crowd vote picks a chaos event and the game receives it');

  await A.evaluate(() => window.__hub.act({ type: 'endGame' }));
  await waitFor(A, () => window.__hub.screen === 'results', null, 15000, 'results');
  s = await st(A);
  check(s.results.teamGain && s.teamPts[0] + s.teamPts[1] > 0, `team points added (Red ${s.teamPts[0]} · Blue ${s.teamPts[1]})`);
  const prof = await B.evaluate(() => JSON.parse(localStorage.getItem('partyhub.profile.v1')));
  check(prof && prof.games === 1 && prof.trophies > 0, `guest's lifetime profile recorded the game (${prof?.trophies} trophies)`);
  check(await A.evaluate(() => !document.getElementById('resRematch').classList.contains('hidden')), 'host sees Rematch');

  await playCoinGrab(true);
  check((await st(A)).game.id === 'coingrab', 'rematch started the same game');
  await A.evaluate(() => window.__hub.act({ type: 'endGame' }));
  await waitFor(A, () => window.__hub.screen === 'results', null, 15000, 'results 2');
  await A.evaluate(() => window.__hub.act({ type: 'continue' }));
  await waitFor(A, () => window.__hub.screen === 'lobby', null, 15000, 'lobby');
  check(await A.evaluate(() => !document.getElementById('crownBtn').classList.contains('hidden')), 'Crown the champion offered after 2 games');
  await A.evaluate(() => window.__hub.act({ type: 'crown' }));
  await waitFor(B, () => window.__hub.screen === 'podium', null, 10000, 'podium');
  s = await st(B);
  await sleep(800);
  const awards = await B.evaluate(() => document.querySelectorAll('#podAwards .award').length);
  check(awards >= 1, `podium shows ${awards} party award(s): ${s.podium.awards.map((a) => a.title).join(', ')}`);

  await B.evaluate(() => { document.querySelector('[data-open=profile]')?.click(); });
  const ui = await B.evaluate(() => ({ stats: document.getElementById('profStats').textContent, fx: document.querySelectorAll('#fxPick button').length, dances: document.querySelectorAll('#dancePick button').length, locks: document.querySelectorAll('#hatPick2 button.locked').length }));
  check(/lifetime/.test(ui.stats) && ui.fx === 4 && ui.dances === 5 && ui.locks >= 1, `profile shows stats, ${ui.fx} name styles, ${ui.dances} dances, ${ui.locks} locked hats`);
  const errs = [...A.errors, ...B.errors].filter((e) => !/WebSocket|ERR_CONNECTION_REFUSED/.test(e));
  if (errs.length) console.log(errs.join('\n'));
  check(errs.length === 0, 'no console errors');
  console.log('FEATURES PASSED');
} catch (e) { console.log('FEATURES FAILED', e.message, [...A.errors, ...B.errors].join('\n')); process.exitCode = 1; }
await browser.close(); srv.close(); setTimeout(() => process.exit(), 100);
