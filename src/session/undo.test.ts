import { describe, expect, it } from 'vitest';
import { createInitialState, parseSquare } from '../engine';
import type { GameMaster, GmRequest } from '../gm/types';
import { fakeRuling } from '../gm/fakeGm';
import { memoryChannelPair } from './channel';
import { HostSession } from './hostSession';
import { LocalSession } from './localSession';
import type { SessionEvent } from './types';

/* 무르기 (사용자 요청): one screen only, plain moves only, never back past dice or chaos. */

const sq = (n: string) => parseSquare(n)!;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 8) => {
  for (let i = 0; i < n; i++) await tick();
};

class TestGm implements GameMaster {
  readonly name = 'Test GM';
  async rule(req: GmRequest) {
    return fakeRuling(req.action, req.state.turn);
  }
}

const hotseat = () => {
  const s = new LocalSession(new TestGm(), { roll: () => 6 });
  s.start();
  return s;
};

describe('undo on one screen', () => {
  it('takes back the last move, one at a time, as far as the start', () => {
    const s = hotseat();
    const start = s.view().state.board;
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    s.request({ type: 'move', from: sq('e7'), to: sq('e5') });
    expect(s.view().undoable).toBe(true);
    s.undo();
    expect(s.view().state.turn).toBe('black');
    expect(s.view().state.board[sq('e7')]).toMatchObject({ type: 'pawn' });
    s.undo();
    expect(s.view().state.board).toEqual(start);
    expect(s.view().undoable).toBe(false);
    const said: string[] = [];
    s.subscribe((e: SessionEvent) => e.kind === 'notice' && said.push(e.text));
    s.undo();
    expect(said.some((t) => t.includes('무를'))).toBe(true);
  });

  it("against an AI, takes back the person's move and the AI's answer to it", async () => {
    const s = new LocalSession(new TestGm(), { roll: () => 6, aiPace: 0 });
    s.setRules({ ai: { black: { level: 'easy', specials: 'off' } } });
    s.start();
    const start = s.view().state.board;
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    for (let i = 0; i < 40 && s.view().state.turn !== 'white'; i++) await settle(4);
    expect(s.view().state.turnNumber).toBe(3);
    s.undo();
    expect(s.view().state.turn).toBe('white');
    expect(s.view().state.turnNumber).toBe(1);
    expect(s.view().state.board).toEqual(start);
    s.dispose();
  });

  it('never goes back past a special action whose dice were thrown', async () => {
    const s = hotseat();
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    s.request({ type: 'declare', action: 'g8 나이트를 f6로 보낸다' });
    await settle();
    s.request({ type: 'attempt' });
    s.request({ type: 'endTurn' });
    expect(s.view().state.turn).toBe('white');
    // Ending the turn after the dice can be taken back (back to after the dice), but no further.
    s.undo();
    expect(s.view().state.turn).toBe('black');
    expect(s.view().state.board[sq('f6')]).toMatchObject({ type: 'knight' });
    expect(s.view().undoable).toBe(false);
  });
});

describe('undo and who plays', () => {
  it('keeps the sides as they are now: a side handed to an AI mid-game stays with it', () => {
    const s = new LocalSession(new TestGm(), { roll: () => 6, aiPace: 1000 });
    s.start();
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    s.setAi('black', { level: 'easy', specials: 'off' });
    s.undo();
    expect(s.view().state.rules.ai?.black).toMatchObject({ level: 'easy' });
    s.dispose();
  });
});

describe('undo while an AI is thinking', () => {
  it('the AI left thinking is dropped: it does not ask its model again for the next turn', async () => {
    // An AI that asks its model for a special action, and the model answers only when told.
    const answers: (() => void)[] = [];
    let asked = 0;
    const gm: GameMaster = {
      name: 'Slow',
      rule: async (req: GmRequest) => fakeRuling(req.action, req.state.turn),
      act: () => {
        asked++;
        return new Promise((resolve) => answers.push(() => resolve({ action: '', pass: true })));
      },
    };
    const s = new LocalSession(gm, { roll: () => 6, aiPace: 0 });
    s.setRules({ ai: { black: { level: 'easy', specials: 'often' } } });
    s.start();
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle(12);
    expect(asked).toBe(1);
    s.undo();
    s.request({ type: 'move', from: sq('e2'), to: sq('e4') });
    await settle(12);
    // The old thought comes back late (and is dropped): it must not set off another AI turn.
    answers[0]();
    await settle(20);
    expect(asked).toBeLessThanOrEqual(2);
    s.dispose();
  });
});

describe('undo elsewhere', () => {
  it('is not offered online, nor while AIs only play', async () => {
    const [hostEnd] = memoryChannelPair();
    const host = new HostSession(new TestGm(), { code: 'ABC234', link: 'x', roll: () => 6, heartbeatMs: 0 });
    host.attachGuest(hostEnd);
    expect(host.view().undoable).toBe(false);
    const watch = new LocalSession(new TestGm(), { roll: () => 6, initialState: createInitialState(), aiPace: 1000 });
    watch.setRules({ ai: { white: { level: 'easy', specials: 'off' }, black: { level: 'easy', specials: 'off' } } });
    watch.start();
    expect(watch.view().undoable).toBe(false);
    watch.dispose();
  });
});
