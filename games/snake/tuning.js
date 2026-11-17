// Snake feel constants. These values are the defaults the game uses (they override the same keys in sim.js).
// Tune them by playing in the developer portal: run `python3 tools/portal.py` (see docs/PORTAL.md).
import { tunable } from '../../core/tune.js';
import { C } from './sim.js';

tunable('snake', [
  { target: C, group: 'Steering', items: {
    SPEED:       { value: 9,    label: 'Cruise speed', min: 4, max: 18 },
    BOOST_SPEED: { value: 17.5, label: 'Boost speed', min: 8, max: 32 },
    ACCEL:       { value: 7,    label: 'Speed change rate', min: 1, max: 20 },
    TURN:        { value: 4.6,  label: 'Turn rate (small snake)', hint: 'big snakes turn slower than this', min: 1.5, max: 9 },
  } },
  { target: C, group: 'Boost & mass', items: {
    START_MASS:  { value: 24,   label: 'Starting mass', min: 8, max: 80, live: false },
    BOOST_DRAIN: { value: 7.5,  label: 'Boost cost (mass/s)', min: 1, max: 20 },
    BOOST_MIN:   { value: 14,   label: 'Min mass to boost', min: 4, max: 40 },
  } },
  { target: C, group: 'Orbs', items: {
    ORB_EAT:     { value: 1.15, label: 'Eat distance', min: 0.4, max: 3 },
    ORB_PULL:    { value: 2.4,  label: 'Orb magnet range', min: 0, max: 6 },
    DEATH_KEEP:  { value: 0.8,  label: 'Mass dropped on death', hint: 'fraction', min: 0.1, max: 1 },
  } },
]);
