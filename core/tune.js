// Game tuning: each game's `tuning.js` registers its adjustable "feel" constants here. The values written in that
// file ARE the defaults. The developer portal (core/portal.js, localhost only) lets you change them while playing
// and export a new tuning.js. Overrides are kept in this browser's localStorage and are applied ONLY when the page
// is served from localhost, so nothing on the public site can ever be changed this way.
//
//   tunable('lava', [
//     { target: C, group: 'Movement', items: {
//       RUN:  { value: 7.8, label: 'Run speed', min: 3, max: 14 },     // min/max/step optional (derived from value)
//       ski_turn: { value: 2.5, prop: 'turn', label: 'Turning' },      // prop: property name on target if it differs
//       GEN_T: { value: 95, label: 'Rock stops rising (s)', live: false }, // live:false: applied when the next round starts
//       hint: 'shown under the label'
//     } },
//   ]);
// Item names must be unique within a game (the exporter finds `NAME: { value: X` in tuning.js).
export const DEV_HOST = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
const REG = new Map();
const KEY = (id) => 'partyhub.tune.' + id;

function niceStep(v) {
  const a = Math.abs(v) || 1;
  const p = Math.pow(10, Math.floor(Math.log10(a)) - 2);
  return Number.isInteger(v) && a >= 10 ? 1 : +p.toPrecision(1);
}
export function tunable(id, groups) {
  const entry = { id, groups, items: new Map() };
  for (const g of groups) {
    for (const [name, it] of Object.entries(g.items)) {
      const v = it.value;
      it.name = name; it.prop = it.prop || name; it.target = g.target; it.group = g.group || 'Settings';
      if (it.min === undefined) it.min = v > 0 ? +(v * 0.25).toPrecision(2) : v < 0 ? v * 2.5 : 0;
      if (it.max === undefined) it.max = v > 0 ? +(v * 2.5).toPrecision(2) : v < 0 ? v * 0.25 : 1;
      if (it.step === undefined) it.step = niceStep(v);
      g.target[it.prop] = v;                      // the file's value is the default
      entry.items.set(name, it);
    }
  }
  REG.set(id, entry);
  applyTuning(id);
  return entry;
}
export const tuningOf = (id) => REG.get(id) || null;
export function overrides(id) {
  if (!DEV_HOST) return {};
  try { return JSON.parse(localStorage.getItem(KEY(id)) || '{}') || {}; } catch { return {}; }
}
function save(id, o) { try { localStorage.setItem(KEY(id), JSON.stringify(o)); } catch { /* */ } }
// Re-apply this browser's overrides (called when a round starts, so changes made between rounds take effect).
export function applyTuning(id) {
  const e = REG.get(id); if (!e || !DEV_HOST) return;
  const o = overrides(id);
  for (const it of e.items.values()) it.target[it.prop] = Object.hasOwn(o, it.name) ? o[it.name] : it.value;
}
export function setTune(id, name, value) {
  const e = REG.get(id); const it = e?.items.get(name); if (!it || !DEV_HOST) return;
  const o = overrides(id);
  if (value === it.value) delete o[name]; else o[name] = value;
  save(id, o);
  if (it.live !== false) it.target[it.prop] = value;   // live: games read these every frame. live:false items wait for the next round
}
export function resetTune(id, name = null) {
  const e = REG.get(id); if (!e) return;
  const o = name ? overrides(id) : {};
  if (name) delete o[name];
  save(id, o);
  applyTuning(id);
}
export const currentValue = (id, name) => { const it = REG.get(id)?.items.get(name); return it ? it.target[it.prop] : undefined; };
