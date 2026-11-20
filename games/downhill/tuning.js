// Downhill feel constants. These values are the defaults the game uses (they override the same keys in physics.js).
// Tune them by playing in the developer portal: run `python3 tools/portal.py` (see docs/PORTAL.md).
import { tunable } from '../../core/tune.js';
import { PHYS, CLASSES } from './physics.js';

tunable('downhill', [
  { target: PHYS, group: 'Slope', items: {
    G:     { value: 14,   label: 'Slope pull (acceleration)', min: 5, max: 30 },
    VMAX:  { value: 58,   label: 'Top speed', min: 25, max: 100 },
    FRIC:  { value: 0.45, label: 'Snow friction', min: 0, max: 2 },
    BRAKE: { value: 13,   label: 'Brake strength', min: 3, max: 30 },
    GRAV:  { value: 19,   label: 'Gravity in the air', min: 8, max: 35 },
  } },
  { target: PHYS, group: 'Tricks', items: {
    SPIN_LIM:      { value: 1.25, label: 'Landing forgiveness: spins (rad)', min: 0.4, max: 1.6 },
    FLIP_LIM:      { value: 0.95, label: 'Landing forgiveness: flips (rad)', min: 0.3, max: 1.6 },
    GRAB_MIN:      { value: 0.3,  label: 'Min grab hold (s)', min: 0.05, max: 1 },
    GRAB_REPEAT:   { value: 0.6,  label: 'Repeat grab value (x per earlier use)', min: 0.2, max: 1 },
    GRAB_FLOOR:    { value: 0.15, label: 'Lowest repeat grab value', min: 0, max: 0.6 },
    MIN_TRICK_AIR: { value: 0.75, label: 'Min airtime for a trick (s)', min: 0.2, max: 2 },
  } },
  { target: CLASSES.ski, group: 'Skier', items: {
    SKI_TURN:   { value: 2.5,  prop: 'turn',       label: 'Turning', min: 0.8, max: 5 },
    SKI_TUCK:   { value: 0.0029, prop: 'dragTuck', label: 'Air drag when tucked', min: 0.0005, max: 0.008 },
    SKI_POWDER: { value: 2.6,  prop: 'powderFric', label: 'Powder slowdown', min: 0, max: 6 },
    SKI_JUMP:   { value: 5.0,  prop: 'jumpV',      label: 'Jump power', min: 2, max: 10 },
    SKI_AIR:    { value: 1.05, prop: 'airMult',    label: 'Kicker launch boost', min: 0.6, max: 2 },
    SKI_SPIN:   { value: 6.981, prop: 'spinRate',  label: 'Spin speed (rad/s)', min: 3, max: 14 },
    SKI_FLIP:   { value: 5.712, prop: 'flipRate',  label: 'Flip speed (rad/s)', min: 2.5, max: 12 },
  } },
  { target: CLASSES.board, group: 'Snowboarder', items: {
    BOARD_TURN:   { value: 1.65, prop: 'turn',       label: 'Turning', min: 0.6, max: 4 },
    BOARD_TUCK:   { value: 0.0031, prop: 'dragTuck', label: 'Air drag when tucked', min: 0.0005, max: 0.008 },
    BOARD_POWDER: { value: 1.4,  prop: 'powderFric', label: 'Powder slowdown', min: 0, max: 6 },
    BOARD_JUMP:   { value: 5.5,  prop: 'jumpV',      label: 'Jump power', min: 2, max: 10 },
    BOARD_AIR:    { value: 1.2,  prop: 'airMult',    label: 'Kicker launch boost', min: 0.6, max: 2 },
    BOARD_SPIN:   { value: 8.727, prop: 'spinRate',  label: 'Spin speed (rad/s)', min: 3, max: 16 },
    BOARD_FLIP:   { value: 6.614, prop: 'flipRate',  label: 'Flip speed (rad/s)', min: 2.5, max: 13 },
  } },
]);
