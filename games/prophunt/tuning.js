// Prop Hunt feel constants. These values are the defaults the game uses (they override the same keys in level.js / sim.js).
// Tune them by playing in the developer portal: run `python3 tools/portal.py` (see docs/PORTAL.md).
import { tunable } from '../../core/tune.js';
import { PHYS } from './level.js';
import { R, T } from './sim.js';

tunable('prophunt', [
  { target: R.SPEED, group: 'Movement', items: {
    SPEED_HIDER:  { value: 4.2, prop: 'H', label: 'Hider walk speed', min: 2, max: 8 },
    SPEED_SEEKER: { value: 4.4, prop: 'S', label: 'Seeker walk speed', min: 2, max: 8 },
  } },
  { target: R, group: 'Movement', items: {
    SPRINT: { value: 1.5, label: 'Sprint multiplier (Shift)', min: 1, max: 2.5 },
    PROP_MOVE: { value: 0.55, label: 'Prop speed while hunted (x walk)', min: 0.2, max: 1.2 },
  } },
  { target: PHYS, group: 'Movement', items: {
    G:         { value: 22,  label: 'Gravity', min: 10, max: 40 },
    JUMP:      { value: 7.0, label: 'Jump power (as a person)', min: 3, max: 12 },
    PROP_JUMP: { value: 8.0, label: 'Jump power (as a prop)', min: 3, max: 13 },
    ACC:       { value: 16,  label: 'Ground acceleration', min: 4, max: 40 },
    AIR:       { value: 5,   label: 'Air control', min: 0, max: 20 },
  } },
  { target: R, group: 'Hunting', items: {
    REACH:    { value: 3.1,  label: 'Bonk reach', min: 1.5, max: 6 },
    BONK_CD:  { value: 0.55, label: 'Bonk cooldown (s)', min: 0.15, max: 2 },
    WRONG:    { value: 10,   label: 'Health lost for a wrong bonk', min: 0, max: 40 },
    FIND_HP:  { value: 20,   label: 'Health back per find', min: 0, max: 60 },
    SNIFF_CD: { value: 22,   label: 'Sniff cooldown (s)', min: 5, max: 60 },
  } },
  { target: T, group: 'Round timing', items: {
    HIDE: { value: 20, label: 'Hiding time (s)', min: 8, max: 45, live: false },
  } },
  { target: T.HUNT, group: 'Round timing', items: {
    HUNT_SHORT:  { value: 100, prop: 'short',  label: 'Hunt length: Short (s)', min: 40, max: 200, live: false },
    HUNT_NORMAL: { value: 155, prop: 'normal', label: 'Hunt length: Normal (s)', min: 60, max: 300, live: false },
    HUNT_LONG:   { value: 215, prop: 'long',   label: 'Hunt length: Long (s)', min: 90, max: 400, live: false },
  } },
]);
