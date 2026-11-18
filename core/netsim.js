// Lag simulator for developers and the automated tests: ?netsim=ONEWAY,JITTER,STALL,EVERY (milliseconds / seconds).
// Every message a connection sends is held back ONEWAY ms + up to JITTER ms, in order (like the TCP-based relay),
// and about every EVERY seconds the link stalls for STALL ms, so packets bunch up and then arrive together.
//   ?netsim=100,30,250,4   ≈ the school relay (~200 ms round trip, jittery)
// With no ?netsim nothing is wrapped and this file costs nothing.
const P = new URLSearchParams(location.search).get('netsim');
export const NETSIM = P ? (([a, b, c, d]) => ({ base: +a || 0, jitter: +b || 0, stall: +c || 0, every: +d || 0 }))(P.split(',')) : null;

function wrapConn(conn) {
  if (!NETSIM || conn.__sim) return conn;
  conn.__sim = true;
  const { base, jitter, stall, every } = NETSIM;
  let last = 0, stallUntil = 0, nextStall = performance.now() + every * 1000 * (0.5 + Math.random());
  const schedule = (fn) => {
    const now = performance.now();
    if (every && now > nextStall) { stallUntil = now + stall; nextStall = now + every * 1000 * (0.5 + Math.random()); }
    let at = Math.max(now, stallUntil) + base + Math.random() * jitter;
    at = Math.max(at, last); last = at;                       // in order, like a TCP stream
    setTimeout(fn, at - now);
  };
  const send = conn.send.bind(conn), sendRaw = conn.sendRaw.bind(conn);
  conn.send = (m) => { const copy = JSON.parse(JSON.stringify(m)); schedule(() => send(copy)); };
  conn.sendRaw = (b) => { const copy = b.slice(0); schedule(() => sendRaw(copy)); };
  return conn;
}
export function simTransport(t) {
  if (!NETSIM) return t;
  const connect = t.connect.bind(t);
  t.connect = (...a) => connect(...a).then(wrapConn);
  let cb = null;
  Object.defineProperty(t, 'onconnection', { get: () => cb, set: (fn) => { cb = fn ? (c) => fn(wrapConn(c)) : null; }, configurable: true });
  return t;
}
