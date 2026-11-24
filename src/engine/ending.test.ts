import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, createStateFrom, KINGS_ONLY_DRAW_TURNS, type GameState } from './index';
import { ok, okMove, sq } from './testUtil';

/*
 * Ending a game other than by a king's fall (사용자 요청): resigning, a draw agreed on, and a draw
 * when only kings have been left for a while. docs/SPEC.md, "판 끝내기".
 */

describe('resigning', () => {
  it('on the classic board, the other side wins at once, whoever is to move', () => {
    const s = createInitialState();
    const r = ok(applyCommand(s, { type: 'resign', color: 'black' }));
    expect(r.state.status).toEqual({ kind: 'won', winner: 'white', by: 'resign' });
    expect(r.events).toContainEqual({ type: 'resigned', color: 'black', winner: 'white' });
    expect(applyCommand(r.state, { type: 'move', from: sq('e2'), to: sq('e4') })).toMatchObject({ ok: false, reason: 'gameOver' });
  });

  it('only a side that is in the game can resign', () => {
    expect(applyCommand(createInitialState(), { type: 'resign', color: 'red' })).toMatchObject({ ok: false, reason: 'notInGame' });
  });

  it('on the hexagon, the one who resigns leaves its king behind and its pieces wander gray; the other two play on', () => {
    const s = createInitialState(undefined, 'hex3');
    const reds = s.board.filter((p) => p?.color === 'red').length;
    const r = ok(applyCommand(s, { type: 'resign', color: 'red' }));
    expect(r.state.status).toEqual({ kind: 'playing' });
    expect(r.state.board.some((p) => p?.color === 'red')).toBe(false);
    const grays = r.state.board.filter((p) => p?.color === 'gray');
    expect(grays).toHaveLength(reds - 1);
    expect(grays.some((p) => p?.type === 'king')).toBe(false);
    expect(r.events).toContainEqual({ type: 'resigned', color: 'red', winner: null });
    // It was white's turn: still white's.
    expect(r.state.turn).toBe('white');
  });

  it("on the hexagon, resigning on one's own turn passes the turn on, and the last king left wins", () => {
    const s: GameState = { ...createInitialState(undefined, 'hex3'), turn: 'black' };
    const first = ok(applyCommand(s, { type: 'resign', color: 'black' }));
    expect(first.state.turn).toBe('red');
    expect(first.state.turnNumber).toBe(s.turnNumber + 1);
    const second = ok(applyCommand(first.state, { type: 'resign', color: 'white' }));
    expect(second.state.status).toEqual({ kind: 'won', winner: 'red', by: 'resign' });
    expect(second.events).toContainEqual({ type: 'resigned', color: 'white', winner: 'red' });
  });
});

describe('a draw', () => {
  it('agreed on ends the game with no winner', () => {
    const r = ok(applyCommand(createInitialState(), { type: 'draw' }));
    expect(r.state.status).toEqual({ kind: 'draw', reason: 'agreed' });
    expect(r.events).toContainEqual({ type: 'drawn', reason: 'agreed' });
  });

  it(`comes by itself when only kings have been on the board for ${KINGS_ONLY_DRAW_TURNS} turns (gray wanderers aside)`, () => {
    let s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, a4: { color: 'gray', type: 'pawn' } });
    // The kings step back and forth.
    const steps = ['e1e2', 'e8e7', 'e2e1', 'e7e8'];
    let i = 0;
    while (s.status.kind === 'playing' && i < 40) {
      const m = steps[i % steps.length];
      s = okMove(s, m.slice(0, 2), m.slice(2)).state;
      i++;
    }
    expect(s.status).toEqual({ kind: 'draw', reason: 'kingsOnly' });
    expect(i).toBe(KINGS_ONLY_DRAW_TURNS);
  });

  it('is not counted while anything but kings is left, and the count starts over when one comes back', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, a2: { color: 'white', type: 'pawn' } });
    const after = okMove(s, 'e1', 'e2').state;
    expect(after.kingsOnlySince).toBeUndefined();
    const lonely = okMove(createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' } }), 'e1', 'e2').state;
    // The turn just played counts as the first.
    expect(lonely.kingsOnlySince).toBe(lonely.turnNumber - 1);
    // A piece called back (a special action, say): the count is gone.
    const board = [...lonely.board];
    board[sq('a7')] = { id: 'back', color: 'black', type: 'pawn' };
    expect(okMove({ ...lonely, board }, 'e8', 'e7').state.kingsOnlySince).toBeUndefined();
  });
});
