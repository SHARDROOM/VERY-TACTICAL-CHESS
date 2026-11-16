import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HEX_SQUARES, hexCenter, hexSquareAt, isDark, step, type Dir } from './geometry';
import { applyCommand, createInitialState, createStateFrom, legalTargets, movesFrom, parseSquare, setBoardMap, squareName, type Color, type GameState, type PieceType } from '../index';

const sq = (name: string) => {
  const s = parseSquare(name);
  if (s === null) throw new Error(name);
  return s;
};
const names = (list: number[]) => list.map(squareName).sort();
const hex = (placements: Record<string, { color: Color; type: PieceType }>, turn: Color = 'white', extra: Partial<GameState> = {}) =>
  createStateFrom(placements, turn, { map: 'hex3', ...extra });
const alone = (at: string, type: PieceType, color: Color = 'white') => hex({ [at]: { color, type } });
const movesOf = (s: GameState, at: string) => names(movesFrom(s.board, sq(at), s.terrain));
const ALL: Dir[] = [-1, 0, 1].flatMap((df) => [-1, 0, 1].map((dr) => ({ df, dr }))).filter((d) => d.df || d.dr);

describe('the three-player board', () => {
  beforeAll(() => setBoardMap('hex3'));
  afterAll(() => setBoardMap('classic'));

  it('names squares by the half they are on', () => {
    expect(squareName(sq('흑e4'))).toBe('흑e4');
    expect(sq('흑 e4')).toBe(sq('b-e4'));
    expect(squareName(sq('적a1^'))).toBe('적a1^');
  });

  it('a step and its way back meet again, everywhere, except through the centre', () => {
    for (let s = 0; s < HEX_SQUARES; s++) {
      for (const d of ALL) {
        const out = step(s, d);
        if (out.length !== 1) continue;
        const back = step(out[0].sq, { df: -out[0].dir.df, dr: -out[0].dir.dr });
        expect(back.map((b) => b.sq)).toContain(s);
      }
    }
  });

  it('only the diagonals through the centre split, into the other halves', () => {
    expect(names(step(sq('백d4'), { df: 1, dr: 1 }).map((s) => s.sq))).toEqual(['적d4', '흑d4']);
    let splits = 0;
    for (let s = 0; s < HEX_SQUARES; s++) for (const d of ALL) if (step(s, d).length > 1) splits++;
    expect(splits).toBe(6);
  });

  it('every square is found again from its own centre on the plane', () => {
    for (let s = 0; s < HEX_SQUARES; s++) expect(hexSquareAt(hexCenter(s).x, hexCenter(s).y)).toBe(s);
    expect(hexSquareAt(0, -9)).toBeNull();
  });

  it('a rook goes up a file and on down the half across: a–d into red, e–h into black', () => {
    expect(movesOf(alone('백d1', 'rook'), '백d1')).toEqual(expect.arrayContaining(['백d4', '적e4', '적e1']));
    expect(movesOf(alone('백f2', 'rook'), '백f2')).toEqual(expect.arrayContaining(['백f4', '흑c4', '흑c1']));
  });

  it('a bishop through the centre goes on from both other d4s, never onto the opposite e4', () => {
    const b2 = movesOf(alone('백b2', 'bishop'), '백b2');
    expect(b2).toEqual(expect.arrayContaining(['백c3', '백d4', '흑d4', '흑a1', '적d4', '적a1']));
    expect(b2).not.toContain('흑e4');
  });

  it('a bishop never leaves its colour and a knight always changes it, from anywhere', () => {
    for (let s = 0; s < HEX_SQUARES; s++) {
      for (const t of movesFrom(alone(squareName(s), 'bishop').board, s)) expect(isDark(t)).toBe(isDark(s));
      for (const t of movesFrom(alone(squareName(s), 'knight').board, s)) expect(isDark(t)).not.toBe(isDark(s));
    }
    expect(movesOf(alone('백b1', 'knight'), '백b1')).toEqual(['백a3', '백c3', '백d2']);
  });

  it('pawns: two from the start, on down the half across, promoting on another back rank', () => {
    expect(movesOf(alone('백a2', 'pawn'), '백a2')).toEqual(['백a3', '백a4']);
    expect(movesOf(alone('백a4', 'pawn'), '백a4')).toEqual(['적h4']);
    expect(movesOf(alone('적h3', 'pawn', 'red'), '적h3')).toEqual(['적h4']);
    expect(movesOf(alone('적h2', 'pawn'), '적h2')).toEqual(['적h1']);
    const s = alone('적h2', 'pawn');
    expect(applyCommand(s, { type: 'move', from: sq('적h2'), to: sq('적h1') })).toMatchObject({ ok: false, reason: 'promotionRequired' });
  });

  it('the start: three armies on their own halves; turns go white, black, red', () => {
    const s0 = createInitialState(undefined, 'hex3');
    for (const c of ['white', 'black', 'red'] as const) expect(s0.board.filter((p) => p?.color === c)).toHaveLength(16);
    expect(s0.board[sq('흑e1')]).toMatchObject({ type: 'king', color: 'black' });
    let s = s0;
    for (const [from, to, next] of [['백e2', '백e4', 'black'], ['흑e2', '흑e4', 'red'], ['적e2', '적e4', 'white']] as const) {
      const r = applyCommand(s, { type: 'move', from: sq(from), to: sq(to) });
      if (!r.ok) throw new Error(r.reason);
      s = r.state;
      expect(s.turn).toBe(next);
    }
    // Castling on its own back rank.
    const c = hex({ '흑e1': { color: 'black', type: 'king' }, '흑h1': { color: 'black', type: 'rook' } }, 'black', {
      castling: { white: { kingSide: false, queenSide: false }, black: { kingSide: true, queenSide: false }, red: { kingSide: false, queenSide: false } },
    });
    expect(legalTargets(c, sq('흑e1')).find((t) => t.special?.kind === 'castle')?.to).toBe(sq('흑g1'));
  });

  it('a king is in check from either other player', () => {
    const s = hex({ '백e1': { color: 'white', type: 'king' }, '적d4': { color: 'red', type: 'bishop' }, '흑e1': { color: 'black', type: 'king' } }, 'red');
    const r = applyCommand(s, { type: 'move', from: sq('적d4'), to: sq('적c3') });
    if (!r.ok) throw new Error(r.reason);
    expect(r.events.filter((e) => e.type === 'check')).toEqual([]);
    // A rook on red's e-file looks straight down white's d-file... and on to nothing; up black's? no.
    const s2 = hex({ '백d1': { color: 'white', type: 'king' }, '적e2': { color: 'red', type: 'rook' }, '흑e1': { color: 'black', type: 'king' } }, 'red');
    const r2 = applyCommand(s2, { type: 'move', from: sq('적e2'), to: sq('적e3') });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.events).toContainEqual({ type: 'check', color: 'white' });
  });

  it('en passant on a half', () => {
    let s = hex({ '백e2': { color: 'white', type: 'pawn' }, '백d4': { color: 'black', type: 'pawn' }, '백a1': { color: 'white', type: 'king' }, '흑a1': { color: 'black', type: 'king' } });
    const r = applyCommand(s, { type: 'move', from: sq('백e2'), to: sq('백e4') });
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
    expect(s.enPassant).toBe(sq('백e3'));
    expect(legalTargets(s, sq('백d4'))).toContainEqual({ to: sq('백e3'), special: { kind: 'enPassant' } });
    // (The black pawn on white's d4 heads down white's half, toward white's back rank.)
    const r2 = applyCommand(s, { type: 'move', from: sq('백d4'), to: sq('백e3') });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.state.board[sq('백e4')]).toBeNull();
  });
});
