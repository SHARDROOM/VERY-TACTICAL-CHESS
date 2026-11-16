import { describe, expect, it } from 'vitest';
import { createStateFrom, parseSquare, type GameState } from '../engine';
import type { GameMaster } from '../gm/types';
import { fakeRuling } from '../gm/fakeGm';
import { LocalSession } from './localSession';

const sq = (n: string) => parseSquare(n)!;
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

/** White's rook may move twice in a row this turn. */
function twiceRook(): GameState {
  const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, a1: { color: 'white', type: 'rook' } }, 'white');
  const board = [...s.board];
  board[sq('a1')] = { ...board[sq('a1')]!, tags: [{ name: '질주', turnsLeft: 1, appliedOnTurn: 0, moveTimes: 2 }] };
  return { ...s, board };
}

describe('moving twice in a row, on the authority', () => {
  it('a declaration in the middle is refused without asking the GM', async () => {
    let asked = 0;
    const gm: GameMaster = { name: 'test', rule: async (req) => (asked++, fakeRuling(req.action, req.state.turn, req.state.board)) };
    const session = new LocalSession(gm, { initialState: twiceRook(), phase: 'playing' });
    const notices: string[] = [];
    session.subscribe((e) => {
      if (e.kind === 'notice') notices.push(e.text);
    });
    session.request({ type: 'move', from: sq('a1'), to: sq('a2') });
    await settle();
    expect(session.view().state.chain?.at).toBe(sq('a2'));
    session.request({ type: 'declare', action: 'a2 룩이 함성을 지른다' });
    await settle();
    expect(asked).toBe(0);
    expect(notices.at(-1)).toContain('연속 이동 중');
    session.request({ type: 'move', from: sq('a2'), to: sq('b2') });
    await settle();
    expect(session.view().state.turn).toBe('black');
    session.dispose();
  });
});
