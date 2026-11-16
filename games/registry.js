// Every game in the hub. To add a game: create games/<id>/ (copy games/_template), then add one line to GAMES.
// Only manifests are imported up front; the game code itself is loaded with import() when a round starts.
import { manifest as golf } from './golf/manifest.js';
import { manifest as downhill } from './downhill/manifest.js';
import { manifest as arena } from './arena/manifest.js';
import { manifest as template } from './_template/manifest.js';
import { manifest as snake } from './snake/manifest.js';
import { manifest as lava } from './lava/manifest.js';
import { manifest as neon } from './neon/manifest.js';

// Games players see in the lobby (and that Shuffle / votes pick from).
const PLAYABLE = [golf, downhill, arena, snake, lava, neon];
// games/_template (Coin Grab) is the starting point for new games, not a game for players. It only appears in
// the lobby with ?dev=1 (developers and the automated tests use it to check /core).
const DEV = typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev');
export const GAMES = DEV ? [...PLAYABLE, template] : PLAYABLE;
export const GAME_MAP = Object.fromEntries([...PLAYABLE, template].map((g) => [g.id, g]));
export const loadGame = (id) => import(`./${GAME_MAP[id].dir || id}/index.js`);
