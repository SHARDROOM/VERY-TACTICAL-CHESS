import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, type GameState, type Ruling } from './index';
import { ok, sq } from './testUtil';

const ruling = (over: Partial<Ruling> = {}): Ruling => ({
  interpretation: '나이트가 투석기를 탄다',
  feasible: true,
  dc: 4,
  cost: 1,
  effects: [{ type: 'move', from: sq('b1'), to: sq('c4') }],
  critSuccessEffects: [{ type: 'move', from: sq('b1'), to: sq('d5') }],
  critFailureEffects: [{ type: 'tag', at: sq('b1'), tag: '기절', turns: 1 }],
  narration: { success: '성공', failure: '실패', critSuccess: '대성공', critFailure: '대실패' },
  ...over,
});
const rich = (): GameState => ({ ...createInitialState(), ap: { white: 5, black: 5 } });
const run = (r: Ruling, roll: number, state = rich()) => {
  const p = ok(applyCommand(state, { type: 'proposeSpecial', action: 'b1 나이트 발사', ruling: r }));
  return ok(applyCommand(p.state, { type: 'attemptSpecial', roll }));
};

describe('critical results', () => {
  it('6 is a critical success: crit effects replace the normal ones', () => {
    const r = run(ruling(), 6);
    expect(r.events[0]).toMatchObject({ type: 'specialResolved', outcome: 'critSuccess', success: true, narration: '대성공' });
    expect(r.state.board[sq('d5')]).toMatchObject({ type: 'knight' });
    expect(r.state.board[sq('c4')]).toBeNull();
  });

  it('6 succeeds even at the hardest DC', () => {
    const r = run(ruling({ dc: 6 }), 6);
    expect(r.events[0]).toMatchObject({ outcome: 'critSuccess', success: true });
  });

  it('6 falls back to the normal effects and narration when no crit effects are given', () => {
    const r = run(ruling({ critSuccessEffects: [], narration: { success: '성공', failure: '실패' } }), 6);
    expect(r.state.board[sq('c4')]).toMatchObject({ type: 'knight' });
    expect(r.events[0]).toMatchObject({ narration: '성공' });
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
    const bad2 = ruling({ critSuccessEffects: [{ type: 'move', from: sq('e4'), to: sq('e5') }] });
    expect(applyCommand(rich(), { type: 'proposeSpecial', action: 'x', ruling: bad2 })).toMatchObject({
      ok: false,
      detail: expect.stringContaining('대성공'),
    });
  });
});

describe('precedents', () => {
  it('records every attempted special action with its ruling and result', () => {
    let s = run(ruling(), 5).state;
    // b1 is empty now, so the second action uses the other knight.
    const g1 = [{ type: 'move' as const, from: sq('g1'), to: sq('f3') }];
    s = run(ruling({ dc: 5, interpretation: '두 번째', effects: g1, critSuccessEffects: [], critFailureEffects: [] }), 3, s).state;
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
