> **Note:** these are the design/test notes from before the Party Arcade hub. Gameplay details still apply; the menu, lobby, URL, control-key and netcode sections are superseded by the hub (see `/CLAUDE.md`).

# Downhill Rush — Test Guide

## 1. Where to play
- **Live:** https://footballer10.github.io/arcade/downhill/ (once GitHub Pages is enabled for the repo: Settings → Pages → Deploy from branch → `main` / root).
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
| A / D or ← / → | Steer — tap = small correction, hold = full carve; Shift = precise |
| W / ↑ | Tuck · S / ↓ brake |
| Space | Jump (small ollie on flat, extra pop at a kicker lip, pops you off rails) |
| In the air: ← / → | Spin (180, 360, 540, 720 …; odd ones land switch) |
| In the air: ↑ / ↓ | Frontflip / backflip. Flip + spin = **Misty** / **Rodeo** |
| In the air: hold Q E R F C V | Six grabs (names depend on skier/boarder, shown in the on-screen trick list). Hold 0.8 s for "Tweaked". **Let go before landing.** |
| B (on snow) | Butter 180 (flips your stance, small style points) |
| On a rail/box: A / D, Space | Rotate into a slide, pop off |
| Mouse click or X | Use your item |
| H | Show/hide the trick list · M mute · G graphics · ` debug |

**Reading your rotation:** in the air a big arrow on the snow under you shows which way your body faces; the thin white line is your travel direction. Arrow green = clean landing right now, yellow = sketchy, red = crash. The text under the trick name says the same ("landing: PERFECT (switch)"). Riders also have goggles + chest stripe on the front, a backpack on the back, and a bright board nose / ski tips.

**Style points:** every landed trick scores points (spins 100 per 180, flips 450, grabs 150+, rails, switch bonus). Mixing different parts multiplies the score; repeating the exact same trick twice in a row halves it; cleaner landings score more. Tricks still give speed boosts in a race.

## 4b. Party features
- **Modes** (menu / lobby): **Race** (first down wins) or **Trick Battle** (most style points wins; first three across the line get +500/+300/+150).
- **Items** (can be turned off): ride through a **?** box. 🚀 Rocket = speed burst, ❄️ Snowball = throw it straight ahead (slows whoever it hits), 🛡️ Shield = blocks one snowball, bump or crash. Riders at the back get rockets more often.
- **Party points:** every round gives 10/8/6/5/4/3/2/1 by place, +2 for the best single trick, +1 for most style (race) or fastest run (trick battle). The results screen keeps a running total with a 👑 on the leader until you leave the room.
- **Bots:** Easy / Normal / Hard, and they speed up or slow down a little to stay near the humans. They use items too.
- **Mountains:** Alpine Classic, Night Park, Powder Forest, Sunset Glacier, or Random. Rematch keeps the mountain and gives you a ghost.

**Skier vs Snowboarder:** skiers turn sharper and are faster on groomed snow. Snowboarders launch higher, spin faster, like powder, and get bigger boosts from tricks.

## 5. Known issues
- Netcode: the host now simulates every rider from their inputs (clients can't fake position or speed; a teleport test snapped straight back). Each client predicts its own rider and replays unacknowledged inputs when the host's state arrives, so steering is still instant. Bumps are host-decided, so on the joining side they land ~half a ping late. Other riders are shown slightly extrapolated and can jitter on bad connections.
- PeerJS uses free public STUN only (no TURN relay). Some strict NATs / corporate / school networks won't connect.
- Ghosts live in memory only (lost on reload) and only appear on Rematch, since every new race is a new mountain.
- Sound is synthesized (wind, carving hiss, jump, landing, trick, boost, wipeout, countdown, finish) — functional, not pretty. Browsers start audio only after your first click/key.
- Other riders are now drawn about 0.1 s in the past and blended between host updates, which removes the vibrating; on a very bad connection they can still stutter.
- Snowballs fly straight along the snow (no aiming) and the thrower on a joined machine sees them appear about half a ping late.
- Bots are simple: they follow the run centre, dodge obvious obstacles, take each shortcut about half the time and sometimes botch tricks.
- No mobile/touch controls. If the host closes their tab, the room ends.

## Top 3 next improvements
1. More park content: down-flat-down rails, wallrides, gap jumps, and a replay camera.
2. Host migration + reconnect so a dropped host doesn't end the room; TURN fallback for strict networks.
3. Progression: persistent ghosts/leaderboards per seed (shareable "mountain codes"), a style score for tricks shown in the results.
