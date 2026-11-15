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
| Orbit camera | Right-drag |
| Zoom | Mouse wheel |
| Recenter camera | Space or C |
| Live scoreboard | Hold Tab |
| Debug overlay (FPS, ping, players) | `` ` `` |

## Rules
- Everyone plays the same randomly generated hole (same seed) at the same time. Balls collide.
- Pieces: ramps, walls/gates, bumpers, sliding blocks, spinning bars, water.
- Water = +1 stroke, respawn where you last shot from.
- 60 s per hole. Unfinished players, or anyone who reaches 8 strokes, score 8.
- Fewest strokes wins. First to sink each hole gets a ★ (−1).
- Scoreboard after each hole and at the end. The host clicks **Play Again** for a new match, no reload needed.

## Known issues
- Clients see other balls about one ping late (snapshots at 20 Hz with smoothing). There's no local prediction yet, so your own shot starts a little after you release.
- If the host leaves, the match ends for everyone. There's no host migration.
- Physics is custom 2.5D (no airborne balls or jumps). Ramps are simple slopes.
- Bots ignore other balls and are fairly accurate. Each bot gets a random skill level.
- Nobody can join a match in progress. They can join after it returns to the lobby, but Play Again currently restarts straight away, so new players must wait for a fresh room.
- Balls can be knocked around on the tee before you take your first shot.

## Top 3 next improvements
1. Client-side prediction for your own ball, plus snapshot interpolation buffering, so online play feels as snappy as local.
2. More piece variety and better hole design: jumps/drops between levels, curved banks, tunnels, a par based on bot test runs, and themed visuals.
3. Battle flavour: power-ups (big ball, sticky ball, shockwave), a "back to lobby" option between matches (so players can join and change bots), and sounds.
