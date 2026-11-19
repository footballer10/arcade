// Read by the lobby without loading the game. Keep it tiny (no imports).
export const manifest = {
  id: 'floorfall',
  name: 'Floor Is Falling',
  tagline: 'Every step breaks the floor. Fall through the layers, don\'t fall out!',
  // Shown on the pre-round screen next to the settings: goal, how to win, key tips (short sentences).
  howTo: [
    "You start on a stack of hexagon floors above a glowing void.",
    "Every tile you touch cracks and drops about a second later, so keep moving and plan your route.",
    "Fall through a hole to land on the floor below. Fall off the bottom floor and you're out.",
    "Last one standing wins the round. First to win 2 rounds wins. Hold the mouse button to run towards the cursor; jump to cross gaps (Space twice = double jump), E to dive, and dash with Shift to bump others.",
  ],
  minPlayers: 1,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 210,          // best of 3 (first to 2): 2–3 rounds of ~60–90 s
  thumbnail: 'games/floorfall/thumb.svg',
  controlsHelp: [
    ['WASD / Arrows', 'Run'], ['Hold mouse button', 'Run towards the cursor (any angle, slow near it)'], ['Space', 'Jump (cross a gap, or stall on a cracking tile) · press again in the air to double jump'], ['E', 'Dive: plunge down fast in the air to land sooner'], ['Shift', 'Dash (bumps players · works in the air)'],
    ['Every tile you touch', 'Cracks, then drops ~1 s later'], ['Fall through a hole', 'Land on the layer below · off the bottom = out'],
  ],
  picks: [],
  options: [
    { key: 'match', label: 'Match', default: 'bo3', choices: [{ value: 'bo3', label: 'Best of 3' }, { value: 'bo5', label: 'Best of 5' }, { value: 'one', label: 'One round' }] },
    { key: 'layers', label: 'Layers', default: '4', choices: [{ value: '3', label: '3 layers' }, { value: '4', label: '4 layers' }, { value: '5', label: '5 layers' }] },
    { key: 'delay', label: 'Tile drop', default: 'normal', choices: [{ value: 'casual', label: 'Casual', desc: 'Tiles hold ~1.1 s' }, { value: 'normal', label: 'Normal', desc: '~0.8 s' }, { value: 'fast', label: 'Fast', desc: '~0.5 s' }] },
    { key: 'shape', label: 'Layer shapes', default: 'random', choices: [{ value: 'random', label: 'Random mix' }, { value: 'hex', label: 'Hex discs' }, { value: 'ring', label: 'Rings' }, { value: 'cross', label: 'Crosses' }] },
  ],
};
