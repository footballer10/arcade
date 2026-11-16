// Read by the lobby without loading the game. Keep it tiny (no imports).
export const manifest = {
  id: 'lava',
  name: 'Rising Lava',
  tagline: 'The floor is lava, and it\'s rising. Last one standing!',
  minPlayers: 1,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 240,          // best of 5 (first to 3): 3–5 rounds of ~60–80 s
  thumbnail: 'games/lava/thumb.svg',
  controlsHelp: [
    ['WASD / Arrows', 'Run (camera-relative)'], ['Space', 'Jump (hold = higher)'], ['Shift', 'Dash (works once in the air)'],
    ['Left click / E', 'Shove'], ['Mouse', 'Look (click to lock the mouse) · wheel = zoom'],
    ['Glowing rock', 'Hot! It crumbles if you stay on it'], ['Click while out', 'Switch who you watch'],
  ],
  picks: [],
  options: [
    { key: 'match', label: 'Match', default: 'bo5', choices: [{ value: 'bo5', label: 'Best of 5' }, { value: 'bo3', label: 'Best of 3' }, { value: 'one', label: 'One round' }] },
    { key: 'arena', label: 'Arena', default: 'mix', choices: [{ value: 'mix', label: 'New arena every round' }, { value: 'causeway', label: 'Giant\'s Causeway' }, { value: 'corkscrew', label: 'Corkscrew' }, { value: 'archipelago', label: 'Archipelago' }, { value: 'ringfire', label: 'Ring of Fire' }] },
  ],
};
