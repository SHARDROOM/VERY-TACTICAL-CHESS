import { describe, expect, it } from 'vitest';
import { applyCommand, createStateFrom, rollModifiers, type GameState, type Ruling } from './index';
import { ok, okMove, passTurn, sq } from './testUtil';

/** Kings, a white rook a1 and a black knight a5: the rook takes it. */
function fallen(): GameState {
  const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, a1: { color: 'white', type: 'rook' }, a5: { color: 'black', type: 'knight' }, h7: { color: 'black', type: 'pawn' } }, 'white');
  return okMove(s, 'a1', 'a5').state;
}

const revive = (over: Partial<Ruling> = {}): Ruling => ({
  interpretation: '쓰러진 나이트를 되살린다',
  actor: sq('e8'),
  means: 'magic',
  feasible: true,
  dc: 9,
  cost: 1,
  effects: [{ type: 'revive', at: sq('a6'), color: 'black', piece: 'knight' }],
  narration: { success: 's', failure: 'f' },
  ...over,
});

describe('remains (유해)', () => {
  it('a piece taken leaves its remains where it fell, for three of its owner\'s turns', () => {
    let s = fallen();
    const id = s.captured.at(-1)!.id;
    expect(s.remains).toEqual([{ pieceId: id, color: 'black', type: 'knight', at: sq('a5'), turnsLeft: 3, appliedOnTurn: 1 }]);
    // White's turn ending does not count; black's do.
    s = okMove(s, 'h7', 'h6').state; // black's turn 2 ends
    expect(s.remains?.[0].turnsLeft).toBe(2);
    s = passTurn(s); // white
    s = passTurn(s); // black
    expect(s.remains?.[0].turnsLeft).toBe(1);
    s = passTurn(s);
    s = passTurn(s);
    expect(s.remains ?? []).toEqual([]);
  });

  it('reviving it on its remains adds +2 and brings back that very piece; elsewhere no bonus', () => {
    // The rook moves off a5 so the square is free again.
    let s = okMove(fallen(), 'h7', 'h6').state;
    s = okMove(s, 'a5', 'b5').state;
    const id = s.captured.find((c) => c.type === 'knight')!.id;
    // (The king on e8 reaches 4 squares by magic: -1 for distance as well.)
    expect(rollModifiers(s.board, revive({ effects: [{ type: 'revive', at: sq('a5'), color: 'black', piece: 'knight' }] }), 'black', s.remains)).toEqual([
      { kind: 'remains', label: '유해 나이트 a5', value: 2 },
      { kind: 'distance', label: '4칸 마법', value: -1 },
    ]);
    expect(rollModifiers(s.board, revive(), 'black', s.remains).filter((m) => m.kind === 'remains')).toEqual([]);
    s = { ...s, ap: { ...s.ap, black: 3 } };
    const p = ok(applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling: revive({ effects: [{ type: 'revive', at: sq('a5'), color: 'black', piece: 'knight' }] }) })).state;
    const r = ok(applyCommand(p, { type: 'attemptSpecial', roll: 8 }));
    expect(r.events.find((e) => e.type === 'specialResolved')).toMatchObject({ outcome: 'success', bonus: 1 });
    expect(r.state.board[sq('a5')]).toMatchObject({ id, type: 'knight', color: 'black' });
    expect(r.state.remains ?? []).toEqual([]);
  });

  it('a piece given up, burnt or removed leaves remains too; a king does not', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, d4: { color: 'white', type: 'knight' }, e3: { color: 'white', type: 'pawn' }, d6: { color: 'black', type: 'pawn' } }, 'white');
    const r = ok(applyCommand({ ...s, ap: { ...s.ap, white: 5 } }, {
      type: 'proposeSpecial',
      action: 'x',
      ruling: { interpretation: 'x', actor: sq('d4'), means: 'magic', feasible: true, dc: 5, cost: 1, effects: [{ type: 'remove', at: sq('d6') }], sacrifice: [sq('e3')], narration: { success: 's', failure: 'f' } },
    }));
    const done = ok(applyCommand(r.state, { type: 'attemptSpecial', roll: 8 }));
    expect(done.state.remains?.map((m) => [m.type, m.at])).toEqual([
      ['pawn', sq('e3')],
      ['pawn', sq('d6')],
    ]);
  });
});
