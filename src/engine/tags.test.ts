import { describe, expect, it } from 'vitest';
import {
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
import { move, ok, okMove, passTurn, play, sq } from './testUtil';

const ruling = (effects: Effect[], over: Partial<Ruling> = {}): Ruling => ({
  interpretation: 'x',
  feasible: true,
  dc: 10,
  cost: 1,
  effects,
  narration: { success: 's', failure: 'f' },
  ...over,
});

/** Proposes and succeeds (roll 20) a special action for the side to move. */
const act = (state: GameState, ...effects: Effect[]) => {
  const proposed = applyCommand(state, { type: 'proposeSpecial', action: 'act', ruling: ruling(effects) });
  if (!proposed.ok) throw new Error(`proposal rejected: ${proposed.detail ?? proposed.reason}`);
  return ok(applyCommand(proposed.state, { type: 'attemptSpecial', roll: 20 }));
};
const proposeFails = (state: GameState, ...effects: Effect[]) => {
  const r = applyCommand(state, { type: 'proposeSpecial', action: 'act', ruling: ruling(effects) });
  expect(r).toMatchObject({ ok: false, reason: 'invalidRuling' });
  return r.ok ? '' : r.detail ?? '';
};
const endTurn = (s: GameState) => passTurn(s);
const rich = (): GameState => ({ ...createInitialState(), ap: { white: 5, black: 5 } });
const legal = (s: GameState, from: string) => legalTargets(s, sq(from)).map((t) => squareName(t.to)).sort();
const tagsAt = (s: GameState, at: string) => s.board[sq(at)]?.tags?.map((t) => [t.name, t.turnsLeft]) ?? [];

describe('stun (기절)', () => {
  it('a stunned piece cannot make normal moves', () => {
    const s = act(rich(), { type: 'tag', at: sq('g1'), tag: '기절', turns: 0 }).state;
    expect(legal(s, 'g1')).toEqual([]);
    expect(move(s, 'g1', 'f3')).toMatchObject({ ok: false, reason: 'illegalMove' });
  });

  it('a stunned piece cannot be moved by an effect either', () => {
    const s = act(rich(), { type: 'tag', at: sq('g1'), tag: '기절', turns: 0 }).state;
    expect(proposeFails(s, { type: 'move', from: sq('g1'), to: sq('e5') })).toContain('기절');
  });

  it('a 1-turn stun on an enemy piece lasts exactly through its owner\'s next turn', () => {
    let s = act(rich(), { type: 'tag', at: sq('g8'), tag: '기절', turns: 1 }).state; // white stuns black knight
    s = okMove(s, 'e2', 'e4').state; // white's turn ends: black's tag does not tick
    expect(tagsAt(s, 'g8')).toEqual([['기절', 1]]);
    expect(legal(s, 'g8')).toEqual([]); // black cannot move it this turn
    const r = okMove(s, 'e7', 'e5'); // black's turn ends: tag expires
    expect(r.events).toContainEqual({ type: 'tagExpired', pieceId: s.board[sq('g8')]!.id, tag: '기절' });
    s = okMove(r.state, 'd2', 'd3').state;
    expect(legal(s, 'g8')).toEqual(['e7', 'f6', 'h6']); // e7 is free after ...e5
  });

  it('a duration put on your own piece does not count down on the turn it was applied', () => {
    let s = act(rich(), { type: 'tag', at: sq('e2'), tag: '불타는 중', turns: 1 }).state;
    s = endTurn(s); // white turn (applied) ends: no tick
    expect(tagsAt(s, 'e2')).toEqual([['불타는 중', 1]]);
    s = endTurn(s); // black
    s = endTurn(s); // white's next turn ends: expires
    expect(tagsAt(s, 'e2')).toEqual([]);
  });

  it('turns 0 means permanent', () => {
    let s = act(rich(), { type: 'tag', at: sq('g8'), tag: '기절', turns: 0 }).state;
    for (let i = 0; i < 6; i++) s = endTurn(s);
    expect(tagsAt(s, 'g8')).toEqual([['기절', null]]);
  });

  it('a stunned piece gives no check', () => {
    const s = createStateFrom(
      { e1: { color: 'white', type: 'king' }, a8: { color: 'white', type: 'rook' }, e8: { color: 'black', type: 'king' } },
      'white',
      { ap: { white: 3, black: 0 } },
    );
    expect(isInCheck(s.board, 'black')).toBe(true);
    const r = act(s, { type: 'tag', at: sq('a8'), tag: '기절', turns: 0 });
    expect(isInCheck(r.state.board, 'black')).toBe(false);
  });

  it('a stunned king or rook cannot castle', () => {
    const rights = { white: { kingSide: true, queenSide: true }, black: { kingSide: true, queenSide: true } };
    const base = createStateFrom(
      { e1: { color: 'white', type: 'king' }, h1: { color: 'white', type: 'rook' }, e8: { color: 'black', type: 'king' } },
      'white',
      { castling: rights, ap: { white: 5, black: 0 } },
    );
    expect(legal(base, 'e1')).toContain('g1');
    expect(legal(act(base, { type: 'tag', at: sq('h1'), tag: '기절', turns: 0 }).state, 'e1')).not.toContain('g1');
    expect(legal(act(base, { type: 'tag', at: sq('e1'), tag: '기절', turns: 0 }).state, 'e1')).toEqual([]);
  });

  it('kings may be stunned', () => {
    const s = act(rich(), { type: 'tag', at: sq('e8'), tag: '기절', turns: 1 }).state;
    expect(tagsAt(s, 'e8')).toEqual([['기절', 1]]);
  });
});

describe('ride (탑승)', () => {
  const boarded = () => act(rich(), { type: 'board', rider: sq('a2'), carrier: sq('b1') });

  it('the rider leaves the board and rides on the carrier, tagged 탑승', () => {
    const r = boarded();
    expect(r.state.board[sq('a2')]).toBeNull();
    expect(r.state.board[sq('b1')]?.rider).toMatchObject({ type: 'pawn', color: 'white', tags: [{ name: '탑승', turnsLeft: null }] });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'boarded', from: sq('a2'), at: sq('b1') }));
  });

  it('moves with the carrier on normal moves', () => {
    const s = okMove(boarded().state, 'b1', 'c3').state;
    expect(s.board[sq('c3')]?.rider?.type).toBe('pawn');
    expect(s.board[sq('b1')]).toBeNull();
  });

  it('moves with the carrier on effect moves', () => {
    const s = act(boarded().state, { type: 'move', from: sq('b1'), to: sq('e5') }).state;
    expect(s.board[sq('e5')]?.rider?.type).toBe('pawn');
  });

  it('decision: when the carrier is captured, the rider is captured with it', () => {
    let s = boarded().state;
    s = okMove(s, 'b1', 'c3').state;
    s = okMove(s, 'd7', 'd5').state;
    s = okMove(s, 'h2', 'h3').state;
    const r = okMove(s, 'd5', 'd4');
    const r2 = okMove(okMove(r.state, 'h3', 'h4').state, 'd4', 'c3');
    expect(r2.events).toContainEqual(expect.objectContaining({ type: 'removed', piece: expect.objectContaining({ type: 'pawn', color: 'white' }) }));
    expect(r2.state.board[sq('c3')]).toMatchObject({ type: 'pawn', color: 'black' });
    expect(r2.state.board[sq('c3')]?.rider).toBeUndefined();
  });

  it('the rider can get off onto an empty square', () => {
    const r = act(boarded().state, { type: 'unboard', at: sq('b1'), to: sq('a3') });
    expect(r.state.board[sq('b1')]?.rider).toBeUndefined();
    expect(r.state.board[sq('a3')]).toMatchObject({ type: 'pawn', tags: [] });
  });

  it('rejects impossible boarding', () => {
    const s = rich();
    expect(proposeFails(s, { type: 'board', rider: sq('a2'), carrier: sq('b8') })).toContain('같은 편');
    expect(proposeFails(s, { type: 'board', rider: sq('e1'), carrier: sq('d1') })).toContain('킹');
    expect(proposeFails(boarded().state, { type: 'board', rider: sq('c2'), carrier: sq('b1') })).toContain('이미');
    expect(proposeFails(s, { type: 'tag', at: sq('a2'), tag: '탑승', turns: 0 })).toContain('board');
    expect(proposeFails(s, { type: 'unboard', at: sq('b1'), to: sq('a3') })).toContain('타고 있는 기물이 없음');
    expect(proposeFails(boarded().state, { type: 'unboard', at: sq('b1'), to: sq('d2') })).toContain('비어 있지 않음');
  });

  it('a rider is not on the board, so it neither moves alone nor attacks', () => {
    const s = createStateFrom(
      { e1: { color: 'white', type: 'king' }, d1: { color: 'white', type: 'queen' }, c2: { color: 'white', type: 'knight' }, e8: { color: 'black', type: 'king' } },
      'white',
      { ap: { white: 5, black: 0 } },
    );
    const r = act(s, { type: 'board', rider: sq('d1'), carrier: sq('c2') });
    // The queen on d1 would attack the d-file; riding the knight it attacks only by knight moves from c2.
    expect(r.state.board[sq('d1')]).toBeNull();
    expect(legal(r.state, 'c2')).toEqual(['a1', 'a3', 'b4', 'd4', 'e3']);
  });
});

describe('shield (보호막)', () => {
  const shielded = () => {
    const s = createStateFrom(
      {
        e1: { color: 'white', type: 'king' },
        d4: { color: 'white', type: 'rook' },
        d7: { color: 'black', type: 'knight' },
        e8: { color: 'black', type: 'king' },
      },
      'black',
      { ap: { white: 0, black: 5 } },
    );
    return act(s, { type: 'tag', at: sq('d7'), tag: '보호막', turns: 0 }).state;
  };

  it('absorbs the first normal capture: the shield breaks, the target stays, the attacker stays, the turn ends', () => {
    const s = endTurn(shielded());
    const r = okMove(s, 'd4', 'd7');
    expect(r.state.board[sq('d7')]).toMatchObject({ type: 'knight', color: 'black', tags: [] });
    expect(r.state.board[sq('d4')]).toMatchObject({ type: 'rook', color: 'white' });
    expect(r.state.turn).toBe('black');
    expect(r.events[0]).toMatchObject({ type: 'shieldBroken', at: sq('d7') });
    // second capture works
    const again = okMove(endTurn(r.state), 'd4', 'd7');
    expect(again.state.board[sq('d7')]).toMatchObject({ type: 'rook', color: 'white' });
  });

  it('absorbs effect removal and effect capture too', () => {
    let s = shielded();
    s = endTurn(s);
    s = { ...s, ap: { white: 5, black: 5 } };
    const r = act(s, { type: 'remove', at: sq('d7') });
    expect(r.state.board[sq('d7')]).toMatchObject({ type: 'knight', tags: [] });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'shieldBroken', attackerId: null }));
  });

  it('a shielded king survives a capture once', () => {
    const s = createStateFrom(
      { e1: { color: 'white', type: 'king' }, e4: { color: 'white', type: 'rook' }, e8: { color: 'black', type: 'king' } },
      'black',
      { ap: { white: 0, black: 5 } },
    );
    let t = act(s, { type: 'tag', at: sq('e8'), tag: '보호막', turns: 0 }).state;
    t = endTurn(t);
    const r = okMove(t, 'e4', 'e8');
    expect(r.state.status).toEqual({ kind: 'playing' });
    expect(r.state.board[sq('e8')]).toMatchObject({ type: 'king', tags: [] });
  });
});

describe('transform and spawn', () => {
  it('transforms a piece, keeping its id and tags', () => {
    let s = act(rich(), { type: 'tag', at: sq('a2'), tag: '불꽃', turns: 0 }).state;
    const id = s.board[sq('a2')]!.id;
    s = { ...s, ap: { white: 5, black: 5 } };
    const r = act(s, { type: 'transform', at: sq('a2'), into: 'queen' });
    expect(r.state.board[sq('a2')]).toMatchObject({ id, type: 'queen', tags: [expect.objectContaining({ name: '불꽃' })] });
  });

  it('spawns new pieces with fresh, deterministic ids', () => {
    const r = act(rich(), { type: 'spawn', at: sq('e4'), color: 'white', piece: 'knight' }, { type: 'spawn', at: sq('d4'), color: 'black', piece: 'pawn' });
    expect(r.state.board[sq('e4')]).toEqual({ id: 'spawn-1', color: 'white', type: 'knight' });
    expect(r.state.board[sq('d4')]).toEqual({ id: 'spawn-2', color: 'black', type: 'pawn' });
    expect(r.state.nextSpawnId).toBe(3);
  });

  it('never makes or unmakes kings, and needs an empty square to spawn', () => {
    const s = rich();
    expect(proposeFails(s, { type: 'transform', at: sq('e1'), into: 'queen' })).toContain('킹');
    expect(proposeFails(s, { type: 'transform', at: sq('d1'), into: 'king' })).toContain('킹');
    expect(proposeFails(s, { type: 'spawn', at: sq('e4'), color: 'white', piece: 'king' })).toContain('킹');
    expect(proposeFails(s, { type: 'spawn', at: sq('e2'), color: 'white', piece: 'queen' })).toContain('비어 있지 않음');
  });

  it('free tags are stored but not enforced', () => {
    const s = act(rich(), { type: 'tag', at: sq('g1'), tag: '불타는 중', turns: 2 }).state;
    expect(tagsAt(s, 'g1')).toEqual([['불타는 중', 2]]);
    expect(legal(s, 'g1')).toEqual(['f3', 'h3']);
  });

  it('untag removes a tag; untagging a missing tag is a no-op', () => {
    let s = act(rich(), { type: 'tag', at: sq('g1'), tag: '기절', turns: 0 }).state;
    s = { ...s, ap: { white: 5, black: 5 } };
    s = act(s, { type: 'untag', at: sq('g1'), tag: '기절' }, { type: 'untag', at: sq('g1'), tag: '없는 태그' }).state;
    expect(tagsAt(s, 'g1')).toEqual([]);
  });

  it('rejects bad tag inputs', () => {
    expect(proposeFails(rich(), { type: 'tag', at: sq('g1'), tag: '', turns: 0 })).toContain('태그 이름');
    expect(proposeFails(rich(), { type: 'tag', at: sq('g1'), tag: '기절', turns: -1 })).toContain('지속 턴');
  });
});

describe('plays from the normal start', () => {
  it('stays consistent across a sequence with tags', () => {
    const s = play(createInitialState(), 'e2e4 e7e5');
    expect(s.turn).toBe('white');
  });
});
