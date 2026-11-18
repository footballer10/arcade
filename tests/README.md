# Automated tests

Not needed to play. They drive real Chromium pages with Playwright.

```
cd tests
npm install          # three + peerjs (served locally instead of the CDN), a local PeerJS server, esbuild
node run-all.mjs     # everything (~25 min in a small VM); or run single files:
node e2e.mjs golf downhill arena coingrab   # full party flow per game, 3 browser contexts
node memory.mjs golf downhill arena coingrab   # 10 load/unload cycles
node migration.mjs arena                    # host closes their tab mid-game
node party.mjs                              # vote, shuffle + podium, mid-game join, handover, kick
node local.mjs                              # BroadcastChannel transport (two tabs, no PeerJS)
node upgrade.mjs [gameId]                   # joiner starts on the relay, moves to direct WebRTC mid-round by itself
node joinpaths.mjs                          # direct blocked → relay in seconds; nothing works → Copy details
node hostdrop.mjs                           # connection servers drop a waiting host: it re-registers, friends can join
node lag.mjs [gameIds…]                     # how smooth a game looks for a joiner, with and without ?netsim lag
node portal.mjs                             # developer tuning portal: sliders, save/download, inert off localhost
node solo.mjs [nopeer]                      # Play Solo vs Bots (with / without a reachable PeerJS server)
node emotes.mjs [ids]                       # emotes from host + client don't flood or stall games
EXTRA='&forcerelay=1' node e2e.mjs <ids>   # whole party over the backup relay (no direct link)
node solo.mjs relayonly                     # game server down, relay up: still online
node shot.mjs <gameId>                      # screenshots into artifacts/
```
Notes
- The harness (`harness.mjs`) serves the repo on 127.0.0.1:8080, runs PeerJS on :9000 (`?peer=127.0.0.1:9000`), an MQTT relay broker on :9002 (`?relay=ws://127.0.0.1:9002`)
  and routes `cdn.jsdelivr.net` / Google Fonts to local files, so no internet is needed.
- Several 3D pages share one software-rendered GPU in a headless VM, which makes every frame very expensive.
  Tests therefore use small windows, the Low graphics setting and `?testfps=N` (caps rendering; test-only).
  Real players each have their own GPU and none of this applies.
- `NETLOG=1 node …` prints the party connection log (`?netlog=1`) for debugging.
- Playwright and Chromium come pre-installed in Claude Code cloud sessions (`require('playwright')`).
