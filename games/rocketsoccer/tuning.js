// Rocket Soccer feel constants. These values are the defaults the game uses (they override the same keys in physics.js).
// Tune them by playing in the developer portal: run `python3 tools/portal.py` (see docs/PORTAL.md).
import { tunable } from '../../core/tune.js';
import { C } from './physics.js';

tunable('rocketsoccer', [
  { target: C, group: 'Driving', items: {
    DRIVE_MAX: { value: 25, label: 'Top speed (no boost)', min: 12, max: 45 },
    MAX:       { value: 42, label: 'Absolute top speed', min: 25, max: 70 },
    SUPER:     { value: 38, label: 'Supersonic speed (demolishes)', min: 20, max: 70 },
    THROTTLE:  { value: 40, label: 'Acceleration', min: 10, max: 90 },
    BRAKE:     { value: 45, label: 'Brake strength', min: 10, max: 100 },
    GRIP:      { value: 14, label: 'Tyre grip', min: 3, max: 30 },
    TURN_RATE: { value: 4.5, label: 'Turn rate', hint: 'at low speed; less at top speed', min: 2.5, max: 8 },
    STEER_RAMP: { value: 5.5, label: 'Steering ramp-up', hint: 'higher = full lock sooner', min: 2, max: 16 },
  } },
  { target: C, group: 'Boost', items: {
    BOOST_ACC:   { value: 30, label: 'Boost acceleration', min: 8, max: 70 },
    BOOST_USE:   { value: 33, label: 'Boost use (per second)', min: 5, max: 80 },
    BOOST_START: { value: 34, label: 'Boost at kickoff', min: 0, max: 100, live: false },
  } },
  { target: C, group: 'Jumping & air', items: {
    G:        { value: 24,   label: 'Gravity', min: 10, max: 45, live: false },
    JUMP_V:   { value: 8.6,  label: 'Jump power', min: 4, max: 15 },
    DODGE_V:  { value: 11.5, label: 'Dodge / flip power', min: 4, max: 20 },
    PITCH:    { value: 5.2,  label: 'Air pitch rate', min: 2, max: 10 },
    YAW:      { value: 3.6,  label: 'Air yaw rate', min: 1, max: 8 },
    ROLL:     { value: 3.2,  label: 'Air roll rate', min: 1, max: 8 },
  } },
  { target: C, group: 'Ball', items: {
    BALL_MAX:  { value: 66,   label: 'Ball top speed', min: 30, max: 100 },
    BALL_E:    { value: 0.62, label: 'Ball bounciness', min: 0.2, max: 0.95 },
    BALL_DRAG: { value: 0.025, label: 'Ball air drag', min: 0, max: 0.1 },
    HIT_E:     { value: 0.5,  label: 'Car hit bounciness', min: 0.1, max: 1 },
    HIT_EXTRA: { value: 0.42, label: 'Extra hit power', min: 0, max: 1.2 },
  } },
]);
