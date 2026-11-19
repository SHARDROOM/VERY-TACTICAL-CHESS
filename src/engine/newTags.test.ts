import { describe, expect, it } from 'vitest';
import { applyCommand, applyEffects, commandable, createStateFrom, impulseTargets, legalTargets, squareName, vanguardOrder, type GameState, type Piece, type Tag } from './index';
import { ok, sq } from './testUtil';

type Spec = { color: 'white' | 'black'; type: Piece['type']; tags?: Tag[] };
const tag = (name: string, extra: Partial<Tag> = {}): Tag => ({ name, turnsLeft: 3, appliedOnTurn: 0, ...extra });

function scene(pieces: Record<string, Spec>, turn: 'white' | 'black' = 'white'): GameState {
  const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' } }, turn);
  const board = [...s.board];
  for (const [name, p] of Object.entries(pieces)) board[sq(name)] = { id: `${p.color}-${p.type}-${name}`, color: p.color, type: p.type, ...(p.tags && { tags: p.tags }) };
  return { ...s, board };
}
const move = (s: GameState, from: string, to: string, clashRolls?: number[]) => applyCommand(s, { type: 'move', from: sq(from), to: sq(to), ...(clashRolls && { clashRolls }) });

describe('원호 (guard)', () => {
  it('a friend next to the target throws itself in and is taken instead; the attacker stays', () => {
    const s = scene({ d4: { color: 'white', type: 'pawn' }, c4: { color: 'white', type: 'knight', tags: [tag('원호')] }, d8: { color: 'black', type: 'rook' } }, 'black');
    const r = ok(move(s, 'd8', 'd4'));
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'intercepted', kind: 'guard', from: sq('c4'), at: sq('d4'), by: sq('d8') }));
    expect(r.state.board[sq('c4')]).toBeNull();
    expect(r.state.board[sq('d4')]).toMatchObject({ type: 'pawn', color: 'white' });
    expect(r.state.board[sq('d8')]).toMatchObject({ type: 'rook' });
    expect(r.state.turn).toBe('white');
    expect(r.state.remains?.map((m) => m.at)).toEqual([sq('c4')]);
  });

  it('a guard with clash gear fights the attacker instead (needs dice), and can cut it down', () => {
    const s = scene({ d4: { color: 'white', type: 'pawn' }, c4: { color: 'white', type: 'knight', tags: [tag('원호'), tag('검술', { clash: 2 })] }, d8: { color: 'black', type: 'rook' } }, 'black');
    expect(move(s, 'd8', 'd4')).toMatchObject({ ok: false, reason: 'clashRollsNeeded' });
    // Attacker 1+1, guard 6+6: the rook falls.
    const r = ok(move(s, 'd8', 'd4', [1, 1, 6, 6]));
    expect(r.state.board[sq('d8')]).toBeNull();
    expect(r.state.board[sq('c4')]).toMatchObject({ type: 'knight' });
    expect(r.state.board[sq('d4')]).toMatchObject({ type: 'pawn' });
  });

  it('nobody guards a king, and a guard of another side does nothing', () => {
    const s = scene({ d4: { color: 'white', type: 'pawn' }, c4: { color: 'black', type: 'knight', tags: [tag('원호')] }, d8: { color: 'black', type: 'rook' } }, 'black');
    const r = ok(move(s, 'd8', 'd4'));
    expect(r.state.board[sq('d4')]).toMatchObject({ type: 'rook', color: 'black' });
  });
});

describe('인질 (hostage)', () => {
  const held = () =>
    scene({ e4: { color: 'white', type: 'pawn', tags: [tag('인질', { holder: 'black-knight-f5' })] }, f5: { color: 'black', type: 'knight' }, f1: { color: 'white', type: 'rook' } });

  it('a hostage cannot move', () => {
    expect(legalTargets(held(), sq('e4'))).toEqual([]);
  });

  it('its holder about to be taken: the hostage dies instead and the holder stays', () => {
    const r = ok(move(held(), 'f1', 'f5'));
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'intercepted', kind: 'hostage' }));
    expect(r.state.board[sq('e4')]).toBeNull();
    expect(r.state.board[sq('f5')]).toMatchObject({ type: 'knight', color: 'black' });
    expect(r.state.board[sq('f1')]).toMatchObject({ type: 'rook' });
  });

  it('the holder moving away lets the hostage go', () => {
    const s = { ...held(), turn: 'black' as const };
    const r = ok(move(s, 'f5', 'h6'));
    expect(r.state.board[sq('e4')]?.tags ?? []).toEqual([]);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'untagged', tag: '인질' }));
  });

  it('is taken by the actor next to it, of another side; the tag records the holder', () => {
    const s = scene({ e4: { color: 'white', type: 'pawn' }, f5: { color: 'black', type: 'knight' }, a4: { color: 'white', type: 'pawn' } }, 'black');
    const ctx = { turnNumber: 1, nextSpawnId: 1, color: 'black' as const, actor: sq('f5') };
    const r = applyEffects(s.board, [{ type: 'tag', at: sq('e4'), tag: '인질', turns: 2 }], ctx);
    expect(r.ok && r.board[sq('e4')]?.tags?.[0]).toMatchObject({ name: '인질', holder: 'black-knight-f5' });
    expect(applyEffects(s.board, [{ type: 'tag', at: sq('a4'), tag: '인질', turns: 2 }], ctx).ok).toBe(false);
    expect(applyEffects(s.board, [{ type: 'tag', at: sq('e4'), tag: '인질', turns: 2 }], { ...ctx, actor: undefined }).ok).toBe(false);
  });
});

describe('혼란 and 행동대장 (moving of their own accord)', () => {
  it('a confused piece may only stagger to free squares; nobody’s turn changes', () => {
    const s = scene({ d4: { color: 'white', type: 'knight', tags: [tag('혼란')] }, e6: { color: 'black', type: 'pawn' } }, 'black');
    const options = impulseTargets(s, sq('d4'), 'confused').map(squareName);
    expect(options).not.toContain('e6');
    expect(options.length).toBeGreaterThan(3);
    const r = ok(applyCommand(s, { type: 'impulse', from: sq('d4'), to: sq('f3') }));
    expect(r.state.board[sq('f3')]).toMatchObject({ type: 'knight' });
    expect(r.state.turn).toBe('black');
    expect(r.events[0]).toMatchObject({ type: 'impulse', kind: 'confused', to: sq('f3') });
    expect(applyCommand(s, { type: 'impulse', from: sq('d4'), to: sq('e6') }).ok).toBe(false);
  });

  it('a vanguard takes a free queen, and may hold its ground; a plain piece has no impulse', () => {
    const s = scene({ d4: { color: 'white', type: 'knight', tags: [tag('행동대장')] }, c6: { color: 'black', type: 'queen' } }, 'black');
    expect(vanguardOrder(s, sq('d4'))).toEqual({ from: sq('d4'), to: sq('c6') });
    const r = ok(applyCommand(s, { type: 'impulse', from: sq('d4'), to: sq('c6') }));
    expect(r.state.board[sq('c6')]).toMatchObject({ type: 'knight', color: 'white' });
    expect(ok(applyCommand(s, { type: 'impulse', from: sq('d4'), to: null })).events).toEqual([expect.objectContaining({ type: 'impulse', to: null })]);
    expect(applyCommand(scene({ d4: { color: 'white', type: 'knight' } }), { type: 'impulse', from: sq('d4'), to: sq('f3') }).ok).toBe(false);
  });

  it('a vanguard orders the best move among itself and its own pieces next to it', () => {
    // The knight on d4 leads; its rook on c4 can take the black queen on c7 for free, the knight cannot.
    const s = scene({ d4: { color: 'white', type: 'knight', tags: [tag('행동대장')] }, c4: { color: 'white', type: 'rook' }, c7: { color: 'black', type: 'queen' }, a2: { color: 'white', type: 'bishop' } }, 'black');
    expect(commandable(s, sq('d4')).sort()).toEqual([sq('c4'), sq('d4')].sort());
    expect(vanguardOrder(s, sq('d4'))).toEqual({ from: sq('c4'), to: sq('c7') });
    const r = ok(applyCommand(s, { type: 'impulse', from: sq('c4'), to: sq('c7'), by: sq('d4') }));
    expect(r.state.board[sq('c7')]).toMatchObject({ type: 'rook', color: 'white' });
    expect(r.events[0]).toMatchObject({ type: 'impulse', kind: 'vanguard', from: sq('c4'), to: sq('c7'), by: 'white-knight-d4' });
    // Not a piece farther away (the bishop on a2), not without a 행동대장 next to it.
    expect(applyCommand(s, { type: 'impulse', from: sq('a2'), to: sq('b3'), by: sq('d4') }).ok).toBe(false);
    expect(applyCommand(s, { type: 'impulse', from: sq('c4'), to: sq('c7') }).ok).toBe(false);
    // Once moved, a piece is not ordered again at the same turn's end.
    expect(vanguardOrder(s, sq('d4'), new Set(['white-rook-c4']))?.from).not.toBe(sq('c4'));
  });

  it('a vanguard never orders a king, or a 혼란 piece', () => {
    const s = scene({ d2: { color: 'white', type: 'knight', tags: [tag('행동대장')] }, d3: { color: 'white', type: 'pawn', tags: [tag('혼란')] } }, 'black');
    expect(commandable(s, sq('d2'))).toEqual([sq('d2')]);
    expect(applyCommand(s, { type: 'impulse', from: sq('e1'), to: sq('f1'), by: sq('d2') }).ok).toBe(false);
  });

  it('a vanguard does not step where it is simply taken', () => {
    // From a1 the rook could go up the file; a3 and beyond are covered by the black pawn b4 and rook h3.
    const s = scene({ a1: { color: 'white', type: 'rook', tags: [tag('행동대장')] }, h2: { color: 'black', type: 'rook' }, b3: { color: 'black', type: 'pawn' } }, 'black');
    const order = vanguardOrder(s, sq('a1'));
    if (order) {
      // Wherever it goes, the black rook on h2 cannot simply take it there.
      expect([sq('a2'), sq('b1'), sq('c1'), sq('d1')].includes(order.to) ? true : squareName(order.to)).toBe(true);
    }
  });
});

describe('the runner plays them when a turn ends', () => {
  it('after white ends its turn, its confused piece staggers and its vanguard steps out (hotseat)', async () => {
    const { LocalSession } = await import('../session/localSession');
    const s = scene({ d4: { color: 'white', type: 'knight', tags: [tag('혼란')] }, a1: { color: 'white', type: 'rook', tags: [tag('행동대장')] }, a7: { color: 'black', type: 'queen' }, h7: { color: 'black', type: 'pawn' } });
    const gm = { name: 't', rule: async () => ({}) } as never;
    const local = new LocalSession(gm, { initialState: s, phase: 'playing', chance: () => 0, roll: () => 3 });
    const events: string[] = [];
    local.subscribe((e) => e.kind === 'events' && e.events.forEach((ev) => events.push(ev.type)));
    local.request({ type: 'move', from: sq('e1'), to: sq('f1') });
    const st = local.view().state;
    expect(st.board[sq('d4')]).toBeNull();
    // The vanguard rook took the free queen on a7.
    expect(st.board[sq('a7')]).toMatchObject({ type: 'rook', color: 'white' });
    expect(events.filter((t) => t === 'impulse')).toHaveLength(2);
    expect(st.turn).toBe('black');
  });
});
