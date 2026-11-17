// Coin Grab feel constants. The values written here ARE the game's defaults: the game reads them from RULES.
// Tune them while playing in the developer portal: run `python3 tools/portal.py` (see docs/PORTAL.md).
// Every game has a tuning.js like this. Add a line for each number that changes how the game feels.
import { tunable } from '../../core/tune.js';

export const RULES = {};

tunable('coingrab', [
  { target: RULES, group: 'Movement', items: {
    SPEED: { value: 7,  label: 'Run speed', min: 2, max: 16 },
    ACCEL: { value: 12, label: 'Acceleration', hint: 'how quickly you reach full speed', min: 2, max: 40 },
    JUMP:  { value: 7,  label: 'Jump power', min: 2, max: 14 },
    GRAV:  { value: 22, label: 'Gravity', min: 6, max: 50 },
  } },
  { target: RULES, group: 'Round', items: {
    ROUND: { value: 45, label: 'Round length (s)', min: 15, max: 180, live: false },
  } },
]);
