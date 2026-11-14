import { RIDE, STUN, SHIELD, type Board, type Color, type GameEvent, type Piece, type Tag } from './types';

export const hasTag = (piece: Piece | null | undefined, name: string): boolean =>
  !!piece?.tags?.some((t) => t.name === name);

export const isStunned = (piece: Piece | null | undefined) => hasTag(piece, STUN);
export const isShielded = (piece: Piece | null | undefined) => hasTag(piece, SHIELD);

/** Adds or refreshes a tag (same name replaces the old one). */
export function withTag(piece: Piece, tag: Tag): Piece {
  return { ...piece, tags: [...(piece.tags ?? []).filter((t) => t.name !== tag.name), tag] };
}

export function withoutTag(piece: Piece, name: string): Piece {
  const tags = (piece.tags ?? []).filter((t) => t.name !== name);
  return { ...piece, tags };
}

export const CORE_TAGS: readonly string[] = [STUN, RIDE, SHIELD];

/**
 * Tag countdown rule: a tag with a duration loses one turn when its piece's
 * OWNER finishes a turn, except on the turn the tag was applied. So a 1-turn
 * stun put on an enemy knight keeps it still for exactly the enemy's next turn;
 * a 1-turn tag put on your own piece lasts through your next turn too.
 * Called when `color`'s turn `turnNumber` ends. Riders count down with everyone else.
 */
export function tickTags(
  board: Board,
  color: Color,
  turnNumber: number,
): { board: (Piece | null)[]; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const tick = (piece: Piece): Piece => {
    let next = piece;
    if (piece.color === color && piece.tags?.length) {
      const kept: Tag[] = [];
      for (const t of piece.tags) {
        if (t.turnsLeft === null || t.appliedOnTurn === turnNumber) {
          kept.push(t);
          continue;
        }
        const left = t.turnsLeft - 1;
        if (left > 0) kept.push({ ...t, turnsLeft: left });
        else events.push({ type: 'tagExpired', pieceId: piece.id, tag: t.name });
      }
      next = { ...piece, tags: kept };
    }
    if (next.rider) next = { ...next, rider: tick(next.rider) };
    return next;
  };
  return { board: board.map((p) => (p ? tick(p) : null)), events };
}
