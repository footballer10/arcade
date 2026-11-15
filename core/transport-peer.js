// PeerJS (WebRTC) transport: free public PeerJS signalling server, peer-to-peer data channels.
// Each connection is a pair of data channels: 'ctrl' (reliable, JSON) and 'fast' (unreliable, unordered, binary).
// Implements the transport interface described in core/net.js.

const PREFIX = 'fb10-partyhub-';
let PeerCls = null;
async function loadPeer() {
  if (!PeerCls) { const m = await import('peerjs'); PeerCls = m.Peer || m.default; }
  return PeerCls;
}

// Unreliable snapshots: PeerJS only exposes `ordered`, so patch the channel config for our 'fast' label.
if (window.RTCPeerConnection && !RTCPeerConnection.prototype.__phPatched) {
  const orig = RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel = function (label, cfg) {
    if (String(label).startsWith('fast')) cfg = { ordered: false, maxRetransmits: 0 };
    return orig.call(this, label, cfg);
  };
  RTCPeerConnection.prototype.__phPatched = true;
}

function peerOptions() {
  // ?peer=host:port points at a self-hosted PeerJS server (used by the automated tests).
  const p = new URLSearchParams(location.search).get('peer');
  if (!p) return { debug: 0 };
  const [host, port] = p.split(':');
  return { debug: 0, host, port: +port || 9000, path: '/', secure: false, config: { iceServers: [] } };
}

const toAB = (d) => d instanceof ArrayBuffer ? d : ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : null;
const rid = () => Math.random().toString(36).slice(2, 10);
function b64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function unb64(str) { const s = atob(str), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }

class PeerConn {
  constructor(remote) { this.remote = remote; this.ctrl = null; this.fast = null; this.closed = false; this.onmessage = null; this.onraw = null; this.onclose = null; }
  get open() { return !this.closed && !!this.ctrl?.open; }
  send(obj) { if (this.open) { try { this.ctrl.send(obj); } catch (e) { console.warn('send failed', e); } } }
  sendRaw(buf) {
    if (this.closed) return;
    if (this.fast?.open) { try { this.fast.send(buf); return; } catch { /* fall back */ } }
    if (this.ctrl?.open) this.send({ __raw: b64(buf) });
  }
  _attach(dc, kind) {
    if (kind === 'fast') {
      this.fast = dc;
      dc.on('data', (d) => { const ab = toAB(d); if (ab) this.onraw?.(ab); else if (d instanceof Blob) d.arrayBuffer().then((x) => this.onraw?.(x)); });
      return;
    }
    this.ctrl = dc;
    dc.on('data', (m) => { if (m && m.__raw) this.onraw?.(unb64(m.__raw)); else this.onmessage?.(m); });
    dc.on('close', () => this._closed());
    dc.on('error', () => this._closed());
  }
  _closed() { if (this.closed) return; this.closed = true; try { this.fast?.close(); } catch { /* */ } this.onclose?.(); }
  close() { if (this.closed) return; try { this.ctrl?.close(); } catch { /* */ } try { this.fast?.close(); } catch { /* */ } this._closed(); }
}

export class PeerTransport {
  constructor() { this.kind = 'peer'; this.addr = null; this.peer = null; this.aliasPeers = new Map(); this.onconnection = null; this.ondown = null; this.pending = new Map(); }
  roomAddr(code) { return PREFIX + 'room-' + code; }
  async _openPeer(id) {
    const P = await loadPeer();
    return new Promise((res, rej) => {
      const p = id ? new P(id, peerOptions()) : new P(peerOptions());
      const t = setTimeout(() => { p.destroy(); rej(Object.assign(new Error('Could not reach the PeerJS server'), { type: 'network' })); }, 12000);
      const onErr = (e) => { clearTimeout(t); p.destroy(); rej(e); };
      p.on('error', onErr);
      p.on('open', () => { clearTimeout(t); p.off('error', onErr); this._wire(p); res(p); });
    });
  }
  _wire(p) {
    p.on('connection', (dc) => this._incoming(dc));
    p.on('disconnected', () => { if (!p.destroyed) setTimeout(() => { try { if (!p.destroyed && p.disconnected) p.reconnect(); } catch { /* */ } }, 1000); });
    p.on('error', (e) => { if (e.type === 'peer-unavailable') { const m = String(e.message || ''); for (const [target, rej] of this.pending) if (m.includes(target)) rej(e); } });
  }
  _incoming(dc) {
    const md = dc.metadata || {};
    const key = dc.peer + '|' + (md.cid || dc.label);
    let c = this.pending.get('in:' + key);
    if (!c) { c = new PeerConn(dc.peer); this.pending.set('in:' + key, c); setTimeout(() => this.pending.delete('in:' + key), 15000); }
    const kind = md.kind || (dc.label.startsWith('fast') ? 'fast' : 'ctrl');
    c._attach(dc, kind);
    if (kind === 'ctrl') dc.on('open', () => this.onconnection?.(c));
  }
  async open() { this.peer = await this._openPeer(null); this.addr = this.peer.id; return this.addr; }
  async claim(alias) {
    if (this.aliasPeers.has(alias)) return;
    const p = await this._openPeer(alias);
    this.aliasPeers.set(alias, p);
  }
  release(alias) { const p = this.aliasPeers.get(alias); if (p) { this.aliasPeers.delete(alias); try { p.destroy(); } catch { /* */ } } }
  connect(target, timeout = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.peer || this.peer.destroyed) { reject(new Error('not open')); return; }
      const cid = rid();
      const c = new PeerConn(target);
      let done = false;
      const fail = (e) => { if (done) return; done = true; clearTimeout(t); this.pending.delete(target); c.close(); reject(e); };
      const t = setTimeout(() => fail(Object.assign(new Error('timeout'), { type: 'timeout' })), timeout);
      this.pending.set(target, fail);
      const ctrl = this.peer.connect(target, { label: 'ctrl-' + cid, reliable: true, serialization: 'json', metadata: { cid, kind: 'ctrl' } });
      const fast = this.peer.connect(target, { label: 'fast-' + cid, reliable: false, serialization: 'raw', metadata: { cid, kind: 'fast' } });
      c._attach(fast, 'fast');
      c._attach(ctrl, 'ctrl');
      ctrl.on('open', () => { if (done) return; done = true; clearTimeout(t); this.pending.delete(target); resolve(c); });
      ctrl.on('close', () => fail(Object.assign(new Error('closed'), { type: 'closed' })));
    });
  }
  close() {
    for (const a of [...this.aliasPeers.keys()]) this.release(a);
    try { this.peer?.destroy(); } catch { /* */ }
    this.peer = null;
  }
}
