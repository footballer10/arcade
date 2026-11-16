// Read by the lobby without loading the game. Keep it tiny (no imports).
export const manifest = {
  id: 'neon',
  name: 'Neon Rush',
  tagline: 'Anti-gravity racing. Drift to charge boost, chain drifts to win!',
  minPlayers: 1,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 120,          // 3 laps of 25-30 s + intro and finish (Knockout ~2 min)
  thumbnail: 'games/neon/thumb.svg',
  controlsHelp: [
    ['W / ↑', 'Accelerate'], ['S / ↓', 'Brake / reverse'], ['A D / ← →', 'Steer'],
    ['Space (hold) + steer', 'Drift: charges blue → pink → gold. Let go for a boost'],
    ['Drift again quickly', 'Chain drifts for ×1.5 … ×3 boost'], ['Hold gold too long', 'Overheat: the drift burns out'], ['Shift (hold)', 'Spend boost meter'],
    ['Q', 'Look back'], ['Spectating: A / D', 'Switch racer'],
  ],
  picks: [
    { key: 'ship', label: 'Ship', default: 'comet', choices: [
      { value: 'comet', label: 'Comet', desc: 'Balanced all-rounder' },
      { value: 'viper', label: 'Viper', desc: 'Top speed · slower drift charge' },
      { value: 'wisp', label: 'Wisp', desc: 'Grippy, charges drifts fast · lower top speed' },
    ] },
  ],
  options: [
    { key: 'track', label: 'Track', default: 'random', choices: [{ value: 'random', label: 'Random' }, { value: 'sunset', label: 'Sunset Boulevard' }, { value: 'helix', label: 'Helix Heights' }, { value: 'harbor', label: 'Hyperloop Harbor' }, { value: 'inferno', label: 'Inferno Interchange' }] },
    { key: 'mode', label: 'Mode', default: 'race', choices: [{ value: 'race', label: 'Race' }, { value: 'knockout', label: 'Knockout (last place derezzed)' }] },
    { key: 'laps', label: 'Laps', default: '3', choices: [{ value: '2', label: '2 laps' }, { value: '3', label: '3 laps' }, { value: '4', label: '4 laps' }] },
  ],
};
