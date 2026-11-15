export const manifest = {
  id: 'golf',
  name: 'Mini-Golf Battle',
  tagline: "Same hole, same time. Knock 'em in the water!",
  minPlayers: 2,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 200,           // 3 holes × up to 60 s + scorecards
  thumbnail: 'games/golf/thumb.svg',
  controlsHelp: [['Left drag', 'Pull back from your ball & release to shoot'], ['Right drag', 'Orbit camera (right-click while aiming cancels)'], ['Mouse wheel', 'Zoom'], ['E', 'Use power-up'], ['Space', 'Recenter camera']],
  picks: [],
  options: [
    { key: 'holes', label: 'Holes', choices: [{ value: '1', label: '1 hole' }, { value: '3', label: '3 holes' }, { value: '6', label: '6 holes' }, { value: '9', label: '9 holes' }], default: '3' },
  ],
};
