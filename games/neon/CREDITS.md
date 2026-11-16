# Neon Rush — credits

Everything in Neon Rush is made in code at runtime. There are no downloaded asset packs, so there is nothing to license.

| What | How it is made |
|---|---|
| Tracks | `tracks.js`: turtle-style track definitions swept into 3D frames (loops, corkscrews, banking, wall-ride pipes, jumps, shortcuts) |
| Track surface, walls, boost strips, start gate, pylons | `render.js`: procedural meshes and small canvas textures |
| City, windows, neon grid ground, synthwave sky and sun | `render.js`: instanced boxes plus GLSL shaders |
| Ships | `ships.js`: hand-written low-poly hull geometry in the player's party colour, with the player's own avatar and hat from `core/avatar.js` as the pilot |
| Trails, sparks, glows | `ships.js`: dynamic ribbons and pooled point sprites |
| Music and sound effects | `audio.js`: synthesized live with the Web Audio API through the shared `core/audio.js` buses |
| Font | Lilita One (Google Fonts, SIL Open Font License), loaded by the hub |
| Libraries | three.js 0.160.0 (MIT) and PeerJS 1.5.4 (MIT), from jsDelivr through the hub's import map |

There are no asset files: total asset size is 0 bytes.
