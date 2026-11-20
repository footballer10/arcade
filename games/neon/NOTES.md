# Neon Rush — design and test notes

Anti-gravity racing on glowing tracks through a synthwave city. No weapons: speed and skill only.
**Signature mechanic:** drifting charges a boost meter, and chained drifts multiply the reward.

## How to reach it
Party Arcade hub → create a party (or **Play Solo vs Bots**) → pick **Neon Rush** in the lobby → Start.
The pre-round screen has the per-player **Ship** pick and the host's **Track**, **Mode** and **Laps** options.

## Controls
| Key | Action |
|---|---|
| W / ↑ | Accelerate |
| S / ↓ | Brake, then reverse |
| A D / ← → | Steer |
| Space (hold) while steering | Drift. Charge goes blue → pink → gold. Let go for a mini-boost plus boost meter |
| Drift again within ~1.2 s | Chain: ×1.5, ×2, ×2.5, ×3 on the meter reward |
| Hold gold too long | Overheat: the drift burns out and the chain breaks |
| Shift (hold) | Spend the boost meter |
| Q (hold) | Look back |
| Space, or A / D, once you're derezzed/finished/spectating | Switch which racer the camera follows |

Tab (scoreboard), Esc (pause) and Enter (chat) are the hub's.

## The systems
- **Drift**: steering picks a turn radius (about 40–143 units, tightest when you steer into the turn); steering
  *into* the drift charges faster. The slide saturates (max ~31° off the track tangent), so holding a drift through
  a straight or a gentle bend settles into a fixed angle instead of spiralling into a wall. Tiers need roughly
  0.6 s / 1.5 s / 2.5 s of good drifting. Releasing gives a mini-boost and 10 / 18 / 28 % meter.
- **Chains**: start the next drift within 1.25 s of releasing the last. S-bends and chicanes are where chains happen.
- **Overheat**: gold can be held about 1.3 s. Let go in that window.
- **Boost meter**: Shift drains it for top speed (~86 vs ~60). Boost strips on the track give free bursts and a little meter.
- **Slipstream**: sit 4–28 units behind another ship to gain top speed and meter.
- **Underdog flux**: the further back you are, the more meter a drift gives (up to +35 %).
- **Tracks**: walls are energy barriers (scrape = lose speed, hard hit = drift lost). Some edges are open (fall = respawn
  after ~1.3 s). Jumps need speed. Wall-ride pipes curve up the sides. Each track has one hidden **shortcut**: an
  opening in the wall that splits off onto a narrow, often unwalled lane.
- **Knockout mode**: no finish line; every 14–25 s (depends on player count) the last ship is derezzed until one remains. If the
  ship you're watching gets derezzed (including your own), the camera automatically moves on to whoever's
  leading among the ships still racing; Space or A/D pick a different one by hand.

## Tracks
| Track | Mood | Features |
|---|---|---|
| Sunset Boulevard | pink/orange sunset | wide, S-bends, wall-ride corner, jump, hairpin shortcut |
| Helix Heights | violet night | loop, corkscrew, big jump, U-detour with a risky unwalled shortcut |
| Hyperloop Harbor | teal | half-pipe tube, 32-unit jump, descending 360° spiral |
| Inferno Interchange | red | six-corner chicane for chains, hairpin pair, bridge shortcut over the hairpins |

## Netcode
Host-authoritative. The host steps every ship at a fixed 60 Hz in `ctx.tick` (also in background tabs): one step per
received input for humans (so client prediction replays exactly), the AI for bots. Clients predict their own ship,
send inputs over the unreliable binary channel (each packet repeats the last 12 inputs), and rewind/replay on each
20 Hz snapshot. Snapshots carry the whole ship state, so after host migration the new host continues from the last
snapshot it saw. Other ships are interpolated 100 ms in the past.

## Test hooks
`window.__neon.autopilot = true` lets the bot AI drive your ship (used by `tests/drivers.mjs`).

## Look and sound (phase 3)
- Countdown flyover: the camera races backwards down the track to the grid, then blends into the chase cam at GO.
- Chase camera lives in track space, so it rides through loops and corkscrews; FOV widens with speed and boost.
- Track edge lights, energy walls and the ground grid pulse on the music's beat. Holographic word signs on towers.
- Ships: party-colour hull with a bright neon outline, the player's avatar and hat as pilot, under-glow,
  engine flames, twin light trails, drift sparks in tier colour, boost exhaust.
- Finish: fireworks over the gate and a slow victory orbit around your ship.
- Sound: synthwave loop (gets hats on lap 2 and a lead plus faster tempo on the final lap), engine with speed,
  drift hiss that rises with tier, tier chimes, release whoosh, chain arpeggio, close-pass whooshes, wall crunches.
- Graphics presets: High = bloom + shadows + stars + denser city; Medium = shadows, no bloom; Low = no shadows,
  no bloom, pixel ratio 1, sparser city, smaller spark pool.

## Bot difficulty
Per-track head-to-head sims (3 bots of the same difficulty, no mixed-skill drafting) show the real gap: easy finishes
~15-40% slower than hard depending on the track, normal sits close behind hard. Easy bots barely drift (they only
bother on the sharpest corners), steer more sluggishly, brake earlier into corners, hoard their boost meter longer,
and rarely attempt shortcuts; hard bots do all of this aggressively. (Earlier tuning had every difficulty finishing
within a few seconds of each other — the AI drove the same near-flawless line at every skill level and only the
top-speed cap differed by ~5%.)

## Human playtest fixes
The first real human playtest found three bugs bot simulation never would have surfaced, all fixed:
- **Jump gaps had a false floor just before the real lip.** `gapAt()`'s bucket index (`floor(s/path.ds)`) didn't
  line up with the literal-integer-`s` loop that filled the gap mask in `buildTrack()`, so one bucket straddling
  the lip got flagged early. Depending on your exact speed, a frame could land in that bucket *before* the real
  lip and fall through with zero launch velocity — "sometimes you don't make the jump" for no visible reason.
  Fixed by deriving the flagged index range directly from `lip/ds`..`end/ds`.
- **Drifting was a liability, not a reward.** Holding Space + steering into a turn gave a *constant* turn radius
  with no cap on how far the car's heading could diverge from the track — so holding a drift from before a
  corner even started (very natural for a human, who presses drift a bit early) let the heading run away, and
  by the time the car reached the actual corner it slammed broadside into the inside wall, losing almost all its
  speed in under a second. Fixed by capping the drift's heading divergence (`DRIFT_MAXYAW`), softening wall
  contact to one penalty per hit instead of one every frame of continued contact, and retuning the radius to
  match the tracks' real corners instead of being far tighter than any of them.
- **The shortcuts were effectively unreachable.** Catching one required getting within one ship-width of the
  *literal* track edge, in a position pushing against the turn's natural momentum, with almost no warning (the
  wall opened only 2 units before the entry). Bots could do it because they target an exact `d` offset every
  tick; a human steering by hand basically never got there. Fixed with a far looser catch threshold (60% of the
  way to the edge, not 90%+), 16 units of advance warning where the wall opens early, and a violet chevron trail
  on the ground pointing at the opening.

## Shortcuts: reachable but still bad (second pass)
Fixing reachability above just exposed two worse problems underneath, both now fixed:
- **Three of the four shortcuts silently killed you.** `buildShortcut()`'s curving connector section (the part
  that actually peels away from the main track) only got walls when a track's `sc` entry set `walls: true` —
  Inferno had it, Sunset/Helix/Harbor didn't. With no wall, any ship that drifted even slightly off-centre
  through the curve had nowhere to recover and fell straight off into a 1.25 s respawn. Confirmed by simulation:
  a bot forced to always take Sunset's shortcut hit `d` past the lane's edge and fell almost every time. Fixed
  by giving every shortcut `walls: true`.
- **Bots threw away their own racing line once on a shortcut.** `botInput()` computed a perfectly good
  corner-aware steering target (`dT`) for wherever the ship currently is, main track or shortcut alike — then
  unconditionally overwrote it with "just aim near the centre" the moment `sh.path !== 0`. That's what let bots
  (and would let a less attentive human) wander into the now-walled edge instead of steering through the curve.
  Fixed by letting the shortcut lane keep the same corner-aware `dT` the main track gets, and by letting bots
  drift on a shortcut's own corners too (the drift decision used to require `sh.path === 0`, so a shortcut's
  bends never got the boost a same-shaped main-track corner would).
- **Three of the four shortcuts weren't actually faster.** Raw distance saved isn't the same as time saved: a
  shortcut's own curves (and the respawn-prone connector above) could cost more than the distance it cut.
  Measured with same-skill bots forced to always/never take each one, 3-lap total: Sunset and Harbor came out
  *slower* overall, Helix and Inferno were faster. Fixed by widening Sunset's and Harbor's lanes, flattening
  their humps, and — mainly for Harbor, whose margin was only 15 units — extending how much of the main track
  each one bypasses. All four now save real time when taken well: Sunset +1 s, Harbor +0.3-0.5 s (deliberately
  modest: the track's whole identity is outright speed on the main route), Helix +4.5-5 s, Inferno +8-9 s per
  3-lap race (12-trial averages, hard-skill bots, no mixed-skill drafting).

## Considered and cut (phase 2)
- **Weapons / items** (shells, mines): the brief is pure speed and skill, and items would dilute the drift economy.
- **Rocket start** at the countdown: the hub owns the countdown, so a fair timing window would need a /core change.
- **Ghost replays / time trial**: good for solo, but adds storage and UI the hub doesn't have; low value in a party.
- **Weather / track hazards that move**: gimmicky next to the drift system; tracks already carry the variety.
- **More ship classes**: three (balanced, top speed, drift charger) already cover the real trade-off.
- **Perfect-release bonus**: overlapped with overheat; overheat alone gives the timing skill with less UI.
