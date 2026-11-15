import type { GameMaster } from './types';
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
    critSuccessEffects: [{ type: 'move', from: 'b1', to: 'e6' }],
    critFailureEffects: [],
    narration: { success: 's', failure: 'f', critSuccess: 'cs', critFailure: 'cf' },
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
        critSuccessEffects: [{ type: 'move', from: sq('b1'), to: sq('e6') }],
        critFailureEffects: [],
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

  it('computes success chance, counting natural 20 as a win and natural 1 as a loss', () => {
    expect(successChance(11)).toBe(0.5);
    expect(successChance(2)).toBe(0.95);
    expect(successChance(25)).toBe(0.05);
  });
});

describe('full effect vocabulary through the GM boundary', () => {
  it('parses every effect type and converts its squares', () => {
    const raw = {
      interpretation: 'x',
      feasible: true,
      dc: 10,
      cost: 1,
      effects: [
        { type: 'tag', at: 'g8', tag: '기절', turns: 1 },
        { type: 'untag', at: 'g8', tag: '기절' },
        { type: 'board', rider: 'a2', carrier: 'b1' },
        { type: 'unboard', at: 'b1', to: 'a3' },
        { type: 'transform', at: 'a3', into: 'queen' },
        { type: 'spawn', at: 'e4', color: 'black', piece: 'knight' },
      ],
      critSuccessEffects: [],
      critFailureEffects: [],
      narration: { success: 's', failure: 'f', critSuccess: 'cs', critFailure: 'cf' },
    };
    const r = parseGmRuling(raw);
    if (!r.ok) throw new Error(r.error);
    expect(r.ruling.effects).toEqual([
      { type: 'tag', at: sq('g8'), tag: '기절', turns: 1 },
      { type: 'untag', at: sq('g8'), tag: '기절' },
      { type: 'board', rider: sq('a2'), carrier: sq('b1') },
      { type: 'unboard', at: sq('b1'), to: sq('a3') },
      { type: 'transform', at: sq('a3'), into: 'queen' },
      { type: 'spawn', at: sq('e4'), color: 'black', piece: 'knight' },
    ]);
    const state = { ...createInitialState(), ap: { white: 5, black: 0 } };
    expect(applyCommand(state, { type: 'proposeSpecial', action: 'x', ruling: r.ruling }).ok).toBe(true);
  });

  it('rejects kings in transform/spawn at the schema level', () => {
    const base = {
      interpretation: 'x',
      feasible: true,
      dc: 10,
      cost: 1,
      critSuccessEffects: [],
      critFailureEffects: [],
      narration: { success: 's', failure: 'f', critSuccess: 'cs', critFailure: 'cf' },
    };
    expect(parseGmRuling({ ...base, effects: [{ type: 'spawn', at: 'e4', color: 'white', piece: 'king' }] }).ok).toBe(false);
    expect(parseGmRuling({ ...base, effects: [{ type: 'transform', at: 'e4', into: 'king' }] }).ok).toBe(false);
  });

  it('fake GM understands summoning and transforming', () => {
    expect(fakeRuling('e4에 나이트를 생성한다', 'black').effects).toEqual([{ type: 'spawn', at: 'e4', color: 'black', piece: 'knight' }]);
    expect(fakeRuling('a2 폰을 퀸으로 바꾼다').effects).toEqual([{ type: 'transform', at: 'a2', into: 'queen' }]);
    // A removal still wins over these when no piece-making word is used.
    expect(fakeRuling('d7 폰을 저격한다').effects).toEqual([{ type: 'remove', at: 'd7' }]);
  });

  it('fake GM understands stun, shield and riding', () => {
    expect(fakeRuling('g8 나이트를 기절시킨다').effects).toEqual([{ type: 'tag', at: 'g8', tag: '기절', turns: 1 }]);
    expect(fakeRuling('e1 킹에 보호막').effects).toEqual([{ type: 'tag', at: 'e1', tag: '보호막', turns: 0 }]);
    expect(fakeRuling('a2 폰을 b1 나이트에 태운다').effects).toEqual([{ type: 'board', rider: 'a2', carrier: 'b1' }]);
  });
});

describe('fake GM crits', () => {
  it('backfires by stunning the acting piece on a 1, and its rulings pass engine validation', () => {
    const r = fakeRuling('b1 나이트를 c3로 보낸다');
    expect(r.critFailureEffects).toEqual([{ type: 'tag', at: 'b1', tag: '기절', turns: 1 }]);
    const parsed = parseGmRuling(r);
    if (!parsed.ok) throw new Error(parsed.error);
    const state = { ...createInitialState(), ap: { white: 5, black: 0 } };
    expect(applyCommand(state, { type: 'proposeSpecial', action: 'x', ruling: parsed.ruling }).ok).toBe(true);
  });
});

describe('chaos', () => {
  it('the fake GM never makes up chaos: only a real (API) GM does', async () => {
    const { FakeGameMaster } = await import('./fakeGm');
    const { MissingKeyGameMaster } = await import('./missingKeyGm');
    const gms: GameMaster[] = [new FakeGameMaster(0), new MissingKeyGameMaster('Claude GM')];
    for (const gm of gms) expect(gm.chaos).toBeUndefined();
  });

  it('parses squares in chaos effects and rejects bad ones', async () => {
    const { parseGmChaos } = await import('./parse');
    expect(parseGmChaos({ title: 't', narration: 'n', effects: [{ type: 'convert', at: 'e2', color: 'black' }] })).toMatchObject({
      ok: true,
      chaos: { effects: [{ type: 'convert', at: 12, color: 'black' }] },
    });
    expect(parseGmChaos({ title: 't', narration: 'n', effects: [{ type: 'remove', at: 'z9' }] }).ok).toBe(false);
  });
});
