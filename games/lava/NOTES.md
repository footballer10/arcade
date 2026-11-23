# Rising Lava — design + test notes

Survival platformer for the Party Arcade hub (`games/lava`). The lava rises; the rocks you stand on heat up and
crumble; shove your friends off. Last one standing wins the round, best of 5.

## How a round plays
- **The lava never stops.** It starts slow and keeps accelerating. Every couple of seconds a wave of new basalt
  columns rises out of the lava (bubbling glow = rock is about to come up), always above and around the rock that is
  already there, so the climb never ends and nobody can camp a summit. The starting ground is only a launch pad.
- **It gets harder as it goes:** later waves bring fewer, smaller columns with wider gaps, more blinking obsidian,
  and faster lava. At 95 s the volcano runs dry (no more new rock, timer shows NO MORE ROCK) and the lava speeds up
  again, so every round ends. Each later round in a match starts with faster lava (+12% per round).
- Every round picks a new **arena** for the starting ground (Giant's Causeway, Corkscrew, Archipelago, Ring of Fire;
  Corkscrew also makes new rock spiral round the crater, Ring of Fire keeps it near the rim) and a new **rise
  pattern** (Steady, Surges, Lava Tides, Slow Burn then Rush), all seeded so every client builds the same level.
- **Platforms:** basalt columns heat up while someone stands on them (faster with a crowd) and crumble at full heat
  (they don't grow back); rising columns carry you up like a lift; gold slabs orbit, slide or lift; purple obsidian
  blinks out on a timer (it flashes first); pumice rafts float on the lava but sink under weight.
- **Shove** (left click / E) knocks anyone in front of you; a **dash** (Shift) works once in the air and saves short jumps.
- **Double jump:** press Space again in the air (once; resets on landing) to save a bad fall or stretch a jump that's just short.
- When you're out you become a **volcano spirit**: aim with the mouse and click to lob a telegraphed lava bomb
  (6 s cooldown). Bombs knock players and heat rocks; a bomb that sends someone into the lava is a "Bomb KO"
  (tie-breaker). Bot spirits throw too.
- **Hot Crown:** whoever leads the match heats rocks 1.6x faster.
- The timer counts up: how long this round has lasted. Match placements: round wins, then "outlived" points
  (how many players you outlived each round), then Bomb KOs.

## Controls
WASD / arrows run (camera-relative) · Space jump (hold = higher, buffered + coyote time, and a short guaranteed
minimum hop so a quick tap still clears a gap) · Shift dash (works once in the air, a good "save" for a bad jump) ·
Left click / E shove · mouse looks after you click (pointer lock); **otherwise the camera is a chase cam that eases
round to sit behind wherever you're currently facing/moving**, so WASD stays predictable without ever touching the
mouse · wheel zoom. Out: click = lava bomb, Space / right click = switch who you watch.

**Playtest fix (camera + feel):** the unlocked camera used to swing to always face the crater center, which fought
the player's own WASD input (pressing "forward" kept meaning something different as you moved) and made the game
feel much harder than the physics actually were. It now eases toward the direction you're facing instead, so holding
one direction travels in a straight, predictable line, and turning (A/D) banks you around like a chase cam in most
third-person games. Jumping was also softened: more coyote/buffer time, a much gentler height-cut on an early Space
release (plus a guaranteed minimum hop so a quick tap isn't punished), bigger base jump distance/height, stronger air
control, and more forgiving platform-edge landings. Headless 6-bot rounds run longer now (~70-75 s avg, up from ~60 s)
because mistakes are less punishing — the "no new rock after 95 s" cutoff still caps every round.

**Playtest fix (moving platforms):** the lift's "chain" used to be rigidly parented to the platform (always the same
length, riding along with it) instead of hanging from a fixed point above — it looked like a glued-on stick, not a
cable. It's now a separate mesh anchored to a fixed point in the rock, with its length recomputed every frame from
the platform's current height. The gold slide/orbit platforms were also too thin and had an oversized, overly bright
top disc that read as a separate glowing coin floating above the platform rather than part of it; they're now
visually thicker (matches physics, which was also bumped from 0.55 to 0.85) with a warmer, slightly self-lit body and
a small inset landing-pad marking instead of a floating disc.

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
Rounds with 6 normal bots last ~60 s (43–98 s); first death ~27 s in; hard bots place best, easy clearly worst.
The climb can't go on forever: no new rock after 95 s, so a round ends by ~110–130 s even for a perfect player.


## Playtest fixes: bots and a double jump (2026-11-19)
- **Bots were too good at every difficulty**, especially shoving and dodging lava bombs (they'd hop off a platform
  and straight back onto it, dodging an explosion with inhuman precision). Root causes and fixes, all in `bots.js`:
  - Jump-target judgment used the same fixed 0.88-of-true-reach margin for every skill level, so even "easy" bots
    almost never misjudged a gap. `reachMargin(L)` now scales with skill (~1.06 easy, ~0.93 normal, ~0.81 hard):
    weak bots sometimes commit to a jump that's genuinely a bit too far and walk off an edge for it; hard bots are
    now a little more conservative too, not literally perfect.
  - Bomb "dodging" had full, instant knowledge of a bomb's landing spot from the moment it was thrown, and pulled
    bots away from it fairly strongly (`-6*skill`). It's now gated by a skill-scaled reaction window (bots only
    start reacting `0.3 + skill*0.9` seconds before impact — hard notices sooner, easy barely reacts in time) and
    weaker (`-3*skill`), which also stops the "off and back on" cheese: a bot no longer knows to flee a bomb that's
    still a second-plus from landing, so it doesn't pre-emptively hop away and immediately hop back once the
    now-visible-only-at-the-last-moment threat resolves.
  - Shove opportunism had a flat baseline (even "easy" bots punished an open edge ~60% of the time); both the
    pre-emptive counter-shove and the opportunistic edge shove are now pure `skill * x` with no floor.
  - Scoring noise when picking a platform (`(1-skill)*multiplier`) was raised from 1.6 to 4.5, so weak bots now
    visibly pick a worse platform sometimes, not just a slightly-randomized version of the optimal one.
- **Added a double jump** (world.js `DJUMP`, tunable): press Space again while airborne, once per air-time, for an
  extra (smaller) jump — lets you save a jump that's falling short or punch through a bad fall to reach lower
  ground sooner ("jump and dive"). Encoded in the snapshot (bit 32) so it's visible on every client, with its own
  sfx/particle flourish. Bots use it too, gated by skill, as an alternative to the existing air-dash rescue.
- Verified: headless jump-physics test still 300/300; 8000-level connectivity sweep still 0% disconnected; balance
  script still averages ~73-80 s rounds with easy clearly worst and hard modestly ahead of normal (not dominant);
  full test suite (e2e, memory, migration, solo, party) and the tuning portal's drift check all pass.

## Extreme bot difficulty (2026-11-23)
`ctx.bots.level` now has a 4th tier (`tier: 'extreme'`, `rank: 3`, `key` still reports `'hard'` for older checks;
`reaction: 0.05, aimError: 0.03, skill: 1, mistakes: 0`). Since `bots.js` already reads `L.skill/L.reaction/L.aimError`
straight from `ctx.bots.level` (no local easy/normal/hard lookup table to extend), most formulas already sharpen on
their own at skill 1 — the real work was fixing one formula that broke at the extreme, and adding a few genuinely
smarter, same-physics tactics (all gated on `L.rank >= 3`):
- `reachMargin()` used `1.3 - 0.53*skill` for jump judgment; at skill 1 that's *more* timid than Hard's skill-0.92
  value, not less. Extreme now gets its own confident, tested value (0.9) instead of running off the end of a
  formula built for 0–0.92.
- Extreme also considers jumps up to 2.0 m of climb (other tiers cap at 1.5) — physics headroom (max reachable
  height is ~2.3 m) that a sharp player would actually use.
- A light "does this lead anywhere?" bonus when picking a landing spot, so it doesn't strand itself on a dead end.
- An offensive dash: when nobody's in shove range but someone vulnerable is just inside dash range **and** the
  dash would land Extreme on solid ground (checked before committing — an earlier version skipped this check and
  dashed itself into the lava chasing people, which made Extreme the *worst* tier until fixed), it lunges in with
  the same dash every player has.
- Shove probabilities get their own high, decisive values instead of just topping out the shared `skill*k` formula.
- Volcano-spirit (lava bomb) targeting: full bomb-flight-time lead (correct pursuit prediction, not partial), and
  targets whoever a hit would actually finish (near their platform's rim, already airborne, or standing on hot
  ground) instead of a random living player — all from on-screen state, nothing hidden.
No new speed, reach, cooldowns or information beyond any player's — same `stepPlayer`, same `C.*` limits.

**Verified:** headless bot-vs-bot, 3 Extreme vs 3 Hard, 200 rounds: Extreme won 121 (60.5%) to Hard's 77 (38.5%).
8-way ladder (2 of each tier, 80 rounds): Extreme has the best average placement and ties for most round wins.
Performance: 7 Extreme bots average 0.02–0.04 ms per 60 Hz host tick (headroom to spare). The lobby's "💀 Extreme"
option was confirmed (Playwright) to actually reach the game as `ctx.bots.level = {tier:'extreme', rank:3, key:'hard', skill:1}`.
`node e2e.mjs lava` and `node memory.mjs lava` both pass; easy/hard/normal formulas are untouched for rank < 3
(confirmed byte-identical in a diff) and the existing balance/connectivity sweeps still show no regression.
