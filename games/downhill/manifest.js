export const manifest = {
  id: 'downhill',
  name: 'Downhill Rush',
  tagline: 'Ski or board to the bottom. Tricks = speed!',
  minPlayers: 2,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 120,
  thumbnail: 'games/downhill/thumb.svg',
  controlsHelp: [
    ['A / D', 'Steer (tap = small, hold = carve)'], ['W', 'Tuck (go faster)'], ['S', 'Brake'], ['Space', 'Jump / pop off rails'],
    ['Arrows in the air', 'Spin ← → · flip ↑ ↓'], ['R F T G C V', 'Hold in the air to grab, let go before landing'],
    ['E / click', 'Use item'], ['Q', 'Butter 180'], ['H', 'Show / hide trick list'],
  ],
  picks: [
    { key: 'cls', label: 'Ride as', default: 'ski', choices: [
      { value: 'ski', label: 'Skier', desc: 'Sharp turns, faster on groomed snow' },
      { value: 'board', label: 'Snowboarder', desc: 'Big air, tricks = speed, loves powder' },
    ] },
  ],
  options: [
    { key: 'map', label: 'Mountain', default: 'random', choices: [{ value: 'random', label: 'Random' }, { value: 'alpine', label: 'Alpine Classic' }, { value: 'park', label: 'Night Park' }, { value: 'powder', label: 'Powder Forest' }, { value: 'glacier', label: 'Sunset Glacier' }] },
    { key: 'gmode', label: 'Mode', default: 'race', choices: [{ value: 'race', label: 'Race' }, { value: 'tricks', label: 'Trick Battle' }] },
    { key: 'items', label: 'Items', default: 'on', choices: [{ value: 'on', label: 'Items on' }, { value: 'off', label: 'Items off' }] },
  ],
};
