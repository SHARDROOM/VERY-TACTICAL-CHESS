import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, createStateFrom, type Effect, type GameState, type Ruling } from './index';
import { ok, okMove, play, sq } from './testUtil';

const act = (s: GameState, effects: Effect[]) => {
  const ruling: Ruling = { interpretation: 'x', feasible: true, dc: 10, cost: 1, effects, narration: { success: 's', failure: 'f' } };
  const p = ok(applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling }));
  return ok(applyCommand(p.state, { type: 'attemptSpecial', roll: 20 })).state;
};

describe('captured pieces', () => {
  it('a new game has none', () => {
    expect(createInitialState().captured).toEqual([]);
  });

  it('normal captures and en passant are recorded in order, as plain pieces', () => {
    const s = play(createInitialState(), 'e2e4 d7d5 e4d5 e7e5 d5e6');
    expect(s.captured.map((p) => `${p.color} ${p.type}`)).toEqual(['black pawn', 'black pawn']);
  });

  it('special-action removals and effect captures are recorded; a carrier and its rider both go', () => {
    let s: GameState = { ...createInitialState(), ap: { white: 5, black: 5 } };
    s = act(s, [{ type: 'board', rider: sq('a2'), carrier: sq('b1') }]);
    s = act(s, [{ type: 'tag', at: sq('b1'), tag: '불타는 중', turns: 0 }]);
    s = act(s, [{ type: 'remove', at: sq('b1') }]);
    expect(s.captured).toEqual([
      { id: expect.stringContaining('knight'), color: 'white', type: 'knight' },
      { id: expect.stringContaining('pawn'), color: 'white', type: 'pawn' },
    ]);
    s = act(s, [{ type: 'move', from: sq('d1'), to: sq('d7') }]);
    expect(s.captured.at(-1)).toMatchObject({ color: 'black', type: 'pawn' });
  });

  it('a shield that absorbs a capture records nothing; capturing the king records it', () => {
    let s = createStateFrom(
      { e1: { color: 'white', type: 'king' }, e4: { color: 'white', type: 'rook' }, e8: { color: 'black', type: 'king' } },
      'black',
      { ap: { white: 0, black: 5 } },
    );
    s = act(s, [{ type: 'tag', at: sq('e8'), tag: '보호막', turns: 0 }]);
    s = ok(applyCommand(s, { type: 'endTurn' })).state;
    s = okMove(s, 'e4', 'e8').state;
    expect(s.captured).toEqual([]);
    s = okMove(ok(applyCommand(s, { type: 'endTurn' })).state, 'e4', 'e8').state;
    expect(s.captured).toEqual([expect.objectContaining({ type: 'king', color: 'black' })]);
  });
});
