import { describe, expect, it } from 'vitest';
import {
  AIR,
  LEVITATE,
  applyCommand,
  applyEffects,
  createStateFrom,
  isInCheck,
  legalTargets,
  parseSquare,
  squareName,
  type Effect,
  type GameState,
  type Piece,
  type Ruling,
  type TerrainCell,
} from './index';
import { footprint, restingPlace } from './levitation';
import { ok, okMove, sq } from './testUtil';

const air = (name: string) => sq(name) + AIR;
const floating = (p: Piece, turns: number | null = 2, on = 0): Piece => ({ ...p, tags: [...(p.tags ?? []), { name: LEVITATE, turnsLeft: turns, appliedOnTurn: on }] });

/** Kings on e1/e8 and the given extra pieces; `up` names pieces to put in the air above their square. */
function scene(extra: Record<string, { color: 'white' | 'black'; type: Piece['type'] }>, up: string[] = [], turns: number | null = 2): GameState {
  const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, ...extra }, 'white');
  const board = [...s.board];
  for (const name of up) {
    board[air(name)] = floating(board[sq(name)]!, turns);
    board[sq(name)] = null;
  }
  return { ...s, board };
}

const ctx = { turnNumber: 1, nextSpawnId: 1, color: 'white' as const };
const targets = (s: GameState, from: number) => legalTargets(s, from).map((t) => squareName(t.to)).sort();

describe('squares of the air', () => {
  it('"e4^" is the air above e4', () => {
    expect(parseSquare('e4^')).toBe(sq('e4') + AIR);
    expect(squareName(sq('e4') + AIR)).toBe('e4^');
    expect(parseSquare('e4')).toBe(sq('e4'));
  });
});

describe('rising', () => {
  it('공중부양 lifts a piece into the air above its square', () => {
    const s = scene({ d2: { color: 'white', type: 'rook' } });
    const r = applyEffects(s.board, [{ type: 'tag', at: sq('d2'), tag: LEVITATE, turns: 2 }], ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.board[sq('d2')]).toBeNull();
    expect(r.board[air('d2')]).toMatchObject({ type: 'rook', tags: [{ name: LEVITATE, turnsLeft: 2 }] });
    expect(r.events).toEqual([
      { type: 'lifted', pieceId: 'white-rook-d2', from: sq('d2'), to: air('d2') },
      { type: 'tagged', pieceId: 'white-rook-d2', at: air('d2'), tag: LEVITATE, turns: 2 },
    ]);
  });

  it('not into an occupied air square; nothing crosses layers by a move, swap or ride', () => {
    const s = scene({ d2: { color: 'white', type: 'rook' }, c3: { color: 'white', type: 'pawn' }, d4: { color: 'white', type: 'knight' } }, ['d4']);
    const board = [...s.board];
    board[air('d2')] = floating({ id: 'x', color: 'black', type: 'pawn' });
    const fails = (effects: Effect[]) => {
      const r = applyEffects(board, effects, ctx);
      return r.ok ? null : r.detail;
    };
    expect(fails([{ type: 'tag', at: sq('d2'), tag: LEVITATE, turns: 1 }])).toMatch(/이미 기물/);
    expect(fails([{ type: 'move', from: sq('c3'), to: air('c4') }])).toMatch(/땅과 공중/);
    expect(fails([{ type: 'swap', a: sq('c3'), b: air('d4') }])).toMatch(/땅과 공중/);
    expect(fails([{ type: 'spawn', at: air('a5'), color: 'white', piece: 'pawn' }])).toMatch(/공중 칸/);
    expect(fails([{ type: 'terrain', at: air('a5'), kind: 'wall', turns: 1 }])).toMatch(/땅에만/);
  });
});

describe('two boards that do not meet', () => {
  it('a floating rook moves over the ground pieces and captures only in the air', () => {
    const s = scene({ a1: { color: 'white', type: 'rook' }, a4: { color: 'black', type: 'pawn' }, c1: { color: 'white', type: 'bishop' }, a6: { color: 'black', type: 'knight' } }, ['a1', 'a6']);
    // Up the a-file over the ground pawn on a4 to the floating knight on a6 (taken); along rank 1 over the bishop and the king.
    expect(targets(s, air('a1'))).toEqual(['a2^', 'a3^', 'a4^', 'a5^', 'a6^', 'b1^', 'c1^', 'd1^', 'e1^', 'f1^', 'g1^', 'h1^']);
    const took = ok(applyCommand(s, { type: 'move', from: air('a1'), to: air('a6') }));
    expect(took.events[0]).toMatchObject({ type: 'moved', from: air('a1'), to: air('a6'), captured: { type: 'knight' } });
    expect(took.state.board[sq('a4')]?.type).toBe('pawn');
  });

  it('ground pieces pass under the air, and a ground move cannot take a floating piece', () => {
    const s = scene({ a1: { color: 'white', type: 'rook' }, a5: { color: 'black', type: 'pawn' } }, ['a5']);
    expect(targets(s, sq('a1'))).toContain('a8');
    expect(targets(s, sq('a1'))).not.toContain('a5^');
  });

  it('check stays on its layer', () => {
    const s = scene({ e5: { color: 'black', type: 'rook' } }, ['e5']);
    expect(isInCheck(s.board, 'white', s.terrain)).toBe(false);
    const k = scene({ a8: { color: 'black', type: 'rook' } }, ['e1', 'a8']);
    expect(isInCheck(k.board, 'white', k.terrain)).toBe(false);
    const k2 = scene({ e7: { color: 'black', type: 'rook' } }, ['e1', 'e7']);
    expect(isInCheck(k2.board, 'white', k2.terrain)).toBe(true);
  });
});

describe('footprint', () => {
  it('a piece resting on a square covers only it; on a corner, four about evenly', () => {
    expect(footprint(4, 3)).toEqual([{ sq: sq('e4'), share: 1 }]);
    const corner = footprint(3.5, 3.5);
    expect(corner.map((c) => c.sq).sort((a, b) => a! - b!)).toEqual([sq('d4'), sq('e4'), sq('d5'), sq('e5')]);
    for (const c of corner) expect(c.share).toBeCloseTo(0.25, 1);
    expect(footprint(4.4, 3)[0].sq).toBe(sq('e4'));
    expect(footprint(4.6, 3)[0].sq).toBe(sq('f4'));
    expect(footprint(-0.9, 3)[0].sq).toBeNull();
  });

  it('the free square it covers most; a pit buries; nothing free or off the board shatters', () => {
    const s = scene({ e4: { color: 'white', type: 'pawn' } });
    const pit: TerrainCell[] = [{ at: sq('f4'), kind: 'pit', turnsLeft: null, owner: 'white', appliedOnTurn: 1 }];
    expect(restingPlace(s.board, [], 4.3, 3)).toEqual({ to: sq('f4'), result: 'landed' });
    expect(restingPlace(s.board, pit, 4.3, 3)).toEqual({ to: sq('f4'), result: 'buried' });
    expect(restingPlace(s.board, [], 4, 3)).toEqual({ to: sq('e4'), result: 'shattered' });
    expect(restingPlace(s.board, [], 8.2, 3)).toEqual({ to: null, result: 'shattered' });
  });
});

describe('falling', () => {
  /** White's floating knight on d4 with one turn left; black pawns around it. */
  const up = () => scene({ d4: { color: 'white', type: 'knight' }, a2: { color: 'white', type: 'pawn' }, h7: { color: 'black', type: 'pawn' } }, ['d4'], 1);

  it('when its levitation runs out at the end of its owner\'s turn it falls, and nothing happens until it lands', () => {
    const r = okMove(up(), 'a2', 'a3');
    expect(r.events).toContainEqual({ type: 'tagExpired', pieceId: 'white-knight-d4', tag: LEVITATE });
    expect(r.events).toContainEqual({ type: 'fallStarted', pieceId: 'white-knight-d4', at: air('d4') });
    expect(r.state.board[air('d4')]).toBeNull();
    expect(r.state.falling).toEqual([{ piece: expect.objectContaining({ id: 'white-knight-d4' }), from: air('d4') }]);
    expect(r.state.turn).toBe('black');
    expect(applyCommand(r.state, { type: 'move', from: sq('h7'), to: sq('h6') })).toMatchObject({ ok: false, reason: 'landingPending' });
    const landed = ok(applyCommand(r.state, { type: 'land', seed: 7, landings: [{ id: 'white-knight-d4', file: 3.4, rank: 3.1 }] }));
    expect(landed.events[0]).toEqual({ type: 'fell', seed: 7, falls: [{ pieceId: 'white-knight-d4', from: air('d4'), to: sq('d4'), result: 'landed' }] });
    expect(landed.state.board[sq('d4')]).toMatchObject({ type: 'knight', tags: [] });
    expect(landed.state.falling).toBeUndefined();
    expect(okMove(landed.state, 'h7', 'h6').state.turn).toBe('white');
  });

  it('without a landing it drops straight down', () => {
    const r = okMove(up(), 'a2', 'a3');
    const landed = ok(applyCommand(r.state, { type: 'land', seed: 1, landings: [] }));
    expect(landed.state.board[sq('d4')]?.type).toBe('knight');
  });

  it('buried in a pit, shattered off the board: taken, with how they went', () => {
    const r = okMove({ ...up(), terrain: [{ at: sq('d4'), kind: 'pit', turnsLeft: null, owner: 'black', appliedOnTurn: 1 }] }, 'a2', 'a3');
    const buried = ok(applyCommand(r.state, { type: 'land', seed: 1, landings: [] }));
    expect(buried.events[1]).toMatchObject({ type: 'removed', at: sq('d4'), cause: 'pit', exit: 'sink' });
    expect(buried.state.captured).toEqual([expect.objectContaining({ type: 'knight', exit: 'sink' })]);
    const off = ok(applyCommand(okMove(up(), 'a2', 'a3').state, { type: 'land', seed: 1, landings: [{ id: 'white-knight-d4', file: -1.2, rank: 3 }] }));
    expect(off.events[0]).toMatchObject({ falls: [{ result: 'shattered', to: null }] });
    expect(off.state.captured).toEqual([expect.objectContaining({ type: 'knight', exit: 'shatter' })]);
  });

  it('a king is never killed by a fall, and a shield breaks to save its piece', () => {
    const s = scene({ a2: { color: 'white', type: 'pawn' }, d2: { color: 'white', type: 'rook' } }, ['e1', 'd2'], 1);
    const b = [...s.board];
    b[air('d2')] = { ...b[air('d2')]!, tags: [...b[air('d2')]!.tags!, { name: '보호막', turnsLeft: null, appliedOnTurn: 1 }] };
    const r = okMove({ ...s, board: b }, 'a2', 'a3');
    const landed = ok(applyCommand(r.state, { type: 'land', seed: 1, landings: [{ id: 'white-king-e1', file: 9, rank: 0 }, { id: 'white-rook-d2', file: 12, rank: 0 }] }));
    const falls = (landed.events[0] as Extract<typeof landed.events[0], { type: 'fell' }>).falls;
    expect(falls.map((f) => f.result)).toEqual(['pushed', 'pushed']);
    expect(landed.events).toContainEqual(expect.objectContaining({ type: 'shieldBroken', pieceId: 'white-rook-d2' }));
    expect(landed.state.board.filter((p) => p?.color === 'white').map((p) => p!.type).sort()).toEqual(['king', 'pawn', 'rook']);
  });

  it('taking the levitation away makes it fall at once (a special action)', () => {
    const s = { ...scene({ d4: { color: 'black', type: 'knight' }, d3: { color: 'white', type: 'rook' } }, ['d4']), ap: { white: 3, black: 0 } };
    const ruling: Ruling = {
      interpretation: 'x',
      actor: sq('d3'),
      means: 'touch',
      feasible: true,
      dc: 5,
      cost: 1,
      effects: [{ type: 'untag', at: air('d4'), tag: LEVITATE }],
      narration: { success: 's', failure: 'f' },
    };
    const p = ok(applyCommand(s, { type: 'proposeSpecial', action: 'a', ruling }));
    const r = ok(applyCommand(p.state, { type: 'attemptSpecial', roll: 5 }));
    expect(r.state.falling).toEqual([{ piece: expect.objectContaining({ id: 'black-knight-d4' }), from: air('d4') }]);
    expect(r.state.turn).toBe('white');
  });
});
