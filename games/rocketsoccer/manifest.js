// Read by the lobby without loading the game. Keep it tiny (no imports).
export const manifest = {
  id: 'rocketsoccer',
  name: 'Rocket Soccer',
  tagline: 'Rocket-powered cars, one giant ball. Drive up the walls, fly, and blast it into the net!',
  minPlayers: 1,
  maxPlayers: 8,
  teams: 2,                     // Blue vs Orange, picked in-game (bots fill both teams)
  supportsBots: true,
  roundLengthSec: 210,          // 3-minute clock + goal replays and kickoffs (host option 2–5 min)
  thumbnail: 'games/rocketsoccer/thumb.svg',
  controlsHelp: [
    ['W / S', 'Drive / reverse · in the air: tilt nose down / up'],
    ['A / D', 'Steer · in the air: turn and roll'],
    ['Space', 'Jump · press again for a double jump'],
    ['Space + direction', 'Second press while holding a direction: dodge flip (a power hit)'],
    ['Shift (hold)', 'Boost · in the air, boost + tilt to fly'],
    ['Right click', 'Ball cam on / off'],
    ['Drive into curves', 'Ride up the walls'],
    ['Supersonic ram', 'Demolish an opponent'],
    ['Space during a replay', 'Vote to skip it'],
  ],
  picks: [
    { key: 'team', label: 'Team', default: 'auto', choices: [
      { value: 'auto', label: 'Any team', desc: 'Balance the teams for me' },
      { value: 'blue', label: '🔵 Blue', desc: 'Defend the blue goal' },
      { value: 'orange', label: '🟠 Orange', desc: 'Defend the orange goal' },
    ] },
  ],
  options: [
    { key: 'size', label: 'Teams', default: '2', choices: [{ value: '1', label: '1 v 1' }, { value: '2', label: '2 v 2' }, { value: '3', label: '3 v 3' }, { value: '4', label: '4 v 4' }] },
    { key: 'length', label: 'Match length', default: '3', choices: [{ value: '2', label: '2 min' }, { value: '3', label: '3 min' }, { value: '4', label: '4 min' }, { value: '5', label: '5 min' }] },
    { key: 'gravity', label: 'Gravity', default: 'normal', choices: [{ value: 'normal', label: 'Normal' }, { value: 'moon', label: '🌙 Moon Ball (low gravity, big air)' }] },
    { key: 'arena', label: 'Arena', default: 'stadium', choices: [{ value: 'stadium', label: 'Sunset Stadium' }, { value: 'pocket', label: 'Pocket Park (small, night)' }] },
  ],
};
