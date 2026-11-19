import { describe, expect, it } from 'vitest';
import { applyCommand, applyEffects, createStateFrom, pendingModifiers, type Effect, type GameState, type Ruling } from './index';
import { ok, sq } from './testUtil';

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
