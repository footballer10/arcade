# Mini-Golf Battle — Test Guide

## 1. Where to play
- **Live:** https://footballer10.github.io/arcade-prototypes/golf/ (once GitHub Pages is enabled: repo Settings → Pages → Deploy from branch → `main` / root).
- **Locally:** from the repo root run `python3 -m http.server 8000`, then open http://localhost:8000/golf/ in Chrome.
  (It needs a web server because it uses ES modules; opening the file directly won't work. Internet is needed for the CDN scripts and the PeerJS server.)
- **Shorter matches for testing:** add `?holes=2` to the URL (1–9, default 9). Only the host's setting counts.

## 2. Test multiplayer by yourself (two tabs)
1. Tab A: enter a name → **Create Room**. Note the 4-letter code.
2. Tab B (same or another browser window): enter a different name, type the code → **Join**.
3. Both tabs show the lobby. In Tab A add bots if you like, then **Start Match**.
4. Shoot in each tab and knock each other's balls. Press `` ` `` in Tab B to see the ping to the host.
   The host simulates in a Web Worker timer, so the host tab keeps running even in the background.
   Side-by-side windows work better than tabs for watching both.

## 3. Play with a friend
Host clicks **Create Room** and sends the code. The friend opens the same link and clicks **Join**. Up to 8 players (people + bots).
It's peer-to-peer using the free public PeerJS server. Most home networks connect fine; some strict corporate or school networks block WebRTC.

## 4. Controls
| Action | Input |
|---|---|
| Aim + power | Left-click and drag **back** from your ball (like a slingshot), release to shoot |
| Cancel shot | Right-click while dragging, or Esc |
| Use power-up | E (or click the power-up box, bottom right) |
| Orbit camera | Right-drag |
| Zoom | Mouse wheel |
| Recenter camera | Space or C |
| Live scoreboard | Hold Tab |
| Mute/unmute | M |
| Debug overlay (FPS, ping, players) | `` ` `` |

Test URL options: `?holes=2` for shorter matches, `?seed=65` to replay the same set of holes (seed 65's first hole has a jump and a drop).

## Rules
- Everyone plays the same randomly generated hole (same seed) at the same time. Balls collide.
- Pieces: ramps, **jumps** (kicker over a pit), **drops** (step down a level), **banked curves** (curved wall on a sloped corner), **tunnels** (narrow covered lane), gates, bumpers, sliding blocks, spinning bars and water.
- Water or falling into a pit = +1 stroke, respawn where you last shot from.
- **Par is set by test runs**: before each hole the host has a bot play it 3 times. Par is the bot's average. If the bot never finishes, the hole is regenerated.
- **Power-ups** (yellow "?" boxes): roll through one to grab it, then press E to use it.
  - BIG BALL: double size and 3× mass for 12 s, so you bulldoze other balls.
  - STICKY: for 12 s you can't be pushed, stop quickly and don't roll back on slopes.
  - SHOCKWAVE: blasts every ball within 5 m away from you.
- 60 s per hole. Unfinished players, or anyone who reaches 8 strokes, score 8.
- Fewest strokes wins. First to sink each hole gets a ★ (−1).
- At match end the host can click **Play Again** (same players) or **Back to Lobby** (everyone returns to the lobby, new friends can join and bots can be changed).

## Look & feel
- Everything is drawn in code (no image or model files): striped putting-green turf, wooden rails, stone bases, stone tunnel arches, striped bumpers, hazard-striped obstacles, an animated water pool, a waving numbered flag and dimpled glossy balls.
- Scenery is generated for each hole: low-poly trees, bushes along the rails, rocks, flower patches, hills, clouds and a sky gradient.
- Effects: splash, confetti when you sink, dust when you land, sparkles on pickups, and a pulsing gold ring under your ball when it's your shot.
- The menu and lobby show a slow fly-around of a demo course. The UI uses a scorecard-style board and the Fredoka font from Google Fonts (it falls back to the system font if that's blocked).

## How online play works
- The host's browser runs the real simulation and sends snapshots 20×/s.
- Each client also runs the same physics locally (**client-side prediction**). Your shot moves the instant you release, and other balls move smoothly between snapshots.
- Each snapshot is fast-forwarded by half your ping and blended in, so small differences disappear quietly. Big differences, like a water respawn, snap into place.

## Known issues
- When the prediction is wrong (for example, another player's ball hits yours on the host's screen but not on yours), your ball can visibly slide or snap into place.
- If the host leaves, the match ends for everyone. There's no host migration.
- The host pauses for about 0.2–0.5 s while it generates and bot-tests a hole. This mostly happens behind the scoreboard, but you notice it after pressing Start.
- Bots ignore other balls when planning, and only use Shockwave when someone is close.
- Nobody can join a match in progress. Use **Back to Lobby** to let them in.
- The tunnel roof is glass so you don't lose your ball. Small stone corners show where a banked curve meets the straight rails.
- On older laptops, shadows and scenery can lower the FPS (check with `` ` ``). Turning off shadows would be the first quality setting to add.

## Top 3 next improvements
1. Host migration and rejoin: if the host drops, the next player takes over the game state, and a refreshed tab can rejoin its seat.
2. Hole quality: hand-designed piece templates mixed with the random ones, plus themed holes (ice, sand, lava), a minimap and a "show path" preview at hole start.
3. Progression and feel: cosmetic ball skins, a replay of the winning putt, a spectator camera after you sink, and more power-ups (magnet cup, ghost ball, freeze).
