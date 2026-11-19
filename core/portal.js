// Developer tuning portal. Only loads on this computer (localhost) with ?portal=1; see docs/PORTAL.md.
// A side panel over the hub: pick a game, play it solo with bots, drag sliders for the game's feel constants
// (games/<id>/tuning.js), then save them as the new defaults (when run through tools/portal.py) or download the file.
import { DEV_HOST, tuningOf, overrides, setTune, resetTune, currentValue } from './tune.js';

const LS = 'partyhub.portal';
const ls = { get() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } }, set(v) { try { localStorage.setItem(LS, JSON.stringify({ ...ls.get(), ...v })); } catch { /* */ } } };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const decimals = (step) => { const s = String(step); return s.includes('e-') ? +s.split('e-')[1] : (s.split('.')[1] || '').length; };
const fmt = (v, step) => +(+v).toFixed(Math.min(8, decimals(step) + 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CSS = `
#devPortal { position: fixed; top: 10px; right: 10px; bottom: 10px; width: 380px; z-index: 90; display: flex; flex-direction: column;
  background: linear-gradient(180deg, #3a2f74, #241c4f); border: 4px solid var(--ink); border-radius: 18px; color: #fff;
  box-shadow: 0 8px 0 rgba(10,10,40,.45), 0 20px 40px rgba(0,0,0,.4); font-family: var(--font); user-select: none; }
#devPortal.min { bottom: auto; width: auto; }
#devPortal.min .dp-body, #devPortal.min .dp-foot { display: none; }
#devPortal header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 3px solid var(--ink); }
#devPortal header b { font-weight: 400; font-size: 1.2rem; color: var(--yellow); text-shadow: var(--stroke); flex: 1; white-space: nowrap; }
#devPortal .dp-note { font-size: .78rem; opacity: .75; padding: 6px 12px 0; }
#devPortal .dp-top { display: flex; gap: 6px; padding: 8px 10px; flex-wrap: wrap; align-items: center; }
#devPortal .dp-top select { flex: 1; min-width: 0; padding: 4px 8px; font-size: .95rem; }
#devPortal .dp-body { flex: 1; overflow: auto; padding: 0 10px 10px; }
#devPortal h4 { margin: 12px 0 4px; font-weight: 400; font-size: 1.05rem; color: var(--sky); text-shadow: var(--stroke); }
#devPortal .dp-item { padding: 6px 8px 8px; margin: 4px 0; border-radius: 10px; background: rgba(255,255,255,.06); border: 2px solid transparent; }
#devPortal .dp-item.changed { border-color: var(--yellow); background: rgba(255,210,63,.13); }
#devPortal .dp-line { display: flex; align-items: center; gap: 6px; }
#devPortal .dp-line .nm { flex: 1; font-size: .95rem; line-height: 1.1; }
#devPortal .dp-line .nm small { display: block; font-size: .72rem; opacity: .6; font-family: system-ui, sans-serif; letter-spacing: 0; }
#devPortal .dp-line input[type=number] { width: 86px; padding: 2px 6px; font-size: .9rem; border-width: 2px; border-radius: 8px; box-shadow: none; }
#devPortal .dp-tag { font-size: .68rem; background: var(--ink); border-radius: 6px; padding: 1px 5px; opacity: .85; white-space: nowrap; }
#devPortal .dp-reset { background: none; border: 0; color: #fff; cursor: pointer; font-size: 1rem; padding: 0 2px; opacity: .35; }
#devPortal .changed .dp-reset { opacity: 1; color: var(--yellow); }
#devPortal .dp-slide { position: relative; margin-top: 6px; height: 18px; }
#devPortal .dp-slide input { position: absolute; inset: 4px 0 auto; width: 100%; margin: 0; }
#devPortal .dp-mark { position: absolute; top: 0; width: 4px; height: 18px; margin-left: -2px; background: var(--green); border: 1px solid var(--ink);
  border-radius: 2px; pointer-events: none; z-index: 1; }
#devPortal .dp-def { font-size: .7rem; opacity: .7; text-align: right; font-family: system-ui, sans-serif; letter-spacing: 0; }
#devPortal .dp-def i { display: inline-block; width: 8px; height: 8px; background: var(--green); border: 1px solid var(--ink); border-radius: 2px; margin-right: 3px; vertical-align: -1px; }
#devPortal .dp-foot { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 10px; border-top: 3px solid var(--ink); }
#devPortal .dp-foot .ph-btn, #devPortal .dp-top .ph-btn { flex: 1 1 auto; }
#devPortal .dp-msg { width: 100%; min-height: 1.1em; font-size: .85rem; color: var(--yellow); }
#devPortal .dp-empty { opacity: .75; padding: 14px 4px; line-height: 1.4; }
`;

export function initPortal(api) {
  if (!DEV_HOST) return;                         // never on the public site
  const { act, GAME_MAP, solo } = api;
  const st = ls.get();
  let gameId = GAME_MAP[st.game] ? st.game : Object.keys(GAME_MAP)[0];
  let server = false;                            // tools/portal.py can write files directly
  fetch('__portal', { cache: 'no-store' }).then((r) => r.ok && r.json()).then((j) => { server = !!j?.ok; renderFoot(); }).catch(() => {});

  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'devPortal'; root.className = 'ui-block' + (st.min ? ' min' : '');
  root.innerHTML = `<header><b>🛠 Tuning portal</b><span class="dp-tag">F2</span><button class="ph-btn small ghost" data-a="min" title="Hide / show (F2)">${st.min ? '▢' : '—'}</button></header>
    <div class="dp-body"><div class="dp-note">Only works on this computer. Changes save in this browser until you export them. Green mark = current default.</div>
      <div class="dp-top"><select id="dpGame"></select></div>
      <div class="dp-top"><button class="ph-btn small green" data-a="play">▶ Play</button><button class="ph-btn small" data-a="restart">↻ Restart round</button><button class="ph-btn small ghost" data-a="end">■ End</button></div>
      <label class="dp-top" style="font-size:.85rem;gap:8px"><input type="checkbox" id="dpSkip" ${st.skip !== false ? 'checked' : ''}> Skip the pre-round screen (use last picks)</label>
      <div id="dpList"></div></div>
    <div class="dp-foot"></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const list = $('#dpList'), sel = $('#dpGame'), foot = $('.dp-foot');
  $('#dpSkip').onchange = (e) => ls.set({ skip: e.target.checked });
  // Keep the panel's clicks and keys away from the game.
  for (const t of ['pointerdown', 'mousedown', 'click', 'wheel']) root.addEventListener(t, (e) => e.stopPropagation());
  root.addEventListener('pointerup', () => setTimeout(() => { const a = document.activeElement; if (a?.type === 'range') a.blur(); }, 0));
  const msg = (t) => { const m = $('.dp-msg'); if (m) { m.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => { m.textContent = ''; }, 5000); } };

  function setMin(v) { root.classList.toggle('min', v); $('[data-a=min]').textContent = v ? '▢' : '—'; ls.set({ min: v }); if (!v && document.pointerLockElement) document.exitPointerLock(); }
  addEventListener('keydown', (e) => { if (e.code === 'F2') { e.preventDefault(); e.stopPropagation(); setMin(!root.classList.contains('min')); } }, true);

  function renderSelect() {
    sel.innerHTML = Object.values(GAME_MAP).map((m) => {
      const n = Object.keys(overrides(m.id)).length;
      return `<option value="${m.id}" ${m.id === gameId ? 'selected' : ''}>${esc(m.name)}${n ? `  • ${n} changed` : ''}</option>`;
    }).join('');
  }
  sel.onchange = () => { gameId = sel.value; ls.set({ game: gameId }); load(); };

  async function load() {
    renderSelect();
    const id = gameId;
    list.innerHTML = '<div class="dp-empty">Loading…</div>';
    try { await import(`../games/${GAME_MAP[id].dir || id}/tuning.js`); } catch (e) {
      if (id === gameId) list.innerHTML = `<div class="dp-empty">${esc(GAME_MAP[id].name)} has no <code>tuning.js</code> yet.</div>`;
      console.warn(e); renderFoot(); return;
    }
    if (id === gameId) renderList();
  }

  function renderList() {
    const t = tuningOf(gameId); if (!t) return;
    const o = overrides(gameId);
    let html = '', group = null;
    for (const it of t.items.values()) {
      if (it.group !== group) { group = it.group; html += `<h4>${esc(group)}</h4>`; }
      const v = currentValue(gameId, it.name);
      const min = Math.min(it.min, v, it.value), max = Math.max(it.max, v, it.value);
      const pct = max > min ? ((it.value - min) / (max - min)) : 0;
      html += `<div class="dp-item ${Object.hasOwn(o, it.name) ? 'changed' : ''}" data-k="${esc(it.name)}">
        <div class="dp-line"><span class="nm">${esc(it.label || it.name)}<small>${esc(it.name)}${it.hint ? ' · ' + esc(it.hint) : ''}</small></span>
          ${it.live === false ? '<span class="dp-tag" title="Takes effect when the next round starts">next round</span>' : ''}
          <input type="number" step="${it.step}" value="${fmt(v, it.step)}"><button class="dp-reset" title="Back to default">↺</button></div>
        <div class="dp-slide"><span class="dp-mark" style="left:calc(8px + (100% - 16px) * ${pct})" title="Default ${it.value}"></span>
          <input type="range" min="${min}" max="${max}" step="${it.step}" value="${v}"></div>
        <div class="dp-def"><i></i>default ${fmt(it.value, it.step)}</div></div>`;
    }
    list.innerHTML = html || '<div class="dp-empty">No tunable values.</div>';
    for (const row of list.querySelectorAll('.dp-item')) {
      const k = row.dataset.k, num = row.querySelector('input[type=number]'), rng = row.querySelector('input[type=range]');
      const apply = (val, from) => {
        if (!Number.isFinite(val)) return;
        const it = tuningOf(gameId).items.get(k);
        val = fmt(val, it.step);
        setTune(gameId, k, val);
        if (from !== num) num.value = val;
        if (from !== rng) rng.value = val;
        row.classList.toggle('changed', val !== it.value);
        renderSelect(); renderFoot();
      };
      rng.oninput = () => apply(+rng.value, rng);
      num.onchange = () => apply(+num.value, num);
      num.onkeydown = (e) => { if (e.key === 'Enter') num.blur(); };
      row.querySelector('.dp-reset').onclick = () => { resetTune(gameId, k); renderList(); renderSelect(); renderFoot(); };
    }
    renderFoot();
  }

  function renderFoot() {
    const n = Object.keys(overrides(gameId)).length;
    const anyGame = Object.keys(GAME_MAP).some((id) => Object.keys(overrides(id)).length);
    foot.innerHTML = `${server ? `<button class="ph-btn small green" data-a="save" ${n ? '' : 'disabled'} title="Write these values into games/${esc(gameId)}/tuning.js as the new defaults">💾 Save as defaults</button>` : ''}
      <button class="ph-btn small" data-a="download" ${n ? '' : 'disabled'} title="Download a tuning.js with these values as the defaults">⬇ Download tuning.js</button>
      <button class="ph-btn small ghost" data-a="copy" ${anyGame ? '' : 'disabled'} title="Copy every changed value (all games) as text">📋 Copy changes</button>
      <button class="ph-btn small danger" data-a="resetall" ${n ? '' : 'disabled'}>Reset game</button>
      <div class="dp-msg">${n ? `${n} value${n > 1 ? 's' : ''} differ from the defaults.` : ''}</div>`;
  }

  // Build the new tuning.js: the same file with each `NAME: { value: X` set to the value in use now.
  async function buildFile(id) {
    const dir = GAME_MAP[id].dir || id;
    let text = await (await fetch(`games/${dir}/tuning.js?t=${Date.now()}`, { cache: 'no-store' })).text();
    const t = tuningOf(id);
    for (const it of t.items.values()) {
      const v = fmt(currentValue(id, it.name), it.step);
      const re = new RegExp(`(\\b${it.name}\\s*:\\s*\\{\\s*value\\s*:\\s*)(-?[0-9.eE+-]+)`);
      if (!re.test(text)) throw new Error(`Couldn't find ${it.name} in tuning.js`);
      text = text.replace(re, (_, head) => head + v);
    }
    return text;
  }
  async function changesText() {
    const out = [];
    for (const m of Object.values(GAME_MAP)) {
      const o = overrides(m.id), keys = Object.keys(o);
      if (!keys.length) continue;
      try { await import(`../games/${m.dir || m.id}/tuning.js`); } catch { /* listed without defaults */ }
      const t = tuningOf(m.id);
      out.push(`${m.name} (games/${m.dir || m.id}/tuning.js):`);
      for (const k of keys) { const it = t?.items.get(k); out.push(`  ${k}${it?.label ? ` (${it.label})` : ''}: ${it ? it.value : '?'} -> ${o[k]}`); }
    }
    return out.join('\n');
  }
  async function lobbyReady(timeout = 8000) {
    const end = performance.now() + timeout;
    while (performance.now() < end) { if (api.state?.phase === 'lobby') return true; await sleep(100); }
    return false;
  }
  async function play() {
    if (!api.state) { msg('Starting a solo party…'); await solo(); if (!(await lobbyReady())) { msg('Could not start a party.'); return; } }
    const S = api.state;
    if (S.hostId !== api.pid) { msg('Only the host can start games.'); return; }
    if (S.phase !== 'lobby') { msg('Finish or end the current round first.'); return; }
    const m = GAME_MAP[gameId], n = S.players.length;
    for (let i = n; i < m.minPlayers; i++) act({ type: 'bot+' });
    act({ type: 'mode', mode: 'pick' }); act({ type: 'choose', game: gameId }); act({ type: 'start', force: true });
    if ($('#dpSkip').checked) {
      for (let i = 0; i < 40 && api.state?.phase !== 'setup'; i++) await sleep(50);
      if (api.state?.phase === 'setup') act({ type: 'setupReady', v: true });
    }
  }
  async function endRound() {
    const S = api.state; if (!S) return;
    if (['setup', 'loading', 'countdown', 'playing'].includes(S.phase)) act({ type: 'endGame' });
    const end = performance.now() + 8000;
    while (performance.now() < end && api.state && api.state.phase !== 'lobby') {
      if (['results', 'podium'].includes(api.state.phase)) act({ type: 'continue' });
      await sleep(150);
    }
  }

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    try {
      if (a === 'min') setMin(!root.classList.contains('min'));
      else if (a === 'play') await play();
      else if (a === 'end') await endRound();
      else if (a === 'restart') { await endRound(); await play(); }
      else if (a === 'resetall') { resetTune(gameId); renderList(); renderSelect(); }
      else if (a === 'copy') { await navigator.clipboard.writeText(await changesText()); msg('Copied. Paste it to Claude to make these the defaults.'); }
      else if (a === 'download') {
        const text = await buildFile(gameId);
        const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
        const link = Object.assign(document.createElement('a'), { href: url, download: 'tuning.js' });
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        msg(`Downloaded. Replace games/${GAME_MAP[gameId].dir || gameId}/tuning.js with it.`);
      } else if (a === 'save') {
        const text = await buildFile(gameId);
        const r = await fetch(`__portal/save?game=${encodeURIComponent(GAME_MAP[gameId].dir || gameId)}`, { method: 'PUT', body: text });
        if (!r.ok) throw new Error(await r.text());
        for (const it of tuningOf(gameId).items.values()) it.value = fmt(currentValue(gameId, it.name), it.step);
        resetTune(gameId); renderList(); renderSelect();
        msg('Saved as the new defaults. Commit the file to publish it.');
      }
    } catch (err) { console.error(err); msg('⚠ ' + (err.message || err)); }
  });

  renderFoot();
  load();
  return { root };
}
