import { describe, expect, it } from 'vitest';
import { AIR, applyCommand, capturedAfter, createInitialState, createStateFrom, type Effect, type GameState, type Piece, type Ruling } from './index';
import { ok, okMove, passTurn, play, sq } from './testUtil';

const act = (s: GameState, effects: Effect[]) => {
  const ruling: Ruling = { interpretation: 'x', feasible: true, dc: 4, cost: 1, effects, narration: { success: 's', failure: 'f' } };
  const p = ok(applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling }));
  return ok(applyCommand(p.state, { type: 'attemptSpecial', roll: 6 })).state;
};

describe('captured pieces', () => {
  it('a new game has none', () => {
    expect(createInitialState().captured).toEqual([]);
  });

  it('normal captures and en passant are recorded in order, as plain pieces', () => {
    const s = play(createInitialState(), 'e2e4 d7d5 e4d5 e7e5 d5e6');
    expect(s.captured.map((p) => `${p.color} ${p.type}`)).toEqual(['black pawn', 'black pawn']);
  });

  it('special-action removals and effect captures are recorded; a rider is thrown off its carrier, not taken with it', () => {
    let s: GameState = { ...createInitialState(), ap: { white: 5, black: 5, red: 0 } };
    s = act(s, [{ type: 'board', rider: sq('a2'), carrier: sq('b1') }]);
    s = act(s, [{ type: 'tag', at: sq('b1'), tag: '불타는 중', turns: 0 }]);
    s = act(s, [{ type: 'remove', at: sq('b1') }]);
    expect(s.captured).toEqual([{ id: expect.stringContaining('knight'), color: 'white', type: 'knight' }]);
    expect(s.falling).toEqual([{ piece: expect.objectContaining({ type: 'pawn', tags: [] }), from: sq('b1'), rodeOn: 'knight' }]);
    // Without physics it comes down a little way toward the middle: on the free b1.
    s = ok(applyCommand(s, { type: 'land', seed: 1, landings: [] })).state;
    expect(s.board[sq('b1')]).toMatchObject({ type: 'pawn', color: 'white' });
    s = act(s, [{ type: 'move', from: sq('d1'), to: sq('d7') }]);
    expect(s.captured.at(-1)).toMatchObject({ color: 'black', type: 'pawn' });
  });

  it('a shield that absorbs a capture records nothing; capturing the king records it', () => {
    let s = createStateFrom(
      { e1: { color: 'white', type: 'king' }, e4: { color: 'white', type: 'rook' }, e8: { color: 'black', type: 'king' } },
      'black',
      { ap: { white: 0, black: 5, red: 0 } },
    );
    s = act(s, [{ type: 'tag', at: sq('e8'), tag: '보호막', turns: 0 }]);
    s = passTurn(s);
    s = okMove(s, 'e4', 'e8', { clashRolls: [6, 6, 1, 1] }).state;
    expect(s.captured).toEqual([]);
    s = okMove(passTurn(s), 'e4', 'e8').state;
    expect(s.captured).toEqual([expect.objectContaining({ type: 'king', color: 'black' })]);
  });

  it('a shattered piece keeps the ground square its shards lie on (below it if it was in the air, beside the move for en passant)', () => {
    const pawn: Piece = { id: 'p', color: 'black', type: 'pawn' };
    expect(capturedAfter([], [{ type: 'removed', piece: pawn, at: sq('d5'), exit: 'shatter' }])).toEqual([{ ...pawn, exit: 'shatter', at: sq('d5') }]);
    expect(capturedAfter([], [{ type: 'removed', piece: pawn, at: sq('d5') + AIR, exit: 'shatter' }])[0].at).toBe(sq('d5'));
    const ep = capturedAfter([], [{ type: 'moved', pieceId: 'w', from: sq('e5'), to: sq('d6'), captured: pawn, special: { kind: 'enPassant' }, capturedExit: 'shatter' }]);
    expect(ep[0].at).toBe(sq('d5'));
    // Any other way off the board leaves nothing behind.
    expect(capturedAfter([], [{ type: 'removed', piece: pawn, at: sq('d5'), exit: 'vanish' }])[0].at).toBeUndefined();
  });
});

describe('riders thrown off', () => {
  it('a carrier that burns up throws its rider off (it is not burnt with it)', async () => {
    const { tickTags } = await import('./tags');
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, d4: { color: 'white', type: 'knight' } });
    const board = [...s.board];
    board[sq('d4')] = { ...board[sq('d4')]!, tags: [{ name: '화상', turnsLeft: 1, appliedOnTurn: 0 }], rider: { id: 'r', color: 'white', type: 'pawn', tags: [{ name: '탑승', turnsLeft: null, appliedOnTurn: 0 }] } };
    const r = tickTags(board, 'white', 1);
    expect(r.board[sq('d4')]).toBeNull();
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'removed', cause: 'burn' }));
    expect(r.events).toContainEqual({ type: 'fallStarted', pieceId: 'r', at: sq('d4') });
    expect(r.falling).toEqual([{ piece: { id: 'r', color: 'white', type: 'pawn', tags: [] }, from: sq('d4'), rodeOn: 'knight' }]);
  });
});
