# Arena Royale – Test Guide

Top-down 3D arena brawler. Last player standing wins the round; first to 3 round wins takes the match (best of 5).

## 1. Where to play
- **Live:** https://footballer10.github.io/arcade-prototypes/arena/ (once GitHub Pages is enabled: repo Settings → Pages → Deploy from branch → `main` / root).
- **Locally:** from the repo root run `python3 -m http.server 8000` (or `npx serve .`) and open http://localhost:8000/arena/ in Chrome. You need a local server because ES modules don't load from `file://`. Three.js and PeerJS come from the jsDelivr CDN, so you need an internet connection.

## 2. Testing multiplayer by yourself (two tabs)
1. Open the game in **two separate Chrome windows** placed side by side. Tabs also work, but you can only see one at a time. The host keeps simulating while its tab is in the background.
2. Window A: type a name, pick a class, click **Create Room**. A 4-letter code appears.
3. Window B: use a different name, type the code, click **Join**. Both lobbies should list both players.
4. In A (the host), add a couple of bots and click **Start**.
5. Press `` ` `` in B to open the debug overlay and check Ping, Snaps/s (should be about 20) and Pred err (should stay near 0).

## 3. Playing with a friend
Send your friend the live link. You click **Create Room** and send them the code; they click **Join**. Your browser runs the game (host-authoritative), so keep your tab open. Up to 8 players: fill the empty slots with bots. It's peer-to-peer over the free public PeerJS server, so no accounts are needed. Very strict networks (some corporate or school Wi-Fi, symmetric NAT) may block the connection because there is no TURN relay.

## 4. Controls
| Key | Action |
|---|---|
| WASD / arrows | Move |
| Mouse | Aim |
| Left click (hold) | Basic attack (Blaster bolts / Brawler punch / Trickster slash) |
| Right click | Special: Blaster = knockback blast, Brawler = leaping ground slam, Trickster = teleport to cursor (max 7 m; a purple ring shows where you'll land) |
| Space | Dash (1.4 s cooldown, brief invulnerability) |
| Mouse wheel | Zoom |
| Left click while dead | Switch which player you spectate |
| `` ` `` | Debug overlay (FPS, ping, player count) |

Rules: damage raises your knockback, so beaten-up players fly further. Falling off the edge or hitting 0 HP eliminates you. The red danger zone shrinks every 30 s and hurts more each stage. After 2:30 it collapses completely (sudden death). Power-ups: yellow = speed, cyan = shield, red = damage boost.

## 5. Known issues and what to improve next
**Known issues**
- Rounds with 6 bots last about 1–2 minutes, a bit under the 2–3 minute target. Raise or lower `TUNE.dmg` in `js/sim.js` to make rounds longer or shorter.
- Other players are drawn about 100 ms in the past (interpolation), so with a high ping, melee hits on fast Tricksters can look like they connected when they didn't. Your own movement is predicted locally. Teleports and specials wait one round trip.
- If the host closes their tab, the match ends for everyone (no host migration). Players who join mid-match are turned away until the host goes back to the lobby.
- There is no TURN server, so a few network setups can't connect.
- Bots are simple: no real use of cover, and they sometimes dash into the zone.

**Top 3 next improvements**
1. Game feel: hit-stop, screen shake, sound effects, and clearer telegraphs for specials (Brawler slam radius, Blaster blast).
2. Netcode: smaller binary snapshots, an unreliable channel for snapshots, lag-compensated hit detection, and host migration.
3. Content and balance: more arenas or hazards, a 4th character, smarter bots (cover, flanking, difficulty levels), and a tuning pass on the 2–3 min round length.
