import {
  applyEffects,
  buildTimeline,
  type Effect,
  type GameEvent,
  type GameState,
  type Outcome,
  type Piece,
  type Staging,
  type Timeline,
} from '../engine';

/**
 * A staged show, worked out from one batch of game events: the board after each effect (so
 * the screen can show them one by one), who moves in each, and when everything happens.
 * Pure: the screen only plays it. docs/SPEC.md, "GM 연출" (재생).
 */
export interface Show {
  kind: 'special' | 'chaos';
  /** Chaos title, or the outcome label of a special action. */
  title: string;
  outcome: Outcome | null;
  /** The GM's narration, shown as a caption. */
  caption: string;
  staging: Staging | undefined;
  effects: Effect[];
  timeline: Timeline;
  /** What the screen shows before the first effect, then after each effect. `steps[0]` is the start. */
  steps: GameState[];
  /** The piece each effect carries across the board (moved or unboarded), for trails and motion styles. */
  movers: (string | null)[];
}

const gone = (events: GameEvent[]): Piece[] =>
  events.flatMap((e) => {
    const piece = e.type === 'moved' || e.type === 'unboarded' ? e.captured : e.type === 'removed' ? e.piece : null;
    return piece ? [{ id: piece.id, color: piece.color, type: piece.type }] : [];
  });

/** The piece that `effect` sends across the board, on the board as it stood just before it. */
function moverOf(effect: Effect, board: GameState['board']): string | null {
  if (effect.type === 'move') return board[effect.from]?.id ?? null;
  if (effect.type === 'unboard') return board[effect.at]?.rider?.id ?? null;
  return null;
}

/** The show for a batch, or null if it has nothing to stage (a normal move, a timeout...). */
export function buildShow(events: GameEvent[], before: GameState, outcomeLabel: (o: Outcome) => string): Show | null {
  const resolved = events.find((e) => e.type === 'specialResolved');
  const chaos = events.find((e) => e.type === 'chaos');
  const head = resolved ?? chaos;
  if (!head) return null;
  const effects = head.effects ?? [];
  const staging = head.staging;
  // On screen the AP is already spent and the ruling sheet put away when the show starts.
  const start: GameState =
    head.type === 'specialResolved'
      ? { ...before, pending: null, usedApThisTurn: true, ap: { ...before.ap, [head.color]: Math.max(0, before.ap[head.color] - head.cost) } }
      : before;

  const steps: GameState[] = [start];
  const movers: (string | null)[] = [];
  const ctx = { turnNumber: before.turnNumber, nextSpawnId: before.nextSpawnId };
  for (let i = 0; i < effects.length; i++) {
    movers.push(moverOf(effects[i], steps[i].board));
    // From the start each time, so spawned pieces get the same ids as in the real result.
    const applied = applyEffects(before.board, effects.slice(0, i + 1), ctx);
    if (!applied.ok) break; // cannot happen for a result the engine accepted; show what we have
    steps.push({ ...start, board: applied.board, captured: [...(before.captured ?? []), ...gone(applied.events)] });
  }
  const shown = effects.slice(0, steps.length - 1);

  return {
    kind: head.type === 'chaos' ? 'chaos' : 'special',
    title: head.type === 'chaos' ? head.title : outcomeLabel(head.outcome),
    outcome: head.type === 'specialResolved' ? head.outcome : null,
    caption: head.narration,
    staging,
    effects: shown,
    timeline: buildTimeline(staging, shown),
    steps,
    movers,
  };
}
