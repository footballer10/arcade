// Rising Lava feel constants. These values are the defaults the game uses (they override the same keys in world.js).
// Tune them by playing in the developer portal: run `python3 tools/portal.py` (see docs/PORTAL.md).
import { tunable } from '../../core/tune.js';
import { C } from './world.js';

tunable('lava', [
  { target: C, group: 'Running & jumping', items: {
    RUN:      { value: 7.8,  label: 'Run speed', min: 4, max: 14 },
    ACC_G:    { value: 85,   label: 'Ground acceleration', min: 20, max: 200 },
    ACC_A:    { value: 50,   label: 'Air control', min: 5, max: 150 },
    JUMP:     { value: 11.2, label: 'Jump power', min: 6, max: 18 },
    G:        { value: 27,   label: 'Gravity', min: 10, max: 50 },
    FALL_MUL: { value: 1.15, label: 'Extra gravity when falling', min: 1, max: 2.5 },
    COYOTE:   { value: 0.18, label: 'Coyote time (s)', hint: 'jump still works this long after leaving a ledge', min: 0, max: 0.4 },
    BUFFER:   { value: 0.22, label: 'Jump buffer (s)', hint: 'early Space presses still count', min: 0, max: 0.4 },
  } },
  { target: C, group: 'Dash & shove', items: {
    DASH_V:   { value: 15.5, label: 'Dash speed', min: 6, max: 30 },
    DASH_CD:  { value: 0.9,  label: 'Dash cooldown (s)', min: 0.2, max: 3 },
    SHOVE_KB: { value: 11.5, label: 'Shove knockback', min: 3, max: 25 },
    SHOVE_R:  { value: 2.0,  label: 'Shove reach', min: 0.8, max: 4 },
    SHOVE_CD: { value: 0.75, label: 'Shove cooldown (s)', min: 0.2, max: 3 },
    STUN:     { value: 0.38, label: 'Stun after a hit (s)', min: 0, max: 1.5 },
  } },
  { target: C, group: 'Platforms', items: {
    HEAT_UP:   { value: 0.21, label: 'Heat-up speed while standing', min: 0.05, max: 0.6 },
    COOL:      { value: 0.26, label: 'Cool-down speed', min: 0.05, max: 0.8 },
    CRUMBLE_T: { value: 0.5,  label: 'Crumble time (s)', min: 0.1, max: 2 },
    REGROW_T:  { value: 6.5,  label: 'Regrow time (s)', min: 1, max: 20 },
  } },
  { target: C, group: 'Lava', items: {
    LAVA_V0:  { value: 0.1,    label: 'Starting rise speed', min: 0.02, max: 0.4, live: false },
    LAVA_ACC: { value: 0.0024, label: 'Rise acceleration', min: 0.0005, max: 0.008, live: false },
    GEN_T:    { value: 95,     label: 'New rock stops rising at (s)', min: 30, max: 180, live: false },
  } },
  { target: C, group: 'Volcano spirits', items: {
    BOMB_KB:  { value: 9.5, label: 'Lava bomb knockback', min: 2, max: 20 },
    GHOST_CD: { value: 6,   label: 'Bomb cooldown (s)', min: 1, max: 15 },
  } },
]);
