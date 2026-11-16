import { describe, expect, it } from 'vitest';
import { applyCommand, createInitialState, parseSquare, type Effect, type GameState, type Ruling } from '../engine';
import { buildShow, directionsFor } from './show';

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

describe('what each piece does in a show', () => {
  it('trips, entrances, acts and changes go to the right pieces', () => {
    const ruling: Ruling = {
      interpretation: 'x', feasible: true, dc: 10, cost: 1,
      effects: [
        { type: 'move', from: sq('b1'), to: sq('c3') },
        { type: 'spawn', at: sq('e4'), color: 'white', piece: 'rook' },
        { type: 'transform', at: sq('g1'), into: 'bishop' },
        { type: 'convert', at: sq('a7'), color: 'white' },
      ],
      narration: { success: 's', failure: 'f' },
      staging: {
        success: {
          fx: [], shake: 0,
          beats: [
            { effect: 0, wait: 0, motion: 'teleport', speed: 'fast', entrance: 'default', exit: 'default' },
            { effect: 1, wait: 0.5, motion: 'default', speed: 'normal', entrance: 'rise', exit: 'default' },
          ],
          acts: [{ at: sq('c3'), act: 'spin', delay: 5 }, { at: sq('e2'), act: 'hop', delay: 0 }],
        },
      },
    };
    let s: GameState = { ...createInitialState(), ap: { white: 3, black: 0 } };
    const p = applyCommand(s, { type: 'proposeSpecial', action: 'a', ruling });
    if (!p.ok) throw new Error(p.detail);
    s = p.state;
    const r = applyCommand(s, { type: 'attemptSpecial', roll: 15 });
    if (!r.ok) throw new Error(r.reason);
    const show = buildShow(r.events, s, label)!;
    const d = directionsFor(show, 1000);
    const knight = s.board[sq('b1')]!.id;
    expect(d.get(knight)?.motions).toEqual([{ style: 'teleport', duration: show.timeline.effectDurations[0] }]);
    expect(d.get(r.state.board[sq('e4')]!.id)?.entrance).toEqual({ style: 'rise', duration: show.timeline.effectDurations[1] });
    expect(d.get(s.board[sq('g1')]!.id)?.morph).toBe(true);
    expect(d.get(s.board[sq('a7')]!.id)?.swirl).toBe(true);
    // The spin at c3 comes after the knight has landed there; the hop is the e2 pawn's from the start.
    expect(d.get(knight)?.acts).toEqual([{ kind: 'spin', start: 1000 + show.timeline.actStarts[0] * 1000, duration: show.timeline.actDurations[0] }]);
    expect(d.get(s.board[sq('e2')]!.id)?.acts[0]).toMatchObject({ kind: 'hop', start: 1000 });
  });
});

describe('swaps, revivals, pits and walls in a show', () => {
  it('both pieces of a swap travel at once, each swerving to its own right', () => {
    const { before, events } = resolve([{ type: 'swap', a: sq('b1'), b: sq('g8') }]);
    const show = buildShow(events, before, label)!;
    const d = directionsFor(show, 0);
    const a = before.board[sq('b1')]!.id;
    const b = before.board[sq('g8')]!.id;
    expect(d.get(a)?.motions).toEqual([{ style: 'default', duration: show.timeline.effectDurations[0], side: 1 }]);
    expect(d.get(b)?.motions).toEqual([{ style: 'default', duration: show.timeline.effectDurations[0], side: 1 }]);
    expect(show.movers).toEqual([a]);
  });

  it('a revived piece leaves the side of the board in the step it comes back', () => {
    const { before, events } = resolve([{ type: 'remove', at: sq('d7') }, { type: 'revive', at: sq('d5'), color: 'black', piece: 'pawn' }]);
    const show = buildShow(events, before, label)!;
    const pawn = before.board[sq('d7')]!.id;
    expect(show.steps[1].captured.map((p) => p.id)).toEqual([pawn]);
    expect(show.steps[2].captured).toEqual([]);
    expect(show.steps[2].board[sq('d5')]?.id).toBe(pawn);
    expect(directionsFor(show, 0).get(pawn)?.revive).toEqual({ style: 'default', duration: show.timeline.effectDurations[1] });
  });

  it('a piece thrown into a pit travels there and sinks; a wall shows in the step it rises', () => {
    const { before, events } = resolve([
      { type: 'terrain', at: sq('d4'), kind: 'pit', turns: 2 },
      { type: 'move', from: sq('b1'), to: sq('d4') },
      { type: 'terrain', at: sq('e4'), kind: 'wall', turns: 2 },
    ]);
    const show = buildShow(events, before, label)!;
    const knight = before.board[sq('b1')]!.id;
    expect(show.steps[1].terrain).toEqual([expect.objectContaining({ at: sq('d4'), kind: 'pit' })]);
    expect(show.steps[3].terrain?.map((c) => c.kind)).toEqual(['pit', 'wall']);
    expect(show.exits).toEqual([{ pieceId: knight, at: sq('d4'), exit: 'sink', start: show.timeline.effectStarts[1] + show.timeline.effectDurations[1] * 0.9 }]);
    expect(directionsFor(show, 0).get(knight)?.fallInto).toEqual({ at: sq('d4'), duration: show.timeline.effectDurations[1] * 0.9 });
    expect(show.steps[2].captured).toEqual([expect.objectContaining({ id: knight, exit: 'sink' })]);
  });
});

describe('clashes in a show', () => {
  it('a move effect that sets off a clash marks where the show stops; the board steps match the real result', () => {
    const ruling: Ruling = { interpretation: 'x', feasible: true, dc: 5, cost: 1, effects: [{ type: 'move', from: sq('b1'), to: sq('c3') }, { type: 'move', from: sq('c3'), to: sq('d5') }, { type: 'tag', at: sq('d5'), tag: '용기', turns: 1 }], narration: { success: 's', failure: 'f' } };
    let s: GameState = { ...createInitialState(), ap: { white: 3, black: 0 } };
    const b = [...s.board];
    b[sq('d5')] = { id: 'bp', color: 'black', type: 'pawn', tags: [{ name: '검술', turnsLeft: null, appliedOnTurn: 1, clash: 1.5 }] };
    s = { ...s, board: b };
    const proposed = applyCommand(s, { type: 'proposeSpecial', action: 'a', ruling });
    if (!proposed.ok) throw new Error(proposed.detail);
    // The knight loses the clash: 4 against 15 × 1.2 (a pawn's ×0.8 with 검술 ×1.5).
    const r = applyCommand(proposed.state, { type: 'attemptSpecial', roll: 15, clashRolls: [4, 15] });
    if (!r.ok) throw new Error(r.reason);
    const show = buildShow(r.events, proposed.state, label)!;
    expect(show.clashes).toEqual([{ effect: 1, clash: expect.objectContaining({ winner: 'defender', defense: 1.2 }) }]);
    // Only the effects that happened: the third never did.
    expect(show.effects).toHaveLength(2);
    expect(show.steps[2].board).toEqual(r.state.board);
    // Picking up after the duel, the pieces only do what is still to come.
    const later = directionsFor(show, 0, 1);
    expect(later.get(proposed.state.board[sq('b1')]!.id)?.motions ?? []).toHaveLength(1);
  });
});
