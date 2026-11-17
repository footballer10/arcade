// Relay transport: party messages travel through a free public MQTT broker over a normal secure WebSocket (wss).
// It's the fallback when a direct WebRTC link can't be made (school / managed laptops, strict firewalls, no working
// TURN relay). Slower than a direct link, but it gets through anywhere a website loads. No account or key needed.
// Same interface as the other transports (see core/net.js). Messages are JSON; binary packets are base64.
// The host connects to every broker it can reach and answers on whichever one a joiner used.
import { MqttClient } from './mqtt.js';

// ?relay=url1,url2 overrides the broker list (the automated tests run their own broker).
const OVERRIDE = new URLSearchParams(location.search).get('relay');
export const BROKERS = OVERRIDE ? OVERRIDE.split(',') : ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const ROOT = 'fb10-partyhub/v1/';
const rid = () => Math.random().toString(36).slice(2, 10);
function b64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function unb64(str) { const s = atob(str), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }

class RelayConn {
  constructor(t, remote, cid, broker) { this.t = t; this.remote = remote; this.cid = cid; this.broker = broker; this.via = 'relay'; this.closed = false; this.onmessage = null; this.onraw = null; this.onclose = null; }
  get open() { return !this.closed && !!this.t.clients[this.broker]?.open; }
  send(obj) { if (!this.closed) this.t._post(this.broker, { k: 'm', to: this.remote, cid: this.cid, d: obj }); }
  sendRaw(buf) { if (!this.closed) this.t._post(this.broker, { k: 'r', to: this.remote, cid: this.cid, d: b64(buf) }); }
  _closed() { if (this.closed) return; this.closed = true; this.t.conns.delete(this.cid); this.onclose?.(); }
  close() { if (this.closed) return; this.t._post(this.broker, { k: 'fin', to: this.remote, cid: this.cid }); this._closed(); }
}

export class RelayTransport {
  constructor() { this.kind = 'relay'; this.addr = null; this.clients = []; this.aliases = new Set(); this.conns = new Map(); this.waiting = new Map(); this.onconnection = null; }
  roomAddr(code) { return 'room-' + code; }
  async open() {
    this.addr = 'R' + rid();
    const results = await Promise.allSettled(BROKERS.map((url, i) => new MqttClient(url, {
      onMessage: (topic, data) => { try { this._on(i, JSON.parse(new TextDecoder().decode(data))); } catch { /* not ours */ } },
      onClose: () => { for (const c of [...this.conns.values()]) if (c.broker === i) c._closed(); },
    }).connect(5000)));
    this.clients = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    if (!this.clients.some(Boolean)) throw Object.assign(new Error('No relay server reachable'), { type: 'network' });
    this._sub(this.addr);
    return this.addr;
  }
  _sub(name) { for (const c of this.clients) c?.subscribe(ROOT + name); }
  _post(i, m) { m.from = this.addr; const c = this.clients[i]; if (c?.open) c.publish(ROOT + m.to, JSON.stringify(m)); }
  _postAll(m) { this.clients.forEach((c, i) => { if (c) this._post(i, { ...m }); }); }
  _mine(to) { return to === this.addr || this.aliases.has(to); }
  _on(i, m) {
    if (!m || m.from === this.addr) return;
    switch (m.k) {
      case 'who': if (this.aliases.has(m.alias)) this._post(i, { k: 'own', to: m.from, alias: m.alias }); break;
      case 'own': this.waiting.get('own:' + m.alias)?.(); break;
      case 'syn': {
        if (!this._mine(m.to) || this.conns.has(m.cid)) return;
        const c = new RelayConn(this, m.from, m.cid, i);
        this.conns.set(m.cid, c);
        this._post(i, { k: 'ack', to: m.from, cid: m.cid });
        setTimeout(() => this.onconnection?.(c), 0);
        break;
      }
      case 'ack': if (m.to === this.addr) this.waiting.get('ack:' + m.cid)?.(i); break;
      case 'm': this.conns.get(m.cid)?.onmessage?.(m.d); break;
      case 'r': this.conns.get(m.cid)?.onraw?.(unb64(m.d)); break;
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
      const t = setTimeout(() => { this.waiting.delete('ack:' + cid); reject(Object.assign(new Error('Room not found on relay'), { type: 'peer-unavailable' })); }, timeout);
      this.waiting.set('ack:' + cid, (i) => {
        clearTimeout(t); this.waiting.delete('ack:' + cid);
        const c = new RelayConn(this, target, cid, i);
        this.conns.set(cid, c); resolve(c);
      });
      this._postAll({ k: 'syn', to: target, cid });   // first broker to answer wins
    });
  }
  close() {
    for (const c of [...this.conns.values()]) c.close();
    setTimeout(() => { for (const c of this.clients) c?.close(); this.clients = []; }, 100);
    this.aliases.clear();
  }
}
