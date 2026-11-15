// Shared bot slots. Bots are ordinary party players with isBot = true (name, color, hat, trophies), added and
// removed by the host in the lobby. The HOST runs every bot; each game brings its own bot AI and reads the
// party-wide difficulty from ctx.bots.level:
//   for (const p of ctx.players) if (p.isBot) brains.set(p.id, myGameBot(p, ctx.bots.level));
//   ctx.bots.level = { key, reaction /*s*/, aimError /*rad*/, skill /*0..1*/, mistakes /*0..1*/ }
import { HATS } from './avatar.js';

export const BOT_NAMES = ['Bolt', 'Nova', 'Rex', 'Pixel', 'Juno', 'Mochi', 'Ziggy', 'Blip', 'Tango', 'Waffles', 'Echo', 'Noodle'];
export const BOT_LEVELS = {
  easy: { key: 'easy', label: 'Easy', reaction: 0.45, aimError: 0.5, skill: 0.45, mistakes: 0.3 },
  normal: { key: 'normal', label: 'Normal', reaction: 0.25, aimError: 0.25, skill: 0.7, mistakes: 0.12 },
  hard: { key: 'hard', label: 'Hard', reaction: 0.12, aimError: 0.1, skill: 0.92, mistakes: 0.04 },
};

export function makeBot(players, freeColor) {
  const used = new Set(players.map((p) => p.name));
  const name = 'Bot ' + (BOT_NAMES.find((n) => !used.has('Bot ' + n)) || players.length);
  return {
    id: 'bot-' + Math.random().toString(36).slice(2, 7), name, isBot: true, connected: true, ready: true,
    color: freeColor, hat: HATS[1 + Math.floor(Math.random() * (HATS.length - 1))], trophies: 0, wins: 0,
  };
}

// Tiny helper for game bot brains: think on a timer with difficulty-based reaction time.
export class BotBrain {
  constructor(level, rnd = Math.random) { this.level = level; this.rnd = rnd; this.t = rnd() * level.reaction; }
  ready(dt) { this.t -= dt; if (this.t > 0) return false; this.t = this.level.reaction * (0.6 + this.rnd() * 0.8); return true; }
  jitter(a) { return a + (this.rnd() * 2 - 1) * this.level.aimError; }
  mistake() { return this.rnd() < this.level.mistakes; }
}
