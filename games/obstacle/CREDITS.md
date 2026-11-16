# Ultimate Obstacle Course — credits

Everything in this game is made in code; there are no downloaded asset files.

- Graphics: procedural Three.js geometry (stages, obstacles, crowd stands, light towers, clouds), a custom sky
  gradient and wobbling slime shader, canvas-drawn textures (candy stripes, checker flag, conveyor chevrons, FINISH
  banner). Contestants are the hub's shared bean avatar with the player's party color and hat; the final's crown is
  the hub's own crown hat, scaled up. `thumb.svg` drawn by hand.
- Sound and music: synthesized at runtime with the Web Audio API through the hub's shared audio engine
  (master / music / sfx buses), see `audio.js`.
- Libraries: Three.js 0.160.0 (MIT) from the hub's import map.
