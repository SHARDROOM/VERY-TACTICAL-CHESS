import { isInCheck, movesFrom } from './moves';
import { distance } from './squares';
import { hasTag, isStunned } from './tags';
import { CONFUSED, VANGUARD, type Board, type GameState, type Square } from './types';

/*
 * Pieces that move of their own accord at the end of their owner's turn (docs/SPEC.md, "혼란과
 * 행동대장"): a 혼란 piece staggers to a random free square it could move to; a 행동대장 orders the
 * best move among itself and its own pieces next to it (the AI's 보통 look, ai.ts vanguardOrder).
 * The runner of the game picks and sends an 'impulse' command; the engine checks it here.
 */

export type ImpulseKind = 'confused' | 'vanguard';

/** What drives the piece on `from` at its turn's end, if anything (혼란 wins over 행동대장). */
export function impulseOf(board: Board, from: Square): ImpulseKind | null {
  const p = board[from];
  if (!p) return null;
  if (hasTag(p, CONFUSED)) return 'confused';
  if (hasTag(p, VANGUARD)) return 'vanguard';
  return null;
}

/**
 * The same in a game state: also a piece whose 혼란 or 행동대장 ran out at the end of the turn that
 * just ended (it moves this once more, see GameState.impulseDue).
 */
export function impulseKindOf(state: GameState, from: Square): ImpulseKind | null {
  const own = impulseOf(state.board, from);
  if (own) return own;
  const id = state.board[from]?.id;
  return (id && state.impulseDue?.find((d) => d.id === id)?.kind) || null;
}

/** The pieces of `color` on `board` that move of their own accord at its turn's end (stunned ones do not). */
export function impulsesDue(board: Board, color: GameState['turn']): NonNullable<GameState['impulseDue']> {
  return board.flatMap((p, sq) => {
    const kind = p && p.color === color && !isStunned(p) ? impulseOf(board, sq) : null;
    return kind ? [{ id: p!.id, kind }] : [];
  });
}

/** A king never walks into an attack of its own accord. */
function kingSafeAfter(board: Board, from: Square, to: Square, terrain: GameState['terrain']): boolean {
  const piece = board[from]!;
  if (piece.type !== 'king') return true;
  const b = [...board];
  b[to] = piece;
  b[from] = null;
  return !isInCheck(b, piece.color, terrain);
}

/**
 * Where the piece on `from` may go of its own accord: 혼란, only free squares; 행동대장, also
 * captures, but never of a king (a turn's end gives no one a chance to answer).
 */
export function impulseTargets(state: GameState, from: Square, kind: ImpulseKind): Square[] {
  const { board, terrain } = state;
  const piece = board[from];
  if (!piece) return [];
  return movesFrom(board, from, terrain).filter((to) => {
    const there = board[to];
    if (kind === 'confused' ? !!there : there?.type === 'king' || there?.color === piece.color) return false;
    return kingSafeAfter(board, from, to, terrain);
  });
}

/**
 * The pieces a 행동대장 on `by` may order at its side's turn's end: itself and its own pieces next
 * to it (1 square), not kings, not 혼란 pieces (they stagger on their own), only those that can move.
 * The order itself (the best of their moves) is the AI's: see ai.ts vanguardOrder.
 */
export function commandable(state: GameState, by: Square): Square[] {
  const { board } = state;
  const leader = board[by];
  if (!leader || impulseKindOf(state, by) !== 'vanguard' || isStunned(leader)) return [];
  const out: Square[] = [];
  board.forEach((p, sq) => {
    if (!p || p.color !== leader.color || p.type === 'king' || distance(by, sq) > 1) return;
    if (impulseKindOf(state, sq) === 'confused') return;
    if (impulseTargets(state, sq, 'vanguard').length) out.push(sq);
  });
  return out;
}
