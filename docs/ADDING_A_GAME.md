# Adding a game

One chat = one game. Rules and the `ctx` API are in `CLAUDE.md`; netcode rules in `docs/ARCHITECTURE.md`.

## Steps
1. `cp -r games/_template games/<id>` (lowercase id). It already has the right skeleton: seeded level, host sim in
   `ctx.tick`, client prediction, `SnapBuffer` for others, bots, HUD, music, cleanup.
2. `manifest.js`: id, name, tagline, `howTo` (2–4 short sentences), players, `controlsHelp`, picks/options; draw `thumb.svg` (320×160).
3. Register: one import + add to `PLAYABLE` in `games/registry.js`.
4. Build the game. Put every feel number (speeds, jump, gravity, cooldowns, timings) in `tuning.js`.
5. If players can be knocked out, call `ctx.setOut(true/false)` for your own player. Optional: offer chaos events with
   `ctx.crowd.chaos([...])` and handle `ctx.on('chaos', id)`; support `ctx.teams` if the game can work in teams.
6. Add a driver to `tests/drivers.mjs` (how a fake player plays until results).
7. `cd tests && node e2e.mjs <id> && node memory.mjs <id> && node lag.mjs <id>`; fix until they pass; commit, merge main, push.

## Checklist
- [ ] Only `games/<id>/`, one line in `games/registry.js`, a driver in `tests/drivers.mjs`.
- [ ] Level from the seed; host-authoritative; works solo with bots and with 2–3 humans; bots use `ctx.bots.level` (all 4 tiers).
- [ ] Waits for `'go'`; one `ctx.endGame` call; `standings()` for early ends; survives `'hostchange'` and mid-round joiners.
- [ ] Smooth on the relay (own player predicted, others via `core/interp.js`); no relay-trap loops.
- [ ] HUD only in the zones; cartoon style; party colors + avatar/hat; respects quality and volume.
- [ ] `stop()` frees everything (`memory.mjs` returns to zero); no console errors; relative paths only.
