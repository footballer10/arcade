# Architecture and networking (read only when changing `/core` or a game's netcode)

## Files
```
index.html          the hub page (the only HTML page): import map, #stage (game), #hud (zones), hub screens
core/hub.js         party loop: home → lobby → (host pick | vote | shuffle playlist) → pre-round picks → loading
                    → countdown → play → results (+ trophies, rematch) → lobby / next shuffle game → podium (+ awards)
                    Also: team mode, crowd (out players), profile recording. Party state `S` lives here.
core/net.js         PartyNet: host-authoritative star; 4-letter room codes; heartbeats + host clock; host migration;
                    handover; rejoin after refresh / Wi-Fi drop; relay → direct upgrade; per-round game channels
core/transport-dual.js   every online party: direct WebRTC and the relay at the same time (direct preferred)
core/transport-peer.js   PeerJS WebRTC: reliable JSON 'ctrl' + unreliable binary 'fast'; STUN + TURN (turn-config.js)
core/transport-rtc.js    WebRTC set up through the relay (networks that block the PeerJS server, e.g. school)
core/transport-relay.js  backup relay over free MQTT brokers (core/mqtt.js); binary frames, drops instead of queueing
core/transport-local.js  BroadcastChannel (?net=local, tests / offline solo)
core/keepalive.js   worker-driven 1 s clock: heartbeats, pings, reconnects keep running in background tabs
core/netsim.js      ?netsim=ONEWAY,JITTER,STALL,EVERY lag simulator (100,30,250,4 ≈ the school relay)
core/interp.js      SnapBuffer / AdaptiveDelay: smooth drawing of others from late, bunched snapshots
core/runtime.js     builds ctx, runs frame/tick loops (ticks in step with drawn frames), force-cleans on stop
core/music.js       ctx.music(style)          core/profile.js   lifetime stats, titles, unlocks (localStorage)
core/awards.js      podium awards from S.history   core/bots.js   bot slots + difficulty tiers
core/avatar.js      player character, hats, dances   core/input.js   control map   core/ui.js + ui.css   theme + HUD
core/audio.js       one AudioContext, master/music/sfx buses   core/settings.js   volumes, sensitivity, quality
core/tune.js        tuning.js registry   core/portal.js + tools/portal.py   developer tuning portal (localhost only)
games/registry.js   game manifests (PLAYABLE = what players see); games load with import() when a round starts
```

## Networking rules for games
- The host runs the simulation and every bot; clients send inputs and predict their own player.
- Some players are on the relay (~200 ms round trip, jittery, packets arrive bunched). Games must stay fun at that:
  - predict your own player; never wait on the host for your own movement;
  - draw others with `core/interp.js` (`SnapBuffer`, or `AdaptiveDelay` for an existing buffer) placed on the
    HOST's clock. Never interpolate by arrival time or with a fixed "100 ms in the past";
  - correct your own player against where you were one round trip ago, not where you are now.
  - `games/_template` shows the pattern. Test with `?netsim=100,30,250,4` and `node lag.mjs <id>`.
- Keep traffic modest: ≈20 Hz snapshots, compact data; binary via `rawToAll` / `rawToHost` for big state.
- If the host leaves, the first remaining human becomes host and the game gets `'hostchange'`: rebuild the
  authoritative state from the latest snapshot. Mid-round joiners spectate (`ctx.spectator`); send them a full sync on `'join'`.

## Connections (how players reach each other)
1. Direct WebRTC via the public PeerJS server, with STUN + the Metered TURN server (`core/turn-config.js`).
2. If the PeerJS server is blocked: WebRTC set up through the relay (`transport-rtc.js`).
3. If WebRTC is blocked entirely: the MQTT relay. Relay players retry direct in the background and switch mid-game.
Settings → "Copy connection report" shows the path, ping spread, freezes and why direct failed; a failed join offers
"Copy details". Protocol version: `PROTOCOL` in net.js (bump on wire changes; stale tabs are told to refresh).

## Dev URL flags
`?dev=1` show the template · `?net=local` tabs, no internet · `?peer=host:port` own PeerJS server · `?relay=url` own MQTT
broker (`off` = none) · `?forcerelay=1` / `=join` skip direct (tests) · `?blockdirect=1` · `?netsim=…` · `?netlog=1` ·
`?testfps=N` (tests) · `?portal=1` (tuning portal, localhost only).
