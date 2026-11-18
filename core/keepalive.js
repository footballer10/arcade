// A 1-second clock that keeps running while the page is in a background tab. Browsers (Safari especially) slow
// page timers in hidden tabs to once a minute or pause them, and then the connection servers forget a host who is
// waiting in another tab: friends get "no party with that code". Messages from a worker keep arriving, so the
// heartbeats, server pings and reconnects driven from here keep the party reachable.
const fns = new Set();
let worker = null;
function run() { for (const f of [...fns]) { try { f(); } catch (e) { console.error('keepalive', e); } } }
function start() {
  if (worker) return;
  try {
    worker = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),1000)'], { type: 'text/javascript' })));
    worker.onmessage = run;
  } catch { setInterval(run, 1000); worker = true; }
}
// Calls fn about once a second (also in background tabs). Returns a function that stops it.
export function everySecond(fn) { start(); fns.add(fn); return () => fns.delete(fn); }
