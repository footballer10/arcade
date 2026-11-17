// Neon racer feel constants. These values are the defaults the game uses (they override the same keys in physics.js).
// Tune them by playing in the developer portal: run `python3 tools/portal.py` (see docs/PORTAL.md).
import { tunable } from '../../core/tune.js';
import { C } from './physics.js';

tunable('neon', [
  { target: C, group: 'Speed', items: {
    VMAX:      { value: 60, label: 'Top speed', min: 30, max: 110 },
    VPAD:      { value: 80, label: 'Speed-pad top speed', min: 40, max: 140 },
    VBOOST:    { value: 86, label: 'Boost top speed', min: 40, max: 150 },
    ACC:       { value: 30, label: 'Acceleration', min: 8, max: 80 },
    ACC_BOOST: { value: 75, label: 'Boost acceleration', min: 20, max: 160 },
    BRAKE:     { value: 60, label: 'Brake strength', min: 15, max: 140 },
  } },
  { target: C, group: 'Handling', items: {
    TURN_LO:   { value: 2.3, label: 'Turning at low speed', min: 0.8, max: 5 },
    TURN_HI:   { value: 1.2, label: 'Turning at top speed', min: 0.4, max: 3 },
    GRIP:      { value: 9,   label: 'Grip', hint: 'how fast sideways slide is cancelled', min: 2, max: 25 },
    G:         { value: 42,  label: 'Gravity (jumps)', min: 15, max: 80 },
  } },
  { target: C, group: 'Drift & boost', items: {
    DRIFT_MINV:   { value: 22,   label: 'Min speed to drift', min: 5, max: 50 },
    DRIFT_MAXYAW: { value: 0.55, label: 'Max drift angle (rad)', min: 0.2, max: 1.1 },
    DRIFT_GRIP:   { value: 8,    label: 'Drift grip', min: 2, max: 20 },
    CHARGE:       { value: 1.7,  label: 'Drift charge rate', min: 0.5, max: 4 },
    CHAIN_WIN:    { value: 1.25, label: 'Drift chain window (s)', min: 0.3, max: 3 },
    DRAIN:        { value: 30,   label: 'Boost meter drain (%/s)', min: 8, max: 80 },
    OVERHEAT:     { value: 1.3,  label: 'Overheat penalty (s)', min: 0, max: 4 },
    UNDERDOG:     { value: 0.35, label: 'Catch-up help', hint: '0 = none', min: 0, max: 1 },
  } },
]);
