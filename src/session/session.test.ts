import { describe, expect, it, vi } from 'vitest';
import { parseSquare } from '../engine';
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
  chaosCalls = 0;
  chaosReply: unknown = { title: '지진', narration: '땅이 흔들린다.', effects: [{ type: 'move', from: 'a7', to: 'a6' }] };
  fail = false;
  async rule(req: GmRequest) {
    this.calls.push(req);
    if (this.fail) throw new GmError('API 키가 올바르지 않습니다.');
    return fakeRuling(req.action, req.state.turn);
  }
  async chaos() {
    this.chaosCalls++;
    return this.chaosReply;
  }
}

/** A GM that takes its time. */
class SlowGm extends TestGm {
  constructor(private readonly ms: number) {
    super();
  }
  async rule(req: GmRequest) {
    await new Promise((r) => setTimeout(r, this.ms));
    return super.rule(req);
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

/** A host with one guest (black). Call `begin()` to leave the waiting room. */
function online(gm = new TestGm(), roll = () => 20) {
  const [hostEnd, guestEnd] = memoryChannelPair();
  const sentToGuest: unknown[] = [];
  const sentToHost: unknown[] = [];
  const host = new HostSession(gm, { code: 'ABC234', link: 'http://x/#room=ABC234', roll, heartbeatMs: 0 });
  const hostRec = record(host);
  host.attachGuest(spy(hostEnd, sentToGuest));
  const guest = new GuestSession(spy(guestEnd, sentToHost), { heartbeatMs: 0, id: 'guest-1', name: '친구' });
  const guestRec = record(guest);
  const begin = async () => {
    await settle();
    host.start();
    await settle();
  };
  return { gm, host, guest, hostRec, guestRec, sentToGuest, sentToHost, hostEnd, guestEnd, begin };
}

/** Adds another guest to the host's room. */
function join(host: HostSession, options: ConstructorParameters<typeof GuestSession>[1] = {}) {
  const [hostEnd, guestEnd] = memoryChannelPair();
  host.attachGuest(hostEnd);
  const guest = new GuestSession(guestEnd, { heartbeatMs: 0, ...options });
  return { guest, rec: record(guest), hostEnd, guestEnd };
}

const hotseat = (gm: GameMaster = new TestGm(), roll = () => 20) => {
  const s = new LocalSession(gm, { roll });
  s.start();
  return s;
};

describe('hotseat session', () => {
  it('acts for whoever is to move and rolls on its own', async () => {
    const s = hotseat();
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
    const s = hotseat(gm);
    const rec = record(s);
    s.request({ type: 'declare', action: 'b1 나이트를 c3로' });
    await settle();
    expect(rec.notices().join()).toContain('API 키가 올바르지 않습니다');
    expect(s.view().state.ap.white).toBe(1);
    expect(s.view().gmBusy).toBe(false);
  });

  it('does not call the GM for a declaration the engine would reject anyway', async () => {
    const gm = new TestGm();
    const s = hotseat(gm);
    s.request({ type: 'declare', action: 'x'.repeat(201) });
    s.request({ type: 'declare', action: '   ' });
    await settle();
    expect(gm.calls).toHaveLength(0);
  });
});

describe('waiting room', () => {
  it('a new room waits: the first guest takes black, nothing can be played yet', async () => {
    const o = online();
    await settle();
    expect(o.host.view()).toMatchObject({ phase: 'waiting', connection: { kind: 'hosting', code: 'ABC234' } });
    expect(o.guest.view()).toMatchObject({ phase: 'waiting', seat: 'black', connection: { kind: 'connected' } });
    expect(o.guest.view().members.map((m) => [m.name, m.role])).toEqual([['방장', 'white'], ['친구', 'black']]);
    o.host.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    expect(o.host.view().state.turnNumber).toBe(1);
    expect(o.hostRec.notices()).toContain('게임이 아직 시작되지 않았습니다.');
  });

  it('later guests watch; spectators see everything but cannot play', async () => {
    const o = online();
    const watcher = join(o.host, { name: '구경꾼' });
    await o.begin();
    expect(watcher.guest.view()).toMatchObject({ seat: 'spectator', phase: 'playing' });
    watcher.guest.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    expect(o.host.view().state.turnNumber).toBe(1);
    expect(watcher.rec.notices()).toContain('관전자는 수를 둘 수 없습니다.');
    o.host.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    expect(watcher.guest.view().state).toEqual(o.host.view().state);
  });

  it('the host sets the rules; everyone sees them; the game starts with them', async () => {
    const o = online();
    await settle();
    o.host.setRules({ apPerTurn: 2, turnSeconds: 60, chaosChance: 0.25, doodle: false, timeoutPenalty: 3 });
    // Values outside the offered choices are ignored.
    o.host.setRules({ turnSeconds: 7, apPerTurn: 99 });
    await settle();
    expect(o.guest.view().state.rules).toMatchObject({ apPerTurn: 2, turnSeconds: 60, chaosChance: 0.25, doodle: false, timeoutPenalty: 3 });
    o.host.start();
    await settle();
    expect(o.guest.view().phase).toBe('playing');
    expect(o.guest.view().state.ap.white).toBe(2);
    o.host.dispose();
  });

  it('cannot start without someone in the black seat', async () => {
    const host = new HostSession(new TestGm(), { code: 'ABC234', link: 'x', heartbeatMs: 0 });
    const rec = record(host);
    host.start();
    expect(host.view().phase).toBe('waiting');
    expect(rec.notices().join()).toContain('흑 자리');
  });

  it('the host can seat a spectator as black (the old black player watches)', async () => {
    const o = online();
    const watcher = join(o.host, { name: '구경꾼' });
    await settle();
    const key = watcher.guest.view().myKey;
    o.host.assignRole(key, 'black');
    await settle();
    expect(watcher.guest.view().seat).toBe('black');
    expect(o.guest.view().seat).toBe('spectator');
  });

  it('names show up for everyone and member reconnect ids are never shared', async () => {
    const o = online();
    const watcher = join(o.host, { name: '구경꾼', id: 'secret-browser-id' });
    await settle();
    o.guest.setName('새이름');
    await settle();
    expect(watcher.guest.view().members.map((m) => m.name)).toContain('새이름');
    expect(JSON.stringify(o.sentToGuest)).not.toContain('secret-browser-id');
  });

  it('after a game everyone goes back to the waiting room with a fresh board', async () => {
    const o = online();
    await o.begin();
    o.host.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    o.host.restart();
    await settle();
    expect(o.guest.view().phase).toBe('waiting');
    expect(o.guest.view().state.turnNumber).toBe(1);
    expect(o.guest.view().state).toEqual(o.host.view().state);
  });

  it('hotseat starts in the waiting room too', () => {
    const s = new LocalSession(new TestGm());
    expect(s.view().phase).toBe('waiting');
    s.setRules({ apPerTurn: 3 });
    s.start();
    expect(s.view()).toMatchObject({ phase: 'playing', state: { ap: { white: 3 } } });
  });
});

describe('online: host and guest', () => {
  it('welcomes the guest as black with the current state', async () => {
    const o = online();
    await o.begin();
    expect(o.guest.view()).toMatchObject({ seat: 'black', gmName: 'Test GM', isAuthority: false, connection: { kind: 'connected' } });
    expect(o.guest.view().state).toEqual(o.host.view().state);
  });

  it("the guest's moves go through the host and both sides see the same state", async () => {
    const o = online();
    await o.begin();
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
    await o.begin();
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
    await o.begin();
    o.host.request({ type: 'move', from: sq('e2'), to: sq('e4') });
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
    await o.begin();
    o.host.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    o.guest.request({ type: 'declare', action: 'b8 나이트를 c6로' });
    await settle();
    expect(o.guestRec.notices().join()).toContain('API 키가 올바르지 않습니다');
    expect(o.hostRec.notices().join()).not.toContain('API 키가 올바르지 않습니다');
  });

  it("never sends the host's API key to the guest", async () => {
    const o = online();
    await o.begin();
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
    expect(parseGuestMessage({ t: 'req', req: { type: 'timeout' } })).toBeNull();
    expect(parseGuestMessage({ t: 'req', req: { type: 'chaos' } })).toBeNull();
    expect(parseGuestMessage({ t: 'req', req: { type: 'move', from: 99, to: 1 } })).toBeNull();
    expect(parseGuestMessage({ t: 'req', req: { type: 'move', from: 1, to: 2, promotion: 'king' } })).toBeNull();
    expect(parseGuestMessage('junk')).toBeNull();
  });

  it('a player who drops mid-game keeps the seat and can come back', async () => {
    const o = online();
    await o.begin();
    o.guestEnd.close();
    await settle();
    const black = o.host.view().members.find((m) => m.role === 'black');
    expect(black).toMatchObject({ name: '친구', online: false });
    const back = join(o.host, { id: 'guest-1' });
    await settle();
    expect(back.guest.view()).toMatchObject({ seat: 'black', connection: { kind: 'connected' }, phase: 'playing' });
    // A stranger now only watches.
    const stranger = join(o.host, { id: 'someone-else' });
    await settle();
    expect(stranger.guest.view().seat).toBe('spectator');
  });

  it('turns people away once the room is full', async () => {
    const o = online();
    const guests = Array.from({ length: 8 }, (_, i) => join(o.host, { name: `관전${i}` }));
    await settle();
    expect(o.host.view().members).toHaveLength(10);
    const late = join(o.host);
    await settle();
    expect(late.guest.view().connection).toMatchObject({ kind: 'disconnected' });
    expect(guests[7].guest.view().connection.kind).toBe('connected');
  });
});

describe('turn clock', () => {
  it('running out of time costs AP and passes the turn; GM thinking time does not count', async () => {
    vi.useFakeTimers();
    try {
      const gm = new SlowGm(5000);
      const s = new LocalSession(gm, { roll: () => 20 });
      s.setRules({ turnSeconds: 30, timeoutPenalty: 1 });
      s.start();
      expect(s.view().timer).toMatchObject({ limitMs: 30_000, running: true });
      await vi.advanceTimersByTimeAsync(20_000);
      // The GM takes 5 s: the clock stops meanwhile.
      s.request({ type: 'declare', action: 'b1 나이트를 c3로' });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(s.view().state.pending).not.toBeNull();
      expect(s.view().state.turn).toBe('white');
      await vi.advanceTimersByTimeAsync(9_000);
      expect(s.view().state.turn).toBe('white');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(s.view().state).toMatchObject({ turn: 'black', pending: null, ap: { white: 0 } });
      // A fresh clock for black.
      expect(s.view().timer).toMatchObject({ remainingMs: 30_000, running: true });
      s.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('no clock when the rule is off', () => {
    const s = hotseat();
    expect(s.view().timer).toBeNull();
  });
});

describe('chaos', () => {
  it('may strike when a turn begins, and everyone sees it', async () => {
    const gm = new TestGm();
    const o = online(gm, () => 20);
    await settle();
    o.host.setRules({ chaosChance: 0.5 });
    // Chaos dice: always below the chance.
    (o.host as unknown as { authority: { chance: () => number } }).authority.chance = () => 0;
    await o.begin();
    o.host.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    expect(gm.chaosCalls).toBe(1);
    expect(o.guest.view().state.board[sq('a6')]).toMatchObject({ type: 'pawn', color: 'black' });
    expect(o.guest.view().state.chaosLog?.[0].title).toBe('지진');
  });

  it('only a real (API) GM makes chaos: with the fake GM nothing happens, and the host is told', async () => {
    const { FakeGameMaster } = await import('../gm/fakeGm');
    const s = new LocalSession(new FakeGameMaster(0), { roll: () => 20, chance: () => 0 });
    s.setRules({ chaosChance: 0.5 });
    expect(s.view().chaosReady).toBe(false);
    s.start();
    const before = s.view().state.board;
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    expect(s.view().state.chaosLog ?? []).toEqual([]);
    expect(s.view().state.board.filter(Boolean)).toHaveLength(before.filter(Boolean).length);
    // With an API GM it is ready.
    s.setGm(new TestGm());
    expect(s.view().chaosReady).toBe(true);
  });

  it('a chaos idea that breaks the rules goes back to the GM once, with the reason', async () => {
    const gm = new TestGm();
    const asked: unknown[] = [];
    let n = 0;
    gm.chaos = async (req?: unknown) => {
      asked.push(req);
      n++;
      return n === 1
        ? { title: '반칙', narration: '킹을 없앤다', effects: [{ type: 'remove', at: 'e8' }] }
        : { title: '지진', narration: '땅이 흔들린다.', effects: [{ type: 'move', from: 'a7', to: 'a6' }] };
    };
    const s = new LocalSession(gm, { roll: () => 20, chance: () => 0 });
    s.setRules({ chaosChance: 0.1 });
    s.start();
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    expect(asked).toHaveLength(2);
    expect((asked[1] as { problem?: string }).problem).toContain('킹');
    expect(s.view().state.chaosLog?.[0].title).toBe('지진');
  });

  it('a chaos event that breaks the rules is skipped with a notice', async () => {
    const gm = new TestGm();
    gm.chaosReply = { title: '반칙', narration: '킹을 없앤다', effects: [{ type: 'remove', at: 'e8' }] };
    const s = new LocalSession(gm, { roll: () => 20, chance: () => 0 });
    s.setRules({ chaosChance: 0.1 });
    s.start();
    const rec = record(s);
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    expect(s.view().state.board[sq('e8')]).toMatchObject({ type: 'king' });
    expect(rec.notices().join()).toContain('혼돈이 일어나려다');
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
      guestEnd.send({ t: 'hello', v: 2 });
      const blackOnline = () => host.view().members.some((m) => m.role === 'black' && m.online);
      await vi.advanceTimersByTimeAsync(10);
      expect(blackOnline()).toBe(true);
      await vi.advanceTimersByTimeAsync(4000);
      expect(blackOnline()).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(blackOnline()).toBe(false);
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
      expect(host.view().members.some((m) => m.role === 'black' && m.online)).toBe(true);
      expect(guest.view().connection).toEqual({ kind: 'connected' });
      guest.dispose();
      host.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('chat', () => {
  const chats = (events: SessionEvent[]) =>
    events
      .filter((e) => e.kind === 'chat')
      .map((e) => e as Extract<SessionEvent, { kind: 'chat' }>)
      .map((e) => `${e.message.name}${e.mine ? '*' : ''}:${e.message.text}`);

  it('carries messages between everyone, in the waiting room too, without touching the game', async () => {
    const o = online();
    const watcher = join(o.host, { name: '구경꾼' });
    await settle();
    const before = o.host.view().state;
    o.host.sendChat('  잘 부탁해!  ');
    await settle();
    o.guest.sendChat('나도\n잘 부탁해');
    await settle();
    expect(chats(o.hostRec.events)).toEqual(['방장*:잘 부탁해!', '친구:나도 잘 부탁해']);
    expect(chats(o.guestRec.events)).toEqual(['방장:잘 부탁해!', '친구*:나도 잘 부탁해']);
    expect(chats(watcher.rec.events)).toEqual(['방장:잘 부탁해!', '친구:나도 잘 부탁해']);
    expect(o.guest.view().chat.map((m) => m.text)).toEqual(['잘 부탁해!', '나도 잘 부탁해']);
    expect(o.host.view().state).toBe(before);
  });

  it('drops empty messages and cuts long ones', async () => {
    const o = online();
    await settle();
    o.guest.sendChat('   ');
    o.guest.sendChat('가'.repeat(500));
    await settle();
    const got = chats(o.hostRec.events);
    expect(got).toHaveLength(1);
    expect(got[0]).toBe(`친구:${'가'.repeat(300)}`);
  });

  it('rejects junk', () => {
    expect(parseGuestMessage({ t: 'chat', text: 42 })).toBeNull();
    expect(parseGuestMessage({ t: 'chat', text: '   ' })).toBeNull();
    expect(parseGuestMessage({ t: 'chat', text: 'hi' })).toEqual({ t: 'chat', text: 'hi' });
  });

  it('in hotseat a message is labelled with the side to move', () => {
    const s = hotseat();
    const rec = record(s);
    s.sendChat('메모');
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    s.sendChat('흑 차례');
    expect(chats(rec.events)).toEqual(['백*:메모', '흑*:흑 차례']);
  });
});

describe('doodles', () => {
  const line = { kind: 'line' as const, color: '#ff5a4f', width: 0.08, points: [0, 0, 1.234, 2.345] };

  it('everyone sees what anyone draws; you can rub out your own, the host anyone\'s', async () => {
    const o = online();
    const watcher = join(o.host);
    await o.begin();
    watcher.guest.doodle({ op: 'add', doodle: line });
    await settle();
    expect(o.guest.view().doodles).toHaveLength(1);
    expect(o.guest.view().doodles[0]).toMatchObject({ kind: 'line', points: [0, 0, 1.23, 2.35], author: watcher.guest.view().myKey });
    const id = o.guest.view().doodles[0].id;
    o.guest.doodle({ op: 'remove', id });
    await settle();
    expect(o.host.view().doodles).toHaveLength(1);
    o.host.doodle({ op: 'remove', id });
    await settle();
    expect(watcher.guest.view().doodles).toHaveLength(0);
  });

  it('nothing can be drawn when the room turned doodles off, and junk is refused', async () => {
    const o = online();
    await settle();
    o.host.setRules({ doodle: false });
    await o.begin();
    o.guest.doodle({ op: 'add', doodle: line });
    await settle();
    expect(o.host.view().doodles).toHaveLength(0);
    expect(parseGuestMessage({ t: 'doodle', op: { op: 'add', doodle: { ...line, points: [0, 0, 99, 0] } } })).toBeNull();
    expect(parseGuestMessage({ t: 'doodle', op: { op: 'add', doodle: { ...line, color: 'url(evil)' } } })).toBeNull();
  });
});
