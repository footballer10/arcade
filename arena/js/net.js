// Compact binary encoding for snapshots (host -> client) and inputs (client -> host).
// A 6-player snapshot is ~350 bytes instead of ~4 KB of JSON.
import { PHASES, POWERUPS } from './sim.js';

const TAU = Math.PI * 2;
const q16 = (v, s) => Math.max(-32768, Math.min(32767, Math.round(v * s)));
const u8 = (v, s) => Math.max(0, Math.min(255, Math.round(v * s)));
const angEnc = (a) => Math.round((((a % TAU) + TAU) % TAU) / TAU * 65535);
const angDec = (v) => (v / 65535) * TAU;

const P_BYTES = 44, PR_BYTES = 14, PU_BYTES = 7, W_BYTES = 8, HDR = 30;

// roster: Map id -> n ; we encode player ids as their small roster number `n`.
export function encodeSnapshot(s) {
  const size = HDR + s.players.length * P_BYTES + s.proj.length * PR_BYTES + s.pu.length * PU_BYTES + s.wells.length * W_BYTES;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  let o = 0;
  const idToN = new Map(s.players.map((p) => [p.id, p.n]));
  v.setUint8(o, 2); o += 1; // version
  v.setUint8(o, PHASES.indexOf(s.phase)); o += 1;
  v.setUint8(o, s.round); o += 1;
  v.setUint32(o, s.tick, true); o += 4;
  v.setFloat32(o, s.phaseT, true); o += 4;
  v.setFloat32(o, s.t, true); o += 4;
  v.setUint16(o, Math.round(s.zoneR * 100), true); o += 2;
  v.setUint8(o, s.roundWinner != null ? idToN.get(s.roundWinner) ?? 255 : 255); o += 1;
  v.setUint8(o, s.matchWinner != null ? idToN.get(s.matchWinner) ?? 255 : 255); o += 1;
  v.setUint8(o, s.players.length); o += 1;
  v.setUint8(o, s.proj.length); o += 1;
  v.setUint8(o, s.pu.length); o += 1;
  v.setUint8(o, s.wells.length); o += 1;
  o = HDR;
  for (const p of s.players) {
    v.setUint8(o, p.n);
    v.setUint8(o + 1, (p.alive ? 1 : 0) | (p.falling ? 2 : 0));
    v.setInt16(o + 2, q16(p.x, 100), true); v.setInt16(o + 4, q16(p.z, 100), true); v.setInt16(o + 6, q16(p.y, 100), true);
    v.setUint16(o + 8, angEnc(p.aim), true);
    v.setUint8(o + 10, u8(p.hp, 1)); v.setUint8(o + 11, u8(p.maxHp, 1)); v.setUint8(o + 12, u8(p.shield, 1));
    v.setInt16(o + 13, q16(p.mvx, 100), true); v.setInt16(o + 15, q16(p.mvz, 100), true);
    v.setInt16(o + 17, q16(p.kbx, 100), true); v.setInt16(o + 19, q16(p.kbz, 100), true);
    v.setInt16(o + 21, q16(p.dvx, 100), true); v.setInt16(o + 23, q16(p.dvz, 100), true);
    v.setUint8(o + 25, u8(p.dashCd, 50)); v.setUint8(o + 26, u8(p.spCd, 20));
    v.setUint8(o + 27, u8(p.slamT, 200)); v.setUint8(o + 28, u8(p.blastT, 200));
    v.setUint8(o + 29, u8(p.invT, 200)); v.setUint8(o + 30, u8(p.hitT, 200)); v.setUint8(o + 31, u8(p.swingT, 200));
    v.setUint8(o + 32, u8(p.speedT, 10)); v.setUint8(o + 33, u8(p.dmgT, 10));
    v.setUint8(o + 34, p.wins); v.setUint8(o + 35, Math.min(255, p.kills));
    v.setUint32(o + 36, p.ack >>> 0, true);
    v.setUint8(o + 40, p.placement);
    o += P_BYTES;
  }
  for (const b of s.proj) {
    v.setUint16(o, b.id & 0xffff, true); v.setUint8(o + 2, b.kind); v.setUint8(o + 3, b.color);
    v.setInt16(o + 4, q16(b.x, 100), true); v.setInt16(o + 6, q16(b.z, 100), true);
    if (b.kind === 1) {
      v.setInt16(o + 8, q16(b.tx, 100), true); v.setInt16(o + 10, q16(b.tz, 100), true);
      v.setUint8(o + 12, u8(b.f, 255)); v.setUint8(o + 13, u8(b.T, 100));
    } else { v.setInt16(o + 8, q16(b.vx, 100), true); v.setInt16(o + 10, q16(b.vz, 100), true); }
    o += PR_BYTES;
  }
  for (const u of s.pu) {
    v.setUint16(o, u.id & 0xffff, true); v.setUint8(o + 2, POWERUPS.indexOf(u.type));
    v.setInt16(o + 3, q16(u.x, 100), true); v.setInt16(o + 5, q16(u.z, 100), true);
    o += PU_BYTES;
  }
  for (const w of s.wells) {
    v.setInt16(o, q16(w.x, 100), true); v.setInt16(o + 2, q16(w.z, 100), true);
    v.setUint8(o + 4, u8(w.t, 100)); v.setUint8(o + 5, u8(w.r, 10)); v.setUint8(o + 6, w.color);
    o += W_BYTES;
  }
  return buf;
}

// rosterByN: Map n -> {id,name,char,color,isBot}
export function decodeSnapshot(buf, rosterByN) {
  const v = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  if (v.getUint8(0) !== 2) return null;
  const idOf = (n) => (n === 255 ? null : rosterByN.get(n)?.id ?? null);
  const s = {
    phase: PHASES[v.getUint8(1)], round: v.getUint8(2), tick: v.getUint32(3, true),
    phaseT: v.getFloat32(7, true), t: v.getFloat32(11, true), zoneR: v.getUint16(15, true) / 100,
    roundWinner: idOf(v.getUint8(17)), matchWinner: idOf(v.getUint8(18)),
    players: [], proj: [], pu: [], wells: [],
  };
  const np = v.getUint8(19), nb = v.getUint8(20), nu = v.getUint8(21), nw = v.getUint8(22);
  let o = HDR;
  for (let i = 0; i < np; i++) {
    const n = v.getUint8(o), info = rosterByN.get(n);
    const f = v.getUint8(o + 1);
    if (info) s.players.push({
      id: info.id, n, name: info.name, char: info.char, color: info.color, isBot: info.isBot,
      alive: !!(f & 1), falling: !!(f & 2),
      x: v.getInt16(o + 2, true) / 100, z: v.getInt16(o + 4, true) / 100, y: v.getInt16(o + 6, true) / 100,
      aim: angDec(v.getUint16(o + 8, true)),
      hp: v.getUint8(o + 10), maxHp: v.getUint8(o + 11), shield: v.getUint8(o + 12),
      mvx: v.getInt16(o + 13, true) / 100, mvz: v.getInt16(o + 15, true) / 100,
      kbx: v.getInt16(o + 17, true) / 100, kbz: v.getInt16(o + 19, true) / 100,
      dvx: v.getInt16(o + 21, true) / 100, dvz: v.getInt16(o + 23, true) / 100,
      dashCd: v.getUint8(o + 25) / 50, spCd: v.getUint8(o + 26) / 20,
      slamT: v.getUint8(o + 27) / 200, blastT: v.getUint8(o + 28) / 200,
      invT: v.getUint8(o + 29) / 200, hitT: v.getUint8(o + 30) / 200, swingT: v.getUint8(o + 31) / 200,
      speedT: v.getUint8(o + 32) / 10, dmgT: v.getUint8(o + 33) / 10,
      wins: v.getUint8(o + 34), kills: v.getUint8(o + 35), ack: v.getUint32(o + 36, true), placement: v.getUint8(o + 40),
    });
    o += P_BYTES;
  }
  for (let i = 0; i < nb; i++) {
    const kind = v.getUint8(o + 2);
    const b = { id: v.getUint16(o, true), kind, color: v.getUint8(o + 3), x: v.getInt16(o + 4, true) / 100, z: v.getInt16(o + 6, true) / 100 };
    if (kind === 1) { b.tx = v.getInt16(o + 8, true) / 100; b.tz = v.getInt16(o + 10, true) / 100; b.f = v.getUint8(o + 12) / 255; b.T = v.getUint8(o + 13) / 100; }
    else { b.vx = v.getInt16(o + 8, true) / 100; b.vz = v.getInt16(o + 10, true) / 100; }
    s.proj.push(b);
    o += PR_BYTES;
  }
  for (let i = 0; i < nu; i++) {
    s.pu.push({ id: v.getUint16(o, true), type: POWERUPS[v.getUint8(o + 2)], x: v.getInt16(o + 3, true) / 100, z: v.getInt16(o + 5, true) / 100 });
    o += PU_BYTES;
  }
  for (let i = 0; i < nw; i++) {
    s.wells.push({ x: v.getInt16(o, true) / 100, z: v.getInt16(o + 2, true) / 100, t: v.getUint8(o + 4) / 100, r: v.getUint8(o + 5) / 10, color: v.getUint8(o + 6) });
    o += W_BYTES;
  }
  return s;
}

// Input packet: 24 bytes.
export function encodeInput(i) {
  const buf = new ArrayBuffer(24), v = new DataView(buf);
  v.setUint8(0, 7);
  v.setUint32(1, i.seq >>> 0, true);
  v.setUint32(5, (i.vt || 0) >>> 0, true);
  v.setInt8(9, Math.round(Math.max(-1, Math.min(1, i.mx)) * 100));
  v.setInt8(10, Math.round(Math.max(-1, Math.min(1, i.mz)) * 100));
  v.setUint16(11, angEnc(i.aim), true);
  v.setInt16(13, q16(i.tx ?? 0, 100), true);
  v.setInt16(15, q16(i.tz ?? 0, 100), true);
  v.setUint8(17, (i.atk ? 1 : 0) | (i.tx === undefined ? 2 : 0));
  v.setUint16(18, i.dashSeq & 0xffff, true);
  v.setUint16(20, i.spSeq & 0xffff, true);
  return buf;
}
export function decodeInput(buf) {
  const v = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  if (v.byteLength < 22 || v.getUint8(0) !== 7) return null;
  const fl = v.getUint8(17);
  return {
    seq: v.getUint32(1, true), vt: v.getUint32(5, true),
    mx: v.getInt8(9) / 100, mz: v.getInt8(10) / 100, aim: angDec(v.getUint16(11, true)),
    tx: fl & 2 ? undefined : v.getInt16(13, true) / 100, tz: fl & 2 ? undefined : v.getInt16(15, true) / 100,
    atk: !!(fl & 1), dashSeq: v.getUint16(18, true), spSeq: v.getUint16(20, true),
  };
}

// Fallback transport over the JSON channel.
export function toB64(buf) {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
export function fromB64(str) {
  const s = atob(str), b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b.buffer;
}
