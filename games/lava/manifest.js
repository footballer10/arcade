// Read by the lobby without loading the game. Keep it tiny (no imports).
export const manifest = {
  id: 'lava',
  name: 'Rising Lava',
  tagline: 'The lava never stops. Climb the rising rocks. Last one standing!',
  // Shown on the pre-round screen next to the settings: goal, how to win, key tips (short sentences).
  howTo: [
    "The lava keeps rising. Jump from rock to rock and stay above it.",
    "Glowing rocks are hot and crumble if you stand on them too long. New rock rises where the lava bubbles.",
    "Shove players with left click or E, and dash with Shift (once in the air) to knock them into the lava.",
    "Last one alive wins the round. When you're out you can still lob lava bombs at the survivors.",
  ],
  minPlayers: 1,
  maxPlayers: 8,
  teams: false,
  supportsBots: true,
  roundLengthSec: 240,          // best of 5 (first to 3): 3–5 rounds of ~60–80 s
  thumbnail: 'games/lava/thumb.svg',
  controlsHelp: [
    ['WASD / Arrows', 'Run (camera-relative)'], ['Space', 'Jump (hold = higher)'], ['Shift', 'Dash (works once in the air)'],
    ['Left click / E', 'Shove'], ['Mouse', 'Look (click to lock the mouse) · wheel = zoom'],
    ['Glowing rock', 'Hot! It crumbles if you stay on it'], ['Bubbling lava', 'New rock is about to rise there: keep climbing!'],
    ['When you\'re out', 'Click = lob a lava bomb (you\'re a volcano spirit) · Space = switch view'],
  ],
  picks: [],
  options: [
    { key: 'match', label: 'Match', default: 'bo5', choices: [{ value: 'bo5', label: 'Best of 5' }, { value: 'bo3', label: 'Best of 3' }, { value: 'one', label: 'One round' }] },
    { key: 'arena', label: 'Arena', default: 'mix', choices: [{ value: 'mix', label: 'New arena every round' }, { value: 'causeway', label: 'Giant\'s Causeway' }, { value: 'corkscrew', label: 'Corkscrew' }, { value: 'archipelago', label: 'Archipelago' }, { value: 'ringfire', label: 'Ring of Fire' }] },
  ],
};
