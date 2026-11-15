# Downhill Rush — Test Guide

## 1. Where to play
- **Live:** https://footballer10.github.io/arcade-prototypes/downhill/ (once GitHub Pages is enabled for the repo: Settings → Pages → Deploy from branch → `main` / root).
- **Locally:** from the repo root run `python3 -m http.server 8000`, then open http://localhost:8000/downhill/ in Chrome.
  (Opening `index.html` as a file won't work because ES modules need http. You still need internet for the Three.js/PeerJS CDN and the free PeerJS server.)

## 2. Test multiplayer by yourself
1. Open the game in **two separate Chrome windows side by side** (e.g. one normal window + one Incognito window). Two tabs in one window also work, but the hidden tab runs on a slower background timer, so windows feel much better.
2. Window A: type a name → **Create Room** → note the 4-letter code.
3. Window B: type a different name → enter the code → **Join**.
4. Window A (host): optionally **+ Add bot**, both pick Skier/Snowboarder, host clicks **Start Race**.
5. After the race the host can **Play Again** (new mountain), **Rematch** (same mountain — everyone gets a ghost of their own best run on it) or **Back to Lobby** (change bots/classes).
6. Press <kbd>`</kbd> in either window for the debug overlay (FPS, ping to host, player count; on the joining window also the number of unacknowledged inputs and the size of the latest prediction correction).

## 3. Play with a friend
1. You click **Create Room** and send your friend the 4-letter code (and the link).
2. Friend opens the link, enters the code, clicks **Join**.
3. You add bots if you like and click **Start Race**. Up to 8 riders total.
If the friend can't connect, one of you is likely behind a strict/corporate network (see Known issues).

## 4. Controls
| Key | Action |
|---|---|
| A / D or ← / → | Steer |
| W or ↑ | Tuck (faster, turns wider) |
| S or ↓ | Brake |
| Space | Jump |
| In the air: ← / → (or A/D) | Spin |
| In the air: ↑ / ↓ (or W/S) | Front / back flip |
| M | Mute / unmute |
| ` | Debug overlay |

Trick keys only count if you press them **after** leaving the ground (so you don't auto-spin while carving into a jump). Land facing forward (within ~40°) for a boost; land sideways or upside down and you wipe out and respawn after ~1.3 s.

**Skier vs Snowboarder:** skiers turn sharper and are faster on the groomed (white, striped) main run. Snowboarders turn wider, launch higher off kickers, lose less speed in powder, and get a much bigger speed boost for landing tricks.

**Course features:** blue/orange kickers, cyan `>>>` boost pads, red/blue gates marking the route, rocks and trees (hit them fast = wipeout), **two** yellow-flagged narrow **SHORTCUTs** through the trees (worth ~3–4 s each), a **HALF-PIPE** section (side walls pull you back to the middle — carve wall to wall), **STEEP!** pitches, **ROLLERS** (little hops in a row), a big kicker at the pipe exit, checkered finish line. The minimap on the right shows the whole run: white = main run, yellow = shortcuts, cyan = half-pipe, orange = rollers. ~80–100 s per race.

**Ghost:** your best run on a mountain is recorded. Pick **Rematch (same mountain + ghost)** on the results screen to race against it — a see-through rider plus a live "+/- metres" split under the timer.

## 5. Known issues
- Netcode: the host now simulates every rider from their inputs (clients can't fake position or speed; a teleport test snapped straight back). Each client predicts its own rider and replays unacknowledged inputs when the host's state arrives, so steering is still instant. Bumps are host-decided, so on the joining side they land ~half a ping late. Other riders are shown slightly extrapolated and can jitter on bad connections.
- PeerJS uses free public STUN only (no TURN relay). Some strict NATs / corporate / school networks won't connect.
- Ghosts live in memory only (lost on reload) and only appear on Rematch, since every new race is a new mountain.
- Sound is synthesized (wind, carving hiss, jump, landing, trick, boost, wipeout, countdown, finish) — functional, not pretty. Browsers start audio only after your first click/key.
- Bots are simple: they follow the run centre, dodge obvious obstacles, take each shortcut about half the time and sometimes botch tricks.
- No mobile/touch controls. If the host closes their tab, the room ends.

## Top 3 next improvements
1. Real track-side art pass: textured snow, rider animations (arms, crouch blend), trail marks in the snow.
2. Host migration + reconnect so a dropped host doesn't end the room; TURN fallback for strict networks.
3. Progression: persistent ghosts/leaderboards per seed (shareable "mountain codes"), trick combos and style score.
