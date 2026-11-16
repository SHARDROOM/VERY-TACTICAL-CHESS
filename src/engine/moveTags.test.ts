import { describe, expect, it } from 'vitest';
import { applyCommand, applyEffects, createStateFrom, legalTargets, squareName, type GameState, type Piece, type Tag } from './index';
import { ok, okMove, sq } from './testUtil';

type Spec = { color: 'white' | 'black'; type: Piece['type']; tags?: Tag[] };

/** Kings on e1/e8 and the given pieces, white to move. */
function scene(extra: Record<string, Spec>, turn: 'white' | 'black' = 'white'): GameState {
  const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' } }, turn);
  const board = [...s.board];
  for (const [name, p] of Object.entries(extra)) board[sq(name)] = { id: `${p.color}-${p.type}-${name}`, color: p.color, type: p.type, ...(p.tags && { tags: p.tags }) };
  return { ...s, board };
}

const tag = (extra: Partial<Tag>): Tag => ({ name: '특수', turnsLeft: 2, appliedOnTurn: 0, ...extra });
const targets = (s: GameState, from: string) => legalTargets(s, sq(from)).map((t) => squareName(t.to)).sort();
const ctx = { turnNumber: 1, nextSpawnId: 1, color: 'white' as const };

describe('moving like another piece (moveAs)', () => {
  it('a pawn that moves like a rook keeps its own moves and gains the rook\'s', () => {
    const s = scene({ a2: { color: 'white', type: 'pawn', tags: [tag({ moveAs: ['rook'] })] }, b3: { color: 'black', type: 'knight' } });
    const t = targets(s, 'a2');
    expect(t).toContain('a8'); // rook up the file
    expect(t).toContain('h2'); // rook along the rank
    expect(t).toContain('b3'); // pawn capture, still
    expect(t).toContain('a1'); // rook backwards
  });

  it('it captures and checks like that piece too', () => {
    const s = scene({ e2: { color: 'white', type: 'pawn', tags: [tag({ moveAs: ['rook'] })] } });
    // e2 pawn with rook moves sees up the e-file to the black king.
    const r = okMove(s, 'e2', 'e7');
    expect(r.events.some((e) => e.type === 'check' && e.color === 'black')).toBe(true);
  });

  it('a pawn that moves like a rook does not leave an en passant chance when it slides two squares elsewhere', () => {
    const s = scene({ a3: { color: 'white', type: 'pawn', tags: [tag({ moveAs: ['rook'] })] }, b5: { color: 'black', type: 'pawn' } });
    expect(okMove(s, 'a3', 'a5').state.enPassant).toBeNull();
  });

  it('a knight lent the king\'s steps goes one square too', () => {
    const s = scene({ b1: { color: 'white', type: 'knight', tags: [tag({ moveAs: ['king'] })] } });
    expect(targets(s, 'b1')).toEqual(expect.arrayContaining(['a1', 'c1', 'b2', 'c3', 'a3', 'd2']));
  });

  it('a tag effect lends the moves (and its own kind is dropped)', () => {
    const s = scene({ a2: { color: 'white', type: 'pawn' } });
    const r = applyEffects(s.board, [{ type: 'tag', at: sq('a2'), tag: '성탑의 걸음', turns: 2, moveAs: ['rook', 'pawn'] }], ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.board[sq('a2')]?.tags?.[0]).toMatchObject({ name: '성탑의 걸음', moveAs: ['rook'] });
    expect(r.events[0]).toMatchObject({ type: 'tagged', moveAs: ['rook'] });
  });

  it('rejects kinds that do not exist', () => {
    const s = scene({ a2: { color: 'white', type: 'pawn' } });
    const r = applyEffects(s.board, [{ type: 'tag', at: sq('a2'), tag: 'x', turns: 1, moveAs: ['dragon' as never] }], ctx);
    expect(r.ok).toBe(false);
  });
});

describe('moving several times in a row (moveTimes)', () => {
  const twice = () => scene({ a2: { color: 'white', type: 'pawn', tags: [tag({ moveTimes: 2 })] }, h7: { color: 'black', type: 'pawn' }, h2: { color: 'white', type: 'pawn' } });

  it('after its first move the same piece may move again, and the turn has not passed', () => {
    const r = okMove(twice(), 'a2', 'a3');
    expect(r.state.turn).toBe('white');
    expect(r.state.chain).toEqual({ pieceId: 'white-pawn-a2', at: sq('a3'), left: 1 });
    expect(r.events.at(-1)).toMatchObject({ type: 'moveAgain', at: sq('a3'), left: 1 });
    const second = okMove(r.state, 'a3', 'a4');
    expect(second.state.turn).toBe('black');
    expect(second.state.chain).toBeUndefined();
  });

  it('only that piece may move meanwhile, and no special action', () => {
    const s = okMove(twice(), 'a2', 'a3').state;
    const other = applyCommand(s, { type: 'move', from: sq('h2'), to: sq('h3') });
    expect(other).toMatchObject({ ok: false, reason: 'notChainedPiece' });
    const ruling = { interpretation: '', actor: sq('a3'), means: 'touch' as const, feasible: true, dc: 5, cost: 1, effects: [], narration: { success: '', failure: '' } };
    expect(applyCommand(s, { type: 'proposeSpecial', action: '함성', ruling })).toMatchObject({ ok: false, reason: 'chainInProgress' });
  });

  it('the turn may be ended after the first move', () => {
    const s = okMove(twice(), 'a2', 'a4').state;
    const r = ok(applyCommand(s, { type: 'endTurn' }));
    expect(r.state.turn).toBe('black');
    expect(r.state.chain).toBeUndefined();
    // The double step still opened en passant for the opponent.
    expect(r.state.enPassant).toBe(sq('a3'));
  });

  it('a move that gives check ends the run (the opponent always gets to answer)', () => {
    const s = scene({ a1: { color: 'white', type: 'rook', tags: [tag({ moveTimes: 3 })] } });
    const r = okMove(s, 'a1', 'a8');
    expect(r.state.turn).toBe('black');
    expect(r.state.chain).toBeUndefined();
  });

  it('three times in a row', () => {
    const s = scene({ a1: { color: 'white', type: 'rook', tags: [tag({ moveTimes: 3 })] } });
    let st = okMove(s, 'a1', 'a2').state;
    expect(st.chain?.left).toBe(2);
    st = okMove(st, 'a2', 'b2').state;
    expect(st.chain?.left).toBe(1);
    st = okMove(st, 'b2', 'b3').state;
    expect(st.turn).toBe('black');
  });

  it('the tag effect stores it (1 = nothing, past the maximum is refused)', () => {
    const s = scene({ a2: { color: 'white', type: 'pawn' } });
    const good = applyEffects(s.board, [{ type: 'tag', at: sq('a2'), tag: '질주', turns: 1, moveTimes: 2 }], ctx);
    expect(good.ok && good.board[sq('a2')]?.tags?.[0].moveTimes).toBe(2);
    const plain = applyEffects(s.board, [{ type: 'tag', at: sq('a2'), tag: '질주', turns: 1, moveTimes: 1 }], ctx);
    expect(plain.ok && plain.board[sq('a2')]?.tags?.[0].moveTimes).toBeUndefined();
    expect(applyEffects(s.board, [{ type: 'tag', at: sq('a2'), tag: '질주', turns: 1, moveTimes: 9 }], ctx).ok).toBe(false);
  });
});
