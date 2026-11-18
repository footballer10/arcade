// Tiny MQTT 3.1.1 client over WebSocket (no library). Used by transport-relay.js to pass party messages through a
// free public broker when a direct WebRTC connection can't be made. QoS 0 only: connect, subscribe, publish, ping.
import { everySecond } from './keepalive.js';
const enc = new TextEncoder(), dec = new TextDecoder();
function varLen(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return out; }
function str(s) { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
function packet(type, flags, body) {
  const b = body instanceof Uint8Array ? body : Uint8Array.from(body);
  const head = [(type << 4) | flags, ...varLen(b.length)];
  const out = new Uint8Array(head.length + b.length); out.set(head); out.set(b, head.length);
  return out;
}

export class MqttClient {
  // url: wss://host:port/path · onMessage(topic, Uint8Array) · onClose()
  constructor(url, { onMessage, onClose, keepAlive = 30 } = {}) {
    this.url = url; this.onMessage = onMessage; this.onClose = onClose; this.keepAlive = keepAlive;
    this.ws = null; this.buf = new Uint8Array(0); this.pid = 1; this.closed = false; this.ping = null;
  }
  connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (e) => { if (done) return; done = true; clearTimeout(t); try { this.ws?.close(); } catch { /* */ } reject(e); };
      const t = setTimeout(() => fail(new Error('relay timeout')), timeoutMs);
      try { this.ws = new WebSocket(this.url, 'mqtt'); } catch (e) { fail(e); return; }
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        const id = 'ph' + Math.random().toString(36).slice(2, 12);
        // CONNECT: protocol "MQTT", level 4, clean session, keep-alive, client id
        this.ws.send(packet(1, 0, [...str('MQTT'), 4, 2, this.keepAlive >> 8, this.keepAlive & 255, ...str(id)]));
      };
      this.ws.onmessage = (e) => {
        const add = new Uint8Array(e.data), b = new Uint8Array(this.buf.length + add.length);
        b.set(this.buf); b.set(add, this.buf.length); this.buf = b;
        for (;;) {
          if (this.buf.length < 2) break;
          let len = 0, mul = 1, i = 1, byte;
          do { if (i >= this.buf.length) return; byte = this.buf[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
          if (this.buf.length < i + len) break;
          const type = this.buf[0] >> 4, body = this.buf.subarray(i, i + len);
          this.buf = this.buf.slice(i + len);
          if (type === 2) {            // CONNACK
            if (done) continue;
            done = true; clearTimeout(t);
            if (body[1] === 0) { let n = 0; this.ping = everySecond(() => { if (++n >= this.keepAlive / 2) { n = 0; this._send(packet(12, 0, [])); } }); resolve(this); }
            else reject(new Error('relay refused ' + body[1]));
          } else if (type === 3) {     // PUBLISH (QoS 0)
            const tl = (body[0] << 8) | body[1];
            this.onMessage?.(dec.decode(body.subarray(2, 2 + tl)), body.subarray(2 + tl));
          }
        }
      };
      this.ws.onerror = () => fail(new Error('relay unreachable'));
      this.ws.onclose = () => { this.ping?.(); this.ping = null; if (!done) fail(new Error('relay closed')); else if (!this.closed) { this.closed = true; this.onClose?.(); } };
    });
  }
  get open() { return !this.closed && this.ws?.readyState === 1; }
  backlog() { return this.ws?.bufferedAmount || 0; }
  _send(p) { if (this.ws?.readyState === 1) this.ws.send(p); }
  subscribe(topic) { const id = this.pid = (this.pid % 65535) + 1; this._send(packet(8, 2, [id >> 8, id & 255, ...str(topic), 0])); }
  unsubscribe(topic) { const id = this.pid = (this.pid % 65535) + 1; this._send(packet(10, 2, [id >> 8, id & 255, ...str(topic)])); }
  publish(topic, payload) {
    const p = typeof payload === 'string' ? enc.encode(payload) : payload;
    const t = str(topic), body = new Uint8Array(t.length + p.length); body.set(t); body.set(p, t.length);
    this._send(packet(3, 0, body));
  }
  close() { if (this.closed) return; this.closed = true; this.ping?.(); this.ping = null; try { this._send(packet(14, 0, [])); this.ws?.close(); } catch { /* */ } }
}
