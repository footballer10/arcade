# Mini-Golf Battle — Test Guide

## 1. Where to play
- **Live:** https://footballer10.github.io/arcade-prototypes/golf/ (once GitHub Pages is enabled: repo Settings → Pages → Deploy from branch → `main` / root).
- **Locally:** from the repo root run `python3 -m http.server 8000`, then open http://localhost:8000/golf/ in Chrome.
  (It needs a web server because it uses ES modules. Internet is needed for the CDN scripts and the PeerJS server.)

## 2. Test multiplayer by yourself (two tabs)
1. Tab A: enter a name → **Create Room**. Note the 4-letter code.
2. Tab B (another window works best): enter a different name, type the code → **Join**.
3. In Tab A pick the settings, add bots if you like, then **Start Match**.
4. Shoot in each tab and knock each other's balls. Press `` ` `` in Tab B to see the ping to the host.
5. Open a third tab and join with the same code **while the match is running**: it waits in the lobby and joins at the next hole.

## 3. Play with friends
Host clicks **Create Room** and shares the code. Friends open the same link and click **Join**. Up to 8 players (people + bots).
It's peer-to-peer using the free public PeerJS server. Most home networks connect fine; some strict corporate or school networks block WebRTC.

## 4. Controls
| Action | Input |
|---|---|
| Aim + power | Left-click and drag **back** from your ball, release to shoot. Dots show the real path, including the first bounces |
| Cancel shot | Right-click while dragging, or Esc |
| Use power-up | E (or click the power-up box, bottom right) |
| Emotes | 1–4 (or the buttons, bottom left) |
| Orbit / zoom camera | Right-drag / mouse wheel |
| Recenter camera | Space or C |
| Spectate another player (after you finish) | Click, or ← / → |
| Live scoreboard | Hold Tab |
| Mute | M |
| Graphics high / low | G (drops to low by itself if the game runs under 24 FPS) |
| Debug overlay (FPS, ping, players) | `` ` `` |

Test URL options (can be combined): `?holes=2`, `?seed=65` (same holes every time), `?theme=0..4` (lock the world), `?mod=moon|ice|bigcup|bouncy|turbo|giant|none` (lock the modifier), `?item=1..9` (every box gives that power-up), `?q=high|low`.

## 5. What's in the game

**Lobby settings (host):** mode, number of holes (3/6/9), time per hole, power-ups (normal / chaos / off), modifiers on/off, bot difficulty. Click your own name to change ball colour.

**Modes**
- **Classic:** fewest strokes wins. Water or a fall = +1 stroke. Unfinished or 8 strokes = 8.
- **Speed Golf:** race. Points for finishing order (10, 7, 5, 4, 3, 2, 1). No stroke limit; a splash freezes you for 1.5 s.

**Bonuses** (shown as icons on the scorecard)
- ★ first to sink (Classic −1)
- 💥 KO: knock someone into water or off the course within 4 s of hitting them (Classic −1, Speed +2, max 2 per hole)
- 🎯 hole-in-one (Classic −1, Speed +3)

**Course pieces:** ramps, jumps over pits, drops, banked curves, tunnels, hills, gates, bumpers, sliding blocks, spinning bars, water, **sand** (slows you), **ice** (you slide), **boost pads**, **portals** (blue = in, orange = out, a shortcut), and cups on a mound or in a bowl.

**Worlds:** Sunny Meadow, Sunset Beach, Snowy Peaks, Red Canyon, Neon Night. Each hole is in a different world; snow has more ice, beach and canyon more sand, neon more boost pads and bumpers.

**Modifiers** (random on some holes after the first): Moon Gravity, Ice Rink, Big Cup, Super Bouncy, Turbo Shots, Giant Balls.

**Power-ups** (yellow "?" boxes; leaders tend to get defensive ones, players behind get catch-up ones)
| | |
|---|---|
| 🔴 Big Ball | Huge and heavy for 12 s |
| 🟢 Sticky | Can't be pushed for 12 s |
| 💥 Shockwave | Blasts nearby balls away |
| 🧲 Magnet | The cup pulls your ball in for 12 s |
| 👻 Ghost | Pass through balls, bumpers and moving obstacles for 10 s |
| 🔀 Swap | Swap places with whoever is closest to the cup |
| 🚀 Rocket | Re-launch your ball while it's rolling |
| 💣 Mine | Drop a mine where you are |
| ❄️ Freeze | Everyone else can't move or shoot for 4 s |

**Flow:** each hole opens with a fly-over. Par comes from bot test runs. After the last hole there's a podium, the final scorecard and awards (most KOs, holes-in-one, most penalties…). The host can **Play Again** or go **Back to Lobby**.

## 6. How online play works
- The host's browser runs the real simulation and sends snapshots 20×/s.
- Every client runs the same physics locally, so your own shot starts the moment you release, and other balls move smoothly between snapshots.
- Snapshots are fast-forwarded by half your ping and blended in. Big differences (a respawn, a swap) snap into place.

## Known issues
- If your screen and the host's disagree (usually about a collision), your ball can slide or snap to the host's position.
- If the host leaves, the match ends for everyone. There's no host migration.
- The host pauses for about half a second while it generates and bot-tests each hole (mostly hidden behind the scoreboard).
- Bots don't plan around other balls or mines, and they're strong on "normal". Use "easy" for a relaxed game.
- Walls are infinitely tall for physics, so a jumping ball can't clear a rail even if it looks high enough.
- High graphics (shadows + bloom) may be heavy on older laptops; press G for low.
- Emoji in emotes and on the scorecard depend on the system font.

## Top 3 next improvements
1. Host migration and reconnect, so a dropped host or a refreshed tab doesn't end the night.
2. Team mode (2v2, best ball) and a "hot seat" pass-and-play mode for one laptop.
3. Unlockable ball skins and trails, plus a replay of the best shot at the end of each hole.
