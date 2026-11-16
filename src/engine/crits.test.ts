import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, type GameState, type Ruling } from './index';
import { ok, sq } from './testUtil';

const ruling = (over: Partial<Ruling> = {}): Ruling => ({
  interpretation: '나이트가 투석기를 탄다',
  feasible: true,
  dc: 4,
  cost: 1,
  effects: [{ type: 'move', from: sq('b1'), to: sq('c4') }],
  critFailureEffects: [{ type: 'tag', at: sq('b1'), tag: '기절', turns: 1 }],
  narration: { success: '성공', failure: '실패', critFailure: '대실패' },
  ...over,
});
const rich = (): GameState => ({ ...createInitialState(), ap: { white: 5, black: 5 } });
const run = (r: Ruling, roll: number, state = rich()) => {
  const p = ok(applyCommand(state, { type: 'proposeSpecial', action: 'b1 나이트 발사', ruling: r }));
  return ok(applyCommand(p.state, { type: 'attemptSpecial', roll }));
};

describe('critical results', () => {
  it('there is no critical success: a 6 is a plain success with the usual effects', () => {
    const r = run(ruling(), 6);
    expect(r.events[0]).toMatchObject({ type: 'specialResolved', outcome: 'success', success: true, narration: '성공' });
    expect(r.state.board[sq('c4')]).toMatchObject({ type: 'knight' });
  });

  it('at the hardest DC only a 6 succeeds', () => {
    expect(run(ruling({ dc: 6 }), 6).events[0]).toMatchObject({ outcome: 'success', success: true });
    expect(run(ruling({ dc: 6 }), 5).events[0]).toMatchObject({ outcome: 'failure', success: false });
  });

  it('1 is a critical failure: the backfire applies', () => {
    const r = run(ruling({ dc: 2 }), 1);
    expect(r.events[0]).toMatchObject({ outcome: 'critFailure', success: false, narration: '대실패' });
    expect(r.state.board[sq('b1')]?.tags).toEqual([{ name: '기절', turnsLeft: 1, appliedOnTurn: 1 }]);
  });

  it('a normal failure (2..DC-1) only costs AP', () => {
    const before = rich();
    const r = run(ruling(), 3, before);
    expect(r.events).toEqual([expect.objectContaining({ outcome: 'failure', narration: '실패' })]);
    expect(r.state.board).toEqual(before.board);
  });

  it('a 1 with no backfire listed does nothing beyond the AP cost', () => {
    const before = rich();
    const r = run(ruling({ critFailureEffects: [] }), 1, before);
    expect(r.state.board).toEqual(before.board);
  });

  it('crit effect lists are validated on proposal like the normal list', () => {
    const bad = ruling({ critFailureEffects: [{ type: 'remove', at: sq('e1') }] });
    expect(applyCommand(rich(), { type: 'proposeSpecial', action: 'x', ruling: bad })).toMatchObject({
      ok: false,
      reason: 'invalidRuling',
      detail: expect.stringContaining('대실패'),
    });
  });
});

describe('precedents', () => {
  it('records every attempted special action with its ruling and result', () => {
    let s = run(ruling(), 5).state;
    // b1 is empty now, so the second action uses the other knight.
    const g1 = [{ type: 'move' as const, from: sq('g1'), to: sq('f3') }];
    s = run(ruling({ dc: 5, interpretation: '두 번째', effects: g1, critFailureEffects: [] }), 3, s).state;
    expect(s.precedents).toEqual([
      { turnNumber: 1, color: 'white', action: 'b1 나이트 발사', interpretation: '나이트가 투석기를 탄다', dc: 4, cost: 1, roll: 5, outcome: 'success' },
      { turnNumber: 1, color: 'white', action: 'b1 나이트 발사', interpretation: '두 번째', dc: 5, cost: 1, roll: 3, outcome: 'failure' },
    ]);
  });

  it('cancelled proposals are not precedents', () => {
    const p = ok(applyCommand(rich(), { type: 'proposeSpecial', action: 'x', ruling: ruling() }));
    const c = ok(applyCommand(p.state, { type: 'cancelSpecial' }));
    expect(c.state.precedents).toEqual([]);
  });

  it('a new game starts with no precedents', () => {
    expect(createInitialState().precedents).toEqual([]);
  });
});
