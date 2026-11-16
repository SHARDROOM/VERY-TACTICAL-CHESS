import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, createStateFrom, DEFAULT_RULES, type ChaosEvent, type Effect, type GameState } from './index';
import { ok, okMove, sq } from './testUtil';

const chaos = (state: GameState, ...effects: Effect[]) =>
  applyCommand(state, { type: 'chaos', chaos: { title: '모래바람', narration: '모래바람이 분다.', effects } satisfies ChaosEvent });

describe('running out of time', () => {
  it('costs the timeout penalty in AP and passes the turn', () => {
    const s = { ...createInitialState({ ...DEFAULT_RULES, timeoutPenalty: 2 }), ap: { white: 3, black: 0, red: 0 } };
    const r = ok(applyCommand(s, { type: 'timeout' }));
    expect(r.state.ap.white).toBe(1);
    expect(r.state.turn).toBe('black');
    expect(r.events[0]).toEqual({ type: 'timedOut', color: 'white', apLost: 2 });
  });

  it('never takes more AP than the player has', () => {
    const s = { ...createInitialState(), ap: { white: 0, black: 0, red: 0 } };
    expect(ok(applyCommand(s, { type: 'timeout' })).events[0]).toEqual({ type: 'timedOut', color: 'white', apLost: 0 });
  });

  it('cancels a ruling that was waiting for the player', () => {
    const ruling = { interpretation: 'x', feasible: true, dc: 4, cost: 1, effects: [], narration: { success: 's', failure: 'f' } };
    const s = ok(applyCommand({ ...createInitialState(), ap: { white: 2, black: 0, red: 0 } }, { type: 'proposeSpecial', action: '춤', ruling }));
    const r = ok(applyCommand(s.state, { type: 'timeout' }));
    expect(r.state.pending).toBeNull();
    expect(r.events.map((e) => e.type)).toEqual(['specialCancelled', 'timedOut', 'turnPassed']);
  });
});

describe('chaos', () => {
  it('applies its effects without AP or dice and is remembered', () => {
    const s = createInitialState();
    const r = ok(chaos(s, { type: 'move', from: sq('b8'), to: sq('a6') }));
    expect(r.state.board[sq('a6')]).toMatchObject({ color: 'black', type: 'knight' });
    expect(r.state.ap).toEqual(s.ap);
    expect(r.state.turn).toBe('white');
    expect(r.events[0]).toEqual({ type: 'chaos', title: '모래바람', narration: '모래바람이 분다.', effects: [{ type: 'move', from: sq('b8'), to: sq('a6') }] });
    expect(r.state.chaosLog).toEqual([{ turnNumber: 1, title: '모래바람', narration: '모래바람이 분다.' }]);
  });

  it('a spy changes sides (and a pawn that ends on its last rank promotes)', () => {
    const s = createInitialState();
    const r = ok(chaos(s, { type: 'convert', at: sq('e2'), color: 'black' }));
    expect(r.state.board[sq('e2')]).toMatchObject({ color: 'black', type: 'pawn' });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'converted', at: sq('e2'), to: 'black' }));
    const kingConvert = chaos(s, { type: 'convert', at: sq('e1'), color: 'black' });
    expect(kingConvert).toMatchObject({ ok: false, reason: 'invalidChaos' });
  });

  it('may not leave a king attacked, so nobody gets a free king capture', () => {
    const s = createStateFrom({ e1: { color: 'white', type: 'king' }, e8: { color: 'black', type: 'king' }, a1: { color: 'white', type: 'rook' } });
    const r = chaos(s, { type: 'move', from: sq('a1'), to: sq('a8') });
    expect(r).toMatchObject({ ok: false, reason: 'invalidChaos' });
  });

  it('cannot touch kings and records what it took off the board', () => {
    const s = createInitialState();
    expect(chaos(s, { type: 'remove', at: sq('e8') })).toMatchObject({ ok: false });
    const r = ok(chaos(s, { type: 'remove', at: sq('a7') }));
    expect(r.state.captured).toEqual([expect.objectContaining({ color: 'black', type: 'pawn' })]);
  });

  it('play goes on normally afterwards', () => {
    const s = ok(chaos(createInitialState(), { type: 'tag', at: sq('g8'), tag: '기절', turns: 1 })).state;
    expect(okMove(s, 'e2', 'e4').state.turn).toBe('black');
  });
});
