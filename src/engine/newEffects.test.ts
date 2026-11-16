import { describe, expect, it } from 'vitest';
import {
  BURN,
  MAX_TERRAIN,
  applyCommand,
  createInitialState,
  createStateFrom,
  isInCheck,
  legalTargets,
  squareName,
  type Effect,
  type GameState,
  type Ruling,
} from './index';
import { ok, okMove, passTurn, sq } from './testUtil';

const ruling = (effects: Effect[]): Ruling => ({
  interpretation: 'x',
  feasible: true,
  dc: 4,
  cost: 1,
  effects,
  narration: { success: 's', failure: 'f' },
});

/** Proposes and succeeds (roll 6) a special action for the side to move. */
const act = (state: GameState, ...effects: Effect[]) => {
  const proposed = applyCommand({ ...state, ap: { white: 9, black: 9, red: 0 } }, { type: 'proposeSpecial', action: 'act', ruling: ruling(effects) });
  if (!proposed.ok) throw new Error(`proposal rejected: ${proposed.detail ?? proposed.reason}`);
  return ok(applyCommand(proposed.state, { type: 'attemptSpecial', roll: 6 }));
};
const proposeFails = (state: GameState, ...effects: Effect[]) => {
  const r = applyCommand({ ...state, ap: { white: 9, black: 9, red: 0 } }, { type: 'proposeSpecial', action: 'act', ruling: ruling(effects) });
  expect(r).toMatchObject({ ok: false, reason: 'invalidRuling' });
  return r.ok ? '' : r.detail ?? '';
};
const legal = (s: GameState, from: string) => legalTargets(s, sq(from)).map((t) => squareName(t.to)).sort();
const idAt = (s: GameState, at: string) => s.board[sq(at)]?.id;

describe('swap (맞바꾸기)', () => {
  it('two pieces trade squares, whatever their sides', () => {
    const s0 = createInitialState();
    const s = act(s0, { type: 'swap', a: sq('e2'), b: sq('d7') });
    expect(idAt(s.state, 'e2')).toBe(idAt(s0, 'd7'));
    expect(idAt(s.state, 'd7')).toBe(idAt(s0, 'e2'));
    expect(s.events).toContainEqual({ type: 'swapped', aId: idAt(s0, 'e2'), bId: idAt(s0, 'd7'), a: sq('e2'), b: sq('d7') });
    expect(s.state.captured).toEqual([]);
  });

  it('a rider goes with its carrier', () => {
    let s = act(createInitialState(), { type: 'board', rider: sq('a2'), carrier: sq('b1') }).state;
    s = passTurn(passTurn(s));
    const r = act(s, { type: 'swap', a: sq('b1'), b: sq('e2') }).state;
    expect(r.board[sq('e2')]?.rider?.type).toBe('pawn');
    expect(r.board[sq('b1')]?.type).toBe('pawn');
  });

  it('needs two pieces that can move', () => {
    const s = createInitialState();
    expect(proposeFails(s, { type: 'swap', a: sq('e2'), b: sq('e4') })).toContain('기물이 없음');
    expect(proposeFails(s, { type: 'swap', a: sq('e2'), b: sq('e2') })).toContain('같은 칸');
    const stunned = act(s, { type: 'tag', at: sq('d7'), tag: '기절', turns: 1 }).state;
    expect(proposeFails(stunned, { type: 'swap', a: sq('e2'), b: sq('d7') })).toContain('기절');
  });
});

describe('revive (되살리기)', () => {
  const afterRemoval = () => act(createInitialState(), { type: 'remove', at: sq('b8') });

  it('the taken piece comes back to an empty square, with its own id, and leaves the side of the board', () => {
    const s = afterRemoval().state;
    expect(s.captured.map((p) => p.type)).toEqual(['knight']);
    const knight = s.captured[0].id;
    const r = act(passTurn(s), { type: 'revive', at: sq('c6'), color: 'black', piece: 'knight' });
    expect(r.state.board[sq('c6')]).toEqual({ id: knight, color: 'black', type: 'knight' });
    expect(r.state.captured).toEqual([]);
    expect(r.events).toContainEqual({ type: 'revived', piece: { id: knight, color: 'black', type: 'knight' }, at: sq('c6') });
  });

  it('brings back the most recently taken one of that kind', () => {
    let s = afterRemoval().state;
    s = act(passTurn(passTurn(s)), { type: 'remove', at: sq('g8') }).state;
    const r = act(s, { type: 'revive', at: sq('f6'), color: 'black', piece: 'knight' }).state;
    expect(r.board[sq('f6')]?.id).toBe(s.captured[1].id);
    expect(r.captured.map((p) => p.id)).toEqual([s.captured[0].id]);
  });

  it('can take back a piece removed earlier in the same effects', () => {
    const r = act(createInitialState(), { type: 'remove', at: sq('d7') }, { type: 'revive', at: sq('d5'), color: 'black', piece: 'pawn' }).state;
    expect(r.board[sq('d5')]?.type).toBe('pawn');
    expect(r.captured).toEqual([]);
  });

  it('needs such a piece beside the board and an empty square', () => {
    const s = afterRemoval().state;
    expect(proposeFails(s, { type: 'revive', at: sq('c6'), color: 'black', piece: 'rook' })).toContain('잡힌 흑 룩');
    expect(proposeFails(s, { type: 'revive', at: sq('c7'), color: 'black', piece: 'knight' })).toContain('비어 있지 않음');
    expect(proposeFails(s, { type: 'revive', at: sq('c6'), color: 'black', piece: 'king' })).toContain('킹');
  });
});

describe('화상 (burn)', () => {
  const burnt = (turns = 3) => act(createInitialState(), { type: 'tag', at: sq('g8'), tag: BURN, turns }).state;

  it('a piece that is not moved off its square burns up when its owner\'s turns run out', () => {
    let s = burnt(3);
    const knight = idAt(s, 'g8')!;
    s = okMove(s, 'e2', 'e4').state; // white's turn: does not count for a black piece
    s = okMove(s, 'a7', 'a6').state; // black 1
    s = okMove(s, 'd2', 'd3').state;
    s = okMove(s, 'a6', 'a5').state; // black 2
    s = okMove(s, 'h2', 'h3').state;
    expect(s.board[sq('g8')]?.tags).toEqual([{ name: BURN, turnsLeft: 1, appliedOnTurn: 1 }]);
    const r = okMove(s, 'b7', 'b6'); // black 3: burns up
    expect(r.state.board[sq('g8')]).toBeNull();
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'removed', at: sq('g8'), cause: 'burn' }));
    expect(r.state.captured).toEqual([{ id: knight, color: 'black', type: 'knight', exit: 'ash' }]);
  });

  it('moving the piece puts the fire out', () => {
    let s = okMove(burnt(1), 'e2', 'e4').state;
    const r = okMove(s, 'g8', 'f6');
    expect(r.events).toContainEqual({ type: 'untagged', pieceId: idAt(s, 'g8'), at: sq('f6'), tag: BURN });
    s = okMove(r.state, 'd2', 'd3').state;
    s = okMove(s, 'a7', 'a6').state;
    expect(s.board[sq('f6')]?.type).toBe('knight');
    expect(s.board[sq('f6')]?.tags).toEqual([]);
  });

  it('being moved by an effect puts it out too', () => {
    const r = act(createInitialState(), { type: 'tag', at: sq('g8'), tag: BURN, turns: 1 }, { type: 'move', from: sq('g8'), to: sq('g5') }).state;
    expect(r.board[sq('g5')]?.tags).toEqual([]);
  });

  it('a shield takes the blow instead', () => {
    let s = act(createInitialState(), { type: 'tag', at: sq('g8'), tag: BURN, turns: 1 }, { type: 'tag', at: sq('g8'), tag: '보호막', turns: 0 }).state;
    s = okMove(s, 'e2', 'e4').state;
    const r = okMove(s, 'a7', 'a6');
    expect(r.state.board[sq('g8')]?.tags).toEqual([]);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'shieldBroken', at: sq('g8') }));
  });

  it('cannot be put on a king, and always runs out', () => {
    const s = createInitialState();
    expect(proposeFails(s, { type: 'tag', at: sq('e8'), tag: BURN, turns: 2 })).toContain('킹');
    expect(proposeFails(s, { type: 'tag', at: sq('g8'), tag: BURN, turns: 0 })).toContain('1턴 이상');
  });

  it('a piece burning up warns when it opened a line onto its own king', () => {
    let s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, e2: { color: 'white', type: 'bishop' }, e6: { color: 'black', type: 'rook' } });
    s = act(s, { type: 'tag', at: sq('e2'), tag: BURN, turns: 1 }).state;
    s = passTurn(passTurn(s));
    const r = ok(applyCommand({ ...s, usedApThisTurn: true }, { type: 'endTurn' }));
    expect(r.state.board[sq('e2')]).toBeNull();
    expect(r.events).toContainEqual({ type: 'check', color: 'white' });
  });
});

describe('terrain (벽, 구덩이)', () => {
  const lone = () =>
    createStateFrom({ a1: { color: 'white', type: 'rook' }, e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, b1: { color: 'white', type: 'knight' }, c2: { color: 'white', type: 'pawn' } });

  it('a wall stops sliders and pawns, and knights jump over it', () => {
    const s = act(lone(), { type: 'terrain', at: sq('a4'), kind: 'wall', turns: 3 }, { type: 'terrain', at: sq('c3'), kind: 'wall', turns: 3 }).state;
    expect(legal(s, 'a1')).toEqual(['a2', 'a3']);
    expect(legal(s, 'c2')).toEqual([]);
    expect(legal(s, 'b1')).toEqual(['a3', 'd2']);
  });

  it('nothing lands on terrain, by a move or an effect', () => {
    const s = act(lone(), { type: 'terrain', at: sq('a3'), kind: 'pit', turns: 3 }).state;
    expect(legal(s, 'b1')).toEqual(['c3', 'd2']);
    expect(proposeFails(s, { type: 'spawn', at: sq('a3'), color: 'white', piece: 'pawn' })).toContain('구덩이');
    const walled = act(lone(), { type: 'terrain', at: sq('a3'), kind: 'wall', turns: 3 }).state;
    expect(proposeFails(walled, { type: 'move', from: sq('b1'), to: sq('a3') })).toContain('벽');
  });

  it('a wall needs an empty square; a pit swallows what stands there (not a king)', () => {
    const s = lone();
    expect(proposeFails(s, { type: 'terrain', at: sq('b1'), kind: 'wall', turns: 2 })).toContain('빈 칸');
    expect(proposeFails(s, { type: 'terrain', at: sq('e8'), kind: 'pit', turns: 2 })).toContain('킹');
    const r = act(s, { type: 'terrain', at: sq('b1'), kind: 'pit', turns: 2 });
    expect(r.state.board[sq('b1')]).toBeNull();
    expect(r.state.captured).toEqual([expect.objectContaining({ type: 'knight', exit: 'sink' })]);
    expect(r.state.terrain).toEqual([{ at: sq('b1'), kind: 'pit', turnsLeft: 2, owner: 'white', appliedOnTurn: 1 }]);
  });

  it('a piece thrown into a pit falls in', () => {
    const s = act(lone(), { type: 'terrain', at: sq('d4'), kind: 'pit', turns: 2 }, { type: 'move', from: sq('b1'), to: sq('d4') });
    expect(s.state.board[sq('b1')]).toBeNull();
    expect(s.state.board[sq('d4')]).toBeNull();
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'removed', at: sq('d4'), cause: 'pit' }));
  });

  it('lasts its maker\'s turns, then goes', () => {
    let s = act(lone(), { type: 'terrain', at: sq('a4'), kind: 'wall', turns: 1 }).state;
    s = passTurn(s); // white's own turn it was made on: does not count
    s = passTurn(s); // black's turn: not white's
    expect(s.terrain).toHaveLength(1);
    const r = ok(applyCommand({ ...s, usedApThisTurn: true }, { type: 'endTurn' }));
    expect(r.state.terrain).toEqual([]);
    expect(r.events).toContainEqual({ type: 'terrainCleared', at: sq('a4'), kind: 'wall', expired: true });
  });

  it('a wall blocks a check, and castling past it', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, h1: { color: 'white', type: 'rook' }, e8: { color: 'black', type: 'rook' }, a8: { color: 'black', type: 'king' } }, 'white', {
      castling: { white: { kingSide: true, queenSide: false }, black: { kingSide: false, queenSide: false }, red: { kingSide: false, queenSide: false } },
    });
    expect(isInCheck(s.board, 'white')).toBe(true);
    const walled = { ...s, terrain: [{ at: sq('e5'), kind: 'wall' as const, turnsLeft: 2, owner: 'white' as const, appliedOnTurn: 1 }] };
    expect(isInCheck(walled.board, 'white', walled.terrain)).toBe(false);
    expect(legal(walled, 'e1')).toContain('g1');
    const blocked = { ...walled, terrain: [...walled.terrain, { at: sq('f1'), kind: 'pit' as const, turnsLeft: 2, owner: 'white' as const, appliedOnTurn: 1 }] };
    expect(legal(blocked, 'e1')).not.toContain('g1');
  });

  it('can be taken away, and the board holds only so much of it', () => {
    let s = act(lone(), { type: 'terrain', at: sq('d4'), kind: 'wall', turns: 0 }).state;
    const r = act(passTurn(passTurn(s)), { type: 'clearTerrain', at: sq('d4') });
    expect(r.state.terrain).toEqual([]);
    expect(r.events).toContainEqual({ type: 'terrainCleared', at: sq('d4'), kind: 'wall', expired: false });
    const many = Array.from({ length: MAX_TERRAIN }, (_, i) => ({ at: 16 + i, kind: 'wall' as const, turnsLeft: null, owner: 'white' as const, appliedOnTurn: 1 }));
    s = { ...lone(), terrain: many };
    expect(proposeFails(s, { type: 'terrain', at: sq('h6'), kind: 'wall', turns: 1 })).toContain(`최대 ${MAX_TERRAIN}칸`);
  });
});
