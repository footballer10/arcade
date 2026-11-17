# Developer tuning portal

Play any game and adjust its feel (speeds, jump heights, cooldowns, knockback, timings) with sliders while you play.
When it feels right, save your values as the new defaults.

The portal only runs on your own computer. On the public site (`footballer10.github.io/arcade/`) it never loads,
and values saved in a browser are ignored there. Players only ever get the defaults written in each game's
`tuning.js`, and those change only when you commit a new file.

## Start it

You need Python 3 (already on Mac and Linux; on Windows install it from python.org).

```
cd arcade
python3 tools/portal.py
```

Your browser opens `http://localhost:8000/?portal=1`. Leave the terminal window open while you play; press Ctrl+C
in it to stop. (On Windows the command may be `py tools/portal.py`.)

You can also use any local web server and open `http://localhost:<port>/?portal=1` yourself; the portal works the
same, except the **Save as defaults** button only appears with `tools/portal.py` (use **Download** instead).

## Use it

The panel sits on the right. **F2** hides and shows it.

1. Pick a game from the list.
2. **▶ Play** starts a solo party with bots and goes straight into that game. **↻ Restart round** ends the round
   and starts a fresh one; **■ End** goes back to the lobby. Untick "Skip the pre-round screen" if you want to
   choose picks and options (ski or board, map, round length…) before each round.
3. Drag a slider or type a number. Most values change instantly while you play. Values tagged **next round**
   (things like round length or level layout) apply when the next round starts.
   - The **green mark** on each slider is the current default.
   - Changed values are outlined in yellow; **↺** puts one back to its default. **Reset game** resets them all.
   - The game list shows how many values you changed in each game.
   - Your changes are kept in this browser, so you can close the page and carry on later.
   - Tuned values exist only on your computer. Test them solo with bots: if a friend joins a portal party, their
     game still runs the published defaults, so movement can look jumpy for them.
4. When it feels right:
   - **💾 Save as defaults** writes the values into `games/<game>/tuning.js`. The green marks move to your values.
     Commit and push that file to publish the change to everyone.
   - **⬇ Download tuning.js** gives you the same file to replace `games/<game>/tuning.js` by hand.
   - **📋 Copy changes** copies a plain list of every changed value in every game, for example to paste to Claude
     with "make these the new defaults".

## How it works (for whoever adds a game)

Every game has a `games/<id>/tuning.js`. It lists the numbers that shape how the game feels and calls `tunable()`
from `core/tune.js`:

```js
import { tunable } from '../../core/tune.js';
import { C } from './world.js';

tunable('mygame', [
  { target: C, group: 'Movement', items: {
    RUN:  { value: 7.5, label: 'Run speed', min: 3, max: 14 },
    JUMP: { value: 11,  label: 'Jump power', min: 5, max: 18, hint: 'shown under the label' },
    ROUND_T: { value: 90, label: 'Round length (s)', min: 30, max: 240, live: false },
  } },
]);
```

- `value` is the default. `tunable()` writes it into `target[name]` (or `target[prop]` when `prop` is given), so the
  file is the single place the default lives. The game reads `C.RUN` etc. each time it needs it (not a copy made at
  load time), which is what makes slider changes live.
- `min` / `max` set the slider range (a typed value may go outside it). `step` is optional.
- `live: false` for values only read when a round is set up; the portal then applies them at the next round.
- Item names must be unique within the game: the portal finds `NAME: { value: X` in the file when it saves.
- The game's `index.js` imports `./tuning.js` (first import) so the defaults apply on the public site too.
- `games/_template/tuning.js` shows the simplest form: the tuning file owns the object (`export const RULES = {}`)
  and the game reads `RULES.SPEED`.

Safety: `core/tune.js` applies saved browser values only when the page's address is `localhost` / `127.0.0.1`;
`core/hub.js` loads `core/portal.js` only on those addresses with `?portal=1`; `tools/portal.py` listens on
127.0.0.1 only and can write nothing but existing `games/<id>/tuning.js` files.

Test: `cd tests && node portal.mjs`.
