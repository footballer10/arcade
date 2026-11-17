// Obstacle course feel constants. These values are the defaults the game uses (they override the same keys in world.js).
// Tune them by playing in the developer portal: run `python3 tools/portal.py` (see docs/PORTAL.md).
import { tunable } from '../../core/tune.js';
import { C } from './world.js';

tunable('obstacle', [
  { target: C, group: 'Running & jumping', items: {
    RUN:      { value: 7.4,  label: 'Run speed', min: 3, max: 13 },
    ACC:      { value: 62,   label: 'Ground acceleration', min: 15, max: 150 },
    AIR_ACC:  { value: 22,   label: 'Air control', min: 0, max: 80 },
    JUMP:     { value: 11.6, label: 'Jump power', min: 6, max: 18 },
    GRAV:     { value: 32,   label: 'Gravity', min: 12, max: 60 },
    JUMP_CUT: { value: 46,   label: 'Short-hop pull', hint: 'extra gravity after letting go of Space early', min: 0, max: 120 },
    COYOTE:   { value: 0.11, label: 'Coyote time (s)', min: 0, max: 0.35 },
    JBUF:     { value: 0.14, label: 'Jump buffer (s)', min: 0, max: 0.4 },
  } },
  { target: C, group: 'Dive', items: {
    DIVE:     { value: 10.8, label: 'Dive speed', min: 4, max: 18 },
    DIVE_UP:  { value: 5.4,  label: 'Dive lift', min: 0, max: 10 },
    SLIDE_T:  { value: 0.38, label: 'Belly-slide time (s)', min: 0.1, max: 1.2 },
  } },
  { target: C, group: 'Ledges, hits & grabs', items: {
    HANG_MAX: { value: 4,    label: 'Max ledge hang (s)', min: 1, max: 10 },
    HIT_MIN:  { value: 6,    label: 'Obstacle knockback (min)', min: 2, max: 14 },
    HIT_MAX:  { value: 15,   label: 'Obstacle knockback (max)', min: 6, max: 30 },
    DOWN_T:   { value: 0.9,  label: 'Knocked-down time (s)', min: 0.2, max: 2.5 },
    GRAB_R:   { value: 1.55, label: 'Grab reach', min: 0.6, max: 3 },
    GRAB_T:   { value: 2.6,  label: 'Max grab hold (s)', min: 0.5, max: 6 },
    GRAB_CD:  { value: 1.2,  label: 'Grab cooldown (s)', min: 0.2, max: 4 },
  } },
]);
