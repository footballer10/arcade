// Read by the lobby without loading the game. Keep it tiny (no imports).
export const manifest = {
  id: 'prophunt',
  name: 'Prop Hunt',
  tagline: 'Hide as a toaster. Taunt the seekers. Don\'t get bonked!',
  // Shown on the pre-round screen next to the settings: goal, how to win, key tips (short sentences).
  howTo: [
    "Each round some players are Seekers and the rest are Hiders. Roles rotate so everyone gets to seek.",
    "Hiders: point roughly at an object (a yellow label shows which) and press E or click to turn into it, then hide before the seekers are let out. Props can hop onto counters and shelves. Taunt with F for bonus points; if you stay silent for 45 s you're forced to, and any taunt resets that timer, so pick your moment.",
    "Seekers: left click to bonk suspicious objects. A wrong guess costs health; Q gives a hot / cold hint.",
    "Points for surviving, taunting and finding hiders. Highest total wins, and the last round counts double.",
  ],
  minPlayers: 2,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 180,          // one round ≈ 3 min (20 s hide + hunt); roles rotate until everyone has sought once
  thumbnail: 'games/prophunt/thumb.svg',
  controlsHelp: [
    ['WASD / Arrows', 'Move (Shift = sprint, Space = jump)'], ['Mouse', 'Look (click to lock the mouse)'],
    ['HIDER · E or left click', 'Become the highlighted object (point roughly at it)'], ['HIDER · Q', 'Rotate your disguise'],
    ['HIDER · moving', 'Props shuffle slowly once the hunt starts: pick a spot and lock in'],
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
    { key: 'map', label: 'Map', default: 'mix', choices: [
      { value: 'mix', label: 'New map every round' }, { value: 'house', label: 'Cozy House' },
      { value: 'school', label: 'School' }, { value: 'grocery', label: 'Grocery Store' },
    ] },
    { key: 'seekers', label: 'Seekers', default: 'auto', choices: [
      { value: 'auto', label: 'Auto' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
    ] },
    { key: 'time', label: 'Round time', default: 'normal', choices: [
      { value: 'short', label: 'Short (2 min)' }, { value: 'normal', label: 'Normal (3 min)' }, { value: 'long', label: 'Long (4 min)' },
    ] },
  ],
};
