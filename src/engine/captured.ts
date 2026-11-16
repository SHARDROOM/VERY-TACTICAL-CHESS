import type { Exit } from './staging';
import type { CapturedPiece, GameEvent, Square } from './types';
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
