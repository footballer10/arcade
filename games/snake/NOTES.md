# Snake Royale — design & test notes

Slither-style battle royale for the Party Arcade hub. Eat orbs to grow, boost by shedding length, pop anyone
whose head hits your body. A glowing ring closes in and **sweeps every orb inward**, so the richest food piles
up right at the deadly edge (the signature risk/reward). Last snake alive wins, or the biggest when time runs out.

## Files
| File | What |
|---|---|
| `manifest.js` | lobby info, options (mode, arena, blooms, length) and the per-player skin pick |
| `sim.js` | shared rules: movement, mass → length/width/turn rate, body trail, ring schedule, rocks, binary packets |
| `host.js` | `HostSim` (host only): collisions, orbs, deaths, respawns, Showdown, Golden Bloom, King Snake |
| `bots.js` | bot AI (food, ray fan + predicted heads for danger, hunting, bloom racing), tuned by `ctx.bots.level` |
| `render.js` | Three.js view: neon floor shader (draws the ring), instanced bodies/orbs, particles, shockwaves, bloom |
| `audio.js` | synthesized soundscape through `ctx.audio` (sfx + music buses) |
| `index.js` | glue: networking, prediction/interpolation, effects, HUD, minimap, kill feed |

## Netcode
- Host runs `HostSim` in `ctx.tick` (60 Hz, also in background tabs) and every bot.
- 20 Hz unreliable binary snapshot: per snake head x/y/angle, mass, flags, kills, last input seq; plus sim time and ring radius.
- Reliable batched messages (10 Hz) for orb spawns/eats; deaths, respawns, blooms, king, showdown as events.
- Clients rebuild every body from the head path they see (`Trail`), interpolate others 110 ms in the past,
  and predict their own snake (input replay from the last acknowledged input + smoothed correction).
- Host migration: the new host builds `HostSim.fromView` from its own view (heads, trails, orbs, ring, king).
- Mid-round joiners get a `full` sync (all orbs + decimated trails) and spectate.
- Disconnected players' snakes are driven by the bot AI until they come back.

## Tuning reference
Start mass 24 · speed 9 / boost 17.5 u/s · boost costs 7.5 mass/s (min 14) · death drops 80 % of mass
(King Snake: 120 %, as gold) · ring holds for 12 % of the round, shrinks until 82 %, then holds.
Royale Showdown: when 3 or fewer are left after 40 % of the round, the ring races in at 0.9 u/s.
