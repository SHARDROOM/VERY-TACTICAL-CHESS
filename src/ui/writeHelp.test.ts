import { describe, expect, it } from 'vitest';
import { AIR, createInitialState, createStateFrom, parseSquare, type GameState } from '../engine';
import { tapToWrite, writtenMarks } from './writeHelp';

const sq = (n: string) => parseSquare(n)!;
/** Taps in order, from an empty box; the text after each, or the warning. */
function taps(state: GameState, ...names: string[]): string {
  let text = '';
  for (const n of names) {
    const r = tapToWrite(state, sq(n), text);
    if ('warn' in r) return `! ${r.warn}`;
    text = r.text;
  }
  return text;
}

describe('writing a declaration by tapping the board', () => {
  const start = createInitialState();

  it('the first tap names who does it, every tap after what it is done to', () => {
    expect(taps(start, 'd2')).toBe('d2의 폰이 ');
    expect(taps(start, 'b1')).toBe('b1의 나이트가 ');
    expect(taps(start, 'd2', 'd7')).toBe('d2의 폰이 d7의 폰에게 ');
    expect(taps(start, 'd2', 'd4')).toBe('d2의 폰이 d4에 ');
    expect(taps(start, 'd1', 'b1', 'g8')).toBe('d1의 퀸이 b1의 나이트에게 g8의 나이트에게 ');
  });

  it('the first tap must be on one of your own pieces', () => {
    expect(taps(start, 'd7')).toMatch(/^! /);
    expect(taps(start, 'd4')).toMatch(/^! /);
  });

  it('it goes on from what was typed, and names walls and pits', () => {
    const s: GameState = { ...start, terrain: [{ at: sq('d4'), kind: 'wall', turnsLeft: 2, owner: 'white', appliedOnTurn: 1 }] };
    const r = tapToWrite(s, sq('d4'), 'd2의 폰이 불화살로');
    expect(r).toEqual({ text: 'd2의 폰이 불화살로 d4의 벽에 ' });
  });

  it('a floating piece is named in the air', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, d4: { color: 'white', type: 'queen' } });
    const board = [...s.board];
    board[sq('d4') + AIR] = board[sq('d4')];
    board[sq('d4')] = null;
    expect(tapToWrite({ ...s, board }, sq('d4') + AIR, '')).toEqual({ text: 'd4^의 퀸이 ' });
  });

  it('rings who and what the text names', () => {
    expect(writtenMarks('d2의 폰이 d4의 룩에게 불을 붙인다')).toEqual({ actor: sq('d2'), targets: [sq('d4')] });
    expect(writtenMarks('함성을 지른다')).toBeNull();
  });
});
