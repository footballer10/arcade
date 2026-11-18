// Online transport used for every real party: PeerJS/WebRTC (fast, direct) + the MQTT relay (works through anything
// that loads websites). The host is reachable both ways at once. A joiner tries the direct link first and falls back
// to the relay automatically if WebRTC can't connect. Same interface as the other transports (see core/net.js).
// Addresses combine both parts: "p:<peerjs id>|r:<relay id>"; room aliases are "room:<CODE>".
import { PeerTransport } from './transport-peer.js';
import { RelayTransport, BROKERS } from './transport-relay.js';

const params = new URLSearchParams(location.search);
const FORCE_RELAY = params.has('forcerelay');          // test-only: skip the direct link to exercise the relay
const RELAY_ONLY = FORCE_RELAY && params.get('forcerelay') !== 'join';   // ?forcerelay=join: relay at first, upgrade allowed
const BLOCK_DIRECT = params.has('blockdirect');        // test-only: the direct link never connects (like a network that blocks it)
const blocked = (ms) => new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { type: 'timeout', ice: 'blocked (test)' })), ms));
const NO_RELAY = params.get('relay') === 'off';         // test-only: direct link only

function parse(addr) {
  if (addr.startsWith('room:')) return { room: addr.slice(5) };
  const out = {};
  for (const part of addr.split('|')) { if (part.startsWith('p:')) out.p = part.slice(2); else if (part.startsWith('r:')) out.r = part.slice(2); }
  return out;
}

export class DualTransport {
  constructor() {
    this.kind = 'peer'; this.addr = null; this.onconnection = null;
    this.peer = new PeerTransport(); this.relay = NO_RELAY ? null : new RelayTransport();
    this.peerOk = false; this.relayOk = false;
  }
  roomAddr(code) { return 'room:' + code; }
  async open() {
    const [p, r] = await Promise.allSettled([this.peer.open(), this.relay ? this.relay.open() : Promise.reject(new Error('relay off'))]);
    this.peerOk = p.status === 'fulfilled'; this.relayOk = r.status === 'fulfilled';
    if (!this.peerOk && !this.relayOk) throw p.reason || r.reason;
    this.peer.onconnection = (c) => { c.via = 'direct'; this.onconnection?.(c); };
    if (this.relay) this.relay.onconnection = (c) => this.onconnection?.(c);
    this.addr = [this.peerOk ? 'p:' + this.peer.addr : '', this.relayOk ? 'r:' + this.relay.addr : ''].filter(Boolean).join('|');
    return this.addr;
  }
  async claim(alias) {
    const code = alias.slice(5);
    let err = null, any = false;
    if (this.peerOk) { try { await this.peer.claim(this.peer.roomAddr(code)); any = true; } catch (e) { err = e; if (e.type === 'unavailable-id') throw e; } }
    if (this.relayOk) { try { await this.relay.claim(this.relay.roomAddr(code)); any = true; } catch (e) { if (e.type === 'unavailable-id' && !any) throw e; err = err || e; } }
    if (!any) throw err || new Error('Could not claim room');
  }
  release(alias) { const code = alias.slice(5); if (this.peerOk) this.peer.release(this.peer.roomAddr(code)); if (this.relayOk) this.relay.release(this.relay.roomAddr(code)); }
  // Both routes at once. The direct link is preferred: if the relay answers first we still give the direct link a
  // couple of seconds; otherwise the player joins through the relay right away and net.js moves them to the direct
  // link in the background as soon as it works. Errors keep the most useful type: 'peer-unavailable' only if
  // neither route knows the room; otherwise 'timeout' (the room exists but couldn't be reached).
  connect(target, timeout = 10000) {
    const a = parse(target);
    const peerTarget = a.room ? this.peer.roomAddr(a.room) : a.p;
    const relayTarget = a.room ? this.relay?.roomAddr(a.room) : a.r;
    const useDirect = this.peerOk && peerTarget && !FORCE_RELAY, useRelay = this.relayOk && relayTarget;
    if (!useDirect && !useRelay) return Promise.reject(Object.assign(new Error('No route to peer'), { type: 'network' }));
    return new Promise((resolve, reject) => {
      let done = false, directErr = null, relayErr = null, relayConn = null, wait = 0, pending = (useDirect ? 1 : 0) + (useRelay ? 1 : 0);
      const describe = () => (FORCE_RELAY ? 'skipped (test)' : !this.peerOk ? 'direct link server unreachable' : directErr ? `${directErr.type || directErr.message}${directErr.ice ? ' · ' + directErr.ice : ''}` : 'still connecting');
      const win = (c) => { done = true; clearTimeout(wait); resolve(c); };
      const failed = () => {
        if (--pending > 0 || done) return;
        if (relayConn) { relayConn.directErr = describe(); win(relayConn); return; }
        done = true;
        const err = [directErr, relayErr].find((e) => e && e.type !== 'peer-unavailable') || directErr || relayErr;
        err.relayErr = relayErr?.message; err.directErr = directErr ? describe() : null;
        reject(err);
      };
      if (useDirect) (BLOCK_DIRECT ? blocked(timeout) : this.peer.connect(peerTarget, timeout)).then((c) => {
        c.via = 'direct';
        if (done) { c.close(); return; }
        if (relayConn) { relayConn.close(); relayConn = null; }
        win(c);
      }, (e) => { directErr = e; if (relayConn && !done) { relayConn.directErr = describe(); win(relayConn); } else failed(); });
      if (useRelay) this.relay.connect(relayTarget, timeout).then((c) => {
        if (done) { c.close(); return; }
        relayConn = c; c.directErr = describe();
        if (!useDirect || directErr) { win(c); return; }
        wait = setTimeout(() => { if (!done && relayConn) { relayConn.directErr = describe(); win(relayConn); } }, 2500);   // give direct a moment
      }, (e) => { relayErr = e; failed(); });
    });
  }
  // Direct (WebRTC) only: used to move a player off the relay once a direct link works.
  connectDirect(target, timeout = 20000) {
    if (!this.peerOk || RELAY_ONLY) return Promise.reject(Object.assign(new Error('direct unavailable'), { type: 'network' }));
    const a = parse(target);
    return (BLOCK_DIRECT ? blocked(timeout) : this.peer.connect(a.room ? this.peer.roomAddr(a.room) : a.p, timeout)).then((c) => { c.via = 'direct'; return c; });
  }
  relayInfo() { return this.relay ? this.relay.clients.map((c, i) => `${new URL(BROKERS[i]).hostname}:${c?.open ? 'ok' : 'down'}`).join(' ') : 'off'; }
  close() { this.peer.close(); this.relay?.close(); }
}
