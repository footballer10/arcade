# Party Arcade

A free browser party-game hub: create a party, share the 4-letter code or link, and play a night of 3D mini-games
together without ever leaving the party. Host-authoritative peer-to-peer (PeerJS/WebRTC), static files only.

**Play:** https://footballer10.github.io/arcade-prototypes/

Games: **Mini-Golf Battle**, **Downhill Rush**, **Arena Royale**, and **Coin Grab** (the template every new game copies).
Old links (`/golf/`, `/downhill/`, `/arena/`) redirect to the hub.

- Run locally: `python3 -m http.server 8000` in this folder, then open http://localhost:8000 (add `?net=local` to play in two tabs without internet).
- Developers / Claude Code sessions: read [`CLAUDE.md`](CLAUDE.md) and [`docs/ADDING_A_GAME.md`](docs/ADDING_A_GAME.md).
- Tests: [`tests/README.md`](tests/README.md).
