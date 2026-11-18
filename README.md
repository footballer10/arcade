# Party Arcade

A free browser party-game hub: create a party, share the 4-letter code or link, and play a session of 3D mini-games
together without ever leaving the party. Host-authoritative peer-to-peer (PeerJS/WebRTC), static files only.

**Play:** https://footballer10.github.io/arcade/

Games: Mini-Golf Battle, Downhill Rush, Arena Royale, Snake Royale, Rising Lava, Neon Rush, Ultimate Obstacle Course, Floor Is Falling, Prop Hunt and Rocket Soccer. (`games/_template`, "Coin Grab", is the developer template new games copy; players never see it.)
Old links (`/golf/`, `/downhill/`, `/arena/`) redirect to the hub.

- Run locally: `python3 -m http.server 8000` in this folder, then open http://localhost:8000 (add `?net=local` to play in two tabs without internet).
- Tune how games feel: `python3 tools/portal.py` opens the developer tuning portal on your own computer (play any game, adjust its constants with sliders, save new defaults). See [`docs/PORTAL.md`](docs/PORTAL.md).
- Developers / Claude Code sessions: read [`CLAUDE.md`](CLAUDE.md) and [`docs/ADDING_A_GAME.md`](docs/ADDING_A_GAME.md).
- Tests: [`tests/README.md`](tests/README.md).
