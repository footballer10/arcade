# Party Arcade — guide for Claude Code sessions

A free, static, browser **party game hub** (think Jackbox / Fall Guys): friends join one party and stay
connected while the host switches between 3D games. Hosted on GitHub Pages at
`https://footballer10.github.io/arcade-prototypes/`. Laptop first, Chrome, keyboard + mouse.

**Every new game must use `/core` and must pass the checklist in [`docs/ADDING_A_GAME.md`](docs/ADDING_A_GAME.md).**
Start from `games/_template` (Coin Grab). That template is **hidden from players**: it only appears in the lobby with `?dev=1` (used by developers and the tests). One game per session.

## Hard rules
- 100% free: static files on GitHub Pages; Three.js `0.160.0` and PeerJS `1.5.4` from jsDelivr via the import map in `index.html`; the public PeerJS server. No build step, no npm to play, no paid services, no API keys, no accounts.
- **Relative paths only** (the site lives under `/arcade-prototypes/`). Import other core files as `../../core/x.js` from a game.
- Never reload the page or touch the party connection from a game. Games talk only through `ctx`.
- Don't edit another game's folder while working on yours. Changes to `/core` must stay backward compatible with every game in `games/registry.js`, and must be re-tested with `tests/` (all games).

## Architecture
```
index.html          the hub page (the only HTML page). Import map + #stage (game) + #hud (zones) + hub screens
core/hub.js         party loop: home → lobby → (host pick | vote | shuffle) → pre-round picks → loading barrier
                    → shared countdown → play → results (+trophies) → lobby / next shuffle game → podium
core/net.js         PartyNet: party connection behind a transport interface; host-authoritative star; 4-letter
                    room codes + ?room=CODE links; heartbeats + host clock sync; host migration; handover;
                    rejoin after refresh / Wi-Fi drop; per-round game channels (makeChannel → ctx.net)
core/transport-peer.js   PeerJS/WebRTC transport (reliable JSON 'ctrl' + unreliable binary 'fast' channel)
core/transport-local.js  BroadcastChannel transport: tabs of one browser, no internet (?net=local)
core/runtime.js     builds ctx for a game, runs its frame/tick loops, and force-cleans everything on stop
core/party state    lives in hub.js (`S`): players {id,name,color,hat,ready,trophies,wins,isBot,connected}, phase, game, results
core/input.js       the control map (below)          core/ui.js + ui.css   theme + HUD components
core/audio.js       one AudioContext, master/music/sfx buses   core/settings.js   volumes, sensitivity, quality
core/avatar.js      shared player character + hats    core/rng.js   seeded RNG    core/bots.js   bot slots + difficulty
core/palette.js     8 party colors (player.color is an index)  core/three-utils.js   renderer + dispose helpers
games/registry.js   list of game manifests (PLAYABLE = what players see); games are loaded with import() only when a round starts
games/<id>/         one folder per game: manifest.js, index.js (start), thumb.svg, game modules
```
Host-authoritative: the host runs the game simulation and every bot; clients send inputs and predict. If the host
leaves, the first remaining human (join order) becomes host and the game gets `'hostchange'` — rebuild your
authoritative state from the latest state you saw. Players who join mid-round spectate (`ctx.spectator`).

## The plug-in contract
`games/<id>/index.js` exports `manifest` (re-exported from `manifest.js`, which must import nothing) and
`async start(ctx) → { stop(), standings?() }`.
```js
manifest = { id, dir?, name, tagline, minPlayers, maxPlayers, teams: false|2, supportsBots, roundLengthSec,
             controlsHelp: [[keys, action]], thumbnail: 'games/<id>/thumb.svg',
             picks:   [{ key, label, default, choices: [{ value, label, desc? }] }],   // every player chooses (pre-round screen)
             options: [{ key, label, default, choices: [...] }] }                      // the host chooses
```
`ctx` (see `core/runtime.js`):
| | |
|---|---|
| `container` | full-screen element for your canvas / play-area overlays |
| `players` | participants `[{id, name, color (palette index), colorHex, colorCss, hat, isBot}]`; `player(id)`, `connected(id)` |
| `myId`, `isHost` (getter), `hostId`, `spectator`, `started` | identity and round state |
| `seed`, `rng(salt)` | round seed from the host; `rng()` gives a seeded generator — build levels from it |
| `options`, `picks[playerId]` | host options and per-player picks from the pre-round screen |
| `net` | this round's channel: `toHost(msg)` (any client; host loops back), host-only `toAll(msg, self=true)`, `to(id, msg)`; unreliable binary `rawToHost(buf)`, `rawToAll(buf)`, `rawTo(id, buf)`; `onMessage((msg, from) => …)`, `onRaw((ArrayBuffer, from) => …)`, `ping()`, `now()` |
| `input` | control map: `axis()`, `down(action)`, `presses(action)`, `key(code)`, `mouse`, `on('press'|'release'|'key'|'wheel', fn)`, `lockPointer()` |
| `ui` | HUD: `status(html)`, `timer(sec)`, `mini(rows)`, `abilities(slots)`, `bar(f, label)`, `zone(z)`, `toast`, `banner`, `setScoreboard(fn)`, `el`, `esc` |
| `audio`, `settings`, `quality()` | shared sound engine (`audio.sfx` bus, `tone`, `burst`, `play`), saved settings, graphics preset |
| `avatar` | `build(player)`, `hat(kind, color)`, `dispose(obj)` |
| `three` | `createRenderer()` (quality-aware, auto-disposed), `dispose(obj, keepSet)`, `applyQuality(renderer, light)` |
| `bots` | `{ level: {key, reaction, aimError, skill, mistakes}, list, Brain }` — the host runs bots with your own AI |
| `frame(fn(dt, now))`, `tick(fn(dt))` | render loop / 60 Hz sim tick that keeps running in background tabs |
| `setTimeout`, `setInterval`, `listen(target, type, fn)`, `onCleanup(fn)` | auto-cleared on stop |
| `on(event, fn)` | `'go'` (shared countdown done: start now), `'hostchange'` `{amHost, hostId, oldHost}`, `'join'` (id loaded mid-round: send them a full sync), `'leave'` (id), `'rejoin'`, `'resize'`, `'settings'` |
| `endGame(placements, {stats, note, title})` | host only. `placements` = ids best→worst; ties as arrays: `[[a, b], c]`. `stats[id]` text shows on the results screen |

**Relay trap:** `toAll(msg)` also delivers `msg` to the host's own `onMessage` (from = host). Never relay a message under the same type you are handling (e.g. client `{t:'emote'}` → host relays `{t:'emoted'}`), or the host re-broadcasts its own copy forever and the game locks up.

`standings()` (optional) returns current placements; used if the host ends the game early (otherwise no trophies).
Trophies: 1st 5, 2nd 3, 3rd 2, everyone else 1 (ties share the higher place).

## Control map (core/input.js) — games map their actions onto these
| Key | Action | | Key | Action |
|---|---|---|---|---|
| WASD / Arrows | move (`axis()`, actions `up/down/left/right`) | | E | use item (`use`) |
| Mouse | aim / look (`mouse`, `takeMouseDelta(sens)`) | | Q | special (`special`) |
| Left / right click | `primary` / `secondary` | | Tab | scoreboard — **hub only** |
| Space | jump / action (`jump`) | | Esc | pause menu — **hub only** |
| Shift | boost / dash (`boost`) | | Enter | chat — **hub only** |
Add extra keys only when the game truly needs them (e.g. Downhill grabs, emotes on 1–4) and list them in `controlsHelp`.

## UI / HUD rules
- HUD goes **only** in the four zones: top-left status (`ui.status`), top-center timer (`ui.timer`), top-right mini scoreboard (`ui.mini`), bottom-center abilities/items/meters (`ui.abilities`, `ui.bar`). Toasts and banners via `ui.toast` / `ui.banner`; the countdown, pause menu, results screen and Tab scoreboard are the hub's (use `ui.setScoreboard` to add your table).
- Never build your own menu, lobby, results or settings screen. Per-game choices go in `manifest.picks` / `options`.
- Play-area extras that belong to the 3D world (name tags, minimap, kill feed, trick meter) may live in `ctx.container`, styled with the shared variables.

## Visual style rules
- Bright cartoon look: saturated colors, toon/flat shading, chunky shapes, dark ink outlines where possible, sunny skies.
- One font (`var(--font)`, Lilita One), one palette (`core/ui.css` variables + `core/palette.js`), rounded panels with 3–4 px ink borders.
- Players keep their party color everywhere; show the player's avatar (`ctx.avatar.build`) or at least their hat (`ctx.avatar.hat`).
- Respect `ctx.quality()`: low = no shadows, pixel ratio 1, no post-processing.

## Cleanup rules (load/unload 10× must not grow memory)
- Create the renderer with `ctx.three.createRenderer()`; all loops via `ctx.frame` / `ctx.tick`; all timers/listeners via ctx helpers.
- In `stop()`: dispose scenes (`ctx.three.dispose(scene, keep)`), composers/render targets, workers, audio nodes you created, and any module-level caches you filled. Never keep references to ctx after stop.
- Module-level shared geometries/materials are fine (loaded once); per-round objects must be disposed.

## How to test
`cd tests && npm install && node run-all.mjs` (details in `tests/README.md`). Tests serve the repo, run a local
PeerJS server, launch Chromium with 2–3 browser contexts (real WebRTC), and route the CDN to local copies.
- `node e2e.mjs <gameId>` — create, join by link + code, ready, play to results, back to lobby, refresh-rejoin, no console errors
- `node memory.mjs <ids…>` — 10 load/unload cycles; renderers/canvases/HUD return to zero, heap stays flat
- `node migration.mjs <gameId>` — host closes their tab mid-game; party and game survive
- `node party.mjs` — vote, shuffle + podium, mid-game join, host handover, kick · `node local.mjs` — BroadcastChannel tabs
- Add a driver for your game in `tests/drivers.mjs` so the tests can play it to the end.
- Locally by hand: `python3 -m http.server 8000` in the repo root, open `http://localhost:8000/?net=local` in two tabs.
- Dev URL flags: `?dev=1` (show the template in the lobby), `?net=local` (tabs, no internet), `?peer=host:port` (own PeerJS server), `?netlog=1` (net log), `?testfps=N` (tests only).
