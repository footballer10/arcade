# Adding a game to Party Arcade

One session = one game. Read `CLAUDE.md` first (contract, control map, HUD and style rules).

## Steps
1. **Copy the template:** `cp -r games/_template games/<id>` (lowercase id, e.g. `games/bumpercars`).
2. **Manifest** (`games/<id>/manifest.js`, no imports): set `id`, remove `dir` (or set it to your folder), `name`,
   `tagline`, `minPlayers`/`maxPlayers` (party max is 8, bots count), `teams`, `supportsBots`, `roundLengthSec`
   (aim for 1–4 minutes), `controlsHelp`, `thumbnail` (draw `thumb.svg`, 320×160, bright cartoon style), and any
   `picks` (each player chooses, e.g. a character) / `options` (host chooses, e.g. map, rounds).
3. **Register it:** one import + one entry in `games/registry.js`.
4. **Build the game in `start(ctx)`** (`games/<id>/index.js`). Keep the template's skeleton:
   - Scene: `ctx.three.createRenderer()`, a `THREE.Scene`, a camera; resize on `ctx.on('resize')`; read `ctx.quality()`.
   - Level: build it **only** from `ctx.rng()` / `ctx.seed` so every client gets the same world.
   - Host simulation in `ctx.tick` (60 Hz, runs in background tabs). Clients send inputs with `ctx.net.toHost`
     (or `rawToHost` for binary); the host broadcasts snapshots with `ctx.net.toAll` / `rawToAll` (10–20 Hz).
     Clients predict their own player and interpolate the others.
   - Wait for `ctx.on('go')` before starting the clock. The hub does the 3-2-1 countdown.
   - Bots: on the host, give each `ctx.players` entry with `isBot` your AI, tuned by `ctx.bots.level`.
   - Player looks: `ctx.avatar.build(player)` (or `ctx.avatar.hat(...)` on your own model) in the player's color.
   - HUD only via `ctx.ui` zones; add a Tab table with `ctx.ui.setScoreboard`.
   - Finish: host calls `ctx.endGame(placements, { stats })` once. Return `standings()` for early ends.
   - Robustness: handle `'hostchange'` (new host rebuilds sim from the last snapshot), `'join'` (send a full sync
     to a mid-round spectator), `'leave'` (freeze/remove that player). `ctx.spectator` players only watch.
   - `stop()`: dispose everything you created (see cleanup rules).
5. **Test driver:** add `<id>` to `tests/drivers.mjs` (how a fake player plays your game until results).
6. **Run the tests** (below) and fix everything until they pass. Commit with a clear message.

## Checklist (all must be true)
- [ ] Lives entirely in `games/<id>/`, plus one line in `games/registry.js` and a driver in `tests/drivers.mjs`.
- [ ] `manifest.js` imports nothing; thumbnail exists; `controlsHelp` lists every key the game uses.
- [ ] Uses `/core` for networking (`ctx.net`), input (`ctx.input`), HUD (`ctx.ui`), audio (`ctx.audio`), settings, bots, rng. No own PeerJS, lobby, menu, results screen, settings or mute buttons.
- [ ] Uses only the standard control map plus clearly needed extras; never binds Tab, Esc or Enter.
- [ ] HUD only in the four zones; bright cartoon style, shared font and palette; players in their party color (+ avatar or hat).
- [ ] Level is generated from the seed; identical on every client.
- [ ] Host-authoritative; works with 1 human + bots, and with 2–3 humans; bots respect `ctx.bots.level`.
- [ ] Waits for `'go'`; calls `ctx.endGame` exactly once with valid placements; provides `standings()`.
- [ ] Host never relays a message under the type it handles (`toAll` loops back to the host); if the game has emotes/chat-like messages, `node emotes.mjs <id>` passes.
- [ ] Survives host migration (`'hostchange'`) and mid-round joiners (`'join'`, `ctx.spectator`).
- [ ] Respects graphics quality (low: no shadows / post), master/sfx volume (route sound into `ctx.audio.sfx`), mouse sensitivity if it uses mouse look.
- [ ] `stop()` frees everything: `node memory.mjs <id>` shows 0 renderers/canvases/HUD nodes after each unload and a flat heap.
- [ ] `node e2e.mjs <id>`, `node migration.mjs <id>` and `node memory.mjs <id>` pass with **no console errors**; `node run-all.mjs` still passes for the other games.
- [ ] Runs at 60 FPS on a mid-range laptop at High, and stays playable at Low.
- [ ] Relative paths only; works when served from `/arcade-prototypes/`.
