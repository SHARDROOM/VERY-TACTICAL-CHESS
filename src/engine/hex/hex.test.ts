import { describe, expect, it } from 'vitest';
import { HEX_SQUARES, hexName, isDark, parseHexSquare, step, type Dir } from './geometry';
import { hexMovesFrom, hexStartBoard, promotes, type HexBoard, type HexColor, type HexPiece } from './moves';

const sq = (name: string) => {
  const s = parseHexSquare(name);
  if (s === null) throw new Error(name);
  return s;
};
const names = (list: number[]) => list.map(hexName).sort();
const alone = (at: string, type: HexPiece['type'], color: HexColor = 'white', more: Record<string, HexPiece> = {}): HexBoard => {
  const b: (HexPiece | null)[] = Array.from({ length: HEX_SQUARES }, () => null);
  b[sq(at)] = { id: 'x', type, color };
  for (const [k, p] of Object.entries(more)) b[sq(k)] = p;
  return b;
};
const ALL: Dir[] = [-1, 0, 1].flatMap((df) => [-1, 0, 1].map((dr) => ({ df, dr }))).filter((d) => d.df || d.dr);

describe('the three-player board', () => {
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
    expect(names(step(sq('w-d4'), { df: 1, dr: 1 }).map((s) => s.sq))).toEqual(['b-d4', 'r-d4']);
    expect(names(step(sq('w-e4'), { df: -1, dr: 1 }).map((s) => s.sq))).toEqual(['b-e4', 'r-e4']);
    let splits = 0;
    for (let s = 0; s < HEX_SQUARES; s++) for (const d of ALL) if (step(s, d).length > 1) splits++;
    expect(splits).toBe(6);
  });

  it('a rook goes up a file and on down the half across: a–d into red, e–h into black', () => {
    const d1 = names(hexMovesFrom(alone('w-d1', 'rook'), sq('w-d1')));
    expect(d1).toEqual(expect.arrayContaining(['w-d4', 'r-e4', 'r-e1']));
    expect(d1).not.toContain('b-d4');
    const f2 = names(hexMovesFrom(alone('w-f2', 'rook'), sq('w-f2')));
    expect(f2).toEqual(expect.arrayContaining(['w-f4', 'b-c4', 'b-c1']));
  });

  it('a bishop through the centre goes on from both other d4s, never onto the opposite e4', () => {
    const b2 = names(hexMovesFrom(alone('w-b2', 'bishop'), sq('w-b2')));
    expect(b2).toEqual(expect.arrayContaining(['w-c3', 'w-d4', 'b-d4', 'b-a1', 'r-d4', 'r-a1']));
    expect(b2).not.toContain('b-e4');
  });

  it('a bishop never leaves its colour, from anywhere', () => {
    for (let s = 0; s < HEX_SQUARES; s++) {
      for (const t of hexMovesFrom(alone(hexName(s), 'bishop'), s)) expect(isDark(t)).toBe(isDark(s));
    }
  });

  it('a knight jumps as usual on its own half, and across the seams near the centre', () => {
    expect(names(hexMovesFrom(alone('w-b1', 'knight'), sq('w-b1')))).toEqual(['w-a3', 'w-c3', 'w-d2']);
    expect(names(hexMovesFrom(alone('w-d3', 'knight'), sq('w-d3')))).toEqual(expect.arrayContaining(['r-d4', 'r-f4', 'b-d4', 'w-b4', 'w-f4']));
    // A knight always lands on the other colour.
    for (let s = 0; s < HEX_SQUARES; s++) {
      for (const t of hexMovesFrom(alone(hexName(s), 'knight'), s)) expect(isDark(t)).not.toBe(isDark(s));
    }
  });

  it('pawns: two from the start, on down the half across, promoting on its back rank', () => {
    expect(names(hexMovesFrom(alone('w-a2', 'pawn'), sq('w-a2')))).toEqual(['w-a3', 'w-a4']);
    expect(names(hexMovesFrom(alone('w-a4', 'pawn'), sq('w-a4')))).toEqual(['r-h4']);
    expect(names(hexMovesFrom(alone('r-h3', 'pawn', 'red'), sq('r-h3')))).toEqual(['r-h4']);
    expect(names(hexMovesFrom(alone('r-h4', 'pawn', 'white'), sq('r-h4')))).toEqual(['r-h3']);
    expect(promotes('white', sq('r-h1'))).toBe(true);
    expect(promotes('white', sq('w-h1'))).toBe(false);
    // Taking diagonally forward, through the centre too.
    const foe: HexPiece = { id: 'f', type: 'pawn', color: 'black' };
    expect(names(hexMovesFrom(alone('w-d4', 'pawn', 'white', { 'b-d4': foe, 'r-e4': { ...foe, color: 'red' } }), sq('w-d4')))).toEqual(['b-d4']);
  });

  it('the start: three armies of sixteen on their own halves', () => {
    const b = hexStartBoard();
    for (const c of ['white', 'black', 'red'] as const) expect(b.filter((p) => p?.color === c)).toHaveLength(16);
    expect(b[sq('b-e1')]).toMatchObject({ type: 'king', color: 'black' });
  });
});
