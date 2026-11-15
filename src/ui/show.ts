import {
  applyEffects,
  buildTimeline,
  exitsOf,
  takenPieces,
  type Effect,
  type Element,
  type Exit,
  type Fx,
  type GameEvent,
  type GameState,
  type Outcome,
  type Square,
  type Staging,
  type Timeline,
} from '../engine';
import type { PieceDirection } from '../scene/pieceMotion';

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
  /** Pieces taken by an effect with a staged exit: who, when (seconds into the show) and how. */
  exits: { pieceId: string; at: Square; exit: Exit; start: number }[];
}

/** The particles that go with each way of leaving (burning follows the piece as it is thrown off). */
const EXIT_FX: Partial<Record<Exit, { element: Element; shape: 'burst' | 'trail'; radius: number; strength: number; duration: number }>> = {
  burn: { element: 'fire', shape: 'trail', radius: 1, strength: 3, duration: 1.6 },
  ash: { element: 'fire', shape: 'burst', radius: 0.6, strength: 3, duration: 1 },
  shatter: { element: 'impact', shape: 'burst', radius: 0.8, strength: 3, duration: 0.6 },
  vanish: { element: 'arcane', shape: 'burst', radius: 0.6, strength: 2, duration: 0.9 },
  sink: { element: 'earth', shape: 'burst', radius: 0.7, strength: 2, duration: 1 },
};

/** Particle effects for the staged exits in a show, with the piece a trail follows. */
export function exitFx(show: Show): { fx: Fx; follower: string | null; start: number; end: number }[] {
  return show.exits.flatMap((x) => {
    const look = EXIT_FX[x.exit];
    if (!look) return [];
    const fx: Fx = { ...look, at: x.at, to: null, withEffect: null, delay: 0 };
    return [{ fx, follower: look.shape === 'trail' ? x.pieceId : null, start: x.start, end: x.start + look.duration }];
  });
}

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
    const taken = takenPieces(applied.events, exitsOf(applied.events, applied.sources, staging));
    steps.push({ ...start, board: applied.board, captured: [...(before.captured ?? []), ...taken] });
  }
  const shown = effects.slice(0, steps.length - 1);
  const timeline = buildTimeline(staging, shown);

  // Who leaves in a staged way, and when: at once for a removal, as the attacker lands for a capture.
  const exits: Show['exits'] = [];
  shown.forEach((e, i) => {
    const exit = staging?.beats.find((b) => b.effect === i)?.exit;
    if (!exit || exit === 'default' || exit === 'knock') return;
    const at = e.type === 'remove' ? e.at : e.type === 'move' ? e.to : null;
    const victim = at === null ? null : steps[i].board[at];
    if (at === null || !victim || (e.type === 'move' && victim.color === steps[i].board[e.from]?.color)) return;
    const start = timeline.effectStarts[i] + (e.type === 'move' ? timeline.effectDurations[i] * 0.85 : 0);
    exits.push({ pieceId: victim.id, at, exit, start });
    if (victim.rider) exits.push({ pieceId: victim.rider.id, at, exit, start });
  });

  return {
    kind: head.type === 'chaos' ? 'chaos' : 'special',
    title: head.type === 'chaos' ? head.title : outcomeLabel(head.outcome),
    outcome: head.type === 'specialResolved' ? head.outcome : null,
    caption: head.narration,
    staging,
    effects: shown,
    timeline,
    steps,
    movers,
    exits,
  };
}

/** What each piece does in a show, by piece id. `startedAt` is when the show starts (ms). */
export function directionsFor(show: Show, startedAt: number): Map<string, PieceDirection> {
  const out = new Map<string, PieceDirection>();
  const get = (id: string) => {
    let d = out.get(id);
    if (!d) out.set(id, (d = { motions: [], acts: [] }));
    return d;
  };
  const { timeline, staging } = show;
  show.effects.forEach((e, i) => {
    const beat = staging?.beats.find((b) => b.effect === i);
    const before = show.steps[i].board;
    const after = show.steps[i + 1].board;
    const duration = timeline.effectDurations[i];
    switch (e.type) {
      case 'move': {
        const id = before[e.from]?.id;
        if (id) get(id).motions.push({ style: beat?.motion ?? 'default', duration });
        break;
      }
      case 'unboard': {
        const id = before[e.at]?.rider?.id;
        if (id) {
          const d = get(id);
          d.appearFrom = e.at;
          d.motions.push({ style: !beat || beat.motion === 'default' ? 'hop' : beat.motion, duration });
        }
        break;
      }
      case 'board': {
        const id = after[e.carrier]?.id;
        if (id) get(id).boardFrom = e.rider;
        break;
      }
      case 'spawn': {
        const id = after[e.at]?.id;
        if (id) get(id).entrance = { style: beat?.entrance ?? 'default', duration };
        break;
      }
      case 'transform': {
        const id = after[e.at]?.id;
        if (id) get(id).morph = true;
        break;
      }
      case 'convert': {
        const id = after[e.at]?.id;
        if (id) get(id).swirl = true;
        break;
      }
    }
  });
  // A piece taken by a trip waits for the attacker to arrive before it leaves.
  for (const x of show.exits) {
    const i = timeline.effectStarts.filter((t) => t <= x.start).length - 1;
    get(x.pieceId).exitDelay = Math.max(0, x.start - (timeline.effectStarts[i] ?? 0));
  }
  (staging?.acts ?? []).forEach((a, i) => {
    const start = timeline.actStarts[i];
    // Whoever stands on the square when the act begins.
    const step = timeline.effectStarts.filter((t) => t <= start).length;
    const id = show.steps[Math.min(step, show.steps.length - 1)].board[a.at]?.id;
    if (id) get(id).acts.push({ kind: a.act, start: startedAt + start * 1000, duration: timeline.actDurations[i] });
  });
  return out;
}
