import { describe, expect, it } from 'vitest';
import { applyCommand, applyEffects, createInitialState, createStateFrom, pendingModifiers, type Effect, type GameState, type Ruling } from './index';
import { ok, sq } from './testUtil';
import { looksOnPiece } from './props';

const base = (): GameState =>
  createStateFrom(
    { e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, d2: { color: 'white', type: 'pawn' }, b2: { color: 'white', type: 'rook' }, d7: { color: 'black', type: 'pawn' }, c6: { color: 'black', type: 'knight' } },
    'white',
    { ap: { white: 6, black: 6, red: 0, gray: 0 } },
  );
const build = (s: GameState, at: string, building: Extract<Effect, { type: 'terrain' }>['building']) => {
  const r = applyEffects(s.board, [{ type: 'terrain', at: sq(at), kind: 'wall', turns: 0, building }], { turnNumber: s.turnNumber, nextSpawnId: s.nextSpawnId, color: s.turn, terrain: s.terrain ?? [] });
  if (!r.ok) throw new Error(r.detail);
  return { ...s, board: r.board, terrain: r.terrain };
};
const shot = (actor: string, at: string, buildings: string[] = []): Ruling => ({
  interpretation: 'x',
  feasible: true,
  dc: 8,
  cost: 2,
  actor: sq(actor),
  means: 'ranged',
  effects: [{ type: 'remove', at: sq(at) }],
  buildings: buildings.map(sq),
  narration: { success: 's', failure: 'f' },
});

describe('buildings (건물)', () => {
  it('a ready-made one gets its name, what it helps with, its look and +2', () => {
    const s = build(base(), 'd3', { kind: 'forge', name: '', about: '', bonus: 0 });
    expect(s.terrain).toEqual([expect.objectContaining({ at: sq('d3'), kind: 'wall', building: { kind: 'forge', name: '대장간', about: '칼이나 무기를 만들거나 얻기', bonus: 2 }, prop: expect.objectContaining({ preset: 'forge' }) })]);
  });

  it("the GM's own needs a name and what it helps with; bonuses are 1..3; only walls", () => {
    const at = (b: unknown, kind: 'wall' | 'pit' = 'wall') => applyEffects(base().board, [{ type: 'terrain', at: sq('d3'), kind, turns: 0, building: b as never }], { turnNumber: 1, nextSpawnId: 1, color: 'white', terrain: [] });
    expect(at({ kind: 'custom', name: '', about: '', bonus: 2 })).toMatchObject({ ok: false });
    expect(at({ kind: 'custom', name: '도서관', about: '마법 판정', bonus: 3 })).toMatchObject({ ok: true });
    expect(at({ kind: 'cannon', name: '', about: '', bonus: 4 })).toMatchObject({ ok: false });
    expect(at({ kind: 'cannon', name: '', about: '', bonus: 2 }, 'pit')).toMatchObject({ ok: false });
  });

  it('a piece next to it gets the bonus when the GM names it; anyone may use one; farther or no building is refused', () => {
    // White's cannon on c3: next to the white pawn d2 (and the rook b2).
    const s = build(base(), 'c3', { kind: 'cannon', name: '', about: '', bonus: 0 });
    const p = ok(applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling: shot('d2', 'd7', ['c3']) })).state;
    expect(pendingModifiers(p.board, p.pending!, p.remains, p.terrain)).toContainEqual({ kind: 'building', label: '대포', value: 2 });
    expect(applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling: shot('d2', 'd7', ['d3']) })).toMatchObject({ ok: false, reason: 'invalidRuling' });
    // The black knight on c6 is too far from it...
    const blackTurn = { ...s, turn: 'black' as const };
    expect(applyCommand(blackTurn, { type: 'proposeSpecial', action: 'x', ruling: shot('c6', 'd2', ['c3']) })).toMatchObject({ ok: false, reason: 'invalidRuling' });
    // ...but a black piece next to it may use white's cannon.
    const near = { ...blackTurn, board: blackTurn.board.map((x, i) => (i === sq('c6') ? null : i === sq('c4') ? { id: 'bn', color: 'black' as const, type: 'knight' as const } : x)) };
    const q = ok(applyCommand(near, { type: 'proposeSpecial', action: 'x', ruling: shot('c4', 'd2', ['c3']) })).state;
    expect(pendingModifiers(q.board, q.pending!, q.remains, q.terrain)).toContainEqual({ kind: 'building', label: '대포', value: 2 });
  });

  it('a building torn down helps no more', () => {
    const s = build(base(), 'c3', { kind: 'cannon', name: '', about: '', bonus: 0 });
    const p = ok(applyCommand(s, { type: 'proposeSpecial', action: 'x', ruling: shot('d2', 'd7', ['c3']) })).state;
    expect(pendingModifiers(p.board, p.pending!, p.remains, [])).not.toContainEqual(expect.objectContaining({ kind: 'building' }));
  });
});

describe('a building always looks like one (사용자 요청: a forge came out as a plain wall)', () => {
  it('a ready-made one wears its own look whatever the GM gave; a custom one its own, a guessed one, or a little house', async () => {
    const { buildingLook } = await import('./terrain');
    const barricade = { preset: 'barricade' as const, parts: [], attach: 'feet' as const, scale: 1 };
    expect(buildingLook({ kind: 'forge', name: '대장간', about: '무기', bonus: 2 }, barricade).preset).toBe('forge');
    expect(buildingLook({ kind: 'custom', name: '무기 창고', about: '칼 얻기', bonus: 2 }).preset).toBe('forge');
    expect(buildingLook({ kind: 'custom', name: '수도원', about: '기도', bonus: 2 }).preset).toBe('chapel');
    const hut = buildingLook({ kind: 'custom', name: '도서관', about: '마법 판정', bonus: 2 });
    expect(hut.preset).toBeNull();
    expect(hut.parts.length).toBeGreaterThan(0);
    expect(buildingLook({ kind: 'custom', name: '도서관', about: '마법 판정', bonus: 2 }, barricade).preset).toBe('barricade');
  });

  it('the terrain cell keeps that look', () => {
    const s = base();
    const r = applyEffects(s.board, [{ type: 'terrain', at: sq('e4'), kind: 'wall', turns: 0, prop: { preset: 'barricade', parts: [], attach: 'feet', scale: 1 }, building: { kind: 'forge', name: '', about: '', bonus: 2 } } as Effect], { turnNumber: 1, nextSpawnId: 1, color: 'white', terrain: [] });
    if (!r.ok) throw new Error(r.detail);
    expect(r.terrain[0]).toMatchObject({ building: { kind: 'forge', name: '대장간' }, prop: { preset: 'forge' } });
  });
});

describe('a building never sits on a piece (사용자 요청: the GM put a cannon in a pawn’s hand, as if it wore it)', () => {
  const ctx = { turnNumber: 1, nextSpawnId: 1, color: 'white' as const, terrain: [] };
  const tagWith = (preset: 'cannon' | 'chapel' | 'forge' | 'sword') =>
    applyEffects(base().board, [{ type: 'tag', at: sq('d2'), tag: '대포 장착', turns: 3, prop: { preset, parts: [], attach: 'rightHand', scale: 1 } } as Effect], ctx);

  it('a tag may not wear a building’s look (cannon, chapel, forge): the GM hears to build it on a free square instead', () => {
    for (const preset of ['cannon', 'chapel', 'forge'] as const) expect(tagWith(preset)).toMatchObject({ ok: false, detail: expect.stringMatching(/건물.*빈 칸/) });
    expect(tagWith('sword')).toMatchObject({ ok: true });
  });

  it('nor may a building go up on a piece’s own square: the GM hears to use a free square next to it', () => {
    const r = applyEffects(base().board, [{ type: 'terrain', at: sq('d2'), kind: 'wall', turns: 0, building: { kind: 'forge', name: '', about: '', bonus: 2 } }], ctx);
    expect(r).toMatchObject({ ok: false, detail: expect.stringMatching(/건물.*옆의 빈 칸/) });
  });

  it('the GM hears which squares next to it are free, or that none is (found near the cross-check: a boxed-in knight’s GM tried a square two away)', () => {
    // d2's free neighbours in base(): all but e1 (the king).
    const open = applyEffects(base().board, [{ type: 'terrain', at: sq('d2'), kind: 'wall', turns: 0, building: { kind: 'forge', name: '', about: '', bonus: 2 } }], ctx);
    expect(open).toMatchObject({ ok: false, detail: expect.stringContaining('c1, c2, c3, d1, d3, e2, e3') });
    // The knight on g1 at the start has nothing free around it.
    const start = createInitialState();
    const boxed = applyEffects(start.board, [{ type: 'terrain', at: sq('g1'), kind: 'wall', turns: 0, building: { kind: 'forge', name: '', about: '', bonus: 2 } }], ctx);
    expect(boxed).toMatchObject({ ok: false, detail: expect.stringContaining('빈 칸이 없') });
  });

  it('a piece that already wears one (an older save) shows it no more; its other looks stay', () => {
    const tags = [
      { name: '대포 장착', turnsLeft: 3, appliedOnTurn: 1, prop: { preset: 'cannon' as const, parts: [], attach: 'rightHand' as const, scale: 1 } },
      { name: '검술', turnsLeft: 3, appliedOnTurn: 1, prop: { preset: 'sword' as const, parts: [], attach: 'rightHand' as const, scale: 1 } },
      { name: '기절', turnsLeft: 1, appliedOnTurn: 1 },
    ];
    expect(looksOnPiece(tags).map((t) => t.name)).toEqual(['검술']);
  });
});
