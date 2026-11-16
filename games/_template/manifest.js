// Read by the lobby without loading the game. Keep it tiny (no imports of three.js etc.).
// TEMPLATE: hidden from players (see games/registry.js); visible in the lobby only with ?dev=1.
export const manifest = {
  id: 'coingrab',               // unique, lowercase; also the key used for saved picks
  dir: '_template',             // folder name under /games (defaults to id)
  name: 'Coin Grab',
  tagline: 'Grab the most coins in 45 seconds!',
  minPlayers: 1,
  maxPlayers: 8,
  teams: false,                 // false | 2
  supportsBots: true,
  roundLengthSec: 45,
  thumbnail: 'games/_template/thumb.svg',
  // Extra keys this game uses on top of the standard control map (CLAUDE.md). Shown on the loading screen.
  controlsHelp: [['WASD / Arrows', 'Run'], ['Space', 'Jump'], ['Gold coin', '1 point · Gem = 3 points']],
  // Optional pre-round screen. picks = each player chooses; options = host chooses.
  picks: [],
  options: [
    { key: 'gems', label: 'Gems', choices: [{ value: 'on', label: 'Gems on' }, { value: 'off', label: 'Coins only' }], default: 'on' },
  ],
};
