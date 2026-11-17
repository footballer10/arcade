// Mini-Golf feel constants. These values are the defaults the game uses (they override the same keys in course.js).
// Tune them by playing in the developer portal: run `python3 tools/portal.py` (see docs/PORTAL.md).
import { tunable } from '../../core/tune.js';
import { PHYS } from './course.js';

tunable('golf', [
  { target: PHYS, group: 'Ball', items: {
    MAX_SPEED: { value: 14,   label: 'Full-power shot speed', min: 6, max: 26 },
    ROLL:      { value: 0.9,  label: 'Rolling friction', min: 0.2, max: 2.5 },
    DAMP:      { value: 0.35, label: 'Speed damping', hint: 'slows fast balls more than slow ones', min: 0, max: 1.2 },
    STOP:      { value: 0.12, label: 'Stop speed', hint: 'below this the ball settles', min: 0.02, max: 0.5 },
    CUP_SPEED: { value: 4.6,  label: 'Max speed that still drops in the cup', min: 1.5, max: 10 },
  } },
]);
