import { DIE_SIDES, ROLL_MIN } from './config';
import { stackOf } from './tags';
import type { Board, Color, CommandResult, GameState, Piece, PieceType, Precedent } from './types';

/*
 * 명장면 (사용자 요청): the game's miracle, heartbreak and MVP, from what the game keeps (no GM
 * call). docs/SPEC.md, "명장면".
 */

/** The chance a special action had: two dice plus its bonus reach the DC, and 1·1 always fails (as in game.ts). */
export function successChance(dc: number, bonus = 0): number {
  let hits = 0;
  for (let a = 1; a <= DIE_SIDES; a++) for (let b = 1; b <= DIE_SIDES; b++) if (a + b !== ROLL_MIN && a + b + bonus >= dc) hits++;
  return hits / (DIE_SIDES * DIE_SIDES);
}

function findPiece(board: Board, id: string): Piece | null {
  for (const p of board) if (p) for (const q of stackOf(p)) if (q.id === id) return q;
  return null;
}

/**
 * Counts what a command took, for the piece that took it: a capture by a move (normal, an effect,
 * a wanderer's, a rider's landing), a clash the defender won (its attacker falls, unless it only
 * shot), a guard that died in its friend's place (the attacker's), and a special action's plain
 * removal of another side's piece (its actor's).
 */
export function noteTakes(before: GameState, result: CommandResult): CommandResult {
  if (!result.ok) return result;
  const credit: string[] = [];
  const pieceOf = (id: string) => findPiece(result.state.board, id) ?? findPiece(before.board, id);
  // Who struck at the piece a guard (원호) or a hostage (인질) died for.
  const interceptedBy = new Map<string, string>();
  for (const e of result.events) {
    if (e.type === 'moved' && e.captured) credit.push(e.pieceId);
    else if (e.type === 'unboarded' && e.captured) credit.push(e.riderId);
    else if (e.type === 'clash' && e.winner === 'defender' && e.strike !== 'ranged') credit.push(e.defenderId);
    else if (e.type === 'intercepted') interceptedBy.set(e.saverId, e.attackerId);
    else if (e.type === 'removed' && (e.cause === 'guard' || e.cause === 'hostage')) {
      // The attacker took the one that died in its target's place, unless that was its own side's (a hostage).
      const by = interceptedBy.get(e.piece.id);
      if (by && pieceOf(by)?.color !== e.piece.color) credit.push(by);
    }
  }
  const actorAt = before.pending?.ruling.actor;
  const actor = actorAt === undefined || actorAt === null ? null : before.board[actorAt];
  if (actor && result.events.some((e) => e.type === 'specialResolved' && e.success)) {
    for (const e of result.events) if (e.type === 'removed' && !e.cause && e.piece.color !== actor.color) credit.push(actor.id);
  }
  if (!credit.length) return result;
  const takes = { ...(result.state.takes ?? {}) };
  for (const id of credit) {
    const p = pieceOf(id);
    const was = takes[id];
    takes[id] = { color: p?.color ?? was?.color ?? 'gray', type: p?.type ?? was?.type ?? 'pawn', n: (was?.n ?? 0) + 1 };
  }
  return { ...result, state: { ...result.state, takes } };
}

/** A success this likely or more is no miracle. */
export const MIRACLE_BELOW = 0.5;

export interface Highlights {
  /** 기적: the least likely special action that came off (under MIRACLE_BELOW). */
  miracle?: { turnNumber: number; color: Color; action: string; chance: number };
  /** 통한: the likeliest action that came up 1·1, or else the failure that cost the most AP. */
  heartbreak?: { turnNumber: number; color: Color; action: string; chance: number; fumble: boolean; spent: number };
  /** MVP: the side's piece that took the most (gray wanderers are no one's). */
  mvp?: { id: string; color: Color; type: PieceType; n: number; alive: boolean };
}

export function highlights(state: GameState): Highlights {
  const out: Highlights = {};
  const chance = (p: Precedent) => successChance(p.dc, p.bonus ?? 0);
  const spent = (p: Precedent) => p.cost + (p.rerolls ?? 0) * state.rules.rerollCost;
  const pick = <T>(list: T[], better: (a: T, b: T) => boolean): T | undefined => list.reduce<T | undefined>((best, x) => (best === undefined || better(x, best) ? x : best), undefined);

  const miracle = pick(state.precedents.filter((p) => p.outcome === 'success' && chance(p) < MIRACLE_BELOW), (a, b) => chance(a) < chance(b));
  if (miracle) out.miracle = { turnNumber: miracle.turnNumber, color: miracle.color, action: miracle.action, chance: chance(miracle) };

  const fumbles = state.precedents.filter((p) => p.outcome === 'critFailure');
  const failures = state.precedents.filter((p) => p.outcome === 'failure');
  const sad = fumbles.length
    ? pick(fumbles, (a, b) => chance(a) > chance(b))
    : pick(failures, (a, b) => spent(a) > spent(b) || (spent(a) === spent(b) && chance(a) > chance(b)));
  if (sad) out.heartbreak = { turnNumber: sad.turnNumber, color: sad.color, action: sad.action, chance: chance(sad), fumble: sad.outcome === 'critFailure', spent: spent(sad) };

  // As many taken: the one still standing.
  const takers = Object.entries(state.takes ?? {})
    .filter(([, t]) => t.color !== 'gray')
    .map(([id, t]) => ({ id, t, now: findPiece(state.board, id) }));
  const best = pick(takers, (a, b) => a.t.n > b.t.n || (a.t.n === b.t.n && !!a.now && !b.now));
  if (best) {
    const { id, t, now } = best;
    out.mvp = { id, color: now?.color ?? t.color, type: now?.type ?? t.type, n: t.n, alive: now !== null };
  }
  return out;
}
