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

**Characters**
- **Blaster:** rapid bolts. Special = Knockback Blast (short charge-up, then a big push).
- **Brawler:** heavy punches, most HP. Special = leaping Ground Slam (orange ring shows where it lands).
- **Trickster:** fastest, quick slashes. Special = Teleport to cursor (purple ring shows where you'll land).
- **Bomber (new):** lobs bombs at the cursor (a red ring marks the blast area). Special = Gravity Well that pulls enemies in. Drop it past someone near the edge to drag them off.

**Arenas:** Pillars (cover), Sweeper (a rotating beam knocks you around), Pits & Bumpers (holes in the floor and pink bumpers that fling you). Pick one, or Random, in the menu or lobby.

**Rules:** damage raises your knockback. Falling off the edge or into a pit, or hitting 0 HP, eliminates you. The red zone shrinks every 30 s; after 2:30, sudden death. Power-ups: yellow = speed, cyan = shield, red = damage.

## 5. Known issues and what to improve next
**Known issues**
- With 6 bots, rounds last about 1.5–2 min on Pillars and about 1.5 min on the hazard maps. Lower `TUNE.dmg` in `js/sim.js` for longer rounds.
- Blaster bots win most bot-only matches. The melee bots still walk straight into fire. Human players may balance differently.
- Host migration needs at least one other human. With only bots left the game ends. While switching hosts the game pauses about 3–8 s, and anything in the last fraction of a second before the host dropped is lost.
- Lag compensation is capped at 300 ms, so very laggy players will miss more.
- No TURN relay server, so some networks can't connect.

**Next ideas**
1. A short tutorial or practice mode, and character select previews.
2. A TURN fallback (e.g. a free Open Relay tier) and per-player ping on the scoreboard.
3. Balance pass with real players, plus more arena hazards (lava floor tiles, moving platforms).
