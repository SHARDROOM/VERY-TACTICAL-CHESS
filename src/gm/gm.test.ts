import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, parseSquare } from '../engine';
import { parseGmRuling } from './parse';
import { fakeRuling, FakeGameMaster } from './fakeGm';
import { rollD20, successChance } from '../dice';

const sq = (n: string) => parseSquare(n)!;

describe('parseGmRuling', () => {
  const valid = {
    interpretation: 'x',
    feasible: true,
    dc: 10,
    cost: 1,
    effects: [
      { type: 'move', from: 'b1', to: 'e5' },
      { type: 'remove', at: 'D7' },
    ],
    narration: { success: 's', failure: 'f' },
  };

  it('converts algebraic squares to engine squares', () => {
    const r = parseGmRuling(valid);
    expect(r).toEqual({
      ok: true,
      ruling: {
        ...valid,
        effects: [
          { type: 'move', from: sq('b1'), to: sq('e5') },
          { type: 'remove', at: sq('d7') },
        ],
      },
    });
  });

  it.each([
    ['not an object', 'hello'],
    ['missing narration', { ...valid, narration: undefined }],
    ['string dc', { ...valid, dc: '10' }],
    ['bad square', { ...valid, effects: [{ type: 'remove', at: 'z9' }] }],
    ['unknown effect', { ...valid, effects: [{ type: 'explode', at: 'e4' }] }],
    ['effects not array', { ...valid, effects: {} }],
  ])('rejects %s', (_label, raw) => {
    expect(parseGmRuling(raw).ok).toBe(false);
  });
});

describe('fake GM', () => {
  it('understands a move between two squares', () => {
    const r = fakeRuling('b1 나이트를 투석기로 e5까지 날린다');
    expect(r).toMatchObject({ feasible: true, effects: [{ type: 'move', from: 'b1', to: 'e5' }] });
  });

  it('understands removal of a square', () => {
    expect(fakeRuling('d7 폰을 저격한다')).toMatchObject({ feasible: true, effects: [{ type: 'remove', at: 'd7' }] });
  });

  it('rules anything else infeasible', () => {
    expect(fakeRuling('춤을 춘다').feasible).toBe(false);
  });

  it('produces rulings the engine accepts end to end', async () => {
    const state = createInitialState();
    const raw = await new FakeGameMaster(0).rule({ action: 'b1 나이트를 e5로', state });
    const parsed = parseGmRuling(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const r = applyCommand(state, { type: 'proposeSpecial', action: 'b1 나이트를 e5로', ruling: parsed.ruling });
    expect(r.ok).toBe(true);
  });

  it('its king-removal rulings are rejected by the engine', () => {
    const parsed = parseGmRuling(fakeRuling('e8 킹을 암살한다'));
    if (!parsed.ok) throw new Error(parsed.error);
    const r = applyCommand(createInitialState(), { type: 'proposeSpecial', action: 'e8 킹 암살', ruling: parsed.ruling });
    expect(r).toMatchObject({ ok: false, reason: 'invalidRuling' });
  });
});

describe('dice', () => {
  it('rolls integers 1..20 and hits every face', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const r = rollD20();
      expect(Number.isInteger(r) && r >= 1 && r <= 20).toBe(true);
      seen.add(r);
    }
    expect(seen.size).toBe(20);
  });

  it('computes success chance', () => {
    expect(successChance(11)).toBe(0.5);
    expect(successChance(1)).toBe(1);
    expect(successChance(25)).toBe(0);
  });
});
