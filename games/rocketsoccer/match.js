// Host-only match rules: goals (with scorer / assist / own goal), shots and saves, the clock (a goal can still
// happen after 0:00 while the ball is in the air), sudden-death overtime and the end of the match.
import { C, PH, DT, predictBall, kickoff, len3 } from './physics.js';

export const GOAL_T = 1.8, REPLAY_T = 4.6, END_T = 3.4, OT_CAP = 150;
export const PTS = { goal: 100, assist: 50, save: 50, shot: 20, touch: 2, demo: 25, epic: 25 };

export function newStats(n) { return Array.from({ length: n }, () => ({ g: 0, a: 0, s: 0, sh: 0, d: 0, t: 0, pts: 0 })); }

export class Referee {
  constructor(W, rng) {
    this.W = W; this.rng = rng; this.stats = newStats(W.cars.length);
    this.touches = []; this.pending = []; this.threat = -1; this.predAt = 0; this.pred = [];
    this.goals = 0; this.endAt = -1; this.ended = false; this.zeroNote = false; this.after = null;
  }
  // Which goal the ball is heading into within ~2 s: 0 = blue's goal (-z), 1 = orange's goal (+z), -1 none
  threatNow() {
    const W = this.W, A = W.A;
    predictBall(W, this.pred, 120, 2);
    for (const p of this.pred) if (Math.abs(p.z) > A.L + C.BALL_R * 0.5 && Math.abs(p.x) < A.GW && p.y < A.GH) return p.z < 0 ? 0 : 1;
    return -1;
  }
  // events: the live W.ev from this step. Returns host events for index.js to broadcast.
  step(events) {
    const W = this.W, A = W.A, out = [];
    const st = this.stats;
    for (const e of events) {
      if (e.k === 'hit') {
        const last = this.touches[this.touches.length - 1];
        if (!last || last.i !== e.i || W.tick - last.tick > 20) { st[e.i].t++; st[e.i].pts += PTS.touch; }
        this.touches.push({ i: e.i, tick: W.tick, team: W.cars[e.i].team });
        if (this.touches.length > 40) this.touches.shift();
        this.pending.push({ i: e.i, tick: W.tick, threat: this.threat });
        this.predAt = 0;   // re-predict right away
      } else if (e.k === 'demo') { st[e.by].d++; st[e.by].pts += PTS.demo; out.push({ k: 'demo', i: e.i, by: e.by }); }
    }
    if (W.phase === PH.PLAY) {
      if (--this.predAt <= 0) {
        this.predAt = 6;
        const th = this.threatNow();
        for (const p of this.pending) {
          const team = W.cars[p.i].team;
          if (th === 1 - team && p.threat !== 1 - team) { st[p.i].sh++; st[p.i].pts += PTS.shot; out.push({ k: 'shot', i: p.i }); }
          if (p.threat === team && th !== team) { st[p.i].s++; st[p.i].pts += PTS.save; out.push({ k: 'save', i: p.i, epic: len3(W.ball.vx, W.ball.vy, W.ball.vz) > 40 }); }
        }
        this.pending.length = 0; this.threat = th;
      }
      // goal?
      const b = W.ball;
      if (Math.abs(b.z) > A.L + C.BALL_R * 0.9 && Math.abs(b.x) < A.GW && b.y < A.GH) {
        const team = b.z > 0 ? 0 : 1;   // ball in +z goal: blue scores
        if (team === 0) W.sA++; else W.sB++;
        // scorer = the scoring team's last touch since the kickoff (deflections still count). It's an own goal only
        // when the defending team touched it last and the scoring team hasn't touched it for 6 s.
        let scorer = -1, own = false, assist = -1, sTick = 0;
        const T = this.touches, lastT = T[T.length - 1];
        for (let k = T.length - 1; k >= 0; k--) if (T[k].team === team) { scorer = T[k].i; sTick = T[k].tick; break; }
        if (scorer >= 0 && lastT.team !== team && W.tick - sTick > 60 * 6) scorer = -1;
        if (scorer >= 0) {
          st[scorer].g++; st[scorer].pts += PTS.goal;
          for (let k = T.length - 1; k >= 0; k--) if (T[k].tick < sTick && T[k].team === team && T[k].i !== scorer && sTick - T[k].tick < 60 * 6) { assist = T[k].i; break; }
          if (assist >= 0) { st[assist].a++; st[assist].pts += PTS.assist; }
        } else if (lastT) { own = true; scorer = lastT.i; }
        const speed = len3(b.vx, b.vy, b.vz);
        const aerial = scorer >= 0 && !own && b.y > 6;
        out.push({ k: 'goal', team, scorer, assist, own, speed, x: b.x, y: b.y, z: b.z, aerial, tick: W.tick, ot: W.ot, sA: W.sA, sB: W.sB });
        W.phase = PH.GOAL; W.pt = GOAL_T; this.goals++; this.goalTick = W.tick; this.touches.length = 0;
        return out;
      }
      // clock
      if (!W.ot && W.clock <= 0) {
        const airborne = W.ball.y > C.BALL_R + 0.4;
        if (airborne) { if (!this.zeroNote) { this.zeroNote = true; out.push({ k: 'zero' }); } }
        else this.timeUp(out);
      } else if (W.ot && W.clock >= OT_CAP) this.finish(out);
    } else if (W.phase === PH.GOAL) {
      W.pt -= DT;
      if (W.pt <= 0) { W.phase = PH.REPLAY; W.pt = REPLAY_T; out.push({ k: 'replay', tick: this.goalTick }); }
    } else if (W.phase === PH.REPLAY) {
      W.pt -= DT;
      if (W.pt <= 0 || this.skip) this.afterReplay(out);
    } else if (W.phase === PH.END) {
      W.pt -= DT;
      if (W.pt <= 0 && !this.ended) { this.ended = true; out.push({ k: 'final' }); }
    }
    return out;
  }
  afterReplay(out) {
    const W = this.W; this.skip = false;
    if (W.ot) return this.finish(out);                               // golden goal
    if (W.clock <= 0) return this.timeUp(out);                       // scored at the buzzer
    kickoff(W, this.rng); out.push({ k: 'kick' });
    this.comeback(out);
  }
  timeUp(out) {
    const W = this.W;
    if (W.sA !== W.sB) return this.finish(out);
    W.ot = 1; W.clock = 0; kickoff(W, this.rng); out.push({ k: 'overtime' });
  }
  // Comeback: the team two or more goals behind starts the kickoff with a full tank.
  comeback(out) {
    const W = this.W, diff = W.sA - W.sB;
    if (Math.abs(diff) < 2) return;
    const team = diff > 0 ? 1 : 0;
    for (const c of W.cars) if (c.team === team) c.boost = 100;
    out.push({ k: 'comeback', team });
  }
  finish(out) {
    const W = this.W;
    if (W.phase === PH.END) return;
    W.phase = PH.END; W.pt = END_T;
    out.push({ k: 'end', winner: W.sA > W.sB ? 0 : W.sB > W.sA ? 1 : -1 });
  }
}
