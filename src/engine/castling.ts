import type { CastlingRights, Color, Square } from './types';
import { squareAt } from './squares';

export const KING_START: Record<Color, Square> = { white: squareAt(4, 0)!, black: squareAt(4, 7)! };
export const ROOK_START: Record<Color, { kingSide: Square; queenSide: Square }> = {
  white: { kingSide: squareAt(7, 0)!, queenSide: squareAt(0, 0)! },
  black: { kingSide: squareAt(7, 7)!, queenSide: squareAt(0, 7)! },
};

export const FULL_CASTLING: CastlingRights = {
  white: { kingSide: true, queenSide: true },
  black: { kingSide: true, queenSide: true },
};

/**
 * Revoke rights for every start square that a change touched. Works for any board
 * change (normal moves, captures, and later special-action effects): if a king or
 * rook leaves its start square, or anything lands on it, the right is gone.
 */
export function revokeCastling(rights: CastlingRights, touched: Square[]): CastlingRights {
  const next: CastlingRights = { white: { ...rights.white }, black: { ...rights.black } };
  for (const color of ['white', 'black'] as const) {
    if (touched.includes(KING_START[color])) next[color] = { kingSide: false, queenSide: false };
    if (touched.includes(ROOK_START[color].kingSide)) next[color].kingSide = false;
    if (touched.includes(ROOK_START[color].queenSide)) next[color].queenSide = false;
  }
  return next;
}
