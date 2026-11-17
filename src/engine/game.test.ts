import { describe, expect, it } from 'vitest';
import { createInitialState, createStateFrom, movesFrom, parseMoveText } from './index';
import { move, okMove, sq, targets } from './testUtil';

describe('initial position', () => {
  it('starts with 32 pieces, white to move', () => {
    const s = createInitialState();
    expect(s.board.filter(Boolean)).toHaveLength(32);
    expect(s.turn).toBe('white');
    expect(s.board[sq('e1')]).toMatchObject({ color: 'white', type: 'king' });
    expect(s.board[sq('d8')]).toMatchObject({ color: 'black', type: 'queen' });
  });

  it('gives 20 moves to white at the start', () => {
    const s = createInitialState();
    const total = s.board.reduce(
      (n, p, i) => (p?.color === 'white' ? n + movesFrom(s.board, i).length : n),
      0,
    );
    expect(total).toBe(20);
  });
});

describe('piece movement', () => {
  it('pawn moves one or two from start, one afterwards, captures diagonally', () => {
    const s = createStateFrom({
      e2: { color: 'white', type: 'pawn' },
      d3: { color: 'black', type: 'knight' },
      f3: { color: 'white', type: 'knight' },
      a3: { color: 'white', type: 'pawn' },
    });
    expect(targets(s, 'e2')).toEqual(['d3', 'e3', 'e4']);
    expect(targets(s, 'a3')).toEqual(['a4']);
  });

  it('pawn is blocked by any piece in front', () => {
    const s = createStateFrom({ e2: { color: 'white', type: 'pawn' }, e3: { color: 'black', type: 'pawn' } });
    expect(targets(s, 'e2')).toEqual([]);
  });

  it('black pawns move downward', () => {
    const s = createStateFrom({ d7: { color: 'black', type: 'pawn' } }, 'black');
    expect(targets(s, 'd7')).toEqual(['d5', 'd6']);
  });

  it('knight jumps', () => {
    const s = createStateFrom({ b1: { color: 'white', type: 'knight' }, d2: { color: 'white', type: 'pawn' } });
    expect(targets(s, 'b1')).toEqual(['a3', 'c3']);
  });

  it('sliding pieces stop at blockers and can capture enemies', () => {
    const s = createStateFrom({
      d4: { color: 'white', type: 'rook' },
      d6: { color: 'black', type: 'pawn' },
      f4: { color: 'white', type: 'pawn' },
    });
    expect(targets(s, 'd4')).toEqual(['a4', 'b4', 'c4', 'd1', 'd2', 'd3', 'd5', 'd6', 'e4']);
  });

  it('queen combines rook and bishop movement', () => {
    const s = createStateFrom({ a1: { color: 'white', type: 'queen' } });
    expect(targets(s, 'a1')).toHaveLength(21);
  });

  it('king moves one square', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' } });
    expect(targets(s, 'e1')).toEqual(['d1', 'd2', 'e2', 'f1', 'f2']);
  });
});

describe('applyCommand: move', () => {
  it('moves the piece and passes the turn', () => {
    const r = okMove(createInitialState(), 'e2', 'e4');
    expect(r.state.board[sq('e4')]).toMatchObject({ type: 'pawn', color: 'white' });
    expect(r.state.board[sq('e2')]).toBeNull();
    expect(r.state.turn).toBe('black');
    expect(r.state.turnNumber).toBe(2);
    expect(r.events).toContainEqual({ type: 'turnPassed', turn: 'black', turnNumber: 2, apGained: 1, ended: 'white' });
  });

  it('does not mutate the previous state', () => {
    const s = createInitialState();
    okMove(s, 'e2', 'e4');
    expect(s.board[sq('e2')]).not.toBeNull();
    expect(s.turn).toBe('white');
  });

  it('reports captures', () => {
    const s = createStateFrom({ d4: { color: 'white', type: 'rook' }, d6: { color: 'black', type: 'pawn' } });
    const r = okMove(s, 'd4', 'd6');
    expect(r.events[0]).toMatchObject({ type: 'moved', captured: { type: 'pawn', color: 'black' } });
  });

  it('rejects moving from an empty square', () => {
    expect(move(createInitialState(), 'e4', 'e5')).toEqual({ ok: false, reason: 'noPiece' });
  });

  it("rejects moving the opponent's piece", () => {
    expect(move(createInitialState(), 'e7', 'e5')).toEqual({ ok: false, reason: 'notYourPiece' });
  });

  it('rejects illegal destinations', () => {
    expect(move(createInitialState(), 'e2', 'e5')).toEqual({ ok: false, reason: 'illegalMove' });
    expect(move(createInitialState(), 'a1', 'a2')).toEqual({ ok: false, reason: 'illegalMove' });
  });
});

describe('check and king capture', () => {
  it('announces check on the opponent', () => {
    const s = createStateFrom({
      e1: { color: 'white', type: 'king' },
      a1: { color: 'white', type: 'rook' },
      e8: { color: 'black', type: 'king' },
    });
    const r = okMove(s, 'a1', 'a8');
    expect(r.events).toContainEqual({ type: 'check', color: 'black' });
  });

  it('allows a move that exposes your own king, with a warning', () => {
    const s = createStateFrom({
      e1: { color: 'white', type: 'king' },
      e2: { color: 'white', type: 'bishop' },
      e8: { color: 'black', type: 'rook' },
      a8: { color: 'black', type: 'king' },
    });
    const r = okMove(s, 'e2', 'd3');
    expect(r.events).toContainEqual({ type: 'ownKingExposed', color: 'white' });
  });

  it('allows the king to step into attack', () => {
    const s = createStateFrom({
      e1: { color: 'white', type: 'king' },
      d8: { color: 'black', type: 'rook' },
      a8: { color: 'black', type: 'king' },
    });
    const r = okMove(s, 'e1', 'd1');
    expect(r.events).toContainEqual({ type: 'ownKingExposed', color: 'white' });
  });

  it('capturing the king wins immediately and ends the game', () => {
    const s = createStateFrom({
      e1: { color: 'white', type: 'king' },
      e8: { color: 'black', type: 'king' },
      e5: { color: 'black', type: 'rook' },
    }, 'black');
    const r = okMove(s, 'e5', 'e1');
    expect(r.state.status).toEqual({ kind: 'won', winner: 'black' });
    expect(r.events).toContainEqual({ type: 'kingCaptured', winner: 'black', loser: 'white' });
    expect(r.events.some((e) => e.type === 'turnPassed')).toBe(false);
    expect(move(r.state, 'e8', 'e7')).toEqual({ ok: false, reason: 'gameOver' });
  });
});

describe('parseMoveText', () => {
  it.each(['e2e4', 'e2-e4', 'E2 E4', '  e2e4 '])('parses %s', (text) => {
    expect(parseMoveText(text)).toEqual({ from: sq('e2'), to: sq('e4') });
  });

  it.each(['e9e4', 'nf3', '', 'e2e4e5'])('rejects %s', (text) => {
    expect(parseMoveText(text)).toBeNull();
  });
});
