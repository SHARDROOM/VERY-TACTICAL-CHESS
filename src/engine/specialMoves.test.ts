import { describe, expect, it } from 'vitest';
import { createInitialState, createStateFrom, legalTargets, parseMoveText, squareName, type GameState } from './index';
import { move, okMove, play, sq } from './testUtil';

const legal = (state: GameState, from: string) => legalTargets(state, sq(from)).map((t) => squareName(t.to)).sort();
const allRights = {
  white: { kingSide: true, queenSide: true },
  black: { kingSide: true, queenSide: true },
};

describe('castling', () => {
  const ready = () =>
    createStateFrom(
      {
        e1: { color: 'white', type: 'king' },
        a1: { color: 'white', type: 'rook' },
        h1: { color: 'white', type: 'rook' },
        e8: { color: 'black', type: 'king' },
        a8: { color: 'black', type: 'rook' },
        h8: { color: 'black', type: 'rook' },
      },
      'white',
      { castling: allRights },
    );

  it('offers both castles when the path is clear', () => {
    expect(legal(ready(), 'e1')).toEqual(expect.arrayContaining(['c1', 'g1']));
  });

  it('king-side castle moves king to g1 and rook to f1', () => {
    const r = okMove(ready(), 'e1', 'g1');
    expect(r.state.board[sq('g1')]).toMatchObject({ type: 'king', color: 'white' });
    expect(r.state.board[sq('f1')]).toMatchObject({ type: 'rook', color: 'white' });
    expect(r.state.board[sq('h1')]).toBeNull();
    expect(r.state.board[sq('e1')]).toBeNull();
    expect(r.events[0]).toMatchObject({ type: 'moved', special: { kind: 'castle', side: 'king' } });
    expect(r.state.castling.white).toEqual({ kingSide: false, queenSide: false });
  });

  it('queen-side castle moves king to c1 and rook to d1', () => {
    const r = okMove(ready(), 'e1', 'c1');
    expect(r.state.board[sq('c1')]).toMatchObject({ type: 'king' });
    expect(r.state.board[sq('d1')]).toMatchObject({ type: 'rook' });
    expect(r.state.board[sq('a1')]).toBeNull();
  });

  it('black can castle too', () => {
    const s = { ...ready(), turn: 'black' as const };
    const r = okMove(s, 'e8', 'g8');
    expect(r.state.board[sq('f8')]).toMatchObject({ type: 'rook', color: 'black' });
  });

  it('is blocked by pieces in between', () => {
    const s = ready();
    const board = [...s.board];
    board[sq('b1')] = { id: 'n', color: 'white', type: 'knight' };
    board[sq('f1')] = { id: 'b', color: 'white', type: 'bishop' };
    expect(legal({ ...s, board }, 'e1')).not.toContain('c1');
    expect(legal({ ...s, board }, 'e1')).not.toContain('g1');
  });

  it('is lost after the king moves', () => {
    const s = play(ready(), 'e1e2 e8e7 e2e1 e7e8');
    expect(s.castling.white).toEqual({ kingSide: false, queenSide: false });
    expect(legal(s, 'e1')).not.toContain('g1');
  });

  it('is lost on one side after that rook moves', () => {
    const s = play(ready(), 'h1h2 e8d8 h2h1 d8e8');
    expect(s.castling.white).toEqual({ kingSide: false, queenSide: true });
    expect(legal(s, 'e1')).toEqual(expect.arrayContaining(['c1']));
    expect(legal(s, 'e1')).not.toContain('g1');
  });

  it('is lost when the rook is captured on its corner', () => {
    const s = createStateFrom(
      {
        e1: { color: 'white', type: 'king' },
        h1: { color: 'white', type: 'rook' },
        e8: { color: 'black', type: 'king' },
        h8: { color: 'black', type: 'rook' },
      },
      'black',
      { castling: allRights },
    );
    const r = okMove(s, 'h8', 'h1');
    expect(r.state.castling.white.kingSide).toBe(false);
  });

  it('decision: castling ignores check (out of, through, into) since this game allows self-check', () => {
    const s = ready();
    const board = [...s.board];
    board[sq('e5')] = { id: 'q', color: 'black', type: 'queen' }; // white king is in check on e1
    board[sq('g5')] = { id: 'r', color: 'black', type: 'rook' }; // g1 is attacked
    const r = okMove({ ...s, board }, 'e1', 'g1');
    expect(r.events).toContainEqual({ type: 'ownKingExposed', color: 'white' });
  });

  it('works from the real starting position once the way is cleared', () => {
    const s = play(createInitialState(), 'g1f3 g8f6 e2e3 e7e6 f1e2 f8e7');
    expect(legal(s, 'e1')).toContain('g1');
  });
});

describe('en passant', () => {
  it('captures a pawn that just double-stepped past', () => {
    const s = play(createInitialState(), 'e2e4 a7a6 e4e5 d7d5');
    expect(squareName(s.enPassant!)).toBe('d6');
    const r = okMove(s, 'e5', 'd6');
    expect(r.state.board[sq('d5')]).toBeNull();
    expect(r.state.board[sq('d6')]).toMatchObject({ type: 'pawn', color: 'white' });
    expect(r.events[0]).toMatchObject({ captured: { type: 'pawn', color: 'black' }, special: { kind: 'enPassant' } });
  });

  it('is only available immediately', () => {
    const s = play(createInitialState(), 'e2e4 a7a6 e4e5 d7d5 h2h3 h7h6');
    expect(s.enPassant).toBeNull();
    expect(move(s, 'e5', 'd6')).toEqual({ ok: false, reason: 'illegalMove' });
  });

  it('works for black too', () => {
    const s = play(createInitialState(), 'a2a3 d7d5 a3a4 d5d4 e2e4');
    const r = okMove(s, 'd4', 'e3');
    expect(r.state.board[sq('e4')]).toBeNull();
  });
});

describe('promotion', () => {
  const ready = (turn: 'white' | 'black' = 'white') =>
    createStateFrom(
      {
        a7: { color: 'white', type: 'pawn' },
        h2: { color: 'black', type: 'pawn' },
        b8: { color: 'black', type: 'knight' },
        e1: { color: 'white', type: 'king' },
        e8: { color: 'black', type: 'king' },
      },
      turn,
    );

  it('requires choosing a piece', () => {
    expect(move(ready(), 'a7', 'a8')).toEqual({ ok: false, reason: 'promotionRequired' });
  });

  it('promotes to the chosen piece and keeps its id', () => {
    const before = ready().board[sq('a7')]!;
    const r = okMove(ready(), 'a7', 'a8', { promotion: 'knight' });
    expect(r.state.board[sq('a8')]).toEqual({ ...before, type: 'knight' });
    expect(r.events[0]).toMatchObject({ special: { kind: 'promotion', to: 'knight' } });
  });

  it('promotes on capture', () => {
    const r = okMove(ready(), 'a7', 'b8', { promotion: 'queen' });
    expect(r.state.board[sq('b8')]).toMatchObject({ type: 'queen', color: 'white' });
  });

  it('black promotes on rank 1', () => {
    const r = okMove(ready('black'), 'h2', 'h1', { promotion: 'rook' });
    expect(r.state.board[sq('h1')]).toMatchObject({ type: 'rook', color: 'black' });
  });

  it('rejects promotion on a normal move or to an invalid piece', () => {
    expect(move(createInitialState(), 'e2', 'e4', { promotion: 'queen' })).toEqual({ ok: false, reason: 'invalidPromotion' });
    // @ts-expect-error -- deliberately invalid at runtime
    expect(move(ready(), 'a7', 'a8', { promotion: 'king' })).toEqual({ ok: false, reason: 'invalidPromotion' });
  });

  it('parses promotion text', () => {
    expect(parseMoveText('a7a8q')).toEqual({ from: sq('a7'), to: sq('a8'), promotion: 'queen' });
    expect(parseMoveText('a7a8=N')).toEqual({ from: sq('a7'), to: sq('a8'), promotion: 'knight' });
    expect(parseMoveText('a7a8 퀸')).toEqual({ from: sq('a7'), to: sq('a8'), promotion: 'queen' });
  });
});

describe('basic movement still unaffected', () => {
  it('pawn double step does not appear for non-start pawns', () => {
    const s = play(createInitialState(), 'e2e3 e7e6');
    expect(legal(s, 'e3')).toEqual(['e4']);
  });
});
