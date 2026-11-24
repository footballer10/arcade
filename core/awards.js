// Fun awards for the final podium, worked out from the session's games (S.history entries: {gameId, places, bots}).
// Returns [{ icon, title, id, detail }], at most 6, at most 2 per player. Award titles become wearable titles.
const PTS = [5, 3, 2];
export function computeAwards(history, players) {
  const games = history.filter((h) => h.places && Object.keys(h.places).length >= 2);
  if (games.length < 2) return [];
  const human = new Set(players.filter((p) => !p.isBot).map((p) => p.id));
  const st = {};
  const S = (id) => (st[id] ||= { id, games: 0, wins: 0, seconds: 0, lasts: 0, sum: 0, bots: 0, top3: new Set(), perWin: {}, trophies: [] });
  games.forEach((h, gi) => {
    const places = Object.entries(h.places), worst = Math.max(...places.map(([, p]) => p));
    for (const [id, pl] of places) {
      const s = S(id); s.games++; s.sum += pl;
      if (pl === 1) { s.wins++; s.perWin[h.gameId] = (s.perWin[h.gameId] || 0) + 1; }
      if (pl === 2) s.seconds++;
      if (pl === worst && places.length > 2) s.lasts++;
      if (pl <= 3) s.top3.add(h.gameId);
      s.bots += (h.bots || []).filter((b) => h.places[b] > pl).length;
      s.trophies[gi] = PTS[pl - 1] ?? 1;
    }
  });
  const all = Object.values(st).filter((s) => players.some((p) => p.id === s.id));
  const best = (score, ok = () => true) => all.filter(ok).sort((a, b) => score(b) - score(a))[0];
  const total = (s, upto) => s.trophies.slice(0, upto).reduce((a, b) => a + (b || 0), 0);
  const rank = (s, upto) => 1 + all.filter((o) => total(o, upto) > total(s, upto)).length;
  const half = Math.ceil(games.length / 2);
  const out = [];
  const add = (s, icon, title, detail) => { if (s) out.push({ icon, title, id: s.id, detail }); };
  let s = best((x) => x.wins); if (s?.wins) add(s, '👑', 'Most Wins', `${s.wins} win${s.wins > 1 ? 's' : ''}`);
  s = best((x) => rank(x, half) - rank(x, games.length)); if (s && games.length >= 3 && rank(s, half) - rank(s, games.length) >= 2) add(s, '📈', 'Comeback Kid', `from #${rank(s, half)} to #${rank(s, games.length)}`);
  s = best((x) => x.seconds); if (s?.seconds >= 2) add(s, '🥈', 'Always Second', `${s.seconds}× second place`);
  s = best((x) => x.bots, (x) => human.has(x.id)); if (s?.bots >= 3) add(s, '🤖', 'Bot Slayer', `beat ${s.bots} bots`);
  s = best((x) => Math.max(0, ...Object.values(x.perWin))); if (s && Math.max(0, ...Object.values(s.perWin)) >= 2) add(s, '🎯', 'Specialist', 'won the same game twice');
  s = best((x) => x.top3.size); if (s?.top3.size >= 3) add(s, '🌈', 'All-Rounder', `top 3 in ${s.top3.size} different games`);
  s = best((x) => -x.sum / x.games, (x) => x.games >= 3 && x.lasts === 0); if (s) add(s, '🧱', 'Rock Solid', 'never finished last');
  s = best((x) => x.lasts); if (s?.lasts >= 2) add(s, '🥄', 'Wooden Spoon', `${s.lasts}× last place`);
  const per = {};
  return out.filter((a) => (per[a.id] = (per[a.id] || 0) + 1) <= 2).slice(0, 6);
}
