// Read by the lobby without loading the game. Keep it tiny (no imports).
export const manifest = {
  id: 'snake',
  name: 'Snake Royale',
  tagline: 'Eat, grow, cut them off. The ring is closing!',
  minPlayers: 1,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 150,
  thumbnail: 'games/snake/thumb.svg',
  controlsHelp: [
    ['Mouse', 'Steer (your snake chases the pointer)'], ['WASD / Arrows', 'Steer with keys instead'],
    ['Shift / Space / Left click (hold)', 'Boost: faster, but you shed length'],
    ['Hit a body', 'Your head into any other snake = you pop'], ['Golden Bloom', 'Beacon = gold orbs in 3 s. Race for it!'],
    ['👑 King Snake', 'The biggest snake drops gold when popped'], ['Click while out', 'Switch who you watch'],
  ],
  picks: [
    { key: 'skin', label: 'Skin pattern', default: 'stripes', choices: [
      { value: 'stripes', label: 'Stripes', desc: 'Classic bright bands' }, { value: 'dots', label: 'Dots', desc: 'Glowing spots' },
      { value: 'bands', label: 'Two-tone', desc: 'Dark and light blocks' }, { value: 'neon', label: 'Neon', desc: 'Extra glow, shimmering' },
    ] },
  ],
  options: [
    { key: 'mode', label: 'Mode', default: 'royale', choices: [{ value: 'royale', label: 'Royale (one life)', desc: 'Last snake slithering wins' }, { value: 'frenzy', label: 'Frenzy (respawns)', desc: 'Biggest at the buzzer wins' }] },
    { key: 'map', label: 'Arena', default: 'random', choices: [{ value: 'random', label: 'Random' }, { value: 'open', label: 'Open Pit' }, { value: 'rocks', label: 'Asteroid Belt' }] },
    { key: 'blooms', label: 'Golden Blooms', default: 'on', choices: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
    { key: 'len', label: 'Round length', default: '150', choices: [{ value: '90', label: 'Quick (1:30)' }, { value: '150', label: 'Normal (2:30)' }, { value: '210', label: 'Long (3:30)' }] },
  ],
};
