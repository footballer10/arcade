# Prop Hunt — design + test notes

Hide-and-seek for the Party Arcade hub (`games/prophunt`). Hiders disguise themselves as objects in a furnished
building; seekers hunt them with a squeaky hammer. Roles rotate every round until everyone has hunted at least once;
the highest total score wins.

## A round (≈3 min)
1. **Intro (4 s):** the camera swoops down into the open dollhouse; everyone learns their role.
2. **Hide (20 s):** seekers are blindfolded and frozen in their spawn room. Hiders run off, look at an object and
   press **E** to become it, **Q** to rotate (45° steps), **right click** to lock in place (no wobble).
3. **Hunt (100 / 155 / 215 s):** seekers bonk suspicious objects (left click, 3.1 m reach). A real object costs
   10 health (0 = fainted for the round); finding a hider gives +20 health. Hiders taunt with **F** for points.
   Forced taunts hit every hider who has stayed silent for 15 s at 90 s and 45 s before the end (5 s warning).
4. **Post (7 s):** everyone is revealed with name tags.

## Maps (host option; default: a new map every round)
- **Cozy House** (3×2 rooms from living room, kitchen, bedroom, bathroom + two of dining room, kids room, garage, study).
- **School** (3×3: two classrooms, library, cafeteria, gym with bleachers, science lab, principal's office, locker hall,
  art room). More rooms and more doors, so seekers have more ground to cover.
- **Grocery Store** (4×2, wide-open floor plan): double-sided shelf aisles stocked with cans, cereal and bottles,
  produce stands, bakery, frozen foods, checkouts and a stock room. Long sight lines, lots of look-alike objects.
Every round also re-rolls the layout (room order, turns, doors, which slots are stocked), all from the seed.

## Scoring
Hider: +1 per 5 s survived during the hunt, +10 for surviving the round, taunt +3 (+5 more for a **daring taunt**
with a seeker within 7 m; forced taunts give 0). Seeker: +15 per find, +10 each if the seekers find everyone.
If all seekers faint, surviving hiders also collect the points for the remaining time.
- **Last Prop Standing:** when only one hider is left, everyone gets a banner and the music turns tense; that hider
  earns survival points twice as fast and a double survive bonus.
- **Final round = double points** (all points), so whoever is behind can still catch up.
- **Sniff** (seeker, Q, 22 s cooldown): a hot/cold reading of the distance to the nearest hider.

## Considered and cut (phase 2)
- Power-ups / items (speed shoes, decoy clones, traps): they pull attention away from reading the room, which is the game.
- Found players whispering hints as ghosts: unfair; found players spectate.
- Size-based health for props: classic but adds hidden math; one bonk = found is clearer.
- Sprint stamina: friction without real decisions.
- Random events (lights out, earthquake shuffles props): would wreck hides people worked for.
- Ranged seeker weapons: the squeaky-hammer bonk at arm's length is the identity; ranged = spam clicking.
- Multi-story buildings: stairs complicate navigation and cameras for little gain over three distinct maps.

## What makes a hide good (and what bots look for)
Every piece of furniture registers **slots** (counter tops, shelf boards, bed, tub, chairs around a table, floor
corners) with categories; decoys are only placed where they belong and about half the slots stay empty.
An object is suspicious if it's not on a slot that fits its kind, is rotated wrong for that slot, is moving or
wobbling (not locked), or sits where a taunt just came from. Seeker bots score what they see with a per-bot
perception noise and a health-aware threshold (easy bots miss tells and guess; hard bots rarely guess wrong).
Hider bots pick a free slot far from the seekers, become something that fits, line it up and lock; they taunt now
and then (easy ones recklessly) and may panic and run when a seeker stands right next to them.

## Netcode
Host runs `HostSim` (sim.js) at 60 Hz with every bot; 12 Hz JSON snapshots go to everyone including the host itself
(one render path). Each player moves their own body locally (no player-vs-player collisions, so prediction is exact)
and reports it at 20 Hz; the host checks speed and phase and bumps an epoch to snap a client back when needed.
Discrete actions (disguise, rotate, lock, taunt, bonk, sniff) are sent reliably as `act`; bonks carry the ray and
the client's hit, which the host re-checks with padded boxes (favor the bonker, never through walls).
Host migration: `HostSim.fromSnap` rebuilds rounds/scores/positions from the last snapshot; mid-round joiners get a
snapshot on `'join'` and spectate.

## Test hooks (tests only)
`window.__prophunt.turbo = 6` runs the round clock 6×; `window.__prophunt.autopilot = true` (host) lets the bot AI
play the host's own player. `__prophunt.stats` counts snapshots, finds and taunts.

## Look and feel (phase 3)
- **Open-roof dollhouse:** ceilings face down only, so inside you see a cozy ceiling with a glowing lamp, while the
  intro camera orbits high over the whole building (garden, trees, white fence, path) and swoops down to you.
- One merged toon mesh + ink outline for the whole building; decoys are instanced per kind with outlines; your own
  disguise is outlined in your party color so you never lose yourself among look-alikes.
- **High:** sun shadows, bloom on lamps, windows and the crackling fireplace (with a flickering light), a warm grade with
  vignette, dust motes drifting in the light. **Medium:** shadows, no post. **Low:** no shadows, no post, pixel ratio 1.
- **Juice:** poof clouds in your color when you disguise; props hop, squash and tilt when they move unlocked and
  gently wobble when idle; on a find the disguise is launched spinning into the air with a comic BONK! burst,
  confetti in the hider's color, dizzy stars and a screen flash / FOV punch for the bonker; wrong guesses make the
  real object boing with a NOPE!; taunting makes your hat pop out of your disguise with music notes.
- **Sound:** cozy lounge loop (electric-piano chords, walking bass, brushes) that turns into a ticking clock during
  the blindfold and speeds up for the last 30 s or a Last Prop Standing; positional taunts (kazoo, quack, honk,
  slide whistle, boing, cuckoo), hopping-prop "tok tok" footsteps, squeaky hammer, sad trombone when you're found.
