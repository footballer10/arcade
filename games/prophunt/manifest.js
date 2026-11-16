// Read by the lobby without loading the game. Keep it tiny (no imports).
export const manifest = {
  id: 'prophunt',
  name: 'Prop Hunt',
  tagline: 'Hide as a toaster. Taunt the seekers. Don\'t get bonked!',
  minPlayers: 2,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 180,          // one round ≈ 3 min (20 s hide + hunt); roles rotate until everyone has sought once
  thumbnail: 'games/prophunt/thumb.svg',
  controlsHelp: [
    ['WASD / Arrows', 'Move (Shift = sprint, Space = jump)'], ['Mouse', 'Look (click to lock the mouse)'],
    ['HIDER · E', 'Become the object you look at'], ['HIDER · Q', 'Rotate your disguise'],
    ['HIDER · Right click', 'Lock in place (no wobble)'], ['HIDER · F', 'Taunt for bonus points (braver = more)'],
    ['SEEKER · Left click', 'Bonk a suspicious object (wrong guess costs health)'], ['SEEKER · Q', 'Sniff: hot / cold hint'],
    ['When found', 'Space / click = switch who you watch'],
  ],
  picks: [
    { key: 'taunt', label: 'Your taunt sound', default: 'kazoo', choices: [
      { value: 'kazoo', label: '🎺 Kazoo' }, { value: 'quack', label: '🦆 Quack' }, { value: 'honk', label: '📯 Honk' },
      { value: 'slide', label: '🎶 Slide whistle' }, { value: 'boing', label: '🌀 Boing' }, { value: 'cuckoo', label: '🐦 Cuckoo' },
    ] },
  ],
  options: [
    { key: 'map', label: 'Map', default: 'house', choices: [{ value: 'house', label: 'Cozy House' }] },
    { key: 'seekers', label: 'Seekers', default: 'auto', choices: [
      { value: 'auto', label: 'Auto' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
    ] },
    { key: 'time', label: 'Round time', default: 'normal', choices: [
      { value: 'short', label: 'Short (2 min)' }, { value: 'normal', label: 'Normal (3 min)' }, { value: 'long', label: 'Long (4 min)' },
    ] },
  ],
};
