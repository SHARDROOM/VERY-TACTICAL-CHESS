import { describe, expect, it } from 'vitest';
import { applyCommand, createStateFrom, type Effect, type GameState, type Ruling } from './index';
import { move, ok, okMove, sq } from './testUtil';

const ruling = (effects: Effect[], over: Partial<Ruling> = {}): Ruling => ({
  interpretation: 'x',
  feasible: true,
  dc: 4,
  cost: 1,
  effects,
  narration: { success: 's', failure: 'f' },
  ...over,
});
const propose = (s: GameState, effects: Effect[]) =>
  ok(applyCommand(s, { type: 'proposeSpecial', action: 'act', ruling: ruling(effects) })).state;
const attempt = (s: GameState, roll: number) => ok(applyCommand(s, { type: 'attemptSpecial', roll }));
const cancel = (s: GameState) => ok(applyCommand(s, { type: 'cancelSpecial' })).state;

/**
 * White rook on a1 can reach the black king on a8 (a-file open) - i.e. black is
 * already "in check" at the start of white's turn. White also has a knight to play with.
 */
const kingHanging = (ap = 3) =>
  createStateFrom(
    {
      e1: { color: 'white', type: 'king' },
      a1: { color: 'white', type: 'rook' },
      g1: { color: 'white', type: 'knight' },
      a8: { color: 'black', type: 'king' },
      h7: { color: 'black', type: 'pawn' },
    },
    'white',
    { ap: { white: ap, black: 0 } },
  );

/** Nothing is attacking the black king yet; a special action could change that. */
const quiet = (ap = 3) =>
  createStateFrom(
    {
      e1: { color: 'white', type: 'king' },
      b1: { color: 'white', type: 'rook' },
      g1: { color: 'white', type: 'knight' },
      a8: { color: 'black', type: 'king' },
      h7: { color: 'black', type: 'pawn' },
    },
    'white',
    { ap: { white: ap, black: 0 } },
  );

describe('no king capture on a turn where AP was used', () => {
  it('without any special action, the hanging king can be taken', () => {
    const r = okMove(kingHanging(), 'a1', 'a8');
    expect(r.state.status).toEqual({ kind: 'won', winner: 'white' });
  });

  it('after a special action the engine refuses a king capture this turn (safety net)', () => {
    // In normal play this cannot come up: if a special action leaves the king attacked, the
    // turn ends at once (see below). The guard still holds if a state ever gets here.
    const s = attempt(propose(quiet(), [{ type: 'move', from: sq('g1'), to: sq('f3') }]), 6).state;
    expect(s.turn).toBe('white');
    expect(s.usedApThisTurn).toBe(true);
    const board = [...s.board];
    board[sq('b8')] = board[sq('a8')];
    board[sq('a8')] = null;
    expect(move({ ...s, board }, 'b1', 'b8')).toEqual({ ok: false, reason: 'kingProtectedThisTurn' });
  });

  it('a failed attempt also counts as using AP', () => {
    let s = quiet();
    s = attempt(propose(s, [{ type: 'move', from: sq('g1'), to: sq('f3') }]), 2).state;
    expect(s.usedApThisTurn).toBe(true);
  });

  it('cancelling does not count as using AP', () => {
    const s = cancel(propose(kingHanging(), [{ type: 'move', from: sq('g1'), to: sq('f3') }]));
    expect(s.usedApThisTurn).toBe(false);
    expect(okMove(s, 'a1', 'a8').state.status).toEqual({ kind: 'won', winner: 'white' });
  });

  it('the guard lasts only for that turn: next turn, without AP, the king can be taken', () => {
    // White opens the a-file with a special action (auto turn end because of check)...
    let s = createStateFrom(
      {
        e1: { color: 'white', type: 'king' },
        a1: { color: 'white', type: 'rook' },
        a4: { color: 'white', type: 'knight' },
        a8: { color: 'black', type: 'king' },
        h7: { color: 'black', type: 'pawn' },
      },
      'white',
      { ap: { white: 3, black: 0 } },
    );
    const r = attempt(propose(s, [{ type: 'move', from: sq('a4'), to: sq('c5') }]), 6);
    expect(r.state.turn).toBe('black');
    // ...black ignores it...
    s = okMove(r.state, 'h7', 'h6').state;
    // ...and white takes the king with a plain move.
    expect(okMove(s, 'a1', 'a8').state.status).toEqual({ kind: 'won', winner: 'white' });
  });
});

describe('automatic turn end when a special action leaves the opponent in check', () => {
  it('a successful action that gives check ends the turn and keeps the remaining AP', () => {
    const s = propose(quiet(3), [{ type: 'move', from: sq('b1'), to: sq('a1') }]);
    const r = attempt(s, 6);
    expect(r.events).toContainEqual({ type: 'check', color: 'black' });
    expect(r.events).toContainEqual({ type: 'autoTurnEnd', color: 'white', reason: 'check' });
    expect(r.state.turn).toBe('black');
    expect(r.state.ap.white).toBe(2);
    expect(r.state.ap.black).toBe(1);
  });

  it('if the king was already attacked when the turn began, any attempt ends the turn (success or failure)', () => {
    for (const roll of [6, 1]) {
      const r = attempt(propose(kingHanging(), [{ type: 'move', from: sq('g1'), to: sq('f3') }]), roll);
      expect(r.events).toContainEqual({ type: 'autoTurnEnd', color: 'white', reason: 'check' });
      expect(r.state.turn).toBe('black');
    }
  });

  it('no check, no automatic end: the player keeps acting', () => {
    const r = attempt(propose(quiet(), [{ type: 'move', from: sq('g1'), to: sq('f3') }]), 6);
    expect(r.state.turn).toBe('white');
    expect(r.events.some((e) => e.type === 'autoTurnEnd')).toBe(false);
  });

  it('a stunned attacker does not count as check', () => {
    let s = kingHanging(5);
    s = attempt(propose(s, [{ type: 'tag', at: sq('a1'), tag: '기절', turns: 0 }]), 6).state;
    expect(s.turn).toBe('white');
  });

  it("a rider attacks only through its carrier's movement", () => {
    // A queen on d1 would attack a8? No - use the rook: rook rides the knight on g1, so the a-file threat is gone.
    let s = kingHanging(5);
    s = attempt(propose(s, [{ type: 'board', rider: sq('a1'), carrier: sq('g1') }]), 6).state;
    expect(s.turn).toBe('white');
    expect(s.board[sq('a1')]).toBeNull();
  });

  it('a shielded king under attack still counts as check', () => {
    const s = createStateFrom(
      {
        e1: { color: 'white', type: 'king' },
        b1: { color: 'white', type: 'rook' },
        a8: { color: 'black', type: 'king' },
      },
      'white',
      { ap: { white: 5, black: 0 } },
    );
    // Shield the black king (white can tag enemy pieces), then bring the rook to the a-file.
    const shielded = attempt(propose(s, [{ type: 'tag', at: sq('a8'), tag: '보호막', turns: 0 }]), 6).state;
    expect(shielded.turn).toBe('white');
    const r = attempt(propose(shielded, [{ type: 'move', from: sq('b1'), to: sq('a1') }]), 6);
    expect(r.events).toContainEqual({ type: 'autoTurnEnd', color: 'white', reason: 'check' });
  });
});
