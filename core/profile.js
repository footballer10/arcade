// Lifetime profile, saved in this browser (no accounts): trophies, games, wins per game, awards won.
// Unlocks (hats, name styles, victory dances) and titles come from it. Other players see your choices because they
// travel with your look (hat / nameFx / dance / title) like your shirt color does.
const KEY = 'partyhub.profile.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || null; } catch { return null; } };
let P = load() || { trophies: 0, games: 0, wins: 0, per: {}, awards: {}, rounds: [] };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* private mode */ } };

export const stats = () => P;
// Called once per finished game by every player for themself.
export function recordGame(gameId, round, place, trophies) {
  const k = `${round}:${gameId}`;
  if (P.rounds.includes(k)) return false;
  P.rounds.push(k); if (P.rounds.length > 50) P.rounds.shift();
  P.trophies += trophies || 0; P.games++; if (place === 1) P.wins++;
  const g = P.per[gameId] ||= { played: 0, wins: 0, trophies: 0, best: 99 };
  g.played++; g.trophies += trophies || 0; if (place === 1) g.wins++; g.best = Math.min(g.best, place || 99);
  save(); return true;
}
export function recordAward(title) { P.awards[title] = (P.awards[title] || 0) + 1; save(); }

// ---- unlocks (by lifetime trophies)
export const HAT_UNLOCK = { tophat: 15, horns: 40, propeller: 60, wizard: 90, viking: 140, crown: 220, halo: 320 };
export const NAME_FX = [
  { id: '', label: 'Normal', need: 0 }, { id: 'gold', label: 'Gold', need: 30 }, { id: 'fire', label: 'Fire', need: 120 }, { id: 'rainbow', label: 'Rainbow', need: 250 },
];
export const DANCES = [
  { id: 'bounce', label: 'Bounce', need: 0 }, { id: 'spin', label: 'Spin', need: 20 }, { id: 'sway', label: 'Sway', need: 50 },
  { id: 'disco', label: 'Disco', need: 100 }, { id: 'flip', label: 'Backflip', need: 180 },
];
export const unlocked = (need) => P.trophies >= (need || 0);
export const hatUnlocked = (h) => unlocked(HAT_UNLOCK[h]);

// ---- titles: earned by lifetime trophies, wins in a game, or awards
const SHORT = { golf: 'Golf', downhill: 'Downhill', arena: 'Arena', snake: 'Snake', lava: 'Lava', neon: 'Neon', obstacle: 'Obstacle', floorfall: 'Floor Fall', prophunt: 'Prop Hunt', rocketsoccer: 'Rocket', coingrab: 'Coin' };
const TIERS = [[0, 'Rookie'], [20, 'Party Animal'], [60, 'Contender'], [150, 'Champion'], [300, 'Legend'], [600, 'Arcade Royalty']];
export function titles() {
  const out = [];
  for (const [need, t] of TIERS) if (P.trophies >= need) out.push(t);
  for (const [id, g] of Object.entries(P.per)) {
    const n = SHORT[id] || id;
    if (g.wins >= 3) out.push(`${n} Ace`);
    if (g.wins >= 10) out.push(`${n} Legend`);
  }
  for (const a of Object.keys(P.awards)) out.push(a);
  return [...new Set(out)];
}
export const nextTier = () => TIERS.find(([need]) => need > P.trophies) || null;
