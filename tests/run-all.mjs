// Runs every test file in sequence and reports a summary. usage: node run-all.mjs
import { spawnSync } from 'node:child_process';
const NEW = ['snake', 'lava', 'neon', 'obstacle', 'floorfall', 'prophunt', 'rocketsoccer'];
const runs = [['e2e.mjs', 'coingrab', 'golf', 'downhill', 'arena'], ['memory.mjs', 'coingrab', 'golf', 'downhill', 'arena'], ['migration.mjs', 'coingrab'], ['migration.mjs', 'golf'], ['migration.mjs', 'downhill', { TESTFPS: '1' }], ['migration.mjs', 'arena'],
  // the newer games: one e2e and one migration entry each (clear per-game PASS/FAIL, short runs in software WebGL)
  ...NEW.map((g) => ['e2e.mjs', g]), ['memory.mjs', 'snake', 'lava', 'neon', 'obstacle'], ['memory.mjs', 'floorfall', 'prophunt', 'rocketsoccer'],
  ...NEW.map((g) => ['migration.mjs', g]),
  ['party.mjs'], ['local.mjs'], ['solo.mjs'], ['solo.mjs', 'nopeer'], ['solo.mjs', 'relayonly'], ['emotes.mjs'], ['portal.mjs'], ['upgrade.mjs', 'arena'], ['upgrade.mjs', 'coingrab', 'nopeer'], ['joinpaths.mjs'], ['hostdrop.mjs'], ['e2e.mjs', 'coingrab', 'arena', { EXTRA: '&forcerelay=1' }]];
const results = [];
// Downhill's big terrain is very costly in software WebGL; with three pages sharing one CPU-rendered GPU the
// new host can't finish WebRTC handshakes unless test rendering is capped hard (players with GPUs are unaffected).
for (const r0 of runs) {
  const env = typeof r0[r0.length - 1] === 'object' ? r0[r0.length - 1] : {};
  const r = r0.filter((x) => typeof x === 'string');
  console.log(`\n### ${Object.entries(env).map(([k, v]) => k + '=' + v + ' ').join('')}node ${r.join(' ')}`);
  const p = spawnSync('node', r, { stdio: 'inherit', cwd: import.meta.dirname, timeout: 40 * 60 * 1000, env: { ...process.env, ...env } });
  results.push([r.join(' '), p.status === 0]);
}
console.log('\n=== SUMMARY ===');
for (const [n, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
