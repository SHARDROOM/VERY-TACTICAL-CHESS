import { describe, expect, it, vi } from 'vitest';
import { parseSquare, type GameState } from '../engine';
import type { GameMaster, GmRequest } from '../gm/types';
import { fakeRuling } from '../gm/fakeGm';
import { GmError } from '../gm/errors';
import { memoryChannelPair, type Channel } from './channel';
import { HostSession } from './hostSession';
import { GuestSession } from './guestSession';
import { LocalSession } from './localSession';
import { parseGuestMessage } from './protocol';
import type { Session, SessionEvent } from './types';

const sq = (n: string) => parseSquare(n)!;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

/** A GM that answers like the fake GM, can be told to fail, and holds a "secret key". */
class TestGm implements GameMaster {
  readonly name = 'Test GM';
  readonly apiKey = 'sk-very-secret-key';
  calls: GmRequest[] = [];
  fail = false;
  async rule(req: GmRequest) {
    this.calls.push(req);
    if (this.fail) throw new GmError('API 키가 올바르지 않습니다.');
    return fakeRuling(req.action);
  }
}

function record(session: Session) {
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  return {
    events,
    notices: () => events.filter((e) => e.kind === 'notice').map((e) => (e as { text: string }).text),
  };
}

/** A spy channel that remembers everything sent through it. */
function spy(channel: Channel, log: unknown[]): Channel {
  return { ...channel, send: (m) => (log.push(m), channel.send(m)) };
}

function online(gm = new TestGm(), roll = () => 20) {
  const [hostEnd, guestEnd] = memoryChannelPair();
  const sentToGuest: unknown[] = [];
  const sentToHost: unknown[] = [];
  const host = new HostSession(gm, { code: 'ABC234', link: 'http://x/#room=ABC234', roll, heartbeatMs: 0 });
  const hostRec = record(host);
  host.attachGuest(spy(hostEnd, sentToGuest));
  const guest = new GuestSession(spy(guestEnd, sentToHost), { heartbeatMs: 0 });
  const guestRec = record(guest);
  return { gm, host, guest, hostRec, guestRec, sentToGuest, sentToHost, hostEnd, guestEnd };
}

describe('hotseat session', () => {
  it('acts for whoever is to move and rolls on its own', async () => {
    const s = new LocalSession(new TestGm(), () => 20);
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    s.request({ type: 'move', from: sq('e7'), to: sq('e5') });
    expect(s.view().state.turnNumber).toBe(3);
    s.request({ type: 'declare', action: 'b1 나이트를 c3로 보낸다' });
    expect(s.view().gmBusy).toBe(true);
    await settle();
    expect(s.view().state.pending?.action).toBe('b1 나이트를 c3로 보낸다');
    s.request({ type: 'attempt' });
    expect(s.view().state.board[sq('c3')]).toMatchObject({ type: 'knight' });
  });

  it('reports GM failures without spending AP', async () => {
    const gm = new TestGm();
    gm.fail = true;
    const s = new LocalSession(gm);
    const rec = record(s);
    s.request({ type: 'declare', action: 'b1 나이트를 c3로' });
    await settle();
    expect(rec.notices().join()).toContain('API 키가 올바르지 않습니다');
    expect(s.view().state.ap.white).toBe(1);
    expect(s.view().gmBusy).toBe(false);
  });

  it('does not call the GM for a declaration the engine would reject anyway', async () => {
    const gm = new TestGm();
    const s = new LocalSession(gm);
    s.request({ type: 'declare', action: 'x'.repeat(201) });
    s.request({ type: 'declare', action: '   ' });
    await settle();
    expect(gm.calls).toHaveLength(0);
  });
});

describe('online: host and guest', () => {
  it('welcomes the guest as black with the current state', async () => {
    const o = online();
    await settle();
    expect(o.guest.view()).toMatchObject({ seat: 'black', gmName: 'Test GM', isAuthority: false, connection: { kind: 'connected' } });
    expect(o.host.view().connection).toEqual({ kind: 'connected' });
    expect(o.guest.view().state).toEqual(o.host.view().state);
  });

  it("the guest's moves go through the host and both sides see the same state", async () => {
    const o = online();
    await settle();
    o.host.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    o.guest.request({ type: 'move', from: sq('e7'), to: sq('e5') });
    await settle();
    expect(o.host.view().state.board[sq('e5')]).toMatchObject({ type: 'pawn', color: 'black' });
    expect(o.guest.view().state).toEqual(o.host.view().state);
    expect(o.guestRec.events.some((e) => e.kind === 'events')).toBe(true);
  });

  it('a player cannot act on the other side\'s turn', async () => {
    const o = online();
    await settle();
    o.guest.request({ type: 'move', from: sq('e7'), to: sq('e5') });
    await settle();
    expect(o.host.view().state.turnNumber).toBe(1);
    expect(o.guestRec.notices()).toContain('상대의 차례입니다.');
    o.host.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    o.host.request({ type: 'move', from: sq('d2'), to: sq('d4') });
    await settle();
    expect(o.hostRec.notices()).toContain('상대의 차례입니다.');
  });

  it('the guest declares and attempts a special action; the host calls the GM and rolls', async () => {
    const rolls: number[] = [];
    const o = online(new TestGm(), () => (rolls.push(20), 20));
    await settle();
    o.host.request({ type: 'endTurn' });
    await settle();
    o.guest.request({ type: 'declare', action: 'b8 나이트를 c6로 날린다' });
    await settle();
    expect(o.gm.calls).toHaveLength(1);
    expect(o.guest.view().state.pending).toMatchObject({ color: 'black', action: 'b8 나이트를 c6로 날린다' });
    o.guest.request({ type: 'attempt' });
    await settle();
    expect(rolls).toEqual([20]);
    expect(o.guest.view().state.board[sq('c6')]).toMatchObject({ type: 'knight', color: 'black' });
  });

  it('GM errors for the guest are shown to the guest, not the host', async () => {
    const gm = new TestGm();
    gm.fail = true;
    const o = online(gm);
    await settle();
    o.host.request({ type: 'endTurn' });
    await settle();
    o.guest.request({ type: 'declare', action: 'b8 나이트를 c6로' });
    await settle();
    expect(o.guestRec.notices().join()).toContain('API 키가 올바르지 않습니다');
    expect(o.hostRec.notices().join()).not.toContain('API 키가 올바르지 않습니다');
  });

  it("never sends the host's API key to the guest", async () => {
    const o = online();
    await settle();
    o.host.request({ type: 'declare', action: 'b1 나이트를 c3로' });
    await settle();
    o.host.request({ type: 'attempt' });
    await settle();
    expect(JSON.stringify(o.sentToGuest)).not.toContain(o.gm.apiKey);
    expect(o.sentToGuest.length).toBeGreaterThan(3);
  });

  it('guests cannot send dice rolls or arbitrary commands', () => {
    expect(parseGuestMessage({ t: 'req', req: { type: 'attempt', roll: 20 } })).toEqual({ t: 'req', req: { type: 'attempt' } });
    expect(parseGuestMessage({ t: 'req', req: { type: 'attemptSpecial', roll: 20 } })).toBeNull();
    expect(parseGuestMessage({ t: 'req', req: { type: 'proposeSpecial', ruling: {} } })).toBeNull();
    expect(parseGuestMessage({ t: 'req', req: { type: 'move', from: 99, to: 1 } })).toBeNull();
    expect(parseGuestMessage({ t: 'req', req: { type: 'move', from: 1, to: 2, promotion: 'king' } })).toBeNull();
    expect(parseGuestMessage('junk')).toBeNull();
  });

  it('turns away a second guest and lets a guest who left come back', async () => {
    const o = online();
    await settle();
    const [hostEnd2, guestEnd2] = memoryChannelPair();
    o.host.attachGuest(hostEnd2);
    const second = new GuestSession(guestEnd2);
    await settle();
    expect(second.view().connection).toMatchObject({ kind: 'disconnected' });

    o.guestEnd.close();
    await settle();
    expect(o.host.view().connection).toMatchObject({ kind: 'waiting', guestLeft: true });
    expect(o.guest.view().connection).toMatchObject({ kind: 'disconnected' });

    const [hostEnd3, guestEnd3] = memoryChannelPair();
    o.host.attachGuest(hostEnd3);
    const back = new GuestSession(guestEnd3);
    await settle();
    expect(back.view()).toMatchObject({ seat: 'black', connection: { kind: 'connected' } });
  });

  it('a host restart reaches the guest', async () => {
    const o = online();
    await settle();
    o.host.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    o.host.restart();
    await settle();
    const fresh: GameState = o.host.view().state;
    expect(fresh.turnNumber).toBe(1);
    expect(o.guest.view().state).toEqual(fresh);
    expect(o.guestRec.notices()).toContain('방장이 새 게임을 시작했습니다.');
  });
});

describe('liveness', () => {
  it('the host notices a guest that went silent (closed tab, dead network)', async () => {
    vi.useFakeTimers();
    try {
      const [hostEnd, guestEnd] = memoryChannelPair();
      const host = new HostSession(new TestGm(), { code: 'ABC234', link: 'x', heartbeatMs: 1000, silenceTimeoutMs: 5000 });
      host.attachGuest(hostEnd);
      // A guest that connects, says hello, then goes silent forever (no pings, no goodbye).
      guestEnd.send({ t: 'hello', v: 1 });
      await vi.advanceTimersByTimeAsync(10);
      expect(host.view().connection).toEqual({ kind: 'connected' });
      await vi.advanceTimersByTimeAsync(4000);
      expect(host.view().connection).toEqual({ kind: 'connected' });
      await vi.advanceTimersByTimeAsync(3000);
      expect(host.view().connection).toMatchObject({ kind: 'waiting', guestLeft: true });
      host.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a live guest keeps the connection up', async () => {
    vi.useFakeTimers();
    try {
      const [hostEnd, guestEnd] = memoryChannelPair();
      const host = new HostSession(new TestGm(), { code: 'ABC234', link: 'x', heartbeatMs: 1000, silenceTimeoutMs: 5000 });
      host.attachGuest(hostEnd);
      const guest = new GuestSession(guestEnd, { heartbeatMs: 1000, silenceTimeoutMs: 5000 });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(host.view().connection).toEqual({ kind: 'connected' });
      expect(guest.view().connection).toEqual({ kind: 'connected' });
      guest.dispose();
      host.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
