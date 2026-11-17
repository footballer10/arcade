export const manifest = {
  id: 'arena',
  name: 'Arena Royale',
  tagline: 'Last one standing. Knock them off the edge!',
  minPlayers: 2,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 240,          // first to 3 round wins, ~70 s per round
  thumbnail: 'games/arena/thumb.svg',
  controlsHelp: [
    ['WASD / Arrows', 'Move'], ['Mouse', 'Aim'], ['Left click (hold)', 'Attack (3 ammo, refills)'], ['Right click / Q', 'Special'],
    ['Shift / Space', 'Dash (brief invulnerability)'], ['Mouse wheel', 'Zoom'], ['1 – 4', 'Emotes'], ['Click while out', 'Switch who you spectate'],
    ['Click a character @ round end', 'Change character for next round'],
  ],
  picks: [
    { key: 'char', label: 'Character', default: 'blaster', choices: [
      { value: 'blaster', label: 'Blaster', desc: 'Ranged · Bolts / Knockback Blast' },
      { value: 'brawler', label: 'Brawler', desc: 'Tank · Punch / Ground Slam' },
      { value: 'trickster', label: 'Trickster', desc: 'Assassin · Slash / Teleport' },
      { value: 'bomber', label: 'Bomber', desc: 'Artillery · Lob Bomb / Gravity Well' },
      { value: 'ranger', label: 'Ranger', desc: 'Sniper · Piercing Arrow / Backflip Volley' },
      { value: 'frost', label: 'Frostbite', desc: 'Control · Ice Shards / Blizzard' },
      { value: 'ram', label: 'Ram', desc: 'Tank · Horn Bash / Stampede' },
      { value: 'hook', label: 'Angler', desc: 'Grappler · Harpoon / Hook Shot' },
    ] },
  ],
  options: [
    { key: 'map', label: 'Arena', default: 'random', choices: [{ value: 'random', label: 'Random' }, { value: 'pillars', label: 'Crate Meadow' }, { value: 'sweeper', label: 'Sweeper Sands' }, { value: 'pits', label: 'Frosty Pits' }, { value: 'donut', label: 'Donut Dunk' }, { value: 'rink', label: 'Slippy Rink' }] },
    { key: 'mut', label: 'Mutator', default: 'none', choices: [{ value: 'none', label: 'None' }, { value: 'chaos', label: 'Chaos (random each round)' }, { value: 'knockback', label: 'Super Knockback' }, { value: 'turbo', label: 'Turbo' }, { value: 'bombs', label: 'Bomb Rain' }, { value: 'party', label: 'Power-up Party' }, { value: 'glass', label: 'Glass Cannon' }, { value: 'shuffle', label: 'Shuffle' }] },
    { key: 'wins', label: 'Match length', default: '3', choices: [{ value: '2', label: 'First to 2' }, { value: '3', label: 'First to 3' }] },
  ],
};
