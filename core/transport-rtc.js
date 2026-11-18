// A WebRTC connection whose setup messages (offer / answer / candidates) travel through the MQTT relay instead of
// the PeerJS server. Some networks (schools) block the PeerJS server but allow WebRTC itself through our TURN server;
// this gets those players a fast direct link anyway. Same Conn interface as transport-peer.js / transport-relay.js.
import { loadIceServers } from './transport-peer.js';

function b64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function unb64(str) { const s = atob(str), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }

export class RtcConn {
  constructor(pc, remote) {
    this.pc = pc; this.remote = remote; this.via = 'direct'; this.ctrl = null; this.fast = null; this.closed = false;
    this.onmessage = null; this.onraw = null; this.onclose = null; this.path = 'webrtc (set up via relay)';
    pc.addEventListener('connectionstatechange', () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'closed') this._closed();
      else if (st === 'disconnected') setTimeout(() => { if (['disconnected', 'failed'].includes(pc.connectionState)) this._closed(); }, 4000);
    });
  }
  get open() { return !this.closed && this.ctrl?.readyState === 'open'; }
  send(obj) { if (this.open) { try { this.ctrl.send(JSON.stringify(obj)); } catch { /* */ } } }
  sendRaw(buf) {
    if (this.closed) return;
    if (this.fast?.readyState === 'open') { try { this.fast.send(buf); return; } catch { /* fall back */ } }
    this.send({ __raw: b64(buf) });
  }
  attach(dc) {
    dc.binaryType = 'arraybuffer';
    if (dc.label.startsWith('fast')) { this.fast = dc; dc.onmessage = (e) => { if (e.data instanceof ArrayBuffer) this.onraw?.(e.data); }; return; }
    this.ctrl = dc;
    dc.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m && m.__raw) this.onraw?.(unb64(m.__raw)); else this.onmessage?.(m); };
    dc.onclose = () => this._closed();
  }
  _closed() { if (this.closed) return; this.closed = true; try { this.pc.close(); } catch { /* */ } this.onclose?.(); }
  close() { this._closed(); }
}

// Joiner side: offer through the relay to `target` (a relay address or room alias). post(msg) sends a relay message.
export async function rtcConnect(post, target, timeout, register) {
  const pc = new RTCPeerConnection({ iceServers: await loadIceServers() });
  const sid = Math.random().toString(36).slice(2, 10);
  const conn = new RtcConn(pc, target);
  conn.attach(pc.createDataChannel('ctrl'));
  conn.attach(pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (why) => { if (done) return; done = true; clearTimeout(t); register(sid, null); try { pc.close(); } catch { /* */ } reject(Object.assign(new Error(why), { type: 'timeout', ice: 'via relay: ' + pc.iceConnectionState })); };
    const t = setTimeout(() => fail('timeout'), timeout);
    const early = [];   // candidates that arrive before the answer
    register(sid, {
      answer: (sdp) => pc.setRemoteDescription({ type: 'answer', sdp }).then(() => { for (const c of early.splice(0)) pc.addIceCandidate(c).catch(() => {}); }).catch(() => fail('bad answer')),
      cand: (c) => { if (pc.remoteDescription) pc.addIceCandidate(c).catch(() => {}); else early.push(c); },
    });
    pc.onicecandidate = (e) => { if (e.candidate) post({ k: 'rc', to: target, sid, c: e.candidate.toJSON() }); };
    conn.ctrl.addEventListener('open', () => { if (done) return; done = true; clearTimeout(t); register(sid, null); resolve(conn); });
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') fail('ice failed'); });
    pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => post({ k: 'ro', to: target, sid, sdp: pc.localDescription.sdp })).catch(() => fail('offer failed'));
  });
}

// Host side: answer an offer that arrived through the relay. Calls onopen(conn) once the data channel is open.
export async function rtcAnswer(post, from, sid, sdp, register, onopen) {
  const early = [];
  let pc = null;
  register(sid, { cand: (c) => { if (pc?.remoteDescription) pc.addIceCandidate(c).catch(() => {}); else early.push(c); } });
  pc = new RTCPeerConnection({ iceServers: await loadIceServers() });
  const conn = new RtcConn(pc, from);
  let opened = false;
  pc.ondatachannel = (e) => {
    conn.attach(e.channel);
    if (e.channel.label === 'ctrl') e.channel.addEventListener('open', () => { if (!opened) { opened = true; register(sid, null); onopen(conn); } });
  };
  setTimeout(() => { if (!opened) { register(sid, null); try { pc.close(); } catch { /* */ } } }, 30000);
  pc.onicecandidate = (e) => { if (e.candidate) post({ k: 'rc', to: from, sid, c: e.candidate.toJSON() }); };
  await pc.setRemoteDescription({ type: 'offer', sdp });
  for (const c of early.splice(0)) pc.addIceCandidate(c).catch(() => {});
  await pc.setLocalDescription(await pc.createAnswer());
  post({ k: 'ra', to: from, sid, sdp: pc.localDescription.sdp });
}
