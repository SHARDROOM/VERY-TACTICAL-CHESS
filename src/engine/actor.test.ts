import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, distance, type Effect, type GameState, type Means, type Ruling } from './index';
import { ok, sq } from './testUtil';

const ruling = (actor: string | null, means: Means, effects: Effect[]): Ruling => ({
  interpretation: 'x',
  feasible: true,
  dc: 4,
  cost: 1,
  actor: actor === null ? null : sq(actor),
  means,
  effects,
  narration: { success: 's', failure: 'f' },
});
const propose = (state: GameState, r: Ruling) => applyCommand({ ...state, ap: { white: 5, black: 5, red: 0 } }, { type: 'proposeSpecial', action: 'a', ruling: r });
const problem = (state: GameState, r: Ruling) => {
  const res = propose(state, r);
  expect(res).toMatchObject({ ok: false, reason: 'invalidRuling' });
  return res.ok ? '' : res.detail ?? '';
};
const burn = (at: string): Effect => ({ type: 'tag', at: sq(at), tag: '화상', turns: 3 });

/** White pawns on e6 and e2, black pawns on e7 and d7 (the rest of the start position otherwise). */
function board(): GameState {
  const s = createInitialState();
  const b = [...s.board];
  b[sq('e6')] = b[sq('e2')];
  b[sq('e2')] = { id: 'w-e2', color: 'white', type: 'pawn' };
  return { ...s, board: b };
}

describe('who does it (주체)', () => {
  it('distance is in king steps', () => {
    expect(distance(sq('e6'), sq('e7'))).toBe(1);
    expect(distance(sq('e6'), sq('d7'))).toBe(1);
    expect(distance(sq('b1'), sq('g8'))).toBe(7);
  });

  it('a declaration with nobody doing it is refused', () => {
    expect(problem(board(), ruling(null, 'touch', [burn('e7')]))).toContain('주체');
  });

  it('the actor must be the declarer\'s own piece, and awake', () => {
    expect(problem(board(), ruling('e7', 'touch', [burn('d7')]))).toContain('백 기물이 없음');
    expect(problem(board(), ruling('e4', 'magic', [burn('e7')]))).toContain('백 기물이 없음');
    const s = board();
    const b = [...s.board];
    b[sq('e6')] = { ...b[sq('e6')]!, tags: [{ name: '기절', turnsLeft: 1, appliedOnTurn: 1 }] };
    expect(problem({ ...s, board: b }, ruling('e6', 'touch', [burn('e7')]))).toContain('기절');
  });

  it('a touch reaches the next square only', () => {
    ok(propose(board(), ruling('e6', 'touch', [burn('e7')])));
    ok(propose(board(), ruling('e6', 'touch', [burn('d7')])));
    expect(problem(board(), ruling('e2', 'touch', [burn('e7')]))).toContain('5칸');
  });

  it('a touch counts from where the actor stands when it acts (it may step up first)', () => {
    ok(propose(board(), ruling('e2', 'touch', [{ type: 'move', from: sq('e2'), to: sq('d6') }, burn('c7')])));
    // Not before it gets there.
    expect(problem(board(), ruling('e2', 'touch', [burn('c7'), { type: 'move', from: sq('e2'), to: sq('d6') }]))).toContain('효과 1');
  });

  it('arrows, spells and its own trips reach anywhere (how likely is the GM\'s call)', () => {
    for (const means of ['ranged', 'magic'] as const) ok(propose(board(), ruling('e2', means, [burn('e7')])));
    ok(propose(board(), ruling('b1', 'move', [{ type: 'move', from: sq('b1'), to: sq('e5') }])));
  });

  it('rulings from before the rule (no actor at all) still work', () => {
    const r = ruling('e6', 'touch', [burn('b7')]);
    delete r.actor;
    ok(propose(board(), r));
  });
});
