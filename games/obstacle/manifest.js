// Read by the lobby without loading the game. Keep it tiny (no imports).
export const manifest = {
  id: 'obstacle',
  name: 'Ultimate Obstacle Course',
  tagline: 'A bouncy elimination show: race, survive, grab the crown!',
  // Shown on the pre-round screen next to the settings: goal, how to win, key tips (short sentences).
  howTo: [
    "A game show in rounds: race through obstacle courses or survive the hazards to qualify.",
    "Fewer players qualify each round. If you don't qualify, you're out.",
    "In the final round, grab the crown to win the show.",
    "Jump with Space, dive with Shift, and hold E to grab other players or a ledge.",
  ],
  minPlayers: 1,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 240,          // a show of 3–4 rounds, each ~40–110 s; qualifying spots shrink to a final
  thumbnail: 'games/obstacle/thumb.svg',
  controlsHelp: [
    ['WASD / Arrows', 'Run (camera-relative)'], ['Space', 'Jump (hold = higher)'], ['Shift', 'Dive (also in mid-air, once)'],
    ['E (hold)', 'Grab a player, or a ledge in mid-air · Space to climb up'], ['Mouse', 'Look (click to lock) · wheel = zoom'],
    ['When you\'re out / qualified', 'Space or click = watch someone else'],
  ],
  picks: [],
  options: [
    { key: 'rounds', label: 'Show length', default: '3', choices: [{ value: '3', label: '3 rounds' }, { value: '4', label: '4 rounds' }] },
    { key: 'pool', label: 'Stage pool', default: 'all', choices: [{ value: 'all', label: 'All stages', desc: 'Races and survival rounds' }, { value: 'races', label: 'Races only' }, { value: 'survival', label: 'Survival heavy' }] },
    { key: 'final', label: 'Final', default: 'random', choices: [{ value: 'random', label: 'Random final' }, { value: 'crown', label: 'Crown Summit' }, { value: 'last', label: 'Bean Arena' }] },
  ],
};
