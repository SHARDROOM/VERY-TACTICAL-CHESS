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
import { canResist, clashMultiplier, clashScore, clashSkill, clashWinChance, exchangesFor, resolveClash } from './clash';
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
  it('every kind has a base, by its chess value: the pawn weakest, the queen strongest', () => {
    const of = (type: Piece['type']) => clashMultiplier({ id: type, color: 'white', type });
    expect(['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'].map((t) => of(t as Piece['type']))).toEqual([0.8, 1, 1, 1.2, 1.6, 1]);
  });

  it('the best tag multiplier times the base, the rider\'s too if it fights better; skill is the tag alone', () => {
    const p: Piece = { id: 'p', color: 'white', type: 'pawn' };
    expect(clashMultiplier({ ...p, tags: [tag('검술', 1.5), tag('창술', 1.3)] })).toBe(1.2);
    expect(clashMultiplier({ id: 'q', color: 'white', type: 'queen', tags: [tag('검술', 1.5)] })).toBe(2.4);
    expect(clashMultiplier({ ...p, rider: fighter({ id: 'r', color: 'white', type: 'knight' }, 1.8) })).toBe(1.8);
    expect(clashSkill(p)).toBe(1);
    expect(clashSkill(fighter(p))).toBe(1.5);
    expect(canResist(p)).toBe(false);
    expect(canResist({ ...p, tags: [tag('보호막')] })).toBe(true);
    expect(canResist(fighter(p))).toBe(true);
  });

  it('closer scores fight longer; ties add to it', () => {
    expect([8, 7, 5, 4, 3, 2, 1].map((d) => exchangesFor(d, 0))).toEqual([1, 1, 2, 2, 3, 3, 4]);
    expect(exchangesFor(5, 2)).toBe(4);
    expect(exchangesFor(1, 5)).toBe(6);
  });

  it('a score is the dice total times the multiplier, rounded half up', () => {
    expect(clashScore(3, 1.5)).toBe(5); // 4.5
    expect(clashScore(3, 0.8)).toBe(2); // 2.4
    expect(clashScore(5, 0.9)).toBe(5); // 4.5
    expect(clashScore(2, 1.15)).toBe(2); // 2.3 (2.2999… in floats)
    expect(clashScore(6, 1.44)).toBe(9); // 8.64
    expect(clashScore(4, 1)).toBe(4);
  });

  it('each side rolls two dice a round; a tie rolls again; the higher score wins', () => {
    // 1+1 = 2, × 1.5 = 3 against 1+2 = 3: a tie; then 3 against 2+2 = 4.
    expect(resolveClash(1.5, 1, [1, 1, 1, 2, 1, 1, 2, 2])).toEqual({
      rounds: [
        { attack: 2, defense: 3, attackDice: [1, 1], defenseDice: [1, 2] },
        { attack: 2, defense: 4, attackDice: [1, 1], defenseDice: [2, 2] },
      ],
      winner: 'defender',
      exchanges: 5,
    });
    // Rounded scores tie too: (1+2) × 1.5 = 4.5 → 5 against 2+3 = 5.
    expect(resolveClash(1.5, 1, [1, 2, 2, 3, 3, 3, 1, 1]).rounds).toHaveLength(2);
    expect(resolveClash(1, 1, [3, 3, 1, 1])).toMatchObject({ winner: 'attacker', exchanges: 2 });
  });

  it('exact chances over two dice a side (ties rolled again)', () => {
    expect(clashWinChance(1, 1)).toBeCloseTo(0.5);
    expect(clashWinChance(1.5, 1)).toBeCloseTo(990 / 1214);
    expect(clashWinChance(2, 1)).toBeCloseTo(1137 / 1251);
    expect(clashWinChance(1, 2)).toBeCloseTo(114 / 1251);
    expect(clashWinChance(0.8, 1)).toBeCloseTo(360 / 1150);
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
    const r = okMove(duel({ defender: 1.5, attacker: 1.2 }), 'd4', 'd7', { clashRolls: [3, 3, 1, 1] });
    // The rook: base ×1.2 × 검술 ×1.2; the knight: base ×1 × 1.5.
    expect(r.events[0]).toMatchObject({ type: 'clash', winner: 'attacker', attack: 1.44, defense: 1.5, rounds: [{ attack: 6, defense: 2, attackDice: [3, 3], defenseDice: [1, 1] }] });
    expect(r.state.board[sq('d7')]?.type).toBe('rook');
    expect(r.state.captured).toEqual([expect.objectContaining({ type: 'knight', exit: 'shatter' })]);
  });

  it('the attacker loses: it is taken on its own square, the defender stays, the turn ends', () => {
    const s = duel({ defender: 1.5 });
    const r = okMove(s, 'd4', 'd7', { clashRolls: [1, 1, 3, 3] });
    expect(r.events[0]).toMatchObject({ type: 'clash', winner: 'defender' });
    expect(r.events[1]).toMatchObject({ type: 'removed', at: sq('d4'), cause: 'clash', exit: 'shatter' });
    expect(r.state.board[sq('d4')]).toBeNull();
    expect(r.state.board[sq('d7')]?.type).toBe('knight');
    expect(r.state.captured).toEqual([expect.objectContaining({ type: 'rook', color: 'white', exit: 'shatter' })]);
    expect(r.state.turn).toBe('black');
  });

  it('the bases count even with no weapon: a plain rook into a shielded knight fights ×1.2 against ×1', () => {
    // (2+3) × 1.2 = 6 against 3+3 = 6: a tie, rolled again; then (2+2) × 1.2 = 4.8 → 5 against 2+2 = 4.
    const again = okMove(duel({ shield: true }), 'd4', 'd7', { clashRolls: [2, 3, 3, 3, 2, 2, 2, 2] });
    expect(again.events[0]).toMatchObject({ type: 'clash', attack: 1.2, defense: 1, rounds: [{ attack: 5, defense: 6 }, { attack: 4, defense: 4 }], winner: 'attacker' });
  });

  it('a shield: losing breaks it (the attacker goes back), winning takes the attacker (knocked off, no blade)', () => {
    const won = okMove(duel({ shield: true }), 'd4', 'd7', { clashRolls: [3, 3, 1, 1] });
    expect(won.state.board[sq('d7')]).toMatchObject({ type: 'knight', tags: [] });
    expect(won.state.board[sq('d4')]?.type).toBe('rook');
    const lost = okMove(duel({ shield: true }), 'd4', 'd7', { clashRolls: [1, 1, 3, 3] });
    expect(lost.state.board[sq('d4')]).toBeNull();
    expect(lost.state.board[sq('d7')]?.tags?.[0].name).toBe('보호막');
    expect(lost.state.captured).toEqual([{ id: expect.any(String), color: 'white', type: 'rook' }]);
  });

  it('a king that attacks and loses is taken: the game is over', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e2: { color: 'black', type: 'pawn' }, h8: { color: 'black', type: 'king' } }, 'white');
    const b = [...s.board];
    b[sq('e2')] = fighter(b[sq('e2')]!);
    const r = okMove({ ...s, board: b }, 'e1', 'e2', { clashRolls: [1, 1, 3, 3] });
    expect(r.state.status).toEqual({ kind: 'won', winner: 'black' });
    expect(r.events).toContainEqual({ type: 'kingCaptured', winner: 'black', loser: 'white' });
  });
});

const ruling = (effects: Effect[]): Ruling => ({ interpretation: 'x', feasible: true, dc: 5, cost: 1, effects, narration: { success: 's', failure: 'f' } });
const attempt = (state: GameState, effects: Effect[], clashRolls?: number[]) => {
  const p = ok(applyCommand({ ...state, ap: { white: 5, black: 5, red: 0, gray: 0 } }, { type: 'proposeSpecial', action: 'a', ruling: ruling(effects) }));
  return applyCommand(p.state, { type: 'attemptSpecial', roll: 5, ...(clashRolls && { clashRolls }) });
};

describe('clashes in special actions', () => {
  const charge: Effect[] = [
    { type: 'move', from: sq('d4'), to: sq('d7') },
    { type: 'tag', at: sq('d7'), tag: '용기백배', turns: 2 },
  ];

  it('a move effect into a fighter is a clash; if the attacker loses, the rest of the action never happens', () => {
    const r = ok(attempt(duel({ defender: 1.5 }), charge, [1, 1, 3, 3]));
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'clash', winner: 'defender' }));
    expect(r.state.board[sq('d4')]).toBeNull();
    expect(r.state.board[sq('d7')]?.tags?.map((t) => t.name)).toEqual(['검술']);
    expect(r.events.find((e) => e.type === 'specialResolved')).toMatchObject({ effects: [charge[0]] });
  });

  it('if the attacker wins, the action goes on', () => {
    const r = ok(attempt(duel({ defender: 1.5 }), charge, [3, 3, 1, 1]));
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

describe('an instant kill on a piece with clash gear is a clash (사용자 요청)', () => {
  // The rook on d4 stabs (touch: after charging to d6) or throws a dagger (ranged) at the knight on d7.
  const ATTACKER = [6, 6, 1, 1];
  const DEFENDER = [1, 1, 6, 6];
  const run = (state: GameState, means: Ruling['means'], effects: Effect[], rolls: number[]) => {
    const ruling: Ruling = { interpretation: 'x', feasible: true, dc: 5, cost: 1, actor: sq('d4'), means, effects, narration: { success: 's', failure: 'f' } };
    const proposed = ok(applyCommand({ ...state, ap: { ...state.ap, white: 5 } }, { type: 'proposeSpecial', action: 'x', ruling })).state;
    return ok(applyCommand(proposed, { type: 'attemptSpecial', roll: 12, clashRolls: rolls }));
  };
  const kill: Effect = { type: 'remove', at: sq('d7') };

  it('a melee kill that wins the clash takes the target off; the attacker stays where it stood', () => {
    const r = run(duel({ defender: 1.5 }), 'touch', [{ type: 'move', from: sq('d4'), to: sq('d6') }, kill], ATTACKER);
    const clash = r.events.find((e) => e.type === 'clash');
    expect(clash).toMatchObject({ from: sq('d6'), at: sq('d7'), winner: 'attacker', strike: 'melee' });
    expect(r.state.board[sq('d7')]).toBeNull();
    expect(r.state.board[sq('d6')]?.type).toBe('rook');
  });

  it('a melee kill that loses: the attacker falls and the rest never happens', () => {
    const r = run(duel({ defender: 1.5 }), 'touch', [{ type: 'move', from: sq('d4'), to: sq('d6') }, kill, { type: 'tag', at: sq('d6'), tag: '영웅', turns: 1 }], DEFENDER);
    expect(r.state.board[sq('d6')]).toBeNull();
    expect(r.state.board[sq('d7')]?.type).toBe('knight');
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'removed', at: sq('d6'), cause: 'clash' }));
  });

  it('a ranged kill that loses only misses: the attacker lives, the target too', () => {
    const r = run(duel({ defender: 1.5 }), 'ranged', [kill], DEFENDER);
    expect(r.events.find((e) => e.type === 'clash')).toMatchObject({ winner: 'defender', strike: 'ranged' });
    expect(r.state.board[sq('d4')]?.type).toBe('rook');
    expect(r.state.board[sq('d7')]?.type).toBe('knight');
  });

  it('no gear, no clash: the kill is instant as before', () => {
    const r = run(duel(), 'ranged', [kill], []);
    expect(r.events.some((e) => e.type === 'clash')).toBe(false);
    expect(r.state.board[sq('d7')]).toBeNull();
  });
});
