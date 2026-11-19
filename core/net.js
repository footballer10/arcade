// Party connection (generalised from the old arena/js/net.js netcode). Star topology, host-authoritative:
// clients talk only to the host; the host talks to everyone. The hub owns one PartyNet for the whole session;
// games never touch it directly — they get a per-round channel (see makeChannel / ctx.net).
//
// TRANSPORT INTERFACE (core/transport-peer.js = PeerJS/WebRTC, core/transport-local.js = BroadcastChannel tabs):
//   kind, addr, roomAddr(code) -> string, open() -> Promise<addr>, claim(alias) -> Promise (rejects {type:'unavailable-id'}),
//   release(alias), connect(addr, timeoutMs) -> Promise<Conn>, onconnection = (Conn) => {}, close()
//   Conn: { remote, open, send(obj) /* reliable JSON */, sendRaw(ArrayBuffer) /* unreliable */, onmessage, onraw, onclose, close() }
//
// WIRE FORMAT: hub messages {h:'type', ...}; game messages {g: round, d: payload}; binary game packets [round & 255][payload].
// Events: 'msg' (msg, fromPid)  'game' (round, data, fromPid)  'raw' (round, ArrayBuffer, fromPid)  'peerjoin' (pid, hello)
//         'peerleave' (pid)  'host' (hostPid, amHost, info)  'status' (connected|reconnecting|offline)  'kicked' (reason)
import { Emitter } from './emitter.js';
import { DualTransport } from './transport-dual.js';
import { LocalTransport } from './transport-local.js';
import { simTransport } from './netsim.js';
import { everySecond } from './keepalive.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const randomCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
export const PROTOCOL = 3;   // 2: binary relay packets · 3: confirmed relay→direct switch
const HOST_TIMEOUT = 15000;    // client: no word from host for this long -> host lost (a closed tab is detected sooner via the connection's close event)
const CLIENT_TIMEOUT = 20000; // host: no word from a client -> dropped
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NETLOG = /[?&]netlog=1/.test(location.search);
const nlog = (...a) => { if (NETLOG) console.info('[net]', Math.round(performance.now()), ...a); };

// 'peer' (every real online party) = direct WebRTC with an automatic MQTT-relay fallback; 'local' = tabs (tests).
// Connecting to the signalling + relay servers takes a few seconds, so the hub starts it while the player is still
// on the home screen; the first party created or joined then reuses that ready transport.
let warm = null;
export function prewarm(kind) {
  if (kind === 'local' || warm) return;
  const t = createTransport(kind);
  const w = warm = { kind, t, ready: t.open().then(() => t) };
  w.ready.catch(() => { if (warm === w) warm = null; });
}
export function createTransport(kind) { return simTransport(kind === 'local' ? new LocalTransport() : new DualTransport()); }

export class PartyNet extends Emitter {
  constructor(kind, pid) {
    super();
    this.kind = kind; this.pid = pid;
    this.t = null; this.role = null; this.code = null; this.hostPid = null; this.hostConn = null;
    this.conns = new Map();         // host: pid -> {conn, lastSeen, ping, addr}
    this.roster = [];               // [{pid, addr, human}] in join order (kept fresh by the hub) – used for host migration
    this.diag = [];                 // connection attempts (join / rejoin / upgrade) for the connection report
    this.stats = { rtts: [], freezes: 0, worstFreeze: 0, since: Date.now() };
    this.offset = 0; this.bestRtt = 1e9; this.rtt = 0; this.lastHost = 0;
    this.closed = false; this.helloInfo = null; this.nextHost = null; this.migrating = false;
    this.onHello = () => ({ ok: true }); // host-side admission hook set by the hub
    this._stopBeat = everySecond(() => this._beat());   // keeps going in background tabs
    // Closing a tab doesn't reliably close WebRTC channels quickly, so say goodbye explicitly.
    this._bye = () => {
      if (this.role === 'host') for (const r of this.conns.values()) r.conn.send({ h: 'hostleaving' });
      else if (this.role === 'client') this.hostConn?.send({ h: 'bye' });
    };
    addEventListener('pagehide', this._bye);
  }
  get isHost() { return this.role === 'host'; }
  get addr() { return this.t?.addr; }
  now() { return this.isHost ? performance.now() : performance.now() + this.offset; }   // host clock (ms)
  peerPing(pid) { return this.isHost ? (this.conns.get(pid)?.ping ?? 0) : pid === this.hostPid ? this.rtt : 0; }
  connectedPids() { return [...this.conns.keys()]; }

  async _ensureOpen() {
    if (this.t) return;
    if (warm && warm.kind === this.kind) {
      const w = warm; warm = null; this.t = w.t;
      try { await w.ready; } catch { this.t = createTransport(this.kind); await this.t.open(); }
    } else { this.t = createTransport(this.kind); await this.t.open(); }
    this.t.onconnection = (c) => this._incoming(c);
  }

  // ---------------- host ----------------
  async host(code = null) {
    await this._ensureOpen();
    for (let i = 0; i < 6; i++) {
      const c = code || randomCode();
      try { await this.t.claim(this.t.roomAddr(c)); this.code = c; break; } catch (e) { if (code || e.type !== 'unavailable-id') throw e; }
    }
    if (!this.code) throw new Error('Could not create a room code');
    this.role = 'host'; this.hostPid = this.pid;
    this.emit('status', 'connected');
    return this.code;
  }
  _incoming(conn) {
    let first = true;
    const kill = setTimeout(() => { if (first) conn.close(); }, 8000);
    conn.onmessage = (m) => {
      if (!first) return;
      if (!m || m.h !== 'hello') return;
      first = false; clearTimeout(kill);
      this._hello(conn, m);
    };
  }
  _hello(conn, m) {
    if (m.probe) { conn.send({ h: 'probe', hostPid: this.hostPid, hostAddr: this._hostAddr(), code: this.code, role: this.role }); setTimeout(() => conn.close(), 300); return; }
    if (this.role === 'client') {
      // Someone thinks our host is gone and we are next in line.
      const fresh = performance.now() - this.lastHost < 3000 && this.hostConn?.open;
      if (m.migrate && m.migrate === this.hostPid && !fresh && !this.migrating) this._becomeHost('migration');
      else if (m.migrate && m.migrate === this.hostPid && this.migrating) this._becomeHost('migration');
      else { conn.send({ h: 'redirect', hostPid: this.hostPid }); setTimeout(() => conn.close(), 300); return; }
    }
    if (this.role !== 'host') { conn.send({ h: 'reject', reason: 'Not the host' }); setTimeout(() => conn.close(), 300); return; }
    if (m.v !== PROTOCOL) { conn.send({ h: 'reject', reason: 'Version mismatch — refresh the page.' }); setTimeout(() => conn.close(), 300); return; }
    // A player on the relay found a direct link: keep the old connection until they confirm the switch, so an
    // attempt they give up on changes nothing.
    const cur = this.conns.get(m.pid);
    if (m.upgrade && cur && cur.conn !== conn && cur.conn.open) {
      const rec = cur;
      conn.onraw = (ab) => { rec.lastSeen = performance.now(); const u = new Uint8Array(ab); this.emit('raw', u[0], ab.slice(1), m.pid); };
      conn.onclose = () => {};
      conn.onmessage = (msg) => {
        if (msg?.h !== 'switched' || this.conns.get(m.pid) !== rec) return;
        const old = rec.conn;
        rec.conn = conn; rec.via = conn.via || 'direct'; rec.lastSeen = performance.now();
        conn.onmessage = (x) => this._fromClient(m.pid, rec, x);
        conn.onclose = () => { if (this.conns.get(m.pid) === rec && rec.conn === conn) { nlog('client conn closed', m.pid); this.conns.delete(m.pid); this.emit('peerleave', m.pid); } };
        old.onclose = null; setTimeout(() => { try { old.close(); } catch { /* */ } }, 1500);
        this.emit('peerjoin', m.pid, m, rec.via);
      };
      conn.send({ h: 'welcome', hostPid: this.pid, code: this.code, ht: performance.now() });
      return;
    }
    const verdict = this.onHello(m.pid, m) || { ok: true };
    if (!verdict.ok) { conn.send({ h: 'reject', reason: verdict.reason }); setTimeout(() => conn.close(), 400); return; }
    const old = this.conns.get(m.pid);
    if (old && old.conn !== conn) { old.replaced = true; old.conn.onclose = null; old.conn.close(); }
    const rec = { conn, lastSeen: performance.now(), ping: 0, addr: m.addr, via: conn.via || 'direct' };
    this.conns.set(m.pid, rec);
    conn.onmessage = (msg) => this._fromClient(m.pid, rec, msg);
    conn.onraw = (ab) => { rec.lastSeen = performance.now(); const u = new Uint8Array(ab); this.emit('raw', u[0], ab.slice(1), m.pid); };
    conn.onclose = () => { if (this.conns.get(m.pid) === rec && rec.conn === conn) { nlog('client conn closed', m.pid); this.conns.delete(m.pid); this.emit('peerleave', m.pid); } };
    conn.send({ h: 'welcome', hostPid: this.pid, code: this.code, ht: performance.now() });
    this.emit('peerjoin', m.pid, m, rec.via);
  }
  _fromClient(pid, rec, msg) {
    rec.lastSeen = performance.now();
    if (!msg || typeof msg !== 'object') return;
    if (msg.g !== undefined) { this.emit('game', msg.g, msg.d, pid); return; }
    if (msg.h === 'ping') { rec.ping = msg.rtt || 0; rec.conn.send({ h: 'pong', ct: msg.ct, ht: performance.now() }); return; }
    if (msg.h === 'bye') { rec.conn.close(); return; }
    this.emit('msg', msg, pid);
  }
  _hostAddr() { return this.isHost ? this.t?.addr : this.roster.find((r) => r.pid === this.hostPid)?.addr; }

  // host -> client(s)
  send(pid, msg) {
    if (pid === this.pid) { queueMicrotask(() => this._loop(msg)); return; }
    if (this.isHost) this.conns.get(pid)?.conn.send(msg);
    else if (pid === this.hostPid) this.hostConn?.send(msg);
  }
  broadcast(msg, self = false) {
    if (!this.isHost) return;
    for (const r of this.conns.values()) r.conn.send(msg);
    if (self) queueMicrotask(() => this._loop(msg));
  }
  _loop(msg) { if (msg.g !== undefined) this.emit('game', msg.g, msg.d, this.pid); else this.emit('msg', msg, this.pid); }
  toHost(msg) { if (this.isHost) queueMicrotask(() => this._loop(msg)); else this.hostConn?.send(msg); }
  sendRaw(pid, round, buf) {
    const out = frame(round, buf);
    if (pid === this.pid) { queueMicrotask(() => this.emit('raw', round & 255, out.buffer.slice(1), this.pid)); return; }
    if (this.isHost) this.conns.get(pid)?.conn.sendRaw(out.buffer); else if (pid === this.hostPid) this.hostConn?.sendRaw(out.buffer);
  }
  rawAll(round, buf, self = false) {
    if (!this.isHost) return;
    const out = frame(round, buf);
    for (const r of this.conns.values()) r.conn.sendRaw(out.buffer);
    if (self) queueMicrotask(() => this.emit('raw', round & 255, out.buffer.slice(1), this.pid));
  }
  rawToHost(round, buf) { if (this.isHost) this.sendRaw(this.pid, round, buf); else this.hostConn?.sendRaw(frame(round, buf).buffer); }
  kick(pid, reason) {
    const r = this.conns.get(pid); if (!r) return;
    r.conn.send({ h: 'kicked', reason }); setTimeout(() => r.conn.close(), 300);
  }

  // ---------------- client ----------------
  // onStage(stage): 'server' (reaching the signalling server) → 'party' (asking the room code's host to connect).
  async join(code, hello, onStage = () => {}) {
    onStage('server');
    await this._ensureOpen();
    this.code = code; this.helloInfo = hello;
    onStage('party');
    const ok = await this._tryJoin(this.t.roomAddr(code), 20000);   // relayed (TURN) connections can take a while
    if (ok !== true) throw ok;
  }
  // Resolves true on welcome, or an Error (with .reason / .type / .redirect) otherwise.
  _tryJoin(addr, timeout, extra = {}) {
    return new Promise((resolve) => {
      let done = false, conn = null;
      const finish = (v) => { if (done) return; done = true; clearTimeout(t); if (v !== true) { try { conn?.close(); } catch { /* */ } } resolve(v); };
      const t = setTimeout(() => finish(Object.assign(new Error('timeout'), { type: 'timeout' })), timeout + 4000);
      this.t.connect(addr, timeout).then((c) => {
        conn = c;
        if (done) { c.close(); return; }
        c.onmessage = (m) => {
          if (!m || typeof m !== 'object') return;
          if (m.h === 'welcome') {
            if (this.hostConn && this.hostConn !== c) { this.hostConn.onclose = null; this.hostConn.close(); }
            this.hostConn = c; this.via = c.via || 'direct'; this.role = 'client';
            this.diag.push({ at: Date.now(), what: extra.migrate ? 'migrate' : extra.rejoin ? 'rejoin' : 'join', ok: true, path: this.via + (c.path ? ' ' + c.path : ''), ice: c.directErr || null });
            this.nextUpgrade = performance.now() + 4000; this.upgradeGap = 12000; this.hostPid = m.hostPid; this.code = m.code; this.lastHost = performance.now();
            this.offset = m.ht - performance.now(); this.bestRtt = 1e9; this.nextHost = null; this.migrating = false;
            c.onmessage = (msg) => this._fromHost(c, msg);
            c.onraw = (ab) => this._rawFromHost(c, ab);
            c.onclose = () => { if (c === this.hostConn) { nlog('host conn closed'); this._hostLost(); } };
            finish(true);
            this.emit('status', 'connected');
            this.emit('host', this.hostPid, false, { joined: true });
            return;
          }
          if (m.h === 'reject') finish(Object.assign(new Error(m.reason), { reason: m.reason }));
          else if (m.h === 'redirect') finish(Object.assign(new Error('redirect'), { redirect: m.hostPid }));
        };
        c.onclose = () => finish(Object.assign(new Error('closed'), { type: 'closed' }));
        c.send({ h: 'hello', v: PROTOCOL, pid: this.pid, addr: this.t.addr, ...this.helloInfo, ...extra });
      }).catch((e) => finish(e));
    });
  }
  _isHostConn(c) { return c === this.hostConn || (c === this.graceConn && performance.now() < this.graceUntil); }
  // Freezes: game packets stream at 10–30 per second during a round, so a 0.5–10 s silence is the link stalling.
  _gameIn() {
    const now = performance.now(), gap = now - (this.lastGame || 0);
    if (this.lastGame && gap > 500 && gap < 10000) { this.stats.freezes++; this.stats.worstFreeze = Math.max(this.stats.worstFreeze, Math.round(gap)); }
    this.lastGame = now;
  }
  _fromHost(c, msg) {
    if (!this._isHostConn(c)) return;
    this.lastHost = performance.now();
    if (!msg || typeof msg !== 'object') return;
    if (msg.g !== undefined) { this._gameIn(); this.emit('game', msg.g, msg.d, this.hostPid); return; }
    switch (msg.h) {
      case 'pong': {
        const now = performance.now(), rtt = now - msg.ct;
        this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
        this.stats.rtts.push(Math.round(rtt)); if (this.stats.rtts.length > 120) this.stats.rtts.shift();
        const off = msg.ht + rtt / 2 - now;
        if (rtt <= this.bestRtt * 1.3 || Math.abs(off - this.offset) > 250) { this.offset = this.bestRtt > 5e8 ? off : this.offset * 0.7 + off * 0.3; this.bestRtt = Math.min(this.bestRtt * 1.02 + 1, rtt); }
        return;
      }
      case 'kicked': this.role = null; this.closed = true; this.emit('kicked', msg.reason || 'You were removed from the party.'); return;
      case 'handover': this.nextHost = msg.to; if (msg.to === this.pid) this._becomeHost('handover'); return;
      case 'hostleaving': nlog('host leaving'); this.lastHost = 0; this._hostLost(); return;
    }
    this.emit('msg', msg, this.hostPid);
  }
  _rawFromHost(c, ab) { if (!this._isHostConn(c)) return; this._gameIn(); this.lastHost = performance.now(); const u = new Uint8Array(ab); this.emit('raw', u[0], ab.slice(1), this.hostPid); }
  // A client that had to use the backup relay keeps trying the direct (WebRTC) link in the background and moves
  // over as soon as it works. Messages still in flight on the relay are accepted for a few seconds after the swap.
  async _tryUpgrade() {
    if (this.role !== 'client' || this.migrating || this.closed || this.via !== 'relay' || this._upgrading || !this.t.connectDirect || !this.hostConn) return;
    this._upgrading = true;
    const t0 = performance.now();
    try {
      const c = await this.t.connectDirect(this.t.roomAddr(this.code), 20000);
      await new Promise((resolve) => {
        const bail = () => { clearTimeout(t); try { c.close(); } catch { /* */ } resolve(); };
        const t = setTimeout(bail, 8000);
        c.onclose = () => { clearTimeout(t); resolve(); };
        c.onmessage = (m) => {
          if (!m || typeof m !== 'object') return;
          if (m.h !== 'welcome') { if (m.h === 'reject' || m.h === 'redirect') bail(); return; }
          clearTimeout(t);
          if (m.hostPid !== this.hostPid || this.migrating || this.role !== 'client' || !this.hostConn) { bail(); return; }
          const old = this.hostConn;
          this.graceConn = old; this.graceUntil = performance.now() + 4000;
          old.onclose = null; setTimeout(() => { try { old.close(); } catch { /* */ } if (this.graceConn === old) this.graceConn = null; }, 4000);
          this.hostConn = c; this.via = 'direct'; this.lastHost = performance.now(); this.bestRtt = 1e9; this.rtt = 0;
          c.send({ h: 'switched' });   // the host moves us over (and closes the relay) only after this
          c.onmessage = (msg) => this._fromHost(c, msg);
          c.onraw = (ab) => this._rawFromHost(c, ab);
          c.onclose = () => { if (c === this.hostConn) { nlog('host conn closed'); this._hostLost(); } };
          this.diag.push({ at: Date.now(), what: 'upgrade', ok: true, ms: Math.round(performance.now() - t0), path: c.path || null });
          nlog('upgraded to direct');
          this.emit('upgraded');
          resolve();
        };
        c.send({ h: 'hello', v: PROTOCOL, pid: this.pid, addr: this.t.addr, ...this.helloInfo, rejoin: true, upgrade: true });
      });
    } catch (e) {
      this.diag.push({ at: Date.now(), what: 'upgrade', ok: false, err: e.type || e.message, ice: e.ice || null });
    } finally {
      this._upgrading = false;
      this.nextUpgrade = performance.now() + Math.min(90000, (this.upgradeGap = Math.min(90000, (this.upgradeGap || 15000) * 1.5)));
      if (this.diag.length > 12) this.diag.splice(0, this.diag.length - 12);
    }
  }
  // Plain-text summary of how this player is connected (Settings → Copy connection report).
  report() {
    const lines = [`Party Arcade connection report (${new Date().toISOString()})`, `role: ${this.role || 'none'} · party: ${this.code || '-'} · path to host: ${this.isHost ? 'is host' : this.via || '-'} · ping: ${Math.round(this.rtt || 0)} ms`];
    if (this.isHost) for (const [pid, r] of this.conns) lines.push(`  player ${pid.slice(0, 6)}: ${r.via}${r.conn.path ? ' (' + r.conn.path + ')' : ''} · ping ${Math.round(r.ping)} ms`);
    lines.push(`direct link server: ${this.t.peerOk === false ? 'UNREACHABLE' : 'ok'} · relay servers: ${this.t.relayInfo?.() || '-'}`);
    const r = [...this.stats.rtts].sort((a, b) => a - b), q = (f) => r.length ? r[Math.min(r.length - 1, Math.floor(r.length * f))] : '-';
    if (!this.isHost) lines.push(`ping last ${r.length} samples: best ${q(0)} · typical ${q(0.5)} · bad ${q(0.9)} · worst ${q(1)} ms · freezes over 0.5 s: ${this.stats.freezes} (worst ${this.stats.worstFreeze} ms) in ${Math.round((Date.now() - this.stats.since) / 60000)} min · relay packets dropped (backed up): ${this.t.relay?.dropped || 0}`);
    if (this.hostConn?.path) lines.push(`direct path: ${this.hostConn.path}`);
    for (const d of this.diag) lines.push(`${new Date(d.at).toLocaleTimeString()} ${d.what}: ${d.ok ? 'ok' : 'FAILED (' + d.err + ')'}${d.ms ? ' in ' + d.ms + ' ms' : ''}${d.path ? ' via ' + d.path : ''}${d.ice ? ' · ' + d.ice : ''}`);
    lines.push(`browser: ${navigator.userAgent}`);
    return lines.join('\n');
  }
  setRoster(list) { this.roster = list; }
  // Heavy moments (a game loading: module import, course build, shader compiles) can freeze a slow laptop's
  // main thread for many seconds. The hub calls relax() then so silence isn't mistaken for a dead peer.
  relax(ms = 45000) { this.relaxUntil = Math.max(this.relaxUntil || 0, performance.now() + ms); }
  setHello(info) { this.helloInfo = { ...this.helloInfo, ...info }; }

  // Host gone (tab closed, crashed, or our own Wi-Fi dropped). Exactly one successor is designated: the first
  // human in join order. Everyone (including the successor) first retries the room code, so a client whose own
  // connection blipped simply rejoins the same host instead of splitting the party.
  async _hostLost() {
    if (this.role !== 'client' || this.migrating || this.closed) return;
    this.migrating = true;
    const oldHost = this.hostPid;
    try { this.hostConn.onclose = null; this.hostConn.close(); } catch { /* */ }
    this.hostConn = null;
    this.emit('status', 'reconnecting');
    const dead = new Set([oldHost]), fails = new Map();
    let hostAlive = false;
    const end = performance.now() + 60000;
    while (performance.now() < end && this.role === 'client' && !this.closed) {
      const viaRoom = await this._tryJoin(this.t.roomAddr(this.code), 6000, { rejoin: true });
      nlog('rejoin via room', viaRoom === true ? 'ok' : viaRoom.type || viaRoom.message);
      if (viaRoom === true) return;
      if (viaRoom.reason) { this.migrating = false; this.role = null; this.emit('kicked', viaRoom.reason); return; }
      if (this.role !== 'client') return;
      if (hostAlive || navigator.onLine === false) { await sleep(1500); continue; }
      const cands = this.roster.filter((r) => r.human && !dead.has(r.pid) && (r.connected !== false || r.pid === this.pid));
      if (this.nextHost) cands.sort((a, b) => (b.pid === this.nextHost) - (a.pid === this.nextHost));
      const first = cands[0];
      if (!first) { await sleep(1500); continue; }
      nlog('successor', first.pid, 'fails', fails.get(first.pid) || 0);
      if (first.pid === this.pid) { this._becomeHost('migration', oldHost); return; }
      const r = await this._tryJoin(first.addr, 10000, { rejoin: true, migrate: oldHost });
      if (r === true) return;
      if (this.role !== 'client') return;
      if (r.redirect) { hostAlive = r.redirect === oldHost; if (!hostAlive) await sleep(800); continue; }
      const n = (fails.get(first.pid) || 0) + 1; fails.set(first.pid, n);
      if (n >= 3) dead.add(first.pid);            // successor unreachable three times in a row: next in line
      else await sleep(1000);
    }
    if (this.role === 'client' && !this.hostConn) { this.migrating = false; this.role = null; this.emit('status', 'offline'); }
  }
  _becomeHost(why, oldHost = this.hostPid) {
    if (this.role === 'host') return;
    if (this.hostConn) { this.hostConn.onclose = null; try { this.hostConn.close(); } catch { /* */ } this.hostConn = null; }
    this.role = 'host'; this.migrating = false;
    const prev = this.hostPid, offset = this.offset;
    this.hostPid = this.pid; this.offset = 0;
    this.emit('status', 'connected');
    this.emit('host', this.pid, true, { why, oldHost: oldHost || prev, offset });
    this._claimRoom();
    this.orphanSince = performance.now();
  }
  async _claimRoom(tries = 0) {
    if (this.role !== 'host' || this.closed || tries > 40) return;
    try { await this.t.claim(this.t.roomAddr(this.code)); } catch { setTimeout(() => this._claimRoom(tries + 1), 2500); }
  }
  // Cooperative host transfer (host menu → "Make host").
  handOver(pid) {
    if (!this.isHost || !this.conns.has(pid)) return false;
    this.broadcast({ h: 'handover', to: pid });
    setTimeout(async () => {
      this.t.release(this.t.roomAddr(this.code));
      const target = this.roster.find((r) => r.pid === pid);
      for (const r of this.conns.values()) { r.conn.onclose = null; r.conn.close(); }
      this.conns.clear();
      this.role = 'client'; this.hostPid = pid; this.nextHost = pid;
      this.emit('host', pid, false, { why: 'handover' });
      this.emit('status', 'reconnecting');
      for (let i = 0; i < 20 && this.role === 'client' && !this.hostConn; i++) {
        const r = await this._tryJoin(target?.addr || this.t.roomAddr(this.code), 3000, { rejoin: true });
        if (r === true) return;
        await sleep(700);
      }
      if (!this.hostConn && this.role === 'client') this._hostLost();
    }, 400);
    return true;
  }

  _beat() {
    if (this.closed) return;
    const now = performance.now();
    if (this.role === 'client') {
      if (this.hostConn?.open) this.hostConn.send({ h: 'ping', ct: now, rtt: Math.round(this.rtt) });
      const hostLimit = now < (this.relaxUntil || 0) ? 45000 : HOST_TIMEOUT;
      if (!this.migrating && this.hostConn && now - this.lastHost > hostLimit) { nlog('host silent', Math.round(now - this.lastHost)); this._hostLost(); }
      else if (this.via === 'relay' && now > (this.nextUpgrade || 0)) this._tryUpgrade();
    } else if (this.role === 'host') {
      const clientLimit = now < (this.relaxUntil || 0) ? 45000 : CLIENT_TIMEOUT;
      for (const [pid, r] of this.conns) if (now - r.lastSeen > clientLimit) { nlog('client silent', pid); this.conns.delete(pid); r.conn.onclose = null; r.conn.close(); this.emit('peerleave', pid); }
      this._orphanCheck(now);
    }
  }
  // A host that suddenly has nobody left (other humans exist in the roster) may be the one who dropped off:
  // probe the others; if they've moved on to another host, rejoin as a client there.
  async _orphanCheck(now) {
    const others = this.roster.filter((r) => r.human && r.pid !== this.pid);
    if (this.conns.size > 0 || !others.length) { this.orphanSince = now; return; }
    if (now - (this.orphanSince || now) < 9000 || this.probing) return;
    this.probing = true; this.orphanSince = now;
    for (const o of others) {
      if (!o.addr || this.role !== 'host') continue;
      const info = await this._probe(o.addr);
      if (info && info.hostPid && info.hostPid !== this.pid && info.code === this.code) {
        this.t.release(this.t.roomAddr(this.code));
        this.role = 'client'; this.hostPid = info.hostPid;
        this.emit('host', info.hostPid, false, { why: 'rejoin' });
        const r = await this._tryJoin(info.hostAddr || this.t.roomAddr(this.code), 4000, { rejoin: true });
        if (r !== true) this._hostLost();
        break;
      }
    }
    this.probing = false;
  }
  _probe(addr) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 3000);
      this.t.connect(addr, 2500).then((c) => {
        c.onmessage = (m) => { if (m?.h === 'probe') { clearTimeout(t); resolve(m); c.close(); } };
        c.send({ h: 'hello', v: PROTOCOL, pid: this.pid, probe: true });
      }).catch(() => { clearTimeout(t); resolve(null); });
    });
  }
  leave() {
    if (this.closed) return;
    this.closed = true;
    try { this.hostConn?.send({ h: 'bye' }); } catch { /* */ }
    this._stopBeat(); removeEventListener('pagehide', this._bye);
    setTimeout(() => { try { this.t?.close(); } catch { /* */ } }, 150);
    this.role = null; this.clearListeners();
  }
}

function frame(round, buf) {
  const src = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Uint8Array(src.length + 1);
  out[0] = round & 255; out.set(src, 1);
  return out;
}

// Per-game, per-round message channel handed to games as ctx.net. Messages from other rounds/games are dropped,
// so a late packet from the previous game can never reach the next one, and games can't see hub traffic.
export function makeChannel(net, round, getIsHost) {
  const msgFns = new Set(), rawFns = new Set();
  const offs = [
    net.on('game', (r, d, from) => { if (r === round) for (const f of msgFns) f(d, from); }),
    net.on('raw', (r, ab, from) => { if (r === (round & 255)) for (const f of rawFns) f(ab, from); }),
  ];
  return {
    get isHost() { return getIsHost(); },
    get myId() { return net.pid; },
    get hostId() { return net.hostPid; },
    now: () => net.now(),
    ping: (id) => net.peerPing(id ?? net.hostPid),
    toHost: (d) => net.toHost({ g: round, d }),                          // reliable, any client (host loops back to itself)
    toAll: (d, self = true) => net.broadcast({ g: round, d }, self),     // host only
    to: (id, d) => net.send(id, { g: round, d }),                        // host only (or to self)
    rawToHost: (buf) => net.rawToHost(round, buf),                       // unreliable binary
    rawToAll: (buf, self = false) => net.rawAll(round, buf, self),      // host only
    rawTo: (id, buf) => net.sendRaw(id, round, buf),
    onMessage: (fn) => { msgFns.add(fn); return () => msgFns.delete(fn); },
    onRaw: (fn) => { rawFns.add(fn); return () => rawFns.delete(fn); },
    dispose() { offs.forEach((f) => f()); msgFns.clear(); rawFns.clear(); },
  };
}
