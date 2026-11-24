import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, createStateFrom, type GameState, type Precedent, type Ruling, type Tag } from './index';
import { highlights, successChance } from './highlights';
import { ok, okMove, play, sq } from './testUtil';

/* 명장면 (사용자 요청): the miracle, the heartbreak and the MVP of a game, from what it kept. */

const tag = (name: string, clash?: number): Tag => ({ name, turnsLeft: null, appliedOnTurn: 1, ...(clash && { clash }) });

describe('the chance a special action had', () => {
  it('two dice plus the bonus against the DC; 1·1 always fails', () => {
    expect(successChance(7)).toBeCloseTo(21 / 36);
    expect(successChance(12)).toBeCloseTo(1 / 36);
    expect(successChance(3)).toBeCloseTo(35 / 36);
    expect(successChance(3, 5)).toBeCloseTo(35 / 36);
    expect(successChance(10, -2)).toBeCloseTo(1 / 36);
  });
});

describe('who took what', () => {
  it('a capture by a move counts for the piece that made it', () => {
    const s = play(createInitialState(), 'e2e4 d7d5 e4d5');
    const pawn = s.board[sq('d5')]!;
    expect(s.takes?.[pawn.id]).toEqual({ color: 'white', type: 'pawn', n: 1 });
  });

  it('a defender that wins a clash took the attacker', () => {
    const base = createStateFrom(
      { e1: { color: 'white', type: 'king' }, d4: { color: 'white', type: 'rook' }, d7: { color: 'black', type: 'knight' }, h8: { color: 'black', type: 'king' } },
      'white',
    );
    const b = [...base.board];
    b[sq('d7')] = { ...b[sq('d7')]!, tags: [tag('검술', 1.5)] };
    const knight = b[sq('d7')]!;
    const r = okMove({ ...base, board: b }, 'd4', 'd7', { clashRolls: [1, 1, 3, 3] });
    expect(r.state.takes?.[knight.id]).toEqual({ color: 'black', type: 'knight', n: 1 });
  });

  it('a special action that removes a piece counts for its actor', () => {
    const s = play(createInitialState(), 'e2e4 e7e5');
    const ruling: Ruling = { interpretation: 'x', feasible: true, dc: 4, cost: 1, actor: sq('e4'), means: 'ranged', effects: [{ type: 'remove', at: sq('d7') }], narration: { success: 's', failure: 'f' } };
    const p = ok(applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling }));
    const done = ok(applyCommand(p.state, { type: 'attemptSpecial', roll: 8 })).state;
    expect(done.takes?.[s.board[sq('e4')]!.id]).toEqual({ color: 'white', type: 'pawn', n: 1 });
  });
});

const prec = (p: Partial<Precedent>): Precedent => ({ turnNumber: 1, color: 'white', action: 'x', interpretation: 'x', dc: 7, cost: 1, roll: 7, outcome: 'success', ...p });

describe('the highlights', () => {
  it('the miracle is the least likely success; the heartbreak a 1·1 that was likely, else the costliest failure; the MVP took the most', () => {
    const s: GameState = {
      ...createInitialState(),
      precedents: [
        prec({ turnNumber: 3, action: '쉬운 일', dc: 5, roll: 9 }),
        prec({ turnNumber: 5, color: 'black', action: '말도 안 되는 저격', dc: 11, roll: 11 }),
        prec({ turnNumber: 7, action: '돌진', dc: 10, roll: 9, bonus: 2 }),
        prec({ turnNumber: 9, color: 'black', action: '쉬운 다리', dc: 4, roll: 2, outcome: 'critFailure' }),
        prec({ turnNumber: 11, action: '거듭된 실패', dc: 8, cost: 2, roll: 5, outcome: 'failure', rerolls: 2 }),
      ],
      takes: { a: { color: 'white', type: 'knight', n: 2 }, b: { color: 'black', type: 'queen', n: 3 }, g: { color: 'gray', type: 'pawn', n: 5 } },
    };
    const h = highlights(s);
    expect(h.miracle).toMatchObject({ turnNumber: 5, color: 'black', action: '말도 안 되는 저격' });
    expect(h.miracle!.chance).toBeCloseTo(3 / 36);
    expect(h.heartbreak).toMatchObject({ turnNumber: 9, fumble: true });
    expect(h.heartbreak!.chance).toBeCloseTo(33 / 36);
    // Gray wanderers are no one's: the MVP is a side's piece.
    expect(h.mvp).toEqual({ id: 'b', color: 'black', type: 'queen', n: 3, alive: false });
  });

  it('without a 1·1, the failure that cost the most AP; a likely success is no miracle; nothing taken, no MVP', () => {
    const s: GameState = {
      ...createInitialState(),
      precedents: [
        prec({ turnNumber: 2, dc: 5, roll: 9 }),
        prec({ turnNumber: 4, action: '한 번 실패', dc: 9, roll: 4, outcome: 'failure' }),
        prec({ turnNumber: 6, action: '세 번 실패', dc: 9, cost: 1, roll: 6, outcome: 'failure', rerolls: 2 }),
      ],
    };
    const h = highlights(s);
    expect(h.miracle).toBeUndefined();
    expect(h.heartbreak).toMatchObject({ turnNumber: 6, fumble: false, spent: 3 });
    expect(h.mvp).toBeUndefined();
  });

  it('when two took as many, the one still standing is the MVP', () => {
    // White's pawn takes on d5, then black's queen takes it back: one each, only the queen stands.
    const s = play(createInitialState(), 'e2e4 d7d5 e4d5 d8d5');
    expect(highlights(s).mvp).toMatchObject({ color: 'black', type: 'queen', n: 1, alive: true });
  });

  it('the MVP still on the board says so', () => {
    const s = play(createInitialState(), 'e2e4 d7d5 e4d5');
    expect(highlights(s).mvp).toMatchObject({ color: 'white', type: 'pawn', n: 1, alive: true });
  });
});
