import type { GameMaster } from './types';
import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, parseSquare } from '../engine';
import { parseGmRuling } from './parse';
import { fakeRuling, FakeGameMaster } from './fakeGm';
import { rollDie, successChance } from '../dice';

const sq = (n: string) => parseSquare(n)!;

describe('parseGmRuling', () => {
  const valid = {
    interpretation: 'x',
    feasible: true,
    dc: 4,
    cost: 1,
    effects: [
      { type: 'move', from: 'b1', to: 'e5' },
      { type: 'remove', at: 'D7' },
    ],
    critFailureEffects: [],
    narration: { success: 's', failure: 'f', critFailure: 'cf' },
  };

  it('converts algebraic squares to engine squares', () => {
    const r = parseGmRuling(valid);
    expect(r).toMatchObject({
      ok: true,
      ruling: {
        ...valid,
        effects: [
          { type: 'move', from: sq('b1'), to: sq('e5') },
          { type: 'remove', at: sq('d7') },
        ],
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

  it('understands removal of a square, by the piece named first', () => {
    expect(fakeRuling('d1 퀸이 d7 폰을 저격한다')).toMatchObject({ feasible: true, actor: 'd1', means: 'ranged', effects: [{ type: 'remove', at: 'd7' }] });
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
    const parsed = parseGmRuling(fakeRuling('d1 퀸이 e8 킹을 암살한다'));
    if (!parsed.ok) throw new Error(parsed.error);
    const r = applyCommand(createInitialState(), { type: 'proposeSpecial', action: 'd1 퀸이 e8 킹 암살', ruling: parsed.ruling });
    expect(r).toMatchObject({ ok: false, reason: 'invalidRuling' });
  });
});

describe('dice', () => {
  it('rolls integers 1..6 and hits every face', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      const r = rollDie();
      expect(Number.isInteger(r) && r >= 1 && r <= 6).toBe(true);
      seen.add(r);
    }
    expect(seen.size).toBe(6);
  });

  it('computes success chance over two dice: their total must reach the DC, and snake eyes always lose', () => {
    expect(successChance(7)).toBeCloseTo(21 / 36);
    expect(successChance(3)).toBeCloseTo(35 / 36);
    expect(successChance(12)).toBeCloseTo(1 / 36);
    expect(successChance(1)).toBeCloseTo(35 / 36);
  });
});

describe('full effect vocabulary through the GM boundary', () => {
  it('parses every effect type and converts its squares', () => {
    const raw = {
      interpretation: 'x',
      actor: 'b1',
      means: 'magic',
      feasible: true,
      dc: 4,
      cost: 1,
      effects: [
        { type: 'tag', at: 'g8', tag: '기절', turns: 1 },
        { type: 'untag', at: 'g8', tag: '기절' },
        { type: 'board', rider: 'a2', carrier: 'b1' },
        { type: 'unboard', at: 'b1', to: 'a3' },
        { type: 'transform', at: 'a3', into: 'queen' },
        { type: 'spawn', at: 'e4', color: 'black', piece: 'knight' },
      ],
      critFailureEffects: [],
      narration: { success: 's', failure: 'f', critFailure: 'cf' },
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
    const state = { ...createInitialState(), ap: { white: 5, black: 0, red: 0, gray: 0 } };
    expect(applyCommand(state, { type: 'proposeSpecial', action: 'x', ruling: r.ruling }).ok).toBe(true);
  });

  it('rejects kings in transform/spawn at the schema level', () => {
    const base = {
      interpretation: 'x',
      feasible: true,
      dc: 4,
      cost: 1,
      critFailureEffects: [],
      narration: { success: 's', failure: 'f', critFailure: 'cf' },
    };
    expect(parseGmRuling({ ...base, effects: [{ type: 'spawn', at: 'e4', color: 'white', piece: 'king' }] }).ok).toBe(false);
    expect(parseGmRuling({ ...base, effects: [{ type: 'transform', at: 'e4', into: 'king' }] }).ok).toBe(false);
  });

  it('fake GM understands summoning and transforming', () => {
    expect(fakeRuling('d8 퀸이 e4에 나이트를 생성한다', 'black').effects).toEqual([{ type: 'spawn', at: 'e4', color: 'black', piece: 'knight' }]);
    expect(fakeRuling('a2 폰을 퀸으로 바꾼다')).toMatchObject({ actor: 'a2', effects: [{ type: 'transform', at: 'a2', into: 'queen' }] });
    // A removal still wins over these when no piece-making word is used.
    expect(fakeRuling('d1 퀸이 d7 폰을 저격한다').effects).toEqual([{ type: 'remove', at: 'd7' }]);
  });

  it('fake GM understands stun, shield and riding', () => {
    expect(fakeRuling('f1 비숍이 g8 나이트를 기절시킨다').effects).toMatchObject([{ type: 'tag', at: 'g8', tag: '기절', turns: 1, aura: 'none', auraStrength: 0 }]);
    expect(fakeRuling('e1 킹에 보호막')).toMatchObject({ actor: 'e1', means: 'touch', effects: [{ type: 'tag', at: 'e1', tag: '보호막', turns: 0, aura: 'none', auraStrength: 0 }] });
    expect(fakeRuling('a2 폰을 b1 나이트에 태운다')).toMatchObject({ actor: 'a2', means: 'touch', effects: [{ type: 'board', rider: 'a2', carrier: 'b1' }] });
  });
});

describe('swap, revive, burn and terrain through the GM boundary', () => {
  const base = {
    interpretation: 'x',
    feasible: true,
    dc: 4,
    cost: 1,
    critFailureEffects: [],
    narration: { success: 's', failure: 'f', critFailure: 'cf' },
  };

  it('parses the new effects and converts their squares', () => {
    const r = parseGmRuling({
      ...base,
      actor: 'b1',
      means: 'magic',
      effects: [
        { type: 'swap', a: 'b1', b: 'g8' },
        { type: 'revive', at: 'c3', color: 'white', piece: 'knight' },
        { type: 'terrain', at: 'd4', kind: 'wall', turns: 2 },
        { type: 'clearTerrain', at: 'd4' },
      ],
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.ruling.effects).toEqual([
      { type: 'swap', a: sq('b1'), b: sq('g8') },
      { type: 'revive', at: sq('c3'), color: 'white', piece: 'knight' },
      { type: 'terrain', at: sq('d4'), kind: 'wall', turns: 2 },
      { type: 'clearTerrain', at: sq('d4') },
    ]);
    expect(parseGmRuling({ ...base, effects: [{ type: 'terrain', at: 'd4', kind: 'lava', turns: 2 }] }).ok).toBe(false);
  });

  it('fake GM understands swapping, burning, walls, pits and reviving, and the engine takes its rulings', () => {
    expect(fakeRuling('b1 나이트와 g8 나이트의 자리를 바꾼다').effects).toEqual([{ type: 'swap', a: 'b1', b: 'g8' }]);
    expect(fakeRuling('e6 폰이 e7 폰에 불을 붙인다').effects).toMatchObject([{ type: 'tag', at: 'e7', tag: '화상', turns: 3, aura: 'fire', auraStrength: 2 }]);
    expect(fakeRuling('e2 폰이 d4와 e4에 벽을 세운다').effects).toMatchObject([
      { type: 'terrain', at: 'd4', kind: 'wall', turns: 2 },
      { type: 'terrain', at: 'e4', kind: 'wall', turns: 2 },
    ]);
    expect(fakeRuling('e2 폰이 e5에 구덩이를 판다').effects).toMatchObject([{ type: 'terrain', at: 'e5', kind: 'pit', turns: 2 }]);
    expect(fakeRuling('e3 폰이 d4 벽을 부순다').effects).toEqual([{ type: 'clearTerrain', at: 'd4' }]);
    expect(fakeRuling('d1 퀸이 c3에 나이트를 되살린다').effects).toEqual([{ type: 'revive', at: 'c3', color: 'white', piece: 'knight' }]);
    const state = { ...createInitialState(), ap: { white: 5, black: 0, red: 0, gray: 0 } };
    for (const action of ['b1 나이트와 g8 나이트의 자리를 바꾼다', 'g1 나이트가 불화살을 쏘아 g8 나이트를 맞힌다', 'e2 폰이 d4와 e4에 벽을 세운다', 'f2 폰이 g8에 구덩이를 판다']) {
      const parsed = parseGmRuling(fakeRuling(action, 'white', state.board));
      if (!parsed.ok) throw new Error(parsed.error);
      const r = applyCommand(state, { type: 'proposeSpecial', action, ruling: parsed.ruling });
      expect(r.ok, action).toBe(true);
    }
  });

  it('fake GM wants someone to do it, and a hand only reaches the next square', () => {
    const board = createInitialState().board;
    expect(fakeRuling('g8 나이트에 불을 붙인다', 'white', board)).toMatchObject({ feasible: false, actor: '' });
    expect(fakeRuling('g7 폰이 g8 나이트에 불을 붙인다', 'white', board).interpretation).toContain('내 기물이 없습니다');
    expect(fakeRuling('g2 폰이 g7 폰에 불을 붙인다', 'white', board)).toMatchObject({ feasible: false });
    expect(fakeRuling('g2 폰이 g7 폰에 불을 붙인다', 'white', board).interpretation).toContain('5칸');
    expect(fakeRuling('g2 폰이 불화살을 쏘아 g7 폰에 불을 붙인다', 'white', board)).toMatchObject({ feasible: true, actor: 'g2', means: 'ranged' });
    // The backfire falls on whoever did it.
    expect(fakeRuling('g2 폰이 불화살을 쏘아 g7 폰에 불을 붙인다', 'white', board).critFailureEffects).toMatchObject([{ type: 'tag', at: 'g2', tag: '기절', turns: 1, aura: 'none', auraStrength: 0 }]);
  });

});

describe('clash multipliers, props, bridges and ladders through the GM boundary', () => {
  const base = { interpretation: 'x', actor: 'e2', means: 'magic', feasible: true, dc: 4, cost: 1, critFailureEffects: [], narration: { success: 's', failure: 'f', critFailure: 'cf' } };
  const sword = { preset: 'sword', color: '', scale: 1, attach: 'rightHand', parts: '' };
  const none = { preset: 'none', color: '', scale: 1, attach: 'rightHand', parts: '' };

  it('a tag keeps its multiplier (pulled into range) and its prop; "none" and 0 mean nothing', () => {
    const r = parseGmRuling({
      ...base,
      effects: [
        { type: 'tag', at: 'e2', tag: '검술', turns: 0, aura: 'none', auraStrength: 0, clash: 1.5, prop: sword },
        { type: 'tag', at: 'd2', tag: '용기', turns: 2, aura: 'none', auraStrength: 0, clash: 0, prop: none },
        { type: 'tag', at: 'c2', tag: '괴력', turns: 2, aura: 'none', auraStrength: 0, clash: 3, prop: none },
      ],
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.ruling.effects).toEqual([
      { type: 'tag', at: sq('e2'), tag: '검술', turns: 0, clash: 1.5, prop: { preset: 'sword', parts: [], attach: 'rightHand', scale: 1 } },
      { type: 'tag', at: sq('d2'), tag: '용기', turns: 2 },
      { type: 'tag', at: sq('c2'), tag: '괴력', turns: 2, clash: 2 },
    ]);
  });

  it('a prop of its own parts comes through as parts; a bad prop is dropped, not the ruling', () => {
    const flagPole = 'cylinder wood 0 0.4 0 0.03 0.9 0.03; nonsense line; cone 1 2';
    const r = parseGmRuling({
      ...base,
      effects: [
        { type: 'terrain', at: 'd4', kind: 'wall', turns: 2, prop: { preset: 'none', color: '', scale: 1, attach: 'feet', parts: flagPole } },
        { type: 'terrain', at: 'e4', kind: 'pit', turns: 2, prop: { preset: 'dragon', color: '', scale: 1, attach: 'feet', parts: '' } },
        { type: 'cover', at: 'e4', kind: 'bridge', turns: 2, prop: none },
        { type: 'clearCover', at: 'e4' },
      ],
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.ruling.effects[0]).toEqual({
      type: 'terrain',
      at: sq('d4'),
      kind: 'wall',
      turns: 2,
      prop: { preset: null, attach: 'feet', scale: 1, parts: [{ shape: 'cylinder', position: [0, 0.4, 0], size: [0.03, 0.9, 0.03], rotation: [0, 0, 0], material: 'wood' }] },
    });
    expect(r.ruling.effects.slice(1)).toEqual([
      { type: 'terrain', at: sq('e4'), kind: 'pit', turns: 2 },
      { type: 'cover', at: sq('e4'), kind: 'bridge', turns: 2 },
      { type: 'clearCover', at: sq('e4') },
    ]);
  });

  it('fake GM: swordsmanship with a sword in hand, bridges, ladders, and the engine takes them', () => {
    expect(fakeRuling('e2 폰이 영감을 얻어 검술에 눈을 뜬다').effects).toMatchObject([{ type: 'tag', at: 'e2', tag: '검술', clash: 1.5, prop: { preset: 'sword' } }]);
    expect(fakeRuling('e3 폰이 d4 구덩이에 다리를 놓는다').effects).toMatchObject([{ type: 'cover', at: 'd4', kind: 'bridge', turns: 2 }]);
    expect(fakeRuling('e3 폰이 d4 벽에 사다리를 건다').effects).toMatchObject([{ type: 'cover', at: 'd4', kind: 'ladder' }]);
    expect(fakeRuling('e3 폰이 d4 다리를 끊는다').effects).toEqual([{ type: 'clearCover', at: 'd4' }]);
    const state = { ...createInitialState(), ap: { white: 5, black: 0, red: 0, gray: 0 } };
    const parsed = parseGmRuling(fakeRuling('e2 폰이 영감을 얻어 검술에 눈을 뜬다', 'white', state.board));
    if (!parsed.ok) throw new Error(parsed.error);
    const r = applyCommand(state, { type: 'proposeSpecial', action: 'x', ruling: parsed.ruling });
    expect(r.ok).toBe(true);
  });
});

describe('fake GM crits', () => {
  it('backfires by stunning the acting piece on a 1, and its rulings pass engine validation', () => {
    const r = fakeRuling('b1 나이트를 c3로 보낸다');
    expect(r.critFailureEffects).toMatchObject([{ type: 'tag', at: 'b1', tag: '기절', turns: 1, aura: 'none', auraStrength: 0 }]);
    const parsed = parseGmRuling(r);
    if (!parsed.ok) throw new Error(parsed.error);
    const state = { ...createInitialState(), ap: { white: 5, black: 0, red: 0, gray: 0 } };
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

describe('prop parts as text', () => {
  it('reads shape, material, position, size, rotation and colour in any word order; skips lines it cannot read', async () => {
    const { partsFromText } = await import('./props');
    expect(partsFromText('torus rope 0 0.03 0 0.24 0.04 0.24; sphere cloth 0.1 0.05 0 0.06 0.06 0.06 #E05A8A\nwood box 0 0 0 1 1 1 0 45 0; hello')).toEqual([
      { shape: 'torus', material: 'rope', position: [0, 0.03, 0], size: [0.24, 0.04, 0.24], rotation: [0, 0, 0], color: undefined },
      { shape: 'sphere', material: 'cloth', position: [0.1, 0.05, 0], size: [0.06, 0.06, 0.06], rotation: [0, 0, 0], color: '#E05A8A' },
      { shape: 'box', material: 'wood', position: [0, 0, 0], size: [1, 1, 1], rotation: [0, 45, 0], color: undefined },
      null,
    ]);
  });
});

describe('fake GM: levitation', () => {
  it('floats a piece of the player\'s, and drops a floating one (named by its square)', () => {
    const s = createInitialState();
    const up = fakeRuling('d1 퀸이 떠오른다', 'white', s.board);
    expect(up).toMatchObject({ feasible: true, actor: 'd1', effects: [{ type: 'tag', at: 'd1', tag: '공중부양', turns: 2 }] });
    const parsed = parseGmRuling(up);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const proposed = applyCommand({ ...s, ap: { white: 3, black: 0, red: 0, gray: 0 } }, { type: 'proposeSpecial', action: 'd1 퀸이 떠오른다', ruling: parsed.ruling });
    if (!proposed.ok) throw new Error(proposed.reason);
    const after = applyCommand(proposed.state, { type: 'attemptSpecial', roll: 12 });
    if (!after.ok) throw new Error(after.reason);
    expect(after.state.board[parseSquare('d1^')!]?.type).toBe('queen');
    const down = fakeRuling('e1 킹이 d1 퀸을 떨어뜨린다', 'white', after.state.board);
    expect(down).toMatchObject({ feasible: true, effects: [{ type: 'untag', at: 'd1^', tag: '공중부양' }] });
  });
});

describe('skills, wills and mental actions through the GM boundary', () => {
  it('reads skills, the target and the mental flag; a skill and a will on a tag', () => {
    const r = parseGmRuling({
      interpretation: 'x',
      actor: 'd4',
      means: 'magic',
      target: 'd6',
      skills: ['지휘의 깃발', ' '],
      mental: true,
      feasible: true,
      dc: 8,
      cost: 2,
      effects: [{ type: 'tag', at: 'd4', tag: '건축가', turns: 3, skill: { about: '지형 만들기', bonus: 2 }, mind: 0 }],
      critFailureEffects: [{ type: 'tag', at: 'd4', tag: '겁에 질림', turns: 1, skill: { about: '', bonus: 0 }, mind: -2 }],
      narration: { success: 's', failure: 'f', critFailure: 'c' },
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.ruling).toMatchObject({ target: parseSquare('d6'), skills: ['지휘의 깃발'], mental: true });
    expect(r.ruling.effects[0]).toMatchObject({ skill: { about: '지형 만들기', bonus: 2 } });
    expect(r.ruling.effects[0]).not.toHaveProperty('mind');
    expect(r.ruling.critFailureEffects?.[0]).toMatchObject({ mind: -2 });
    expect(r.ruling.critFailureEffects?.[0]).not.toHaveProperty('skill');
  });

  it('the fake GM gives skills and wills, and marks winning over as mental', () => {
    const state = createInitialState();
    expect(fakeRuling('d1 퀸이 e2 폰에게 건축가 특기를 준다', 'white', state.board)).toMatchObject({ feasible: true, effects: [{ type: 'tag', tag: '건축가', skill: { bonus: 2 } }] });
    expect(fakeRuling('d1 퀸이 e2 폰에게 강철 같은 정신력을 불어넣는다', 'white', state.board)).toMatchObject({ feasible: true, effects: [{ type: 'tag', mind: 2 }] });
    const board = [...state.board];
    board[parseSquare('d3')!] = board[parseSquare('d7')!];
    board[parseSquare('d7')!] = null;
    expect(fakeRuling('d2 폰이 d3 폰을 회유한다', 'white', board)).toMatchObject({ feasible: true, mental: true, target: 'd3', effects: [{ type: 'convert', at: 'd3', color: 'white' }] });
  });
});
