> **Note:** these are the design/test notes from before the Party Arcade hub. Gameplay details still apply; the menu, lobby, URL, control-key and netcode sections are superseded by the hub (see `/CLAUDE.md`).

# Arena Royale – Test Guide

Top-down 3D arena brawler. Last player standing wins the round; first to 3 round wins takes the match (best of 5).

## 1. Where to play
- **Live:** https://footballer10.github.io/arcade-prototypes/arena/ (once GitHub Pages is enabled: repo Settings → Pages → Deploy from branch → `main` / root).
- **Locally:** from the repo root run `python3 -m http.server 8000` and open http://localhost:8000/arena/ in Chrome. Three.js and PeerJS come from the jsDelivr CDN, so you need internet.

## 2. Testing multiplayer by yourself
1. Open the game in two or three Chrome windows side by side. The host keeps simulating even when its tab is in the background.
2. Window A: **Create Room**. Pick the arena and bot difficulty in the lobby.
3. Window B (and C): different name, type the code, **Join**.
4. A: add bots, **Start**. Press `` ` `` in B to see ping, snapshot size (~200–400 bytes), channel (should say `unreliable`), and rewind (lag compensation) in ms.
5. **Host migration test:** with 3 windows in a match, close window A. Within about 3–8 s, B becomes host ("You are now the host") and C reconnects to it. The match carries on from where it was. The room code keeps working for new players.
6. **Mid-match join:** join a running match with the code. You spectate until the next round starts.

## 3. Playing with a friend
Send the live link. You **Create Room** and send the code; they **Join**. 2–8 players, with bots filling the empty slots. If you (the host) drop out, the next player in the lobby takes over. There's no relay (TURN) server, so some strict networks (school/corporate Wi-Fi) may not connect.

## 4. Controls
| Key | Action |
|---|---|
| WASD / arrows | Move |
| Mouse | Aim |
| Left click (hold) | Attack |
| Right click | Special |
| Space | Dash (1.4 s cooldown, brief invulnerability – use it to slip through the Sweeper beam) |
| Mouse wheel | Zoom |
| Click while dead | Switch which player you spectate |
| M | Mute / unmute |
| `` ` `` | Debug overlay |

**Extra keys:** `1`–`4` send emotes (😂 😡 👍 💀).

**Ammo:** every attack uses 1 of 3 ammo bars (shown under your health bar). They refill on their own, so fire in bursts and back off to reload.

**Characters (8)**
| Character | Role | Left click | Right click |
|---|---|---|---|
| Blaster | Ranged | Bolts | Knockback Blast: short charge, then a big push |
| Brawler | Tank | Wide punches | Ground Slam: leap and smash |
| Trickster | Assassin | Fast slashes | Teleport to the cursor; you arrive with full ammo |
| Bomber | Artillery | Lobs bombs over walls | Gravity Well: drags enemies in |
| Ranger | Sniper | Long arrows that pierce through players | Backflip Volley: flips away and fires 3 arrows |
| Frostbite | Control | 3 ice shards that slow | Blizzard: an area that slows and chips health |
| Ram | Tank | Horn bash | Stampede: unstoppable charge; hitting a wall = BONK |
| Angler | Grappler | Long harpoon jab | Hook Shot: yanks an enemy to you, or pulls you to a wall |

**Arenas (5):** Crate Meadow, Sweeper Sands (spinning spiked log), Frosty Pits (water holes + bumpers), Donut Dunk (a giant hole in the middle), Slippy Rink (everyone slides).

**Mutators** (menu or lobby): Super Knockback, Turbo, Bomb Rain, Power-up Party, Glass Cannon (triple damage), Shuffle (random character each round), or **Chaos**, which picks a random one every round.

**Ghosts:** when you're eliminated you become a ghost. Fly next to a living player and left click to BOO: a shove with no damage, every 4 seconds. Bots don't become ghosts.

**Power-ups:** yellow = speed, cyan = shield, red = damage, green = heal 40%, pink = giant (bigger, hits harder, harder to push).

**Bushes:** tall grass hides you from enemies more than 3.5 m away (bots too). Attacking or getting hit reveals you.

**Rules:** damage raises your knockback. Falling off the edge or into a pit, or hitting 0 HP, eliminates you. The gas zone shrinks every 30 s; after 2:30, sudden death. The match-end screen gives awards for most KOs, most damage and most dunks.

**Balance notes:** melee characters deal roughly 1.8x the damage rate of ranged ones and have more health. Numbers were tuned with bot-vs-bot matches (1v1 win rates ended between about 33% and 64%; damage dealt per round in 8-player free-for-alls was within about ±20% across characters). All values are at the top of `js/sim.js` (`CHARS`, `MELEE`, `SHOTS`, `TUNE`).

## 5. Known issues and what to improve next
**Known issues**
- Balance has only been tested with bots, not people. In bot free-for-alls the ranged characters still win more rounds than melee (bots dive into crowds); expect to tweak after real games.
- With 8 hard bots, rounds last about 70 s (range roughly 50–100 s), under the 2–3 minute target. Lower `TUNE.dmg` in `js/sim.js` for longer rounds.
- Ghost BOOs can decide a close round. If your group finds that annoying, set `this.ghosts = false` in `js/sim.js`.
- Host migration needs at least one other human. While switching hosts the game pauses about 4–11 s.
- Lag compensation is capped at 300 ms. No TURN relay server, so some networks can't connect.

**Next ideas**
1. A short tutorial or practice mode, and character select previews.
2. A TURN fallback (e.g. a free Open Relay tier) and per-player ping on the scoreboard.
3. Team modes (2v2, 4v4) and a balance pass with real players.
