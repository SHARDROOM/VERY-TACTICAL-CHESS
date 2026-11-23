import { describe, expect, it } from 'vitest';
import { applyCommand, createStateFrom, wanderTargets, type Effect, type GameState } from './index';
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

  it('a gray pawn walks one square straight any way and takes only on a diagonal (사용자 요청); a wanderer never takes a king or a piece that would stand its ground', () => {
    const s = withGray(
      createStateFrom({
        d5: { color: 'white', type: 'king' },
        e4: { color: 'black', type: 'rook' },
        e5: { color: 'black', type: 'knight' },
        c3: { color: 'white', type: 'pawn' },
        e8: { color: 'black', type: 'king' },
      }),
      'd4',
      'pawn',
    );
    const shielded = [...s.board];
    shielded[sq('c3')] = { ...shielded[sq('c3')]!, tags: [{ name: '보호막', turnsLeft: null, appliedOnTurn: 1 }] };
    const t = wanderTargets(shielded, sq('d4'));
    // Straight: onto empty squares only (the rook beside it is not taken).
    expect(t).toEqual(expect.arrayContaining([sq('c4'), sq('d3')]));
    expect(t).not.toContain(sq('e4'));
    // Diagonal: only to take (the knight), never onto an empty square.
    expect(t).toContain(sq('e5'));
    expect(t).not.toContain(sq('c5'));
    expect(t).not.toContain(sq('e3'));
    // Never a king, never a shielded piece.
    expect(t).not.toContain(sq('d5'));
    expect(t).not.toContain(sq('c3'));
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

describe('chaos with the core tags', () => {
  const base = () => createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, e4: { color: 'white', type: 'pawn' } }, 'white');
  const chaos = (effects: Effect[]) => applyCommand(base(), { type: 'chaos', chaos: { title: '산적', narration: '산적이 나타났다', effects } });

  it('a bandit (a gray wanderer) comes and takes a pawn hostage: the effect names who holds it', () => {
    const r = chaos([
      { type: 'spawn', at: sq('d5'), color: 'gray', piece: 'pawn' },
      { type: 'tag', at: sq('e4'), tag: '인질', turns: 2, by: sq('d5') },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const holder = r.state.board[sq('d5')]!;
    expect(r.state.board[sq('e4')]?.tags).toEqual([expect.objectContaining({ name: '인질', holder: holder.id })]);
  });

  it('a hostage in a chaos event needs someone next to it to hold it', () => {
    expect(chaos([{ type: 'tag', at: sq('e4'), tag: '인질', turns: 2 }])).toMatchObject({ ok: false });
    expect(chaos([{ type: 'spawn', at: sq('d7'), color: 'gray', piece: 'pawn' }, { type: 'tag', at: sq('e4'), tag: '인질', turns: 2, by: sq('d7') }])).toMatchObject({ ok: false });
  });

  it('chaos may make a 행동대장, 원호 or 혼란 too', () => {
    for (const name of ['행동대장', '원호', '혼란']) expect(chaos([{ type: 'tag', at: sq('e4'), tag: name, turns: 1 }]).ok).toBe(true);
  });
});
