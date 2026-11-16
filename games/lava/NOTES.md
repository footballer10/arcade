# Rising Lava — design + test notes

Survival platformer for the Party Arcade hub (`games/lava`). The lava rises; the rocks you stand on heat up and
crumble; shove your friends off. Last one standing wins the round, best of 5.

## How a round plays
- Every round picks a new **arena** (Giant's Causeway, Corkscrew, Archipelago, Ring of Fire) and a new **rise
  pattern** (Steady Rise, Surges, Lava Tides, Slow Burn → Rush), both seeded so every client builds the same level.
- **Platforms:** basalt columns heat up while someone stands on them (faster with a crowd) and crumble at full heat,
  then regrow a few seconds later if the lava hasn't reached them; gold slabs orbit, slide or lift; purple obsidian
  blinks out on a timer (it flashes first); pumice rafts float on the lava but sink under weight.
- **Shove** (left click / E) knocks anyone in front of you; a **dash** (Shift) works once in the air and saves short jumps.
- When you're out you become a **volcano spirit**: aim with the mouse and click to lob a telegraphed lava bomb
  (6 s cooldown). Bombs knock players and heat rocks; a bomb that sends someone into the lava is a "Bomb KO"
  (tie-breaker). Bot spirits throw too.
- **Hot Crown:** whoever leads the match heats rocks 1.6× faster. **Escalation:** each round the lava reaches the top
  5 s sooner (80 s → 62 s). After that, OVERTIME: the lava speeds up and pumice sinks on its own.
- Match placements: round wins, then "outlived" points (how many players you outlived each round), then Bomb KOs.

## Controls
WASD / arrows run (camera-relative) · Space jump (hold = higher, buffered + coyote time) · Shift dash · Left click / E
shove · mouse looks after you click (pointer lock), otherwise the camera turns itself to face the arena · wheel zoom.
Out: click = lava bomb, Space / right click = switch who you watch.

## Netcode
Host runs `HostSim` (host.js) at 60 Hz with every bot, 20 Hz binary snapshots (`encodeSnap`) on the unreliable
channel. Lava and moving platforms are functions of the round clock, so clients predict them exactly. Clients predict
their own player and send input + predicted state at 30 Hz; the host adopts that state when it is within 1.8 m of its
own and otherwise bumps the player's `auth` counter, which makes that client snap to the host. Knockback, heat,
crumbling, bombs, deaths and scoring are host-only. Host migration rebuilds the sim from the last snapshot plus the
round info every client keeps (wins, points, deaths); the new host trusts client positions for 4 s while everyone
reconnects.

## Test hooks (tests only)
`window.__lava.autopilot = true` lets the bot AI play for you; `window.__lava.turbo = 3` runs the round clock 3×.
`window.__lava.stats` counts snapshots, corrections and bombs.

## Balance (headless, 6 bots)
Rounds last ~55–65 s; first death ~20–30 s in; easy bots place clearly worse than normal/hard.
