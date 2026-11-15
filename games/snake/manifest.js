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
    ['Hit a body', 'Your head into any other snake = you pop'], ['Click while out', 'Switch who you watch'],
  ],
  picks: [],
  options: [
    { key: 'len', label: 'Round length', default: '150', choices: [{ value: '90', label: 'Quick (1:30)' }, { value: '150', label: 'Normal (2:30)' }, { value: '210', label: 'Long (3:30)' }] },
  ],
};
