// Every game in the hub. To add a game: create games/<id>/ (copy games/_template), then add one line here.
// Only manifests are imported up front; the game code itself is loaded with import() when a round starts.
import { manifest as golf } from './golf/manifest.js';
import { manifest as downhill } from './downhill/manifest.js';
import { manifest as arena } from './arena/manifest.js';
import { manifest as coingrab } from './_template/manifest.js';

export const GAMES = [golf, downhill, arena, coingrab];
export const GAME_MAP = Object.fromEntries(GAMES.map((g) => [g.id, g]));
export const loadGame = (id) => import(`./${GAME_MAP[id].dir || id}/index.js`);
