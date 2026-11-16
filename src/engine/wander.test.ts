import { describe, expect, it } from 'vitest';
import { applyCommand, createStateFrom, wanderTargets, type GameState } from './index';
import { sq } from './testUtil';

const withGray = (s: GameState, at: string, type: 'pawn' | 'knight' | 'rook', tags: { name: string; turnsLeft: number | null; appliedOnTurn: number; clash?: number }[] = []): GameState => {
  const b = [...s.board];
  b[sq(at)] = { id: `gray-${at}`, color: 'gray', type, tags };
  return { ...s, board: b };
};

describe('chaos\'s gray wanderers', () => {
  it('only a chaos event brings one onto the board', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' } }, 'white', { ap: { white: 5, black: 5, red: 0, gray: 0 } });
    const chaos = applyCommand(s, { type: 'chaos', chaos: { title: '떠돌이 상인', narration: '상인이 지나간다', effects: [{ type: 'spawn', at: sq('d4'), color: 'gray', piece: 'pawn' }, { type: 'tag', at: sq('d4'), tag: '떠돌이 상인', turns: 0 }] } });
    if (!chaos.ok) throw new Error(chaos.detail);
    expect(chaos.state.board[sq('d4')]).toMatchObject({ color: 'gray', type: 'pawn', tags: [expect.objectContaining({ name: '떠돌이 상인' })] });
    const ruling = { interpretation: 'x', actor: sq('e1'), means: 'magic' as const, feasible: true, dc: 5, cost: 1, effects: [{ type: 'spawn' as const, at: sq('d4'), color: 'gray' as const, piece: 'pawn' as const }], narration: { success: 's', failure: 'f' } };
    expect(applyCommand(s, { type: 'proposeSpecial', action: 'a', ruling })).toMatchObject({ ok: false, reason: 'invalidRuling' });
  });

  it('a gray pawn steps one square any way; a wanderer never takes a king or a piece that would stand its ground', () => {
    const s = withGray(
      createStateFrom({ d5: { color: 'white', type: 'king' }, e4: { color: 'black', type: 'rook' }, c4: { color: 'white', type: 'pawn' }, e8: { color: 'black', type: 'king' } }),
      'd4',
      'pawn',
    );
    const shielded = [...s.board];
    shielded[sq('c4')] = { ...shielded[sq('c4')]!, tags: [{ name: '보호막', turnsLeft: null, appliedOnTurn: 1 }] };
    const t = wanderTargets(shielded, sq('d4'));
    expect(t).toContain(sq('e4'));
    expect(t).toContain(sq('d3'));
    expect(t).not.toContain(sq('d5'));
    expect(t).not.toContain(sq('c4'));
  });

  it('moves as told, takes what it lands on, and gives no check', () => {
    const s = withGray(createStateFrom({ e1: { color: 'white', type: 'king' }, a5: { color: 'black', type: 'pawn' }, e8: { color: 'black', type: 'king' } }), 'a1', 'rook');
    const r = applyCommand(s, { type: 'wander', moves: [{ from: sq('a1'), to: sq('a5') }] });
    if (!r.ok) throw new Error(r.reason);
    expect(r.events[0]).toEqual({ type: 'wandered', pieceId: 'gray-a1', from: sq('a1'), to: sq('a5') });
    expect(r.state.board[sq('a5')]).toMatchObject({ color: 'gray', type: 'rook' });
    expect(r.state.captured).toEqual([expect.objectContaining({ color: 'black', type: 'pawn' })]);
    expect(r.state.turn).toBe('white');
    // On a5 it eyes the e8... no: it eyes a8/e5 lines; put it in line with a king: no check is given.
    const r2 = applyCommand(r.state, { type: 'wander', moves: [{ from: sq('a5'), to: sq('a8') }] });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.events.some((e) => e.type === 'check')).toBe(false);
    // Not its move, or not a wanderer: refused.
    expect(applyCommand(r.state, { type: 'wander', moves: [{ from: sq('a5'), to: sq('b6') }] })).toMatchObject({ ok: false, reason: 'illegalWander' });
    expect(applyCommand(r.state, { type: 'wander', moves: [{ from: sq('e1'), to: sq('e2') }] })).toMatchObject({ ok: false, reason: 'illegalWander' });
  });

  it('a player can take it like any piece', () => {
    const s = withGray(createStateFrom({ e1: { color: 'white', type: 'king' }, a1: { color: 'white', type: 'rook' }, e8: { color: 'black', type: 'king' } }), 'a6', 'knight');
    const r = applyCommand(s, { type: 'move', from: sq('a1'), to: sq('a6') });
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.captured).toEqual([expect.objectContaining({ color: 'gray', type: 'knight' })]);
  });
});
