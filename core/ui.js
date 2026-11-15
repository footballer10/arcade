// Shared UI components. Games get a scoped instance as ctx.ui — everything it creates is removed on stop().
//   ui.zone('tl'|'tc'|'tr'|'bc')     raw HUD zone element (top-left status, top-center timer, top-right mini scoreboard, bottom-center abilities/items)
//   ui.status(html)                   top-left pill        ui.timer(sec, {warn})   top-center timer (null hides)
//   ui.mini(rows)                     top-right scoreboard rows: [{id, name, color, value, me, out}]
//   ui.abilities(slots)               bottom-center: [{key:'Space', label:'Dash', cd:0..1, ready:true, wide}]
//   ui.bar(fraction, label)           bottom-center meter (power / health)
//   ui.toast(text, kind)  ui.banner(text, ms)  ui.countdown(n)  ui.setScoreboard(() => ({columns, rows}))
import { css } from './palette.js';
import { audio } from './audio.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function el(tag, cls = '', html = '') { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }
export const $ = (id) => document.getElementById(id);

let center = null, toasts = null, bannerEl = null, bannerTimer = 0;
function ensure() {
  if (!center) { center = el('div'); center.id = 'ph-center'; document.body.appendChild(center); }
  if (!toasts) { toasts = el('div'); toasts.id = 'ph-toasts'; document.body.appendChild(toasts); }
  if (!bannerEl) { bannerEl = el('div', 'ph-banner hidden'); document.body.appendChild(bannerEl); }
}
export function toast(text, kind = '', ms = 3000) {
  ensure();
  const t = el('div', 'ph-toast ' + kind); t.textContent = text; t.style.animationDuration = ms + 'ms';
  toasts.appendChild(t); setTimeout(() => t.remove(), ms + 50);
  while (toasts.children.length > 5) toasts.firstChild.remove();
}
export function banner(text, ms = 1500, opts = {}) {
  ensure();
  clearTimeout(bannerTimer);
  if (!text) { bannerEl.classList.add('hidden'); return; }
  bannerEl.textContent = text; bannerEl.classList.toggle('small', !!opts.small || text.length > 16); bannerEl.classList.remove('hidden'); bannerEl.style.opacity = 1;
  if (ms > 0) bannerTimer = setTimeout(() => { bannerEl.classList.add('hidden'); }, ms);
}
export function countdown(n, sound = true) {
  ensure();
  center.innerHTML = '';
  const c = el('div', 'ph-count'); c.textContent = n > 0 ? String(n) : 'GO!';
  center.appendChild(c);
  if (sound) audio.play(n > 0 ? 'tick' : 'go');
}
export function clearCenter() { if (center) center.innerHTML = ''; }

// HUD zones live in #hud (created by index.html). The scoped instance only touches its own children.
export function scopedUI(hub) {
  const hud = $('hud');
  const zones = {};
  const made = [];
  let board = null;
  const zone = (z) => {
    if (!zones[z]) { const e = el('div', 'hud-zone hud-' + z); hud.appendChild(e); zones[z] = e; made.push(e); }
    return zones[z];
  };
  const part = (z, key, cls) => {
    const k = z + ':' + key;
    if (!zones[k]) { const e = el('div', cls); zone(z).appendChild(e); zones[k] = e; }
    return zones[k];
  };
  const cache = new Map();
  const setHTML = (e, html) => { if (cache.get(e) !== html) { cache.set(e, html); e.innerHTML = html; } };
  return {
    zone, esc, el,
    status(html) { const e = part('tl', 'status', 'hud-pill big'); e.classList.toggle('hidden', !html); setHTML(e, html || ''); return e; },
    timer(sec, { warn = 10, text = null } = {}) {
      const e = part('tc', 'timer', 'hud-timer');
      if (sec == null && text == null) { e.classList.add('hidden'); return e; }
      e.classList.remove('hidden');
      const s = Math.max(0, Math.ceil(sec ?? 0));
      setHTML(e, text != null ? esc(text) : s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s));
      e.classList.toggle('warn', text == null && s <= warn);
      return e;
    },
    mini(rows, title = '') {
      const e = part('tr', 'mini', 'hud-mini');
      setHTML(e, (title ? `<div style="opacity:.8;font-size:.8rem">${esc(title)}</div>` : '') + rows.map((r) => `<div class="${r.me ? 'me' : ''} ${r.out ? 'out' : ''}"><span class="ph-dot" style="background:${typeof r.color === 'string' ? r.color : css(r.color ?? 0)}"></span>${esc(r.name)}<span class="v">${r.value ?? ''}</span></div>`).join(''));
      return e;
    },
    abilities(slots) {
      const e = part('bc', 'slots', 'hud-slots');
      if (e.childElementCount !== slots.length) {
        e.innerHTML = slots.map(() => '<div class="hud-slot"><div class="cdfill"></div><kbd></kbd><b></b></div>').join('');
      }
      slots.forEach((s, i) => {
        const d = e.children[i];
        d.className = 'hud-slot' + (s.ready ? ' ready' : '') + (s.wide ? ' wide' : '');
        if (d.children[1].textContent !== s.key) d.children[1].textContent = s.key;
        if (d.children[2].innerHTML !== s.label) d.children[2].innerHTML = s.label;
        d.children[0].style.height = Math.round(Math.max(0, Math.min(1, s.cd || 0)) * 100) + '%';
        d.style.opacity = s.dim ? 0.4 : 1;
      });
      return e;
    },
    bar(f, label = '') {
      const e = part('bc', 'bar', 'hud-col');
      if (!e.firstChild) e.innerHTML = '<div class="hud-pill" style="text-align:center;font-size:.9rem"></div><div class="hud-bar"><div></div></div>';
      e.classList.toggle('hidden', f == null);
      e.firstChild.classList.toggle('hidden', !label);
      if (e.firstChild.textContent !== label) e.firstChild.textContent = label;
      e.lastChild.firstChild.style.width = Math.round(Math.max(0, Math.min(1, f || 0)) * 100) + '%';
      return e;
    },
    toast: (t, kind, ms) => toast(t, kind, ms),
    banner: (t, ms, o) => banner(t, ms, o),
    countdown: (n) => countdown(n),
    setScoreboard(fn) { board = fn; },
    get scoreboard() { return board; },
    dispose() { for (const e of made) e.remove(); for (const k in zones) delete zones[k]; board = null; banner(''); clearCenter(); },
  };
}

// Renders a {columns, rows} table (used by the Tab scoreboard and results screen).
export function tableHTML({ columns = [], rows = [] }) {
  return `<table class="ph-table"><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${rows.map((r) => `<tr class="${r.cls || ''}">${(r.cells || r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
}
