import { describe, expect, it } from 'vitest';
import { FakeGameMaster } from '../gm/fakeGm';
import { LocalSession } from '../session/localSession';
import type { GameEvent } from '../engine';
import type { SessionEvent } from '../session/types';
import { blackReply, kindDice, stepAfter, suggestedDeclaration, tutorialState, type TutorialStep } from './tutorial';

/* 따라하기 (사용자 요청): the whole lesson plays through with the fake GM and the kind dice. */

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 10) => {
  for (let i = 0; i < n; i++) await tick();
};

describe('the lesson', () => {
  it('goes from a move through a special action and its dice to the precedent', async () => {
    const s = new LocalSession(new FakeGameMaster(0), { roll: kindDice(), initialState: tutorialState(), phase: 'playing' });
    let step: TutorialStep = 'move';
    s.subscribe((e: SessionEvent) => {
      if (e.kind === 'events') step = stepAfter(step, e.events as GameEvent[]);
    });
    s.request({ type: 'move', from: 12, to: 28 }); // e2e4
    expect(step).toBe('reply');
    const reply = blackReply(s.view().state)!;
    s.request({ type: 'move', ...reply });
    expect(step).toBe('ap');
    step = 'declare';
    const action = suggestedDeclaration(s.view().state);
    expect(action).toBe('c1 비숍이 주문을 외워 d5 폰을 기절시킨다');
    s.request({ type: 'declare', action });
    await settle();
    expect(step).toBe('dice');
    s.request({ type: 'attempt' });
    await settle();
    expect(step).toBe('precedent');
    expect(s.view().state.precedents.at(-1)).toMatchObject({ outcome: 'success' });
    s.dispose();
  });

  it('a suggestion follows the board: with the bishop gone, the queen casts', () => {
    const st = tutorialState();
    const board = [...st.board];
    board[2] = null; // c1
    expect(suggestedDeclaration({ ...st, board })).toMatch(/^d1 퀸이 주문을 외워 [a-h][1-8] 폰을 기절시킨다$/);
  });

  it('black always has a quiet answer for a good while', () => {
    let st = tutorialState();
    const s = new LocalSession(new FakeGameMaster(0), { roll: kindDice(), initialState: st, phase: 'playing' });
    for (const mv of [[12, 28], [11, 19], [10, 18]]) {
      s.request({ type: 'move', from: mv[0], to: mv[1] });
      st = s.view().state;
      const r = blackReply(st);
      expect(r).not.toBeNull();
      s.request({ type: 'move', ...r! });
    }
    s.dispose();
  });
});
