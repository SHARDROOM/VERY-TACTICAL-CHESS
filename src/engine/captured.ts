import type { Exit } from './staging';
import type { CapturedPiece, Color, GameEvent, RemainsMark, Square } from './types';
import { groundOf } from './squares';
import { enPassantVictim } from './moves';

/** How a piece that left in this event goes when the GM staged nothing: burnt up to ash, sunk into a pit. */
function plainExit(e: GameEvent): Exit | undefined {
  if (e.type !== 'removed') return undefined;
  return e.cause === 'burn' ? 'ash' : e.cause === 'pit' ? 'sink' : undefined;
}

/** The square a piece was taken on (a pawn taken en passant stood beside the square moved to). */
function whereTaken(e: Extract<GameEvent, { type: 'moved' | 'removed' }>): Square {
  if (e.type === 'removed') return e.at;
  return e.special?.kind === 'enPassant' ? enPassantVictim(e.from, e.to) : e.to;
}

/** How many of its owner's turns a fallen piece's remains (유해) last. */
export const REMAINS_TURNS = 3;

/**
 * The remains after these events: every piece that fell on the board (taken, removed, burnt,
 * given up, shattered...) leaves them where it fell; a revived piece takes its own away. Kings
 * leave none (they cannot be revived).
 */
export function remainsAfter(remains: readonly RemainsMark[] | undefined, events: readonly GameEvent[], turnNumber: number): RemainsMark[] {
  let out = [...(remains ?? [])];
  for (const e of events) {
    const piece = e.type === 'moved' ? e.captured : e.type === 'removed' ? e.piece : null;
    if (piece && (e.type === 'moved' || e.type === 'removed')) {
      if (piece.type === 'king') continue;
      out = out.filter((r) => r.pieceId !== piece.id);
      out.push({ pieceId: piece.id, color: piece.color, type: piece.type, at: groundOf(whereTaken(e)), turnsLeft: REMAINS_TURNS, appliedOnTurn: turnNumber });
    } else if (e.type === 'revived') {
      out = out.filter((r) => r.pieceId !== e.piece.id);
    }
  }
  return out;
}

/** A turn of `color` ended: its pieces' remains fade by one (a gray wanderer's fade every turn); gone at 0. */
export function tickRemains(remains: readonly RemainsMark[] | undefined, color: Color, turnNumber: number): RemainsMark[] | undefined {
  if (!remains?.length) return remains as RemainsMark[] | undefined;
  return remains
    .map((r) => ((r.color === color || r.color === 'gray') && r.appliedOnTurn !== turnNumber ? { ...r, turnsLeft: r.turnsLeft - 1 } : r))
    .filter((r) => r.turnsLeft > 0);
}

/** The newest remains on this ground square, if any. */
export const remainsAt = (remains: readonly RemainsMark[] | undefined, at: Square): RemainsMark | undefined =>
  [...(remains ?? [])].reverse().find((r) => r.at === groundOf(at));

/**
 * The pieces beside the board after these events: those taken off are added (plain: no tags,
 * no rider, with how they left), those revived are taken back out.
 */
export function capturedAfter(captured: readonly CapturedPiece[] | undefined, events: readonly GameEvent[], exits?: ReadonlyMap<string, Exit>): CapturedPiece[] {
  const out = [...(captured ?? [])];
  for (const e of events) {
    const piece = e.type === 'moved' ? e.captured : e.type === 'removed' ? e.piece : null;
    if (piece && (e.type === 'moved' || e.type === 'removed')) {
      const ruled = e.type === 'removed' ? e.exit : e.type === 'moved' ? e.capturedExit : undefined;
      const exit = exits?.get(piece.id) ?? ruled ?? plainExit(e);
      // A piece that shatters leaves its shards where it stood (below it, if it was in the air).
      const at = exit === 'shatter' ? groundOf(whereTaken(e)) : undefined;
      out.push({ id: piece.id, color: piece.color, type: piece.type, ...(exit && { exit }), ...(at !== undefined && { at }) });
    } else if (e.type === 'revived') {
      const i = out.map((p) => p.id).lastIndexOf(e.piece.id);
      if (i >= 0) out.splice(i, 1);
    }
  }
  return out;
}
