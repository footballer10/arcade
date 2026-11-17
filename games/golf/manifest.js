export const manifest = {
  id: 'golf',
  name: 'Mini-Golf Battle',
  tagline: "Same hole, same time. Knock 'em in the water!",
  // Shown on the pre-round screen next to the settings: goal, how to win, key tips (short sentences).
  howTo: [
    "Everyone plays the same hole at the same time, and the balls bump into each other.",
    "Click and drag back from your ball, then let go to putt. The dots show where it will roll.",
    "Classic: fewest strokes wins. Water or falling off costs +1 stroke. Speed Golf: be first in the cup for points.",
    "Roll through ? boxes for power-ups and press E to use them. Knock a rival into the water for a KO bonus.",
  ],
  minPlayers: 2,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 200,           // 3 holes × up to 60 s + flyovers + scorecards
  thumbnail: 'games/golf/thumb.svg',
  controlsHelp: [
    ['Left drag', 'Pull back from your ball & release to shoot (dots show the path)'], ['Right drag', 'Orbit camera · right-click while aiming cancels'],
    ['Mouse wheel', 'Zoom'], ['E', 'Use power-up'], ['Space', 'Recenter camera'], ['1 – 4', 'Emotes'], ['Click / ← →', 'Switch who you spectate (after you finish)'],
  ],
  picks: [],
  options: [
    { key: 'mode', label: 'Mode', default: 'classic', choices: [{ value: 'classic', label: 'Classic (fewest strokes)' }, { value: 'speed', label: 'Speed Golf (race for points)' }] },
    { key: 'holes', label: 'Holes', default: '3', choices: [{ value: '1', label: '1' }, { value: '3', label: '3' }, { value: '6', label: '6' }, { value: '9', label: '9' }] },
    { key: 'time', label: 'Time per hole', default: '60', choices: [{ value: '45', label: '45 s' }, { value: '60', label: '60 s' }, { value: '90', label: '90 s' }] },
    { key: 'items', label: 'Power-ups', default: 'normal', choices: [{ value: 'normal', label: 'Normal' }, { value: 'chaos', label: 'Chaos' }, { value: 'off', label: 'Off' }] },
    { key: 'mods', label: 'Hole modifiers', default: 'on', choices: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
  ],
};
