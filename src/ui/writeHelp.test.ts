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
    // Two things acted on: joined by 와/과, the last keeps its particle (사용자 요청).
    expect(taps(start, 'd1', 'b1', 'g8')).toBe('d1의 퀸이 b1의 나이트와 g8의 나이트에게 ');
    expect(taps(start, 'd1', 'd7', 'e7', 'f7')).toBe('d1의 퀸이 d7의 폰과 e7의 폰과 f7의 폰에게 ');
    expect(taps(start, 'd2', 'd4', 'e5')).toBe('d2의 폰이 d4와 e5에 ');
    expect(taps(start, 'd2', 'd7', 'd4')).toBe('d2의 폰이 d7의 폰과 d4에 ');
  });

  it('tapping a square again takes it out (and the joining follows)', () => {
    expect(taps(start, 'd1', 'b1', 'g8', 'g8')).toBe('d1의 퀸이 b1의 나이트에게 ');
    expect(taps(start, 'd1', 'b1', 'g8', 'b1')).toBe('d1의 퀸이 g8의 나이트에게 ');
    expect(taps(start, 'd1', 'd7', 'd7')).toBe('d1의 퀸이 ');
    // Who acts, too: then the next own piece tapped acts.
    expect(taps(start, 'd1', 'd7', 'd1')).toBe('d7의 폰에게 ');
    expect(taps(start, 'd1', 'd7', 'd1', 'b1')).toBe('d7의 폰에게 b1의 나이트가 ');
    expect(taps(start, 'd2', 'd2')).toBe('');
  });

  it('what the player typed between stays, and is not joined across', () => {
    const r = tapToWrite(start, sq('g8'), 'd1의 퀸이 b1의 나이트에게 불을 쏘고 ');
    expect(r).toEqual({ text: 'd1의 퀸이 b1의 나이트에게 불을 쏘고 g8의 나이트에게 ' });
    expect(tapToWrite(start, sq('b1'), 'd1의 퀸이 b1의 나이트에게 불을 쏘고 g8의 나이트에게 ')).toEqual({ text: 'd1의 퀸이 불을 쏘고 g8의 나이트에게 ' });
  });

  it('any order: what it is done to may come first, and the own piece tapped then is who does it', () => {
    expect(taps(start, 'd7')).toBe('d7의 폰에게 ');
    expect(taps(start, 'd7', 'd2')).toBe('d7의 폰에게 d2의 폰이 ');
    expect(taps(start, 'd4', 'b1')).toBe('d4에 b1의 나이트가 ');
    // Once someone acts, another own piece is acted on.
    expect(taps(start, 'd2', 'e1')).toBe('d2의 폰이 e1의 킹에게 ');
  });

  it('a stack is tapped by its carrier (whoever rides it goes along)', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, b1: { color: 'white', type: 'knight' } });
    const board = [...s.board];
    board[sq('b1')] = { ...board[sq('b1')]!, rider: { id: 'r', color: 'white', type: 'pawn', tags: [{ name: '탑승', turnsLeft: null, appliedOnTurn: 1 }] } };
    expect(tapToWrite({ ...s, board }, sq('b1'), '')).toEqual({ text: 'b1의 나이트가 ' });
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
    expect(writtenMarks('d7의 폰에게 d2의 폰이 불을 붙인다')).toEqual({ actor: sq('d2'), targets: [sq('d7')] });
    expect(writtenMarks('d7의 폰에게 ')).toEqual({ actor: -1, targets: [sq('d7')] });
    expect(writtenMarks('함성을 지른다')).toBeNull();
  });
});
