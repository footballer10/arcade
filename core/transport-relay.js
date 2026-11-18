// Relay transport: party messages travel through a free public MQTT broker over a normal secure WebSocket (wss).
// It's the fallback when a direct WebRTC link can't be made (school / managed laptops, strict firewalls, no working
// TURN relay). Slower than a direct link, but it gets through anywhere a website loads. No account or key needed.
// Same interface as the other transports (see core/net.js). Control messages are JSON; game packets (sendRaw) go as
// compact binary frames, and are dropped rather than queued when the connection is backed up, so a slow moment
// never turns into seconds of built-up delay.
// The host connects to every broker it can reach and answers on whichever one a joiner used.
import { MqttClient } from './mqtt.js';
import { everySecond } from './keepalive.js';

// ?relay=url1,url2 overrides the broker list (the automated tests run their own broker).
const OVERRIDE = new URLSearchParams(location.search).get('relay');
// Several independent free brokers: any one that both players can reach is enough.
export const BROKERS = OVERRIDE ? OVERRIDE.split(',') : ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt', 'wss://mqtt.eclipseprojects.io:443/mqtt'];
const ROOT = 'fb10-partyhub/v1/';
const rid = () => Math.random().toString(36).slice(2, 10);
const enc = new TextEncoder(), dec = new TextDecoder();
// Binary game packet: [1][len][cid ascii][payload]  (JSON messages always start with '{')
function rawFrame(cid, buf) {
  const c = enc.encode(cid), out = new Uint8Array(2 + c.length + buf.byteLength);
  out[0] = 1; out[1] = c.length; out.set(c, 2); out.set(new Uint8Array(buf), 2 + c.length);
  return out;
}
const BACKLOG = 16 * 1024;   // bytes waiting in the socket: beyond this, unreliable packets are dropped

class RelayConn {
  constructor(t, remote, cid, broker) { this.t = t; this.remote = remote; this.cid = cid; this.broker = broker; this.via = 'relay'; this.closed = false; this.onmessage = null; this.onraw = null; this.onclose = null; }
  get open() { return !this.closed && !!this.t.clients[this.broker]?.open; }
  send(obj) { if (!this.closed) this.t._post(this.broker, { k: 'm', to: this.remote, cid: this.cid, d: obj }); }
  sendRaw(buf) { if (!this.closed) this.t._postRaw(this.broker, this.remote, this.cid, buf); }
  _closed() { if (this.closed) return; this.closed = true; this.t.conns.delete(this.cid); this.onclose?.(); }
  close() { if (this.closed) return; this.t._post(this.broker, { k: 'fin', to: this.remote, cid: this.cid }); this._closed(); }
}

export class RelayTransport {
  constructor() { this.kind = 'relay'; this.addr = null; this.clients = []; this.aliases = new Set(); this.conns = new Map(); this.waiting = new Map(); this.onconnection = null; }
  roomAddr(code) { return 'room-' + code; }
  // Resolves as soon as one broker is connected (plus a short moment for the others); slow or blocked brokers keep
  // connecting in the background and join in when they're up. A broker that drops is reconnected automatically
  // (and re-subscribed to our address and party code), with growing waits between tries.
  open() {
    this.addr = 'R' + rid();
    this.clients = BROKERS.map(() => null); this.connecting = BROKERS.map(() => false);
    this.retryAt = BROKERS.map(() => 0); this.backoff = BROKERS.map(() => 3000);
    return new Promise((resolve, reject) => {
      let left = BROKERS.length, settled = false, grace = null;
      const ok = () => { if (settled) return; settled = true; clearTimeout(grace); this._stopMaint = everySecond(() => this._maintain()); resolve(this.addr); };
      BROKERS.forEach((url, i) => {
        this._connectBroker(i).then(() => { if (!grace) grace = setTimeout(ok, 600); }, () => {}).finally(() => {
          if (--left === 0 && !settled) { if (this.clients.some(Boolean)) ok(); else { settled = true; reject(Object.assign(new Error('No relay server reachable'), { type: 'network' })); } }
        });
      });
    });
  }
  _connectBroker(i) {
    this.connecting[i] = true;
    return new MqttClient(BROKERS[i], {
      onMessage: (topic, data) => {
        if (data[0] === 1) { const n = data[1], cid = dec.decode(data.subarray(2, 2 + n)); const c = this.conns.get(cid); if (c?.onraw) c.onraw(data.slice(2 + n).buffer); return; }
        try { this._on(i, JSON.parse(dec.decode(data))); } catch { /* not ours */ }
      },
      onClose: () => {
        if (this.clients[i]) this.clients[i] = null;
        this.retryAt[i] = performance.now() + 1000;
        for (const c of [...this.conns.values()]) if (c.broker === i) c._closed();
      },
    }).connect(6000).then((c) => {
      this.connecting[i] = false;
      if (this.closed) { c.close(); return c; }
      this.clients[i] = c; this.backoff[i] = 3000;
      c.subscribe(ROOT + this.addr); for (const al of this.aliases) c.subscribe(ROOT + al);
      return c;
    }, (e) => {
      this.connecting[i] = false;
      this.retryAt[i] = performance.now() + this.backoff[i]; this.backoff[i] = Math.min(60000, this.backoff[i] * 2);
      throw e;
    });
  }
  _maintain() {
    if (this.closed) return;
    const now = performance.now();
    BROKERS.forEach((url, i) => { if (!this.clients[i] && !this.connecting[i] && now >= this.retryAt[i]) this._connectBroker(i).catch(() => {}); });
  }
  connectedBrokers() { return this.clients.filter((c) => c?.open).length; }
  _sub(name) { for (const c of this.clients) c?.subscribe(ROOT + name); }
  _post(i, m) { m.from = this.addr; const c = this.clients[i]; if (c?.open) c.publish(ROOT + m.to, JSON.stringify(m)); }
  _postRaw(i, to, cid, buf) {
    const c = this.clients[i];
    if (!c?.open) return;
    if (c.backlog() > BACKLOG) { this.dropped = (this.dropped || 0) + 1; return; }   // unreliable: better lost than late
    c.publish(ROOT + to, rawFrame(cid, buf));
  }
  _postAll(m) { this.clients.forEach((c, i) => { if (c) this._post(i, { ...m }); }); }
  _mine(to) { return to === this.addr || this.aliases.has(to); }
  _on(i, m) {
    if (!m || m.from === this.addr) return;
    switch (m.k) {
      case 'who': if (this.aliases.has(m.alias)) this._post(i, { k: 'own', to: m.from, alias: m.alias }); break;
      case 'own': this.waiting.get('own:' + m.alias)?.(); break;
      case 'syn': {
        if (!this._mine(m.to)) return;
        if (this.conns.has(m.cid)) { const c = this.conns.get(m.cid); if (c.remote === m.from) this._post(c.broker, { k: 'ack', to: m.from, cid: m.cid }); return; }   // repeated syn: ack again
        const c = new RelayConn(this, m.from, m.cid, i);
        this.conns.set(m.cid, c);
        this._post(i, { k: 'ack', to: m.from, cid: m.cid });
        setTimeout(() => this.onconnection?.(c), 0);
        break;
      }
      case 'ack': if (m.to === this.addr) this.waiting.get('ack:' + m.cid)?.(i); break;
      case 'm': this.conns.get(m.cid)?.onmessage?.(m.d); break;
      case 'fin': this.conns.get(m.cid)?._closed(); break;
    }
  }
  claim(alias) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.waiting.delete('own:' + alias); this.aliases.add(alias); this._sub(alias); res(); }, 900);
      this.waiting.set('own:' + alias, () => { clearTimeout(t); this.waiting.delete('own:' + alias); rej(Object.assign(new Error('Room code taken'), { type: 'unavailable-id' })); });
      this._sub(this.addr);
      this._postAll({ k: 'who', to: alias, alias });
    });
  }
  release(alias) { this.aliases.delete(alias); for (const c of this.clients) c?.unsubscribe(ROOT + alias); }
  connect(target, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const cid = rid();
      let resend = 0;
      const t = setTimeout(() => { clearInterval(resend); this.waiting.delete('ack:' + cid); reject(Object.assign(new Error('Room not found on relay'), { type: 'peer-unavailable' })); }, timeout);
      this.waiting.set('ack:' + cid, (i) => {
        clearTimeout(t); clearInterval(resend); this.waiting.delete('ack:' + cid);
        const c = new RelayConn(this, target, cid, i);
        this.conns.set(cid, c); resolve(c);
      });
      // ask on every broker we're connected to (first to answer wins); repeat, since brokers can come up later
      this._postAll({ k: 'syn', to: target, cid });
      resend = setInterval(() => this._postAll({ k: 'syn', to: target, cid }), 1200);
    });
  }
  close() {
    this.closed = true; this._stopMaint?.();
    for (const c of [...this.conns.values()]) c.close();
    setTimeout(() => { for (const c of this.clients) c?.close(); this.clients = []; }, 100);
    this.aliases.clear();
  }
}
