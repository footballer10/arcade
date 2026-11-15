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
5. After the race the host can **Play Again** (same lineup, new mountain) or **Back to Lobby** (change bots/classes).
6. Press <kbd>`</kbd> in either window for the debug overlay (FPS, ping to host, player count).

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
| ` | Debug overlay |

Trick keys only count if you press them **after** leaving the ground (so you don't auto-spin while carving into a jump). Land facing forward (within ~40°) for a boost; land sideways or upside down and you wipe out and respawn after ~1.3 s.

**Skier vs Snowboarder:** skiers turn sharper and are faster on the groomed (white, striped) main run. Snowboarders turn wider, launch higher off kickers, lose less speed in powder, and get a much bigger speed boost for landing tricks.

**Course features:** blue/orange kickers, cyan `>>>` boost pads, red/blue gates marking the route, rocks and trees (hit them fast = wipeout), a yellow-flagged narrow **SHORTCUT** through the trees about a third to halfway down, checkered finish line. ~85–95 s per race.

## 5. Known issues
- Each player's own rider is simulated in their own browser (for responsive controls) and reported to the host; the host owns the seed, countdown, bots, finish order and results. A modified client could cheat — fine for a prototype.
- PeerJS uses free public STUN only (no TURN relay). Some strict NATs / corporate / school networks won't connect.
- Bumps are resolved by each side separately, so with high ping they can feel soft or slightly one-sided.
- Bots are simple: they follow the run centre, dodge obvious obstacles, take the shortcut about half the time and sometimes botch tricks.
- No sound, no pause, no mobile/touch controls.
- If the host closes their tab, the room ends for everyone.

## Top 3 next improvements
1. Feel: terrain-aligned rider tilt/carve lean, snow spray particles and sound — the speed sensation is there but it's still "boxes on snow".
2. Proper netcode: host-side validation + client prediction/reconciliation so bumps are fair and cheating is harder.
3. Course design: more varied sections (steep pitches, rollers, a second shortcut, half-pipe walls) and a minimap/ghost of your best run.
