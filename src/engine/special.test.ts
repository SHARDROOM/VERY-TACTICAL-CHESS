import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  applyCommand,
  createInitialState,
  createStateFrom,
  legalTargets,
  type GameState,
  type Ruling,
} from './index';
import { move, ok, okMove, passTurn, play, sq } from './testUtil';

const ruling = (over: Partial<Ruling> = {}): Ruling => ({
  interpretation: '나이트가 투석기를 타고 날아간다',
  feasible: true,
  dc: 12,
  cost: 1,
  effects: [{ type: 'move', from: sq('b1'), to: sq('e5') }],
  narration: { success: '성공 서술', failure: '실패 서술' },
  ...over,
});

const propose = (state: GameState, r: Ruling = ruling(), action = '나이트를 투석기로 날린다') =>
  applyCommand(state, { type: 'proposeSpecial', action, ruling: r });
const attempt = (state: GameState, roll: number) => applyCommand(state, { type: 'attemptSpecial', roll });
const cancel = (state: GameState) => applyCommand(state, { type: 'cancelSpecial' });
const endTurn = (state: GameState) => applyCommand(state, { type: 'endTurn' });
const pass = (state: GameState) => passTurn(state);

/** Initial position with plenty of AP for white. */
const rich = (ap = 5): GameState => ({ ...createInitialState(), ap: { white: ap, black: 0 } });

describe('AP', () => {
  it('white begins with 1 AP (start 0 + first turn), black with 0', () => {
    expect(createInitialState().ap).toEqual({ white: 1, black: 0 });
  });

  it('gains AP at the start of your own turn', () => {
    const s = play(createInitialState(), 'e2e4');
    expect(s.ap).toEqual({ white: 1, black: 1 });
    expect(play(s, 'e7e5').ap).toEqual({ white: 2, black: 1 });
  });

  it('caps at the maximum', () => {
    let s = createInitialState();
    for (let i = 0; i < 12; i++) s = pass(s);
    expect(s.ap).toEqual({ white: 5, black: 5 });
  });

  it('uses the configured numbers', () => {
    const rules = { ...DEFAULT_RULES, apStart: 2, apPerTurn: 2, apMax: 3 };
    const s = createInitialState(rules);
    expect(s.ap).toEqual({ white: 3, black: 2 });
    expect(pass(s).ap).toEqual({ white: 3, black: 3 });
  });
});

describe('end turn', () => {
  it('is refused when nothing was done this turn', () => {
    expect(endTurn(createInitialState())).toEqual({ ok: false, reason: 'nothingDoneThisTurn' });
  });

  it('is allowed after a special action was attempted, even a failed one, and passes without moving', () => {
    for (const roll of [20, 2]) {
      const s = ok(attempt(ok(propose(rich())).state, roll)).state;
      const r = ok(endTurn(s));
      expect(r.state.turn).toBe('black');
      expect(r.state.board).toEqual(s.board);
    }
  });

  it('a cancelled proposal does not count', () => {
    const s = ok(cancel(ok(propose(rich())).state)).state;
    expect(endTurn(s)).toMatchObject({ ok: false, reason: 'nothingDoneThisTurn' });
  });

  it('is allowed when there is no normal move to make at all', () => {
    // White's only piece is a stunned king: nothing can move, so passing must be possible.
    const start = createStateFrom({ a1: { color: 'white', type: 'king' }, h8: { color: 'black', type: 'king' } });
    const board = [...start.board];
    board[sq('a1')] = { ...board[sq('a1')]!, tags: [{ name: '기절', turnsLeft: null, appliedOnTurn: 0 }] };
    const s = { ...start, board };
    expect(legalTargets(s, sq('a1'))).toEqual([]);
    expect(ok(endTurn(s)).state.turn).toBe('black');
  });

  it('clears an en passant chance', () => {
    const s = play(createInitialState(), 'e2e4 a7a6 e4e5 d7d5');
    expect(pass(s).enPassant).toBeNull();
  });
});

describe('proposing a special action', () => {
  it('stores the ruling as pending without changing the board or AP', () => {
    const s = rich();
    const r = ok(propose(s));
    expect(r.state.pending).toEqual({ color: 'white', action: '나이트를 투석기로 날린다', ruling: ruling() });
    expect(r.state.board).toBe(s.board);
    expect(r.state.ap).toEqual(s.ap);
    expect(r.events[0]).toMatchObject({ type: 'specialProposed', color: 'white' });
  });

  it('blocks moves, end turn and new proposals while pending', () => {
    const s = ok(propose(rich())).state;
    expect(move(s, 'e2', 'e4')).toMatchObject({ ok: false, reason: 'actionPending' });
    expect(endTurn(s)).toMatchObject({ ok: false, reason: 'actionPending' });
    expect(propose(s)).toMatchObject({ ok: false, reason: 'actionPending' });
  });

  it('rejects empty and over-long declarations', () => {
    expect(propose(rich(), ruling(), '   ')).toMatchObject({ ok: false, reason: 'emptyAction' });
    expect(propose(rich(), ruling(), 'x'.repeat(201))).toMatchObject({ ok: false, reason: 'actionTooLong' });
    expect(propose(rich(), ruling(), 'x'.repeat(200)).ok).toBe(true);
  });

  it('rejects out-of-range DC and cost', () => {
    for (const bad of [{ dc: 4 }, { dc: 26 }, { dc: 12.5 }, { cost: 0 }, { cost: 4 }]) {
      expect(propose(rich(), ruling(bad))).toMatchObject({ ok: false, reason: 'invalidRuling' });
    }
  });

  it('rejects effects outside the vocabulary', () => {
    const bad = ruling({ effects: [{ type: 'teleportEverything' } as never] });
    expect(propose(rich(), bad)).toMatchObject({ ok: false, reason: 'invalidRuling' });
  });

  it('rejects effects that remove or capture a king', () => {
    const removeKing = ruling({ effects: [{ type: 'remove', at: sq('e8') }] });
    expect(propose(rich(), removeKing)).toMatchObject({ ok: false, reason: 'invalidRuling' });
    const onKing = ruling({ effects: [{ type: 'move', from: sq('b1'), to: sq('e8') }] });
    expect(propose(rich(), onKing)).toMatchObject({ ok: false, reason: 'invalidRuling' });
  });

  it('rejects impossible effects (empty source, own piece on target)', () => {
    expect(propose(rich(), ruling({ effects: [{ type: 'move', from: sq('e4'), to: sq('e5') }] }))).toMatchObject({
      ok: false,
      reason: 'invalidRuling',
    });
    expect(propose(rich(), ruling({ effects: [{ type: 'move', from: sq('b1'), to: sq('d2') }] }))).toMatchObject({
      ok: false,
      reason: 'invalidRuling',
    });
    expect(propose(rich(), ruling({ effects: [{ type: 'remove', at: sq('e4') }] }))).toMatchObject({
      ok: false,
      reason: 'invalidRuling',
    });
  });

  it('validates effects in sequence', () => {
    const chain = ruling({
      effects: [
        { type: 'move', from: sq('b1'), to: sq('e5') },
        { type: 'move', from: sq('e5'), to: sq('e6') },
      ],
    });
    expect(propose(rich(), chain).ok).toBe(true);
  });

  it('accepts an infeasible ruling for display, but it cannot be attempted', () => {
    const s = ok(propose(rich(), ruling({ feasible: false, dc: 0, cost: 0, effects: [] }))).state;
    expect(attempt(s, 20)).toMatchObject({ ok: false, reason: 'notFeasible' });
    expect(ok(cancel(s)).state.pending).toBeNull();
  });
});

describe('attempting and cancelling', () => {
  it('cancel clears the proposal and spends nothing', () => {
    const s = rich();
    const r = ok(cancel(ok(propose(s)).state));
    expect(r.state.pending).toBeNull();
    expect(r.state.ap).toEqual(s.ap);
    expect(r.state.usedApThisTurn).toBe(false);
    expect(r.events).toEqual([{ type: 'specialCancelled', color: 'white', action: '나이트를 투석기로 날린다' }]);
  });

  it('attempt/cancel without a proposal is rejected', () => {
    expect(attempt(rich(), 10)).toMatchObject({ ok: false, reason: 'noPendingAction' });
    expect(cancel(rich())).toMatchObject({ ok: false, reason: 'noPendingAction' });
  });

  it('cannot attempt without enough AP', () => {
    const s = ok(propose(rich(1), ruling({ cost: 2 }))).state;
    expect(attempt(s, 20)).toMatchObject({ ok: false, reason: 'notEnoughAp' });
  });

  it('rejects rolls outside 1..20', () => {
    const s = ok(propose(rich())).state;
    for (const roll of [0, 21, 3.5]) expect(attempt(s, roll)).toMatchObject({ ok: false, reason: 'invalidRoll' });
  });

  it('success (roll >= DC) applies effects and spends AP; the turn continues', () => {
    const s = ok(propose(rich(3), ruling({ cost: 2 }))).state;
    const r = ok(attempt(s, 12));
    expect(r.state.board[sq('e5')]).toMatchObject({ type: 'knight', color: 'white' });
    expect(r.state.board[sq('b1')]).toBeNull();
    expect(r.state.ap.white).toBe(1);
    expect(r.state.turn).toBe('white');
    expect(r.state.usedApThisTurn).toBe(true);
    expect(r.state.pending).toBeNull();
    expect(r.events[0]).toMatchObject({ type: 'specialResolved', roll: 12, dc: 12, success: true, narration: '성공 서술' });
    expect(r.events[1]).toMatchObject({ type: 'moved', from: sq('b1'), to: sq('e5') });
  });

  it('failure (roll < DC) only spends AP; the turn continues', () => {
    const s = ok(propose(rich(3))).state;
    const r = ok(attempt(s, 11));
    expect(r.state.board).toEqual(s.board);
    expect(r.state.ap.white).toBe(2);
    expect(r.state.turn).toBe('white');
    expect(r.state.usedApThisTurn).toBe(true);
    expect(r.events).toEqual([expect.objectContaining({ type: 'specialResolved', success: false, narration: '실패 서술' })]);
  });

  it('allows several special actions per turn while AP lasts, then a normal move ends the turn', () => {
    let s = rich(2);
    s = ok(attempt(ok(propose(s)).state, 15)).state;
    const second = ruling({ effects: [{ type: 'remove', at: sq('d7') }] });
    s = ok(attempt(ok(propose(s, second, '폰을 저격한다')).state, 3)).state;
    expect(s.ap.white).toBe(0);
    expect(s.board[sq('d7')]).not.toBeNull();
    const third = ok(propose(s, ruling({ effects: [{ type: 'remove', at: sq('d7') }] }))).state;
    expect(attempt(third, 20)).toMatchObject({ ok: false, reason: 'notEnoughAp' });
    const after = okMove(ok(cancel(third)).state, 'e2', 'e4');
    expect(after.state.turn).toBe('black');
    expect(after.state.usedApThisTurn).toBe(false);
  });

  it('removing a piece reports it and can capture enemy pieces via move', () => {
    const s = ok(propose(rich(), ruling({ effects: [{ type: 'move', from: sq('b1'), to: sq('d7') }] }))).state;
    const r = ok(attempt(s, 20));
    expect(r.events[1]).toMatchObject({ type: 'moved', captured: { type: 'pawn', color: 'black' } });
  });

  it('announces check after effects', () => {
    const s = createStateFrom(
      {
        e1: { color: 'white', type: 'king' },
        a1: { color: 'white', type: 'rook' },
        e8: { color: 'black', type: 'king' },
      },
      'white',
      { ap: { white: 3, black: 0 } },
    );
    const p = ok(propose(s, ruling({ effects: [{ type: 'move', from: sq('a1'), to: sq('a8') }] }))).state;
    expect(ok(attempt(p, 20)).events).toContainEqual({ type: 'check', color: 'black' });
  });

  it('special-action effects revoke castling rights', () => {
    const s = ok(propose(rich(), ruling({ effects: [{ type: 'remove', at: sq('h8') }] }))).state;
    expect(ok(attempt(s, 20)).state.castling.black.kingSide).toBe(false);
  });
});
