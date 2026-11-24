# Party Arcade — guide for Claude Code sessions

Free, static, browser party-game hub (Jackbox / Fall Guys style) on GitHub Pages: `https://footballer10.github.io/arcade/`.
Friends join one party and stay connected while the host switches between 3D games. Laptop, Chrome, keyboard + mouse.

## Work efficiently (usage matters)
- Read this file and the files you change. Don't explore the whole repo; `docs/ARCHITECTURE.md` only if you change `/core` or netcode.
- One game per chat: only edit `games/<id>/`. Change `/core` only when the task is about the hub/core.
- Test only what you changed: a game → `cd tests && node e2e.mjs <id>` (+ `memory.mjs <id>` if you touched
  loading/cleanup, `lag.mjs <id>` if you touched netcode). GitHub runs every test on each push to main (Actions tab), so
  don't run the full suite yourself. `npm install` in `tests/` once if `node_modules` is missing.
- No screenshots unless the change is visual; no extra report / notes files; short replies.
- When done: commit, `git fetch origin main && git merge origin/main`, push to main.

## Hard rules
- 100% free, static files. Three.js `0.160.0` and PeerJS `1.5.4` from jsDelivr (import map in `index.html`); public PeerJS
  server; free MQTT brokers for the relay; the owner-approved Metered TURN logins in `core/turn-config.js`. No build step,
  no paid services, no player accounts.
- Relative paths only (site lives under `/arcade/`); games import core as `../../core/x.js`.
- Games talk only through `ctx`; never reload the page or touch the party connection.
- Lag: players may be on a ~200 ms relay. Predict your own player; draw others with `core/interp.js` on the host's clock
  (see `docs/ARCHITECTURE.md`). Snapshots ≈20 Hz, compact.
- `/core` changes must keep every game in `games/registry.js` working.

## Game plug-in contract
`games/<id>/index.js` exports `manifest` (from `manifest.js`, which imports nothing) and `async start(ctx) → { stop(), standings?() }`.
```js
manifest = { id, dir?, name, tagline, minPlayers, maxPlayers, teams: false|2, supportsBots, roundLengthSec,
  howTo: ['goal', 'how to win', 'key tip'],        // 2–4 short sentences for first-time players (pre-round screen)
  controlsHelp: [[keys, action]], thumbnail: 'games/<id>/thumb.svg',
  picks: [{ key, label, default, choices: [{ value, label, desc? }] }],   // each player chooses
  options: [{ key, label, default, choices }] }                          // host chooses
```
| ctx | |
|---|---|
| `container`, `players` `[{id,name,color,colorHex,colorCss,hat,isBot}]`, `player(id)`, `connected(id)` | |
| `myId`, `isHost`, `hostId`, `spectator`, `started`, `seed`, `rng(salt)`, `options`, `picks[id]` | build levels from `rng()` |
| `net` | `toHost(msg)`, host `toAll(msg)`, `to(id,msg)`; binary `rawToHost/rawToAll/rawTo`; `onMessage`, `onRaw`, `ping()`, `now()` (host clock) |
| `input` | `axis()`, `down(a)`, `presses(a)`, `key(code)`, `mouse`, `on('press'…)`, `lockPointer()` |
| `ui` | `status`, `timer`, `mini`, `abilities`, `bar`, `toast`, `banner`, `setScoreboard(fn)`, `el`, `esc` |
| `audio`, `settings`, `quality()`, `music(style).start()` | sound buses; graphics preset; in-game music (`core/music.js` styles) |
| `avatar.build(p)`, `avatar.hat(kind,color)`, `three.createRenderer()`, `three.dispose(obj)` | |
| `bots.level` `{key, tier, rank, reaction, aimError, skill, mistakes}` | tiers easy/normal/hard/extreme (rank 0–3); extreme reports `key:'hard'` |
| `teams` `{on, of(id), mates(id), names, colors}` | team mode (Red 0 / Blue 1) when the host turns it on: no friendly fire, team wins |
| `setOut(bool)` | call when YOUR player is knocked out / back in: gives them the crowd bar (cheers, tomatoes) |
| `crowd.chaos([{id,label}])` | host: offer chaos events; knocked-out players vote; winner arrives as `on('chaos', id)` |
| `frame(fn)`, `tick(fn)` (60 Hz, runs in background tabs), `setTimeout`, `setInterval`, `listen`, `onCleanup` | auto-cleared on stop |
| `on(event)` | `'go'` (start now), `'hostchange'`, `'join'`, `'leave'`, `'rejoin'`, `'resize'`, `'settings'`, `'chaos'` |
| `endGame(placements, {stats, note, title})` | host only; ids best→worst, ties as arrays `[[a,b],c]` |

**Relay trap:** `toAll(msg)` also reaches the host's own `onMessage`. Never re-broadcast under the type you're handling
(client `{t:'emote'}` → host relays `{t:'emoted'}`), or the host loops forever.

**Tuning:** feel constants live in `games/<id>/tuning.js` (imported first by `index.js`) and override the code; change them
there (keep the same number in the code file). `node portal.mjs` fails on a mismatch. Portal: `python3 tools/portal.py`.

## Controls (`core/input.js`)
WASD/arrows move · mouse aim/look · left/right click `primary`/`secondary` · Space `jump` · Shift `boost` (only if the game
has one) · E `use` · Q `special` · Tab scoreboard, Esc pause, Enter chat are **hub only**. Use only the actions your game
needs; list every key in `controlsHelp`.

## UI and style
- HUD only in the four zones: `ui.status` (top-left), `ui.timer` (top-center), `ui.mini` (top-right), `ui.abilities`/`ui.bar`
  (bottom-center); plus `toast`/`banner`. Never build your own menu, lobby, results or settings screen.
- Bright cartoon look, toon shading, ink outlines; font `var(--font)` (Lilita One, bundled); palette in `core/ui.css` +
  `core/palette.js`; building blocks `.ph-panel` `.ph-head` `.ph-well` `.ph-btn` `.count-pill`.
- Players keep their party color; show `ctx.avatar.build(p)` or at least their hat. Respect `ctx.quality()` (low = no
  shadows, pixel ratio 1, no post-processing).
- Cleanup: renderer via `ctx.three.createRenderer()`; loops/timers/listeners via ctx; `stop()` disposes everything you made.
  `node memory.mjs <id>` must return to zero.

## New game
Copy `games/_template` (Coin Grab, hidden unless `?dev=1`) and follow `docs/ADDING_A_GAME.md`.
