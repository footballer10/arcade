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
   Every hider has their own forced-taunt clock (45 s): staying silent that long forces a taunt (5 s warning, worth 0 points), and **any taunt resets the clock**, so you can choose your moment.
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

## Update: easier disguising, richer maps, nicer graphics, smarter seekers
- **Picking what to become:** aim assist picks the object closest to the crosshair (or to the mouse cursor when the
  mouse isn't locked) inside a generous cone, within 4.6 m and not behind a wall; it sticks to the current pick so it
  doesn't flicker. A bouncing yellow label ("E 🍞 Toaster") floats over it, and **E or left click** disguises.
  The third-person camera sits over your right shoulder so your own body never covers the crosshair.
- **Jumping as a prop:** disguised players hop higher (~1.4 m vs 1.06 m) to reach counters, tables and shelves;
  Space while locked unlocks and hops.
- **Maps:** the house comes in 3×2, 4×2 or 3×3; new rooms (Game Room with pool table + glowing arcade cabinets,
  Laundry Room, Music Room with piano and drum kit, Computer Lab, Toy Aisle, Café); rooms are randomly mirrored as well
  as rotated; framed paintings / school posters / store signs on the walls; new objects to become: guitar, computer,
  cactus, watering can, gift box.
- **Graphics:** procedural textured floors (wood planks, tiles, carpet, concrete), wainscoting with rails and crown
  trim, soft contact shadows along walls, warm light pools under flush ceiling lamps, a gradient sky with drifting
  clouds and rolling hills.
- **Seeker bots:** fixed bots freezing next to furniture (the walker could never "arrive" at a spot inside furniture
  or on top of it). They now walk only to standable spots, give up on unreachable goals, approach a suspect from a
  free spot that can see it, sweep rooms by visiting spots next to furniture, pause to look left and right, glance at
  objects as they pass and sprint after moving props. In a headless check, stalled time dropped from ~1860 s to ~70 s
  over 12 bot games.
- **Hammer:** carried in the seeker's right hand; the whole arm winds up and smashes down. The first-person view
  shows your sleeve and hand gripping it with the same wind-up/smash.

## Update 2: forced-taunt clock, fly-over, more human bots
- **Fly-over plays once:** the intro camera was started both by the level build (during the hub countdown) and again by
  the intro phase. It now holds at the top during the countdown and swoops down once during the intro phase.
- **Forced taunts are per hider:** a 45 s clock that every taunt (chosen or forced) resets; HUD bar shows it.
- **Hider bots hide like people:** choose cluttered believable spots (surfaces among other objects), never in the
  seekers' room, spread out from other hiders, become the object first (small body fits on shelves), avoid copying
  the object right next to them, walk to the edge of a raised spot, line up and hop up slowly, settle exactly onto the
  surface, and pick *when* to taunt (safe moments, before the forced clock runs out; bold ones dare a seeker who is
  looking away). Careless (easy/normal) hiders sometimes pick an odd object or a crooked angle.
- **Seeker bots judge like people:** only notice what is in their field of view; judge from afar but look closer
  before swinging (close-up noise is much lower); tells are off-spot, crooked, a duplicate of a neighbour, moving or
  wobbling, or near where a taunt was heard; they commit to a suspect until it's checked, check the nearest first,
  dismiss it after a close look if unsure, get more desperate as time runs out and more careful after a wrong bonk,
  sweep rooms by visiting spots next to furniture, and use the sniff when idle. Steering around furniture and
  give-up rules stop them freezing.
- Headless balance (360 hiders per level): found 55% / 72% / 73% (easy / normal / hard), ~5 wrong bonks per seeker
  per round, nobody faints because finds refund 20 health.

## Update 3: slow props, visible taunts, reliable taunt button
- **Props are slow while hunted:** from the start of the hunt a disguised hider moves at 55% of walking speed and cannot
  sprint (seekers walk at 100% and sprint at 150%), so running away as a prop doesn't work; during the hiding phase
  everyone moves freely. Tunable as `PROP_MOVE`.
- **Visible taunts:** expanding shockwave rings on the floor (white + the hider's color; red for a forced taunt, gold and
  larger for a daring one), a floating speech bubble with the taunt's icon (🎺🦆📯🎶🌀🐦, 📢 forced), and for seekers /
  spectators a pointer pinned to the screen edge with an arrow toward the taunt while it's off-screen (3 s).
- **Taunt button never fails silently:** cooldown timers use real time (a slow frame rate used to stretch them), the host
  answers a refused taunt with "Taunt ready in N s", and F during the intro explains that taunts open with the hiding.
- Hider bots take their first taunt sooner (2–11 s into the hunt when it's safe).
- **Sniff result is readable:** the hot/cold label used to be drawn behind the ability bar, so pressing Q looked like it did nothing.
  It now floats above the crosshair, bigger, with a rough distance ("Warm · about 8 m").

## Update 4: graphics pass
- **Antialiasing on High:** the post-processing composer now renders into a 4x multisampled target (it used to drop the
  renderer's antialiasing, leaving jagged edges).
- **Baked ambient occlusion:** every merged object darkens toward the floor and in ceiling corners (vertex colors), and
  soft contact-shadow pads sit under all furniture; a blob shadow grounds every character/prop. These work on Low,
  where real shadows are off.
- **Rim light** on toon surfaces (edges facing away from the camera glow warmly) so objects separate from the background.
- **Sharper shadows:** the sun's shadow camera follows the player (32 m window, snapped to texels so shadows don't
  shimmer) and widens to the whole building during the intro fly-over.
- **Atmosphere (High):** sunbeams through the windows, a warm point light that follows the camera's room, sharper
  512 px floor textures with stronger anisotropy, one-sided ceiling lamp plates (no more white discs seen from above).

## Update 5: real pathfinding, calmer bots, vaguer taunts
- **Pathfinding (`nav.js`):** bots used to walk straight lines between room centres and only steer locally, so a table
  between them and their goal left them standing against it. Each level's walls and furniture are now rasterized into
  a 0.4 m grid (with body clearance), bots plan an A* route around obstacles (string-pulled to a few corners), only
  turn at a doorway/corner once they are really there, and re-plan from where they actually are when stuck. Hider bots
  walk the planned route to the edge of a raised spot, then hop on. In a physics test of 480 random trips across all
  three maps every bot arrives; seeker standing-still time fell from ~516 s to ~54 s over the same games.
- **Less running around:** seekers linger (1-3 s looking around at each spot, 3-5 spots per room), sprint only after a
  moving prop or in the last 25 s, and hider bots only bolt once per round, rarely (props are slow now). Seekers are
  moving 56% of the time (was 73%) and hiders ~0%.
- **Taunts reveal an area, not a spot:** everyone except the taunter sees the ring, bubble, notes, pointer and hears the
  sound from a point 2-5 m away from the real one (the same point for all viewers); the hat only pops from your own
  disguise. The seeker bots hear a point up to ~3 m off and check at most ~4 objects around each taunt.
  Balance with this (30 games per level, 360 hiders): found 34% / 45% / 49% (easy / normal / hard), ~5-6 wrong bonks per
  seeker per round, no one faints.

## Extreme bots (`ctx.bots.level.tier === 'extreme'`, key stays 'hard')
A very good human who never slips, under the same rules as everyone else (line of sight, normal and sprint speed,
a human field of view; sniff readings are rounded to 2 m like the label a player sees).
- **Hider:** prefers spots hidden from the room's entrances and centre and away from doors, strictly avoids copying a
  neighbouring object, never bolts (a slow prop can't outrun anyone), taunts only when every seeker is far, out of the
  room and not looking this way (never a dare), and spends the forced-taunt clock at the safest moment.
- **Seeker:** triangulates from up to 4 sniffs (each = where I stood + the distance) and uses them to pick rooms and rank
  suspects; plans rooms by real route length and splits the map with teammates (shared "rooms covered"); inspects 5
  well-spread spots per room instead of random ones; reads taunts at full strength (checks up to 6 objects near one);
  1.4 rad field of view; lingers briefly and sprints between spots; slightly lower approach threshold, and a close-up
  re-check that is a little stricter than Normal so wasted bonks stay near Hard's.
- **Headless results** (3 Extreme vs 3 Hard bots per match, 80 matches): Extreme wins 58-22, avg score 448 vs 389, finds
  245 vs 149 hiders; vs Normal 30-10 (40 matches). Per role: extreme seekers find ~48% vs Hard 41% (about 6.7 wrong
  bonks per round vs 6.3); extreme hiders are found ~22% vs Hard 41%. Hard vs Hard control splits 21-19.
- **Host cost:** about 0.2 ms per sim step with 8 Extreme bots (budget 16.7 ms); the occasional round-start spikes
  (level generation, first routes) are the same size for Hard.
