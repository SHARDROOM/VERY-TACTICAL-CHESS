import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, parseSquare, type Effect, type GameState, type Ruling } from '../engine';
import { buildShow } from './show';

const sq = (n: string) => parseSquare(n)!;
const label = (o: string) => o;

/** A special action with these effects, attempted with this roll. */
function resolve(effects: Effect[], roll = 15) {
  const ruling: Ruling = { interpretation: 'x', feasible: true, dc: 10, cost: 2, effects, narration: { success: '해냈다', failure: '놓쳤다' } };
  let s: GameState = { ...createInitialState(), ap: { white: 3, black: 0 } };
  const proposed = applyCommand(s, { type: 'proposeSpecial', action: 'a', ruling });
  if (!proposed.ok) throw new Error(proposed.reason);
  s = proposed.state;
  const r = applyCommand(s, { type: 'attemptSpecial', roll });
  if (!r.ok) throw new Error(r.reason);
  return { before: s, after: r.state, events: r.events };
}

describe('building a show from a batch', () => {
  it('steps through the board one effect at a time and ends on the real result', () => {
    const effects: Effect[] = [
      { type: 'remove', at: sq('d7') },
      { type: 'move', from: sq('b1'), to: sq('d7') },
      { type: 'spawn', at: sq('e4'), color: 'white', piece: 'rook' },
    ];
    const { before, after, events } = resolve(effects);
    const show = buildShow(events, before, label)!;
    expect(show).toMatchObject({ kind: 'special', title: 'success', caption: '해냈다', outcome: 'success' });
    expect(show.steps).toHaveLength(4);
    // Before anything: AP already paid, ruling sheet put away, board untouched.
    expect(show.steps[0]).toMatchObject({ pending: null, ap: { white: 1 } });
    expect(show.steps[0].board[sq('d7')]?.type).toBe('pawn');
    expect(show.steps[1].board[sq('d7')]).toBeNull();
    expect(show.steps[1].captured.map((p) => p.type)).toEqual(['pawn']);
    expect(show.steps[2].board[sq('d7')]?.type).toBe('knight');
    // The spawned piece has the same id as in the real result.
    expect(show.steps[3].board[sq('e4')]?.id).toBe(after.board[sq('e4')]?.id);
    expect(show.steps[3].board).toEqual(after.board);
    expect(show.movers).toEqual([null, before.board[sq('b1')]!.id, null]);
    expect(show.timeline.effectStarts).toHaveLength(3);
  });

  it('a failure with nothing to show still has its narration, but no length', () => {
    const { before, events } = resolve([{ type: 'move', from: sq('b1'), to: sq('c3') }], 3);
    const show = buildShow(events, before, label)!;
    expect(show).toMatchObject({ outcome: 'failure', caption: '놓쳤다', effects: [] });
    expect(show.timeline.length).toBe(0);
  });

  it('chaos is staged too; a normal move is not', () => {
    const s = createInitialState();
    const r = applyCommand(s, { type: 'chaos', chaos: { title: '돌풍', narration: '바람이 분다', effects: [{ type: 'move', from: sq('a7'), to: sq('a5') }] } });
    if (!r.ok) throw new Error(r.reason);
    expect(buildShow(r.events, s, label)).toMatchObject({ kind: 'chaos', title: '돌풍', caption: '바람이 분다', outcome: null });
    const m = applyCommand(s, { type: 'move', from: sq('e2'), to: sq('e4') });
    if (!m.ok) throw new Error(m.reason);
    expect(buildShow(m.events, s, label)).toBeNull();
  });
});
