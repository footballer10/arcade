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
node shot.mjs <gameId>                      # screenshots into artifacts/
```
Notes
- The harness (`harness.mjs`) serves the repo on 127.0.0.1:8080, runs PeerJS on :9000 (`?peer=127.0.0.1:9000`)
  and routes `cdn.jsdelivr.net` / Google Fonts to local files, so no internet is needed.
- Several 3D pages share one software-rendered GPU in a headless VM, which makes every frame very expensive.
  Tests therefore use small windows, the Low graphics setting and `?testfps=N` (caps rendering; test-only).
  Real players each have their own GPU and none of this applies.
- `NETLOG=1 node …` prints the party connection log (`?netlog=1`) for debugging.
- Playwright and Chromium come pre-installed in Claude Code cloud sessions (`require('playwright')`).
