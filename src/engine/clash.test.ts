import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createStateFrom,
  type Effect,
  type GameState,
  type Piece,
  type Ruling,
  type Tag,
} from './index';
import { canResist, clashMultiplier, clashWinChance, exchangesFor, resolveClash } from './clash';
import { ok, okMove, move, sq } from './testUtil';

const tag = (name: string, clash?: number): Tag => ({ name, turnsLeft: null, appliedOnTurn: 1, ...(clash && { clash }) });
const fighter = (p: Piece, mult = 1.5): Piece => ({ ...p, tags: [...(p.tags ?? []), tag('검술', mult)] });

/** White rook on d4 can take the black knight on d7; kings out of the way. */
function duel(opts: { defender?: number; attacker?: number; shield?: boolean } = {}): GameState {
  const s = createStateFrom(
    { e1: { color: 'white', type: 'king' }, d4: { color: 'white', type: 'rook' }, d7: { color: 'black', type: 'knight' }, h8: { color: 'black', type: 'king' } },
    'white',
  );
  const b = [...s.board];
  if (opts.defender) b[sq('d7')] = fighter(b[sq('d7')]!, opts.defender);
  if (opts.attacker) b[sq('d4')] = fighter(b[sq('d4')]!, opts.attacker);
  if (opts.shield) b[sq('d7')] = { ...b[sq('d7')]!, tags: [...(b[sq('d7')]!.tags ?? []), tag('보호막')] };
  return { ...s, board: b };
}

describe('clash rules (합)', () => {
  it('the best multiplier counts, the rider\'s too; 1 without', () => {
    const p: Piece = { id: 'p', color: 'white', type: 'pawn' };
    expect(clashMultiplier(p)).toBe(1);
    expect(clashMultiplier({ ...p, tags: [tag('검술', 1.5), tag('창술', 1.3)] })).toBe(1.5);
    expect(clashMultiplier({ ...p, rider: fighter({ id: 'r', color: 'white', type: 'pawn' }, 1.8) })).toBe(1.8);
    expect(canResist(p)).toBe(false);
    expect(canResist({ ...p, tags: [tag('보호막')] })).toBe(true);
    expect(canResist(fighter(p))).toBe(true);
  });

  it('closer scores fight longer; ties add to it', () => {
    expect([12, 10, 7, 6, 4, 3, 2, 0.5].map((d) => exchangesFor(d, 0))).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(exchangesFor(12, 2)).toBe(3);
    expect(exchangesFor(1, 5)).toBe(6);
  });

  it('a tie rolls again; the higher score wins', () => {
    // 10×1.5 = 15 against 15: a tie; then 4×1.5 = 6 against 7.
    expect(resolveClash(1.5, 1, [10, 15, 4, 7])).toEqual({ rounds: [{ attack: 10, defense: 15 }, { attack: 4, defense: 7 }], winner: 'defender', exchanges: 5 });
    expect(resolveClash(1, 1, [12, 3])).toMatchObject({ winner: 'attacker', exchanges: 2 });
  });

  it('exact chances: even, ×1.5 about two in three, ×2 three in four (ties rolled again)', () => {
    expect(clashWinChance(1, 1)).toBeCloseTo(0.5);
    expect(clashWinChance(1.5, 1)).toBeCloseTo(267 / 394);
    expect(clashWinChance(2, 1)).toBeCloseTo(300 / 390);
    expect(clashWinChance(1, 2)).toBeCloseTo(90 / 390);
  });
});

describe('clashes in normal moves', () => {
  it('only a defender that can stand its ground clashes: a fighter taking an ordinary piece just takes it', () => {
    const r = okMove(duel({ attacker: 1.5 }), 'd4', 'd7');
    expect(r.events.some((e) => e.type === 'clash')).toBe(false);
    expect(r.state.board[sq('d7')]?.type).toBe('rook');
  });

  it('needs its dice', () => {
    expect(move(duel({ defender: 1.5 }), 'd4', 'd7')).toMatchObject({ ok: false, reason: 'clashRollsNeeded' });
  });

  it('the attacker wins: a normal capture, the loser cut down if the winner fights with a multiplier', () => {
    const r = okMove(duel({ defender: 1.5, attacker: 1.2 }), 'd4', 'd7', { clashRolls: [18, 5] });
    expect(r.events[0]).toMatchObject({ type: 'clash', winner: 'attacker', attack: 1.2, defense: 1.5, rounds: [{ attack: 18, defense: 5 }] });
    expect(r.state.board[sq('d7')]?.type).toBe('rook');
    expect(r.state.captured).toEqual([expect.objectContaining({ type: 'knight', exit: 'shatter' })]);
  });

  it('the attacker loses: it is taken on its own square, the defender stays, the turn ends', () => {
    const s = duel({ defender: 1.5 });
    const r = okMove(s, 'd4', 'd7', { clashRolls: [3, 12] });
    expect(r.events[0]).toMatchObject({ type: 'clash', winner: 'defender' });
    expect(r.events[1]).toMatchObject({ type: 'removed', at: sq('d4'), cause: 'clash', exit: 'shatter' });
    expect(r.state.board[sq('d4')]).toBeNull();
    expect(r.state.board[sq('d7')]?.type).toBe('knight');
    expect(r.state.captured).toEqual([expect.objectContaining({ type: 'rook', color: 'white', exit: 'shatter' })]);
    expect(r.state.turn).toBe('black');
  });

  it('a shield: losing breaks it (the attacker goes back), winning takes the attacker (knocked off, no blade)', () => {
    const won = okMove(duel({ shield: true }), 'd4', 'd7', { clashRolls: [15, 4] });
    expect(won.state.board[sq('d7')]).toMatchObject({ type: 'knight', tags: [] });
    expect(won.state.board[sq('d4')]?.type).toBe('rook');
    const lost = okMove(duel({ shield: true }), 'd4', 'd7', { clashRolls: [4, 15] });
    expect(lost.state.board[sq('d4')]).toBeNull();
    expect(lost.state.board[sq('d7')]?.tags?.[0].name).toBe('보호막');
    expect(lost.state.captured).toEqual([{ id: expect.any(String), color: 'white', type: 'rook' }]);
  });

  it('a king that attacks and loses is taken: the game is over', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e2: { color: 'black', type: 'pawn' }, h8: { color: 'black', type: 'king' } }, 'white');
    const b = [...s.board];
    b[sq('e2')] = fighter(b[sq('e2')]!);
    const r = okMove({ ...s, board: b }, 'e1', 'e2', { clashRolls: [2, 19] });
    expect(r.state.status).toEqual({ kind: 'won', winner: 'black' });
    expect(r.events).toContainEqual({ type: 'kingCaptured', winner: 'black' });
  });
});

const ruling = (effects: Effect[]): Ruling => ({ interpretation: 'x', feasible: true, dc: 5, cost: 1, effects, narration: { success: 's', failure: 'f' } });
const attempt = (state: GameState, effects: Effect[], clashRolls?: number[]) => {
  const p = ok(applyCommand({ ...state, ap: { white: 5, black: 5 } }, { type: 'proposeSpecial', action: 'a', ruling: ruling(effects) }));
  return applyCommand(p.state, { type: 'attemptSpecial', roll: 15, ...(clashRolls && { clashRolls }) });
};

describe('clashes in special actions', () => {
  const charge: Effect[] = [
    { type: 'move', from: sq('d4'), to: sq('d7') },
    { type: 'tag', at: sq('d7'), tag: '용기백배', turns: 2 },
  ];

  it('a move effect into a fighter is a clash; if the attacker loses, the rest of the action never happens', () => {
    const r = ok(attempt(duel({ defender: 1.5 }), charge, [2, 18]));
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'clash', winner: 'defender' }));
    expect(r.state.board[sq('d4')]).toBeNull();
    expect(r.state.board[sq('d7')]?.tags?.map((t) => t.name)).toEqual(['검술']);
    expect(r.events.find((e) => e.type === 'specialResolved')).toMatchObject({ effects: [charge[0]] });
  });

  it('if the attacker wins, the action goes on', () => {
    const r = ok(attempt(duel({ defender: 1.5 }), charge, [20, 2]));
    expect(r.state.board[sq('d7')]).toMatchObject({ type: 'rook', tags: [{ name: '용기백배' }] });
  });

  it('a removal (a shot, a spell) is no clash', () => {
    const r = ok(attempt(duel({ defender: 1.5 }), [{ type: 'remove', at: sq('d7') }]));
    expect(r.events.some((e) => e.type === 'clash')).toBe(false);
    expect(r.state.board[sq('d7')]).toBeNull();
  });

  it('chaos never clashes', () => {
    const r = ok(applyCommand(duel({ defender: 1.5 }), { type: 'chaos', chaos: { title: 't', narration: 'n', effects: [{ type: 'move', from: sq('d4'), to: sq('d7') }] } }));
    expect(r.events.some((e) => e.type === 'clash')).toBe(false);
    expect(r.state.board[sq('d7')]?.type).toBe('rook');
  });

  it('a clash in an attempt needs its dice', () => {
    expect(attempt(duel({ defender: 1.5 }), charge)).toMatchObject({ ok: false, reason: 'clashRollsNeeded' });
  });
});
