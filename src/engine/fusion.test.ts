import { describe, expect, it } from 'vitest';
import { applyCommand, applyEffects, clashMultiplier, createStateFrom, legalTargets, squareName, type GameState, type Piece, type Tag } from './index';
import { ok, sq } from './testUtil';
import { fused } from './fusion';

type Spec = { color: 'white' | 'black'; type: Piece['type']; tags?: Tag[] };
function scene(pieces: Record<string, Spec>, turn: 'white' | 'black' = 'white'): GameState {
  const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' } }, turn);
  const board = [...s.board];
  for (const [name, p] of Object.entries(pieces)) board[sq(name)] = { id: `${p.color}-${p.type}-${name}`, color: p.color, type: p.type, ...(p.tags && { tags: p.tags }) };
  return { ...s, board };
}
const ctx = { turnNumber: 1, nextSpawnId: 1, color: 'white' as const, actor: sq('c3') };

describe('융합 (fusion)', () => {
  it('the actor takes in the piece next to it: one piece, crowned, moving as itself, a fighter by base + a quarter', () => {
    const s = scene({ c3: { color: 'white', type: 'knight' }, d4: { color: 'white', type: 'bishop' } });
    const r = applyEffects(s.board, [{ type: 'fuse', body: sq('c3'), material: sq('d4') }], ctx);
    if (!r.ok) throw new Error(r.detail);
    expect(r.board[sq('d4')]).toBeNull();
    const knight = r.board[sq('c3')]!;
    expect(knight).toMatchObject({ type: 'knight', fuse: { base: 1.25, crowns: [{ type: 'bishop', color: 'white' }] } });
    expect(clashMultiplier(knight)).toBe(1.25);
    // Moves as a knight only.
    const st = { ...s, board: r.board };
    expect(legalTargets(st, sq('c3')).map((t) => squareName(t.to))).toContain('b5');
    expect(legalTargets(st, sq('c3')).map((t) => squareName(t.to))).not.toContain('d2');
    expect(r.events[0]).toMatchObject({ type: 'fused', base: 1.25 });
  });

  it('every absorption adds a quarter; a fused piece taken in counts with its own multiplier and brings its crowns', () => {
    const q: Piece = { id: 'q', color: 'white', type: 'queen' };
    const pawn = (id: string): Piece => ({ id, color: 'white', type: 'pawn' });
    let big = q;
    for (const id of ['a', 'b', 'c', 'd']) big = fused(big, pawn(id));
    expect(big.fuse?.base).toBe(2.4);
    const knight = fused({ id: 'n', color: 'white', type: 'knight' }, fused({ id: 'b', color: 'black', type: 'bishop' }, pawn('p')));
    expect(knight.fuse).toEqual({ base: 1.3, crowns: [{ id: 'b', type: 'bishop', color: 'black' }, { id: 'p', type: 'pawn', color: 'white' }] });
    // With a tag it stops at ×3.
    expect(clashMultiplier({ ...big, tags: [{ name: '검술', turnsLeft: 2, appliedOnTurn: 0, clash: 2 }] })).toBe(3);
  });

  it('a fused piece stands its ground: taking it is a clash, and it falls with everyone in it', () => {
    const s0 = scene({ c3: { color: 'white', type: 'knight' }, d4: { color: 'white', type: 'bishop' }, c8: { color: 'black', type: 'rook' } }, 'black');
    const r0 = applyEffects(s0.board, [{ type: 'fuse', body: sq('c3'), material: sq('d4') }], ctx);
    if (!r0.ok) throw new Error(r0.detail);
    const s = { ...s0, board: r0.board };
    expect(applyCommand(s, { type: 'move', from: sq('c8'), to: sq('c3') })).toMatchObject({ ok: false, reason: 'clashRollsNeeded' });
    // The rook wins (6+6 against 1+1).
    const r = ok(applyCommand(s, { type: 'move', from: sq('c8'), to: sq('c3'), clashRolls: [6, 6, 1, 1] }));
    expect(r.state.board[sq('c3')]).toMatchObject({ type: 'rook', color: 'black' });
    expect(r.state.captured.map((c) => c.type)).toEqual(['knight', 'bishop']);
    expect(r.state.remains?.map((m) => m.type)).toEqual(['knight', 'bishop']);
  });

  it('split lets the newest crown stand again next to it', () => {
    const s = scene({ c3: { color: 'white', type: 'knight' }, d4: { color: 'white', type: 'bishop' } });
    const r = applyEffects(s.board, [{ type: 'fuse', body: sq('c3'), material: sq('d4') }, { type: 'split', at: sq('c3'), to: sq('c4') }], ctx);
    if (!r.ok) throw new Error(r.detail);
    expect(r.board[sq('c3')]).not.toHaveProperty('fuse');
    expect(r.board[sq('c4')]).toMatchObject({ id: 'white-bishop-d4', type: 'bishop' });
  });

  it('refuses a king as material, a far piece, and a body other than the actor', () => {
    const s = scene({ c3: { color: 'white', type: 'knight' }, d2: { color: 'white', type: 'pawn' }, h7: { color: 'black', type: 'pawn' } });
    const fuse = (body: string, material: string) => applyEffects(s.board, [{ type: 'fuse', body: sq(body), material: sq(material) }], ctx).ok;
    expect(fuse('c3', 'd2')).toBe(true);
    expect(fuse('c3', 'h7')).toBe(false);
    expect(fuse('d2', 'c3')).toBe(false);
    const nearKing = scene({ d2: { color: 'white', type: 'knight' } });
    expect(applyEffects(nearKing.board, [{ type: 'fuse', body: sq('d2'), material: sq('e1') }], { ...ctx, actor: sq('d2') }).ok).toBe(false);
  });
});
