import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, parseSquare, type GameState, type Ruling } from '../engine';
import { aurasOn } from './auras';

const sq = (n: string) => parseSquare(n)!;

function tagged(effects: Ruling['effects']): GameState {
  let s: GameState = { ...createInitialState(), ap: { white: 3, black: 0 } };
  const ruling: Ruling = { interpretation: 'x', feasible: true, dc: 4, cost: 1, effects, narration: { success: 's', failure: 'f' } };
  const p = applyCommand(s, { type: 'proposeSpecial', action: 'a', ruling });
  if (!p.ok) throw new Error(p.detail);
  s = p.state;
  const r = applyCommand(s, { type: 'attemptSpecial', roll: 5 });
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

describe('auras on the board', () => {
  it('a tag with an aura wraps its piece, a rider included; plain tags do not', () => {
    const s = tagged([
      { type: 'tag', at: sq('e2'), tag: '불타는 중', turns: 2, aura: { element: 'fire', strength: 3 } },
      { type: 'tag', at: sq('d2'), tag: '겁먹음', turns: 2 },
      { type: 'board', rider: sq('c2'), carrier: sq('b1') },
      { type: 'tag', at: sq('b1'), tag: '얼어붙음', turns: 1, aura: { element: 'ice', strength: 1 } },
    ]);
    const auras = aurasOn(s.board);
    expect(auras.map((a) => [a.element, a.strength])).toEqual([
      ['ice', 1],
      ['fire', 3],
    ]);
    expect(auras[1].pieceId).toBe(s.board[sq('e2')]!.id);
  });

  it('the aura goes out with its tag', () => {
    let s = tagged([{ type: 'tag', at: sq('e2'), tag: '불타는 중', turns: 1, aura: { element: 'fire', strength: 2 } }]);
    expect(aurasOn(s.board)).toHaveLength(1);
    // White's turn ends (the special action used it), black moves, and the one-turn tag runs out.
    for (const [from, to] of [['e7', 'e6'], ['a2', 'a3'], ['a7', 'a6']] as const) {
      if (s.turn === 'white' && s.usedApThisTurn) s = (applyCommand(s, { type: 'endTurn' }) as { state: GameState }).state;
      const r = applyCommand(s, { type: 'move', from: sq(from), to: sq(to) });
      if (r.ok) s = r.state;
    }
    expect(s.board[sq('e2')]?.tags ?? []).toEqual([]);
    expect(aurasOn(s.board)).toEqual([]);
  });
});
