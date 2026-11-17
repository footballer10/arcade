# Rocket Soccer — design notes

## Identity
Cars play soccer with a giant ball in a closed arena whose floor curves up into the walls. The signature mechanic is
car control: drive up the walls, jump, double jump, dodge-flip into the ball for a power hit, and boost to fly.
Colour mood: a sunset stadium with glowing team-coloured lines (Blue vs Orange). Sound: a live crowd that swells
when the ball nears a goal, the player's own engine and boost rumble, punchy hits, horn + roar on goals.

## Files
| File | What |
|---|---|
| `arena.js` | Arena layouts and the analytic signed distance field (rounded box + goal boxes) used by physics and the shader |
| `physics.js` | Car, ball, car-car, demolitions, pads, kickoff; whole-world step; pack/unpack/quantize for netcode |
| `match.js` | Host-only referee: goals, scorer/assist/own goal, shots, saves, clock, overtime, comeback boost |
| `bots.js` | Bot AI: roles per team, curve-in shooting, reaction time as a perception delay, simple aerials |
| `index.js` | Roster/teams, host sim + client prediction, events, replay, camera, HUD |
| `render.js`, `fx.js`, `audio.js` | Visuals, particles, synthesized sound |

## Netcode
Host-authoritative full-world prediction. The host steps everything at 60 Hz, rounds state to float32 and sends a
binary snapshot every 2 steps. Clients rewind to each snapshot and replay their unacknowledged inputs through the
whole world (ball included), so their own hits react instantly. Remote cars are extrapolated with their last input.
Corrections become visual offsets that decay over ~0.1 s. Measured over real WebRTC with 120 ms simulated round
trip and the autopilot playing: mean correction 0.18 units for the player's car and 0.17 for the ball (ball radius 2.4).

## Bots
Difficulty (`ctx.bots.level`) maps to: reaction = how stale the ball position they see is (0.12 s hard, 0.45 s
easy), aim error, skill (boost use, dodge shots, hard-only aerials) and mistakes (missed jumps). Bots re-plan at a
fixed rate. In head-to-head 2v2 tests (24 matches each): hard beat normal 44–30 in goals, normal beat easy 77–39.

## Phase 2: what was added
- **Moon Ball** (host option): gravity 14 instead of 24. Bigger air for the signature mechanic; bots scale their
  reach and skip aerials (a jump already gets there).
- **Pocket Park** arena: smaller and at night, for 1v1 / 2v2 or quick high-scoring games.
- **Comeback boost**: a team two or more goals down kicks off with a full tank (shown as a toast).
- **Moments**: goal replays with slow-mo, "0:00, ball still live" (the match only ends when the ball touches the
  ground), golden-goal overtime, rocket / aerial / hat-trick / own-goal callouts, epic saves, payback demolitions,
  last-minute banner, MVP on the results screen, replay skip vote, bots taking over for players who drop.

## Considered and cut
- **Hoops-style arena** (goals as rings): different scoring rules split the game's identity; one sport done well.
- **Power-ups / items (Rumble-style)**: a gimmick on top of a skill game; makes the car control matter less.
- **Quick chat / emotes on 1–4**: the hub already has chat, and emote spam over voice chat adds little.
- **Car bodies with different hitboxes**: hard to read for party players; one well-tuned car is fairer.
- **Handbrake / powerslide key**: would need a non-standard key; steering and corner speed were tuned instead.
- **Homing / heat-seeking ball mode**: removes the aiming skill that makes goals satisfying.
- **Spectator player-cycling camera**: nice to have; the TV camera that follows the ball is enough for one round.

## Phase 3: look and feel
- **Stadium**: stepped stands on all four sides with an instanced crowd in team shirts and party colours that bobs
  and jumps on goals (vertex-shader animation, one draw call), corner light towers with glowing panels and soft
  flares, ground outside the bowl, sunset (Sunset Stadium) or night (Pocket Park) sky.
- **Intro shot**: a slow crane around the stadium during loading and the countdown that settles behind the player's
  own goal, then glides down into the chase camera on GO.
- **Arena**: team-coloured chevron panels on the lower walls with a glowing trim line, fine hex glass above, glowing
  pitch lines that pulse in the scoring team's colour, glowing goal frames and nets, boost pads with glowing rings
  and spinning orbs (dim while recharging).
- **Juice**: goal explosion in the scorer's party colour (particles, shockwave rings, coloured point light, flash,
  shake, crowd roar, cars blasted away), boost flames and particle trails (team colour with party-colour sparks),
  ball speed streak tinted by the last team to touch it, hit sparks and rings, demolition blasts, landing squash,
  speed FOV kick, off-screen ball arrow, slow-mo goal replay from beside the net, confetti for the winners.
- **Quality**: Low = no shadows, no bloom, fewer particles, a thinner crowd of box fans (~27k triangles);
  Medium = shadows; High = shadows + bloom and a fuller crowd (~240k triangles).

## Handling update (after playtest feedback)
- Turning: sharper than the first version (a full-throttle U-turn needs ~16 units instead of ~23) but not twitchy:
  steering builds over ~0.3 s (a 0.1 s tap turns ~9 degrees, a held key gives full lock) and lets go quickly. **Brake-turn**: S + A/D while rolling forward spins the car
  round in a skid (180 degrees in ~0.5 s). The skid needs ~0.15 s of S + steer at speed, so an ordinary brake into
  a corner doesn't trigger it.
- Air: without boost the car only tilts gently and levels itself; boost gives full flying control.
- Netcode: clients round to float32 after every step like the host (replays now match bit for bit), send inputs
  every step, and the host keeps an adaptive jitter buffer per player (dry spells fell from 41% to ~4% of steps
  in the busy test machine).
