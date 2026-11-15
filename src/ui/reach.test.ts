import { describe, expect, it } from 'vitest';
import { createInitialState, parseSquare, type Ruling } from '../engine';
import { reachOf } from './reach';

const sq = (n: string) => parseSquare(n)!;
const base: Ruling = { interpretation: 'x', feasible: true, dc: 10, cost: 1, effects: [], narration: { success: 's', failure: 'f' } };

describe('who acts on what, for the ruling sheet', () => {
  const board = createInitialState().board;

  it('names the actor, the means and the targets with their distance, nearest first', () => {
    const r = reachOf({ ...base, actor: sq('g1'), means: 'ranged', effects: [{ type: 'remove', at: sq('g8') }, { type: 'tag', at: sq('h3'), tag: '기절', turns: 1 }] }, board);
    expect(r).toMatchObject({ actor: sq('g1'), piece: { type: 'knight' }, means: '원거리', targets: [{ at: sq('h3'), d: 2 }, { at: sq('g8'), d: 7 }] });
  });

  it('for its own trip, where it goes; nothing for a ruling without an actor or an infeasible one', () => {
    expect(reachOf({ ...base, actor: sq('b1'), means: 'move', effects: [{ type: 'move', from: sq('b1'), to: sq('e5') }] }, board)?.targets).toEqual([{ at: sq('e5'), d: 4 }]);
    expect(reachOf(base, board)).toBeNull();
    expect(reachOf({ ...base, feasible: false, actor: null }, board)).toBeNull();
  });
});
