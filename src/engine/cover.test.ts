import { describe, expect, it } from 'vitest';
import { applyCommand, createStateFrom, isInCheck, legalTargets, squareName, type Effect, type GameState, type Ruling, type TerrainCell } from './index';
import { ok, sq } from './testUtil';

const cell = (at: string, kind: 'wall' | 'pit', cover?: TerrainCell['cover']): TerrainCell => ({ at: sq(at), kind, turnsLeft: null, owner: 'white', appliedOnTurn: 1, ...(cover && { cover }) });
const bridge = (turnsLeft: number | null = null): TerrainCell['cover'] => ({ kind: 'bridge', turnsLeft, owner: 'white', appliedOnTurn: 1 });
const ladder = (): TerrainCell['cover'] => ({ kind: 'ladder', turnsLeft: null, owner: 'white', appliedOnTurn: 1 });
const legal = (s: GameState, from: string) => legalTargets(s, sq(from)).map((t) => squareName(t.to)).sort();
const ruling = (effects: Effect[]): Ruling => ({ interpretation: 'x', feasible: true, dc: 5, cost: 1, effects, narration: { success: 's', failure: 'f' } });
const act = (state: GameState, ...effects: Effect[]) => {
  const p = applyCommand({ ...state, ap: { white: 5, black: 5 } }, { type: 'proposeSpecial', action: 'a', ruling: ruling(effects) });
  if (!p.ok) throw new Error(p.detail);
  return ok(applyCommand(p.state, { type: 'attemptSpecial', roll: 15 }));
};
const base = () => createStateFrom({ a1: { color: 'white', type: 'rook' }, e1: { color: 'white', type: 'king' }, h8: { color: 'black', type: 'king' }, c2: { color: 'white', type: 'pawn' } });

describe('bridges (다리)', () => {
  it('a bridged pit is ground: pieces cross it and stand on it', () => {
    const s = { ...base(), terrain: [cell('a3', 'pit', bridge())] };
    expect(legal(s, 'a1')).toEqual(['a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'b1', 'c1', 'd1']);
    const unbridged = { ...base(), terrain: [cell('a3', 'pit')] };
    expect(legal(unbridged, 'a1')).toEqual(['a2', 'b1', 'c1', 'd1']);
  });

  it('only over a pit; a cut bridge drops whoever stands on it, a king is pushed aside', () => {
    let s: GameState = { ...base(), terrain: [cell('a3', 'pit'), cell('d4', 'wall')] };
    expect(() => act(s, { type: 'cover', at: sq('d4'), kind: 'bridge', turns: 2 })).toThrow('구덩이');
    s = act(s, { type: 'cover', at: sq('a3'), kind: 'bridge', turns: 2 }, { type: 'move', from: sq('a1'), to: sq('a3') }).state;
    expect(s.board[sq('a3')]?.type).toBe('rook');
    const r = act(s, { type: 'clearCover', at: sq('a3') });
    expect(r.state.board[sq('a3')]).toBeNull();
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'removed', cause: 'pit', at: sq('a3') }));
    expect(r.state.captured).toEqual([expect.objectContaining({ type: 'rook', exit: 'sink' })]);

    const king = act({ ...base(), terrain: [cell('e2', 'pit', bridge())] }, { type: 'move', from: sq('e1'), to: sq('e2') }, { type: 'clearCover', at: sq('e2') });
    expect(king.events).toContainEqual(expect.objectContaining({ type: 'pushed', from: sq('e2') }));
    expect(king.state.board[sq('e2')]).toBeNull();
    expect(king.state.board.some((p) => p?.type === 'king' && p.color === 'white')).toBe(true);
  });

  it('a bridge that runs out drops whoever stands on it at the end of its maker\'s turn', () => {
    let s: GameState = { ...base(), terrain: [cell('a3', 'pit')] };
    s = act(s, { type: 'cover', at: sq('a3'), kind: 'bridge', turns: 1 }, { type: 'move', from: sq('a1'), to: sq('a3') }).state;
    s = ok(applyCommand(s, { type: 'endTurn' })).state; // white's turn it was made on: does not count
    s = ok(applyCommand({ ...s, usedApThisTurn: true }, { type: 'endTurn' })).state;
    const r = ok(applyCommand({ ...s, usedApThisTurn: true }, { type: 'endTurn' }));
    expect(r.events).toContainEqual({ type: 'coverGone', at: sq('a3'), kind: 'bridge', expired: true });
    expect(r.state.board[sq('a3')]).toBeNull();
    expect(r.state.terrain).toEqual([expect.objectContaining({ at: sq('a3'), kind: 'pit' })]);
  });
});

describe('ladders (사다리)', () => {
  it('a laddered wall can be crossed but not stood on, by sliders and pawns, and checks go over it', () => {
    const s = { ...base(), terrain: [cell('a3', 'wall', ladder()), cell('c3', 'wall', ladder())] };
    expect(legal(s, 'a1')).toEqual(['a2', 'a4', 'a5', 'a6', 'a7', 'a8', 'b1', 'c1', 'd1']);
    expect(legal(s, 'c2')).toEqual(['c4']);
    const check = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'rook' }, a8: { color: 'black', type: 'king' } });
    expect(isInCheck(check.board, 'white', [cell('e4', 'wall')])).toBe(false);
    expect(isInCheck(check.board, 'white', [cell('e4', 'wall', ladder())])).toBe(true);
  });

  it('only on a wall; nothing lands on it', () => {
    const s: GameState = { ...base(), terrain: [cell('a3', 'pit'), cell('d4', 'wall')] };
    expect(() => act(s, { type: 'cover', at: sq('a3'), kind: 'ladder', turns: 2 })).toThrow('벽');
    const laddered = act(s, { type: 'cover', at: sq('d4'), kind: 'ladder', turns: 0 }).state;
    expect(laddered.terrain?.find((c) => c.at === sq('d4'))?.cover).toEqual({ kind: 'ladder', turnsLeft: null, owner: 'white', appliedOnTurn: 1 });
    expect(() => act(laddered, { type: 'spawn', at: sq('d4'), color: 'white', piece: 'pawn' })).toThrow('벽');
  });
});
