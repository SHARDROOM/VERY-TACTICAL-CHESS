import { describe, expect, it } from 'vitest';
import { createInitialState, createStateFrom, parseSquare, type GameState } from '../engine';
import type { GameMaster, GmRequest } from '../gm/types';
import { fakeRuling } from '../gm/fakeGm';
import { memoryChannelPair } from './channel';
import { HostSession } from './hostSession';
import { GuestSession } from './guestSession';
import { LocalSession } from './localSession';
import type { Session, SessionEvent } from './types';

/* Resigning and draws as the players ask for them (판 끝내기, docs/SPEC.md). */

const sq = (n: string) => parseSquare(n)!;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
};

class TestGm implements GameMaster {
  readonly name = 'Test GM';
  async rule(req: GmRequest) {
    return fakeRuling(req.action, req.state.turn);
  }
}

const notices = (s: Session) => {
  const list: string[] = [];
  s.subscribe((e: SessionEvent) => e.kind === 'notice' && list.push(e.text));
  return list;
};

function online() {
  const [hostEnd, guestEnd] = memoryChannelPair();
  const host = new HostSession(new TestGm(), { code: 'ABC234', link: 'http://x/#room=ABC234', roll: () => 6, heartbeatMs: 0 });
  host.attachGuest(hostEnd);
  const guest = new GuestSession(guestEnd, { heartbeatMs: 0, id: 'guest-1', name: '친구' });
  host.takeSeat('white');
  const begin = async () => {
    await settle();
    guest.takeSeat('black');
    await settle();
    host.start();
    await settle();
  };
  return { host, guest, begin };
}

/** Kings and a few pieces: white is a queen up (black behind), or black is (white behind). */
const lopsided = (ahead: 'white' | 'black'): GameState =>
  createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, [ahead === 'white' ? 'd1' : 'd8']: { color: ahead, type: 'queen' } });

describe('on one screen', () => {
  it('the side to move resigns, and the other wins', () => {
    const s = new LocalSession(new TestGm(), { roll: () => 6 });
    s.start();
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    s.request({ type: 'resign' });
    expect(s.view().state.status).toEqual({ kind: 'won', winner: 'white', by: 'resign' });
  });

  it('two people at one screen agree on a draw at once', () => {
    const s = new LocalSession(new TestGm(), { roll: () => 6 });
    s.start();
    s.request({ type: 'offerDraw' });
    expect(s.view().state.status).toEqual({ kind: 'draw', reason: 'agreed' });
  });

  it('an AI takes a draw only when it is behind', async () => {
    const behind = new LocalSession(new TestGm(), { roll: () => 6, initialState: lopsided('white'), phase: 'playing', aiPace: 0 });
    behind.setAi('black', { level: 'normal', specials: 'off' });
    behind.request({ type: 'offerDraw' });
    expect(behind.view().state.status).toEqual({ kind: 'draw', reason: 'agreed' });
    behind.dispose();

    const ahead = new LocalSession(new TestGm(), { roll: () => 6, initialState: lopsided('black'), phase: 'playing', aiPace: 0 });
    ahead.setAi('black', { level: 'normal', specials: 'off' });
    const said = notices(ahead);
    ahead.request({ type: 'offerDraw' });
    expect(ahead.view().state.status.kind).toBe('playing');
    expect(said.some((t) => t.includes('거절'))).toBe(true);
    ahead.dispose();
  });

  it("against an AI, resigning on the AI's turn gives up the person's side", () => {
    const s = new LocalSession(new TestGm(), { roll: () => 6, initialState: { ...lopsided('white'), turn: 'black' }, phase: 'playing', aiPace: 1000 });
    s.setAi('black', { level: 'normal', specials: 'off' });
    s.request({ type: 'resign' });
    expect(s.view().state.status).toEqual({ kind: 'won', winner: 'black', by: 'resign' });
    s.dispose();
  });
});

describe('a draw offer and a resignation', () => {
  it('a side that resigns while an offer waits on it does not leave the offer stuck (3인 판)', async () => {
    // One screen, the hexagon: white is a person, black and red AIs far behind (only kings and a pawn each).
    const s = new LocalSession(new TestGm(), { roll: () => 6, initialState: createInitialState(undefined, 'hex3'), phase: 'playing', aiPace: 1000 });
    s.setAi('black', { level: 'normal', specials: 'off' });
    s.setAi('red', { level: 'normal', specials: 'off' });
    // An offer stands (made online in a real room; here set as the authority would hold it).
    const authority = (s as unknown as { authority: { drawOffer: unknown; handle: (r: unknown, a: string) => Promise<void> } }).authority;
    authority.drawOffer = { from: 'white', waiting: ['black', 'red'] };
    await authority.handle({ type: 'resign' }, 'red');
    expect(s.view().drawOffer).toBeNull();
    s.dispose();
  });

  it('the last yes that cannot end the game yet (an exile being picked) leaves the offer standing', async () => {
    // Found next to a cross-check note: the offer was dropped before the draw was tried, so a draw
    // that could not go through yet (the game waiting on a surrender) took the offer with it.
    const waitingOnExile: GameState = { ...createInitialState(undefined, 'hex3'), surrender: { loser: 'red', to: 'white' } };
    const s = new LocalSession(new TestGm(), { roll: () => 6, initialState: waitingOnExile, phase: 'playing', aiPace: 1000 });
    const authority = (s as unknown as { authority: { drawOffer: unknown; handle: (r: unknown, a: string) => Promise<void> } }).authority;
    authority.drawOffer = { from: 'white', waiting: ['black'] };
    await authority.handle({ type: 'answerDraw', accept: true }, 'black');
    expect(s.view().state.status.kind).toBe('playing');
    expect(s.view().drawOffer).toEqual({ from: 'white', waiting: ['black'] });
    s.dispose();
  });
});

describe('online', () => {
  it('a draw offered is shown to everyone and ends the game once the other accepts', async () => {
    const { host, guest, begin } = online();
    await begin();
    guest.request({ type: 'offerDraw' });
    await settle();
    expect(host.view().drawOffer).toEqual({ from: 'black', waiting: ['white'] });
    expect(guest.view().drawOffer).toEqual({ from: 'black', waiting: ['white'] });
    host.request({ type: 'answerDraw', accept: true });
    await settle();
    expect(guest.view().state.status).toEqual({ kind: 'draw', reason: 'agreed' });
    expect(guest.view().drawOffer).toBeNull();
  });

  it('a declined offer goes away, and so does one left standing when a move is made', async () => {
    const { host, guest, begin } = online();
    await begin();
    const told = notices(guest);
    guest.request({ type: 'offerDraw' });
    await settle();
    host.request({ type: 'answerDraw', accept: false });
    await settle();
    expect(guest.view().drawOffer).toBeNull();
    expect(told.some((t) => t.includes('거절'))).toBe(true);
    guest.request({ type: 'offerDraw' });
    await settle();
    host.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle();
    expect(host.view().drawOffer).toBeNull();
    expect(host.view().state.status.kind).toBe('playing');
  });

  it('a guest resigns whoever is to move; only the one asked may answer an offer', async () => {
    const { host, guest, begin } = online();
    await begin();
    host.request({ type: 'offerDraw' });
    await settle();
    host.request({ type: 'answerDraw', accept: true });
    await settle();
    expect(host.view().state.status.kind).toBe('playing');
    guest.request({ type: 'resign' });
    await settle();
    expect(guest.view().state.status).toEqual({ kind: 'won', winner: 'white', by: 'resign' });
  });
});
