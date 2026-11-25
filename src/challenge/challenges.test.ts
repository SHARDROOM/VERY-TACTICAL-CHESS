import { describe, expect, it } from 'vitest';
import { applyCommand, isInCheck, legalTargets, parseSquare, playersOf, setBoardMap } from '../engine';
import { CHALLENGES, challengeOutcome, turnsLeft } from './challenges';

/* 도전 판 (사용자 요청): three set boards, a goal, a few turns. */

const sq = (n: string) => parseSquare(n)!;
const knight = CHALLENGES.find((c) => c.id === 'knight')!;

describe('the challenges', () => {
  for (const c of CHALLENGES) {
    it(`${c.title} starts fair: white to move, no king attacked, both sides able to move, the goal not met yet`, () => {
      const s = c.start();
      setBoardMap(s.map);
      expect(s.turn).toBe('white');
      for (const color of playersOf()) expect(isInCheck(s.board, color, s.terrain)).toBe(false);
      expect(s.board.some((p, i) => p?.color === 'white' && legalTargets(s, i).length > 0)).toBe(true);
      expect(challengeOutcome(c, s)).toBeNull();
      expect(turnsLeft(c, s)).toBe(c.turns);
    });
  }

  it('the walls challenge: the fifth rank is closed to a plain move', () => {
    const s = CHALLENGES.find((c) => c.id === 'walls')!.start();
    expect(legalTargets(s, sq('a1')).some((t) => t.to >= sq('a5'))).toBe(false);
    expect(legalTargets(s, sq('d1')).some((t) => t.to >= sq('a5'))).toBe(false);
  });

  it('the altar rook fights back: taking it means a clash', () => {
    const s = CHALLENGES.find((c) => c.id === 'altar')!.start();
    expect(s.board[sq('d5')]?.tags?.[0]).toMatchObject({ name: '검술', clash: 2 });
    expect(applyCommand(s, { type: 'move', from: sq('c3'), to: sq('d5') })).toMatchObject({ ok: false, reason: 'clashRollsNeeded' });
  });

  it('done when the goal is met; failed once white has used its turns', () => {
    const s = knight.start();
    const noQueen = { ...s, board: s.board.map((p) => (p?.type === 'queen' ? null : p)) };
    expect(challengeOutcome(knight, noQueen)).toBe('won');
    // White's 4th turn begins (turn number 7) with the queen still there.
    expect(challengeOutcome(knight, { ...s, turnNumber: 6, turn: 'black' })).toBeNull();
    expect(challengeOutcome(knight, { ...s, turnNumber: 7, turn: 'white' })).toBe('lost');
    expect(turnsLeft(knight, { ...s, turnNumber: 5 })).toBe(1);
    expect(challengeOutcome(knight, { ...s, status: { kind: 'won', winner: 'black' } })).toBe('lost');
  });
});
