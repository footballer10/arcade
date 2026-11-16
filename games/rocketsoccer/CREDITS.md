# Rocket Soccer — credits

Everything in Rocket Soccer is made in code at runtime. There are no downloaded asset packs, so there is nothing to license.

| What | How it is made |
|---|---|
| Arena | `arena.js` + `render.js`: an analytic rounded-box signed distance field (shared with the physics), meshed procedurally; pitch stripes, glowing lines, team-tinted walls, hex glass and goal nets are drawn by a GLSL field shader |
| Cars | `render.js`: chunky low-poly cars in the team colour with party-colour accents, and the player's own avatar from `core/avatar.js` at the wheel |
| Ball | `render.js`: an icosphere with panel colours computed per vertex |
| Particles, rings, boost trails | `fx.js`: pooled additive point sprites and expanding rings |
| Sound | `audio.js`: synthesized live with the Web Audio API through the shared `core/audio.js` buses |
| Font | Lilita One (Google Fonts, SIL Open Font License), loaded by the hub |
| Libraries | three.js 0.160.0 (MIT) and PeerJS 1.5.4 (MIT), from jsDelivr through the hub's import map |

There are no asset files: total asset size is 0 bytes.
