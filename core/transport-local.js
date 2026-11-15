// BroadcastChannel transport: lets several TABS of the same browser play together with no internet and
// no PeerJS server. Same interface as PeerTransport. Select it with ?net=local (the hub also offers it
// automatically when the PeerJS server can't be reached). Note: separate browser profiles / incognito
// windows don't share a BroadcastChannel, so use tabs of one window.

const CH = 'fb10-partyhub-local-v1';
const rid = () => Math.random().toString(36).slice(2, 10);

class LocalConn {
  constructor(t, remote, cid) { this.t = t; this.remote = remote; this.cid = cid; this.closed = false; this.onmessage = null; this.onraw = null; this.onclose = null; }
  get open() { return !this.closed; }
  send(obj) { if (!this.closed) this.t._post({ k: 'm', to: this.remote, cid: this.cid, d: obj }); }
  sendRaw(buf) { if (!this.closed) this.t._post({ k: 'r', to: this.remote, cid: this.cid, d: buf }); }
  _closed() { if (this.closed) return; this.closed = true; this.t.conns.delete(this.cid); this.onclose?.(); }
  close() { if (this.closed) return; this.t._post({ k: 'fin', to: this.remote, cid: this.cid }); this._closed(); }
}

export class LocalTransport {
  constructor() {
    this.kind = 'local'; this.addr = null; this.aliases = new Set(); this.conns = new Map(); this.waiting = new Map(); this.onconnection = null;
    this.bc = null;
    this._unload = () => { for (const c of [...this.conns.values()]) c.close(); };
  }
  roomAddr(code) { return 'room-' + code; }
  _post(m) { m.from = this.addr; try { this.bc?.postMessage(m); } catch (e) { console.warn('bc post failed', e); } }
  _mine(to) { return to === this.addr || this.aliases.has(to); }
  _on(m) {
    if (!m || m.from === this.addr) return;
    switch (m.k) {
      case 'who': if (this.aliases.has(m.alias)) this._post({ k: 'own', to: m.from, alias: m.alias }); break;
      case 'own': this.waiting.get('own:' + m.alias)?.(); break;
      case 'syn': {
        if (!this._mine(m.to)) return;
        const c = new LocalConn(this, m.from, m.cid);
        this.conns.set(m.cid, c);
        this._post({ k: 'ack', to: m.from, cid: m.cid });
        setTimeout(() => this.onconnection?.(c), 0);
        break;
      }
      case 'ack': if (m.to === this.addr) this.waiting.get('ack:' + m.cid)?.(); break;
      case 'm': if (m.to === this.addr || this._mine(m.to)) this.conns.get(m.cid)?.onmessage?.(m.d); break;
      case 'r': if (m.to === this.addr || this._mine(m.to)) this.conns.get(m.cid)?.onraw?.(m.d); break;
      case 'fin': if (m.to === this.addr || this._mine(m.to)) this.conns.get(m.cid)?._closed(); break;
    }
  }
  async open() {
    if (!window.BroadcastChannel) throw Object.assign(new Error('BroadcastChannel not supported'), { type: 'browser-incompatible' });
    this.addr = 'L' + rid();
    this.bc = new BroadcastChannel(CH);
    this.bc.onmessage = (e) => this._on(e.data);
    addEventListener('pagehide', this._unload);
    return this.addr;
  }
  claim(alias) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.waiting.delete('own:' + alias); this.aliases.add(alias); res(); }, 300);
      this.waiting.set('own:' + alias, () => { clearTimeout(t); this.waiting.delete('own:' + alias); rej(Object.assign(new Error('Room code taken'), { type: 'unavailable-id' })); });
      this._post({ k: 'who', alias });
    });
  }
  release(alias) { this.aliases.delete(alias); }
  connect(target, timeout = 4000) {
    return new Promise((resolve, reject) => {
      const cid = rid();
      const t = setTimeout(() => { this.waiting.delete('ack:' + cid); reject(Object.assign(new Error('Room not found'), { type: 'peer-unavailable' })); }, Math.min(timeout, 2500));
      this.waiting.set('ack:' + cid, () => {
        clearTimeout(t); this.waiting.delete('ack:' + cid);
        const c = new LocalConn(this, target, cid);
        this.conns.set(cid, c); resolve(c);
      });
      this._post({ k: 'syn', to: target, cid });
    });
  }
  close() {
    this._unload(); removeEventListener('pagehide', this._unload);
    try { this.bc?.close(); } catch { /* */ }
    this.bc = null; this.aliases.clear();
  }
}
