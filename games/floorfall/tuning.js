// Floor Fall feel constants. These values are the defaults the game uses (they override the same keys in world.js).
// Tune them by playing in the developer portal: run `python3 tools/portal.py` (see docs/PORTAL.md).
import { tunable } from '../../core/tune.js';
import { C } from './world.js';

tunable('floorfall', [
  { target: C, group: 'Movement', items: {
    SPEED:   { value: 6.0,  label: 'Run speed', min: 2.5, max: 11 },
    ACC:     { value: 62,   label: 'Ground acceleration', min: 15, max: 150 },
    AIR_ACC: { value: 20,   label: 'Air control', min: 0, max: 80 },
    JUMP:    { value: 8.4,  label: 'Jump power', min: 4, max: 14 },
    DIVE_V:  { value: 19,   label: 'Dive speed', hint: 'Space again in the air', min: 6, max: 30 },
    G:       { value: 25,   label: 'Gravity', min: 10, max: 50 },
    COYOTE:  { value: 0.2, label: 'Coyote time (s)', hint: 'jump still works this long after a tile drops', min: 0, max: 0.35 },
  } },
  { target: C, group: 'Dash & bumps', items: {
    DASH_V:  { value: 13.5, label: 'Dash speed', min: 5, max: 25 },
    DASH_CD: { value: 1.6,  label: 'Dash cooldown (s)', min: 0.3, max: 4 },
    BUMP:    { value: 7,  label: 'Bump knockback', min: 2, max: 18 },
    STUN:    { value: 0.3,  label: 'Stun after a bump (s)', min: 0, max: 1.5 },
  } },
  { target: C.DELAYS, group: 'Tiles', items: {
    DELAY_CASUAL: { value: 1.1,  prop: 'casual', label: 'Tile drop delay: Casual (s)', min: 0.2, max: 2.5, live: false },
    DELAY_NORMAL: { value: 0.8, prop: 'normal', label: 'Tile drop delay: Normal (s)', min: 0.15, max: 1.5, live: false },
    DELAY_FAST:   { value: 0.5, prop: 'fast',   label: 'Tile drop delay: Fast (s)', min: 0.1, max: 1, live: false },
  } },
  { target: C, group: 'Round', items: {
    COLLAPSE_AT: { value: 100, label: 'Floors start collapsing at (s)', min: 20, max: 200 },
  } },
]);
